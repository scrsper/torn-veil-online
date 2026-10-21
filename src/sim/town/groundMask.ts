import { valueNoise } from '../core/rng';
import { distToPath, placeRect, type TownLayout } from './layout';

/** Ground surface mask over the town (presentation data, deterministic from the layout).
 * R = worn earth, G = cobbles, B = lush/dark grass variation, A = 255. Texel (i, k) covers
 * town x = x0 + (i + .5) * size / n, z = z0 + (k + .5) * size / n. */
export interface GroundMask { x0: number; z0: number; size: number; n: number; data: Uint8Array }
const sm = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
export function groundMask(layout: TownLayout, n = 1024, size = 420): GroundMask {
  const x0 = layout.bounds.x - size / 2, z0 = layout.bounds.z - size / 2 + 40, data = new Uint8Array(n * n * 4), cell = size / n;
  const rects = layout.library.map(p => placeRect(p, 0));
  const stalls = layout.props.filter(p => p.kind === 'stall' || p.kind === 'cart' || p.kind === 'well' || p.kind === 'notice' || p.kind === 'woodpile' || p.kind === 'hay');
  const W = layout.walls;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const x = x0 + (i + .5) * cell, z = z0 + (k + .5) * cell, o = (k * n + i) * 4;
    const jitter = (valueNoise(x * .9, z * .9, 3) - .5) * .9 + (valueNoise(x * 3.1, z * 3.1, 4) - .5) * .35;
    let cob = 0, dirt = 0;
    for (const p of layout.paths) {
      const d = distToPath(p, x, z) + jitter, hw = p.width / 2;
      if (p.kind === 'cobble') { cob = Math.max(cob, 1 - sm(hw - .15, hw + .15, d)); dirt = Math.max(dirt, (1 - sm(hw, hw + 1.6, d)) * .85); }
      else dirt = Math.max(dirt, 1 - sm(hw - 1, hw + 1.2, d));
    }
    const pd = Math.hypot(x - layout.plaza.x, z - layout.plaza.z) + jitter;
    cob = Math.max(cob, 1 - sm(layout.plaza.r - .2, layout.plaza.r + .2, pd)); dirt = Math.max(dirt, (1 - sm(layout.plaza.r, layout.plaza.r + 3, pd)) * .8);
    // Worn ground under and around the library spaces (their own paving sits on top), stalls and gates.
    for (const r of rects) { const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1), d = Math.hypot(dx, dz) + jitter; dirt = Math.max(dirt, (1 - sm(0, 3, d)) * .75); }
    for (const s of stalls) { const d = Math.hypot(s.x - x, s.z - z) + jitter; dirt = Math.max(dirt, (1 - sm(1.5, 3.2, d)) * .7); }
    // Trodden strip along the inside of the walls.
    const inside = x > W.x0 && x < W.x1 && z > W.z0 && z < W.z1, wd = Math.min(x - W.x0, W.x1 - x, z - W.z0, W.z1 - z) + jitter;
    if (inside) dirt = Math.max(dirt, (1 - sm(1, 3.5, wd)) * .55);
    const lush = valueNoise(x / 9, z / 9, 21) * .7 + valueNoise(x / 2.5, z / 2.5, 22) * .3;
    data[o] = Math.round(Math.min(1, dirt * (1 - cob)) * 255); data[o + 1] = Math.round(cob * 255); data[o + 2] = Math.round(lush * 255); data[o + 3] = 255;
  }
  return { x0, z0, size, n, data };
}
