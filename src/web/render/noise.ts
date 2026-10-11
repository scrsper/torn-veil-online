/** Deterministic, dependency-free noise. Cosmetic only: never seeded from, or feeding, simulation RNG. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x: number, y: number, z: number, seed = 0): number { return hash2(x + Math.imul(z | 0, 0x632be5ab), y, seed); }
export function mulberry(seed: number): (() => number) & { state(): number; restore(state: number): void } {
  let a = seed >>> 0;
  return Object.assign(() => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }, { state: () => a, restore: (state: number) => { a = state >>> 0; } });
}
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Tileable value noise on an integer lattice of `period` cells. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const p = (n: number) => ((n % period) + period) % period;
  const a = hash2(p(xi), p(yi), seed), b = hash2(p(xi + 1), p(yi), seed), c = hash2(p(xi), p(yi + 1), seed), d = hash2(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x: number, y: number, period: number, octaves: number, seed: number): number {
  let sum = 0, amp = 0.5, total = 0, f = 1;
  for (let o = 0; o < octaves; o++) { sum += valueNoise(x * f, y * f, period * f, seed + o * 17) * amp; total += amp; amp *= 0.5; f *= 2; }
  return sum / total;
}
/** World-space (non-tiling) value noise for terrain macro variation. */
export function worldNoise(x: number, z: number, scale: number, seed = 0): number {
  const xs = x / scale, zs = z / scale, xi = Math.floor(xs), zi = Math.floor(zs), fx = smooth(xs - xi), fz = smooth(zs - zi);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed), c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
