import { expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { ecologyScenario } from '../src/headless/ecology/scenarios';
import { Simulation } from '../src/sim/mind/agent';
import { initializeWildlife } from '../src/sim/ecology/generation';
import { stepWildlife } from '../src/sim/ecology/simulation';
import { submitCombatInput } from '../src/sim/physical/combatAction';

it('realtime scheduling advances wildlife once without sending Creature bodies through Person physiology or movement', () => {
  const world = ecologyScenario(831, 2), reference = ecologyScenario(831, 2);
  const sim = new Simulation(world);
  // Cross one ordinary 900-calendar-second ecology quantum through the live slow cadence.
  for (let i = 0; i < 6008; i++) {
    const dt = 0.025, wd = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.stepScheduled(dt, wd);
  }
  reference.clock.advance(150); reference.physicalTime += 150;
  stepWildlife(reference, 150, 900);
  expect(world.ecology!.processedAt).toBe(900);
  expect(world.ecology!.pendingWorldSeconds).toBeCloseTo(1.2, 7);
  expect(world.ecology!.pendingPhysicalSeconds).toBeCloseTo(0.2, 7);
  expect(world.creatures()).toEqual(reference.creatures());
  for (const animal of world.creatures()) for (const id of animal.bodies) {
    expect(world.body(id)).toEqual(reference.body(id));
  }
  expect(world.persons()).toHaveLength(0);
  expect(world.activeBodies()).toHaveLength(0);
});

it('a live attack and both partial scheduler clocks survive a wildlife session checkpoint together', () => {
  const session = new BridgeSession(832);
  initializeWildlife(session.world);
  const w = session.world, animalIds = w.creatures().filter(c => c.wildlife).map(c => c.id);
  expect(animalIds.length).toBeGreaterThan(0);
  // Retain a nearly complete ecology quantum. The next interaction step crosses the
  // boundary, executes that quantum once, and checkpoints its small remainder.
  const physical = 899.7 / w.clock.timeScale;
  const wd = w.clock.advance(physical); w.physicalTime += physical;
  session.sim.stepScheduled(physical, wd);
  const processedBeforeInteraction = w.ecology!.processedAt;
  const body = w.primaryBody(w.playerId!)!;
  expect(submitCombatInput(w, body.id, {
    kind: 'attack', commandId: 'ecology-checkpoint-strike',
  })).toBe('accepted');
  session.stepInteraction(1);
  const saved = session.save(), data = JSON.parse(saved);
  expect(data.version).toBe(25);
  expect(data.execution.interactionCadence.physical).toBeCloseTo(1 / 60);
  expect(data.ecology.processedAt).toBe(processedBeforeInteraction + 900);
  expect(data.ecology.pendingWorldSeconds).toBeCloseTo(0.7);
  const resumed = new BridgeSession(832, { save: saved });
  expect(resumed.world.ecology).toEqual(w.ecology);
  expect(resumed.world.body(body.id)!.combatAction).toEqual(body.combatAction);
  for (let i = 0; i < 90; i++) {
    session.stepInteraction(10 + i); resumed.stepInteraction(10 + i);
  }
  // The resumed interaction steps remain below the next 900-second boundary: neither
  // session may execute the already-accounted quantum a second time.
  expect(w.ecology!.processedAt).toBe(data.ecology.processedAt);
  expect(resumed.world.ecology).toEqual(w.ecology);
  expect(resumed.world.creatures()).toEqual(w.creatures());
  expect(resumed.world.creatures().filter(c => c.wildlife).map(c => c.id)).toEqual(animalIds);
  for (const c of w.creatures().filter(c => c.wildlife)) for (const id of c.bodies) {
    expect(resumed.world.body(id)).toEqual(w.body(id));
  }
  expect(body.combatAction?.phase).toBe('complete');
  expect(resumed.world.body(body.id)!.combatAction).toEqual(body.combatAction);
  expect(resumed.world.resourceNodes).toEqual(w.resourceNodes);
  expect(resumed.world.person(w.playerId!)!.physiology).toEqual(w.person(w.playerId!)!.physiology);
  expect(resumed.world.rng.state()).toBe(w.rng.state());
  expect(resumed.world.executionSnapshot!()).toEqual(w.executionSnapshot!());
}, 60000);

it('playable session restoration preserves an extinct wildlife population and depleted forage without founder regeneration', () => {
  const session = new BridgeSession(918271, { playable: true }), w = session.world;
  const animals = w.creatures().filter(c => c.wildlife);
  expect(animals.length).toBeGreaterThan(0);
  for (const animal of animals) for (const id of animal.bodies) {
    const body = w.body(id)!; body.health = 0; body.dead = true; body.pose = 'dead';
  }
  for (const node of w.resourceNodes.filter(n => n.kind === 'forage')) {
    node.remaining = 0; node.state = 'depleted';
  }
  session.stepInteraction(1);
  const resumed = new BridgeSession(918271, { playable: true, save: session.save() });
  expect(resumed.world.ecology).toEqual(w.ecology);
  expect(resumed.world.creatures()).toEqual(w.creatures());
  expect(resumed.world.resourceNodes).toEqual(w.resourceNodes);
  expect(resumed.world.geography!.spec).toEqual(w.geography!.spec);
  for (const animal of animals) for (const id of animal.bodies) {
    expect(resumed.world.body(id)).toEqual(w.body(id));
  }
  expect(resumed.world.livingIndexErrors()).toEqual([]);
}, 60000);
