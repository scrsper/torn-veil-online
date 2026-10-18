import { LIBRARY_PLACEMENTS, libraryAsset, placementDir, regionLandmarks } from '../assets/library';
import { dot, normalize, sub, tangentFrame, type PlanetSpec, type V3 } from './planet';

/** Gorges carved into the canonical height field under every ravine-bridge placement, so the
 * bridge spans a real ravine and its own banks and water show. Pure and seeded via the
 * placements. The profile follows the library GLB (tv_05_01_ravine_bridge, asset-local metres):
 * vertical banks at |z| = 6 over the whole x span, gorge water at -3.8 and bed at about -4.1.
 * The planet ground drops just below the bed between the banks and comes back up under the
 * asset's own bank slabs. Over the last `shore` metres inside each end the bed rises through
 * the water line to `rim` (so the asset's water ends on a shore, not in mid-air), and the
 * ravine shallows out over `run` metres past the asset's ends.
 * Placements themselves sit on the uncarved (levelled) ground. */
export const RAVINE = { halfWidth: 6.5, bank: 2.5, depth: 4.6, rim: 3.6, shore: 4, run: 40 } as const;
export interface Ravine { dir: V3; yaw: number; x0: number; x1: number }
const cache = new WeakMap<PlanetSpec, Ravine[]>();
export function planetRavines(spec: PlanetSpec): Ravine[] {
  const hit = cache.get(spec); if (hit) return hit;
  const out: Ravine[] = [];
  // Landmarks are chosen from region biomes, which read the uncarved height, so this never recurses.
  for (const p of [...LIBRARY_PLACEMENTS, ...regionLandmarks(spec)]) {
    const a = libraryAsset(p.assetId); if (a?.family !== 'ravine_bridge') continue;
    out.push({ dir: placementDir(spec, p), yaw: p.yaw, x0: a.bounds.min[0], x1: a.bounds.max[0] });
  }
  cache.set(spec, out); return out;
}
const smooth = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
/** Metres the canonical ground is lowered at `d` (0 outside every ravine). */
export function ravineDepth(spec: PlanetSpec, d: V3): number {
  let depth = 0;
  const reach = (RAVINE.run + 40) / spec.radius, near = Math.cos(reach);
  for (const r of planetRavines(spec)) {
    if (dot(d, r.dir) < near) continue;
    // Placement-local (x, z): the client's root frame maps local +x to west, +z to north, then yaw.
    const f = tangentFrame(r.dir), rel = sub(normalize(d), r.dir), w = -dot(rel, f.east) * spec.radius, n = dot(rel, f.north) * spec.radius;
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw), x = w * c - n * s, z = w * s + n * c;
    const across = 1 - smooth((Math.abs(z) - RAVINE.halfWidth) / RAVINE.bank);
    const inside = Math.min(x - r.x0, r.x1 - x);
    const along = inside >= RAVINE.shore ? RAVINE.depth : inside >= 0 ? RAVINE.rim + (RAVINE.depth - RAVINE.rim) * smooth(inside / RAVINE.shore) : RAVINE.rim * (1 - smooth(-inside / RAVINE.run));
    depth = Math.max(depth, along * across);
  }
  return depth;
}
