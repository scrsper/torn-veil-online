/** Canonical cooked collision only. No Babylon objects, render visibility,
 * camera position, asset download, or GPU completion can change these results. */
import { add, dot, length, normalize, scale, sub, type V3 } from '../planet/planet';
import { terrainHeight, type PlanetDescriptor } from '../universe/generation';
import { getAtlasAsset } from './index';
import { atlasPlacementBasis, atlasPlanetPlacements, type AtlasPlacement } from './placement';
import type { AtlasBounds } from './types';

export interface AtlasCollision { t: number; placementId: string; assetId: string }
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function local(p: AtlasPlacement, point: V3): V3 {
  const b = atlasPlacementBasis(p), v = sub(point, p.position);
  return { x: dot(v, b.x), y: dot(v, b.y), z: dot(v, b.z) };
}
function segmentBox(from: V3, to: V3, box: AtlasBounds, radius: number): number | null {
  let lo = 0, hi = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const delta = to[axis] - from[axis], min = box.min[axis] - radius, max = box.max[axis] + radius;
    if (Math.abs(delta) < 1e-12) { if (from[axis] < min || from[axis] > max) return null; continue; }
    const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return null;
  }
  return lo;
}
/** Swept sphere against conservative native node boxes, including thin walls.
 * Broad-phase bounds are not substituted for a scene's separate cooked boxes. */
export function atlasSweepSphere(placements: readonly AtlasPlacement[], from: V3, to: V3, radius: number): AtlasCollision | null {
  if (!Number.isFinite(radius) || radius < 0) throw RangeError('Invalid Atlas collision radius');
  let result: AtlasCollision | null = null;
  for (const p of placements) {
    if (!p.solid) continue;
    const asset = getAtlasAsset(p.assetId);
    if (!asset || asset.proxy.kind === 'none') continue;
    const a = local(p, from), b = local(p, to);
    for (const box of asset.proxy.boxes) {
      const t = segmentBox(a, b, box, radius);
      if (t !== null && (!result || t < result.t || (t === result.t && p.id < result.placementId)))
        result = { t, placementId: p.id, assetId: p.assetId };
    }
  }
  return result;
}
/** Conservative swept vertical capsule: a finite set of spheres covers the
 * spine, inflated by half their spacing so no thin obstacle slips between. */
export function atlasSweepWalker(placements: readonly AtlasPlacement[], footFrom: V3, footTo: V3, up: V3): AtlasCollision | null {
  const height = 1.8, radius = .525, steps = 3;
  let hit: AtlasCollision | null = null;
  for (const p of placements) {
    if (!p.solid) continue;
    const asset = getAtlasAsset(p.assetId);
    if (!asset || asset.proxy.kind === 'none') continue;
    const from = local(p, footFrom), to = local(p, footTo), basis = atlasPlacementBasis(p);
    const localUp = { x: dot(up, basis.x), y: dot(up, basis.y), z: dot(up, basis.z) };
    for (const box of asset.proxy.boxes) {
      // Standing on a box's upper face is support, not penetration. Its sides
      // still block whenever either foot is lower, so this cannot erase walls.
      if (box.max.y <= Math.min(from.y, to.y) + 1e-5) continue;
      for (let i = 0; i <= steps; i++) {
        const offset = scale(localUp, radius + (height - 2 * radius) * i / steps);
        const t = segmentBox(add(from, offset), add(to, offset), box, radius);
        if (t !== null && (!hit || t < hit.t || (t === hit.t && p.id < hit.placementId)))
          hit = { t, placementId: p.id, assetId: p.assetId };
      }
    }
  }
  return hit;
}
export const ATLAS_MAX_STEP = .55;
/** Native low floors can support a walker without modifying terrain. This is
 * measured from terrain ground, so it never turns a stair mesh into a teleport
 * to an arbitrarily high roof. Horizontal footprint uses the walker radius. */
export function atlasWalkSupport(placements: readonly AtlasPlacement[], ground: V3, up: V3, maxStep = ATLAS_MAX_STEP): number {
  let support = 0;
  for (const p of placements) {
    if (!p.solid) continue;
    const asset = getAtlasAsset(p.assetId);
    if (!asset || asset.proxy.kind === 'none') continue;
    const foot = local(p, ground), vertical = dot(up, p.up);
    if (vertical < .95) continue;
    for (const box of asset.proxy.boxes) {
      const rise = (box.max.y - foot.y) / vertical;
      if (rise <= support || rise > maxStep + 1e-6) continue;
      if (foot.x < box.min.x - .535 || foot.x > box.max.x + .535
        || foot.z < box.min.z - .535 || foot.z > box.max.z + .535) continue;
      support = rise;
    }
  }
  return support;
}
export interface AtlasWalkStep { blocked: boolean; foot: V3; support: number }
/** Lift, sweep horizontally, then lower. Every leg checks walls and headroom.
 * On refusal the caller keeps its current position; no obstacle is deleted. */
