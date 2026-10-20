/**
 * The existing canonical realms bent onto the home world. These adapters read
 * the live grid and its source triangles; they do not regenerate towns, open
 * doors, relocate actors, or depend on renderer/asset loading.
 */
import type { RealmId } from '../realms/layout';
import type { MovementGeometry, StaticTriangle } from '../../physical/staticGeometry';
import { capsuleTriangleDistance } from '../../physical/staticGeometry';
import { realmToPlanet, planetToRealm, type RealmChart } from '../planet/chart';
import {
  HOME_ANCHOR, FAR_ANCHOR, HOME_PLATEAU, add, dot, length, normalize, scale, sub,
  type PlanetSpec, type V3,
} from '../planet/planet';

export interface SettlementBounds { x0: number; z0: number; x1: number; z1: number }
export interface SettlementGrid {
  readonly H: number;
  readonly focusedGeometry?: { readonly bounds: SettlementBounds } | null;
  movementGeometryAt(x: number, z: number): MovementGeometry | null;
  isSolidAt(x: number, y: number, z: number): boolean;
}
export interface SettlementPatch {
  readonly id: string; readonly realm: RealmId; readonly chart: RealmChart;
  /** Canonical planar coordinates, inclusive outer boundary; no parallel render layout. */
  readonly bounds: SettlementBounds;
}
export const SETTLEMENT_REVISION = 1 as const;
const charts: Record<RealmId, RealmChart> = {
  brass: { anchor: HOME_ANCHOR, origin: { x: 8192 + 3120.5, z: 3092.5 }, floorY: 1 },
  // Existing AETHER_CHART is local48,48. Its chunks use global3072+local.
  aether: { anchor: FAR_ANCHOR, origin: { x: 3072 + 48, z: 3072 + 48 }, floorY: 1 },
};
for (const c of Object.values(charts)) { Object.freeze(c.origin); Object.freeze(c); }
export const CANONICAL_SETTLEMENT_CHARTS: Readonly<Record<RealmId, RealmChart>> = Object.freeze(charts);
const finite = (p: V3) => [p.x, p.y, p.z].every(Number.isFinite);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Point maps are exact inverses within the non-antipodal chart. Y is canonical
 * feet/geometry Y, not an eye/camera offset. Callers retain the same Body identity. */
export function settlementToPlanet(spec: PlanetSpec, realm: RealmId, point: V3): V3 {
  const chart = CANONICAL_SETTLEMENT_CHARTS[realm];
  if (!chart || !finite(point) || Math.hypot(point.x - chart.origin.x, point.z - chart.origin.z) >= Math.PI * spec.radius - .001
    || spec.radius + HOME_PLATEAU.height + point.y - chart.floorY <= 0)
    throw RangeError('Settlement point lies outside its invertible spherical chart');
  return realmToPlanet(spec, chart, point.x, point.y, point.z);
}
export function planetToSettlement(spec: PlanetSpec, realm: RealmId, point: V3): V3 {
  const chart = CANONICAL_SETTLEMENT_CHARTS[realm];
  if (!chart || !finite(point) || length(point) < 1e-9 || dot(normalize(point), chart.anchor) < -1 + 1e-12)
    throw RangeError('Planet point lies outside its invertible settlement chart');
  return planetToRealm(spec, chart, point);
}
/** Differential chart orientation for yaw/velocity projections. Magnitudes are
 * preserved by normalizing only orientation; use point maps for physical motion. */
export function settlementDirectionToPlanet(spec: PlanetSpec, realm: RealmId, at: V3, direction: V3): V3 {
  if (!finite(direction) || length(direction) < 1e-12) throw RangeError('Invalid settlement direction');
  const epsilon = .001;
  return normalize(sub(settlementToPlanet(spec, realm, add(at, scale(normalize(direction), epsilon))),
    settlementToPlanet(spec, realm, sub(at, scale(normalize(direction), epsilon)))));
}
export function planetDirectionToSettlement(spec: PlanetSpec, realm: RealmId, at: V3, direction: V3): V3 {
  if (!finite(direction) || length(direction) < 1e-12) throw RangeError('Invalid planet direction');
  const epsilon = .001;
  return normalize(sub(planetToSettlement(spec, realm, add(at, scale(normalize(direction), epsilon))),
    planetToSettlement(spec, realm, sub(at, scale(normalize(direction), epsilon)))));
}
/** Renderer and host consume these same descriptors. Focused source geometry may
 * extend beyond the original3×3 town chunks; its actual bounds extend the patch. */
