import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import type { RenderContext } from '../render/engine';
import { MaterialLibrary } from '../render/materials';
import type { DynamicsProjection, PresentationPayload, RegionProjection, Vec3 } from '../net/messages';
import type { Atmosphere } from './atmosphere';
import { PropLibrary, RegionDynamics } from './dynamicWorld';
import { LightPool } from './lights';
import { buildStaticProps, type DoorHandle } from './props';
import { blocksCamera, buildStructuresSteps, decodeStructure, type Cells, type WorldLight } from './structures';
import { buildTerrain, type TerrainBuild } from './terrain';
import { needsCutaway } from './cutaway';
import { noteSlow } from '../game/probe';
import { InstanceSet, VegetationLibrary, scatterVegetation } from './vegetation';
import { WindowLighting } from './windowLighting';

/**
 * Owns every resident region's scene content and the floating origin.
 *
 * Simulation coordinates go up to 24 km; single-precision vertex maths visibly shakes beyond a few
 * kilometres, so every scene object is placed at (simulation position - origin) and the server
 * moves the origin (`regions_state.origin`) as the player travels. Region content is built once
 * in region-local coordinates under one root node, so rebasing is a single position update per
 * region, and unloading a region disposes everything it owns (nothing leaks across a long walk).
 */
interface RegionEntry {
  id: string; projection: RegionProjection; root: TransformNode; terrain: TerrainBuild; meshes: Mesh[]; instances: InstanceSet; lightIds: string[];
  doors: DoorHandle[]; dynamics: RegionDynamics; windows: WindowLighting; cells: Cells | null; pathCells: Set<number>; boxes: { x0: number; z0: number; x1: number; z1: number }[]; stats: { cells: number; roofs: number; windows: number; trees: number; props: number; buildMs: number; stageMs?: Record<string, number> };
}

export class RegionManager {
  readonly mats: MaterialLibrary;
  readonly lights: LightPool;
  readonly vegetation: VegetationLibrary;
  readonly props: PropLibrary;
  readonly regions = new Map<string, RegionEntry>();
  readonly origin = { x: 0, y: 0, z: 0 };
  regionSize = 256;
  onOriginChange: (() => void) | null = null;
  private lastDynamics: DynamicsProjection | null = null;
  worldTime = 0;
  weather = { kind: 'clear', intensity: 0, wind: 0 };

  constructor(private readonly ctx: RenderContext, private readonly atmosphere: Atmosphere) {
    this.mats = new MaterialLibrary(ctx.scene);
    this.lights = new LightPool(ctx.scene, ctx.quality.maxLights);
    this.vegetation = new VegetationLibrary(ctx.scene, this.mats);
    this.props = new PropLibrary(ctx.scene, this.mats);
  }

  /** Where a simulation position is drawn. */
  toRender(p: Vec3, out = new Vector3()): Vector3 { return out.set(p.x - this.origin.x, p.y - this.origin.y, p.z - this.origin.z); }
  regionOf(x: number, z: number): string { return `${Math.floor(x / this.regionSize)},${Math.floor(z / this.regionSize)}`; }

  setOrigin(o: Vec3): void {
    this.origin.x = o.x; this.origin.y = o.y ?? 0; this.origin.z = o.z; this.onOriginChange?.();
    for (const r of this.regions.values()) this.place(r);
  }
  private place(r: RegionEntry): void { r.root.position.set(r.projection.bounds.x0 - this.origin.x, -this.origin.y, r.projection.bounds.z0 - this.origin.z); }

  /** Height of the drawn ground at a simulation position, or null if that region is not resident. */
  groundAt(x: number, z: number): number | null {
    const r = this.regions.get(this.regionOf(x, z)); return r ? r.terrain.heightAt(x, z) : null;
  }

  /** The named place around a simulation position: a building type, a settlement, or open country. */
  placeAt(x: number, y: number, z: number): { kind: 'building' | 'settlement' | 'wild'; type: string; id: string } {
    const reg = this.regions.get(this.regionOf(x, z)); if (!reg) return { kind: 'wild', type: 'open country', id: '' };
    for (const p of reg.projection.places) { const b = p.bounds; if (x >= b.x0 && x <= b.x1 + 1 && z >= b.z0 && z <= b.z1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1) return { kind: 'building', type: p.type, id: p.id }; }
    for (const s of reg.projection.settlements) { const b = s.bounds; if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return { kind: 'settlement', type: 'settlement', id: s.id }; }
    return { kind: 'wild', type: 'open country', id: '' };
  }

