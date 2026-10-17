import { FAR_ANCHOR, HOME_ANCHOR, HOME_ROUTE, add, arc, chartToDir, dot, landmarkSites, normalize, scale, surfaceHeight, type PlanetSpec, type V3 } from './planet';

/** Roads: a minimum spanning tree over the settled sites (Cinderveil's south gate, Aether
 * Reach and every landmark), each edge a sampled great-circle route. Stretches below the
 * shore are fords/ferries and are flagged, not drawn as road. Pure and seeded via the sites. */
export interface Road { id: string; from: number; to: number; points: V3[]; wet: boolean[] }
export const ROAD_STEP = 16;
export const ROAD_HALF_WIDTH = 2.2;
function slerp(a: V3, b: V3, t: number): V3 {
  const c = Math.max(-1, Math.min(1, dot(a, b))), w = Math.acos(c);
  if (w < 1e-9) return a;
  const s = Math.sin(w);
  return normalize(add(scale(a, Math.sin((1 - t) * w) / s), scale(b, Math.sin(t * w) / s)));
}
const cache = new WeakMap<PlanetSpec, Road[]>();
export function planetRoads(spec: PlanetSpec): Road[] {
  const hit = cache.get(spec); if (hit) return hit;
  // Home roads leave from the south gate (beyond the gatehouse), not through the town.
  const gate = chartToDir(HOME_ANCHOR, 0, HOME_ROUTE.town[0] - 140, spec.radius);
  const nodes: V3[] = [gate, FAR_ANCHOR, ...landmarkSites(spec).map(s => s.dir)];
  // Prim's algorithm on great-circle distance; deterministic tie-break by index.
  const inTree = new Set([0]), edges: [number, number][] = [];
  while (inTree.size < nodes.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < nodes.length; j++) {
      if (inTree.has(j)) continue;
      const d = arc(spec, nodes[i], nodes[j]);
      if (d < bd - 1e-9) { bd = d; best = [i, j]; }
    }
    edges.push(best!); inTree.add(best![1]);
  }
  const out = edges.map(([a, b], k) => {
    const n = Math.max(2, Math.ceil(arc(spec, nodes[a], nodes[b]) / ROAD_STEP)), points: V3[] = [], wet: boolean[] = [];
    for (let i = 0; i <= n; i++) { const p = slerp(nodes[a], nodes[b], i / n); points.push(p); wet.push(surfaceHeight(spec, p) < 1); }
    return { id: `road:${k}`, from: a, to: b, points, wet };
  });
  // Spur from the network's gate node north to the town gatehouse, over the ravine bridge.
  const spurEnd = chartToDir(HOME_ANCHOR, 0, -98, spec.radius), m = Math.ceil(arc(spec, gate, spurEnd) / ROAD_STEP), spur: V3[] = [];
  for (let i = 0; i <= m; i++) spur.push(slerp(gate, spurEnd, i / m));
  out.unshift({ id: 'road:home-gate', from: 0, to: 0, points: spur, wet: spur.map(p => surfaceHeight(spec, p) < 1) });
  cache.set(spec, out); return out;
}
/** Is a direction on a dry stretch of road (within the half width plus a margin)? */
const index = new WeakMap<PlanetSpec, Map<string, V3[]>>();
const key = (d: V3) => `${Math.round(d.x * 80)},${Math.round(d.y * 80)},${Math.round(d.z * 80)}`;
export function nearRoad(spec: PlanetSpec, dir: V3, margin = 1.5): boolean {
  let grid = index.get(spec);
  if (!grid) {
    grid = new Map();
    for (const r of planetRoads(spec)) r.points.forEach((p, i) => { if (r.wet[i]) return; const k = key(p); const list = grid!.get(k); if (list) list.push(p); else grid!.set(k, [p]); });
    index.set(spec, grid);
  }
  const d = normalize(dir), cx = Math.round(d.x * 80), cy = Math.round(d.y * 80), cz = Math.round(d.z * 80), lim = ROAD_HALF_WIDTH + margin + ROAD_STEP / 2;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const p of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) if (arc(spec, d, p) < lim) return true;
  return false;
}