export function settlementPatches(grid?: Pick<SettlementGrid, 'focusedGeometry'>): readonly SettlementPatch[] {
  const source = grid?.focusedGeometry?.bounds;
  const brass = {
    x0: Math.min(8192 + 2976, source?.x0 ?? Infinity), x1: Math.max(8192 + 3264, source?.x1 ?? -Infinity),
    z0: Math.min(2976, source?.z0 ?? Infinity), z1: Math.max(3264, source?.z1 ?? -Infinity),
  };
  if (!Object.values(brass).every(Number.isFinite)) throw Error('Invalid canonical settlement bounds');
  return Object.freeze([
    Object.freeze({ id: 'settlement:1:brass', realm: 'brass' as const, chart: charts.brass, bounds: Object.freeze(brass) }),
    Object.freeze({ id: 'settlement:1:aether', realm: 'aether' as const, chart: charts.aether,
      bounds: Object.freeze({ x0: 2976, x1: 3264, z0: 2976, z1: 3264 }) }),
  ]);
}
function contains(bounds: SettlementBounds, p: Pick<V3, 'x' | 'z'>, margin = 0): boolean {
  return p.x >= bounds.x0 - margin && p.x <= bounds.x1 + margin && p.z >= bounds.z0 - margin && p.z <= bounds.z1 + margin;
}
export function settlementAt(spec: PlanetSpec, point: V3, patches: readonly SettlementPatch[], margin = 0):
  { patch: SettlementPatch; planar: V3 } | null {
  if (!finite(point) || length(point) < 1e-9) return null;
  const dir = normalize(point);
  for (const patch of patches) {
    const b = patch.bounds, c = patch.chart.origin;
    const radius = Math.max(Math.hypot(b.x0 - c.x, b.z0 - c.z), Math.hypot(b.x0 - c.x, b.z1 - c.z),
      Math.hypot(b.x1 - c.x, b.z0 - c.z), Math.hypot(b.x1 - c.x, b.z1 - c.z)) + margin;
    if (dot(dir, patch.chart.anchor) < Math.cos(radius / spec.radius) - 1e-12) continue;
    const planar = planetToRealm(spec, patch.chart, point);
    if (contains(b, planar, margin)) return { patch, planar };
  }
  return null;
}
export interface SettlementShape {
  radius: number; height: number;
  /** Radial metres from the supplied reference point down to capsule feet. */
  footOffset: number;
  /** Walk snaps only to real canonical support within stepHeight. Flight never
   * requires floor and can pass over a roof or through an open doorway. */
  mode: 'walk' | 'flight'; stepHeight?: number;
}
export interface SettlementSupport { realm: RealmId; feet: V3; planar: V3 }
export interface SettlementGround extends SettlementSupport { radius: number; height: number }
/** Source floor directly below the retained body's feet, with a bounded optional
 * step up. Used by terrain integrators before they clamp/descent onto an assumed
 * terrain surface. direction can be the next horizontal sample while reference
 * retains the previous foot altitude, so upper floors do not collapse to ground. */
