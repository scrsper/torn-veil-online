import { expect, it } from 'vitest';
import { ecologyScenario, advanceEcology } from '../src/headless/ecology/scenarios';
import { createAnimal } from '../src/sim/ecology/animals';
import { B } from '../src/sim/physical/blocks';
import { reproductiveEligibility, stepReproduction } from '../src/sim/ecology/lifecycle';
import { ecologyQueries, senseResources } from '../src/sim/ecology/sensing';
import { maintainResourceNodes } from '../src/sim/world/resources';
import { handInteractions } from '../src/sim/physical/hand';
import { addPerson, createTestWorld } from './helpers/world';
import { makeBody, makeCreature } from '../src/sim/world/factory';

it('three species share intake mechanics while physical demand and digestive efficiency differ', () => {
  const w = ecologyScenario(821, 0);
  const animals = ['field_hare', 'roe_deer', 'woodland_boar'].map(id => {
    const c = createAnimal(w, id, { x: 20.5, y: 1, z: 20.5 });
    const e = c.wildlife!.embodiments[c.bodies[0]];
    e.physiology.energy = 0.3; e.physiology.hydration = 0.9;
    return e;
  });
  advanceEcology(w, 2 / 24);
  expect(animals[0].foodKg).toBeGreaterThan(0);
  expect(animals[1].foodKg).toBeGreaterThan(animals[0].foodKg * 4);
  expect(animals[2].foodKg).toBeGreaterThan(animals[0].foodKg * 4);
  // Grass is much poorer boar food than mast, despite the animal eating more mass.
  expect(animals[2].physiology.energy).toBeLessThan(animals[0].physiology.energy);
});

it('poor habitat prompts movement toward sensed suitable terrain', () => {
  const w = ecologyScenario(822, 0);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 48; z++) w.grid.set(x, 0, z, B.Sand);
  w.nav.rebuildAll();
  const c = createAnimal(w, 'field_hare', { x: 12.5, y: 1, z: 20.5 }), b = w.body(c.bodies[0])!;
  advanceEcology(w, 2 / 24);
  expect(b.pos.x).toBeGreaterThanOrEqual(16);
});

it('a failed water-crossing approach is remembered and nearby reachable food is used', () => {
  const w = ecologyScenario(823, 0), c = createAnimal(w, 'field_hare', { x: 22.5, y: 1, z: 20.5 });
  const b = w.body(c.bodies[0])!, e = c.wildlife!.embodiments[b.id];
  w.resourceNodes = w.resourceNodes.filter(n => n.kind === 'surface_water' || n.pos.z === 20.5 && [8.5, 28.5].includes(n.pos.x));
  e.physiology.energy = 0.2; e.physiology.hydration = 0.9;
  advanceEcology(w, 8 / 24);
  expect(e.foodKg).toBeGreaterThan(0);
  expect(b.pos.x).toBeLessThan(24);
});

it('a timer/probability cannot conceive without a mature, local mate', () => {
  const w = ecologyScenario(824, 2), female = w.creatures()[0], male = w.creatures()[1];
  const b = w.body(female.bodies[0])!, mb = w.body(male.bodies[0])!, spec = w.ecology!.species.field_hare;
  spec.reproduction.conceptionChancePerDay = 100;
  male.wildlife!.bornAt = w.now;
  const attempt = () => { const q = ecologyQueries(w); stepReproduction(w, female, b, female.wildlife!.embodiments[b.id], spec, senseResources(w, q, b, spec), q, w.now, 86400); };
  attempt(); expect(female.wildlife!.pregnancy).toBeNull();
  male.wildlife!.bornAt = -1000 * 86400; mb.pos.x = 40;
  attempt(); expect(female.wildlife!.pregnancy).toBeNull();
});

it('paving stops forage renewal; ordinary tree regrowth remains years long', () => {
  const w = ecologyScenario(825, 0), node = w.resourceNodes.find(n => n.kind === 'forage')!;
  node.remaining = 0;
  w.grid.set(Math.floor(node.pos.x), 0, Math.floor(node.pos.z), B.Stone);
  w.resourceNodes.push({ id: 'slow_tree', kind: 'tree', yield: 'log', pos: { x: 2.5, y: 1, z: 2.5 }, blocks: [],
    remaining: 0, capacity: 6, renewable: true, regrowHours: 2.5 * 365 * 24, state: 'depleted', depletedAt: 0, regrowAt: 2.5 * 365 * 86400 });
  w.clock.worldSeconds += 30 * 86400; maintainResourceNodes(w);
  expect(node.remaining).toBe(0);
  expect(w.resourceNodes.at(-1)!.remaining).toBe(0);
});

it('direct ecological intake nodes do not mask ordinary human gathering targets', () => {
  const tw = createTestWorld(826), p = addPerson(tw, 'Gatherer', 'woodcutter', { x: 10.5, y: 1, z: 10.5 });
  const common = { blocks: [], remaining: 5, capacity: 5, renewable: false, regrowHours: 0, state: 'available' as const };
  tw.world.resourceNodes.push({ ...common, id: 'biomass', kind: 'forage', forage: 'grass', yield: 'biomass', pos: { x: 10.5, y: 1, z: 9.5 } },
    { ...common, id: 'stone', kind: 'stone', yield: 'stone', pos: { x: 11.5, y: 1, z: 9.5 } });
  expect(handInteractions(tw.sim, p).filter(a => a.kind === 'gather').map(a => a.id)).toEqual(['gather:stone']);
  tw.world.resourceNodes.pop();
  expect(handInteractions(tw.sim, p).some(a => a.kind === 'gather')).toBe(false);
});

it('a nonhuman creature without a supported controller never falls back to decorative animal cognition', () => {
  const tw = createTestWorld(827), creature = makeCreature(tw.world, 'future_sapient', 'unattached controller fixture', null, null);
  const body = makeBody(tw.world, creature.id, { x: 10.5, y: 1, z: 10.5 }); creature.bodies.push(body.id);
  tw.sim.step(5, 300);
  expect(creature.wanderTimer).toBe(0);
  expect(body.pos).toEqual({ x: 10.5, y: 1, z: 10.5 });
  expect(body.path).toBeNull();
});

it('reproduction rechecks live source quantities rather than trusting a pre-intake sensory snapshot', () => {
  const w = ecologyScenario(828, 2), c = w.creatures()[0], b = w.body(c.bodies[0])!, spec = w.ecology!.species.field_hare;
  const q = ecologyQueries(w), seen = senseResources(w, q, b, spec);
  expect(reproductiveEligibility(w, c, b, spec, seen, q)).toBe(true);
  for (const n of seen) if (n.kind === 'surface_water') { n.remaining = 0; n.state = 'depleted'; }
  expect(reproductiveEligibility(w, c, b, spec, seen, q)).toBe(false);
});
