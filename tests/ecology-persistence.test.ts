import { expect, it } from 'vitest';
import { newWorld, serialize, deserialize } from '../src/sim/persist/save';
import { stepWildlife } from '../src/sim/ecology/simulation';
import { advanceEcology, ecologyScenario, ecologySnapshot } from '../src/headless/ecology/scenarios';
import { createAnimal, isMature } from '../src/sim/ecology/animals';
import { Simulation } from '../src/sim/mind/agent';
import { SECONDS_PER_DAY as DAY } from '../src/sim/core/time';

it('save/load retains wildlife, species components, physical paths, gestation, RNG and partial scheduler phase', () => {
  const { world: w } = newWorld(813);
  expect(w.creatures().some(c => c.wildlife)).toBe(true);
  const founder = w.creatures().find(c => c.species === 'field_hare' && c.wildlife)!;
  const pos = w.body(founder.bodies[0])!.pos;
  createAnimal(w, 'field_hare', { ...pos }, { sex: 'female' });
  createAnimal(w, 'field_hare', { ...pos }, { sex: 'male' });
  // A disclosed high-fertility scenario ensures this checkpoint contains real conception.
  w.ecology!.species.field_hare.reproduction.conceptionChancePerDay = 10;
  advanceEcology(w, 3);
  expect(w.creatures().some(c => c.wildlife?.pregnancy)).toBe(true);
  const dt = 137 / w.clock.timeScale; w.clock.advance(dt); w.physicalTime += dt; stepWildlife(w, dt, 137);
  const saved = serialize(w), loaded = deserialize(saved)!.world;
  expect(loaded).toBeDefined();
  expect(loaded.ecology).toEqual(w.ecology);
  expect(loaded.creatures().filter(c => c.wildlife)).toEqual(w.creatures().filter(c => c.wildlife));
  for (const world of [w, loaded]) advanceEcology(world, 5);
  expect(loaded.ecology).toEqual(w.ecology);
  expect(loaded.creatures().filter(c => c.wildlife)).toEqual(w.creatures().filter(c => c.wildlife));
  for (const c of w.creatures().filter(c => c.wildlife)) for (const id of c.bodies) expect(loaded.body(id)).toEqual(w.body(id));
  expect(loaded.resourceNodes).toEqual(w.resourceNodes);
  expect(loaded.rng.state()).toBe(w.rng.state());
}, 60000);

it('ordinary Simulation invokes ecology once, and frame partitions preserve its fixed quantum', () => {
  const a = ecologyScenario(814, 2), b = ecologyScenario(814, 2), sim = new Simulation(a);
  for (let i = 0; i < 30; i++) { a.clock.advance(5); a.physicalTime += 5; sim.step(5, 30); }
  b.clock.advance(150); b.physicalTime += 150; stepWildlife(b, 150, 900);
  expect(a.creatures()).toEqual(b.creatures());
  expect(a.ecology).toEqual(b.ecology);
});

it('a data-defined short-lived test species completes birth, growth, reproduction and senescence with ordinary resource clocks', () => {
  const w = ecologyScenario(815, 0);
  const spec = structuredClone(w.ecology!.species.field_hare);
  spec.id = 'fixture_rodent'; spec.name = 'fixture rodent';
  spec.lifecycle = { maturityDays: 3, lifespanDays: 20 };
  spec.reproduction = { ...spec.reproduction, gestationDays: 2, weaningDays: 1, breedingIntervalDays: 4, conceptionChancePerDay: 2, litter: [1, 2] };
  w.ecology!.species[spec.id] = spec;
  for (let i = 0; i < 4; i++) createAnimal(w, spec.id, { x: 20.5, y: 1, z: 20.5 + i }, { ageDays: 3, sex: i % 2 ? 'male' : 'female' });
  advanceEcology(w, 9);
  const child = w.creatures().find(c => c.wildlife!.parentIds.length && isMature(c, spec, w.now));
  expect(child).toBeDefined();
  advanceEcology(w, 17);
  expect(w.creatures().some(c => c.wildlife!.parentIds.some(id => w.get<import('../src/sim/core/types').Creature>(id)?.wildlife?.parentIds.length))).toBe(true);
  expect(ecologySnapshot(w).deaths.old_age).toBeGreaterThan(0);
  expect(w.resourceNodes.filter(n => n.kind === 'forage').every(n => n.regrowHours === 30 * 24)).toBe(true);
}, 60000);

it('unsupported cognition does not silently become wildlife, and explicit species references persist independently of human identity', () => {
  const w = ecologyScenario(816, 0), spec = structuredClone(w.ecology!.species.field_hare);
  spec.id = 'sapient_test'; spec.cognition.controller = 'person'; w.ecology!.species[spec.id] = spec;
  expect(() => createAnimal(w, spec.id, { x: 20.5, y: 1, z: 20.5 })).toThrow(/appropriate canonical controller/);
  expect(w.persons()).toHaveLength(0);
});

it('empty animal populations and depleted forage stay empty through restoration without seeding replacements', () => {
  const { world } = newWorld(817);
  for (const c of world.creatures().filter(c => c.wildlife)) for (const id of c.bodies) {
    const body = world.body(id)!; body.dead = true; body.health = 0;
  }
  for (const n of world.resourceNodes.filter(n => n.kind === 'forage')) { n.remaining = 0; n.state = 'depleted'; }
  const count = world.creatures().length, restored = deserialize(serialize(world))!.world;
  expect(restored.creatures()).toHaveLength(count);
  expect(ecologySnapshot(restored).alive).toBe(0); expect(ecologySnapshot(restored).forageKg).toBe(0);
  advanceEcology(restored, 1 / DAY);
  expect(restored.creatures()).toHaveLength(count);
}, 60000);