export function settlementGroundAt(spec: PlanetSpec, grid: SettlementGrid, reference: V3,
  direction: V3 = reference, maxRise = .55): SettlementGround | null {
  if (!finite(reference) || !finite(direction) || length(reference) < 3 || length(direction) < 1e-9
    || !Number.isFinite(maxRise) || maxRise < 0 || maxRise > 1.1) return null;
  const point = scale(normalize(direction), length(reference) - 3), address = settlementAt(spec, point, settlementPatches(grid));
  if (!address || length(reference) > spec.radius + HOME_PLATEAU.height + grid.H + 32) return null;
  const { patch, planar } = address, geometry = grid.movementGeometryAt(planar.x, planar.z), ceiling = planar.y + maxRise;
  let y: number | null = null;
  if (geometry) {
    const bottom = -grid.H, middle = (bottom + ceiling) / 2;
    y = geometry.supportAt(planar.x, planar.z, middle, (ceiling - bottom) / 2 + 1e-6);
  } else {
    for (let row = Math.min(grid.H - 1, Math.floor(ceiling - 1 + 1e-6)); row >= 0; row--)
      if (grid.isSolidAt(planar.x, row + .5, planar.z) && !grid.isSolidAt(planar.x, row + 1.5, planar.z)) { y = row + 1; break; }
  }
  if (y === null || y > ceiling + .001) return null;
  const foot = { ...planar, y }, feet = realmToPlanet(spec, patch.chart, foot.x, foot.y, foot.z), radius = length(feet);
  return { realm: patch.realm, planar: foot, feet, radius, height: radius - spec.radius };
}
export interface SettlementSweep {
  position: V3; support: SettlementSupport | null; headroom: boolean;
  collision: { realm: RealmId; reason: 'solid' | 'unsupported'; t: number } | null;
}
type Evaluation = { position: V3; support: SettlementSupport | null; reason: 'solid' | 'unsupported' | null; realm: RealmId | null };
/** The body capsule against live canonical voxel substances (including doors). */
function voxelFits(grid: SettlementGrid, patch: SettlementPatch, foot: V3, radius: number, height: number,
  voxel: (x: number, y: number, z: number) => boolean): boolean {
  const lo = foot.y + radius, hi = foot.y + Math.max(radius, height - radius), r2 = (radius - .001) ** 2;
  for (let x = Math.floor(foot.x - radius); x <= Math.floor(foot.x + radius); x++)
    for (let z = Math.floor(foot.z - radius); z <= Math.floor(foot.z + radius); z++) {
      if (!contains(patch.bounds, { x: x + .5, z: z + .5 })) continue;
      // Source triangles, tested separately, own authored geometry columns.
      if (grid.movementGeometryAt(x + .5, z + .5)) continue;
      const dx = Math.max(x - foot.x, 0, foot.x - x - 1), dz = Math.max(z - foot.z, 0, foot.z - z - 1);
      if (dx * dx + dz * dz >= r2) continue;
      for (let y = Math.floor(foot.y); y <= Math.min(grid.H - 1, Math.floor(foot.y + height)); y++) {
        const dy = Math.max(y - hi, 0, lo - y - 1);
        if (dx * dx + dy * dy + dz * dz < r2 && voxel(x, y, z)) return false;
      }
    }
  return true;
}
function canonicalSupport(grid: SettlementGrid, geometry: MovementGeometry | null, foot: V3, step: number,
  voxel: (x: number, y: number, z: number) => boolean): number | null {
  if (geometry) return geometry.supportAt(foot.x, foot.z, foot.y, step);
  const x = Math.floor(foot.x), z = Math.floor(foot.z);
  for (let y = Math.min(grid.H - 1, Math.floor(foot.y + step)); y >= Math.floor(foot.y - step) - 1; y--)
    if (Math.abs(y + 1 - foot.y) <= step + 1e-6 && voxel(x, y, z) && !voxel(x, y + 1, z)) return y + 1;
  return null;
}
/** Curved motion is checked at <=12cm intervals, with an 8-step boundary refine.
 * Minimum radius10cm keeps even thin source triangles from tunnelling between
 * samples. Queries and caches are local to this call, so live door edits apply
 * immediately. Maximum512m matches bounded fixed-tick motion, not teleports. */
