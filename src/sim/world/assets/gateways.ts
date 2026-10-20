import { add, arc, cross, dirToChart, landmarkSites, normalize, regionCentres, scale, sub, surfaceRadius, tangentFrame, type PlanetSpec, type V3 } from '../planet/planet';
import { planetRoads } from '../planet/roads';
import { ravineDepth } from '../planet/ravines';
import { libraryContact } from './libraryCollision';
import { regionLandmarks, libraryAsset, type LibraryPlacement } from './library';

/** Settlement gateways: a plain stone gateway (the focused pack's `module:arch`, two piers and a
 * lintel, scaled ×1.4 so its opening clears the road) over each road where it enters a landmark
 * settlement, just past the levelled ground. A gate moves outward (to at most 64 m) until both
 * piers clear every library space on that site and its cooked walls; it is dropped over water or
 * a ravine, or when another road's gate already stands there. Pure and seeded via the roads. */
export interface Gateway { id: string; assetId: string; dir: V3; facing: V3; scale: number; piers: { dir: V3; radius: number }[] }
export const GATEWAY = Object.freeze({ assetId: 'module:arch', scale: 1.4, start: 44, end: 64, step: 2, pierX: 1.65, pierRadius: .5 });

function slerpArc(spec: PlanetSpec, from: V3, toward: V3, metres: number): V3 {
  const a = normalize(from), t = normalize(sub(toward, scale(a, a.x * toward.x + a.y * toward.y + a.z * toward.z)));
  const w = metres / spec.radius;
  return normalize(add(scale(a, Math.cos(w)), scale(t, Math.sin(w))));
}
const cache = new WeakMap<PlanetSpec, Gateway[]>();
export function settlementGateways(spec: PlanetSpec): Gateway[] {
  const hit = cache.get(spec); if (hit) return hit;
  const sites = landmarkSites(spec), centres = regionCentres(spec), landmarks = regionLandmarks(spec), out: Gateway[] = [];
  const G = GATEWAY, half = G.pierX * G.scale;
  const clear = (site: number, d: V3, r: number) => {
    for (const q of landmarks.filter(p => p.site === site)) {
      const b = libraryAsset(q.assetId)?.bounds; if (!b) continue;
      const c = dirToChart(centres[site], d, spec.radius), l = siteLocal(q, c.east, c.north);
      if (l.x > b.min[0] - r && l.x < b.max[0] + r && l.z > b.min[2] - r && l.z < b.max[2] + r) return false;
    }
    return !libraryContact(spec, scale(d, surfaceRadius(spec, d)), () => true).blocked;
  };
  for (const road of planetRoads(spec)) {
    if (road.id === 'road:home-gate') continue;
    for (const [node, end] of [[road.from, 0], [road.to, road.points.length - 1]] as const) {
      const s = sites[node - 2]; if (node < 2 || !s || !landmarks.some(p => p.site === s.region)) continue;
      const centre = road.points[end], next = road.points[end ? end - 1 : 1];
      for (let m = G.start; m <= G.end; m += G.step) {
        const dir = slerpArc(spec, centre, next, m), ahead = slerpArc(spec, centre, next, m + 1);
        if (surfaceRadius(spec, dir) - spec.radius < 1 || ravineDepth(spec, dir) > 0) break;
        const t = tangentFrame(dir), facing = normalize(sub(ahead, dir)), side = normalize(cross(facing, t.up));
        const piers = [-1, 1].map(k => ({ dir: normalize(add(dir, scale(side, k * half / spec.radius))), radius: G.pierRadius * G.scale }));
        if (!piers.every(p => clear(s.region, p.dir, p.radius + .3))) continue;
        if (out.some(g => arc(spec, g.dir, dir) < 12)) break;
        out.push({ id: `gateway:${road.id}:${s.region}`, assetId: G.assetId, dir, facing, scale: G.scale, piers });
        break;
      }
    }
  }
  cache.set(spec, out); return out;
}
/** Chart (east, north) around the site centre → the placement's asset-local (x, z) (inverse of placementLocal). */
function siteLocal(p: LibraryPlacement, east: number, north: number) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), rx = p.east - east, rz = north - p.north;
  return { x: rx * c - rz * s, z: rx * s + rz * c };
}
