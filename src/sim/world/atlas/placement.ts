/**
 * Atlas v1 geography is pure, random-access and independent of loaded meshes.
 * Native model units and origins are preserved. A query returns every placement
 * whose ground footprint intersects its spherical cap, including face seams.
 */
import {
  HOME_ANCHOR, FAR_ANCHOR, add, arc, chartToHome, climateAt, cross, dirToChart,
  dot, landmarkSites, length, normalize, planetSpec, scale, sub, surfaceHeight,
  surfaceNormal, tangentFrame, type PlanetSpec, type V3,
} from '../planet/planet';
import { planetRoads, ROAD_HALF_WIDTH, ROAD_STEP } from '../planet/roads';
import { cubeToDir } from '../planet/scatter';
import { landingSite, terrainHeight, terrainNormal, type PlanetDescriptor } from '../universe/generation';
import { ATLAS_REVISION, eligibleAtlasAssets } from './index';
import type { AtlasAsset } from './types';

export const ATLAS_PLACEMENT_REVISION = 1 as const;
export const ATLAS_MAX_QUERY_METRES = 256;
export const ATLAS_MAX_FOOTPRINT = 65;
export type AtlasContext = 'wilderness' | 'settlement' | 'landmark' | 'tower';
export interface AtlasPlacement {
  id: string; assetId: string; revision: 1; catalog: string;
  /** Native GLB origin, already corrected by up * asset.groundOffset. */
  position: V3; up: V3; yaw: number; scale: 1;
  footprintRadius: number; height: number; solid: boolean;
  context: AtlasContext; cell: string;
}
export interface AtlasBasis { x: V3; y: V3; z: V3 }
/** Right-handed glTF basis: at +Y this is ordinary XYZ, never a reflection. */
export function atlasPlacementBasis(p: Pick<AtlasPlacement, 'up' | 'yaw'>): AtlasBasis {
  const { east, north, up } = tangentFrame(p.up), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: add(scale(east, c), scale(north, s)), y: up, z: sub(scale(east, s), scale(north, c)) };
}
export function atlasLocalToWorld(p: AtlasPlacement, v: V3): V3 {
  const b = atlasPlacementBasis(p);
  return add(p.position, add(add(scale(b.x, v.x), scale(b.y, v.y)), scale(b.z, v.z)));
}

