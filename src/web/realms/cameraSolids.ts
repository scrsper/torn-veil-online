import type { ObstructionQuery, V3 } from '../game/adaptiveCamera';

export interface SolidBox { x: number; y: number; z: number; w: number; h: number; d: number }

/** Project the same half-open cell-centre occupancy used by the canonical interior
 * grid. Half-metre authored partitions must not cover neighbouring walkable voxels. */
export function voxelSolid<T extends SolidBox>(s: T): T {
  const x = Math.ceil(s.x - .5), y = Math.ceil(s.y - .5), z = Math.ceil(s.z - .5);
  return { ...s, x, y, z, w: Math.ceil(s.x + s.w - .5) - x,
    h: Math.ceil(s.y + s.h - .5) - y, d: Math.ceil(s.z + s.d - .5) - z };
}

export const insideSolid = (s: SolidBox, p: V3) => p.x >= s.x && p.x < s.x + s.w
  && p.y >= s.y && p.y < s.y + s.h && p.z >= s.z && p.z < s.z + s.d;

/** Continuous camera sweep over received boxes. A slab intersection cannot skip
 * a corner between point-march samples. Inflation reserves room for the near plane. */
export function boxObstruction(solids: () => readonly SolidBox[], radius = .28): ObstructionQuery {
  return (from, dir, maximum, single) => {
    let nearest = maximum; const r = single ? 0 : radius;
    for (const s of solids()) {
      let enter = 0, leave = maximum;
      for (const [axis, extent] of [['x', 'w'], ['y', 'h'], ['z', 'd']] as const) {
        const lower = s[axis] - r, upper = s[axis] + s[extent] + r;
        if (Math.abs(dir[axis]) < 1e-9) {
          if (from[axis] < lower || from[axis] > upper) { leave = -1; break; }
        } else {
          const a = (lower - from[axis]) / dir[axis], b = (upper - from[axis]) / dir[axis];
          enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        }
      }
      if (leave >= enter) nearest = Math.min(nearest, Math.max(0, enter - .2));
    }
    return nearest;
  };
}
