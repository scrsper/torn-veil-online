// Deterministic PRNG (mulberry32) so world generation is reproducible from a seed.
export class RNG {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  shuffle<T>(arr: T[]): T[] { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  fork(salt: number): RNG { return new RNG((this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0); }
  /**
   * v0.8 §P1 (independent audit §3.5): the mulberry32 state IS just `s` — a save/load cycle that
   * only restores the constructor `seed` (not the current `s` after however many draws happened
   * during play) silently rewinds this stream back to its post-village-generation position,
   * replaying the same "random" sequence every time the same save is reloaded. `state()`/
   * `setState()` let `persist/save.ts` round-trip the actual stream position, the same way
   * `WorldClock.state()` round-trips clock state, instead of the constructor's `seed` alone.
   */
  state(): number { return this.s; }
  // No `>>> 0` here, deliberately: `next()`'s `this.s += 0x6d2b79f5` never re-masks `s` itself
  // back into 32-bit range (only the local `t` used for the RETURNED value is bit-masked/imul'd)
  // — `s` legitimately grows into an ordinary large JS number over many calls. Coercing a
  // restored large state through `>>> 0` (ToUint32) would silently wrap it to the WRONG value,
  // corrupting the exact stream position this method exists to preserve.
  setState(s: number): void { this.s = s; }
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 2D value noise with smooth interpolation, plus fractal sum.
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) { sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp; norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}