export function atlasStepWalker(placements: readonly AtlasPlacement[], footFrom: V3, groundTo: V3, up: V3): AtlasWalkStep {
  const support = atlasWalkSupport(placements, groundTo, up), foot = add(groundTo, scale(up, support));
  const rise = dot(sub(foot, footFrom), up);
  const topFrom = rise > 0 ? add(footFrom, scale(up, rise)) : footFrom;
  const topTo = rise < 0 ? sub(foot, scale(up, rise)) : foot;
  const blocked = !!atlasSweepWalker(placements, footFrom, topFrom, up)
    || !!atlasSweepWalker(placements, topFrom, topTo, up)
    || !!atlasSweepWalker(placements, topTo, foot, up);
  return { blocked, foot: blocked ? footFrom : foot, support };
}
/** Planet-local swept query. Long caller segments are split into bounded caps;
 * normal 20Hz travel needs one cap even at the maximum cruise speed. */
export function atlasPlanetSweep(planet: PlanetDescriptor, from: V3, to: V3, radius = 3, revision = 1): AtlasCollision | null {
  if (revision === 0) return null;
  const delta = sub(to, from), dist = length(delta), pieces = Math.max(1, Math.ceil(dist / 240));
  if (pieces > 2048) throw RangeError('Atlas sweep exceeds bounded travel segment');
  let result: AtlasCollision | null = null;
  for (let i = 0; i < pieces; i++) {
    const start = add(from, scale(delta, i / pieces)), end = add(from, scale(delta, (i + 1) / pieces));
    const mid = scale(add(start, end), .5), radialHeight = length(mid) - planet.radius;
    // Terrain envelope ±500 plus tallest admitted native landmark.
    if (radialHeight > 605 + radius || radialHeight < -510 - radius) continue;
    const cap = Math.min(256, length(sub(end, start)) / 2 + radius + 3);
    const placements = atlasPlanetPlacements(planet, mid, cap, revision);
    const hit = atlasSweepSphere(placements, start, end, radius);
    if (hit) {
      result = { ...hit, t: (i + hit.t) / pieces };
      break;
    }
  }
  return result;
}
export function atlasPlanetWalkBlocked(planet: PlanetDescriptor, from: V3, to: V3, revision = 1): boolean {
  if (revision === 0) return false;
  const radial = normalize(from), footFrom = sub(from, scale(radial, 3)), footTo = sub(to, scale(normalize(to), 3));
  const mid = scale(add(from, to), .5), cap = clamp(length(sub(from, to)) / 2 + 3, 3, 256);
  return !!atlasSweepWalker(atlasPlanetPlacements(planet, mid, cap, revision), footFrom, footTo, radial);
}
export function atlasPlanetSupport(planet: PlanetDescriptor, direction: V3, revision = 1): number {
  if (revision === 0) return 0;
  const up = normalize(direction), ground = scale(up, planet.radius + Math.max(0, terrainHeight(planet, up)));
  return atlasWalkSupport(atlasPlanetPlacements(planet, ground, 3, revision), ground, up);
}
/** Body centres remain three metres above the actual canonical support. */
export function atlasPlanetWalkStep(planet: PlanetDescriptor, from: V3, targetGround: V3, revision = 1): { blocked: boolean; position: V3 } {
  const up = normalize(targetGround);
  if (revision === 0) return { blocked: false, position: add(targetGround, scale(up, 3)) };
  const footFrom = sub(from, scale(normalize(from), 3)), mid = scale(add(from, targetGround), .5);
  const cap = clamp(length(sub(from, targetGround)) / 2 + 3, 3, 256);
  const result = atlasStepWalker(atlasPlanetPlacements(planet, mid, cap, revision), footFrom, targetGround, up);
  return { blocked: result.blocked, position: result.blocked ? from : add(result.foot, scale(up, 3)) };
}
/** A ship needs an empty approach and full hull clearance at touchdown.
 * Known generated arrival sites are reserved before population, not cleared here. */
export function atlasPlanetLandingClear(planet: PlanetDescriptor, position: V3, revision = 1): boolean {
  if (revision === 0) return true;
  const dir = normalize(position), height = Math.max(0, terrainHeight(planet, dir));
  const touchdown = scale(dir, planet.radius + height + 3);
  return !atlasPlanetSweep(planet, position, touchdown, 3, revision);
}
