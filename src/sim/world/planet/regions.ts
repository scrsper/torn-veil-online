import { RNG } from '../../core/rng';
import { REALMS } from '../realms/layout';
import { REGION_SITES, biomeAt, dot, fromLatLon, normalize, regionCentres, toLatLon, type Biome, type PlanetSpec, type V3 } from './planet';

/** Named regions laid across the sphere: a seeded spherical Voronoi partition.
 * Region 0 is Cinderveil (the home route and the Tower), region 1 Aether Reach on the
 * far side; both keep their existing realm names. Everything else is seeded. */
export interface Region { id: string; index: number; name: string; centre: V3; lat: number; lon: number; biome: Biome; realm: 'brass' | 'aether' | null }
export const REGION_COUNT = REGION_SITES;
const A = ['Ash', 'Thorn', 'Mor', 'Vel', 'Sil', 'Ered', 'Hollow', 'Lan', 'Cair', 'Bryn', 'Duskar', 'Wend', 'Orm', 'Tal', 'Kest', 'Rhun', 'Saer', 'Fen'];
const B = ['ford', 'mere', 'wick', 'march', 'reach', 'holt', 'moor', 'vale', 'crag', 'strand', 'weald', 'fell', 'shaw', 'deep', 'spire', 'down'];
const KIND: Record<Biome, string> = { ocean: 'Sea', beach: 'Coast', grassland: 'Downs', forest: 'Wood', taiga: 'Pinewood', tundra: 'Barrens', desert: 'Wastes', savanna: 'Plains', swamp: 'Fen', mountain: 'Heights', snow: 'Icefield' };

const cache = new WeakMap<PlanetSpec, Region[]>();
export function planetRegions(spec: PlanetSpec): Region[] {
  const hit = cache.get(spec); if (hit) return hit;
  const rng = new RNG(spec.seed ^ 0x5eed7a3e), out: Region[] = [], used = new Set<string>(), centres = regionCentres(spec);
  for (let i = 0; i < REGION_COUNT; i++) {
    const centre = centres[i];
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
