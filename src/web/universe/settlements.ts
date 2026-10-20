import { Material, Mesh, Ray, TransformNode, Vector3, VertexData, type AbstractMesh, type Scene } from '@babylonjs/core';
import { planetSpec, type PlanetSpec, type V3 } from '../../sim/world/planet/planet';
import { planetToRealm } from '../../sim/world/planet/chart';
import type { PlanetDescriptor } from '../../sim/world/universe/generation';
import type { SettlementPatch } from '../../sim/world/universe/settlements';
import type { RealmChunk, RealmId } from '../../sim/world/realms/layout';
import type { AssetPlacement, AssetScenePlan } from '../../sim/world/assets/focused';
import type { FocusedTerrain } from '../../sim/world/assets/focusedTerrain';
import { bendPoint, bendTree } from '../planet/bend';
import { RealmRenderer } from '../realms/render';
import { FocusedAssets } from '../realms/focusedAssets';
import type { Atmosphere } from '../world/atmosphere';
import type { RenderContext } from '../render/engine';
import type { UniverseShadowOwner } from './lighting';

export interface SettlementProjection {
  version: 1; seed: number; patches: readonly SettlementPatch[];
  chunks: { realm: RealmId; chunk: RealmChunk }[];
  focused: AssetScenePlan | null; terrain: FocusedTerrain | null;
  doors: SettlementDoor[];
}
export interface SettlementDoor { realm: RealmId; x: number; y: number; z: number; open: boolean }
const vector = (p: V3) => new Vector3(p.x, p.y, p.z);
const inside = (p: { x: number; z: number }, b: SettlementPatch['bounds']) =>
  p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;

/** A small lens footprint, rather than a zero-width centre ray, protects the
 * near plane while orbiting beside a wall. This changes only presentation. */
export function settlementCameraClearance(scene: Scene, pivot: Vector3, eye: Vector3, radius = .3): Vector3 {
  const offset = eye.subtract(pivot), distance = offset.length();
  if (distance < .001) return eye;
  const direction = offset.scale(1 / distance);
  const reference = Math.abs(direction.y) < .9 ? Vector3.Up() : Vector3.Right();
  const right = Vector3.Cross(direction, reference).normalize().scale(radius);
  const vertical = Vector3.Cross(direction, right).normalize().scale(radius);
  let clear = distance;
  for (const shift of [Vector3.Zero(), right, right.scale(-1), vertical, vertical.scale(-1)]) {
    const hit = scene.pickWithRay(new Ray(pivot.add(shift), direction, distance),
      mesh => !!mesh.metadata?.canonicalSettlement && mesh.isEnabled() && mesh.isVisible);
    if (hit?.hit) clear = Math.min(clear, Math.max(0, hit.distance - radius));
  }
  return pivot.add(direction.scale(clear));
}

/** Static settlement presentation uses only the host's plans, chunks and door
 * state. Meshes share the canonical spherical chart and a floating-origin parent. */
export class UniverseSettlements {
  private projection: SettlementProjection | null = null;
  private spec: PlanetSpec | null = null;
  private root: TransformNode;
  private renderers = new Map<RealmId, RealmRenderer>();
  private bentChunks = new Set<string>();
  private assets: FocusedAssets;
  private manifest: Promise<unknown> | null = null;
  private active = new Map<string, { root: TransformNode; dispose(): void }>();
  private desired = new Map<string, AssetPlacement>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private errors: string[] = [];
  private doors = new Set<number>();
  private doorKey = '';
  private disposed = false;
  private enabled = false;
  private updateAge = 1;
  private revision = 0;
  private ground: Mesh | null = null;
  private casters = new Set<AbstractMesh>();
  // Existing asset renderers only use these two shadow registration methods.
  // The universe has its own spherical lighting, not the planar Atmosphere sky.
  private lighting: Atmosphere;
  constructor(private ctx: RenderContext, shadows: UniverseShadowOwner = { addCaster() {}, removeCaster() {} }) {
    this.lighting = {
      addCaster: (mesh: AbstractMesh) => {
        if (this.disposed || this.casters.has(mesh)) return;
        this.casters.add(mesh); shadows.addCaster(mesh);
      },
      removeCaster: (mesh: AbstractMesh) => { if (this.casters.delete(mesh)) shadows.removeCaster(mesh); },
    } as Atmosphere;
    this.root = new TransformNode('canonical-settlements', ctx.scene);
    this.root.setEnabled(false);
    this.assets = new FocusedAssets(ctx.scene, this.lighting);
  }