export function sweepSettlements(spec: PlanetSpec, grid: SettlementGrid, from: V3, to: V3, shape: SettlementShape,
  patches: readonly SettlementPatch[] = settlementPatches(grid)): SettlementSweep {
  if (!finite(from) || !finite(to) || ![shape.radius, shape.height, shape.footOffset, shape.stepHeight ?? .55].every(Number.isFinite)
    || shape.radius < .1 || shape.radius > 8 || shape.height < 2 * shape.radius || shape.height > 20
    || shape.footOffset < 0 || !['walk', 'flight'].includes(shape.mode)
    || (shape.stepHeight ?? .55) < 0 || (shape.stepHeight ?? .55) > 1.1) throw RangeError('Invalid settlement sweep shape');
  const delta = sub(to, from), dist = length(delta);
  if (dist > 512) throw RangeError('Settlement sweep exceeds fixed-tick motion budget');
  const closest = dist > 1e-9 ? add(from, scale(delta, clamp(-dot(from, delta) / dot(delta, delta), 0, 1))) : from;
  if (length(closest) > spec.radius + HOME_PLATEAU.height + grid.H + 32)
    return { position: to, support: null, headroom: true, collision: null };
  const steps = Math.max(1, Math.ceil(dist / Math.min(.12, shape.radius * .5)));
  const voxels = new Map<string, boolean>(), windows = new Map<MovementGeometry, Map<string, StaticTriangle[]>>();
  const voxel = (x: number, y: number, z: number) => {
    const key = `${x}:${y}:${z}`, cached = voxels.get(key);
    if (cached !== undefined) return cached;
    const solid = grid.isSolidAt(x + .5, y + .5, z + .5); voxels.set(key, solid); return solid;
  };
  const triangles = (geometry: MovementGeometry, p: V3, r: number) => {
    let cache = windows.get(geometry); if (!cache) { cache = new Map(); windows.set(geometry, cache); }
    const x = Math.floor(p.x / 8) * 8, z = Math.floor(p.z / 8) * 8, key = `${x}:${z}:${r}`;
    let result = cache.get(key);
    if (!result) { result = geometry.window(x - r - 1, z - r - 1, 8 + 2 * r + 2).triangles; cache.set(key, result); }
    return result;
  };
  const evaluate = (point: V3, previous: Evaluation | null): Evaluation => {
    const radial = normalize(point), footPoint = sub(point, scale(radial, shape.footOffset));
    const address = settlementAt(spec, footPoint, patches, shape.radius);
    if (!address) return { position: point, support: null, reason: null, realm: null };
    const { patch, planar } = address, geometry = grid.movementGeometryAt(planar.x, planar.z);
    const geometries = new Set<MovementGeometry>();
    if (geometry) geometries.add(geometry);
    for (const dx of [-shape.radius - .2, 0, shape.radius + .2]) for (const dz of [-shape.radius - .2, 0, shape.radius + .2]) {
      const adjacent = grid.movementGeometryAt(planar.x + dx, planar.z + dz);
      if (adjacent) geometries.add(adjacent);
    }
    let support: SettlementSupport | null = null, position = point, foot = { ...planar };
    if (shape.mode === 'walk' && contains(patch.bounds, foot)) {
      const baseY = previous?.support?.realm === patch.realm ? previous.support.planar.y : foot.y;
      const y = canonicalSupport(grid, geometry, { ...foot, y: baseY }, shape.stepHeight ?? .55, voxel);
      if (y === null) return { position, support: null, reason: 'unsupported', realm: patch.realm };
      foot.y = y;
      const feet = realmToPlanet(spec, patch.chart, foot.x, foot.y, foot.z);
      support = { realm: patch.realm, feet, planar: foot }; position = add(feet, scale(normalize(feet), shape.footOffset));
    }
    // A chart compresses tangential distances slightly off-centre. Inflate the
    // planar capsule conservatively so bending cannot create a collision gap.
    const a = Math.hypot(foot.x - patch.chart.origin.x, foot.z - patch.chart.origin.z) / spec.radius;
    const metric = (spec.radius + HOME_PLATEAU.height + foot.y - patch.chart.floorY) / spec.radius
      * (a > 1e-8 ? Math.sin(a) / a : 1);
    const radius = shape.radius / Math.min(1, metric), extra = radius - shape.radius;
    const height = shape.mode === 'flight' ? shape.height + 2 * extra : shape.height;
    if (shape.mode === 'flight') foot = { ...foot, y: foot.y - extra };
    let fits = voxelFits(grid, patch, foot, radius, height, voxel);
    for (const source of geometries) {
      if (!fits) break;
      if (shape.mode === 'walk' && source === geometry) fits = source.fits(foot.x, foot.y, foot.z, radius, height);
      else for (const triangle of triangles(source, foot, shape.radius + 1)) {
        const p = triangle.p;
        if (Math.max(p[1], p[4], p[7]) <= foot.y + .001 || Math.min(p[1], p[4], p[7]) > foot.y + height
          || Math.max(p[0], p[3], p[6]) < foot.x - radius || Math.min(p[0], p[3], p[6]) > foot.x + radius
          || Math.max(p[2], p[5], p[8]) < foot.z - radius || Math.min(p[2], p[5], p[8]) > foot.z + radius) continue;
        if (capsuleTriangleDistance(foot.x, foot.y, foot.z, radius, height, p) < radius - .001) { fits = false; break; }
      }
    }
    return { position, support, reason: fits ? null : 'solid', realm: patch.realm };
  };
  let safe = evaluate(from, null), lastT = 0;
  if (safe.reason) return { position: from, support: null, headroom: safe.reason !== 'solid',
    collision: { realm: safe.realm!, reason: safe.reason, t: 0 } };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, result = evaluate(add(from, scale(delta, t)), safe);
    if (result.reason) {
      let lo = lastT, hi = t, best = safe;
      for (let j = 0; j < 8; j++) {
        const mid = (lo + hi) / 2, sample = evaluate(add(from, scale(delta, mid)), safe);
        if (sample.reason) hi = mid; else { lo = mid; best = sample; }
      }
      return { position: best.position, support: best.support, headroom: result.reason !== 'solid',
        collision: { realm: result.realm!, reason: result.reason, t: lo } };
    }
    safe = result; lastT = t;
  }
  return { position: safe.position, support: safe.support, headroom: true, collision: null };
}

