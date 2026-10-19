import { PAGODA_SHAPE } from './pagoda';

/** The pagoda's temple precinct, in the pagoda's local frame (+Y up, door on -Z, metres):
 * a paved approach from the stair foot, lantern posts in pairs along it, braziers at the
 * stair, and a low stone wall around the terrace with a gateway on the approach side.
 * Every piece is a module from the focused runtime pack (hash-verified by the client). */
export interface PrecinctPiece { id: string; assetId: string; x: number; z: number; yaw: number; half: readonly [number, number] | null }
export const PRECINCT = Object.freeze({ wall: 26, gate: 6, approachEnd: -46.8, lampRows: [-27, -33, -39, -45] as const, lampX: 5.2 });
const stairFoot = -PAGODA_SHAPE.podium[0] - 4.8;

function build(): PrecinctPiece[] {
  const out: PrecinctPiece[] = [], P = PRECINCT;
  // Paving: two 4 m tiles wide (the stair is 6 m), from the stair foot out past the gateway.
  for (let z = stairFoot - 2, row = 0; z - 2 >= P.approachEnd - .01; z -= 4, row++)
    for (const x of [-2, 2]) out.push({ id: `precinct:pave:${row}:${x}`, assetId: 'module:floor_paving', x, z, yaw: 0, half: null });
  out.push(...[-1, 1].map(s => ({ id: `precinct:brazier:${s}`, assetId: 'module:brazier', x: s * 4.6, z: stairFoot - 1.2, yaw: 0, half: [.6, .6] as const })));
  for (const z of P.lampRows) for (const s of [-1, 1]) out.push({ id: `precinct:lamp:${z}:${s}`, assetId: 'module:lantern_post', x: s * P.lampX, z, yaw: s * Math.PI / 2, half: [.2, .2] });
  // Wall: 4 m parapet segments on a square, the middle of the approach side left open.
  for (let side = 0; side < 4; side++) for (let k = -6; k <= 6; k++) {
    const a = k * 4, [x, z] = [[a, -P.wall], [P.wall, a], [a, P.wall], [-P.wall, a]][side];
    if (side === 0 && Math.abs(a) < P.gate) continue;
    const along = side % 2 === 0;
    out.push({ id: `precinct:wall:${side}:${k}`, assetId: 'module:parapet', x, z, yaw: along ? 0 : Math.PI / 2, half: along ? [2.04, .3] : [.3, 2.04] });
  }
  // Gate posts: plain stone columns capping the wall either side of the opening.
  for (const s of [-1, 1]) out.push({ id: `precinct:post:${s}`, assetId: 'module:column', x: s * P.gate, z: -P.wall, yaw: 0, half: [.5, .5] });
  return out;
}
const PIECES = Object.freeze(build());
export function precinctPieces(): readonly PrecinctPiece[] { return PIECES; }
/** True when a body of `radius` at local (x, z) overlaps a solid precinct piece. */
export function precinctBlocks(x: number, z: number, radius = .45): boolean {
  if (Math.abs(x) > PRECINCT.wall + 3 || z > PRECINCT.wall + 3 || z < PRECINCT.approachEnd - 3) return false;
  for (const p of PIECES) if (p.half && Math.abs(x - p.x) < p.half[0] + radius && Math.abs(z - p.z) < p.half[1] + radius) return true;
  return false;
}