function hash(seed: number, text: string): number {
  let h = (seed ^ 2166136261) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const random = (seed: number, text: string) => hash(seed, text) / 0x100000000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const distance = (radius: number, a: V3, b: V3) => radius * Math.acos(clamp(dot(a, b), -1, 1));
type Layer = 'scatter' | 'landmark';
export type AtlasPolicyReason = 'incompatible' | 'living-draft' | 'scene-needs-landmark'
  | 'not-a-scene' | 'oversize' | 'scene-needs-detailed-proxy' | 'scene-needs-route-cook' | 'not-a-small-prop';
/** Explicit reasons make catalog coverage auditable, rather than silently dropping models. */
export function atlasPlacementPolicy(asset: AtlasAsset, context: 'scatter' | 'landmark' | 'tower'): AtlasPolicyReason | null {
  if (asset.role === 'mob-draft') return 'living-draft';
  if (!asset.eligible) return 'incompatible';
  if (context === 'tower') {
    return asset.role !== 'prop' || asset.footprintRadius > 2.5 || asset.height > 3.5 ? 'not-a-small-prop' : null;
  }
  if (context === 'landmark') {
    if (asset.role !== 'scene') return 'not-a-scene';
    if (asset.footprintRadius > ATLAS_MAX_FOOTPRINT || asset.height > 100) return 'oversize';
    // An overall scene box would seal authored doors/courtyards. Such scenes need
    // an explicit collision cook, not a misleading miniature or solid rectangle.
    if (asset.proxy.kind !== 'boxes' || asset.proxy.boxes.length < 2) return 'scene-needs-detailed-proxy';
    if (!asset.tags.some(tag => /^(ruined_cloister|bandit_camp|orchard_farm|graveyard|ritual_circle|flooded_ruins|market_square|pine_forest|broadleaf_forest|wheat_fields|terraced_farm|watchpost|village_lane|city_street|city_alley)$/.test(tag)))
      return 'scene-needs-route-cook';
    return null;
  }
  if (asset.role === 'scene') return 'scene-needs-landmark';
  return asset.footprintRadius > 12 || asset.height > 40 ? 'oversize' : null;
}
const pools = {
  scatter: eligibleAtlasAssets.filter(a => !atlasPlacementPolicy(a, 'scatter')).sort((a, b) => a.id.localeCompare(b.id)),
  landmark: eligibleAtlasAssets.filter(a => !atlasPlacementPolicy(a, 'landmark')).sort((a, b) => a.id.localeCompare(b.id)),
  tower: eligibleAtlasAssets.filter(a => !atlasPlacementPolicy(a, 'tower')).sort((a, b) => a.id.localeCompare(b.id)),
};
const biomeWords: Record<string, RegExp> = {
  temperate: /temperate|forest|wood|grass|meadow|savanna|swamp|verdant|garden|jungle/i,
  desert: /desert|sand|dune|arid|badland|mesa/i,
  glacial: /glacial|snow|ice|frost|tundra|taiga|alpine|mountain/i,
  volcanic: /volcan|ash|ember|cinder|lava|obsidian|basalt|infernal/i,
  oceanic: /ocean|coast|sea|beach|coral|reef|marsh|mangrove|swamp|island/i,
};
function acceptsBiome(asset: AtlasAsset, biome: string): boolean {
  const text = [...asset.biomes, ...asset.tags].join(' ');
  const mapped = Object.keys(biomeWords).filter(k => biomeWords[k].test(text));
  return !mapped.length || mapped.includes(biome);
}
const biomePools = new Map<string, AtlasAsset[]>();
function poolFor(layer: Layer, biome: string, built: boolean): AtlasAsset[] {
  const key = `${layer}:${biome}:${built}`, cached = biomePools.get(key);
  if (cached) return cached;
  let choices = pools[layer].filter(a => acceptsBiome(a, biome));
  if (layer === 'scatter') {
    choices = choices.filter(a => built ? a.role !== 'nature' : a.role === 'nature');
    if (!choices.length && built) choices = pools.scatter.filter(a => a.role === 'nature' && acceptsBiome(a, biome));
  }
  biomePools.set(key, choices);
  return choices;
}
interface World {
  id: string; seed: number; radius: number;
  height(dir: V3): number; normal(dir: V3): V3; biome(dir: V3): string;
  reserved(dir: V3, radius: number): boolean; settlement(dir: V3): boolean;
}
const sphereWorlds = new Map<string, World>();
const planetWorlds = new WeakMap<PlanetDescriptor, World>();
const roadIndexes = new WeakMap<PlanetSpec, Map<string, V3[]>>();
function roadReserved(spec: PlanetSpec, dir: V3, footprint: number): boolean {
  let grid = roadIndexes.get(spec);
  const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`, width = 64;
  if (!grid) {
    grid = new Map();
    for (const road of planetRoads(spec)) for (const point of road.points) {
      const p = scale(point, spec.radius), k = key(Math.floor(p.x / width), Math.floor(p.y / width), Math.floor(p.z / width));
      const cell = grid.get(k);
      if (cell) cell.push(point); else grid.set(k, [point]);
    }
    roadIndexes.set(spec, grid);
  }
  // Reserve wet links as well: existing bridge approaches remain canonical.
  const r = footprint + ROAD_HALF_WIDTH + ROAD_STEP / 2 + 10, p = scale(dir, spec.radius);
  const cells = Math.ceil(r / width), x = Math.floor(p.x / width), y = Math.floor(p.y / width), z = Math.floor(p.z / width);
  for (let dx = -cells; dx <= cells; dx++) for (let dy = -cells; dy <= cells; dy++) for (let dz = -cells; dz <= cells; dz++) {
    for (const sample of grid.get(key(x + dx, y + dy, z + dz)) ?? [])
      if (arc(spec, dir, sample) < r) return true;
  }
  return false;
}
/** Conservative canonical route reservations include the whole original Tower approach. */
export function atlasHomeReserved(spec: PlanetSpec, dir: V3, footprint = 0): boolean {
  const home = chartToHome(spec, dir);
  if (arc(spec, dir, HOME_ANCHOR) < 850
    && Math.abs(home.east) < 185 + footprint && home.north > -240 - footprint && home.north < 470 + footprint) return true;
  if (arc(spec, dir, FAR_ANCHOR) < 440 + footprint) return true;
  for (const site of landmarkSites(spec)) if (arc(spec, dir, site.dir) < 72 + footprint) return true;
  return roadReserved(spec, dir, footprint);
}
function sphereWorld(spec: PlanetSpec): World {
  const id = `sphere:${spec.seed}:${spec.radius}`, hit = sphereWorlds.get(id);
  if (hit) return hit;
  const world: World = {
    id, seed: spec.seed, radius: spec.radius,
    height: d => surfaceHeight(spec, d), normal: d => surfaceNormal(spec, d),
    biome: d => {
      const b = climateAt(spec, d).biome;
      return ['snow', 'tundra', 'taiga', 'mountain'].includes(b) ? 'glacial'
        : b === 'desert' ? 'desert' : ['beach', 'swamp', 'ocean'].includes(b) ? 'oceanic' : 'temperate';
    },
    reserved: (d, r) => atlasHomeReserved(spec, d, r),
    settlement: d => landmarkSites(spec).some(s => arc(spec, d, s.dir) < 210),
  };
  if (sphereWorlds.size >= 32) sphereWorlds.delete(sphereWorlds.keys().next().value!);
  sphereWorlds.set(id, world);
  return world;
}
function planetWorld(planet: PlanetDescriptor): World {
  const hit = planetWorlds.get(planet);
  if (hit) return hit;
  const home = /:s0:p0$/.test(planet.id), original = home ? sphereWorld(planetSpec(planet.seed, planet.radius)) : undefined;
  const site = normalize(landingSite(planet));
  const world: World = {
    // Home and the older sphere view use exactly the same placements.
    id: original?.id ?? planet.id, seed: planet.seed, radius: planet.radius,
    height: d => terrainHeight(planet, d), normal: d => terrainNormal(planet, d),
    biome: original?.biome ?? (() => planet.kind),
    reserved: (d, r) => distance(planet.radius, d, site) < 38 + r || !!original?.reserved(d, r),
    settlement: original?.settlement ?? (d => distance(planet.radius, d, site) < 500),
  };
  planetWorlds.set(planet, world);
  return world;
}
/** Coordinates (signed denominator, u numerator, v numerator) for six cube faces. */
const faceAxes: readonly [keyof V3, number, keyof V3, number, keyof V3, number][] = [
  ['x', 1, 'z', -1, 'y', 1], ['x', -1, 'z', 1, 'y', 1],
  ['y', 1, 'x', 1, 'z', -1], ['y', -1, 'x', 1, 'z', 1],
  ['z', 1, 'x', 1, 'y', 1], ['z', -1, 'x', -1, 'y', 1],
];
/** Conservative cap/face interval projection; does not skip cube corners or poles. */
function queryCells(world: World, dir: V3, metres: number, layer: Layer): { f: number; i: number; j: number; n: number }[] {
  const n = Math.max(2, Math.ceil(2 * world.radius / (layer === 'landmark' ? 520 : 72)));
  const delta = 2 * Math.sin(Math.min(Math.PI, metres / world.radius) / 2), out = [];
  for (let f = 0; f < 6; f++) {
    const [da, ds, ua, us, va, vs] = faceAxes[f], denominator = dir[da] * ds;
    const low = Math.max(1 / Math.sqrt(3), denominator - delta), high = Math.min(1, denominator + delta);
    if (high < low) continue;
    const interval = (axis: keyof V3, sign: number): [number, number] => {
      const a = dir[axis] * sign - delta, b = dir[axis] * sign + delta;
      const values = [a / low, a / high, b / low, b / high];
      return [clamp(Math.floor((Math.min(...values) + 1) * .5 * n), 0, n - 1),
        clamp(Math.floor((Math.max(...values) + 1) * .5 * n), 0, n - 1)];
    };
    const [i0, i1] = interval(ua, us), [j0, j1] = interval(va, vs);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push({ f, i, j, n });
  }
  return out;
}
/** Distance to each cell boundary great circle: accepted footprints stay within
 * their own cell, so they cannot overlap adjacent cells or cross a face seam. */
function cellFits(world: World, dir: V3, f: number, i: number, j: number, n: number, footprint: number): boolean {
  const uv = [(i / n) * 2 - 1, ((i + 1) / n) * 2 - 1, (j / n) * 2 - 1, ((j + 1) / n) * 2 - 1];
  for (let k = 0; k < 4; k++) {
    const a = k < 2 ? cubeToDir(f, uv[k], -1) : cubeToDir(f, -1, uv[k]);
    const b = k < 2 ? cubeToDir(f, uv[k], 1) : cubeToDir(f, 1, uv[k]);
    const separation = world.radius * Math.asin(clamp(Math.abs(dot(dir, normalize(cross(a, b)))), 0, 1));
    if (separation < footprint + 2) return false;
  }
  return true;
}
const cellCache = new Map<string, AtlasPlacement | null>();
const CACHE_LIMIT = 24000;
function candidate(world: World, layer: Layer, cell: { f: number; i: number; j: number; n: number }): AtlasPlacement | null {
  const { f, i, j, n } = cell, address = `${layer}:${f}:${i}:${j}`;
  const key = `${world.id}:1:${ATLAS_REVISION}:${address}`;
  if (cellCache.has(key)) return cellCache.get(key)!;
  const result = buildCandidate(world, layer, cell, address);
  if (cellCache.size >= CACHE_LIMIT) cellCache.delete(cellCache.keys().next().value!);
  cellCache.set(key, result);
  return result;
}
function buildCandidate(world: World, layer: Layer, cell: { f: number; i: number; j: number; n: number }, address: string): AtlasPlacement | null {
  const { f, i, j, n } = cell;
  const dir = cubeToDir(f, (i + .4 + .2 * random(world.seed, `${address}:u`)) / n * 2 - 1,
    (j + .4 + .2 * random(world.seed, `${address}:v`)) / n * 2 - 1);
  const h = world.height(dir);
  if (h < 1 || world.reserved(dir, 0)) return null;
  const biome = world.biome(dir), settlement = world.settlement(dir);
  let built = settlement;
  if (layer === 'scatter') {
    // Sparse architectural modules/items belong near settlements or landmarks;
    // nature is the default wilderness population, never a living NPC draft.
    const nearbyLandmarks = query(world, dir, 145, 'landmark');
    built ||= nearbyLandmarks.length > 0;
  }
  const choices = poolFor(layer, biome, built);
  if (!choices.length) return null;
  const asset = choices[hash(world.seed, `${address}:asset`) % choices.length], r = asset.footprintRadius;
  if (!cellFits(world, dir, f, i, j, n, r) || world.reserved(dir, r)) return null;
  const isNature = asset.role === 'nature', slope = dot(world.normal(dir), dir);
  if (slope < (isNature ? .86 : .965)) return null;
  const frame = tangentFrame(dir);
  // Native floors need support across the footprint. No terrain edits and no
  // flattening of existing geography are implied by selecting an asset.
  const tolerance = isNature ? Math.max(2, r * .28) : Math.max(.65, Math.min(3, r * .12));
  for (let q = 0; q < 8; q++) {
    const sample = normalize(add(dir, add(scale(frame.east, Math.cos(q * Math.PI / 4) * r / world.radius),
      scale(frame.north, Math.sin(q * Math.PI / 4) * r / world.radius))));
    if (world.height(sample) < 0 || Math.abs(world.height(sample) - h) > tolerance) return null;
  }
  if (layer === 'scatter' && query(world, dir, r + 3, 'landmark').length) return null;
  const placement: AtlasPlacement = {
    id: `atlas:1:${world.id}:${address}`, assetId: asset.id, revision: 1, catalog: ATLAS_REVISION,
    position: scale(dir, world.radius + h + asset.groundOffset), up: dir,
    yaw: random(world.seed, `${address}:yaw`) * Math.PI * 2, scale: 1,
    footprintRadius: r, height: asset.height, solid: asset.proxy.kind !== 'none',
    context: layer === 'landmark' ? 'landmark' : settlement ? 'settlement' : 'wilderness', cell: address,
  };
  Object.freeze(placement.position); Object.freeze(placement.up);
  return Object.freeze(placement);
}
function query(world: World, dir: V3, metres: number, layer: Layer): AtlasPlacement[] {
  const max = layer === 'landmark' ? ATLAS_MAX_FOOTPRINT : 12, out: AtlasPlacement[] = [];
  for (const cell of queryCells(world, dir, metres + max, layer)) {
    const p = candidate(world, layer, cell);
    if (p && distance(world.radius, dir, p.up) <= metres + p.footprintRadius) out.push(p);
  }
  return out;
}
function placements(world: World, position: V3, metres: number, revision: number): AtlasPlacement[] {
  if (revision === 0) return [];
  if (revision !== 1) throw Error('Unsupported Atlas placement revision');
  if (!Number.isFinite(metres) || metres < 0 || metres > ATLAS_MAX_QUERY_METRES
    || ![position.x, position.y, position.z].every(Number.isFinite) || length(position) < 1e-9)
    throw RangeError('Atlas query needs a finite surface direction and radius from 0 to 256 metres');
  const dir = normalize(position);
  return [...query(world, dir, metres, 'landmark'), ...query(world, dir, metres, 'scatter')].sort((a, b) => a.id.localeCompare(b.id));
}
export function atlasPlanetPlacements(planet: PlanetDescriptor, localPosition: V3, metres: number, revision = 1): AtlasPlacement[] {
  return placements(planetWorld(planet), localPosition, metres, revision);
}
export function atlasSpherePlacements(spec: PlanetSpec, localPosition: V3, metres: number, revision = 1): AtlasPlacement[] {
  return placements(sphereWorld(spec), localPosition, metres, revision);
}
export interface AtlasTowerSupport { id: string; position: V3; half: V3 }
export interface AtlasTowerOptions { id: string; seed: number; floor: number; supports: readonly AtlasTowerSupport[]; limit?: number }
/** Decorations only on supplied existing solids; never add walls or route blockers.
 * Support positions are existing axis-aligned box centres, in the Tower's frame. */
export function atlasTowerDecorations(options: AtlasTowerOptions): AtlasPlacement[] {
  if (!Number.isInteger(options.floor) || options.floor < 0 || !Number.isSafeInteger(options.seed)) throw Error('Invalid Tower placement address');
  const limit = Math.max(0, Math.min(128, Math.floor(options.limit ?? 32))), out: AtlasPlacement[] = [];
  for (const support of [...options.supports].sort((a, b) => a.id.localeCompare(b.id))) {
    if (out.length >= limit) break;
    if (![support.position.x, support.position.y, support.position.z, support.half.x, support.half.y, support.half.z].every(Number.isFinite)
      || support.half.x <= .1 || support.half.y <= 0 || support.half.z <= .1) continue;
    const address = `${options.id}:${options.floor}:${support.id}`;
    const yaw = hash(options.seed, `${address}:yaw`) % 4 * Math.PI / 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const fits = (a: AtlasAsset) => {
      const b = a.bounds, xs = [b.min.x, b.max.x], zs = [b.min.z, b.max.z];
      return xs.every(x => zs.every(z => Math.abs(x * cos + z * sin) < support.half.x - .1
        && Math.abs(-x * sin + z * cos) < support.half.z - .1));
    };
    const choices = pools.tower.filter(fits);
    if (!choices.length) continue;
    const asset = choices[hash(options.seed, `${address}:asset`) % choices.length];
    const placement: AtlasPlacement = {
      id: `atlas:1:tower:${address}`, assetId: asset.id, revision: 1, catalog: ATLAS_REVISION,
      position: { x: support.position.x, y: support.position.y + support.half.y + asset.groundOffset, z: support.position.z },
      up: { x: 0, y: 1, z: 0 }, yaw, scale: 1, footprintRadius: asset.footprintRadius,
      height: asset.height, solid: false, context: 'tower', cell: support.id,
    };
    Object.freeze(placement.position); Object.freeze(placement.up); out.push(Object.freeze(placement));
  }
  return out;
}
