/**
 * Versioned, random-access universe geography. Coordinates and relief are metres;
 * centers are system-local, terrain queries and landing sites are planet-local.
 * Output never depends on a renderer, clock, shared RNG, or cache state.
 */
import {
  HOME_ANCHOR, add, cross, dot, normalize, planetSpec, scale, sub, surfaceHeight,
  tangentFrame, type PlanetSpec, type V3,
} from '../planet/planet';

export interface UniverseSpec { version: 1; seed: number }
export type PlanetKind = 'temperate' | 'desert' | 'glacial' | 'volcanic' | 'oceanic';
export interface PlanetDescriptor {
  id: string;
  index: number;
  seed: number;
  name: string;
  radius: number;
  center: V3;
  /** Thickness of the atmosphere above the sea sphere, in metres. */
  atmosphere: number;
  kind: PlanetKind;
  palette: { land: string; rock: string; water: string; sky: string };
  gravity: number;
}
export interface StarSystem {
  id: string;
  index: number;
  seed: number;
  name: string;
  planets: PlanetDescriptor[];
}

const UINT_RANGE = 0x100000000;
const MAX_SYSTEM_INDEX = 65535;
const KINDS: readonly PlanetKind[] = ['temperate', 'desert', 'glacial', 'volcanic', 'oceanic'];
const PALETTES: Record<PlanetKind, PlanetDescriptor['palette']> = {
  temperate: { land: '#5b7650', rock: '#777369', water: '#184e68', sky: '#84bad8' },
  desert: { land: '#d1a465', rock: '#976547', water: '#346f72', sky: '#e6ad7e' },
  glacial: { land: '#d7e5e9', rock: '#7195a4', water: '#244c76', sky: '#a4c8e5' },
  volcanic: { land: '#4d4141', rock: '#7c4a3e', water: '#452e42', sky: '#bd715f' },
  oceanic: { land: '#6e9e78', rock: '#7e9290', water: '#136782', sky: '#92d4dc' },
};
const NAME_START = ['Astra', 'Orun', 'Thale', 'Istra', 'Vesper', 'Nacre', 'Ebon', 'Sere', 'Luma', 'Arden'];
const NAME_END = ['reach', 'mere', 'fall', 'hollow', 'wake', 'veil', 'spire', 'rest', 'drift', 'ward'];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** A keyed stream: querying any other field never advances or perturbs this one. */
function key(seed: number, label: string): number {
  let h = (seed ^ 2166136261) >>> 0;
  for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const fraction = (seed: number, label: string) => key(seed, label) / UINT_RANGE;
// Bounded reuse retains descriptor-keyed terrain/landing caches during travel.
// Deep freezing prevents one caller from changing another caller's geography.
const SYSTEM_CACHE_LIMIT = 64;
const systems = new Map<string, StarSystem>();

export function universeSpec(seed: number): UniverseSpec {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Universe seed must be a safe integer');
  return { version: 1, seed: seed >>> 0 };
}

/** Generate only the requested system. Returned descriptors are deeply immutable. */
export function generateSystem(spec: UniverseSpec, index: number): StarSystem {
  if (spec.version !== 1 || !Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed >= UINT_RANGE)
    throw new RangeError('Unsupported universe spec');
  if (!Number.isInteger(index) || index < 0 || index > MAX_SYSTEM_INDEX)
    throw new RangeError('System index must be an integer from 0 to 65535');
  const id = `u1:${spec.seed}:s${index}`;
  const cached = systems.get(id);
  if (cached) {
    systems.delete(id); systems.set(id, cached);
    return cached;
  }
  const seed = key(spec.seed, `system:${index}`);
  const count = 4 + key(seed, 'planet-count') % 3;
  const kindOffset = key(seed, 'kind-order') % KINDS.length;
  const phase = fraction(seed, 'orbital-phase') * Math.PI * 2;
  const planets: PlanetDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    const home = index === 0 && i === 0;
    const planetSeed = home ? spec.seed : key(seed, `planet:${i}`);
    const kind = home ? 'temperate' : KINDS[(kindOffset + i) % KINDS.length];
    const radius = home ? 1600 : Math.round(1100 + fraction(planetSeed, 'radius') * 1500);
    // The primary is the local origin. Others have well-separated, mildly inclined
    // orbits; maximum pair separation stays below 80 km at this playable scale.
    const orbitalRadius = 22000 + i * 3000 + fraction(planetSeed, 'orbit-radius') * 900;
    const angle = phase + i * Math.PI * (3 - Math.sqrt(5));
    const center = i === 0 ? { x: 0, y: 0, z: 0 } : {
      x: Math.cos(angle) * orbitalRadius,
      y: (fraction(planetSeed, 'orbit-inclination') - .5) * 4000,
      z: Math.sin(angle) * orbitalRadius,
    };
    planets.push({
      id: `${id}:p${i}`, index: i, seed: planetSeed, radius, center, kind,
      name: home ? 'Cinderveil' : `${NAME_START[key(planetSeed, 'name-start') % NAME_START.length]}${NAME_END[key(planetSeed, 'name-end') % NAME_END.length]} ${i + 1}`,
      atmosphere: Math.round(120 + fraction(planetSeed, 'atmosphere') * 180),
      gravity: home ? 9.81 : Math.round((4.5 + fraction(planetSeed, 'gravity') * 9) * 100) / 100,
      palette: { ...PALETTES[kind] },
    });
  }
  const system: StarSystem = {
    id, index, seed,
    name: index === 0 ? 'Cinderveil Expanse' : `${NAME_START[key(seed, 'name') % NAME_START.length]} ${index.toString(16).toUpperCase().padStart(4, '0')}`,
    planets,
  };
  for (const planet of planets) {
    Object.freeze(planet.center); Object.freeze(planet.palette); Object.freeze(planet);
  }
  Object.freeze(planets); Object.freeze(system);
  systems.set(id, system);
  if (systems.size > SYSTEM_CACHE_LIMIT) systems.delete(systems.keys().next().value!);
  return system;
}