  /** Open grass at a simulation position (for the grass field), with the drawn ground height; null on paths, water, structures, buildings or other ground. */
  grassAt(x: number, z: number): { y: number; height: number } | null {
    const reg = this.regions.get(this.regionOf(x, z)); if (!reg) return null;
    const g = reg.terrain.grid, i = Math.max(0, Math.min(g.n - 1, Math.round((x - g.x0) / g.stride))), j = Math.max(0, Math.min(g.n - 1, Math.round((z - g.z0) / g.stride))), k = i * g.n + j;
    if (g.block[k] !== 1 || g.water[k] >= 0) return null;
    const fx = Math.floor(x), fz = Math.floor(z);
    if (reg.pathCells.has(fx * 100003 + fz)) return null;
    for (const b of reg.boxes) if (fx >= b.x0 - 1 && fx <= b.x1 + 1 && fz >= b.z0 - 1 && fz <= b.z1 + 1) return null;
    const y = reg.terrain.heightAt(x, z);
    if (reg.cells && reg.cells.get(fx, Math.floor(y) + 1, fz) !== 0) return null;
    return { y, height: 1 - 0.5 * Math.max(0, Math.min(1, (g.forest[k] - 0.5) * 2)) };
  }

  /** The ground block id drawn at a simulation position (for footstep sound), or null. */
  blockAt(x: number, z: number): number | null {
    const reg = this.regions.get(this.regionOf(x, z)); if (!reg) return null; const g = reg.terrain.grid;
    const i = Math.max(0, Math.min(g.n - 1, Math.round((x - g.x0) / g.stride))), j = Math.max(0, Math.min(g.n - 1, Math.round((z - g.z0) / g.stride))); return g.block[i * g.n + j];
  }
  /** Number of lit fires within 14 m (crackle level). */
  fireCountNear(x: number, z: number): number {
    let n = 0; const d = this.lastDynamics; if (!d) return 0; for (const f of d.fires) if (f.lit && Math.hypot(f.pos.x - x, f.pos.z - z) < 14) n++; return n;
  }

  /** Whether built structure occupies the simulation-space point (used by the camera). */
  /** True when a simulation-space point lies inside a tree trunk, bush or rock (camera collision). */
  plantAt(x: number, y: number, z: number): boolean {
    const r = this.regions.get(this.regionOf(x, z)); if (!r) return false;
    return r.instances.obstructs(x - r.projection.bounds.x0, y, z - r.projection.bounds.z0);
  }
  /** Camera collision agrees with the elevated view's clipped upper building geometry. */
  cameraStructureAt(x: number, y: number, z: number, player: Vec3 | null): boolean {
    if (player && y > player.y + .8) {
      const region = this.regions.get(this.regionOf(x, z));
      for (const place of region?.projection.places ?? []) {
        const b = place.bounds;
        if (place.indoor && x >= b.x0 - 1 && x <= b.x1 + 2 && z >= b.z0 - 1 && z <= b.z1 + 2 && y >= b.y0 && y <= b.y1 + 2 && needsCutaway(b, player, { x, y, z })) return false;
      }
    }
    return this.structureAt(x, y, z);
  }

  structureAt(x: number, y: number, z: number): boolean {
    const r = this.regions.get(this.regionOf(x, z)); if (!r?.cells) return false;
    const b = r.cells.get(Math.floor(x), Math.floor(y), Math.floor(z)); return b !== 0 && blocksCamera(b);
  }

  /**
   * Queue a presentation chunk. Building a region is hundreds of milliseconds of geometry work, so it is
   * cut into stages that `pump` runs inside a per-frame time budget: the player keeps a steady frame
   * rate while the land streams in. `done` runs once every region in the chunk is built and registered.
   */
  applyPresentation(payload: PresentationPayload, done?: () => void): void {
    for (const proj of payload.regions) this.dropped.delete(proj.id);
    this.jobs.push(this.presentationJob(payload, done));
  }
  /** Regions still being built or queued (the loading screen and the ack wait for these). */
  get pendingBuilds(): number { return this.jobs.length; }
  /** Advance queued builds until `budgetMs` of this frame is spent (always at least one stage). */
  pump(budgetMs: number): void {
    const t0 = performance.now();
    while (this.jobs.length) {
      const s0 = performance.now();
      let done = false;
      try { done = !!this.jobs[0].next().done; }
      catch (e) { done = true; console.error('region build failed; skipping it', e); }   // one bad region must not wedge the stream (the transfer's ack times out on its own)
      noteSlow(this.stepLabel, performance.now() - s0, 6);
      if (done) this.jobs.shift();
      if (performance.now() - t0 >= budgetMs) break;
    }
  }
  private stepLabel = 'region';
  private readonly jobs: Generator<void, void, void>[] = [];
  private readonly dropped = new Set<string>();
  private *presentationJob(payload: PresentationPayload, done?: () => void): Generator<void, void, void> {
    for (const proj of payload.regions) {
      yield* this.buildSteps(proj);
      if (this.dropped.delete(proj.id)) this.disposeRegion(proj.id); // the server unloaded it while it was still being built
    }
    if (payload.dynamic) this.applyDynamics(payload.dynamic);
    done?.();
  }

