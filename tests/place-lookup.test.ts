import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/sim/core/types';
import { makePlace } from '../src/sim/world/factory';
import { createTestWorld, v } from './helpers/world';

describe('exact place lookup memo', () => {
  it('matches a full bounds scan after movement, height changes, replacement and new places', () => {
    const { world } = createTestWorld(722, 20);
    const first = makePlace(world, 'house', 'first', { x0: 3, x1: 7, z0: 3, z1: 7, y0: 1, y1: 4 }, { inside: v(5, 1, 5) });
    const tied = makePlace(world, 'house', 'tied', { ...first.bounds }, { inside: v(5, 1, 5) });
    const point = v(5, 1, 5);
    const reference = (pos: Vec3) => world.places().filter(p => {
      const b = p.bounds;
      return pos.x >= b.x0 && pos.x <= b.x1 + 1 && pos.z >= b.z0 && pos.z <= b.z1 + 1 && pos.y >= b.y0 - 1 && pos.y <= b.y1 + 2;
    }).sort((a, b) => (a.bounds.x1 - a.bounds.x0) * (a.bounds.z1 - a.bounds.z0) - (b.bounds.x1 - b.bounds.x0) * (b.bounds.z1 - b.bounds.z0))[0];
    const check = () => {
      const before = world.spatialStats().placeCandidates;
      expect(world.placeAt(point)).toBe(reference(point));
      const count = world.spatialStats().placeCandidates - before;
      expect(world.placeAt(point)).toBe(reference(point));
      expect(world.spatialStats().placeCandidates - before).toBe(2 * count);
    };
    check(); expect(world.placeAt(point)).toBe(first); // insertion-order tie
    point.y = 20; check(); expect(world.placeAt(point)).toBeUndefined();
    first.bounds.y1 = 22; check(); expect(world.placeAt(point)).toBe(first);
    first.bounds.y0 = 25; check(); expect(world.placeAt(point)).toBeUndefined();
    first.bounds = { ...tied.bounds, x0: 10, x1: 15 }; point.y = 1; check();
    point.x = 12; check(); point.z = 12; check();
    point.x = point.z = 5; check();
    const smaller = makePlace(world, 'house', 'new', { x0: 4, x1: 5, z0: 4, z1: 5, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    check(); expect(world.placeAt(point)).toBe(smaller);
    smaller.bounds.x1 = 4; point.x = 6; check(); // same spatial bucket, changed exact containment
    for (let i = 0; i < 700; i++) world.placeAt(v(i, 1, i));
    expect((world as any).placeLookupCache.size).toBeLessThanOrEqual(512);
    check();
  });
});
