import { FAR_ANCHOR, HOME_ANCHOR, add, arc, chartToHome, climateAt, dirToChart, landmarkSites, normalize, scale, tangentFrame, type Biome, type PlanetSpec, type V3 } from './planet';
import { nearRoad } from './roads';

/** Seeded props over the whole sphere (trees, boulders), addressed by cube-sphere cells so any
 * consumer — renderer, walker collision, tests — derives the same set for a neighbourhood
 * without generating the planet. Library ids name the asset each prop instantiates. */
export type PropKind = 'oak' | 'willow' | 'pine' | 'boulder' | 'shrub' | 'ruin' | 'rubble';
export const PROP_ASSET: Record<PropKind, string | null> = { oak: 'tvn_flora_001', willow: 'tvn_flora_005', pine: null, boulder: 'tvn_biome_021', shrub: null, ruin: null, rubble: null };
/** Kinds drawn from the focused runtime pack's module catalog instead of the library. */
export const PROP_MODULE: Partial<Record<PropKind, string>> = { ruin: 'module:broken_column', rubble: 'module:masonry_rubble' };
export interface Prop { id: string; kind: PropKind; dir: V3; yaw: number; scale: number; radius: number }
export const SCATTER_N = 192;
const DENSITY: Record<Biome, [PropKind, number][]> = {
  ocean: [], snow: [], beach: [['willow', .02]],
  grassland: [['oak', .12], ['boulder', .05], ['shrub', .25]],
  forest: [['oak', 1.1], ['willow', .15], ['shrub', .5], ['boulder', .05]],
  taiga: [['pine', 1.4], ['boulder', .08]],
  tundra: [['boulder', .15], ['shrub', .08]],
  desert: [['boulder', .03]],
  savanna: [['oak', .08], ['shrub', .2], ['boulder', .03]],
  swamp: [['willow', .7], ['shrub', .4]],
  mountain: [['boulder', .45], ['pine', .12]],
};
const TRUNK: Record<PropKind, number> = { oak: .35, willow: .3, pine: .3, boulder: 1.5, shrub: 0, ruin: .6, rubble: .9 };
/** Chance per scatter cell (~6.8k m²) of a small ruin: broken columns and masonry rubble
 * around one point — old stonework weathering in open country. */
