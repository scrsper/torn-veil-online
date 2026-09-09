import { expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { generateProceduralWorld } from '../src/sim/world/settlement';
import { settlementSnapshot } from '../src/sim/world/settlementContinuity';
import { stepDemographics } from '../src/sim/world/demographics';
import { serialize, deserialize } from '../src/sim/persist/save';
import { householdConsistencyErrors } from '../src/sim/world/household';
import { makeItem } from '../src/sim/world/factory';
import { stockAt } from '../src/sim/world/stock';
import { runSettlementWorldLab } from '../src/headless/worldlab/settlements';

const site = { id: 'history:site', x: 256, z: 128 };

it('retains an abandoned settlement after ordinary demographic mortality removes every resident', () => {
  const world = new World(99); generateProceduralWorld(world, [site]);
  const settlement = world.settlements()[0];
  const identities = [...settlement.formerInhabitantIds];
  const initial = settlementSnapshot(world, settlement);
  // A deliberately old founding population is a scenario precondition. No scripted death,
  // settlement-level extinction switch, forced RNG result, or deletion is used.
  for (const p of world.persons()) { p.birthTick = world.now - 98 * 365 * 86400; p.age = 98; }
  const currency = () => world.persons().reduce((n, p) => n + p.wealth, 0) + world.households().reduce((n, h) => n + h.wealth, 0);
  const beforeCurrency = currency();
  for (let day = 0; day < 365 * 80 && world.livingPersons().length; day++) {
    world.clock.advance(86400 / world.clock.timeScale); stepDemographics(world);
  }
  const abandoned = settlementSnapshot(world, settlement);
  expect(abandoned.population).toBe(0); expect(abandoned.inhabited).toBe(false);
  expect(abandoned.depopulatedAt).not.toBeNull();
  expect(abandoned.deaths).toBe(initial.population);
  expect(abandoned.peakPopulation).toBe(initial.population);
  expect(settlement.populationHistory.some(r => r.population > 0 && r.population < initial.population)).toBe(true);
  expect(abandoned.structures).toBe(initial.structures);
  expect(world.items().length).toBeGreaterThan(0);
  expect(identities.every(id => world.person(id) && !world.person(id)!.alive)).toBe(true);
  expect(currency()).toBeCloseTo(beforeCurrency, 8);
  expect(householdConsistencyErrors(world)).toEqual([]);
  const loaded = deserialize(serialize(world))!.world;
  expect(loaded.settlements()[0]).toEqual(settlement);
  expect(settlementSnapshot(loaded, loaded.settlements()[0])).toEqual(abandoned);
}, 30000);

it('records growth from a canonical pregnancy without a settlement growth rule', () => {
  const world = new World(42); generateProceduralWorld(world);
  const mother = world.livingPersons().find(p => p.gender === 'f' && p.age >= 20 && p.age <= 42 && Object.values(p.relationships).some(r => r.tags.includes('spouse')))!;
  const fatherId = Object.entries(mother.relationships).find(([, r]) => r.tags.includes('spouse'))![0];
  const settlement = world.settlementOf(mother)!;
  const before = settlementSnapshot(world, settlement);
  const cause = world.emit('pregnancy_started', { actor: mother.id, target: fatherId });
  mother.physiology.pregnancy = { state: 'gestating', gestationalParentId: mother.id, otherParentId: fatherId,
    conceivedAt: world.now - 280 * 86400, dueAt: world.now, lastProgressAt: world.now, causeEventId: cause.id };
  stepDemographics(world);
  const after = settlementSnapshot(world, settlement);
  expect(after.births).toBe(1); expect(after.population).toBe(before.population + 1);
  expect(after.peakPopulation).toBe(after.population);
  expect(householdConsistencyErrors(world)).toEqual([]);
  const loaded = deserialize(serialize(world))!.world;
  expect(loaded.settlements()).toEqual(world.settlements());
}, 30000);

it('keeps spatial and stock indexes exact across direct movement, transfers and save overlays', () => {
  const world = new World(42), settlements = generateProceduralWorld(world);
  const a = settlements[0].places.square.inside, b = settlements[3].places.square.inside;
  const body = world.primaryBody(Object.values(settlements[0].people)[0].id)!;
  body.pos = { ...a }; expect(world.nearbyBodies(a, 1)).toContain(body);
  body.pos.x = b.x; body.pos.z = b.z;
  expect(world.nearbyBodies(a, 1)).not.toContain(body); expect(world.nearbyBodies(b, 1)).toContain(body);
  const from = settlements[0].places.mill.id, to = settlements[3].places.mill.id;
  const item = makeItem(world, 'grain', 'indexed stock', { pos: a, placeId: from, quantity: 17 });
  const amount = stockAt(world, 'grain', from);
  item.placeId = to; item.pos = { ...b };
  expect(stockAt(world, 'grain', from)).toBe(amount - 17);
  expect(world.nearbyItems(a, 1)).not.toContain(item); expect(world.nearbyItems(b, 1)).toContain(item);
  const before = world.spatialStats().bodyCandidates;
  world.nearbyBodies(a, 30);
  expect(world.spatialStats().bodyCandidates - before).toBeLessThan(world.activeBodies().length / 2);
  const loaded = deserialize(serialize(world))!.world;
  expect(loaded.nearbyItems(b, 1).map(i => i.id)).toContain(item.id);
}, 30000);

it('does not label coarse stepping as detailed fidelity', () => {
  expect(() => runSettlementWorldLab({ seed: 42, days: 1, mode: 'detailed', stepSeconds: 5 })).toThrow('0.15');
});
