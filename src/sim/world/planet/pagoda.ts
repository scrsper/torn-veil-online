/** Physical footprint of the Tower of Chrysanthus exterior (an East Asian pagoda) in its
 * local frame: +Y up, door on the -Z face, metres. Presentation builds its mesh from the
 * same numbers; the walker uses `pagodaSupport` and `pagodaBlocks` for contact. */
export const PAGODA_SHAPE = Object.freeze({ tiers: 9, base: 22, storey: 6.4, taper: .072, podium: [16, 13.5] as const, podiumStep: 1.2, stairWidth: 6, doorWidth: 3.6 });
/** Height of walkable stone above the surrounding ground, or null off the footprint. */
export function pagodaSupport(x: number, z: number): number | null {
  const [outer, inner] = PAGODA_SHAPE.podium, ax = Math.abs(x), az = Math.abs(z), h = PAGODA_SHAPE.podiumStep;
  if (ax <= inner && az <= inner) return h * 2;
  // The stair landing crosses the outer step at full podium height.
  if (ax <= PAGODA_SHAPE.stairWidth / 2 && z < -inner && z >= -outer) return h * 2;
  if (ax <= outer && az <= outer) return h;
  // Front stair: four 0.6 m steps rising toward the podium on the door side.
  if (ax <= PAGODA_SHAPE.stairWidth / 2 && z < -outer && z >= -outer - 4.8) return Math.max(0, Math.ceil((z + outer + 4.8) / 1.2)) * .6;
  return null;
}
/** The ground storey's walls (with the door opening) are solid. */
export function pagodaBlocks(x: number, z: number, radius = .45): boolean {
  const half = PAGODA_SHAPE.base * .78 / 2 + radius, ax = Math.abs(x);
  if (ax > half || Math.abs(z) > half) return false;
  return !(z < 0 && ax < PAGODA_SHAPE.doorWidth / 2 - radius && z < -half + 1.6);
}