  private *buildSteps(proj: RegionProjection): Generator<void, void, void> {
    const t0 = performance.now();
    const stageMs: Record<string, number> = {}; let ts = t0;
    const stage = (name: string) => { const n = performance.now(); stageMs[name] = +(n - ts).toFixed(1); ts = n; this.stepLabel = `region ${proj.id} after ${name}`; };
    const scene = this.ctx.scene, root = new TransformNode(`region-${proj.id}`, scene);
    const terrain = buildTerrain(scene, this.mats, proj); terrain.mesh.parent = root; if (terrain.water) terrain.water.parent = root;
    const meshes: Mesh[] = [terrain.mesh]; if (terrain.water) meshes.push(terrain.water);
    const lightList: WorldLight[] = [];
    stage('terrain'); yield;

    const stSteps = buildStructuresSteps(scene, this.mats, proj); let stStep = stSteps.next();
    while (!stStep.done) { yield; stStep = stSteps.next(); }
    const st = stStep.value;
    for (const m of st.meshes) { m.parent = root; meshes.push(m); if (m.name.startsWith('walls') || m.name.startsWith('roof') || m.name.includes('struct')) this.atmosphere.addCaster(m); }
    lightList.push(...st.lights);
    stage('structures'); yield;

    const cells = proj.structures?.runs.length ? decodeStructure(proj.structures.runs, proj.bounds.x0, proj.bounds.z0) : null;
    const sp = buildStaticProps(scene, this.mats, proj, cells, root, terrain.heightAt);
    for (const m of sp.meshes) { meshes.push(m); if (!m.name.startsWith('path')) this.atmosphere.addCaster(m); }
    lightList.push(...sp.lights);
    stage('props'); yield;

    // Trees and rocks: canonical resources come from dynamics, decoration fills between them.
    const instances = new InstanceSet();
    const naturalTrees = proj.structures?.trees ?? [];
    for (const t of naturalTrees) {
      // Reuse distance culling, LOD, shadows and region disposal for canonical grid trees.
      instances.add(this.vegetation, t.species, t.variant,
        new Vector3(t.x - proj.bounds.x0 + .5, terrain.heightAt(t.x + .5, t.z + .5) - .1, t.z - proj.bounds.z0 + .5),
        t.yaw, Math.max(.7, Math.min(1.25, t.height / (t.species === 'pine' ? 8 : 5))));
    }
    const density = this.ctx.quality.treeDensity;
    const trees = scatterVegetation(this.vegetation, instances, {
      region: proj, terrain, density, canonical: this.lastDynamics?.resources.filter(r => this.regionOf(r.pos.x, r.pos.z) === proj.id) ?? [],
      exclusions: [...proj.dressingExclusions.map(e => e.bounds), ...proj.places.map(p => p.bounds),
        ...naturalTrees.map(t => ({ x0: t.x, x1: t.x, z0: t.z, z1: t.z }))],
    }, proj.decoration.seed);
    stage('scatter'); yield;
    for (const _ of instances.finishSteps(this.vegetation, root, `veg-${proj.id}`, m => this.atmosphere.addCaster(m))) yield;
    stage('instances');

    this.disposeRegion(proj.id); // replace any earlier build of this region in one step, after the new one is ready

    const lightIds: string[] = [];
    lightList.forEach((l, i) => {
      const id = `${proj.id}:l${i}`; lightIds.push(id);
      this.lights.add({ id, root, x: l.x, y: l.y, z: l.z, color: l.color, intensity: l.intensity, range: l.range, flicker: l.kind === 'torch' ? 1 : 0.3, enabled: true });
    });

    const dynamics = new RegionDynamics(scene, this.mats, this.props, this.vegetation, proj, terrain, this.lights, sp.doors, root, m => this.atmosphere.addCaster(m));
    const windows = new WindowLighting(scene, proj, cells, st.panes, this.lights, root);
    const entry: RegionEntry = {
      id: proj.id, projection: proj, root, terrain, meshes, instances, lightIds, doors: sp.doors, dynamics, windows, cells, pathCells: new Set(proj.paths.map(([x, , z]) => x * 100003 + z)), boxes: proj.places.filter(p => p.indoor).map(p => p.bounds),
      stats: { cells: st.stats.cells, roofs: st.stats.roofsAnalytic, windows: st.stats.windows, trees: trees + naturalTrees.length, props: proj.furnishings.length, buildMs: performance.now() - t0, stageMs },
    };
    this.regions.set(proj.id, entry); this.place(entry);
    for (const m of meshes) { m.freezeWorldMatrix?.(); m.unfreezeWorldMatrix(); }
    if (this.lastDynamics) { dynamics.apply(this.subset(this.lastDynamics, proj.id)); windows.apply(this.lastDynamics.fires); }
    this.lastVeg.x = 1e9;
  }

