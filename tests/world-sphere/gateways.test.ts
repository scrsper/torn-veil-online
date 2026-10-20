import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arc, landmarkSites, nearRoad, planetSpec, scale, surfaceRadius } from '../../src/sim/world/planet';
import { libraryContact } from '../../src/sim/world/assets/libraryCollision';
import { GATEWAY, settlementGateways } from '../../src/sim/world/assets/gateways';

const spec = planetSpec(20261017);
describe('settlement gateways', () => {
  const gates = settlementGateways(spec);
  it('is seeded and stands a gateway on the roads into landmark settlements', () => {
    expect(settlementGateways(planetSpec(20261017)).map(g => g.id)).toEqual(gates.map(g => g.id));
    expect(gates.length).toBeGreaterThan(5);
  });
  it('straddles the road just past the levelled ground, piers clear of library spaces', () => {
    const sites = landmarkSites(spec);
    for (const g of gates) {
      expect(nearRoad(spec, g.dir, 0), g.id).toBe(true);
      const d = Math.min(...sites.map(s => arc(spec, s.dir, g.dir)));
      expect(d, g.id).toBeGreaterThan(GATEWAY.start - 1); expect(d, g.id).toBeLessThan(GATEWAY.end + 1);
      expect(g.piers).toHaveLength(2);
      // The way between the piers stays open for a walker on the road.
      expect(arc(spec, g.piers[0].dir, g.piers[1].dir) - g.piers[0].radius - g.piers[1].radius).toBeGreaterThan(3);
      for (const p of g.piers) expect(libraryContact(spec, scale(p.dir, surfaceRadius(spec, p.dir)), () => true).blocked, g.id).toBe(false);
      for (const h of gates) if (h !== g) expect(arc(spec, g.dir, h.dir)).toBeGreaterThan(12);
    }
  });
  it('uses a module from the verified focused component catalog', () => {
    const catalog = JSON.parse(readFileSync('web/public/focused/components/component_catalog.json', 'utf8')) as Record<string, unknown>;
    for (const g of gates) expect(catalog[g.assetId.replace('module:', '')], g.assetId).toBeDefined();
  });
});