const RUIN: Record<Biome, number> = { ocean: 0, snow: 0, beach: 0, grassland: .05, forest: .015, taiga: .01, tundra: .03, desert: .05, savanna: .05, swamp: .01, mountain: .03 };
function hash(a: number, b: number, c: number, d: number, seed: number) {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1440662683) + Math.imul(d, 3266489917) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Cube face f (0..5: +x -x +y -y +z -z) with face coordinates u, v in [-1, 1]. */
export function cubeToDir(f: number, u: number, v: number): V3 {
  const p = [{ x: 1, y: v, z: -u }, { x: -1, y: v, z: u }, { x: u, y: 1, z: -v }, { x: u, y: -1, z: v }, { x: u, y: v, z: 1 }, { x: -u, y: v, z: -1 }][f];
  return normalize(p);
}
export function dirToCube(d: V3): { f: number; u: number; v: number } {
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  if (ax >= ay && ax >= az) return d.x > 0 ? { f: 0, u: -d.z / ax, v: d.y / ax } : { f: 1, u: d.z / ax, v: d.y / ax };
  if (ay >= az) return d.y > 0 ? { f: 2, u: d.x / ay, v: -d.z / ay } : { f: 3, u: d.x / ay, v: d.z / ay };
  return d.z > 0 ? { f: 4, u: d.x / az, v: d.y / az } : { f: 5, u: -d.x / az, v: d.y / az };
}
/** Authored ground stays clear: the charted town/forest/Tower route and the far realm's square. */
export function reserved(spec: PlanetSpec, d: V3): boolean {
  const a = arc(spec, d, HOME_ANCHOR);
  if (a < 520) { const c = chartToHome(spec, d); if (c.east > -150 && c.east < 150 && c.north > -210 && c.north < 240) return true; }
  const f = arc(spec, d, FAR_ANCHOR);
  if (f < 200) return true;
  if (f < 420) { const c = dirToChart(FAR_ANCHOR, d, spec.radius); if (Math.abs(c.east) < 70 && c.north > -310 && c.north < -140) return true; }
  // Landmark settlements keep their levelled ground clear.
  for (const site of landmarkSites(spec)) if (arc(spec, d, site.dir) < 48) return true;
  return nearRoad(spec, d);
}
export function scatterCell(spec: PlanetSpec, f: number, i: number, j: number): Prop[] {
  const n = SCATTER_N, centre = cubeToDir(f, (i + .5) / n * 2 - 1, (j + .5) / n * 2 - 1), biome = climateAt(spec, centre).biome, out: Prop[] = [];
  let k = 0;
  for (const [kind, density] of DENSITY[biome]) {
    // Expected count = density × cell area (~(πR/2n)²) / 256 m².
    const area = (Math.PI * spec.radius / 2 / n) ** 2 / 256, expected = density * area;
    let count = Math.floor(expected); if (hash(f, i, j, k * 7 + 1, spec.seed) < expected - count) count++;
    for (let c = 0; c < count; c++, k++) {
      const u = (i + hash(f, i, j, k * 5 + 2, spec.seed)) / n * 2 - 1, v = (j + hash(f, i, j, k * 5 + 3, spec.seed)) / n * 2 - 1, dir = cubeToDir(f, u, v);
      if (reserved(spec, dir) || climateAt(spec, dir).height < 1.5) continue;
      const s = .75 + hash(f, i, j, k * 5 + 4, spec.seed) * .6;
      out.push({ id: `${f}:${i}:${j}:${k}`, kind, dir, yaw: hash(f, i, j, k * 5 + 5, spec.seed) * Math.PI * 2, scale: s, radius: TRUNK[kind] * s });
    }
  }
  // A ruin: 2-4 columns on a rough ring and 1-3 rubble piles, all on dry unreserved ground.
  if (hash(f, i, j, 911, spec.seed) < RUIN[biome]) {
    const u = (i + .2 + .6 * hash(f, i, j, 912, spec.seed)) / n * 2 - 1, v = (j + .2 + .6 * hash(f, i, j, 913, spec.seed)) / n * 2 - 1, centre = cubeToDir(f, u, v), fr = tangentFrame(centre);
    const ring = 3.5 + 3 * hash(f, i, j, 914, spec.seed), cols = 2 + Math.floor(hash(f, i, j, 915, spec.seed) * 3), piles = 1 + Math.floor(hash(f, i, j, 916, spec.seed) * 3), turn = hash(f, i, j, 917, spec.seed) * Math.PI * 2;
    for (let q = 0; q < cols + piles; q++, k++) {
      const col = q < cols, a = turn + (col ? q / cols * Math.PI * 2 : hash(f, i, j, 920 + q, spec.seed) * Math.PI * 2), r = col ? ring : ring * hash(f, i, j, 930 + q, spec.seed) * .8;
      const dir = normalize(add(centre, add(scale(fr.east, Math.sin(a) * r / spec.radius), scale(fr.north, Math.cos(a) * r / spec.radius))));
      if (reserved(spec, dir) || climateAt(spec, dir).height < 1.5) continue;
      const kind: PropKind = col ? 'ruin' : 'rubble', sc = .85 + hash(f, i, j, 940 + q, spec.seed) * .3;
      out.push({ id: `${f}:${i}:${j}:${k}`, kind, dir, yaw: hash(f, i, j, 950 + q, spec.seed) * Math.PI * 2, scale: sc, radius: TRUNK[kind] * sc });
    }
  }
  return out;
}
const cellCache = new Map<string, Prop[]>();
export function propsNear(spec: PlanetSpec, dir: V3, metres: number): Prop[] {
  const { f, u, v } = dirToCube(normalize(dir)), n = SCATTER_N, ci = Math.floor((u + 1) / 2 * n), cj = Math.floor((v + 1) / 2 * n);
  const span = Math.ceil(metres / (Math.PI * spec.radius / 2 / n)) + 1, out: Prop[] = [], seen = new Set<string>();
  for (let di = -span; di <= span; di++) for (let dj = -span; dj <= span; dj++) {
    let i = ci + di, j = cj + dj;
    // Off-face neighbours: resolve through the direction of the cell centre.
    let face = f;
    if (i < 0 || j < 0 || i >= n || j >= n) { const c = dirToCube(cubeToDir(f, (i + .5) / n * 2 - 1, (j + .5) / n * 2 - 1)); face = c.f; i = Math.min(n - 1, Math.max(0, Math.floor((c.u + 1) / 2 * n))); j = Math.min(n - 1, Math.max(0, Math.floor((c.v + 1) / 2 * n))); }
    const key = `${spec.seed}:${spec.radius}:${face}:${i}:${j}`; if (seen.has(key)) continue; seen.add(key);
    let props = cellCache.get(key);
    if (!props) { props = scatterCell(spec, face, i, j); if (cellCache.size > 60000) cellCache.clear(); cellCache.set(key, props); }
    for (const p of props) if (arc(spec, p.dir, dir) <= metres) out.push(p);
  }
  return out;
}