  private subset(d: DynamicsProjection, id: string): DynamicsProjection {
    const inRegion = (p: Vec3) => this.regionOf(p.x, p.z) === id;
    return {
      ...d, resources: d.resources.filter(r => inRegion(r.pos)), items: d.items.filter(i => inRegion(i.pos)), containers: d.containers.filter(c => inRegion(c.pos)),
      crops: d.crops.filter(c => inRegion(c.pos)), mechanisms: d.mechanisms.filter(m => inRegion(m.pos)), construction: d.construction.filter(c => inRegion(c.pos)),
      fires: d.fires.filter(f => inRegion(f.pos)), doors: d.doors.filter(x => inRegion(x.pos)),
    };
  }

  applyDynamics(d: DynamicsProjection): void {
    this.lastDynamics = d; this.worldTime = d.worldTime; this.weather = { kind: d.environment.kind, intensity: d.environment.intensity, wind: d.environment.wind };
    for (const r of this.regions.values()) { r.dynamics.apply(this.subset(d, r.id)); r.windows.apply(d.fires); }
  }

  /** The server no longer wants this region: drop it now, or as soon as an in-flight build of it finishes. */
  unload(id: string): void {
    if (this.jobs.length) this.dropped.add(id);
    this.disposeRegion(id);
  }
  private disposeRegion(id: string): void {
    const r = this.regions.get(id); if (!r) return;
    for (const lid of r.lightIds) this.lights.remove(lid);
    r.windows.dispose(); r.dynamics.dispose(); r.instances.dispose();
    for (const m of r.meshes) { this.atmosphere.removeCaster(m); if (m.metadata?.ownsCutawayMaterial) m.material?.dispose(false, false); m.dispose(false, false); }
    r.root.dispose(false, false); this.regions.delete(id);
  }

  private vegClock = 0; private lastVeg = { x: 1e9, z: 1e9, fx: 0, fz: 0 };
  /** Re-classify vegetation only when the camera has moved or turned enough to matter. */
  private refreshVegetation(cam: Vector3, fwd: Vector3, dt: number, force = false): void {
    this.vegClock += dt;
    const l = this.lastVeg, moved = Math.hypot(cam.x - l.x, cam.z - l.z), fl = Math.hypot(fwd.x, fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl;
    if (!force && moved < 5 && fx * l.fx + fz * l.fz > 0.985 && this.vegClock < 1.5) return;
    this.vegClock = 0; l.x = cam.x; l.z = cam.z; l.fx = fx; l.fz = fz;
    for (const r of this.regions.values()) r.instances.refresh(r.root.position.x, r.root.position.z, cam.x, cam.z, fx, fz, this.ctx.quality.vegetationNear, this.ctx.quality.vegetationFar);
  }
  updateCutaway(player: Vec3 | null, camera: Vector3): void {
    const worldCamera = { x: camera.x + this.origin.x, y: camera.y + this.origin.y, z: camera.z + this.origin.z };
    for (const region of this.regions.values()) for (const mesh of [...region.meshes,...region.windows.meshes]) {
      const bounds = mesh.metadata?.cutawayBounds, plane = mesh.material?.clipPlane;
      if (bounds && plane) plane.d = player && needsCutaway(bounds, player, worldCamera) ? -(player.y - this.origin.y + .8) : -1e8;
    }
  }
  update(dt: number, cameraPos: Vector3, cameraForward: Vector3, night: number): void {
    this.mats.updateWeather(this.weather.kind, this.weather.intensity, dt);
    for (const r of this.regions.values()) { r.dynamics.update(dt); r.windows.update(night); }
    this.refreshVegetation(cameraPos, cameraForward, dt);
    this.lights.update(dt, cameraPos, night);
  }
  dispose(): void { for (const id of [...this.regions.keys()]) this.unload(id); this.lights.dispose(); this.vegetation.dispose(); this.props.dispose(); }
}
