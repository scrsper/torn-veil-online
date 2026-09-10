import { B, BLOCKS } from './blocks';
import { VoxelGrid } from './grid';
import type { Vec3 } from '../core/types';

function pathBudget(a: Vec3, b: Vec3): number {
  const dx = Math.floor(a.x) - Math.floor(b.x), dz = Math.floor(a.z) - Math.floor(b.z);
  return Math.min(100000, Math.max(12000, 2 * (dx * dx + dz * dz)));
}

/** Grid navigation over walkable columns. Agents are ~2 blocks tall and can step up/down one block. */
class MinHeap {
  private a: { k: number; v: number }[] = [];
  get size() { return this.a.length; }
  push(k: number, v: number) { const a = this.a; a.push({ k, v }); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].k <= a[i].k) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): number { const a = this.a; const top = a[0]; const last = a.pop()!; if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].k < a[m].k) m = l; if (r < a.length && a[r].k < a[m].k) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top.v; }
}

export class Navigator {
  private walkY: Int16Array | Map<number, number>;
  private cost: Float32Array | Map<number, number>;
  private paths = new Map<string, Vec3[] | null>();
  /** Observational counters; never affect search order or results. */
  searches = 0; cacheHits = 0;
  constructor(private grid: VoxelGrid) {
    this.walkY = grid.sparse ? new Map() : new Int16Array(grid.W * grid.D);
    this.cost = grid.sparse ? new Map() : new Float32Array(grid.W * grid.D);
    this.rebuildAll();
  }
  private readY(i: number): number {
    if (this.walkY instanceof Int16Array) return this.walkY[i];
    let y = this.walkY.get(i);
    if (y === undefined) { this.rebuildCell(Math.floor(i / this.grid.D), i % this.grid.D); y = this.walkY.get(i)!; }
    return y;
  }
  private readCost(i: number): number {
    if (this.cost instanceof Float32Array) return this.cost[i];
    if (!this.cost.has(i)) this.readY(i);
    return this.cost.get(i)!;
  }
  rebuildAll(): void {
    this.paths.clear();
    if (this.walkY instanceof Map && this.cost instanceof Map) { this.walkY.clear(); this.cost.clear(); return; }
    for (let x = 0; x < this.grid.W; x++) for (let z = 0; z < this.grid.D; z++) this.rebuildCell(x, z);
  }
  rebuildArea(x0: number, z0: number, x1: number, z1: number): void {
    this.paths.clear();
    for (let x = Math.max(0, x0); x <= Math.min(this.grid.W - 1, x1); x++) for (let z = Math.max(0, z0); z <= Math.min(this.grid.D - 1, z1); z++) this.rebuildCell(x, z);
  }
  private rebuildCell(x: number, z: number): void {
    const g = this.grid; const i = x * g.D + z;
    // find highest walkable floor: a solid block with 2 clear (non-solid) blocks above. Prefer the lowest such floor near ground (interiors).
    let best = -1, bestCost = 1;
    for (let y = g.H - 3; y >= 0; y--) {
      const b = g.get(x, y, z); const def = BLOCKS[b];
      if (b === B.Air || !def.solid || b === B.Fence || b === B.Door) continue;
      if (def.shape === 'cross') continue;
      const a1 = g.get(x, y + 1, z), a2 = g.get(x, y + 2, z);
      const d1 = BLOCKS[a1], d2 = BLOCKS[a2];
      if ((!d1.solid || a1 === B.Door) && (!d2.solid || a2 === B.Door)) {
        best = y + 1; bestCost = Math.max(def.walkCost, a1 === B.Door ? BLOCKS[B.Door].walkCost : d1.walkCost, a2 === B.Air ? 1 : a2 === B.Door ? BLOCKS[B.Door].walkCost : d2.walkCost * 0.5);
        if (b === B.Water) bestCost = 30;
        // keep the lowest floor (interiors under roofs) — continue scanning downward
      }
    }
    // water surfaces: treat as non-walkable unless shallow
    if (this.walkY instanceof Map) this.walkY.set(i, best); else this.walkY[i] = best;
    if (this.cost instanceof Map) this.cost.set(i, bestCost); else this.cost[i] = bestCost;
  }
  floorY(x: number, z: number): number { if (x < 0 || z < 0 || x >= this.grid.W || z >= this.grid.D) return -1; return this.readY(x * this.grid.D + z); }
  walkCost(x: number, z: number): number { return this.readCost(x * this.grid.D + z); }
  isWalkable(x: number, z: number): boolean { const y = this.floorY(x, z); return y >= 0 && this.walkCost(x, z) < 40; }

  /** Shared terrain constraint for voluntary movement and crowd separation. A walkable
   * roof is not reachable by stepping sideways from the ground below it. */
  canStepTo(from: Vec3, x: number, z: number): boolean {
    const cx = Math.floor(x), cz = Math.floor(z);
    return this.isWalkable(cx, cz) && Math.abs(this.floorY(cx, cz) - from.y) <= 1.05;
  }

