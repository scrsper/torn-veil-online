import { describe, expect, test } from 'vitest';
import { WorldGeography } from '../src/sim/world/geography';
import { projectVista, VISTA_RADIUS, VISTA_STRIDE } from '../src/bridge/regions';
import { B } from '../src/sim/physical/blocks';
import type { World } from '../src/sim/core/world';

// The horizon reads only the versioned geographic baseline; a minimal world facade is enough.
const facade = (geography: WorldGeography) => ({ geography, settlements: () => [] }) as unknown as World;

describe('far horizon vista', () => {
  test('is deterministic, bounded, decorative and faithful to the geographic baseline', () => {
    const a = projectVista(facade(new WorldGeography(918271)), 47, 78);
    const b = projectVista(facade(new WorldGeography(918271)), 47, 78);
    expect(b).toEqual(a);
    const side = VISTA_RADIUS * 2 + 1;
    expect(a.side).toBe(side);
    expect(a.stride).toBe(VISTA_STRIDE);
    for (const field of [a.heights, a.forest, a.surface]) expect(field).toHaveLength(side * side);
    expect(JSON.stringify(a).length).toBeLessThan(512 * 1024);
    expect(a).toMatchObject({ classification: 'decorative', collision: false, gameplay: false });

    const geography = new WorldGeography(918271);
    for (const [i, j] of [[0, 0], [side >> 1, side >> 1], [side - 1, 17], [40, side - 3]]) {
      // Samples beyond the world edge repeat the edge column rather than inventing land.
      const edge = geography.spec.size - 1, x = Math.min(Math.max(a.origin.x + i * VISTA_STRIDE, 0), edge), z = Math.min(Math.max(a.origin.z + j * VISTA_STRIDE, 0), edge), c = geography.surface(x, z), k = i * side + j;
      expect(a.heights.charCodeAt(k) - 48).toBe(Math.round(c.water !== null ? c.water + 1 : c.height + 1));
      expect(a.forest.charCodeAt(k) - 48).toBe(Math.round(c.forest * 9));
      expect(a.surface[k]).toBe(c.water !== null ? 'w' : c.block === B.Path ? 'p' : c.block === B.Sand ? 's' : c.block === B.Stone ? 'r' : 'g');
    }
  });
});
