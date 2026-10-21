import { Color3, Matrix, Mesh, PBRMaterial, Ray, StandardMaterial, TransformNode, UniversalCamera, Vector3, type AbstractMesh } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import { LibraryLoader } from '../planet/library';
import { townLayout, terrainHeight, TOWN_SEED } from '../../sim/town/layout';
import { TownCollision } from '../../sim/town/collision';
import { groundMask } from '../../sim/town/groundMask';
import { createPlayer, stepPlayer, angleDelta, type MoveInput, type PlayerState } from '../../sim/town/movement';
import { boomDirection, clampPitch, clampZoom, collideBoom, easeBoom, follow, orbitInput, shoulderPivot, type Orbit } from '../../sim/town/camera';
import { TownFolk, NPC_TICK, type NpcState } from '../../sim/town/npcs';
import { buildGround } from './ground';
import { Kit } from './kit';
import { buildProps, setGround } from './props';
import { Atmosphere, type TimeOfDay } from './atmosphere';
import { makeFigure, makeMarker, type Figure } from './actors';
import { buildPagoda } from '../planet/pagoda';
import { mountHud } from './hud';

/** The starting town: a self-contained page (town.html). Seeded plan → meshes; a fixed-step
 * walker and townsfolk sim; a third-person camera. URL: ?lite, ?time=golden|dusk|day, ?seed=. */
const STEP = 1 / 60;
/** Library ground slabs replaced by the town's own ground (they read as hard-edged squares). */
const HIDE_GROUND = new Set(['tv_04_01_gatehouse', 'tv_08_01_village_lane', 'tv_10_01_watchpost', 'tv_44_01_dungeon_junction', 'tv_37_01_market_square']);

