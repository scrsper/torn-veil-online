import { HOME_ANCHOR, HOME_PLATEAU, chartToDir, dirToChart, length, normalize, scale, type PlanetSpec, type V3 } from './planet';

/** Bent chart for flat realm content. A realm-local point (x, y, z) — right-handed, +Y up,
 * realm +z running toward the Tower — maps to the sphere by east = -x, north = z on the home
 * chart and radius = sea + plateau + (y - floor). The same map serves rendering (vertices are
 * bent onto the curve) and physics (the walker queries the realm's own static geometry in
 * realm coordinates), so the existing town → forest → Tower route keeps its geometry. */
export interface RealmChart { anchor: V3; origin: { x: number; z: number }; floorY: number }
export const homeChart = (origin: { x: number; z: number }, floorY = 1): RealmChart => ({ anchor: HOME_ANCHOR, origin, floorY });
export function realmToPlanet(spec: PlanetSpec, c: RealmChart, x: number, y: number, z: number): V3 {
  const d = chartToDir(c.anchor, -(x - c.origin.x), z - c.origin.z, spec.radius);
  return scale(d, spec.radius + HOME_PLATEAU.height + (y - c.floorY));
}
export function planetToRealm(spec: PlanetSpec, c: RealmChart, p: V3): { x: number; y: number; z: number } {
  const { east, north } = dirToChart(c.anchor, normalize(p), spec.radius);
  return { x: c.origin.x - east, y: length(p) - spec.radius - HOME_PLATEAU.height + c.floorY, z: c.origin.z + north };
}
