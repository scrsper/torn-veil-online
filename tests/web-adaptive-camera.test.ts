import { describe, expect, it } from 'vitest';
import { AdaptiveCamera, CAMERA_LIMITS, marchObstruction, type ObstructionQuery } from '../src/web/game/adaptiveCamera';

const open: ObstructionQuery = (_f, _d, max) => max;
const pivot = { x: 0, y: 1.3, z: 0 };
const run = (c: AdaptiveCamera, s: Parameters<AdaptiveCamera['update']>[1], q: ObstructionQuery, seconds: number) => {
  let pose = c.update(1 / 60, s, q);
  for (let t = 0; t < seconds; t += 1 / 60) pose = c.update(1 / 60, s, q);
  return pose;
};
const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x - pivot.x, p.y - pivot.y - .1, p.z - pivot.z);

describe('adaptive third-person camera', () => {
  it('defaults to an elevated, chest-aimed framing', () => {
    const c = new AdaptiveCamera(), pose = run(c, { pivot }, open, 1);
    expect(dist(pose.position)).toBeGreaterThan(4.2); expect(dist(pose.position)).toBeLessThan(5.1);
    expect(pose.position.y).toBeGreaterThan(2.1); expect(pose.position.y).toBeLessThan(2.8);   // 0.8–1.5 m above the shoulders' origin band
    expect(c.debug.pitchDeg).toBeGreaterThanOrEqual(10); expect(c.debug.pitchDeg).toBeLessThanOrEqual(15);
    expect(pose.target.y).toBeCloseTo(1.3, 1);
  });

  it('pulls in at once when obstructed and recovers smoothly once clear', () => {
    const c = new AdaptiveCamera(); run(c, { pivot }, open, 1);
    const wall: ObstructionQuery = (_f, _d, max) => Math.min(max, 2);
    const blocked = c.update(1 / 60, { pivot }, wall);
    expect(dist(blocked.position)).toBeLessThan(2.6);       // no frame spent inside the wall
    run(c, { pivot }, wall, .5);
    const first = c.update(1 / 60, { pivot }, open);
    expect(dist(first.position)).toBeLessThan(2.8);          // no pop back out
    const later = run(c, { pivot }, open, 3);
    expect(dist(later.position)).toBeGreaterThan(4.3);
  });

  it('backs out for groups and returns to the player-chosen distance afterwards', () => {
    const c = new AdaptiveCamera(); c.zoom(-3); const chosen = c.preferred;
    const calm = dist(run(c, { pivot }, open, 2).position);
    const crowd = dist(run(c, { pivot, engaged: true, threats: 7 }, open, 3).position);
    expect(crowd).toBeGreaterThan(calm + .8);
    const after = dist(run(c, { pivot }, open, 4).position);
    expect(after).toBeCloseTo(calm, 0); expect(c.preferred).toBe(chosen);
  });

  it('gives large creatures room, closes in under low ceilings, and shoulders for precise aim', () => {
    const big = new AdaptiveCamera(); expect(dist(run(big, { pivot, engaged: true, largest: 7 }, open, 3).position)).toBeGreaterThan(10);
    expect(dist(run(big, { pivot, engaged: true, largest: 30 }, open, 3).position)).toBeLessThanOrEqual(CAMERA_LIMITS.maxExceptional + .5);
    const room = new AdaptiveCamera(); expect(dist(run(room, { pivot, ceiling: 2.2 }, open, 3).position)).toBeLessThan(4.5);
    const aim = new AdaptiveCamera(); run(aim, { pivot, aiming: true }, open, 2); expect(aim.debug.reason).toBe('aim'); expect(aim.debug.dist).toBeLessThan(4);
  });

  it('orbits freely and never changes distance just from rotating', () => {
    const c = new AdaptiveCamera(); run(c, { pivot }, open, 1);
    for (let i = 0; i < 40; i++) { c.addLook(.16, 0); c.update(1 / 60, { pivot }, open); }
    expect(c.debug.dist).toBeCloseTo(4.6, 1);
    c.addLook(0, 5); expect(c.pitch).toBeLessThanOrEqual(CAMERA_LIMITS.maxPitch); c.addLook(0, -9); expect(c.pitch).toBeGreaterThanOrEqual(CAMERA_LIMITS.minPitch);
  });

  it('marches point queries as a fat ray that ignores a single grazing post', () => {
    // A thin post 2 m out, 0.25 m to the side: only one edge ray touches it.
    const post = marchObstruction((x, _y, z) => Math.abs(z - 2) < .06 && Math.abs(x - .25) < .06);
    expect(post({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 6)).toBeGreaterThan(5);
    const wall = marchObstruction((_x, _y, z) => z > 3);
    expect(wall({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 6)).toBeLessThan(3);
  });
});
