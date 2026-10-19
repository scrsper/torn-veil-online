import { Color3, Color4, FreeCamera, HemisphericLight, Mesh, MeshBuilder, PBRMaterial, PointLight, Scene, StandardMaterial, Texture, Vector3, type AbstractEngine } from '@babylonjs/core';
import { loadScannedMaps, useScannedMaps } from '../render/materials';
import { towerFloorSpec, floorPlan, TOWER_FLOORS, type TowerFloorSpec } from '../../sim/world/interiors/floorSpec';
import { interiorVoxel, type InteriorPlan } from '../../sim/world/interiors/layout';
import { towerTheme } from '../realms/towerThemes';
import { focusedFloorPlan, type FocusedFloorPlan } from '../../sim/world/assets/focusedLayouts';
import { focusedGeometryReady, focusedGuardianStations, sceneGeometry } from '../../sim/world/assets/focusedRuntime';
import type { StaticGeometry } from '../../sim/physical/staticGeometry';
import { FocusedAssets } from '../realms/focusedAssets';
import type { Atmosphere } from '../world/atmosphere';

/** A survey of the hundred floors: each is the canonical seeded plan (walls, rooms, stair,
 * water intake, award chest, warden stations) dressed with library modules. This is a
 * preview projection in the sense of progression/tower.ts — like a preview journey it can
 * open any floor and earns nothing. Canonical climbs, combat and awards run through the
 * realms host (TowerController); nothing here writes Tower state. */
/** Scanned CC0 wall/floor surfaces per ten-floor band (Threshold … Crown), tinted by the band
 * palette as before; presentation only, so each stretch of the climb reads differently. */
