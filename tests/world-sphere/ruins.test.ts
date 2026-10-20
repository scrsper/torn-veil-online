import { describe, expect, it } from 'vitest';
import { PROP_MODULE, SCATTER_N, climateAt, planetSpec, reserved, scatterCell } from '../../src/sim/world/planet';

const spec = planetSpec(20261017);
describe('wayside ruins', () => {
  it('are seeded, sparse, on dry unreserved land, and drawn from focused-pack stonework', () => {
    const pieces = [], step = 4;
    for (let f = 0; f < 6; f++) for (let i = 0; i < SCATTER_N; i += step) for (let j = 0; j < SCATTER_N; j += step)
      for (const p of scatterCell(spec, f, i, j)) if (p.kind === 'ruin' || p.kind === 'rubble') pieces.push(p);
    expect(pieces.length).toBeGreaterThan(20);
    for (const p of pieces) { expect(reserved(spec, p.dir)).toBe(false); expect(climateAt(spec, p.dir).height).toBeGreaterThanOrEqual(1.5); expect(['ocean', 'snow']).not.toContain(climateAt(spec, p.dir).biome); }
    expect(scatterCell(planetSpec(20261017), 2, 40, 40)).toEqual(scatterCell(spec, 2, 40, 40));
    expect(PROP_MODULE.ruin).toBe('module:broken_column'); expect(PROP_MODULE.rubble).toBe('module:masonry_rubble');
  });
});