  /** A* path from a to b in block coordinates. Returns list of cell centers (y = floor). */
  findPath(a: Vec3, b: Vec3, maxIter = pathBudget(a, b)): Vec3[] | null {
    // A fixed village-sized search allowance falsely made longer procedural commutes
    // unreachable. Scale with the area a detour may explore, bounded by the same maximum
    // used when settlement generation connects its roads. Explicit budgets remain exact.
    // The intended floor matters: a counter and its roof share a horizontal column.
    // Cache failed searches too, but never make a returned mutable path shared state.
    const key = [Math.floor(a.x), Math.floor(a.z), Math.floor(b.x), b.y, Math.floor(b.z), maxIter].join(',');
    if (this.paths.has(key)) { this.cacheHits++; return this.paths.get(key)?.map(p => ({ ...p })) ?? null; }
    this.searches++;
    const path = this.search(a, b, maxIter);
    if (this.paths.size >= 4096) this.paths.delete(this.paths.keys().next().value!);
    this.paths.set(key, path);
    return path?.map(p => ({ ...p })) ?? null;
  }
  private search(a: Vec3, b: Vec3, maxIter: number): Vec3[] | null {
    const g = this.grid; const W = g.W, D = g.D;
    let sx = Math.floor(a.x), sz = Math.floor(a.z), tx = Math.floor(b.x), tz = Math.floor(b.z);
    if (!this.isWalkable(tx, tz) || Math.abs(this.floorY(tx, tz) - b.y) > 1) {
      const alt = this.nearestWalkable(tx, tz, 4, b.y); if (!alt) return null; tx = alt.x; tz = alt.z;
    }
    if (!this.isWalkable(sx, sz)) { const alt = this.nearestWalkable(sx, sz, 3); if (!alt) return null; sx = alt.x; sz = alt.z; }
    const si = sx * D + sz, ti = tx * D + tz;
    if (si === ti) return [{ x: tx + 0.5, y: this.floorY(tx, tz), z: tz + 0.5 }];
    const gScore = new Map<number, number>(); const came = new Map<number, number>(); const closed = new Set<number>();
    const open = new MinHeap(); gScore.set(si, 0); open.push(0, si);
    const h = (i: number) => { const x = Math.floor(i / D), z = i % D; const dx = Math.abs(x - tx), dz = Math.abs(z - tz); return Math.max(dx, dz) + 0.41 * Math.min(dx, dz); };
    let iter = 0; let found = false;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.size && iter++ < maxIter) {
      const cur = open.pop(); if (cur === ti) { found = true; break; }
      if (closed.has(cur)) continue; closed.add(cur);
      const cx = Math.floor(cur / D), cz = cur % D; const cy = this.readY(cur); const gc = gScore.get(cur)!;
      for (let k = 0; k < 8; k++) {
        const nx = cx + dirs[k][0], nz = cz + dirs[k][1];
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        const ni = nx * D + nz; if (closed.has(ni)) continue;
        const ny = this.readY(ni); if (ny < 0 || Math.abs(ny - cy) > 1) continue;
        const wc = this.readCost(ni); if (wc >= 40) continue;
        if (k >= 4) { // diagonal: both orthogonal neighbours must be passable to avoid corner clipping
          const a1 = (cx + dirs[k][0]) * D + cz, a2 = cx * D + (cz + dirs[k][1]);
          if (this.readY(a1) < 0 || this.readCost(a1) >= 40 || Math.abs(this.readY(a1) - cy) > 1) continue;
          if (this.readY(a2) < 0 || this.readCost(a2) >= 40 || Math.abs(this.readY(a2) - cy) > 1) continue;
        }
        const step = (k >= 4 ? 1.414 : 1) * wc + (ny !== cy ? 0.5 : 0);
        const ng = gc + step;
        if (ng < (gScore.get(ni) ?? Infinity)) { gScore.set(ni, ng); came.set(ni, cur); open.push(ng + h(ni) * 1.05, ni); }
      }
    }
    if (!found) return null;
    const path: Vec3[] = []; let cur = ti;
    while (cur !== si) { const x = Math.floor(cur / D), z = cur % D; path.push({ x: x + 0.5, y: this.readY(cur), z: z + 0.5 }); cur = came.get(cur)!; }
    path.reverse();
    return this.smooth(path);
  }
  private smooth(path: Vec3[]): Vec3[] {
    if (path.length < 3) return path;
    const out: Vec3[] = [path[0]]; let i = 0;
    while (i < path.length - 1) {
      let j = Math.min(path.length - 1, i + 6);
      while (j > i + 1 && !this.clearWalk(path[i], path[j])) j--;
      out.push(path[j]); i = j;
    }
    return out;
  }
  clearWalk(a: Vec3, b: Vec3): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 2); let py = a.y;
    for (let s = 1; s <= n; s++) { const t = s / n; const x = Math.floor(a.x + (b.x - a.x) * t), z = Math.floor(a.z + (b.z - a.z) * t); const y = this.floorY(x, z); if (y < 0 || this.walkCost(x, z) >= 40 || this.walkCost(x, z) > 3 || Math.abs(y - py) > 1) return false; py = y; }
    // Smoothing must leave room for an ordinary body, especially at door approaches.
    // A centre line that clips the corner of a wall is not a traversable shortcut.
    for (let s = 0; s <= n; s++) {
      const t = n ? s / n : 0, px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
      const floor = this.floorY(Math.floor(px), Math.floor(pz));
      for (let x = Math.floor(px - .3); x <= Math.floor(px + .3); x++) for (let z = Math.floor(pz - .3); z <= Math.floor(pz + .3); z++) if (!this.isWalkable(x,z) || Math.abs(this.floorY(x,z)-floor)>1) return false;
    }
    return true;
  }
  nearestWalkable(x: number, z: number, r: number, height?: number): { x: number; z: number } | null {
    for (let d = 0; d <= r; d++) for (let dx = -d; dx <= d; dx++) for (let dz = -d; dz <= d; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue; if (this.isWalkable(x + dx, z + dz) && (height === undefined || Math.abs(this.floorY(x + dx, z + dz) - height) <= 1)) return { x: x + dx, z: z + dz }; }
    return null;
  }
}
