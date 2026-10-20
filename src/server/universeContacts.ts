/** Read-only, bounded floor evidence for the spherical character's visual feet.
 * Reuses the host's actual geometry; never moves a body or changes a save. */
import { createHash } from 'node:crypto';
import type { RealmSession } from '../sim/world/realms/session';
import type { TravelState } from '../sim/world/universe/travel';
import type { PlanetDescriptor } from '../sim/world/universe/generation';
import { add, sub, scale, normalize, planetSpec, type V3 } from '../sim/world/planet/planet';
import { settlementAt, settlementPatches } from '../sim/world/universe/settlements';
import { realmToPlanet } from '../sim/world/planet/chart';
import type { MovementGeometry, StaticTriangle } from '../sim/physical/staticGeometry';

export const CONTACT_TRIANGLE_LIMIT = 768;
export interface UniverseContactPatch {
  id: string; planetId: string; origin: V3;
  /** Conservative tangent-space domain, inscribed in the sampled cell window. */
  radius: number;
  /** Sphere-space offsets from origin, not rendered/rebased coordinates. */
  triangles: readonly (readonly number[])[];
  available: boolean; reason: 'ready' | 'budget' | 'unsupported';
}
const cache = new WeakMap<MovementGeometry, Map<string, UniverseContactPatch>>();

export function universeContactPatch(s: RealmSession, state: TravelState | undefined,
  planet: PlanetDescriptor | undefined): UniverseContactPatch | null {
  if (!state || !planet || planet.index !== 0 || state.mode !== 'surface' || state.settlementRevision !== 1
    || state.systemIndex !== 0 || state.landedPlanetId !== planet.id) return null;
  const spec = planetSpec(s.world.seed, planet.radius), local = sub(state.position, planet.center);
  const feet = sub(local, scale(normalize(local), 3));
  const address = settlementAt(spec, feet, settlementPatches(s.grid));
  if (!address) return null;
  const p = address.planar, x = Math.floor(p.x) - 2, z = Math.floor(p.z) - 2, y = Math.round(p.y * 2) / 2;
  const geometry = s.grid.movementGeometryAt(p.x, p.z);
  const key = planet.id + ':' + address.patch.realm + ':' + x + ':' + z + ':' + y;
  let entries = geometry ? cache.get(geometry) : undefined;
  if (entries?.has(key)) return entries.get(key)!;
  const triangles: StaticTriangle[] = geometry ? geometry.window(x, z, 5).triangles : [];
  if (!geometry) {
    // Native realm floors use the same occupied voxel tops as canonical support.
    for (let ix = x; ix < x + 5; ix++) for (let iz = z; iz < z + 5; iz++) {
      for (let iy = Math.ceil(y + .75); iy >= Math.floor(y - .75); iy--) {
        if (iy <= 0 || iy > s.grid.H || !s.grid.isSolidAt(ix + .5, iy - .5, iz + .5)
          || s.grid.isSolidAt(ix + .5, iy + .1, iz + .5)) continue;
        triangles.push({ p: [ix, iy, iz, ix, iy, iz + 1, ix + 1, iy, iz], support: true },
          { p: [ix + 1, iy, iz, ix, iy, iz + 1, ix + 1, iy, iz + 1], support: true });
      }
    }
  }
  const support = triangles.filter(t => {
    if (!t.support) return false;
    const a = t.p;
    if (Math.max(a[0], a[3], a[6]) < x || Math.min(a[0], a[3], a[6]) > x + 5
      || Math.max(a[2], a[5], a[8]) < z || Math.min(a[2], a[5], a[8]) > z + 5
      || Math.min(a[1], a[4], a[7]) > y + .75 || Math.max(a[1], a[4], a[7]) < y - .75) return false;
    const ux = a[3] - a[0], uy = a[4] - a[1], uz = a[5] - a[2];
    const vx = a[6] - a[0], vy = a[7] - a[1], vz = a[8] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return ny / Math.hypot(nx, ny, nz) >= .65;
  });
  const origin = add(planet.center, realmToPlanet(spec, address.patch.chart, x + 2.5, y, z + 2.5));
  const available = support.length > 0 && support.length <= CONTACT_TRIANGLE_LIMIT;
  const mapped = available ? support.map(t => {
    const result: number[] = [];
    for (let i = 0; i < 9; i += 3) {
      const point = sub(add(planet.center, realmToPlanet(spec, address.patch.chart, t.p[i], t.p[i + 1], t.p[i + 2])), origin);
      result.push(point.x, point.y, point.z);
    }
    return Object.freeze(result);
  }) : [];
  const digest = createHash('sha256').update(JSON.stringify(mapped)).digest('hex').slice(0, 16);
  const result: UniverseContactPatch = Object.freeze({ id: key + ':' + digest, planetId: planet.id,
    origin: Object.freeze(origin), radius: 2.45, triangles: Object.freeze(mapped), available,
    reason: available ? 'ready' : support.length ? 'budget' : 'unsupported' });
  if (geometry) {
    if (!entries) { entries = new Map(); cache.set(geometry, entries); }
    if (entries.size >= 16) entries.delete(entries.keys().next().value!);
    entries.set(key, result);
  }
  return result;
}
