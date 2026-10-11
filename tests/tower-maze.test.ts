import { describe, it, expect } from 'vitest';
import { planFloor, type FloorPlan } from '../src/web/arena/tower/floorgen';

/**
 * Tower maze floors from the plan alone (pure, deterministic). Walls use the world's collision box (thickness T, half-length
 * len / 2 + T / 4, rotated by yaw; world.ts placeWall). Props and chests are APPROXIMATED as solid 0.55 discs (their real
 * bounds come from the loaded meshes, checked in the browser by scripts/web/tower-maze-check.ts with world.props and the
 * game's NavGrid). The hero is a 0.65 disc. A walkable grid at 0.2 units is flood-filled from the start.
 */
const T = .7, HERO = .65, STEP = .2;
const SEEDS = [1, 7, 918271, 20261006];
const FLOORS = [1, 4, 5, 16, 20, 31, 46, 55, 61, 76, 91, 99, 100];

function grid(plan: FloorPlan, withProps: boolean) {
  const n = Math.ceil(plan.half * 2 / STEP), at = (k: number) => -plan.half + (k + .5) * STEP;
  const blocked = new Uint8Array(n * n);
  const walls = plan.walls.map(w => ({ x: w.x, z: w.z, c: Math.cos(w.yaw), s: Math.sin(w.yaw), hx: T / 2, hz: w.len / 2 + T / 4 }));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = at(i), z = at(j);
    let b = Math.abs(x) > plan.half - HERO || Math.abs(z) > plan.half - HERO;
    for (const w of walls) { if (b) break; const lx = (x - w.x) * w.c - (z - w.z) * w.s, lz = (x - w.x) * w.s + (z - w.z) * w.c; if (Math.abs(lx) < w.hx + HERO && Math.abs(lz) < w.hz + HERO) b = true; }
    if (!b && withProps) for (const p of [...plan.props, ...plan.chests]) if (Math.hypot(x - p.x, z - p.z) < .55 + HERO) { b = true; break; }
    blocked[j * n + i] = b ? 1 : 0;
  }
  const cellOf = (x: number, z: number) => [Math.max(0, Math.min(n - 1, Math.floor((x + plan.half) / STEP))), Math.max(0, Math.min(n - 1, Math.floor((z + plan.half) / STEP)))];
  return { n, blocked, cellOf, at };
}
function reach(plan: FloorPlan, withProps = true) {
  const g = grid(plan, withProps), seen = new Uint8Array(g.n * g.n), [si, sj] = g.cellOf(plan.start.x, plan.start.z);
  const startOpen = !g.blocked[sj * g.n + si];
  const q = [sj * g.n + si]; seen[q[0]] = 1;
  while (q.length) { const k = q.pop()!, i = k % g.n, j = (k / g.n) | 0; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= g.n || b >= g.n) continue; const kk = b * g.n + a; if (!seen[kk] && !g.blocked[kk]) { seen[kk] = 1; q.push(kk); } } }
  /** Reachable within `r` of a point (a walkable, flood-filled cell inside that radius). */
  const near = (x: number, z: number, r: number) => { for (let dx = -r; dx <= r; dx += STEP) for (let dz = -r; dz <= r; dz += STEP) { if (dx * dx + dz * dz > r * r) continue; const [i, j] = g.cellOf(x + dx, z + dz); if (seen[j * g.n + i]) return true; } return false; };
  return { start: startOpen, near };
}

