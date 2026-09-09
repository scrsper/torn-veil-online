import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { createTestWorld, v } from './helpers/world';

describe('Navigator.findPath', () => {
  it('caches exact results without sharing mutable paths and invalidates when terrain changes', () => {
    const { world } = createTestWorld(61, 14), a = v(2.5, 1, 3.5), b = v(10.5, 1, 3.5);
    const first = world.nav.findPath(a, b)!;
    const expected = structuredClone(first);
    first[0].x = -100;
    expect(world.nav.findPath(a, b)).toEqual(expected);
    expect(world.nav.cacheHits).toBe(1);
    const before = world.nav.searches;
    for (let z = 0; z < world.grid.D; z++) for (let y = 1; y < world.grid.H; y++) world.grid.set(6, y, z, B.Stone);
    world.nav.rebuildArea(6, 0, 6, world.grid.D - 1);
    expect(world.nav.findPath(a, b)).toBeNull();
    expect(world.nav.searches).toBe(before + 1);
    expect(world.nav.findPath(a, b)).toBeNull();
    for (let y = 1; y < world.grid.H; y++) world.grid.set(6, y, 3, B.Air);
    world.nav.rebuildArea(6, 3, 6, 3);
    expect(world.nav.findPath(a, b)).not.toBeNull();
  });
  it('actually uses a nearby walkable start when the supplied start cell is blocked', () => {
    const tw = createTestWorld(61, 14);
    for (let y = 1; y < tw.world.grid.H; y++) tw.world.grid.set(3, y, 3, B.Stone);
    tw.world.nav.rebuildArea(2, 2, 4, 4);
    expect(tw.world.nav.isWalkable(3, 3)).toBe(false);

    const path = tw.world.nav.findPath(v(3.5, 1, 3.5), v(10.5, 1, 3.5));
    expect(path).not.toBeNull();
    expect(path?.at(-1)).toMatchObject({ x: 10.5, z: 3.5 });
  });
});