function isHome(planet: PlanetDescriptor): boolean {
  return planet.id === `u1:${planet.seed}:s0:p0`;
}
const homeSpecs = new WeakMap<PlanetDescriptor, PlanetSpec>();
function homeSpec(planet: PlanetDescriptor): PlanetSpec {
  let spec = homeSpecs.get(planet);
  if (!spec) { spec = planetSpec(planet.seed, planet.radius); homeSpecs.set(planet, spec); }
  return spec;
}

// Value noise in Cartesian space avoids longitude seams and pole pinching.
function lattice(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / UINT_RANGE * 2 - 1;
}
function noise(seed: number, p: V3): number {
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  const u = smooth(p.x - x), v = smooth(p.y - y), w = smooth(p.z - z);
  const corner = (dx: number, dy: number, dz: number) => lattice(seed, x + dx, y + dy, z + dz);
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v), w,
  );
}
function fractal(seed: number, p: V3, octaves: number): number {
  let value = 0, amplitude = 1, weight = 0, frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += noise((seed + Math.imul(i, 0x9e3779b1)) >>> 0, scale(p, frequency)) * amplitude;
    weight += amplitude; amplitude *= .48; frequency *= 2.07;
  }
  return value / weight;
}
interface TerrainFields { continent: number; ridge: number; detail: number; moisture: number }
const fieldsCache = new WeakMap<PlanetDescriptor, TerrainFields>();
function fields(planet: PlanetDescriptor): TerrainFields {
  let result = fieldsCache.get(planet);
  if (!result) {
    result = {
      continent: key(planet.seed, 'terrain:continent'), ridge: key(planet.seed, 'terrain:ridge'),
      detail: key(planet.seed, 'terrain:detail'), moisture: key(planet.seed, 'terrain:moisture'),
    };
    fieldsCache.set(planet, result);
  }
  return result;
}

/** Signed relief above sea level. New worlds have no copied home/settlement pads. */
export function terrainHeight(planet: PlanetDescriptor, unitDir: V3): number {
  if (isHome(planet)) return surfaceHeight(homeSpec(planet), unitDir);
  const d = normalize(unitDir), f = fields(planet);
  const continental = fractal(f.continent, scale(d, 2.6), 4);
  const ridges = 1 - Math.abs(fractal(f.ridge, scale(d, 5.8), 3));
  const detail = fractal(f.detail, scale(d, 19), 3);
  const relief = planet.radius * .105;
  let elevation: number;
  switch (planet.kind) {
    case 'desert':
      elevation = .24 + continental * .8 + Math.sin((d.x * 7 + d.z * 11 + continental * 4) * 3) * .035 + detail * .045;
      break;
    case 'glacial':
      elevation = .1 + continental * .95 + Math.pow(ridges, 5) * Math.max(0, continental + .08) * .7 + detail * .04;
      break;
    case 'volcanic':
      elevation = .16 + continental * .8 + Math.pow(ridges, 7) * Math.max(0, continental + .2) + detail * .06;
      break;
    case 'oceanic':
      elevation = -.22 + continental * 1.12 + Math.max(0, continental) * ridges * .2 + detail * .025;
      break;
    default:
      elevation = .025 + continental + Math.max(0, continental) * Math.pow(ridges, 3) * .45 + detail * .05;
  }
  return clamp(elevation * relief, -planet.radius * .12, planet.radius * .19);
}

