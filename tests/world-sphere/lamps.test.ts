import { describe, expect, it } from 'vitest';
import { LAMP_REACH, ROAD_HALF_WIDTH, arc, planetRoads, planetSpec, ravineDepth, roadLamps } from '../../src/sim/world/planet';

const spec = planetSpec(20261017);
describe('roadside lanterns', () => {
  it('are seeded by the road network and stand just off dry road near settled ends', () => {
    const lamps = roadLamps(spec);
    expect(lamps.length).toBeGreaterThan(10);
    expect(roadLamps(planetSpec(20261017)).map(l => l.id)).toEqual(lamps.map(l => l.id));
    const roads = planetRoads(spec), dry = roads.flatMap(r => r.points.filter((_p, i) => !r.wet[i])), ends = roads.flatMap(r => [r.points[0], r.points[r.points.length - 1]]);
    for (const l of lamps) {
      const d = Math.min(...dry.map(p => arc(spec, l.dir, p)));
      expect(d).toBeGreaterThan(ROAD_HALF_WIDTH + .7); expect(d).toBeLessThan(ROAD_HALF_WIDTH + 1.1);
      expect(Math.min(...ends.map(e => arc(spec, l.dir, e)))).toBeLessThan(LAMP_REACH + 5);
      expect(ravineDepth(spec, l.dir)).toBe(0);
    }
  });
});
