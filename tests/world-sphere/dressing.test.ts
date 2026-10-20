import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arc, nearRoad, planetSpec, scale, surfaceRadius } from '../../src/sim/world/planet';
import { LIBRARY_PLACEMENTS, regionLandmarks } from '../../src/sim/world/assets/library';
import { libraryContact } from '../../src/sim/world/assets/libraryCollision';
import { settlementDressing } from '../../src/sim/world/assets/dressing';

const spec = planetSpec(20261017);
describe('settlement dressing', () => {
  const pieces = settlementDressing(spec);
  it('is seeded and furnishes home and the landmark settlements', () => {
    expect(settlementDressing(planetSpec(20261017)).map(d => d.id)).toEqual(pieces.map(d => d.id));
    expect(pieces.some(d => d.id.startsWith('dress:home:market'))).toBe(true);
    expect(pieces.some(d => d.id.startsWith('dress:site:'))).toBe(true);
    expect(LIBRARY_PLACEMENTS.length + regionLandmarks(spec).length).toBeGreaterThan(10);
  });
  it('stands clear of roads, library spaces and each other', () => {
    for (const d of pieces) {
      expect(nearRoad(spec, d.dir, d.radius), d.id).toBe(false);
      expect(libraryContact(spec, scale(d.dir, surfaceRadius(spec, d.dir)), () => true).blocked, d.id).toBe(false);
      for (const e of pieces) if (e !== d) expect(arc(spec, d.dir, e.dir)).toBeGreaterThan(d.radius + e.radius);
    }
  });
  it('uses only modules from the verified focused component catalog', () => {
    const catalog = JSON.parse(readFileSync('web/public/focused/components/component_catalog.json', 'utf8')) as Record<string, unknown>;
    for (const d of pieces) expect(catalog[d.assetId.replace('module:', '')], d.assetId).toBeDefined();
  });
});
