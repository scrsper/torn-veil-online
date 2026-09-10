import type { World } from '../core/world';
import type { SettlementResult } from './settlement';
import { RNG } from '../core/rng';
import { learn } from '../mind/knowledge';
import { teachPrimitive } from '../mind/invention';
import { processFor } from './labor';
import { teachNotation } from '../mind/records';

/** Initial geography and local education, not an invention scenario. No parts, assemblies,
 * finished methods or practical needs are seeded. A boundary exposes local weather flux. */
export function initializeSettlementMechanics(world: World, s: SettlementResult): void {
  const rng = new RNG(s.spec.seed ^ 0x3a47b13);
  const materials = world.kernel.ruleset.materials.filter(m => m.legacyItem && m.properties);
  const places = Object.values(s.places);
  for (const place of places) {
    const process = processFor(place.type);
    if (!process) continue;
    const speed = 2 + (1 - s.spec.moisture) * 4;
    // Available collection sites at workplaces; no motor or stored energy is supplied.
    world.kernel.energy.push({ id: world.nextId('energy'), medium: 'kinetic', initialJ: 0, remainingJ: 0, maxPowerW: 0,
      wind: { areaM2: 2, airDensity: 1.2, exposure: speed / 3.6, importedJ: 0, escapedJ: 0 },
      ownerId: null, pos: { ...place.inside }, origin: 'Weather-driven wind through a 2 m² boundary; geographical exposure derived from local moisture.' });
  }
  for (const p of Object.values(s.people)) {
    if (p.age < 18) continue;
    // Prior experience is a generated personal fact, independent of their occupation.
    if (rng.chance(0.45)) { for (const d of world.kernel.ruleset.components) teachPrimitive(world, p, d); teachNotation(world, p); }
    for (const material of materials) {
      const item = material.legacyItem!;
      for (const place of places) {
        const stock = world.itemsAtPlaces([place.id]).some(i => i.type === item && i.quantity > 0) || processFor(place.type)?.output === item;
        const nodes = world.resourceNodes.filter(n => n.dropPlaceId === place.id && n.yield === item);
        if (stock) learn(world, p, { key: `material-source:${place.id}:${item}`, kind: 'affordance', confidence: 0.8,
          claim: { materialSource: { placeId: place.id, item, pos: place.inside } }, source: { type: 'prior' } }, true);
        // One remembered extraction site per material/provider; no remaining quantity claim.
        if (nodes[0]) learn(world, p, { key: `material-source:${nodes[0].id}`, kind: 'affordance', confidence: 0.8,
          claim: { materialSource: { placeId: place.id, item, nodeId: nodes[0].id, pos: nodes[0].pos } }, source: { type: 'prior' } }, true);
      }
    }
  }
}
