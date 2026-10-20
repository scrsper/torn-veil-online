import { InstancedMesh, Matrix, Mesh, Quaternion, TransformNode, Vector3, type AbstractMesh, type AssetContainer, type InstantiatedEntries, type Material, type Scene } from '@babylonjs/core';
import type { AtlasAsset, AtlasVector } from '../../sim/world/atlas/types';
import { tangentFrame } from '../../sim/world/planet/planet';
import { prepareAtlasFade } from './fade';
import { loadVerifiedAtlasAsset, type AtlasLoader } from './verified';

export interface AtlasRenderPlacement {
  id: string;
  assetId: string;
  /** Native GLB origin, already corrected for the cooked groundOffset. */
  position: AtlasVector;
  up: AtlasVector;
  yaw: number;
  scale: number;
}
export interface AtlasStreamBudgets {
  models: number;
  bytes: number;
  triangles: number;
  instances: number;
  instanceTriangles: number;
  meshInstances: number;
  range: number;
}
export const ATLAS_STREAM_BUDGETS: Readonly<AtlasStreamBudgets> = Object.freeze({
  models: 28, bytes: 64 * 1024 * 1024, triangles: 1_200_000,
  instances: 80, instanceTriangles: 1_800_000, meshInstances: 640, range: 256,
});
interface CachedModel { asset: AtlasAsset; container: AssetContainer; triangles: number; meshes: number; used: number }
interface LivePlacement {
  placement: AtlasRenderPlacement; root: TransformNode; entries: InstantiatedEntries;
  meshes: AbstractMesh[]; fade: number; wanted: boolean; asset: AtlasAsset;
}
interface PendingModel { asset: AtlasAsset; controller: AbortController; promise: Promise<void> }
export interface AtlasStreamOptions {
  asset: (id: string) => AtlasAsset | undefined;
  lite?: boolean;
  budgets?: Partial<AtlasStreamBudgets>;
  loader?: AtlasLoader;
  shadows?: { addCaster(mesh: AbstractMesh): void; removeCaster(mesh: AbstractMesh): void };
}
const distance = (a: AtlasVector, b: AtlasVector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copy = (p: AtlasVector) => ({ x: p.x, y: p.y, z: p.z });
const vector = (p: AtlasVector) => new Vector3(p.x, p.y, p.z);

/** Local +X east, +Y outward, +Z south, then native +Y yaw. This is a
 * right-handed frame, so asymmetric GLBs keep their original handedness. */
export function atlasRotation(up: AtlasVector, yaw: number): Quaternion {
  const f = tangentFrame(up), c = Math.cos(yaw), s = Math.sin(yaw);
  const x = vector(f.east).scale(c).add(vector(f.north).scale(s));
  const z = vector(f.east).scale(s).subtract(vector(f.north).scale(c));
  const matrix = Matrix.Identity();
  Matrix.FromXYZAxesToRef(x, vector(f.up), z, matrix);
  return Quaternion.FromRotationMatrix(matrix);
}

/** Bounded presentation of immutable placement data. Missing models remain
 * missing visually; collision and placement never depend on fetch completion. */
export class AtlasWorldRenderer {
  readonly budgets: Readonly<AtlasStreamBudgets>;
  private cache = new Map<string, CachedModel>();
  private pending = new Map<string, PendingModel>();
  private instances = new Map<string, LivePlacement>();
  private desired: AtlasRenderPlacement[] = [];
  private failures = new Map<string, string>();
  private requested = new Set<string>();
  private loaded = new Set<string>();
  private everInstanced = new Set<string>();
  private origin: AtlasVector = { x: 0, y: 0, z: 0 };
  private tick = 0;
  private disposed = false;
  private materials = new Set<Material>();
  private rejectedBudget = 0;
  private peakPending = 0;

  constructor(private scene: Scene, private options: AtlasStreamOptions) {
    this.budgets = Object.freeze({ ...ATLAS_STREAM_BUDGETS,
      ...(options.lite ? { models: 16, bytes: 32 * 1024 * 1024, triangles: 600_000,
        instances: 40, instanceTriangles: 850_000, meshInstances: 320, range: 192 } : {}),
      ...options.budgets });
  }

  update(placements: readonly AtlasRenderPlacement[], observer: AtlasVector, origin: AtlasVector, dt = 1 / 60) {
    if (this.disposed) return;
    this.tick++;
    this.origin = copy(origin);
    let triangles = 0, meshInstances = 0;
    const seen = new Set<string>();
    this.desired = [];
    const ordered = placements.map(placement => ({ placement, distance: distance(placement.position, observer) }))
      .filter(item => Number.isFinite(item.distance) && item.distance <= this.budgets.range + (this.instances.has(item.placement.id) ? 24 : 0))
      .sort((a, b) => a.distance - b.distance || a.placement.id.localeCompare(b.placement.id));
    for (const { placement } of ordered) {
      if (seen.has(placement.id)) continue;
      seen.add(placement.id);
      const asset = this.options.asset(placement.assetId);
      if (!asset?.eligible || asset.role === 'mob-draft' || this.failures.has(asset.id)) continue;
      const nodes = Math.max(1, asset.primitiveCount), tris = asset.triangleCount;
      if (this.desired.length >= this.budgets.instances || triangles + tris > this.budgets.instanceTriangles
        || meshInstances + nodes > this.budgets.meshInstances) continue;
      if (asset.byteLength > this.budgets.bytes || tris > this.budgets.triangles) { this.rejectedBudget++; continue; }
      if (!Number.isFinite(placement.scale) || placement.scale <= 0 || !Number.isFinite(placement.yaw)
        || ![placement.up.x, placement.up.y, placement.up.z].every(Number.isFinite)
        || Math.hypot(placement.up.x, placement.up.y, placement.up.z) < .0001) continue;
      this.desired.push(placement); triangles += tris; meshInstances += nodes;
    }
    const wanted = new Set(this.desired.map(p => p.id));
    for (const [id, instance] of this.instances) {
      instance.wanted = wanted.has(id);
      instance.fade = Math.max(0, Math.min(1, instance.fade + (instance.wanted ? 1 : -1) * Math.min(.1, Math.max(0, dt)) / .35));
      if (!instance.wanted && instance.fade === 0) { this.release(id); continue; }
      instance.root.position.set(instance.placement.position.x - origin.x, instance.placement.position.y - origin.y, instance.placement.position.z - origin.z);
      for (const mesh of instance.meshes) if (mesh instanceof InstancedMesh && mesh.instancedBuffers) mesh.instancedBuffers.atlasFade = instance.fade;
    }
    // Instantiation can be expensive for authored node hierarchies; spread it over frames.
    let uploads = 0;
    for (const placement of this.desired) {
      const existing = this.instances.get(placement.id);
      if (existing) { existing.placement = placement; this.cache.get(placement.assetId)!.used = this.tick; continue; }
      const model = this.cache.get(placement.assetId);
      if (model && uploads < 2 && this.roomForInstance(model)) { this.instantiate(placement, model); uploads++; }
    }
    this.pump();
  }

  private roomForInstance(model: CachedModel): boolean {
    let triangles = model.triangles, meshes = model.meshes;
    for (const instance of this.instances.values()) {
      const cached = this.cache.get(instance.asset.id)!; triangles += cached.triangles; meshes += cached.meshes;
    }
    return this.instances.size < this.budgets.instances && triangles <= this.budgets.instanceTriangles && meshes <= this.budgets.meshInstances;
  }

  private instantiate(placement: AtlasRenderPlacement, model: CachedModel) {
    const root = new TransformNode(`atlas:${placement.id}`, this.scene);
    const entries = model.container.instantiateModelsToScene(name => `${placement.id}:${name}`, false);
    for (const node of entries.rootNodes) node.parent = root;
    for (const group of entries.animationGroups) group.stop();
    root.position.set(placement.position.x - this.origin.x, placement.position.y - this.origin.y, placement.position.z - this.origin.z);
    root.rotationQuaternion = atlasRotation(placement.up, placement.yaw);
    root.scaling.setAll(placement.scale);
    root.metadata = { atlasPlacementId: placement.id, atlasAssetId: placement.assetId, contentHash: model.asset.contentHash };
    const meshes = root.getChildMeshes();
    for (const mesh of meshes) {
      mesh.isPickable = false; mesh.checkCollisions = false; mesh.receiveShadows = true;
      this.options.shadows?.addCaster(mesh);
      if (mesh instanceof InstancedMesh && mesh.instancedBuffers) mesh.instancedBuffers.atlasFade = 0;
    }
    this.instances.set(placement.id, { placement, root, entries, meshes, fade: 0, wanted: true, asset: model.asset });
    model.used = this.tick; this.everInstanced.add(model.asset.id);
  }

  private release(id: string) {
    const instance = this.instances.get(id);
    if (!instance) return;
    for (const mesh of instance.meshes) this.options.shadows?.removeCaster(mesh);
    instance.entries.dispose(); instance.root.dispose(); this.instances.delete(id);
  }

  private costs() {
    let bytes = 0, triangles = 0;
    for (const model of this.cache.values()) { bytes += model.asset.byteLength; triangles += model.triangles; }
    for (const model of this.pending.values()) { bytes += model.asset.byteLength; triangles += model.asset.triangleCount; }
    return { bytes, triangles, models: this.cache.size + this.pending.size };
  }

  private reserve(asset: AtlasAsset): boolean {
    const fits = () => {
      const costs = this.costs();
      return costs.models < this.budgets.models && costs.bytes + asset.byteLength <= this.budgets.bytes
        && costs.triangles + asset.triangleCount <= this.budgets.triangles;
    };
    if (fits()) return true;
    const active = new Set([...this.instances.values()].map(p => p.asset.id));
    const desired = new Set(this.desired.map(p => p.assetId));
    const candidates = [...this.cache.entries()].filter(([id]) => !active.has(id) && !desired.has(id))
      .sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]));
    for (const [id, model] of candidates) {
      for (const material of model.container.materials) this.materials.delete(material);
      model.container.dispose(); this.cache.delete(id);
      if (fits()) return true;
    }
    return false;
  }

  private pump() {
    if (this.disposed) return;
    const wanted = new Set(this.desired.map(p => p.assetId));
    for (const [id, pending] of this.pending) if (!wanted.has(id)) pending.controller.abort();
    for (const placement of this.desired) {
      if (this.pending.size >= 2) break;
      const id = placement.assetId;
      if (this.cache.has(id) || this.pending.has(id) || this.failures.has(id)) continue;
      const asset = this.options.asset(id)!;
      if (!this.reserve(asset)) continue;
      const controller = new AbortController();
      const pending: PendingModel = { asset, controller, promise: Promise.resolve() };
      this.pending.set(id, pending); this.requested.add(id);
      this.peakPending = Math.max(this.peakPending, this.pending.size);
      pending.promise = loadVerifiedAtlasAsset(asset, this.scene, controller.signal, this.options.loader).then(container => {
        if (this.disposed || controller.signal.aborted) { container.dispose(); return; }
        const geometry = container.meshes.filter(mesh => mesh.getTotalVertices() > 0);
        const triangles = geometry.reduce((sum, mesh) => sum + Math.floor(mesh.getTotalIndices() / 3), 0);
        if (triangles > asset.triangleCount || geometry.length > Math.max(asset.primitiveCount, asset.meshCount)) {
          container.dispose(); throw Error('Atlas geometry exceeds its cooked cost');
        }
        for (const mesh of geometry) { mesh.isPickable = false; if (mesh instanceof Mesh) prepareAtlasFade(mesh, this.materials); }
        this.cache.set(id, { asset, container, triangles, meshes: geometry.length, used: this.tick });
        this.loaded.add(id);
      }).catch(error => {
        if (!this.disposed && !controller.signal.aborted) this.failures.set(id, String(error?.message ?? error).slice(0, 240));
      }).finally(() => { this.pending.delete(id); this.pump(); });
    }
  }

  /** Bounded, read-only coverage and positional evidence; never a movement hook. */
  stats() {
    let cacheBytes = 0, cacheTriangles = 0, renderedTriangles = 0;
    for (const item of this.cache.values()) { cacheBytes += item.asset.byteLength; cacheTriangles += item.triangles; }
    for (const item of this.instances.values()) renderedTriangles += this.cache.get(item.asset.id)?.triangles ?? 0;
    const inFrustum = (p: LivePlacement) => p.wanted && p.fade > 0
      && p.meshes.some(mesh => mesh.isEnabled() && mesh.isVisible
        && (!this.scene.activeCamera || mesh.isInFrustum(this.scene.frustumPlanes)));
    return {
      requested: this.requested.size, loaded: this.loaded.size, instanced: this.everInstanced.size,
      pending: this.pending.size, peakPending: this.peakPending, cachedModels: this.cache.size,
      cacheBytes, cacheTriangles, renderedTriangles, instances: this.instances.size, budgetRejected: this.rejectedBudget,
      requestedIds: [...this.requested].sort(), loadedIds: [...this.loaded].sort(), instancedIds: [...this.everInstanced].sort(),
      residentIds: [...new Set([...this.instances.values()].map(p => p.asset.id))].sort(),
      visibilityBasis: 'camera frustum; occlusion is not measured',
      visibleIds: [...new Set([...this.instances.values()].filter(inFrustum).map(p => p.asset.id))].sort(),
      failures: [...this.failures].map(([assetId, error]) => ({ assetId, error })),
      placements: [...this.instances.values()].map(p => ({ id: p.placement.id, assetId: p.asset.id, position: copy(p.placement.position),
        up: copy(p.placement.up), yaw: p.placement.yaw, scale: p.placement.scale, visible: inFrustum(p), fade: p.fade })),
      budgets: this.budgets,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) pending.controller.abort();
    for (const id of this.instances.keys()) this.release(id);
    for (const model of this.cache.values()) model.container.dispose();
    this.cache.clear(); this.materials.clear(); this.desired = [];
  }
}