describe('tower maze floors', () => {
  for (const seed of SEEDS) for (const floor of FLOORS) {
    it(`seed ${seed} floor ${floor}: deterministic, connected, reachable, nothing inside walls, doorways clear`, () => {
      const plan = planFloor(seed, floor), again = planFloor(seed, floor);
      const strip = (p: FloorPlan) => JSON.stringify({ w: p.walls, p: p.props, c: p.chests, f: p.foes, b: p.boss, s: p.shrine });
      expect(strip(again)).toBe(strip(plan));
      if (plan.kind === 'avatar') { expect(plan.walls.length).toBe(0); return; }
      expect(plan.maze).not.toBeNull();
      expect(plan.wallHeight).toBeGreaterThan(4);
      const m = plan.maze!;
      // A maze, not a perimeter with clutter: many wall runs, rooms and corridors.
      expect(plan.walls.length).toBeGreaterThan(m.n * 1.5);
      expect(m.rooms.filter(r => r.role === 'room').length).toBeGreaterThanOrEqual(3);
      for (const w of plan.walls) { expect(Math.abs(w.x)).toBeLessThanOrEqual(plan.half + 1e-6); expect(Math.abs(w.z)).toBeLessThanOrEqual(plan.half + 1e-6); }
      // Every cell of the grid is reachable through open edges (BFS over the maze graph).
      const seen = new Set(['0,0']), q = [[0, 0]];
      while (q.length) { const [i, j] = q.pop()!; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a >= 0 && b >= 0 && a < m.n && b < m.n && m.open(i, j, a, b) && !seen.has(`${a},${b}`)) { seen.add(`${a},${b}`); q.push([a, b]); } }
      expect(seen.size).toBe(m.n * m.n);
      // On the collision model (walls + props + hero radius): start -> exit, every foe, boss, shrine; beside every chest.
      const r = reach(plan);
      expect(r.start).toBe(true);
      expect(r.near(plan.exit.x, plan.exit.z, .6)).toBe(true);
      for (const f of plan.foes) expect(r.near(f.x, f.z, 1.2), `foe at ${f.x.toFixed(1)},${f.z.toFixed(1)}`).toBe(true);
      if (plan.boss) expect(r.near(plan.boss.x, plan.boss.z, 1.2)).toBe(true);
      if (plan.shrine) expect(r.near(plan.shrine.x, plan.shrine.z, 2.2)).toBe(true);
      for (const c of plan.chests) expect(r.near(c.x, c.z, 1.6), `chest at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBe(true);
      // Nothing spawns inside a wall box.
      const inWall = (x: number, z: number, pad: number) => plan.walls.some(w => { const c = Math.cos(w.yaw), s = Math.sin(w.yaw), lx = (x - w.x) * c - (z - w.z) * s, lz = (x - w.x) * s + (z - w.z) * c; return Math.abs(lx) < T / 2 + pad && Math.abs(lz) < w.len / 2 + T / 4 + pad; });
      for (const p of [...plan.props, ...plan.chests]) expect(inWall(p.x, p.z, .3), `prop at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(false);
      for (const f of plan.foes) expect(inWall(f.x, f.z, .4)).toBe(false);
      // Doorways (open edges between cells of different spaces) keep a clear 1.6-unit mouth: no prop or chest within it.
      for (let i = 0; i < m.n; i++) for (let j = 0; j < m.n; j++) for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
        if (a >= m.n || b >= m.n || !m.open(i, j, a, b)) continue;
        // A doorway joins two different spaces (room to corridor, room to room); edges inside one room are floor.
        if (m.region(i, j) >= 0 && m.region(i, j) === m.region(a, b)) continue;
        const dx = (m.x(i) + m.x(a)) / 2, dz = (m.z(j) + m.z(b)) / 2;
        for (const p of [...plan.props, ...plan.chests]) expect(Math.hypot(p.x - dx, p.z - dz), `prop in doorway ${dx.toFixed(1)},${dz.toFixed(1)}`).toBeGreaterThan(1.6);
      }
      // Boss and shrine stand in the reserved arena hall.
      const arena = m.rooms.find(rm => rm.role === 'arena');
      if (plan.kind === 'boss' || plan.kind === 'shrine' || plan.kind === 'summit') {
        expect(arena).toBeTruthy();
        const inside = (x: number, z: number) => x > m.x(arena!.i0) - m.cell / 2 && x < m.x(arena!.i0 + arena!.w - 1) + m.cell / 2 && z > m.z(arena!.j0) - m.cell / 2 && z < m.z(arena!.j0 + arena!.d - 1) + m.cell / 2;
        expect(inside(plan.boss!.x, plan.boss!.z)).toBe(true);
        if (plan.shrine) expect(inside(plan.shrine.x, plan.shrine.z)).toBe(true);
      }
    });
  }
  it('the Proving Hall stays an open training hall', () => {
    const hall = planFloor(918271, 0);
    expect(hall.walls.length).toBe(0); expect(hall.maze).toBeNull();
  });
});
