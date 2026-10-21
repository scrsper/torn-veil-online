import { RNG, fbm } from '../core/rng';
import { libraryAsset } from '../world/assets/library';

/** The starting town: one seeded, deterministic plan in flat town metres (x east, z north,
 * y up). A gatehouse opens on a main street through a hamlet lane to a round plaza with a
 * fountain; the north gate frames the Tower of Chrysanthus on its hill beyond. Pure data:
 * the browser builds meshes from it, the walker and NPCs collide against it. */
export interface LibraryPlace { key: string; assetId: string; x: number; z: number; yaw: number }
export type PropKind =
  | 'house' | 'stall' | 'crate' | 'barrel' | 'sack' | 'cart' | 'lamp' | 'bench' | 'fountain' | 'planter' | 'fence'
  | 'sign' | 'banner' | 'hay' | 'woodpile' | 'notice' | 'tree' | 'pine' | 'bush' | 'rock' | 'wall' | 'tower' | 'well' | 'flowers' | 'boulder' | 'sapling';
/** A placed prop. `w`/`d`/`h` size boxes (houses, walls, fences); `v` picks a seeded variant. */
export interface Prop { kind: PropKind; x: number; z: number; yaw: number; s: number; v: number; w?: number; d?: number; h?: number }
export type Collider = { type: 'circle'; x: number; z: number; r: number } | { type: 'box'; x: number; z: number; hw: number; hd: number; yaw: number };
/** A paved (cobble) or worn (dirt) strip. */
export interface PathStrip { kind: 'cobble' | 'dirt'; points: [number, number][]; width: number }
export interface NpcSpec { id: string; role: 'vendor' | 'stroller' | 'guard' | 'patron'; x: number; z: number; radius: number; facing: number; colour: number }
export interface TownLayout {
  seed: number; library: LibraryPlace[]; props: Prop[]; colliders: Collider[]; paths: PathStrip[];
  plaza: { x: number; z: number; r: number }; spawn: { x: number; z: number; yaw: number };
  tower: { x: number; z: number; y: number }; npcs: NpcSpec[]; bounds: { x: number; z: number; r: number };
  /** Town wall rectangle (inside is flat ground). */
  walls: { x0: number; x1: number; z0: number; z1: number };
}
export const TOWN_SEED = 20261020;
export const WALLS = Object.freeze({ x0: -76, x1: 76, z0: -104, z1: 52 });
export const PLAZA = Object.freeze({ x: 0, z: 0, r: 21 });
export const TOWER = Object.freeze({ x: 0, z: 236 });
export const BOUNDS = Object.freeze({ x: 0, z: -20, r: 178 });

const smooth = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
/** Ground height (m). Flat inside the walls; rolling meadow outside, rising to wooded hills at
 * the edge of the playable ring, and the Tower's hill to the north. Seedless: the land is fixed. */
export function terrainHeight(x: number, z: number): number {
  const ox = Math.max(0, WALLS.x0 - x, x - WALLS.x1), oz = Math.max(0, WALLS.z0 - z, z - WALLS.z1), out = Math.hypot(ox, oz);
  if (out <= 0) return 0;
  const meadow = smooth(4, 30, out), r = Math.hypot(x - BOUNDS.x, z - BOUNDS.z);
  const relief = (fbm(x / 70, z / 70, 4, 7) - .5) * 5 * meadow + (fbm(x / 18, z / 18, 3, 11) - .5) * .8 * meadow;
  const rim = smooth(BOUNDS.r - 40, BOUNDS.r + 60, r) * (18 + fbm(x / 40, z / 40, 3, 5) * 22);
  const t = Math.hypot(x - TOWER.x, z - TOWER.z), hill = 13 * Math.exp(-(t * t) / (2 * 62 * 62)) * smooth(0, 60, out);
  // The roads stay near grade: relief is softened along the north and south roads.
  const road = 1 - smooth(3, 9, Math.abs(x));
  return relief * (1 - .8 * road) + rim * (1 - .5 * road) + hill;
}
export function towerBase(): number { return terrainHeight(TOWER.x, TOWER.z - 30); }

