import { Color3, Color4, FreeCamera, InstancedMesh, Material, Matrix, Mesh, VertexData, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import {
  HOME_ANCHOR, add, arc, biomeAt, chartToHome, homeToDir, length, localHour, normalize, planetSpec, propsNear, regionAt, resolveObstacles, scale, skyAt,
  spawnBody, stepSurface, surfaceRadius, tangentFrame, toLatLon, upOf, DAY_SECONDS, START_HOUR, type Obstacle, type SurfaceBody, type SurfaceInput, type V3,
} from '../../sim/world/planet';
import { homeChart, planetToRealm, realmToPlanet } from '../../sim/world/planet/chart';
import { pagodaBlocks, pagodaSupport } from '../../sim/world/planet/pagoda';
import { LIBRARY_PLACEMENTS, libraryAsset, placementDir, placementLocal, regionLandmarks, standInProxies } from '../../sim/world/assets/library';
import { focusedTownPlan } from '../../sim/world/assets/focusedLayouts';
import { registerFocusedGeometry, sceneGeometry, focusedGeometryReady } from '../../sim/world/assets/focusedRuntime';
import { focusedTerrain, terrainTriangles } from '../../sim/world/assets/focusedTerrain';
import { StaticGeometry as Geometry } from '../../sim/physical/staticGeometry';
import type { StaticGeometry } from '../../sim/physical/staticGeometry';
import { realmSeed } from '../../sim/world/realms/layout';
import { FocusedAssets } from '../realms/focusedAssets';
import type { Atmosphere } from '../world/atmosphere';
import { PlanetTerrain } from './terrain';
import { PlanetSky } from './sky';
import { PlanetProps } from './props';
import { LibraryLoader } from './library';
import { buildPagoda } from './pagoda';
import { bendTree } from './bend';
import { TowerSurvey } from './towerFloors';
import { buildRoads } from './roads';

/** /?world — the whole world as a walkable sphere. Geography, gravity, the sky clock and
 * Tower floors are the sim's pure seeded functions; this view advances a fixed-step
 * clock and a surface body, and projects them. URL: &seed=, &hour=, &speed=, &view=orbit|ground, &floor=N. */
export async function startPlanetWorld() {
  const params = new URLSearchParams(location.search), seed = Number(params.get('seed') ?? 20261017) | 0, spec = planetSpec(seed);
  const canvas = document.getElementById('game') as HTMLCanvasElement, ui = document.getElementById('ui') ?? document.body;
  const ctx = await createRenderer(canvas, { quality: 'balanced' }), scene = ctx.scene, engine = ctx.engine;
  scene.clearColor = new Color4(0, 0, 0, 1); scene.fogMode = Scene.FOGMODE_EXP2; scene.ambientColor = new Color3(.25, .25, .28);
  const camera = new FreeCamera('world-camera', new Vector3(0, spec.radius * 3, 0), scene); camera.minZ = .3; camera.maxZ = spec.radius * 12; camera.fov = .9; camera.inputs.clear();
  try { attachPipeline(ctx, camera); } catch { /* the plain forward path remains */ }
  const sky = new PlanetSky(scene, ctx.quality.shadowMapSize >= 2048 ? 2048 : 1024); sky.atmosphere(spec.radius);
  const terrain = new PlanetTerrain(scene, spec); buildRoads(scene, spec);
  const loader = new LibraryLoader(scene);
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'fixed', left: '12px', top: '12px', padding: '8px 12px', background: 'rgba(12,14,20,.72)', color: '#e8e4d8', font: '12.5px system-ui', borderRadius: '8px', pointerEvents: 'none', whiteSpace: 'pre', zIndex: '20' });
  ui.append(label);
  const status: Record<string, string> = {};
  /** Static world geometry: no per-frame matrix or bounds work. */
  const freeze = (m: Mesh) => { m.isPickable = false; m.computeWorldMatrix(true); m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; };

  // Home content: the preserved focused town → forest → Tower route, bent onto the curve.
  const town = focusedTownPlan(seed), townOrigin = { x: 8192 + 3072 + 48.5, z: 3072 + 20.5 }, chart = homeChart(townOrigin, 1);
  // The focused Tower shell is replaced by the pagoda; its modules are neither drawn nor solid here.
  const townWithoutShell = { ...town, placements: town.placements.filter(p => !p.id.includes(':tower:')) };
  const towerCentre = { x: town.tower.x + town.tower.w / 2, z: town.tower.z + town.tower.d / 2 };
  const toPlanet = (x: number, y: number, z: number) => realmToPlanet(spec, chart, x, y, z);
  const v = (p: V3) => new Vector3(p.x, p.y, p.z);
  let townGeometry: StaticGeometry | null = null, walkBounds = town.bounds;
  const shim = { addCaster: (m: Mesh) => sky.addCaster(m), removeCaster: (m: Mesh) => sky.removeCaster(m) } as unknown as Atmosphere;
  const focused = new FocusedAssets(scene, shim);
  const loadTown = async () => {
    await focused.loadManifest();
    let n = 0;
    for (const p of town.placements) {
      if (p.id.includes(':tower:')) continue; // the Tower's exterior is the pagoda below
      const inst = await focused.instantiate(p, { x: 0, z: 0 });
      for (const m of bendTree(spec, chart, inst.root)) { m.receiveShadows = true; sky.addCaster(m); freeze(m); }
      n++;
    }
    status.town = `${n} focused placements`;
  };
  const loadTownCollision = async () => {
    if (focusedGeometryReady()) { townGeometry = sceneGeometry(townWithoutShell); return; }
    const r = await fetch('/focused/collision.json'); if (!r.ok) throw Error('collision unavailable');
    const bytes = await r.arrayBuffer(), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    registerFocusedGeometry(JSON.parse(new TextDecoder().decode(bytes)), digest); townGeometry = sceneGeometry(townWithoutShell); status.collision = 'town geometry';
    // The canonical height field that joins the authored spaces, bent like everything else.
    const t = focusedTerrain(town.id + ':terrain', townGeometry), root = new TransformNode('focused-terrain-root', scene), mesh = new Mesh(t.id, scene), data = new VertexData(), normals: number[] = [];
    VertexData.ComputeNormals(t.positions, t.indices, normals, { useRightHandedSystem: true });
    Object.assign(data, { positions: t.positions, indices: t.indices, normals, colors: t.positions.flatMap((_v, i) => i % 3 === 0 ? [1, 1, 1, .7] : []), uvs: t.positions.flatMap((p, i) => i % 3 === 0 ? [p * .25, t.positions[i + 2] * .25] : []) }); data.applyToMesh(mesh, true);
    mesh.parent = root; mesh.material = focused.forestFloorMaterial(); mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
    for (const m of bendTree(spec, chart, root)) { m.receiveShadows = true; freeze(m); }
    const tb = t.bounds, gb = townGeometry.bounds;
    walkBounds = { x0: Math.min(gb.x0, tb.x0), z0: Math.min(gb.z0, tb.z0), x1: Math.max(gb.x1, tb.x1), z1: Math.max(gb.z1, tb.z1) };
    townGeometry = new Geometry([...townGeometry.triangles, ...terrainTriangles(t)], walkBounds);
    terrain.sink = d => { const r = planetToRealm(spec, chart, scale(d, spec.radius + 6)); return r.x > tb.x0 + 2 && r.x < tb.x1 - 2 && r.z > tb.z0 + 2 && r.z < tb.z1 - 2 ? .45 : 0; };
    terrain.follow(upOf(body), true);
  };
  // Library placements on the home and far charts.
  const libraryRoots: TransformNode[] = [], standInObstacles: Obstacle[] = [];
  const loadLibrary = async () => {
    for (const p of [...LIBRARY_PLACEMENTS, ...regionLandmarks(spec)]) {
      const d = placementDir(spec, p), f = tangentFrame(d), r = surfaceRadius(spec, d), root = new TransformNode('library:' + p.id, scene);
      // Asset +Z faces chart north after yaw; frame axes (west, up, north) keep right-handedness.
      const west = v(scale(f.east, -1)), up = v(f.up), north = v(f.north);
      const q = Quaternion.FromRotationMatrix(Matrix.FromValues(west.x, west.y, west.z, 0, up.x, up.y, up.z, 0, north.x, north.y, north.z, 0, 0, 0, 0, 1));
      root.rotationQuaternion = q.multiply(Quaternion.RotationAxis(Vector3.Up(), p.yaw)); root.position = v(scale(d, r));
      const meshes = await loader.instantiate(p.assetId, p.id, root);
      for (const m of meshes) { if (!(m instanceof InstancedMesh)) m.receiveShadows = true; sky.addCaster(m); }
      root.computeWorldMatrix(true); root.freezeWorldMatrix(); for (const m of meshes) freeze(m);
      libraryRoots.push(root);
      if (loader.status[p.assetId] === 'fallback') for (const q of standInProxies(libraryAsset(p.assetId)!)) { const c = placementLocal(p, q.x, q.z); standInObstacles.push({ dir: placementDir(spec, { ...p, ...c }), radius: q.r }); }
    }
    status.library = Object.entries(loader.status).map(([k, s]) => `${k}:${s}`).join(' ');
  };
  // The pagoda stands on the focused Tower footprint, its door toward the forest route.
  const pagodaRoot = new TransformNode('tower-of-chrysanthus', scene);
  const pagodaDir = normalize(toPlanet(towerCentre.x, 1, towerCentre.z - 6)), pf = tangentFrame(pagodaDir);
  {
    const west = v(scale(pf.east, -1)), up = v(pf.up), north = v(pf.north);
    pagodaRoot.rotationQuaternion = Quaternion.FromRotationMatrix(Matrix.FromValues(west.x, west.y, west.z, 0, up.x, up.y, up.z, 0, north.x, north.y, north.z, 0, 0, 0, 0, 1));
    pagodaRoot.position = v(scale(pagodaDir, spec.radius + 6 - .2));
  }
  const pagoda = buildPagoda(scene, pagodaRoot);
  pagodaRoot.computeWorldMatrix(true); pagodaRoot.freezeWorldMatrix();
  for (const m of pagoda.meshes) { m.receiveShadows = true; sky.addCaster(m); freeze(m); }
  const doorPoint = Vector3.TransformCoordinates(pagoda.door, pagodaRoot.computeWorldMatrix(true)), stepOut = Vector3.TransformCoordinates(pagoda.door.add(new Vector3(0, 0, -4)), pagodaRoot.computeWorldMatrix(true)), farOut = Vector3.TransformCoordinates(pagoda.door.add(new Vector3(0, 0, -60)), pagodaRoot.computeWorldMatrix(true));
  const pagodaInverse = pagodaRoot.computeWorldMatrix(true).clone().invert();
  const pagodaLocal = (p: V3) => Vector3.TransformCoordinates(new Vector3(p.x, p.y, p.z), pagodaInverse);

  // The observer's body: the existing placeholder treatment (a plain capsule), unchanged in kind.
  const bodyMesh = MeshBuilder.CreateCapsule('player-placeholder', { height: 1.8, radius: .35 }, scene), bodyMat = new StandardMaterial('player-placeholder', scene);
  bodyMat.diffuseColor = new Color3(.85, .75, .55); bodyMesh.material = bodyMat; sky.addCaster(bodyMesh);
  const spawnDir = normalize(toPlanet(town.spawn.x, 1, town.spawn.z));
  let body: SurfaceBody = spawnBody(spec, spawnDir, homeToDir(spec, 0, 400));
  let seconds = Number.isFinite(Number(params.get('hour'))) && params.get('hour') !== null ? ((Number(params.get('hour')) - START_HOUR + 24) % 24) / 24 * DAY_SECONDS : 0;
  let speed = Number(params.get('speed') ?? 1) || 1, view: 'ground' | 'orbit' = params.get('view') === 'orbit' ? 'orbit' : 'ground';
  let camYaw = 0, camPitch = .28, camDist = 7.5, orbitAngle = 0, orbitRadius = spec.radius * 3.1;
  const keys = new Set<string>();
  addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'KeyO') view = view === 'orbit' ? 'ground' : 'orbit'; if (e.code === 'KeyT') speed = speed === 1 ? 60 : 1; if (inTower && (e.code === 'BracketRight' || e.code === 'BracketLeft')) void survey.enter(survey.floor + (e.code === 'BracketRight' ? 1 : -1)); if (e.code === 'KeyF') interact(); });
  addEventListener('keyup', e => keys.delete(e.code));
  let dragging = false;
  canvas.addEventListener('pointerdown', () => { dragging = true; }); addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', e => { if (!dragging) return; camYaw -= e.movementX * .005; camPitch = Math.max(-.2, Math.min(1.2, camPitch + e.movementY * .004)); });
  canvas.addEventListener('wheel', e => { if (view === 'orbit') orbitRadius = Math.max(spec.radius * 1.15, Math.min(spec.radius * 8, orbitRadius * (1 + e.deltaY * .001))); else camDist = Math.max(3, Math.min(40, camDist * (1 + e.deltaY * .001))); });

  // Tower survey: the hundred floors in their own scene.
  const survey = new TowerSurvey(engine, realmSeed(seed, 'canonical-tower')); survey.kit = params.has('kit');
  let inTower = false;
  function interact() {
    if (inTower) { const r = survey.interact(); if (r === 'leave') { inTower = false; body = spawnBody(spec, normalize(v2p(stepOut)), v2p(farOut)); stepBody({ forward: 0, right: 0, turn: 0, jump: false, run: false }); } return; }
    if (nearDoor()) { inTower = true; void survey.enter(survey.floor); }
  }
  const v2p = (p: Vector3): V3 => ({ x: p.x, y: p.y, z: p.z });
  function nearDoor() { return Vector3.Distance(v(add(body.pos, scale(upOf(body), .9))), doorPoint) < 4; }

  const fixed = 1 / 60; let acc = 0, last = performance.now(), hudT = 0;
  const obstacles = (): Obstacle[] => {
    const here = upOf(body), list: Obstacle[] = propsNear(spec, here, 12).filter(p => p.radius > 0).map(p => ({ dir: p.dir, radius: p.radius }));
    for (const o of standInObstacles) if (arc(spec, here, o.dir) < o.radius + 8) list.push(o);
    return list;
  };
  const stepBody = (input: SurfaceInput) => {
    const prev = body;
    body = resolveObstacles(spec, stepSurface(spec, body, input, fixed), obstacles());
    // The pagoda: podium and stair carry the body; the ground storey's walls stop it, except at the door.
    if (arc(spec, upOf(body), pagodaDir) < 30) {
      const l = pagodaLocal(body.pos);
      if (pagodaBlocks(l.x, l.z)) body = { ...prev, vel: { x: 0, y: 0, z: 0 } };
      else { const h = pagodaSupport(l.x, l.z); if (h !== null) { const up = upOf(body), floor = spec.radius + 6 - .2 + h, r = length(body.pos); if (r <= floor + .05 || body.grounded && r - floor < .7) body = { ...body, pos: scale(up, floor), grounded: true }; } }
    }
    // Inside the charted town, the realm's own static geometry carries the body.
    if (townGeometry) {
      const rp = planetToRealm(spec, chart, body.pos), b = walkBounds;
      if (rp.x > b.x0 && rp.x < b.x1 && rp.z > b.z0 && rp.z < b.z1) {
        const before = planetToRealm(spec, chart, prev.pos), support = townGeometry.supportAt(rp.x, rp.z, Math.max(before.y, rp.y) + .45, 1.05);
        if (support !== null && rp.y <= support + .06 + (body.grounded ? .5 : 0)) {
          if (!townGeometry.fits(rp.x, support, rp.z, .3, 1.75) && townGeometry.fits(before.x, before.y, before.z, .3, 1.75)) body = { ...prev, vel: { x: 0, y: 0, z: 0 } };
          else body = { ...body, pos: toPlanet(rp.x, support, rp.z), grounded: true, vel: scale(body.vel, 1) };
        }
      }
    }
  };
  const tick = () => {
    const now = performance.now(), dt = Math.min(.1, (now - last) / 1000); last = now;
    if (inTower) { survey.update(dt, keys); survey.scene.render(); hud(dt); return; }
    acc += dt;
    while (acc >= fixed) {
      acc -= fixed; seconds += fixed * speed;
      const input: SurfaceInput = {
        forward: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
        right: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
        turn: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
        jump: keys.has('Space'), run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      };
      if (view === 'ground') stepBody(input); else orbitAngle += fixed * .05 * speed ** .25;
    }
    const up = upOf(body), u = v(up), pos = v(body.pos), fwd = v(body.forward);
    bodyMesh.position = pos.add(u.scale(.9));
    bodyMesh.rotationQuaternion = Quaternion.FromLookDirectionRH(fwd, u);
    terrain.follow(up); props?.follow(up);
    const state = skyAt(seconds);
    if (view === 'orbit') {
      const t = orbitAngle, around = normalize(add(scale(HOME_ANCHOR, Math.cos(t)), scale(tangentFrame(HOME_ANCHOR).east, Math.sin(t))));
      camera.position = v(scale(normalize(add(around, { x: 0, y: .35, z: 0 })), orbitRadius)); camera.upVector = new Vector3(0, 1, 0); camera.setTarget(Vector3.Zero());
      sky.update(state, normalize(v2p(camera.position)), Vector3.Zero(), camera.maxZ * .45, 1);
      scene.fogDensity = 0;
    } else {
      const yawQ = Quaternion.RotationAxis(u, camYaw), back = fwd.applyRotationQuaternion(yawQ).scale(-1), cam = pos.add(u.scale(1.6)).add(back.scale(Math.cos(camPitch) * camDist)).add(u.scale(Math.sin(camPitch) * camDist));
      // Keep the camera above ground.
      const camDir = normalize(v2p(cam)), floor = surfaceRadius(spec, camDir) + .6, cr = cam.length();
      camera.position = cr < floor ? cam.scale(floor / cr) : cam; camera.upVector = u; camera.setTarget(pos.add(u.scale(1.5)));
      sky.update(state, up, pos, camera.maxZ * .45, 0);
    }
    // Lanterns behind the pagoda's lattice glow after dusk.
    const dark = 1 - (sky.last?.daylight ?? 1); pagoda.lamp.emissiveColor = new Color3(1, .7, .35).scale(.15 + .85 * dark);
    scene.render(); hud(dt);
  };
  let props: PlanetProps | null = null;
  const hud = (dt: number) => {
    hudT += dt; if (hudT < .25) return; hudT = 0;
    const up = upOf(body), ll = toLatLon(up), state = skyAt(seconds), l = sky.last, hour = localHour(state, ll.lon), r = regionAt(spec, up);
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60), c = chartToHome(spec, up);
    label.textContent = inTower ? survey.describe() : `${r.name} — ${biomeAt(spec, up)}\n${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local · day ${state.day + 1} · moon ${(state.moonIllumination * 100).toFixed(0)}%${speed > 1 ? ` · ×${speed}` : ''}\nlat ${ll.lat.toFixed(2)} lon ${ll.lon.toFixed(2)} · ${l ? (l.sunElevation > 0 ? 'sun ' + (Math.asin(l.sunElevation) * 57.3).toFixed(0) + '°' : l.moonElevation > 0 ? 'moonlight' : 'night') : ''}${arc(spec, up, HOME_ANCHOR) < 900 ? `\nhome chart ${c.east.toFixed(0)} E ${c.north.toFixed(0)} N` : ''}${nearDoor() ? '\nF — enter the Tower of Chrysanthus' : ''}\nWASD move · Shift run · Space jump · O orbit · T time ×60`;
  };
  engine.runRenderLoop(tick); addEventListener('resize', () => engine.resize());
  // Content loads after first frame; each part fails independently to its fallback.
  void (async () => {
    props = new PlanetProps(scene, spec, loader, m => sky.addCaster(m)); await props.init(); props.follow(upOf(body), true);
    await Promise.allSettled([loadLibrary(), loadTown().catch(e => { status.town = 'unavailable: ' + e; }), loadTownCollision().catch(e => { status.collision = 'none: ' + e; })]);
    (window as unknown as { __tvWorldReady: boolean }).__tvWorldReady = true;
  })();
  const floorParam = Number(params.get('floor'));
  if (floorParam >= 1 && floorParam <= 100) { inTower = true; void survey.enter(floorParam); }
  // Test/media hooks: read-only state and observer placement, no gameplay authority.
  (window as unknown as { __tvWorld: unknown }).__tvWorld = {
    spec, status, get body() { return body; },
    setHour(h: number) { seconds = ((h - START_HOUR + 24) % 24) / 24 * DAY_SECONDS + Math.floor(seconds / DAY_SECONDS) * DAY_SECONDS; },
    setDay(d: number) { seconds = (seconds % DAY_SECONDS) + d * DAY_SECONDS; },
    setView(next: 'orbit' | 'ground') { view = next; }, setOrbit(angle: number, radius?: number) { orbitAngle = angle; if (radius) orbitRadius = radius; },
    setCamera(yaw: number, pitch: number, dist: number) { camYaw = yaw; camPitch = pitch; camDist = dist; },
    teleportHome(east: number, north: number, facingEast = 0, facingNorth = 1) { inTower = false; body = spawnBody(spec, homeToDir(spec, east, north), homeToDir(spec, east + facingEast * 50, north + facingNorth * 50)); },
    teleportLatLon(lat: number, lon: number) { inTower = false; const d = normalize(v2p(new Vector3(Math.cos(lat / 57.2958) * Math.sin(lon / 57.2958), Math.sin(lat / 57.2958), Math.cos(lat / 57.2958) * Math.cos(lon / 57.2958)))); body = spawnBody(spec, d); },
    walk(seconds: number, input: Partial<SurfaceInput>) { for (let t = 0; t < seconds; t += fixed) stepBody({ forward: 0, right: 0, turn: 0, jump: false, run: false, ...input }); },
    tower(floor: number, kit?: boolean) { inTower = true; if (kit !== undefined) survey.kit = kit; return survey.enter(floor); }, leaveTower() { inTower = false; },
    survey, radius: () => length(body.pos), get inTower() { return inTower; }, local: () => { const l = pagodaLocal(body.pos); return [l.x, l.y, l.z]; }, pagoda: chartToHome(spec, pagodaDir), interact: () => interact(),
  };
}