/** Outward normal from the same canonical height field used for collision. */
export function terrainNormal(planet: PlanetDescriptor, unitDir: V3): V3 {
  const d = normalize(unitDir), frame = tangentFrame(d), step = 1 / planet.radius;
  const at = (axis: V3, sign: number) => {
    const n = normalize(add(d, scale(axis, sign * step)));
    return scale(n, planet.radius + terrainHeight(planet, n));
  };
  let normal = normalize(cross(sub(at(frame.east, 1), at(frame.east, -1)), sub(at(frame.north, 1), at(frame.north, -1))));
  if (dot(normal, d) < 0) normal = scale(normal, -1);
  return normal;
}

function blendColor(a: string, b: string, t: number): string {
  const av = Number.parseInt(a.slice(1), 16), bv = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(mix((av >>> shift) & 255, (bv >>> shift) & 255, clamp(t, 0, 1)));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

/** Biome-coherent colors shared by orbital meshes and local terrain patches. */
export function surfaceColor(planet: PlanetDescriptor, unitDir: V3, sampledHeight?: number): string {
  const d = normalize(unitDir), height = sampledHeight ?? terrainHeight(planet, d), palette = planet.palette;
  if (height < 0) return blendColor(palette.water, '#061b32', clamp(-height / (planet.radius * .09), 0, .6));
  const moisture = fractal(fields(planet).moisture, scale(d, 8), 3) * .5 + .5;
  const rock = smooth((height / planet.radius - .035) / .08);
  let color = blendColor(palette.land, palette.rock, rock * .8 + moisture * .15);
  if (planet.kind === 'temperate' || planet.kind === 'glacial') {
    const snow = smooth((Math.abs(d.y) + height / planet.radius * 3 - .75) / .23);
    color = blendColor(color, '#edf1ed', snow);
  }
  if (height < 3) color = blendColor(color, planet.kind === 'volcanic' ? '#978274' : '#d9c89a', .65);
  return color;
}

const landingCache = new WeakMap<PlanetDescriptor, V3>();
/** Select a natural dry, gentle site. This does not flatten or mutate the world. */
export function landingSite(planet: PlanetDescriptor): V3 {
  const cached = landingCache.get(planet);
  if (cached) return { ...cached };
  if (isHome(planet)) {
    const site = scale(HOME_ANCHOR, planet.radius + terrainHeight(planet, HOME_ANCHOR));
    landingCache.set(planet, site);
    return { ...site };
  }
  const phase = fraction(planet.seed, 'landing-search') * Math.PI * 2;
  const samples = 2048;
  const start = key(planet.seed, 'landing-start') % samples;
  for (let i = 0; i < samples; i++) {
    // Odd stride visits the entire power-of-two lattice, without always trying
    // the north pole first. Every planet gets the same bounded search coverage.
    const sample = (start + i * 1093) % samples;
    const y = 1 - 2 * (sample + .5) / samples, r = Math.sqrt(1 - y * y);
    const angle = phase + sample * Math.PI * (3 - Math.sqrt(5));
    const d = { x: r * Math.cos(angle), y, z: r * Math.sin(angle) };
    const height = terrainHeight(planet, d);
    if (height < 8 || dot(d, terrainNormal(planet, d)) < .985) continue;
    const frame = tangentFrame(d);
    // Check the landing footprint, so a center point does not hide a nearby shore.
    if ([frame.east, frame.north, scale(frame.east, -1), scale(frame.north, -1)]
      .some(axis => terrainHeight(planet, normalize(add(d, scale(axis, 8 / planet.radius)))) < 5)) continue;
    const site = scale(d, planet.radius + height);
    landingCache.set(planet, site);
    return { ...site };
  }
  // Fail explicitly instead of silently placing a traveler underwater or on a cliff.
  throw new Error(`No safe landing site on ${planet.id}`);
}
