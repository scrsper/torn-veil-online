import type { World } from '../core/world';
import type { Settlement } from '../core/types';
import { stockTotal } from './stock';

/** Read-only telemetry, derived from canonical residence, stocks and the population ledger. */
export function settlementSnapshot(world: World, settlement: Settlement) {
  const places = world.places().filter(p => p.settlementId === settlement.id);
  const ids = new Set(places.map(p => p.id));
  const people = world.livingPersons().filter(p => p.homeId && ids.has(p.homeId));
  const history = settlement.populationHistory;
  const depopulations = history.filter((r, i) => r.population === 0 && i > 0 && history[i - 1].population > 0).map(r => r.tick);
  return { id: settlement.id, siteId: settlement.siteId, name: settlement.name, population: people.length,
    peakPopulation: Math.max(people.length, ...history.map(r => r.population)), inhabited: people.length > 0,
    births: history.filter(r => r.type === 'birth').length, deaths: history.filter(r => r.type === 'death').length,
    households: world.households().filter(h => h.homeId && ids.has(h.homeId) && h.memberIds.length).length,
    historicalHouseholds: world.households().filter(h => h.homeId && ids.has(h.homeId)).length,
    structures: places.length, formerInhabitants: settlement.formerInhabitantIds.length,
    foundedAt: settlement.foundedAt, depopulatedAt: people.length ? null : depopulations.at(-1) ?? null, depopulations,
    economy: { hungry: people.filter(p => p.needs.hunger > 0.7).length,
      grain: stockTotal(world, 'grain', [...ids]), flour: stockTotal(world, 'flour', [...ids]), bread: stockTotal(world, 'bread', [...ids]),
      unfilledRequests: world.requests.filter(r => r.status === 'open' && r.requesterPlaceId && ids.has(r.requesterPlaceId)).length } };
}