  setProjection(projection: SettlementProjection) {
    if (this.disposed || this.projection) return;
    if (projection.version !== 1 || projection.patches.length > 4 || projection.chunks.length > 100)
      throw Error('Unsupported settlement presentation');
    this.projection = projection; this.spec = planetSpec(projection.seed);
    this.setDoors(projection.doors);
    for (const patch of projection.patches) this.renderers.set(patch.realm, new RealmRenderer(this.ctx, this.lighting));
    const patch = projection.patches.find(p => p.realm === 'brass');
    if (projection.terrain && patch) this.drawGround(projection.terrain, patch);
    this.revision++;
  }

  setDoors(doors: readonly (SettlementDoor | { index: number; open: boolean })[]) {
    // Adapter for the existing RealmRenderer's address key; state itself comes
    // from canonical door coordinates, including its actual vertical cell.
    const indices = doors.filter(d => d.open).map(d => 'index' in d ? d.index : (d.x * 6144 + d.z) * 176 + d.y).sort((a, b) => a - b);
    const key = indices.join(',');
    if (key === this.doorKey) return;
    this.doorKey = key; this.doors = new Set(indices);
    this.applyDoors();
  }
  private applyDoors() {
    for (const renderer of this.renderers.values()) renderer.setDoors([...this.doors].map(index => ({ index, open: true })));
    for (const mesh of this.root.getChildMeshes()) {
      const index = mesh.metadata?.settlementDoorIndex;
      if (typeof index === 'number') mesh.setEnabled(!this.doors.has(index));
    }
  }

  private bend(root: TransformNode, patch: SettlementPatch): Mesh[] {
    const original = root.getChildMeshes();
    // bendTree materializes InstancedMesh nodes into new spherical Mesh objects.
    // Preserve the source owner's actual caster choice, including excluded
    // forest ground/canopies, rather than enabling every replacement blindly.
    for (const mesh of original) mesh.metadata = { ...mesh.metadata, settlementCastsShadow: this.casters.has(mesh) };
    const meshes = bendTree(this.spec!, patch.chart, root, (original, replacement) => {
      // The generic bend clones sourceMesh, so it cannot infer metadata owned
      // by this particular placed instance (door address, placement, caster).
      replacement.metadata = { ...replacement.metadata, ...original.metadata };
    });
    const retained = new Set<AbstractMesh>(meshes);
    for (const mesh of original) if (!retained.has(mesh)) this.lighting.removeCaster(mesh);
    root.position.setAll(0); root.rotation.setAll(0); root.rotationQuaternion = null; root.scaling.setAll(1);
    root.parent = this.root;
    for (const mesh of meshes) {
      mesh.parent = root; mesh.receiveShadows = true;
      mesh.metadata = { ...mesh.metadata, canonicalSettlement: patch.id };
      if (mesh.metadata.settlementCastsShadow) this.lighting.addCaster(mesh);
      // Ray picking otherwise intersects the unplaced prototype instead of
      // these actual batched pillars/walls. Retain the existing five lens rays.
      if (mesh.thinInstanceCount > 0) mesh.thinInstanceEnablePicking = true;
      mesh.computeWorldMatrix(true);
    }
    // FocusedAssets' disposer captured its pre-bend nodes. Releasing the owned
    // root must also unregister replacements and any decorated thin batches.
    root.onDisposeObservable.addOnce(() => { for (const mesh of meshes) this.lighting.removeCaster(mesh); });
    return meshes;
  }

