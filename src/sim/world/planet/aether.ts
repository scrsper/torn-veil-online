import { generateRealmChunk, REALM_CHUNK, type RealmChunk } from '../realms/layout';
import { FAR_ANCHOR, arc, normalize, type PlanetSpec, type V3 } from './planet';
import { planetToRealm, type RealmChart } from './chart';

/** Aether Reach on the far plateau: the canonical seeded realm city (3×3 chunks around its
 * plaza) charted onto the sphere. The realm's own Tower building is left out: the Tower
 * stands once, as the pagoda in Cinderveil. Realm chunk origin 3072 sits 48 m west/south of
 * the anchor so the plaza chunk is centred on it. */
export const AETHER_CHART: RealmChart = { anchor: FAR_ANCHOR, origin: { x: 48, z: 48 }, floorY: 1 };
const ORIGIN = 3072, FIRST = 31, LAST = 33;
const cache = new Map<number, RealmChunk[]>();
export function aetherChunks(seed: number): RealmChunk[] {
  const hit = cache.get(seed); if (hit) return hit;
  const out: RealmChunk[] = [];
  for (let cx = FIRST; cx <= LAST; cx++) for (let cz = FIRST; cz <= LAST; cz++) {
    const chunk = generateRealmChunk({ version: 1, seed }, 'aether', cx, cz);
    out.push({ ...chunk, buildings: chunk.buildings.filter(b => b.use !== 'tower') });
  }
  cache.set(seed, out); return out;
}
/** Same solidity as RealmGrid.get for these chunks: building solids, and closed door openings.
 * Probes the body's footprint (radius .3) at feet and chest height. */
export function aetherBlocks(spec: PlanetSpec, p: V3): boolean {
  if (arc(spec, normalize(p), FAR_ANCHOR) > 260) return false;
  const r = planetToRealm(spec, AETHER_CHART, p), gx = r.x + ORIGIN, gz = r.z + ORIGIN;
  for (const c of aetherChunks(spec.seed)) {
    if (gx < c.x - 1 || gx >= c.x + REALM_CHUNK + 1 || gz < c.z - 1 || gz >= c.z + REALM_CHUNK + 1) continue;
    for (const b of c.buildings) {
      if (gx < b.x - .3 || gx >= b.x + b.w + .3 || gz < b.z - .3 || gz >= b.z + b.d + .3) continue;
      const door = b.use === 'tower' ? 5 : 3;
      for (const [ox, oz] of [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) for (const y of [r.y + .5, r.y + 1.5]) {
        const x = gx + ox, z = gz + oz;
        if (Math.floor(z) === b.door.z && x >= b.door.x - Math.floor(door / 2) && x < b.door.x + Math.ceil(door / 2) && x >= b.x && x < b.x + b.w && y < 4) return true;
        if (b.solids.some(s => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h && z >= s.z && z < s.z + s.d)) return true;
      }
    }
  }
  return false;
}