export async function startTown() {
  const params = new URLSearchParams(location.search), lite = params.has('lite'), time = (['golden', 'dusk', 'day'].includes(params.get('time') ?? '') ? params.get('time') : 'golden') as TimeOfDay;
  const seed = Number(params.get('seed') ?? TOWN_SEED) | 0;
  const canvas = document.getElementById('game') as HTMLCanvasElement, status = mountHud(lite);
  status.loading('Laying out the town…');
  const ctx = await createRenderer(canvas, { quality: lite ? 'low' : 'balanced' }), scene = ctx.scene, engine = ctx.engine;
  const layout = townLayout(seed), world = new TownCollision(layout);
  setGround((x, z) => world.groundAt(x, z));

  const atmo = new Atmosphere(scene, time, lite);
  status.loading('Painting the ground…');
  await frame();
  const ground = buildGround(scene, layout, groundMask(layout, lite ? 512 : 1024), { extent: 760, cell: lite ? 3 : 2 });
  const kit = new Kit(scene), built = buildProps(scene, kit, layout.props);
  const camBlockers = new Set<AbstractMesh>();
  for (const m of built.meshes) m.receiveShadows = true;
  for (const m of built.casters) atmo.shadows.addShadowCaster(m, false);
  for (const m of built.meshes) if (m.name.startsWith('town-static')) { m.isPickable = true; camBlockers.add(m); }
  atmo.setLamps(built.lamps, lite ? 2 : 4);
  if (atmo.glow) { for (const m of scene.meshes) if (m.material === kit.mats.glow || m.material === kit.mats.window) atmo.glow.addIncludedOnlyMesh(m as Mesh); }
  (kit.mats.window as PBRMaterial).emissiveColor = new Color3(.95, .55, .2).scale(atmo.preset.windows);
  (kit.mats.glow as StandardMaterial).emissiveColor = new Color3(1, .62, .26).scale(Math.max(.35, atmo.preset.lamps));

  // The Tower of Chrysanthus on its hill: the focal landmark seen through the north gate.
  const towerRoot = new TransformNode('tower', scene); towerRoot.position.set(layout.tower.x, layout.tower.y - .4, layout.tower.z); towerRoot.rotation.y = Math.PI;
  buildPagoda(scene, towerRoot);
  for (const m of towerRoot.getChildMeshes()) { atmo.shadows.addShadowCaster(m, false); m.receiveShadows = true; m.isPickable = false; }

  // Library spaces (torn-veil-assets GLBs, hash-verified in the browser before use).
  status.loading('Raising the buildings…');
  const lib = new LibraryLoader(scene, '/world-assets/');
  const libraryReady = Promise.all(layout.library.map(async p => {
    const root = new TransformNode(`lib:${p.key}`, scene); root.position.set(p.x, 0, p.z); root.rotation.y = p.yaw;
    const meshes = await lib.instantiate(p.assetId, p.key, root);
    for (const m of meshes) {
      if (HIDE_GROUND.has(p.assetId) && /RUNTIME_ground/.test(m.name + (m.parent?.name ?? ''))) { m.setEnabled(false); continue; }
      m.receiveShadows = true; atmo.shadows.addShadowCaster(m, false); m.isPickable = true; camBlockers.add(m);
      m.freezeWorldMatrix(); m.alwaysSelectAsActiveMesh = false;
    }
  }));
  // Library flora and boulders dotted through the meadow.
  const natural = Promise.all(layout.props.filter(p => p.kind === 'sapling' || p.kind === 'boulder').map(async (p, i) => {
    const id = p.kind === 'boulder' ? 'tvn_biome_021' : i % 2 ? 'tvn_flora_005' : 'tvn_flora_001';
    const root = new TransformNode(`nat:${i}`, scene); root.position.set(p.x, world.groundAt(p.x, p.z) - .05, p.z); root.rotation.y = p.yaw; root.scaling.setAll(p.kind === 'boulder' ? p.s * 1.3 : p.s * 1.4);
    for (const m of await lib.instantiate(id, `nat${i}`, root)) { m.receiveShadows = true; atmo.shadows.addShadowCaster(m, false); m.isPickable = false; }
  }));

  // Player and townsfolk.
  let player: PlayerState = createPlayer(layout.spawn.x, layout.spawn.z, layout.spawn.yaw, world), prev = player;
  const hero = makeFigure(scene, 'player', '#2f4f6f', { hat: 'hood', height: 1.8 });
  for (const m of hero.root.getChildMeshes()) atmo.shadows.addShadowCaster(m, false);
  const folk = new TownFolk(layout.npcs, { blocked: (x, z, r) => world.blocked(x, z, r), move: (x, z, dx, dz, r) => world.move(x, z, dx, dz, r) }, seed);
  const hats = ['brim', null, 'cap', null, 'brim'] as const;
  const figures: Figure[] = layout.npcs.map((n, i) => makeFigure(scene, n.id, '#' + n.colour.toString(16).padStart(6, '0'), { hat: n.role === 'guard' ? 'cap' : hats[i % hats.length], height: 1.62 + ((i * 37) % 10) / 50, skin: ['#c99a78', '#a8785a', '#e0b896', '#8a5a3c'][i % 4] }));
  for (const f of figures) for (const m of f.root.getChildMeshes()) atmo.shadows.addShadowCaster(m, false);
  let folkPrev: NpcState[] = folk.states.map(s => ({ ...s }));
  const marker = makeMarker(scene);

  // Camera rig.
  const cam = new UniversalCamera('town-cam', new Vector3(0, 3, -90), scene); cam.minZ = .1; cam.maxZ = 2000; cam.fov = .9; cam.inputs.clear();
  scene.activeCamera = cam; attachPipeline(ctx, cam); atmo.attachCamera(cam);
  if (ctx.pipeline) { ctx.pipeline.imageProcessing.exposure = atmo.preset.exposure; ctx.pipeline.bloomThreshold = .9; ctx.pipeline.bloomWeight = .18; }
  let orbit: Orbit = { yaw: layout.spawn.yaw, pitch: .22, zoom: 5.2 }, boom = orbit.zoom, lastOrbitInput = -10, pivot = new Vector3(player.x, player.y + 1.6, player.z);
  const keys = new Set<string>();
  addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'KeyL') togglePointerLock(); if (e.code === 'KeyH') status.toggle(); });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let drag: { id: number; x: number; y: number; t: number; moved: number; button: number } | null = null, clock = 0;
  const locked = () => document.pointerLockElement === canvas;
  const togglePointerLock = () => { if (locked()) document.exitPointerLock(); else canvas.requestPointerLock?.(); };
  canvas.addEventListener('pointerdown', e => { canvas.focus(); drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, button: e.button }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (locked()) { orbit = orbitInput(orbit, e.movementX, e.movementY, 0, .0035); lastOrbitInput = clock; return; }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (drag.moved > 4) { orbit = orbitInput(orbit, dx, dy, 0); lastOrbitInput = clock; }
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && drag.id === e.pointerId && drag.button === 0 && drag.moved <= 4 && !locked()) {
      const hit = groundPick(e.clientX, e.clientY);
      if (hit) { player = { ...player, target: { x: hit.x, z: hit.z } }; marker.position.set(hit.x, world.groundAt(hit.x, hit.z) + .04, hit.z); marker.setEnabled(true); markerAge = 0; }
    }
    drag = null;
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); orbit = { ...orbit, zoom: clampZoom(orbit.zoom * Math.exp(e.deltaY * .0012)) }; }, { passive: false });
  let markerAge = 0;
  /** Ray from the cursor to the terrain (or a raised library floor): marched, then refined. */
  function groundPick(cx: number, cy: number): Vector3 | null {
    const rect = canvas.getBoundingClientRect(), ray = scene.createPickingRay(cx - rect.left, cy - rect.top, Matrix.Identity(), cam);
    const at = (t: number) => ray.origin.add(ray.direction.scale(t));
    let lo = 0;
    for (let t = .5; t < 260; t += .5) {
      const p = at(t);
      if (p.y <= world.groundAt(p.x, p.z)) { let a = lo, b = t; for (let i = 0; i < 12; i++) { const m = (a + b) / 2, q = at(m); if (q.y <= world.groundAt(q.x, q.z)) b = m; else a = m; } const q = at(b); return world.blocked(q.x, q.z, .2) ? nearestFree(q) : q; }
      lo = t;
    }
    return null;
  }
  const nearestFree = (q: Vector3) => { for (let r = .5; r < 3; r += .5) for (let a = 0; a < 8; a++) { const x = q.x + Math.sin(a * .785) * r, z = q.z + Math.cos(a * .785) * r; if (!world.blocked(x, z, .4)) return new Vector3(x, 0, z); } return null; };
  /** Camera collision: nearest blocker hit along the boom (buildings, walls, GLB spaces) and the terrain. */
  const blockerPredicate = (m: AbstractMesh) => camBlockers.has(m) && m.isEnabled();
  function boomHit(from: Vector3, dir: Vector3, len: number): number | null {
    let best: number | null = null;
    const pick = scene.pickWithRay(new Ray(from, dir, len + .4), blockerPredicate, false);
    if (pick?.hit && pick.distance !== undefined) best = pick.distance;
    for (let t = .5; t <= len + .4; t += .5) { const p = from.add(dir.scale(t)); if (p.y < terrainHeight(p.x, p.z) + .25) { best = Math.min(best ?? Infinity, t); break; } }
    return best;
  }

  // Fixed-step simulation, render-rate presentation.
  let acc = 0, npcAcc = 0, ready = false;
  const input = (): MoveInput => ({
    forward: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
    right: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  });
  const folkBodies = () => folk.bodies();
  const moveWorld = { move: (x: number, z: number, dx: number, dz: number, r: number) => world.move(x, z, dx, dz, r, folkBodies()), groundAt: (x: number, z: number) => world.groundAt(x, z) };
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(.1, engine.getDeltaTime() / 1000); clock += dt;
    const turn = (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0); if (turn) { orbit = { ...orbit, yaw: orbit.yaw + turn * dt * 2.2 }; lastOrbitInput = clock; }
    acc += dt; npcAcc += dt;
    while (acc >= STEP) { prev = player; player = stepPlayer(player, input(), orbit.yaw, STEP, moveWorld); acc -= STEP; }
    while (npcAcc >= NPC_TICK) { folkPrev = folk.states.map(s => ({ ...s })); folk.step(); npcAcc -= NPC_TICK; }
    const a = acc / STEP, px = prev.x + (player.x - prev.x) * a, pz = prev.z + (player.z - prev.z) * a, py = prev.y + (player.y - prev.y) * a;
    hero.root.position.set(px, py, pz); hero.root.rotation.y = prev.yaw + angleDelta(prev.yaw, player.yaw) * a;
    const bob = Math.min(1, player.speed / 3) * Math.abs(Math.sin(clock * 9)) * .05; hero.body.position.y = hero.body.metadata.y + bob; hero.head.position.y = hero.head.metadata.y + bob;
    if (!player.target) marker.setEnabled(false);
    else { markerAge += dt; const s = 1 + .15 * Math.sin(markerAge * 6); marker.scaling.set(s, 1, s); }
    // Townsfolk, interpolated between ticks; a step bob while walking.
    const b = npcAcc / NPC_TICK;
    folk.states.forEach((s, i) => {
      const p = folkPrev[i], f = figures[i], x = p.x + (s.x - p.x) * b, z = p.z + (s.z - p.z) * b;
      f.root.position.set(x, world.groundAt(x, z), z); f.root.rotation.y = p.yaw + angleDelta(p.yaw, s.yaw) * b;
      const k = s.moving ? Math.abs(Math.sin(clock * 7.5 + i)) * .04 : Math.sin(clock * 1.3 + i) * .006; f.body.position.y = f.body.metadata.y + k; f.head.position.y = f.head.metadata.y + k;
    });
    // Camera: follow the shoulder pivot, auto-settle behind the player while walking, collide.
    if (player.speed > .5 && clock - lastOrbitInput > 1.6 && !player.target) orbit = { ...orbit, yaw: orbit.yaw + angleDelta(orbit.yaw, player.yaw) * Math.min(1, dt * .9) };
    const want = shoulderPivot(px, py, pz, orbit.yaw, orbit.zoom), head = new Vector3(px, py + 1.6, pz);
    pivot.set(follow(pivot.x, want[0], dt, 14), follow(pivot.y, want[1], dt, 9), follow(pivot.z, want[2], dt, 14));
    // Keep the shoulder offset itself out of walls.
    const side = pivot.subtract(head), sideLen = side.length();
    if (sideLen > .01) { const h = boomHit(head, side.scale(1 / sideLen), sideLen); if (h !== null) pivot.copyFrom(head.add(side.scale(Math.max(0, h - .25) / sideLen))); }
    const dir = new Vector3(...boomDirection(orbit.yaw, orbit.pitch));
    boom = easeBoom(boom, collideBoom(orbit.zoom, boomHit(pivot, dir, orbit.zoom)), dt);
    cam.position.copyFrom(pivot.add(dir.scale(boom)));
    const groundUnder = terrainHeight(cam.position.x, cam.position.z) + .35; if (cam.position.y < groundUnder) cam.position.y = groundUnder;
    cam.setTarget(pivot.add(new Vector3(0, -.05 - orbit.pitch * .1, 0)));
    atmo.update(pivot, clock); atmo.follow(new Vector3(px, py, pz));
  });
  // Shared materials accept a few lamps besides sun and sky.
  for (const m of scene.materials) if (m instanceof PBRMaterial || m instanceof StandardMaterial) m.maxSimultaneousLights = 6;

  engine.runRenderLoop(() => scene.render());
  await Promise.all([libraryReady, natural]);
  for (const m of scene.materials) if (m instanceof PBRMaterial || m instanceof StandardMaterial) m.maxSimultaneousLights = 6;
  await scene.whenReadyAsync(); ready = true; status.ready(lib.status);
  // Hooks for headless captures and diagnostics (presentation only).
  (window as unknown as { __town: unknown }).__town = {
    get ready() { return ready; }, layout, status: lib.status,
    view(x: number, z: number, yaw: number, pitch = .22, zoom = 5.2) { player = createPlayer(x, z, yaw, world); prev = player; orbit = { yaw, pitch: clampPitch(pitch), zoom: clampZoom(zoom) }; boom = orbit.zoom; pivot.set(x, player.y + 1.6, z); },
    player: () => ({ ...player }), fps: () => engine.getFps(),
  };
}
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