export type SettlementSaveValidation = (kind: 'body' | 'vessel', point: V3, systemIndex: number,
  mode: 'surface' | 'flight') => boolean | undefined;
/** Lowest actual supporting source triangle under a point. Using the highest
 * roof as "ground" would incorrectly reject bodies inside authored buildings. */
function lowestSourceSupport(geometry: MovementGeometry, foot: V3): number | null {
  let lowest: number | null = null;
  for (const t of geometry.window(foot.x - 1, foot.z - 1, 2).triangles) {
    if (!t.support) continue;
    const p = t.p, ax = p[0], az = p[2], bx = p[3], bz = p[5], cx = p[6], cz = p[8];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-10) continue;
    const u = ((bz - cz) * (foot.x - cx) + (cx - bx) * (foot.z - cz)) / den;
    const v = ((cz - az) * (foot.x - cx) + (ax - cx) * (foot.z - cz)) / den, w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-6) continue;
    const y = u * p[1] + v * p[4] + w * p[7];
    lowest = lowest === null ? y : Math.min(lowest, y);
  }
  return lowest;
}
/** Save validation must read the same live grid as movement. Undefined delegates
 * untouched worlds/outside patches to the existing terrain validator. */
export function settlementSaveValidator(spec: PlanetSpec, grid: SettlementGrid,
  options: { historicalBody?: boolean } = {}): SettlementSaveValidation {
  const patches = settlementPatches(grid);
  return (kind, point, systemIndex, mode) => {
    if (systemIndex !== 0) return undefined;
    if (!finite(point) || length(point) < 1e-9) return false;
    // Other worlds can share a chart's angular direction. They are never part
    // of this home-world exception, nor is high orbital empty space.
    if (length(point) > spec.radius + HOME_PLATEAU.height + grid.H + 32) return undefined;
    const foot = sub(point, scale(normalize(point), 3)), radius = kind === 'vessel' ? 3 : .3;
    const exact = settlementAt(spec, foot, patches);
    if (!exact && !settlementAt(spec, foot, patches, radius)) return undefined;
    if (kind === 'body' && options.historicalBody) {
      // An inactive expedition remembers a departed surface pose, not a second
      // body. Doors may close there afterward. Retain its source floor/height
      // invariant without checking occupancy of that historical capsule.
      if (!exact || mode !== 'surface') return false;
      const p = exact.planar, geometry = grid.movementGeometryAt(p.x, p.z);
      if (geometry) {
        // Match walking's source search: a capsule can rest on raised paving
        // around lower mortar at its center. The resulting height remains exact.
        const support = geometry.supportAt(p.x, p.z, p.y, .55);
        return support !== null && Math.abs(support - p.y) <= .015;
      }
      const floor = Math.round(p.y);
      return Math.abs(floor - p.y) <= .015 && floor > 0 && floor <= grid.H
        && grid.isSolidAt(p.x, floor - .5, p.z);
    }
    const result = sweepSettlements(spec, grid, point, point, {
      radius, height: kind === 'vessel' ? 6 : 1.8, footOffset: 3, mode: mode === 'surface' ? 'walk' : 'flight',
    }, patches);
    if (result.collision) return false;
    if (!exact) return undefined;
    if (mode === 'surface') return !!result.support && length(sub(result.position, point)) <= .015;
    const geometry = grid.movementGeometryAt(exact.planar.x, exact.planar.z);
    // Empty space beneath all source floors is not an underground world.
    const ground = geometry ? lowestSourceSupport(geometry, exact.planar) ?? 1 : 1;
    return exact.planar.y >= ground - .01;
  };
}