const BAND_SURFACES: [string, string][] = [
  ['rock_wall_08', 'cobblestone_floor_08'], ['plastered_wall', 'cobblestone_floor_08'], ['plastered_wall', 'weathered_planks'], ['mossy_rock', 'cobblestone_floor_08'], ['plastered_wall', 'weathered_planks'],
  ['rock_wall_08', 'roof_slates_02'], ['plastered_wall', 'cobblestone_floor_08'], ['rock_wall_08', 'weathered_planks'], ['mossy_rock', 'roof_slates_02'], ['plastered_wall', 'roof_slates_02'],
];
const ARCHETYPE: Record<string, string> = { brawler: '#b06a4a', skirmisher: '#5a8a5a', guardian: '#6a7a9a', caster: '#8a5ab0', heavy: '#8a4040' };
export class TowerSurvey {
  readonly scene: Scene; readonly camera: FreeCamera; floor = 1; highest = 1; spec: TowerFloorSpec | null = null; plan: InteriorPlan | null = null;
  private meshes: Mesh[] = []; private lights: PointLight[] = []; private disposeDressing: (() => void)[] = [];
  private pos = new Vector3(); private yaw = 0; private assets: FocusedAssets; private manifest: Promise<unknown>; private message = '';
  /** Library-kit grammar (focused worlds): halls, junctions, archive/boss rooms from the verified pack. */
  kit = false; kitPlan: FocusedFloorPlan | null = null; private geometry: StaticGeometry | null = null; private kitInstances: { dispose(): void }[] = [];
  constructor(engine: AbstractEngine, readonly seed: number) {
    const s = this.scene = new Scene(engine); s.useRightHandedSystem = true; s.clearColor = new Color4(.02, .02, .03, 1);
    s.fogMode = Scene.FOGMODE_EXP2; s.autoClear = true;
    this.camera = new FreeCamera('survey-camera', new Vector3(0, 10, 0), s); this.camera.minZ = .1; this.camera.maxZ = 400; this.camera.fov = .9; this.camera.inputs.clear();
    const fill = this.fill = new HemisphericLight('survey-fill', new Vector3(0, 1, 0), s); fill.intensity = .55;
    this.player = MeshBuilder.CreateCapsule('survey-player-placeholder', { height: 1.8, radius: .35 }, s); const pm = new StandardMaterial('survey-player', s); pm.diffuseColor = new Color3(.85, .75, .55); this.player.material = pm;
    const shim = { addCaster: () => {}, removeCaster: () => {} } as unknown as Atmosphere;
    this.assets = new FocusedAssets(s, shim); this.manifest = this.assets.loadManifest().catch(() => null);
  }
  async enter(floor: number) {
    this.floor = Math.max(1, Math.min(TOWER_FLOORS, Math.floor(floor))); this.highest = Math.max(this.highest, this.floor);
    for (const m of this.meshes) m.dispose(); for (const l of this.lights) l.dispose(); for (const d of this.disposeDressing) d();
    this.meshes = []; this.lights = []; this.disposeDressing = []; for (const k of this.kitInstances) k.dispose(); this.kitInstances = []; this.kitPlan = null; this.geometry = null;
    if (this.kit) return this.enterKit();
    const spec = this.spec = towerFloorSpec(this.seed, this.floor), plan = this.plan = floorPlan(this.seed, this.floor), o = plan.origin, theme = towerTheme(this.floor, this.seed);
    const s = this.scene, mat = (name: string, hex: string, e = 0) => { const m = new StandardMaterial(name, s); m.diffuseColor = Color3.FromHexString(hex); m.specularColor = new Color3(.06, .06, .06); if (e) m.emissiveColor = m.diffuseColor.scale(e); return m; };
    // Scanned CC0 stone (walls) and cobbles (floor), tinted by the band palette.
    const scanned = (name: string, surface: string, hex: string, tile: number) => { const m = new PBRMaterial(name, s); useScannedMaps(m, this.maps(surface)); m.albedoColor = Color3.FromHexString(hex).scale(1.6); m.metallic = 0; m.roughness = .9; for (const t of [m.albedoTexture, m.bumpTexture, m.metallicTexture]) if (t instanceof Texture) { t.uScale = tile; t.vScale = tile; } this.materials.push(m); return m; };
    for (const m of this.materials) m.dispose(); this.materials = [];
    const [wallSurface, floorSurface] = BAND_SURFACES[spec.band] ?? BAND_SURFACES[0], wall = scanned('survey-wall', wallSurface, theme.wall, 1), ground = scanned('survey-floor', floorSurface, theme.floor, plan.half / 2), metal = mat('survey-metal', theme.metal, .25), gold = mat('survey-stair', '#e0be74', .7), blue = mat('survey-return', '#82d5e5', .6), water = mat('survey-water', '#3a6a8a', .2);
    const floorMesh = MeshBuilder.CreateGround('survey-ground', { width: plan.half * 2 + 2, height: plan.half * 2 + 2 }, s); floorMesh.position.set(o.x, 1, o.z); floorMesh.material = ground; this.meshes.push(floorMesh);
    for (const b of plan.solids) {
      const m = MeshBuilder.CreateBox(b.id, { width: b.w, height: b.h, depth: b.d }, s); m.position.set(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2);
      m.material = b.kind === 'bench' ? metal : wall; this.meshes.push(m);
    }
    const disc = (name: string, p: { x: number; z: number }, m: StandardMaterial, d = 2.2) => { const c = MeshBuilder.CreateCylinder(name, { diameter: d, height: .08, tessellation: 24 }, s); c.position.set(p.x, 1.04, p.z); c.material = m; this.meshes.push(c); return c; };
    disc('survey-stair', plan.exit, gold); disc('survey-entrance', plan.start, blue); disc('survey-cistern', { x: plan.start.x, z: plan.start.z + 2 }, water, 1);
    for (let k = 0; k < 4; k++) { const st = MeshBuilder.CreateBox(`survey-steps-${k}`, { width: 2.4, height: .3 * (k + 1), depth: .6 }, s); st.position.set(plan.exit.x, 1 + .15 * (k + 1), plan.exit.z - 1.4 - k * .6); st.material = metal; this.meshes.push(st); }
    const chest = MeshBuilder.CreateBox('survey-award', { width: 1.2, height: .8, depth: .8 }, s); chest.position.set(plan.exit.x + 1.4, 1.4, plan.exit.z); chest.material = metal; this.meshes.push(chest);
    // Warden stations, as createFloor finds them: rooms other than the start, spaced, away from the entrance and stair.
    const cells: { x: number; z: number }[] = [];
    for (const r of plan.rooms.filter(r => r.role !== 'start')) for (let x = r.x + 3.5; x < r.x + r.w; x += 6) for (let z = r.z + 3.5; z < r.z + r.d; z += 6) {
      if (Math.hypot(x - plan.start.x, z - plan.start.z) > 20 && Math.hypot(x - plan.exit.x, z - plan.exit.z) > 2 && interiorVoxel(plan, Math.floor(x), 1, Math.floor(z)) === 0) cells.push({ x, z });
    }
    cells.sort((a, b) => Math.hypot(b.x - plan.start.x, b.z - plan.start.z) - Math.hypot(a.x - plan.start.x, a.z - plan.start.z) || a.x - b.x || a.z - b.z);
    const count = Math.min(spec.encounter.enemies, cells.length);
    for (let n = 0; n < count; n++) {
      const c = cells[Math.floor(n * cells.length / count)], w = MeshBuilder.CreateCapsule(`survey-warden-${n}`, { height: 1.8, radius: .35 }, s);
      w.position.set(c.x, 1.9, c.z); w.material = mat(`warden-${spec.wardens[n]}`, ARCHETYPE[spec.wardens[n]] ?? '#888'); this.meshes.push(w);
    }
    // Torchlight: the band palette; a handful of point lights on wall crowns, nearest the entrance first.
    s.fogColor = new Color3(...spec.lighting.ambient).scale(.5); s.fogDensity = spec.lighting.fog;
    const crowns = spec.dressing.filter(d => d.role === 'light').slice(0, 4);
    for (const [i, d] of crowns.entries()) { const l = new PointLight(`survey-torch-${i}`, new Vector3(o.x + d.x, d.y + 1, o.z + d.z), s); l.diffuse = new Color3(...spec.lighting.torch); l.intensity = 1.1; l.range = 30; this.lights.push(l); }
    const key = new PointLight('survey-stair-light', new Vector3(plan.exit.x, 4, plan.exit.z), s); key.diffuse = new Color3(1, .85, .55); key.intensity = .9; key.range = 24; this.lights.push(key);
    // Library dressing (verified focused modules); missing modules leave the plain plan.
    void this.manifest.then(async m => {
      if (!m) return;
      for (const [i, d] of spec.dressing.entries()) {
        try { const inst = await this.assets.instantiate({ id: `${plan.id}:dress:${i}`, assetId: d.moduleId, position: [o.x + d.x, d.y, o.z + d.z], yaw: d.yaw, floorId: plan.id }); if (this.plan !== plan) { inst.dispose(); return; } this.disposeDressing.push(inst.dispose); } catch { /* keep the plain plan */ }
      }
    });
    this.pos.set(plan.start.x, 1, plan.start.z); this.yaw = 0; this.message = ''; this.overviewing = false; this.fill.intensity = .55;
    this.player.position.set(plan.start.x, 1.9, plan.start.z);
  }
  private async enterKit() {
    const spec = this.spec = towerFloorSpec(this.seed, this.floor), id = `veil:tower:survey-kit:floor:${this.floor}`, plan = this.kitPlan = focusedFloorPlan(id, this.seed, this.floor, { x: 0, z: 0 }), s = this.scene;
    this.plan = null; this.pos.set(plan.start.x, plan.start.y, plan.start.z); this.yaw = 0; this.message = ''; this.overviewing = false; this.fill.intensity = .55; this.player.position.set(plan.start.x, plan.start.y + .9, plan.start.z);
    s.fogColor = new Color3(...spec.lighting.ambient).scale(.5); s.fogDensity = spec.lighting.fog * .6;
    for (const [i, p] of [plan.start, plan.exit].entries()) {
      const ring = MeshBuilder.CreateTorus(i ? 'survey-kit-stair' : 'survey-kit-return', { diameter: 3.2, thickness: .09, tessellation: 48 }, s), m = new StandardMaterial(ring.name, s);
      m.emissiveColor = i ? new Color3(.88, .75, .45) : new Color3(.5, .84, .9); ring.material = m; ring.position.set(p.x, p.y + .06, p.z); this.meshes.push(ring);
      const l = new PointLight(`survey-kit-light-${i}`, new Vector3(p.x, p.y + 4, p.z), s); l.diffuse = new Color3(...spec.lighting.torch); l.intensity = 1.2; l.range = 40; this.lights.push(l); }
    if (await this.manifest) for (const p of plan.placements) {
      try { const inst = await this.assets.instantiate(p, { x: 0, z: 0 }); if (this.kitPlan !== plan) { inst.dispose(); return; } this.kitInstances.push(inst); } catch { /* missing module */ }
    }
    if (focusedGeometryReady() && this.kitPlan === plan) {
      this.geometry = sceneGeometry(plan);
      const stations = focusedGuardianStations(plan, this.geometry), count = Math.min(spec.encounter.enemies, stations.length);
      for (let n = 0; n < count; n++) {
        const c = stations[n], w = MeshBuilder.CreateCapsule(`survey-warden-${n}`, { height: 1.8, radius: .35 }, s), m = new StandardMaterial(`warden-${n}`, s);
        m.diffuseColor = Color3.FromHexString(ARCHETYPE[spec.wardens[n]] ?? '#888'); w.material = m; w.position.set(c.x, c.y + .9, c.z); this.meshes.push(w);
      }
    }
  }
  private open(x: number, z: number) {
    if (this.kitPlan) { const g = this.geometry; if (!g) return true; const y = g.supportAt(x, z, this.pos.y + .5); if (y === null || !g.fits(x, y, z, .3, 1.75)) return false; this.pos.y = y; return true; }
    const p = this.plan!; return [-.3, .3].every(dx => [-.3, .3].every(dz => interiorVoxel(p, Math.floor(x + dx), 1, Math.floor(z + dz)) === 0 && interiorVoxel(p, Math.floor(x + dx), 2, Math.floor(z + dz)) === 0)); }
  private overviewing = false; private walkFog = 0; private fill: HemisphericLight; private player: Mesh; private materials: PBRMaterial[] = []; private scans = new Map<string, ReturnType<typeof loadScannedMaps>>();
  private maps(surface: string) { let m = this.scans.get(surface); if (!m) { m = loadScannedMaps(this.scene, surface); this.scans.set(surface, m); } return m; }
  update(dt: number, keys: Set<string>) {
    if (!this.plan && !this.kitPlan || this.overviewing && !keys.size) return;
    if (this.overviewing) { this.overviewing = false; this.scene.fogDensity = this.walkFog; this.fill.intensity = .55; }
    const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0), fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    this.yaw -= turn * 2.4 * dt; const speed = (keys.has('ShiftLeft') ? 7 : 4) * fwd * dt, dx = -Math.sin(this.yaw) * speed, dz = -Math.cos(this.yaw) * speed;
    if (this.open(this.pos.x + dx, this.pos.z)) this.pos.x += dx; if (this.open(this.pos.x, this.pos.z + dz)) this.pos.z += dz;
    const back = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.player.position.set(this.pos.x, this.pos.y + .9, this.pos.z); this.player.rotation.y = this.yaw;
    this.camera.position = this.pos.add(back.scale(5.5)).add(new Vector3(0, 4.2, 0)); this.camera.setTarget(this.pos.add(new Vector3(0, 1.5, 0)));
  }
  /** Survey for media/tests: an elevated view of the whole floor. */
  overview() {
    if (!this.overviewing) this.walkFog = this.scene.fogDensity;
    this.overviewing = true;
    // Seen from above the whole floor: thin the fog for the camera's distance and lift the fill, so deep (darker, foggier) floors read.
    const reach = this.kitPlan ? 120 : this.plan!.half * 2.5; this.scene.fogDensity = Math.min(this.walkFog, .5 / reach); this.fill.intensity = .9;
    if (this.kitPlan) { const k = this.kitPlan, cx = (k.start.x + k.exit.x) / 2, cz = (k.start.z + k.exit.z) / 2, span = Math.hypot(k.exit.x - k.start.x, k.exit.z - k.start.z); this.camera.position = new Vector3(cx + span * .5, span * .9, cz + span * .35); this.camera.setTarget(new Vector3(cx, 1, cz)); return; }
    const p = this.plan!; this.camera.position = new Vector3(p.origin.x, p.half * 2.1, p.origin.z + p.half * 1.25); this.camera.setTarget(new Vector3(p.origin.x, 1, p.origin.z)); }
  interact(): 'ascend' | 'leave' | 'blocked' | null {
    const p = this.plan ?? this.kitPlan; if (!p) return null;
    if (Math.hypot(this.pos.x - p.exit.x, this.pos.z - p.exit.z) < 2.4) {
      if (this.floor === TOWER_FLOORS) { this.message = 'The summit requires earned Silver capacity (canonical rule).'; return 'blocked'; }
      void this.enter(this.floor + 1); return 'ascend';
    }
    if (Math.hypot(this.pos.x - p.start.x, this.pos.z - p.start.z) < 2.4) return 'leave';
    return null;
  }
  describe() {
    const s = this.spec; if (!s) return '';
    return `${s.name}${this.kitPlan ? ' · library kit (' + [...new Set(this.kitPlan.placements.filter(p => !p.assetId.startsWith('module:')).map(p => p.assetId.replace(/^tv_\d+_\d+_/, '')))].join(', ') + ')' : ''}\n${s.bandName} · ${s.kind} · ${s.encounter.enemies} wardens (${[...new Set(s.wardens)].join(', ')})\naward: ${s.award.abilityId} ×${s.award.quantity} + provisions${s.rewardKinds.includes('boon') ? ' · boon floor' : ''}${s.rewardKinds.includes('trial') ? ' · trial' : ''}${s.rest ? ' · rest' : ''}\ncanonical gate: ${s.gate.previousFloor ? `clear floor ${s.gate.previousFloor}` : 'enter the Tower'}${s.gate.stage ? ` + ${s.gate.stage}` : ''} · clearing reaches ${s.tierOnClear}\nSurvey preview (earns nothing) · gold disc: stair (F) · blue disc: return (F)${this.message ? '\n' + this.message : ''}`;
  }
}