  private drawGround(terrain: FocusedTerrain, patch: SettlementPatch) {
    const root = new TransformNode('settlement-ground-root', this.ctx.scene);
    const mesh = new Mesh(terrain.id, this.ctx.scene), data = new VertexData(), normals: number[] = [];
    data.positions = [...terrain.positions]; data.indices = [...terrain.indices];
    VertexData.ComputeNormals(data.positions, data.indices, normals, { useRightHandedSystem: true });
    data.normals = normals;
    // Match the planar focused terrain's authored coverage. ForestGround reads
    // vertex alpha as soil/grass coverage, not transparency.
    data.colors = terrain.positions.flatMap((_p, i) => i % 3 === 0 ? [1, 1, 1, .7] : []);
    data.uvs = terrain.positions.flatMap((p, i) => i % 3 === 0 ? [p * .25, terrain.positions[i + 2] * .25] : []);
    data.applyToMesh(mesh); mesh.hasVertexAlpha = false; mesh.parent = root; mesh.material = this.assets.forestFloorMaterial();
    mesh.sideOrientation = Material.CounterClockWiseSideOrientation; this.bend(root, patch); this.ground = mesh;
  }

  update(planet: PlanetDescriptor | null, observer: V3, origin: V3, dt: number, enabled: boolean) {
    if (this.disposed) return;
    this.enabled = enabled && !!this.projection && !!planet;
    this.root.setEnabled(this.enabled);
    if (!this.enabled || !this.projection || !this.spec || !planet) return;
    this.root.position.set(planet.center.x - origin.x, planet.center.y - origin.y, planet.center.z - origin.z);
    const local = vector(observer).subtract(vector(planet.center));
    this.updateAge += dt;
    if (this.updateAge >= .5) {
      this.updateAge = 0;
      for (const patch of this.projection.patches) {
        const renderer = this.renderers.get(patch.realm)!;
        const centre = vector(patch.chart.anchor).scale(this.spec.radius + 6);
        const near = Vector3.Distance(local, centre) < 1400;
        const chunks = near ? this.projection.chunks.filter(c => c.realm === patch.realm).map(c => ({ key: c.chunk.id, lod: 0, chunk: c.chunk })) : [];
        // Bent children remain owned by each chunk root and are disposed on unload.
        renderer.reconcile(chunks.map(c => c.key), chunks);
        for (const id of this.bentChunks) if (!this.renderersHas(id)) this.bentChunks.delete(id);
      }
      const brass = this.projection.patches.find(p => p.realm === 'brass');
      const near = brass && Vector3.Distance(local, vector(brass.chart.anchor).scale(this.spec.radius + 6)) < 1000;
      const planar = near ? planetToRealm(this.spec, brass!.chart, local) : null;
      this.desired = new Map((this.projection.focused?.placements ?? [])
        .filter(p => planar && Math.hypot(p.position[0] - planar.x, p.position[2] - planar.z, p.position[1] - planar.y) < (p.id.includes(':tower:') ? 600 : 300))
        .sort((a, b) => Math.hypot(a.position[0] - planar!.x, a.position[2] - planar!.z) - Math.hypot(b.position[0] - planar!.x, b.position[2] - planar!.z))
        .slice(0, 64).map(p => [p.id, p]));
      for (const [id, item] of this.active) if (!this.desired.has(id)) { item.dispose(); this.active.delete(id); }
    }
    // Only one city chunk is built/bent per frame across both realms.
    for (const patch of this.projection.patches) {
      const renderer = this.renderers.get(patch.realm)!;
      if (!renderer.pending) continue;
      renderer.upload();
      for (const [id, chunk] of renderer.loaded) if (!this.bentChunks.has(id)) {
        for (const door of chunk.doors) for (const mesh of [door.mesh, ...door.mesh.getChildMeshes()])
          mesh.metadata = { ...mesh.metadata, settlementDoorIndex: door.index };
        const lamps = chunk.lights.map(light => ({ light, at: bendPoint(this.spec!, patch.chart, light.getAbsolutePosition().add(new Vector3(renderer.origin.x, 0, renderer.origin.z))) }));
        chunk.root.position.set(renderer.origin.x, 0, renderer.origin.z);
        chunk.meshes = this.bend(chunk.root, patch);
        for (const { light, at } of lamps) { light.parent = this.root; light.position.copyFrom(at); light.includedOnlyMeshes = chunk.meshes; }
        this.bentChunks.add(id); this.applyDoors();
      }
      break;
    }
    this.pump();
  }

