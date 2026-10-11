/** Renderer-independent room/corridor grammar, extracted unchanged from the existing Tower. */
export interface MazeRoom { i0: number; j0: number; w: number; d: number; role: 'start' | 'exit' | 'arena' | 'room' }
export interface Maze {
  n: number; cell: number; half: number;
  /** Cell centre in world units (i along x, j along z; j = 0 is the far, exit side). */
  x(i: number): number; z(j: number): number;
  rooms: MazeRoom[];
  /** Every cell of the grid is walkable; walls stand on closed edges between cells. */
  cells: { i: number; j: number }[];
  /** True when the edge between two orthogonally adjacent cells is open. */
  open(i: number, j: number, i2: number, j2: number): boolean;
  /** The room a cell belongs to (index into rooms), or -1 for corridor cells. */
  region(i: number, j: number): number;
  /** True when a point near a cell corner has walls (or the grid edge) on both sides of that corner (not a doorway). */
  cornerClosed(x: number, z: number): boolean;
  deadEnds: { i: number; j: number }[];
  walls: { x: number; z: number; len: number; yaw: number }[];
}
/**
 * A tower floor as a maze: rooms (2x2 to 3x3 cells, the combat spaces) and one-cell corridors on a square grid of about
 * 6-unit cells, joined by a randomised spanning tree over cells (each room is one region, so every room and corridor is
 * reachable), then about one closed edge in ten opened again for loops and junctions. The start room sits at the near
 * (south) edge, the exit room at the far edge; `arena` (a z range) reserves a wide central hall for bosses and shrines.
 * Walls stand on the closed edges, merged into straight runs.
 */
export function buildMaze(rnd: () => number, half: number, arena: [number, number] | null): Maze {
  const n = Math.max(6, Math.round(half * 2 / 6)), cell = half * 2 / n, mid = Math.floor(n / 2);
  const x = (i: number) => -half + (i + .5) * cell, z = (j: number) => -half + (j + .5) * cell;
  const cOf = (v: number) => Math.max(0, Math.min(n - 1, Math.floor((v + half) / cell)));
  const owner = new Int32Array(n * n).fill(-1), rooms: MazeRoom[] = [];
  const place = (i0: number, j0: number, w: number, d: number, role: MazeRoom['role']) => {
    if (i0 < 0 || j0 < 0 || i0 + w > n || j0 + d > n) return false;
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) if (owner[j * n + i] >= 0) return false;
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) owner[j * n + i] = rooms.length;
    rooms.push({ i0, j0, w, d, role }); return true;
  };
  place(mid - 1, n - 2, 2, 2, 'start');
  place(mid - 1, 0, 2, 2, 'exit');
  // The arena starts below the exit room (rows 0-1), so it never collides with it.
  if (arena) { const j0 = Math.max(2, cOf(arena[0])), j1 = Math.min(n - 3, Math.max(j0 + 1, cOf(arena[1]))); place(mid - 2, j0, 4, j1 - j0 + 1, 'arena'); }
  const want = Math.round(n * n / 9);
  for (let t = 0; t < 300 && rooms.length < want + 2; t++) { const w = 2 + Math.floor(rnd() * 2), d = 2 + Math.floor(rnd() * 2); place(Math.floor(rnd() * (n - w + 1)), Math.floor(rnd() * (n - d + 1)), w, d, 'room'); }
  const par = Int32Array.from({ length: n * n }, (_, k) => k), find = (k: number): number => (par[k] === k ? k : (par[k] = find(par[k])));
  const unite = (a: number, b: number) => { par[find(a)] = find(b); };
  const opened = new Set<number>(), key = (a: number, b: number) => (a < b ? a * n * n + b : b * n * n + a);
  const edges: [number, number][] = [];
  for (let k = 0; k < n * n; k++) { if ((k % n) < n - 1) edges.push([k, k + 1]); if (k + n < n * n) edges.push([k, k + n]); }
  for (const [a, b] of edges) if (owner[a] >= 0 && owner[a] === owner[b]) { unite(a, b); opened.add(key(a, b)); }
  for (let k = edges.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [edges[k], edges[r]] = [edges[r], edges[k]]; }
  for (const [a, b] of edges) if (!opened.has(key(a, b)) && find(a) !== find(b)) { unite(a, b); opened.add(key(a, b)); }
  for (const [a, b] of edges) if (!opened.has(key(a, b)) && rnd() < .1) opened.add(key(a, b));
  const open = (i: number, j: number, i2: number, j2: number) => opened.has(key(j * n + i, j2 * n + i2));
  const walls: Maze['walls'] = [];
  const run = (fixed: number, from: number, to: number, vertical: boolean) => {
    const len = (to - from) * cell, c = -half + (from + to) / 2 * cell;
    walls.push(vertical ? { x: fixed, z: c, len, yaw: 0 } : { x: c, z: fixed, len, yaw: Math.PI / 2 });
  };
  for (let i = 0; i < n - 1; i++) { let s0 = -1; for (let j = 0; j <= n; j++) { const closed = j < n && !open(i, j, i + 1, j); if (closed && s0 < 0) s0 = j; if (!closed && s0 >= 0) { run(-half + (i + 1) * cell, s0, j, true); s0 = -1; } } }
  for (let j = 0; j < n - 1; j++) { let s0 = -1; for (let i = 0; i <= n; i++) { const closed = i < n && !open(i, j, i, j + 1); if (closed && s0 < 0) s0 = i; if (!closed && s0 >= 0) { run(-half + (j + 1) * cell, s0, i, false); s0 = -1; } } }
  const cornerClosed = (px: number, pz: number) => {
    const i = cOf(px), j = cOf(pz), si = px < x(i) ? -1 : 1, sj = pz < z(j) ? -1 : 1;
    const xs = i + si < 0 || i + si >= n || !open(i, j, i + si, j), zs = j + sj < 0 || j + sj >= n || !open(i, j, i, j + sj);
    return xs && zs;
  };
  const cells: Maze['cells'] = [], deadEnds: Maze['deadEnds'] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    cells.push({ i, j });
    const exits = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && open(i, j, a, b)).length;
    if (exits === 1 && owner[j * n + i] < 0) deadEnds.push({ i, j });
  }
  return { n, cell, half, x, z, rooms, cells, open, region: (i: number, j: number) => owner[j * n + i], cornerClosed, deadEnds, walls };
}
