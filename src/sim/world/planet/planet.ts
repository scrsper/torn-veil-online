/** The world as a sphere. Pure, seeded geography: no renderer, clock or live RNG.
 * Planet-centred metres; +Y is the rotation axis (north pole). The same spec always
 * yields the same terrain, biomes and regions, independent of call order.
 *
 * The existing flat realm layouts (Cinderveil's town → forest → Tower route, Aether
 * Reach) keep their own canonical coordinates. They are charted onto the sphere through
 * a tangent-plane map around an anchor, and the terrain is levelled there so their
 * flat geometry sits on the surface without seams. */
import { ravineDepth } from './ravines';
export interface PlanetSpec { version: 1; seed: number; radius: number }
export interface V3 { x: number; y: number; z: number }
export type Biome = 'ocean' | 'beach' | 'grassland' | 'forest' | 'taiga' | 'tundra' | 'desert' | 'savanna' | 'swamp' | 'mountain' | 'snow';
export const BIOMES: readonly Biome[] = ['ocean', 'beach', 'grassland', 'forest', 'taiga', 'tundra', 'desert', 'savanna', 'swamp', 'mountain', 'snow'];
export const PLANET_RADIUS = 1600;
/** Highest land relief above the sea sphere, metres. */
export const RELIEF = 140;
/** Level ground at the home anchor (metres above sea) and its radii (arc metres). */
export const HOME_PLATEAU = { height: 6, flat: 460, blend: 760 };
export function planetSpec(seed: number, radius = PLANET_RADIUS): PlanetSpec {
  if (!Number.isInteger(seed) || !(radius >= 200 && radius <= 100000)) throw Error('Unsupported planet spec');
  return { version: 1, seed: seed >>> 0, radius };
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: V3, s: number): V3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
export function normalize(a: V3): V3 { const l = length(a); return l > 1e-12 ? scale(a, 1 / l) : v3(0, 1, 0); }
/** Latitude/longitude in degrees → unit direction. Longitude 0 faces +Z, 90 faces +X. */
export function fromLatLon(lat: number, lon: number): V3 {
  const a = lat * Math.PI / 180, o = lon * Math.PI / 180;
  return v3(Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o));
}
export function toLatLon(d: V3): { lat: number; lon: number } {
  const n = normalize(d);
  return { lat: Math.asin(Math.max(-1, Math.min(1, n.y))) * 180 / Math.PI, lon: Math.atan2(n.x, n.z) * 180 / Math.PI };
}
/** Great-circle distance in metres along the sea sphere. */
export function arc(spec: PlanetSpec, a: V3, b: V3) { return Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) * spec.radius; }
/** Local east/north/up frame at a direction. Degenerate at the poles; there north falls back to +Z. */
export function tangentFrame(d: V3): { up: V3; east: V3; north: V3 } {
  const up = normalize(d);
  let east = cross(v3(0, 1, 0), up);
  if (length(east) < 1e-6) east = v3(1, 0, 0);
  east = normalize(east);
  return { up, east, north: normalize(cross(up, east)) };
}
/** Spherical gravity: toward the centre, constant magnitude at the surface. */
export const GRAVITY = 9.81;
export function gravityAt(p: V3): V3 { return scale(normalize(p), -GRAVITY); }

// Seeded 3D value noise. Integer lattice hash, smooth interpolation, fractal sum.
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440662683) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export function fbm3(p: V3, octaves: number, seed: number): number {
  let sum = 0, amp = .5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += noise3(p.x * freq, p.y * freq, p.z * freq, seed + i * 31) * amp; norm += amp; amp *= .5; freq *= 2.03; }
  return sum / norm;
}
const smooth = (a: number, b: number, t: number) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const salt = (spec: PlanetSpec, n: number) => (Math.imul(spec.seed ^ 0x5eed, 2654435761) + n * 97) | 0;

/** Home anchor: Cinderveil (the focused town/forest/Tower route), and the far realm. */
export const HOME_ANCHOR = Object.freeze(fromLatLon(18, 0));
/** The preserved first-hour route on the home chart (north metres): town, then forest, then the Tower. */
export const HOME_ROUTE = Object.freeze({ town: [-60, 90] as const, forest: [120, 330] as const, tower: { east: 0, north: 390 } });
export const FAR_ANCHOR = Object.freeze(fromLatLon(-12, 180));

