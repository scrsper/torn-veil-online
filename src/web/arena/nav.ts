/**
 * Grid navigation for tower floors: walls are rasterised into a blocked grid (inflated by a body
 * radius), and a breadth-first flow field toward a target cell gives every chaser a walkable
 * direction. One field per target is shared by all fighters chasing it and refreshed when the
 * target moves to another cell.
 */
export interface Obstacle { x: number; z: number; hx: number; hz: number; yaw: number }
const CELL = 1;
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export class NavGrid {
  readonly n: number; private blocked: Uint8Array; private fields = new Map<number, { dist: Float32Array; at: number }>();
  constructor(private readonly half: number, obstacles: Obstacle[], radius = .6) {
    this.n = Math.ceil((half * 2 + 2) / CELL);
    this.blocked = new Uint8Array(this.n * this.n);
    for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) {
      const x = -half - 1 + (i + .5) * CELL, z = -half - 1 + (j + .5) * CELL;
      for (const o of obstacles) {
        const c = Math.cos(o.yaw), s = Math.sin(o.yaw), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
        if (Math.abs(lx) < o.hx + radius && Math.abs(lz) < o.hz + radius) { this.blocked[i * this.n + j] = 1; break; }
      }
    }
  }
  get hasWalls(): boolean { return this.blocked.some(b => b === 1); }
  private cell(x: number, z: number): [number, number] {
    return [Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half + 1) / CELL))), Math.max(0, Math.min(this.n - 1, Math.floor((z + this.half + 1) / CELL)))];
  }
  private center(i: number, j: number): [number, number] { return [-this.half - 1 + (i + .5) * CELL, -this.half - 1 + (j + .5) * CELL]; }

  /** Distance field toward (tx, tz), cached per target cell. */
  private field(tx: number, tz: number, now: number): Float32Array {
    const [ti, tj] = this.cell(tx, tz), key = ti * this.n + tj;
    const cached = this.fields.get(key); if (cached && now - cached.at < 1.5) return cached.dist;
    const n = this.n, dist = new Float32Array(n * n).fill(Infinity), q: number[] = [];
    // Interactables may occupy blocked cells. Approach their nearest open neighbours.
    for (let radius = 0; !q.length && radius < n; radius++) {
      for (let a = Math.max(0, ti - radius); a <= Math.min(n - 1, ti + radius); a++) for (let b = Math.max(0, tj - radius); b <= Math.min(n - 1, tj + radius); b++) {
        if (Math.max(Math.abs(a - ti), Math.abs(b - tj)) !== radius || this.blocked[a * n + b]) continue;
        const kk = a * n + b; dist[kk] = 0; q.push(kk);
      }
    }
    // Weighted diagonal edges can enqueue a cell more than once; an n*n buffer dropped work.
    let h = 0;
    while (h < q.length) {
      const k = q[h++], i = (k / n) | 0, j = k % n, d = dist[k];
      for (const [di, dj, w] of N8) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const kk = a * n + b; if (this.blocked[kk]) continue;
        if (di && dj && (this.blocked[(i + di) * n + j] || this.blocked[i * n + j + dj])) continue;   // no corner cutting
        if (d + w < dist[kk] - .0001) { dist[kk] = d + w; q.push(kk); }
      }
    }
    if (this.fields.size > 24) this.fields.clear();
    this.fields.set(key, { dist, at: now });
    return dist;
  }

  /** Unit direction to walk from (x, z) toward (tx, tz) around walls; null if the straight line is clear. */
  dir(x: number, z: number, tx: number, tz: number, now: number): { x: number; z: number } | null {
    if (this.clear(x, z, tx, tz)) return null;
    const dist = this.field(tx, tz, now), n = this.n, [i, j] = this.cell(x, z);
    let best = dist[i * n + j], bi = i, bj = j;
    for (const [di, dj] of N8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n || this.blocked[a * n + b]) continue;
      if (di && dj && (this.blocked[a * n + j] || this.blocked[i * n + b])) continue;
      const d = dist[a * n + b]; if (d < best) { best = d; bi = a; bj = b; } }
    if (bi === i && bj === j) return null;
    const [cx, cz] = this.center(bi, bj), dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /** Straight-line walkability (sampled every half cell). */
  clear(x: number, z: number, tx: number, tz: number): boolean {
    const d = Math.hypot(tx - x, tz - z), steps = Math.ceil(d / (CELL * .5));
    for (let s = 1; s < steps; s++) { const [i, j] = this.cell(x + (tx - x) * s / steps, z + (tz - z) * s / steps); if (this.blocked[i * this.n + j]) return false; }
    return true;
  }
}
