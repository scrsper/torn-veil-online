import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { createTestWorld, v } from './helpers/world';

describe('Navigator.findPath', () => {
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
