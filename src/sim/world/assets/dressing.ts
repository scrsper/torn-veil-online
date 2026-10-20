import { add, arc, normalize, scale, sub, surfaceRadius, tangentFrame, type PlanetSpec, type V3 } from '../planet/planet';
import { nearRoad } from '../planet/roads';
import { libraryContact } from './libraryCollision';
import { LIBRARY_PLACEMENTS, libraryAsset, placementDir, placementLocal, regionLandmarks, type LibraryPlacement } from './library';

/** Settlement furniture from the focused pack's module catalog, set just outside the walkable
 * ports of placed library spaces: goods (barrel and crate clusters) beside the ways into
 * markets, taverns and lanes; lantern posts either side of watchposts and gatehouses; braziers
 * at dungeon mouths. A piece is dropped if it would stand inside any library space, against
 * a cooked GLB wall, or on a road. Pure and seeded by the placements. */
export interface Dressing { id: string; assetId: string; dir: V3; facing: V3; radius: number; scale?: number }
const FLANKS: Record<string, [string, string] | undefined> = {
  market_square: ['module:barrel_cluster', 'module:crate_cluster'], tavern: ['module:barrel_cluster', 'module:crate_cluster'], village_lane: ['module:crate_cluster', 'module:barrel_cluster'],
  watchpost: ['module:lantern_post', 'module:lantern_post'], gatehouse: ['module:lantern_post', 'module:lantern_post'], dungeon_junction: ['module:brazier', 'module:brazier'],
};
export const DRESSING_RADIUS: Record<string, number> = { 'module:barrel_cluster': .9, 'module:crate_cluster': .95, 'module:lantern_post': .25, 'module:brazier': .6 };
/** Chart (east, north) → asset-local (x, z): the inverse of `placementLocal`. */
function chartToLocal(p: LibraryPlacement, east: number, north: number) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), rx = p.east - east, rz = north - p.north;
  return { x: rx * c - rz * s, z: rx * s + rz * c };
}
const cache = new WeakMap<PlanetSpec, Dressing[]>();
export function settlementDressing(spec: PlanetSpec): Dressing[] {
  const hit = cache.get(spec); if (hit) return hit;
  const placements = [...LIBRARY_PLACEMENTS, ...regionLandmarks(spec)], out: Dressing[] = [];
  const sameGround = (a: LibraryPlacement, b: LibraryPlacement) => a.anchor === b.anchor && a.site === b.site;
  for (const p of placements) {
    const a = libraryAsset(p.assetId), flank = a && FLANKS[a.family];
    if (!a || !flank) continue;
    for (const port of a.ports.filter(q => q.kind === 'walkable').slice(0, 2)) {
      const [px, , pz] = port.position, [ox, , oz] = port.outward, half = port.width / 2 + 2.2;
      flank.forEach((assetId, k) => {
        const sgn = k ? -1 : 1, x = px + ox * 2.5 - oz * half * sgn, z = pz + oz * 2.5 + ox * half * sgn;
        const c = placementLocal(p, x, z), f = placementLocal(p, x + ox, z + oz), r = DRESSING_RADIUS[assetId];
        // Not inside any library space on this ground (bounds plus the piece's own radius).
        for (const q of placements) {
          if (!sameGround(p, q)) continue;
          const b = libraryAsset(q.assetId)?.bounds; if (!b) continue;
          const l = chartToLocal(q, c.east, c.north);
          if (l.x > b.min[0] - r && l.x < b.max[0] + r && l.z > b.min[2] - r && l.z < b.max[2] + r) return;
        }
        const dir = placementDir(spec, { anchor: p.anchor, site: p.site, east: c.east, north: c.north });
        if (nearRoad(spec, dir, r + .3)) return;
        // Nor against any real GLB's cooked walls (footprints can reach past the manifest bounds).
        const t = tangentFrame(dir), ring = [0, 1, 2, 3, 4, 5, 6, 7].map(i => normalize(add(dir, add(scale(t.east, Math.sin(i * Math.PI / 4) * (r + .3) / spec.radius), scale(t.north, Math.cos(i * Math.PI / 4) * (r + .3) / spec.radius)))));
        if ([dir, ...ring].some(d => libraryContact(spec, scale(d, surfaceRadius(spec, d)), () => true).blocked)) return;
        const ahead = placementDir(spec, { anchor: p.anchor, site: p.site, east: f.east, north: f.north });
        out.push({ id: `dress:${p.id}:${port.id}:${k}`, assetId, dir, facing: normalize(sub(ahead, dir)), radius: r });
      });
    }
  }
  // No two pieces on top of each other (adjacent spaces can share a port line).
  const kept = out.filter((d, i) => !out.slice(0, i).some(e => arc(spec, d.dir, e.dir) < d.radius + e.radius + .4));
  cache.set(spec, kept); return kept;
}