  private renderersHas(id: string) { return [...this.renderers.values()].some(r => r.loaded.has(id)); }
  private pump() {
    if (this.disposed || !this.enabled) return;
    const patch = this.projection!.patches.find(p => p.realm === 'brass');
    if (!patch) return;
    for (const p of this.desired.values()) {
      if (this.pending.size >= 2) break;
      if (this.active.has(p.id) || this.pending.has(p.id) || this.failed.has(p.id)) continue;
      this.pending.add(p.id); this.manifest ??= this.assets.loadManifest();
      void this.manifest.then(() => this.assets.instantiate(p)).then(instance => {
        if (this.disposed || !this.desired.has(p.id)) { instance.dispose(); return; }
        this.bend(instance.root, patch);
        this.active.set(p.id, instance);
      }).catch(error => {
        if (!this.disposed) { this.failed.add(p.id); if (this.errors.length < 12) this.errors.push(String(error?.message ?? error).slice(0, 240)); }
      }).finally(() => { this.pending.delete(p.id); this.pump(); });
    }
  }

  /** Mask only the procedural underlay beneath the exact received ground.
   * Actual feet/support remain exclusively the canonical host's responsibility. */
  groundHeight(planet: PlanetDescriptor, direction: V3): number | null {
    if (!this.enabled || !this.projection || !this.spec || planet.seed !== this.spec.seed || planet.index !== 0) return null;
    for (const patch of this.projection.patches) {
      if (Vector3.Dot(vector(direction), vector(patch.chart.anchor)) < .7) continue;
      const p = planetToRealm(this.spec, patch.chart, vector(direction).scale(this.spec.radius + 6));
      if (!inside(p, patch.bounds)) continue;
      const terrain = patch.realm === 'brass' ? this.projection.terrain : null;
      if (terrain && inside(p, terrain.bounds)) {
        const width = Math.round((terrain.bounds.x1 - terrain.bounds.x0) / 2) + 1;
        const depth = Math.round((terrain.bounds.z1 - terrain.bounds.z0) / 2) + 1;
        const x = Math.max(0, Math.min(width - 2, Math.floor((p.x - terrain.bounds.x0) / 2)));
        const z = Math.max(0, Math.min(depth - 2, Math.floor((p.z - terrain.bounds.z0) / 2)));
        const heights = [z * width + x, z * width + x + 1, (z + 1) * width + x, (z + 1) * width + x + 1].map(i => terrain.positions[i * 3 + 1]);
        return 6 + Math.min(...heights) - patch.chart.floorY - .35;
      }
      return 6 - .35;
    }
    return null;
  }

  /** Camera-only lens footprint. Never used for character locomotion. */
  constrainCamera(pivot: Vector3, eye: Vector3): Vector3 {
    if (!this.enabled) return eye;
    return settlementCameraClearance(this.ctx.scene, pivot, eye);
  }

  stats() { return { revision: this.revision, enabled: this.enabled, chunks: this.bentChunks.size,
    focused: this.active.size, pending: this.pending.size, terrain: !!this.ground, errors: [...this.errors] }; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.desired.clear();
    for (const item of this.active.values()) item.dispose(); this.active.clear();
    for (const renderer of this.renderers.values()) renderer.dispose(); this.renderers.clear();
    this.assets.dispose(); this.root.dispose(); this.bentChunks.clear();
    for (const mesh of [...this.casters]) this.lighting.removeCaster(mesh);
  }
}
