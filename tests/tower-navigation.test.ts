import { describe, expect, it } from 'vitest';
import { NavGrid, type Obstacle } from '../src/web/arena/nav';

function walk(obstacles: Obstacle[], from: [number, number], to: [number, number], arrive = .5) {
  const nav = new NavGrid(20, obstacles, .65);
  let [x, z] = from;
  for (let step = 0; step < 3500; step++) {
    if (Math.hypot(to[0] - x, to[1] - z) < arrive) return true;
    const dx = to[0] - x, dz = to[1] - z, len = Math.hypot(dx, dz);
    const d = nav.dir(x, z, ...to, step / 60) ?? { x: dx / len, z: dz / len };
    x += d.x * .1; z += d.z * .1;
    for (const o of obstacles) {
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw), lx = (x - o.x) * c - (z - o.z) * s, lz = (x - o.x) * s + (z - o.z) * c;
      expect(Math.abs(lx) >= o.hx || Math.abs(lz) >= o.hz, `route crossed an obstacle at ${x},${z}`).toBe(true);
    }
  }
  return false;
}
describe('Tower navigation uses actual obstacles', () => {
  it('walks around a table that blocks a direct route to an enemy', () => {
    expect(walk([{ x: 0, z: 0, hx: 2.4, hz: 1.3, yaw: 0 }], [0, 8], [0, -8])).toBe(true);
  });
  it('approaches an occupied chest cell without passing through it', () => {
    expect(walk([{ x: 0, z: 0, hx: 1, hz: .7, yaw: 0 }], [0, 8], [0, 0], 2.2)).toBe(true);
  });
  it('follows a long alternating maze without cutting through wall corners', () => {
    const walls = Array.from({ length: 8 }, (_, i) => ({ x: -14 + i * 4, z: i % 2 ? 4 : -4, hx: .35, hz: 15, yaw: 0 }));
    expect(walk(walls, [-18, 0], [18, 0])).toBe(true);
  });
});
