import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGODA_SHAPE, PRECINCT, pagodaBlocks, pagodaSupport, precinctBlocks, precinctPieces } from '../../src/sim/world/planet';

describe('pagoda precinct', () => {
  it('leaves the approach and the gateway open from outside to the door', () => {
    for (let z = PRECINCT.approachEnd - 4; z <= -10; z += .1) {
      expect(precinctBlocks(0, z), `z ${z}`).toBe(false);
      expect(precinctBlocks(2.4, z), `x 2.4 z ${z}`).toBe(false);
    }
  });
  it('closes the terrace with a wall everywhere but the gateway', () => {
    for (let t = -PRECINCT.wall; t <= PRECINCT.wall; t += .5) {
      expect(precinctBlocks(PRECINCT.wall, t)).toBe(true); expect(precinctBlocks(-PRECINCT.wall, t)).toBe(true);
      expect(precinctBlocks(t, PRECINCT.wall)).toBe(true);
      if (Math.abs(t) > PRECINCT.gate) expect(precinctBlocks(t, -PRECINCT.wall)).toBe(true);
    }
    expect(precinctBlocks(0, 0 - 50)).toBe(false); expect(precinctBlocks(40, 40)).toBe(false);
  });
  it('keeps every solid piece off the podium, stair and pagoda walls', () => {
    for (const p of precinctPieces()) {
      if (!p.half) continue;
      for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]]) {
        const x = p.x + dx * p.half[0], z = p.z + dz * p.half[1];
        expect(pagodaSupport(x, z), p.id).toBeNull(); expect(pagodaBlocks(x, z, 0), p.id).toBe(false);
      }
    }
    expect(PRECINCT.wall).toBeGreaterThan(PAGODA_SHAPE.podium[0] + 4);
  });
  it('uses only focused-pack modules listed in the verified component catalog', () => {
    const catalog = JSON.parse(readFileSync('web/public/focused/components/component_catalog.json', 'utf8')) as Record<string, unknown>;
    const ids = new Set(precinctPieces().map(p => p.id));
    expect(ids.size).toBe(precinctPieces().length);
    for (const p of precinctPieces()) expect(catalog[p.assetId.replace('module:', '')], p.assetId).toBeDefined();
  });
});
