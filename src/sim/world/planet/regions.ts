import { RNG } from '../../core/rng';
import { REALMS } from '../realms/layout';
import { FAR_ANCHOR, HOME_ANCHOR, biomeAt, dot, fromLatLon, normalize, toLatLon, type Biome, type PlanetSpec, type V3 } from './planet';

/** Named regions laid across the sphere: a seeded spherical Voronoi partition.
 * Region 0 is Cinderveil (the home route and the Tower), region 1 Aether Reach on the
 * far side; both keep their existing realm names. Everything else is seeded. */
export interface Region { id: string; index: number; name: string; centre: V3; lat: number; lon: number; biome: Biome; realm: 'brass' | 'aether' | null }
export const REGION_COUNT = 28;
const A = ['Ash', 'Thorn', 'Mor', 'Vel', 'Sil', 'Ered', 'Hollow', 'Lan', 'Cair', 'Bryn', 'Duskar', 'Wend', 'Orm', 'Tal', 'Kest', 'Rhun', 'Saer', 'Fen'];
const B = ['ford', 'mere', 'wick', 'march', 'reach', 'holt', 'moor', 'vale', 'crag', 'strand', 'weald', 'fell', 'shaw', 'deep', 'spire', 'down'];
const KIND: Record<Biome, string> = { ocean: 'Sea', beach: 'Coast', grassland: 'Downs', forest: 'Wood', taiga: 'Pinewood', tundra: 'Barrens', desert: 'Wastes', savanna: 'Plains', swamp: 'Fen', mountain: 'Heights', snow: 'Icefield' };

const cache = new WeakMap<PlanetSpec, Region[]>();
export function planetRegions(spec: PlanetSpec): Region[] {
  const hit = cache.get(spec); if (hit) return hit;
  const rng = new RNG(spec.seed ^ 0x7e610e5), out: Region[] = [], used = new Set<string>();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < REGION_COUNT; i++) {
    let centre: V3;
    if (i === 0) centre = HOME_ANCHOR; else if (i === 1) centre = FAR_ANCHOR;
    else {
      // Fibonacci lattice with seeded jitter: even coverage, distinct per seed.
      const k = i - 2, n = REGION_COUNT - 2, y = 1 - (k + .5) / n * 2, r = Math.sqrt(1 - y * y), t = golden * k + rng.range(-.35, .35);
      centre = normalize({ x: Math.cos(t) * r + rng.range(-.12, .12), y: y + rng.range(-.08, .08), z: Math.sin(t) * r + rng.range(-.12, .12) });
      // Keep the two charted realms clear of a neighbouring site.
      if (dot(centre, HOME_ANCHOR) > .96 || dot(centre, FAR_ANCHOR) > .96) centre = normalize({ x: -centre.x, y: centre.y, z: -centre.z });
    }
    const biome = i < 2 ? 'grassland' as Biome : biomeAt(spec, centre), { lat, lon } = toLatLon(centre);
    let name = i === 0 ? REALMS.brass.name : i === 1 ? REALMS.aether.name : '';
    while (!name || used.has(name)) name = `${rng.pick(A)}${rng.pick(B)} ${KIND[biome]}`;
    used.add(name);
    out.push({ id: `veil:planet:v1:${spec.seed}:region:${i}`, index: i, name, centre, lat, lon, biome, realm: i === 0 ? 'brass' : i === 1 ? 'aether' : null });
  }
  cache.set(spec, out); return out;
}
export function regionAt(spec: PlanetSpec, dir: V3): Region {
  const d = normalize(dir), regions = planetRegions(spec);
  let best = regions[0], bd = -2;
  for (const r of regions) { const s = dot(d, r.centre); if (s > bd) { bd = s; best = r; } }
  return best;
}
export { fromLatLon };