/** Raw continental relief in [-1, 1] before the home plateau is levelled. */
function relief(spec: PlanetSpec, d: V3): number {
  const base = fbm3(scale(d, 1.7), 5, salt(spec, 1)) * 2 - 1;
  const ridges = 1 - Math.abs(fbm3(scale(d, 4.1), 4, salt(spec, 2)) * 2 - 1);
  return base * 1.35 + Math.max(0, base) * ridges * .9 + .08;
}
function rawHeight(spec: PlanetSpec, d: V3) { const e = relief(spec, d); return e > 0 ? Math.pow(e, 1.4) * RELIEF : e * RELIEF * .5; }
/** Region centres: home, far, then a seeded jittered Fibonacci lattice. Positions only (no
 * height dependence), so terrain may level landmark sites at them without a cycle. */
export const REGION_SITES = 28;
const siteCache = new WeakMap<PlanetSpec, V3[]>();
export function regionCentres(spec: PlanetSpec): V3[] {
  const hit = siteCache.get(spec); if (hit) return hit;
  let s = (spec.seed ^ 0x7e610e5) >>> 0;
  const next = () => { let t = s = (s + 0x6D2B79F5) >>> 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const range = (a: number, b: number) => a + (b - a) * next(), golden = Math.PI * (3 - Math.sqrt(5)), out: V3[] = [HOME_ANCHOR, FAR_ANCHOR];
  for (let k = 0; k < REGION_SITES - 2; k++) {
    const n = REGION_SITES - 2, y = 1 - (k + .5) / n * 2, r = Math.sqrt(1 - y * y), t = golden * k + range(-.35, .35);
    let c = normalize({ x: Math.cos(t) * r + range(-.12, .12), y: y + range(-.08, .08), z: Math.sin(t) * r + range(-.12, .12) });
    if (dot(c, HOME_ANCHOR) > .96 || dot(c, FAR_ANCHOR) > .96) c = normalize({ x: -c.x, y: c.y, z: -c.z });
    out.push(c);
  }
  siteCache.set(spec, out); return out;
}
/** Levelled landmark sites at land region centres (index ≥ 2): flat ground for a settlement. */
export const LANDMARK_PLATEAU = { flat: 38, blend: 90 };
const landmarkCache = new WeakMap<PlanetSpec, { dir: V3; height: number; region: number }[]>();
export function landmarkSites(spec: PlanetSpec): { dir: V3; height: number; region: number }[] {
  const hit = landmarkCache.get(spec); if (hit) return hit;
  const clear = (d: V3) => [HOME_ANCHOR, FAR_ANCHOR].every(a => arc(spec, d, a) > HOME_PLATEAU.blend + LANDMARK_PLATEAU.blend);
  const out = regionCentres(spec).slice(2).map((dir, i) => ({ dir, height: rawHeight(spec, dir), region: i + 2 }))
    .filter(s => s.height > 3 && s.height < RELIEF * .7 && clear(s.dir));
  landmarkCache.set(spec, out); return out;
}
/** Height above the sea sphere in metres (negative under water): the levelled ground with
 * the ravines under the bridges carved out. */
export function surfaceHeight(spec: PlanetSpec, dir: V3): number {
  const d = normalize(dir);
  return siteHeight(spec, d) - ravineDepth(spec, d);
}
/** The levelled ground before ravines are carved: where whole-space placements are seated,
 * and what climate and biome read (a gorge keeps its surroundings' biome). */
export function siteHeight(spec: PlanetSpec, dir: V3): number {
  const d = normalize(dir), raw = rawHeight(spec, d);
  let h = raw;
  for (const site of landmarkSites(spec)) {
    const c = dot(d, site.dir); if (c < .99) continue;
    const t = 1 - smooth(LANDMARK_PLATEAU.flat, LANDMARK_PLATEAU.blend, Math.acos(Math.min(1, c)) * spec.radius);
    h = h + (site.height - h) * t;
  }
  for (const anchor of [HOME_ANCHOR, FAR_ANCHOR]) {
    const t = 1 - smooth(HOME_PLATEAU.flat, HOME_PLATEAU.blend, arc(spec, d, anchor));
    // Levelled ground around each charted realm, never below the shore.
    h = h + (HOME_PLATEAU.height - h) * t;
  }
  return h;
}
export function surfaceRadius(spec: PlanetSpec, dir: V3): number { return spec.radius + surfaceHeight(spec, dir); }
export function siteRadius(spec: PlanetSpec, dir: V3): number { return spec.radius + siteHeight(spec, dir); }
export function surfacePoint(spec: PlanetSpec, dir: V3): V3 { const d = normalize(dir); return scale(d, surfaceRadius(spec, d)); }
/** Outward surface normal by central differences on the height field. */
export function surfaceNormal(spec: PlanetSpec, dir: V3, step = 2): V3 {
  const { east, north } = tangentFrame(dir), d = normalize(dir), a = step / spec.radius;
  const at = (de: number, dn: number) => surfacePoint(spec, add(d, add(scale(east, de * a), scale(north, dn * a))));
  const n = cross(sub(at(0, 1), at(0, -1)), sub(at(1, 0), at(-1, 0)));
  return dot(n, d) < 0 ? normalize(scale(n, -1)) : normalize(n);
}

export interface Climate { height: number; temperature: number; moisture: number; biome: Biome }
/** Temperature falls with latitude and altitude; moisture is a seeded field. */
export function climateAt(spec: PlanetSpec, dir: V3): Climate {
  const d = normalize(dir);
  return { ...climateOf(spec, d, siteHeight(spec, d)), height: surfaceHeight(spec, d) };
}
function climateOf(spec: PlanetSpec, d: V3, height: number): Climate {
  const lat = Math.abs(Math.asin(Math.max(-1, Math.min(1, d.y))));
  const temperature = Math.max(0, Math.min(1, Math.cos(lat) * 1.1 - .12 - Math.max(0, height) / RELIEF * .55 + (fbm3(scale(d, 3), 3, salt(spec, 3)) - .5) * .25));
  const moisture = Math.max(0, Math.min(1, fbm3(scale(d, 2.6), 4, salt(spec, 4)) * 1.5 - .25));
  return { height, temperature, moisture, biome: classify(height, temperature, moisture) };
}
export function classify(height: number, t: number, m: number): Biome {
  if (height < -1) return 'ocean';
  if (height < 2.5) return t < .2 ? 'tundra' : 'beach';
  if (height > RELIEF * .62) return t < .45 ? 'snow' : 'mountain';
  if (t < .18) return 'snow';
  if (t < .32) return m > .45 ? 'taiga' : 'tundra';
  if (t > .72) return m < .3 ? 'desert' : m < .55 ? 'savanna' : m > .78 && height < 20 ? 'swamp' : 'forest';
  if (m > .8 && height < 16) return 'swamp';
  return m > .5 ? 'forest' : 'grassland';
}
export function biomeAt(spec: PlanetSpec, dir: V3): Biome {
  const d = normalize(dir);
  // The charted home route keeps its authored meadow/forest identity.
  if (arc(spec, d, HOME_ANCHOR) < HOME_PLATEAU.flat) { const n = chartToHome(spec, d).north; return n > HOME_ROUTE.forest[0] && n < HOME_ROUTE.forest[1] ? 'forest' : 'grassland'; }
  return climateOf(spec, d, siteHeight(spec, d)).biome;
}

/** Tangent-plane chart (azimuthal equidistant) around an anchor: east/north metres ↔ direction.
 * Distances along the chart's radial lines are exact arc lengths. */
export function chartToDir(anchor: V3, east: number, north: number, radius: number): V3 {
  const r = Math.hypot(east, north); if (r < 1e-9) return normalize(anchor);
  const f = tangentFrame(anchor), t = normalize(add(scale(f.east, east / r), scale(f.north, north / r))), a = r / radius;
  return normalize(add(scale(f.up, Math.cos(a)), scale(t, Math.sin(a))));
}
export function dirToChart(anchor: V3, dir: V3, radius: number): { east: number; north: number } {
  const f = tangentFrame(anchor), d = normalize(dir), c = Math.max(-1, Math.min(1, dot(d, f.up))), a = Math.acos(c);
  const t = sub(d, scale(f.up, c)), tl = length(t);
  if (tl < 1e-12) return { east: 0, north: 0 };
  return { east: dot(t, f.east) / tl * a * radius, north: dot(t, f.north) / tl * a * radius };
}
export const homeToDir = (spec: PlanetSpec, east: number, north: number) => chartToDir(HOME_ANCHOR, east, north, spec.radius);
export const chartToHome = (spec: PlanetSpec, dir: V3) => dirToChart(HOME_ANCHOR, dir, spec.radius);