/** Local → town transform of a placement (rotation about +Y by yaw). */
export function toTown(p: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw); return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}
export function toLocal(p: { x: number; z: number; yaw: number }, x: number, z: number): [number, number] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), dx = x - p.x, dz = z - p.z; return [dx * c - dz * s, dx * s + dz * c];
}
/** Axis-aligned town rectangle covered by a library placement's manifest bounds (+margin). */
export function placeRect(p: LibraryPlace, margin = 0): { x0: number; x1: number; z0: number; z1: number } {
  const a = libraryAsset(p.assetId)!, [x0, , z0] = a.bounds.min, [x1, , z1] = a.bounds.max;
  const pts = [toTown(p, x0, z0), toTown(p, x1, z0), toTown(p, x0, z1), toTown(p, x1, z1)];
  return { x0: Math.min(...pts.map(q => q[0])) - margin, x1: Math.max(...pts.map(q => q[0])) + margin, z0: Math.min(...pts.map(q => q[1])) - margin, z1: Math.max(...pts.map(q => q[1])) + margin };
}
const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
export function distToPath(p: PathStrip, x: number, z: number): number {
  let d = Infinity; for (let i = 1; i < p.points.length; i++) d = Math.min(d, distToSegment(x, z, ...p.points[i - 1], ...p.points[i])); return d;
}

const D = Math.PI / 180;
/** The library spaces: every one a torn-veil-assets GLB, hash-checked at load. */
export const TOWN_LIBRARY: readonly LibraryPlace[] = Object.freeze([
  { key: 'gatehouse', assetId: 'tv_04_01_gatehouse', x: 0, z: -100, yaw: 0 },
  { key: 'lane', assetId: 'tv_08_01_village_lane', x: 0, z: -56, yaw: 0 },
  { key: 'market', assetId: 'tv_37_01_market_square', x: -44, z: 2, yaw: 0 },
  { key: 'tavern', assetId: 'tv_31_06_tavern', x: 31, z: 0, yaw: -90 * D },
  { key: 'arcade', assetId: 'tv_42_01_courtyard_passage', x: -32, z: 34, yaw: 0 },
  { key: 'north-gate', assetId: 'tv_41_01_gate_segment', x: 0, z: 52, yaw: 0 },
  { key: 'watchpost', assetId: 'tv_10_01_watchpost', x: 118, z: -34, yaw: 90 * D },
  { key: 'ruin', assetId: 'tv_44_01_dungeon_junction', x: -104, z: 84, yaw: 30 * D },
]);

/** Paths: cobbles inside the walls, worn earth outside. */
function townPaths(): PathStrip[] {
  return [
    { kind: 'cobble', points: [[0, -86], [0, -18]], width: 6 },
    { kind: 'cobble', points: [[-24, 2], [-56, 2]], width: 21 },
    { kind: 'cobble', points: [[0, 18], [0, 42]], width: 5.5 },
    { kind: 'cobble', points: [[18, 4], [26, 0]], width: 4 },
    { kind: 'cobble', points: [[-18, 6], [-26, 6]], width: 4 },
    { kind: 'cobble', points: [[-14, 15], [-26, 26]], width: 3.5 },
    { kind: 'dirt', points: [[0, -150], [0, -124], [0, -114]], width: 6 },
    { kind: 'dirt', points: [[0, 64], [2, 110], [-4, 150], [0, 196]], width: 5 },
    { kind: 'dirt', points: [[44, -6], [64, -18], [76, -30], [100, -32]], width: 4 },
    { kind: 'dirt', points: [[-50, 14], [-64, 30], [-76, 54], [-90, 74]], width: 3 },
  ];
}

