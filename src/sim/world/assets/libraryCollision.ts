import collisionData from './libraryCollision.json';
import { LIBRARY_PLACEMENTS, libraryAsset, placementDir, regionLandmarks, type LibraryPlacement } from './library';
import { arc, dot, normalize, scale, sub, surfaceRadius, tangentFrame, type PlanetSpec, type V3 } from '../planet/planet';

/** Walker collision for the real library GLBs, cooked from their geometry by
 * scripts/world/cook-library-collision.mjs (the library ships no colliders). Per asset: a
 * 0.25 m blocking grid (steep faces between step and head height above the floor) and a
 * 0.5 m walkable-floor heightfield in asset-local metres. Keyed by sha256: a footprint only
 * applies to the exact bytes it was cooked from. */
interface Cooked { sha256: string; origin: [number, number]; size: [number, number]; bits: string; floor: string }
const DATA = collisionData as unknown as { cell: number; floorCell: number; floorStep: number; assets: Record<string, Cooked> };
export interface Footprint { id: string; x0: number; z0: number; nx: number; nz: number; fx: number; bits: Uint8Array; floor: Uint8Array }
const decode = (s: string) => { const b = atob(s), out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
const footprints = new Map<string, Footprint | null>();
export function libraryFootprint(assetId: string): Footprint | null {
  if (footprints.has(assetId)) return footprints.get(assetId)!;
  const c = DATA.assets[assetId], a = libraryAsset(assetId);
  const f = c && a && c.sha256 === a.sha256 ? { id: assetId, x0: c.origin[0], z0: c.origin[1], nx: c.size[0], nz: c.size[1], fx: Math.ceil(c.size[0] / 2), bits: decode(c.bits), floor: decode(c.floor) } : null;
  footprints.set(assetId, f); return f;
}
/** Asset-local blocking (the body's centre cell) and floor height (m above asset ground). */
export function footprintBlocked(f: Footprint, x: number, z: number): boolean {
  const i = Math.floor((x - f.x0) / DATA.cell), k = Math.floor((z - f.z0) / DATA.cell);
  if (i < 0 || i >= f.nx || k < 0 || k >= f.nz) return false;
  const n = k * f.nx + i; return ((f.bits[n >> 3] >> (n & 7)) & 1) === 1;
}
export function footprintFloor(f: Footprint, x: number, z: number): number | null {
  const i = Math.floor((x - f.x0) / DATA.floorCell), k = Math.floor((z - f.z0) / DATA.floorCell);
  if (i < 0 || i >= f.fx || k < 0 || k >= Math.ceil(f.nz / 2)) return null;
  return f.floor[k * f.fx + i] * DATA.floorStep;
}
interface Placed { p: LibraryPlacement; f: Footprint; dir: V3; reach: number }
const placedCache = new WeakMap<PlanetSpec, Placed[]>();
function placed(spec: PlanetSpec): Placed[] {
  let list = placedCache.get(spec);
  if (!list) {
    list = [];
    for (const p of [...LIBRARY_PLACEMENTS, ...regionLandmarks(spec)]) {
      const f = libraryFootprint(p.assetId); if (!f) continue;
      const reach = Math.hypot(Math.max(Math.abs(f.x0), Math.abs(f.x0 + f.nx * DATA.cell)), Math.max(Math.abs(f.z0), Math.abs(f.z0 + f.nz * DATA.cell)));
      list.push({ p, f, dir: placementDir(spec, p), reach });
    }
    placedCache.set(spec, list);
  }
  return list;
}
/** Planet point → placement-local (x, z), inverting the client's root frame (local +x west, +z
 * north, then yaw), and the root's radius. */
export function placementLocalOf(spec: PlanetSpec, dir: V3, yaw: number, p: V3) {
  const f = tangentFrame(dir), rootR = surfaceRadius(spec, dir), rel = sub(p, scale(dir, rootR)), w = -dot(rel, f.east), n = dot(rel, f.north), c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: w * c - n * s, z: w * s + n * c, rootR };
}
const BODY = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]] as const;
/** Contact with any library placement whose real GLB is shown (`shown(assetId)`): whether the
 * body (0.3 m) overlaps a blocked cell, and the radius of the walkable floor under it. */
export function libraryContact(spec: PlanetSpec, pos: V3, shown: (assetId: string) => boolean): { blocked: boolean; floorRadius: number | null } {
  const up = normalize(pos); let blocked = false, floorRadius: number | null = null;
  for (const q of placed(spec)) {
    if (!shown(q.p.assetId) || arc(spec, up, q.dir) > q.reach + 1) continue;
    const l = placementLocalOf(spec, q.dir, q.p.yaw, pos);
    if (!blocked) for (const [ox, oz] of BODY) if (footprintBlocked(q.f, l.x + ox, l.z + oz)) { blocked = true; break; }
    const h = footprintFloor(q.f, l.x, l.z);
    if (h !== null && h > 0) floorRadius = Math.max(floorRadius ?? -Infinity, l.rootR + h);
  }
  return { blocked, floorRadius };
}