/** Build the town. Same seed → identical plan. */
export function townLayout(seed = TOWN_SEED): TownLayout {
  const rng = new RNG(seed), props: Prop[] = [], colliders: Collider[] = [], paths = townPaths(), library = [...TOWN_LIBRARY];
  const rects = library.map(p => placeRect(p, 1));
  const box = (x: number, z: number, w: number, d: number, yaw: number) => colliders.push({ type: 'box', x, z, hw: w / 2, hd: d / 2, yaw });
  const circle = (x: number, z: number, r: number) => colliders.push({ type: 'circle', x, z, r });
  const onPath = (x: number, z: number, pad: number) => paths.some(p => distToPath(p, x, z) < p.width / 2 + pad) || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + pad;
  const reserved: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number) => !rects.some(q => inRect(q, x, z)) && !props.some(p => Math.hypot(p.x - x, p.z - z) < r + footprintRadius(p)) && !reserved.some(q => Math.hypot(q.x - x, q.z - z) < q.r + r);
  const put = (p: Omit<Prop, 'v'> & { v?: number }) => { const q = { v: rng.int(0, 7), ...p } as Prop; props.push(q); return q; };

  // Town wall: stone curtain with square towers, gaps at the gatehouse, north gate and east gate.
  const gate = (key: string) => placeRect(library.find(l => l.key === key)!, 0);
  const gh = gate('gatehouse'), ng = gate('north-gate');
  const wallRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 12));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, mx = x0 + (x1 - x0) * (t0 + t1) / 2, mz = z0 + (z1 - z0) * (t0 + t1) / 2, l = len / n;
      put({ kind: 'wall', x: mx, z: mz, yaw, s: 1, w: 1.4, d: l + .02, h: 4.2 }); box(mx, mz, 1.6, l, yaw);
    }
  };
  const W = WALLS, wz = gh.z0 + 14;
  wallRun(W.x0, wz, gh.x0 + 1, wz); wallRun(gh.x1 - 1, wz, W.x1, wz);
  wallRun(W.x1, wz, W.x1, -36); wallRun(W.x1, -24, W.x1, W.z1);
  wallRun(W.x1, W.z1, ng.x1 - 1, W.z1); wallRun(ng.x0 + 1, W.z1, W.x0, W.z1);
  wallRun(W.x0, W.z1, W.x0, wz);
  for (const [x, z] of [[W.x0, wz], [W.x1, wz], [W.x0, W.z1], [W.x1, W.z1], [W.x1, -36], [W.x1, -24], [W.x0, -26]] as const) { put({ kind: 'tower', x, z, yaw: 0, s: 1, w: 5, d: 5, h: 8 }); box(x, z, 5, 5, 0); }

  // Houses: plaster-and-timber dwellings lining the street north of the lane and ringing the plaza.
  const house = (x: number, z: number, faceYaw: number, w: number, d: number, h: number) => { put({ kind: 'house', x, z, yaw: faceYaw, s: 1, w, d, h }); box(x, z, w, d, faceYaw); };
  for (const side of [-1, 1]) {
    house(side * 12.5, -31.5, -side * 90 * D, 9, 7, 5.2 + rng.range(0, 1.4));
    house(side * 12, -23, -side * 90 * D, 7, 6, 4.6 + rng.range(0, 1.6));
  }
  const ring: [number, number, number, number][] = [[226, 9, 7, 5.4], [134, 8, 7, 5.4], [318, 9, 7, 5.2], [40, 9, 7, 5], [302, 8, 7, 6], [58, 8, 7, 5.6]];
  for (const [deg, w, d, h] of ring) {
    const a = deg * D, r = PLAZA.r + d / 2 + 4.5, x = PLAZA.x + Math.sin(a) * r, z = PLAZA.z + Math.cos(a) * r;
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]].map(([lx, lz]) => toTown({ x, z, yaw: a + Math.PI }, lx, lz));
    if (!corners.some(([cx, cz]) => rects.some(q => inRect(q, cx, cz)) || insideBox(colliders, cx, cz, .8))) house(x, z, a + Math.PI, w, d, h + rng.range(0, .8));
  }

  // The plaza: fountain at the centre, benches and planters around it, lamps on the rim.
  put({ kind: 'fountain', x: PLAZA.x, z: PLAZA.z, yaw: 0, s: 1, v: 0 }); circle(PLAZA.x, PLAZA.z, 3.4);
  for (let i = 0; i < 4; i++) { const a = (45 + i * 90) * D; put({ kind: 'bench', x: Math.sin(a) * 7, z: Math.cos(a) * 7, yaw: a, s: 1 }); box(Math.sin(a) * 7, Math.cos(a) * 7, 1.8, .6, a); }
  for (let i = 0; i < 4; i++) { const a = (i * 90) * D + 20 * D; const x = Math.sin(a) * 9.5, z = Math.cos(a) * 9.5; put({ kind: 'planter', x, z, yaw: a, s: 1 }); circle(x, z, .8); }
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 + 22.5) * D, x = Math.sin(a) * (PLAZA.r - 1.2), z = Math.cos(a) * (PLAZA.r - 1.2);
    if (!rects.some(q => inRect(q, x, z))) { put({ kind: 'lamp', x, z, yaw: a, s: 1 }); circle(x, z, .25); }
  }
  // Street lamps, alternating sides, from the gate to the plaza and on to the north gate.
  for (const [z0, z1] of [[-86, -76], [-36, -22], [20, 42]] as const) for (let z = z0, k = 0; z <= z1; z += 8, k++) { const x = (k % 2 ? 1 : -1) * 3.9; put({ kind: 'lamp', x, z, yaw: 0, s: 1 }); circle(x, z, .25); }

  // Market stalls along the street's north stretch and the plaza's south edge, goods beside them.
  // Each stall keeps the space behind its counter free for its vendor.
  const stall = (x: number, z: number, yaw: number) => { put({ kind: 'stall', x, z, yaw, s: 1 }); box(x, z, 3.2, 2, yaw); reserved.push({ x: x - Math.sin(yaw) * 1.6, z: z - Math.cos(yaw) * 1.6, r: 1.2 }); };
  stall(-5.7, -27.5, 90 * D); stall(5.7, -35, -90 * D);
  for (const deg of [168, 192, 112, 248]) { const a = deg * D, r = PLAZA.r - 4.2; stall(Math.sin(a) * r, Math.cos(a) * r, a + Math.PI); }
  // Clutter: crates, barrels, sacks near stalls, doors and walls, never on paths.
  const clutter: PropKind[] = ['crate', 'barrel', 'sack', 'crate', 'barrel', 'hay', 'woodpile'];
  const anchors = props.filter(p => p.kind === 'stall' || p.kind === 'house').map(p => ({ x: p.x, z: p.z, r: p.kind === 'house' ? Math.max(p.w!, p.d!) / 2 + 1 : 2.4 }));
  for (const a of anchors) {
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) for (let t = 0; t < 8; t++) {
      const ang = rng.range(0, Math.PI * 2), r = a.r + rng.range(.4, 1.4), x = a.x + Math.sin(ang) * r, z = a.z + Math.cos(ang) * r;
      if (onPath(x, z, .4) || !clear(x, z, .8) || insideBox(colliders, x, z, .7)) continue;
      const kind = rng.pick(clutter.slice(0, k ? 7 : 3)), q = put({ kind, x, z, yaw: rng.range(0, Math.PI * 2), s: rng.range(.9, 1.1) });
      if (kind === 'woodpile' || kind === 'hay') box(x, z, 1.6 * q.s, 1 * q.s, q.yaw); else circle(x, z, footprintRadius(q));
      break;
    }
  }
  // A cart by the tavern, a notice board and signpost on the plaza, banners at the gates.
  put({ kind: 'cart', x: 21, z: 13, yaw: 200 * D, s: 1 }); box(21, 13, 1.8, 3.2, 200 * D);
  put({ kind: 'notice', x: -12, z: -17, yaw: 35 * D, s: 1 }); box(-12, -17, 1.8, .4, 35 * D);
  put({ kind: 'sign', x: 4.8, z: 18.5, yaw: 0, s: 1 }); circle(4.8, 18.5, .2);
  put({ kind: 'well', x: -20, z: -48, yaw: 0, s: 1 }); circle(-20, -48, 1.2);
  for (const x of [-5.5, 5.5]) { put({ kind: 'banner', x, z: gh.z1 + 1.5, yaw: 0, s: 1 }); circle(x, gh.z1 + 1.5, .2); put({ kind: 'banner', x: x * .9, z: ng.z0 - 1.5, yaw: 0, s: 1 }); circle(x * .9, ng.z0 - 1.5, .2); }
  // Fenced kitchen gardens in the quiet corners.
  for (const [gx, gz] of [[-56, -80], [54, -78], [52, 32]] as const) {
    const w = 12, d = 9;
    for (const [x, z, yaw, l] of [[gx, gz - d / 2, 90 * D, w], [gx, gz + d / 2, 90 * D, w], [gx - w / 2, gz, 0, d], [gx + w / 2, gz + d / 4, 0, d / 2]] as const) { put({ kind: 'fence', x, z, yaw, s: 1, w: .12, d: l, h: 1.1 }); box(x, z, .2, l, yaw); }
    for (let i = 0; i < 6; i++) put({ kind: 'flowers', x: gx + rng.range(-w / 2 + 1.2, w / 2 - 1.2), z: gz + rng.range(-d / 2 + 1, d / 2 - 1), yaw: rng.range(0, 6.3), s: rng.range(.8, 1.3) });
  }
  // Greenery inside: shade trees on the plaza edges and in yards (library saplings and procedural trees).
  for (const [x, z] of [[-17, -15], [16, -16], [-15, 17], [17, 18], [-60, -40], [58, -50], [-62, 10], [60, 6], [-40, -84], [40, -86], [-16, -60], [18, 42]] as const) {
    if (!clear(x, z, 2) || onPath(x, z, 1.5) || insideBox(colliders, x, z, 2)) continue;
    put({ kind: 'tree', x, z, yaw: rng.range(0, 6.3), s: rng.range(.85, 1.2) }); circle(x, z, .45);
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.range(W.x0 + 4, W.x1 - 4), z = rng.range(W.z0 + 4, W.z1 - 4);
    if (!clear(x, z, 1.4) || onPath(x, z, 1) || insideBox(colliders, x, z, 1.2)) continue;
    put({ kind: rng.chance(.5) ? 'bush' : 'flowers', x, z, yaw: rng.range(0, 6.3), s: rng.range(.7, 1.3) });
  }
  // Outside the walls: meadow with library oaks and willows, boulders, and pines on the rim hills.
  for (let i = 0; i < 520; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * (BOUNDS.r + 70), x = BOUNDS.x + Math.sin(a) * r, z = BOUNDS.z + Math.cos(a) * r;
    if (x > W.x0 - 6 && x < W.x1 + 6 && z > W.z0 - 6 && z < W.z1 + 6) continue;
    if (onPath(x, z, 3) || !clear(x, z, 2.2) || Math.hypot(x - TOWER.x, z - TOWER.z) < 34) continue;
    const rim = r > BOUNDS.r - 35, kind: PropKind = rim ? (rng.chance(.75) ? 'pine' : 'tree') : rng.pick(['sapling', 'sapling', 'tree', 'bush', 'boulder', 'rock', 'pine'] as const);
    if (!rim && rng.chance(.35)) continue;
    const q = put({ kind, x, z, yaw: rng.range(0, Math.PI * 2), s: kind === 'pine' ? rng.range(.8, 1.4) : rng.range(.8, 1.25) });
    if (r < BOUNDS.r + 5) { if (kind === 'boulder') circle(x, z, 1.7 * q.s); else if (kind !== 'bush' && kind !== 'rock') circle(x, z, kind === 'sapling' ? .3 : .45); }
  }
  // The Tower's own stone footprint (it is a landmark here; its floors are the Tower game).
  circle(TOWER.x, TOWER.z, 16);

  const npcs = townNpcs(rng.fork(77), props);
  return {
    seed, library, props, colliders, paths, plaza: { ...PLAZA }, spawn: { x: 0, z: -77, yaw: 0 },
    tower: { x: TOWER.x, z: TOWER.z, y: towerBase() }, npcs, bounds: { ...BOUNDS }, walls: { ...WALLS },
  };
}
export function footprintRadius(p: Prop): number {
  switch (p.kind) {
    case 'house': case 'wall': case 'fence': case 'tower': return Math.max(p.w ?? 1, p.d ?? 1) / 2;
    case 'stall': return 1.8; case 'fountain': return 3.4; case 'cart': return 1.7; case 'tree': return 1.2 * p.s; case 'pine': return 1 * p.s;
    case 'boulder': return 2 * p.s; case 'barrel': return .4 * p.s; case 'crate': return .5 * p.s; case 'sack': return .4 * p.s; case 'hay': case 'woodpile': return .9 * p.s;
    default: return .5 * p.s;
  }
}
function insideBox(colliders: Collider[], x: number, z: number, pad: number): boolean {
  return colliders.some(c => c.type === 'box' && (() => { const [lx, lz] = toLocal(c, x, z); return Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad; })());
}
const PALETTE = [0x8a3b2e, 0x3d5a80, 0x6b7a3a, 0x9a7a3c, 0x5a4a6e, 0x7a5232, 0x2f6a6a, 0xa0603a, 0x4a5a3a, 0x8c6c8c];
/** Townsfolk: vendors at the stalls, guards at the gates, patrons by the tavern, strollers in the plaza. */
function townNpcs(rng: RNG, props: Prop[]): NpcSpec[] {
  const out: NpcSpec[] = [], col = () => rng.pick(PALETTE);
  props.filter(p => p.kind === 'stall').forEach((s, i) => {
    // Behind the counter: the stall's back side (local -z).
    const bx = s.x - Math.sin(s.yaw) * 1.6, bz = s.z - Math.cos(s.yaw) * 1.6; out.push({ id: `vendor-${i}`, role: 'vendor', x: bx, z: bz, radius: 1, facing: s.yaw, colour: col() });
  });
  out.push({ id: 'guard-south-0', role: 'guard', x: -4.2, z: -80, radius: 1.5, facing: 0, colour: 0x4a4f5a }, { id: 'guard-south-1', role: 'guard', x: 4.2, z: -80, radius: 1.5, facing: 0, colour: 0x4a4f5a });
  out.push({ id: 'guard-north', role: 'guard', x: 3.6, z: 38, radius: 2, facing: Math.PI, colour: 0x4a4f5a });
  out.push({ id: 'patron-0', role: 'patron', x: 21, z: 4, radius: 3, facing: -Math.PI / 2, colour: col() }, { id: 'patron-1', role: 'patron', x: 20, z: -5, radius: 3, facing: -Math.PI / 2, colour: col() });
  for (let i = 0; i < 6; i++) { const a = rng.range(0, Math.PI * 2); out.push({ id: `stroller-${i}`, role: 'stroller', x: Math.sin(a) * 13, z: Math.cos(a) * 13, radius: i < 4 ? 15 : 34, facing: a, colour: col() }); }
  return out;
}
