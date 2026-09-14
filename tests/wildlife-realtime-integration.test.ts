import { afterEach, expect, it, vi } from 'vitest';
import { addPerson, createTestWorld, v, wall, type TestWorld } from './helpers/world';
import { createAnimal, naturalDeath } from '../src/sim/ecology/animals';
import { stepWildlife, ECOLOGY_QUANTUM_SECONDS } from '../src/sim/ecology/simulation';
import { ecologyScenario } from '../src/headless/ecology/scenarios';
import { Simulation } from '../src/sim/mind/agent';
import { makeBody, makeCreature } from '../src/sim/world/factory';
import { requestCombatAction } from '../src/sim/physical/combatAction';
import * as physiology from '../src/sim/core/physiology';
import { BridgeSession } from '../src/bridge/session';
import { wildlifeProjection } from '../src/bridge/wildlife';
import { regionDynamics, RegionStream } from '../src/bridge/regions';
import { serialize, deserialize, SAVE_VERSION } from '../src/sim/persist/save';
import { setExternalControl } from '../src/sim/runtime/controllers';
import { B } from '../src/sim/physical/blocks';

afterEach(() => vi.restoreAllMocks());

function encounter() {
  const tw = createTestWorld(830, 80);
  const person = addPerson(tw, 'Approaching traveler', 'traveler', v(10.5, 1, 20.5), { controlled: true });
  const viewer = tw.world.primaryBody(person.id)!;
  const animal = createAnimal(tw.world, 'roe_deer', v(15.5, 1, 20.5), { sex: 'male' });
  const body = tw.world.body(animal.bodies[0])!, state = animal.wildlife!.embodiments[body.id];
  return { ...tw, person, viewer, animal, body, state };
}
function advance(tw: Pick<TestWorld, 'world' | 'sim'>, ticks: number, check?: () => void) {
  for (let i = 0; i < ticks; i++) {
    const wd = tw.world.clock.advance(1 / 60); tw.world.physicalTime += 1 / 60;
    tw.sim.stepScheduled(1 / 60, wd); check?.();
  }
}

it('common physical presence includes Person, Creature and present corpses without widening human cognition indexes', () => {
  const x = encounter(), c = makeCreature(x.world, 'unattached_sapient', 'future controller', null, null);
  const cb = makeBody(x.world, c.id, v(16.5, 1, 20.5)); c.bodies.push(cb.id);
  expect(x.world.nearbyPhysicalBodies(x.viewer.pos, 10).map(b => b.id)).toEqual([x.viewer.id, x.body.id, cb.id]);
  expect(x.world.nearbyBodies(x.viewer.pos, 10).map(b => b.id)).toEqual([x.viewer.id]);
  x.body.dead = true;
  expect(x.world.nearbyPhysicalBodies(x.viewer.pos, 10)).not.toContain(x.body);
  expect(x.world.nearbyPhysicalBodies(x.viewer.pos, 10, true)).toContain(x.body);
  x.body.present = false;
  expect(x.world.nearbyPhysicalBodies(x.viewer.pos, 10, true)).not.toContain(x.body);
  cb.pos.x = 70;
  expect(x.world.nearbyPhysicalBodies(x.viewer.pos, 10, true)).not.toContain(cb);
});

it('the 60 Hz scheduler advances one background quantum, without the 20 Hz slow pass double-stepping animals', () => {
  const a = ecologyScenario(831, 1), b = ecologyScenario(831, 1);
  a.clock.timeScale = b.clock.timeScale = 900;
  const sim = new Simulation(a), spy = vi.spyOn(physiology, 'stepEmbodiedPhysiology');
  const state = a.creatures()[0].wildlife!.embodiments[a.creatures()[0].bodies[0]];
  advance({ world: a, sim }, 60);
  expect(spy.mock.calls.filter(c => c[1] === state.physiology).reduce((sum, c) => sum + c[2], 0)).toBeCloseTo(0.25, 12);
  b.clock.advance(1); b.physicalTime += 1; stepWildlife(b, 1, 900);
  expect(a.creatures()).toEqual(b.creatures());
  expect(a.ecology!.processedAt).toBe(b.ecology!.processedAt);
  expect(a.ecology!.pendingWorldSeconds).toBeCloseTo(0, 8);
  expect(sim.perceptionAccum).toBeLessThan(0.2);
});

it('background -> active -> background retains identity and cannot spend earlier coarse movement at activation', () => {
  const x = encounter(), initial = { ...x.body.pos }, reserves = { ...x.state.physiology };
  const wd = x.world.clock.advance(8); x.world.physicalTime += 8; stepWildlife(x.world, 8, wd);
  const quantumStart = x.world.ecology!.processedAt;
  advance(x, 1);
  expect(x.state.encounter?.active).toBe(true);
  expect(x.state.encounter!.accountedPhysicalSeconds).toBeCloseTo(8 + 1 / 60);
  expect(Math.hypot(x.body.pos.x - initial.x, x.body.pos.z - initial.z)).toBeLessThanOrEqual(1.6 / 60 + 1e-8);
  expect(x.state.physiology).toEqual(reserves);
  expect(x.state.foodKg).toBe(0);
  let previous = { ...x.body.pos };
  advance(x, 430, () => {
    expect(Math.hypot(x.body.pos.x - previous.x, x.body.pos.z - previous.z)).toBeLessThanOrEqual(1.6 / 60 + 1e-8);
    previous = { ...x.body.pos };
  });
  expect(x.world.ecology!.processedAt).toBe(quantumStart + 900);
  expect(x.state.encounter?.active).toBe(true);
  expect(x.state.physiology.energy).toBeLessThan(reserves.energy);
  x.viewer.pos = v(75.5, 1, 75.5); // explicit observer relocation fixture, not animal motion
  advance(x, 13);
  expect(x.state.encounter?.active).toBe(false);
  expect(x.world.get(x.animal.id)).toBe(x.animal);
  expect(x.world.body(x.body.id)).toBe(x.body);
  expect(x.world.creatures()).toHaveLength(1);
});

it('active movement is swept against canonical walls and pays one physiology interval', () => {
  const x = encounter(); x.world.clock.timeScale = 900;
  wall(x, 18, 0, 79);
  const spy = vi.spyOn(physiology, 'stepEmbodiedPhysiology'), before = { ...x.body.pos };
  advance(x, 60, () => expect(x.body.pos.x + 0.3).toBeLessThan(18));
  expect(x.state.distanceM).toBeGreaterThan(0);
  expect(x.state.distanceM).toBeLessThanOrEqual(1.6 + 1e-8);
  expect(x.body.pos).not.toEqual(before);
  expect(spy.mock.calls.filter(c => c[1] === x.state.physiology).reduce((sum, c) => sum + c[2], 0)).toBeCloseTo(0.25, 12);
  expect(x.state.foodKg).toBe(0); expect(x.state.waterLitres).toBe(0);
});

it('proximity enables responsive scheduling but an occluding wall grants no threat knowledge', () => {
  const x = encounter(); wall(x, 13, 0, 79);
  const start = { ...x.body.pos }; advance(x, 30);
  expect(x.state.encounter?.active).toBe(true);
  expect(x.state.encounter?.threat).toBeNull();
  expect(x.body.pos).toEqual(start);
  for (let z = 0; z < 80; z++) for (let y = 1; y <= 3; y++) x.world.grid.set(13, y, z, B.Air);
  x.world.nav.rebuildAll(); advance(x, 13);
  expect(x.state.encounter?.threat?.bodyId).toBe(x.viewer.id);
  expect(x.state.activity).toBe('flee');
  expect(x.body.pos.x).toBeGreaterThan(start.x);
});

it('natural death at an active quantum stops future motion and removes only the derived scheduler work item', () => {
  const x = encounter(); x.world.clock.timeScale = 900;
  x.animal.wildlife!.senescenceAt = x.world.now + 900;
  advance(x, 60); expect(x.body.dead).toBe(true);
  const pos = { ...x.body.pos }; advance(x, 30);
  expect(x.body.pos).toEqual(pos); expect(x.body.pose).toBe('dead');
  expect(x.body.present).toBe(true); expect(x.world.get(x.animal.id)).toBe(x.animal);
  expect(x.world.events.filter(e => e.type === 'animal_died')).toHaveLength(1);
});

it('an unseen nearby Person changes cadence, not the animal needs: active feeding and sleep still require elapsed time', () => {
  const x = encounter(); x.world.clock.timeScale = 900; wall(x, 13, 0, 79);
  x.world.grid.set(15, 0, 20, B.Grass);
  const food = { id: 'local-grass', kind: 'forage' as const, forage: 'grass' as const, yield: 'biomass' as const,
    pos: { ...x.body.pos }, blocks: [], capacity: 1, remaining: 1, state: 'available' as const, renewable: false, regrowHours: 0 };
  x.world.resourceNodes.push(food);
  x.state.physiology.energy = 0.2; x.state.activity = 'eat'; x.state.target = { pos: { ...food.pos }, resourceId: food.id };
  advance(x, 59);
  expect(x.state.encounter?.threat).toBeNull();
  expect(x.state.foodKg).toBe(0); expect(food.remaining).toBe(1);
  advance(x, 1);
  const expectedKg = x.world.ecology!.species.roe_deer.metabolism.foodKgPerDay * 0.25 / 4;
  expect(x.state.foodKg).toBeCloseTo(expectedKg, 10); expect(food.remaining).toBeCloseTo(1 - expectedKg, 10);
  x.state.physiology.energy = 0.9; x.state.physiology.hydration = 0.9;
  x.state.physiology.sleepDebt = 5; x.state.activity = 'sleep'; x.state.target = null;
  const debt = x.state.physiology.sleepDebt;
  advance(x, 59); expect(x.state.physiology.sleepDebt).toBe(debt);
  advance(x, 1); expect(x.state.physiology.sleepDebt).toBeLessThan(debt);
  expect(x.state.foodKg).toBeCloseTo(expectedKg, 10);
});

it('active ecological travel follows its resource target continuously before eating and cannot consume a removed source', () => {
  const x = encounter(); wall(x, 13, 0, 79); x.world.clock.timeScale = 300;
  const food = { id: 'distant-grass', kind: 'forage' as const, forage: 'grass' as const, yield: 'biomass' as const,
    pos: v(18.5, 1, 20.5), blocks: [], capacity: 1, remaining: 1, state: 'available' as const, renewable: false, regrowHours: 0 };
  x.world.grid.set(18, 0, 20, B.Grass); x.world.resourceNodes.push(food);
  x.state.physiology.energy = 0.2; x.state.activity = 'seek_food'; x.state.target = { pos: { ...food.pos }, resourceId: food.id };
  let previous = { ...x.body.pos };
  advance(x, 150, () => {
    expect(Math.hypot(x.body.pos.x - previous.x, x.body.pos.z - previous.z)).toBeLessThanOrEqual(1.6 / 60 + 1e-8);
    previous = { ...x.body.pos };
  });
  expect(x.body.pos.x).toBeGreaterThan(17);
  expect(x.state.encounter!.intake!.worldSeconds).toBeGreaterThan(0);
  x.world.grid.set(18, 0, 20, B.Stone); // actual plant substrate is removed before coarse settlement
  advance(x, 30);
  expect(x.state.foodKg).toBe(0); expect(food.remaining).toBe(1);
});

it('a live combat contact and responsive wildlife run on the same scheduled world without animal combat admission', () => {
  const x = encounter();
  const target = addPerson(x, 'Practice partner', 'traveler', v(11.55, 1, 20.5), { controlled: true });
  const tb = x.world.primaryBody(target.id)!, health = tb.health;
  x.viewer.yaw = -Math.PI / 2; // strike geometry follows canonical facing, not target snapping
  const result = requestCombatAction(x.world, { attackerId: x.person.id, attackerBodyId: x.viewer.id, targetBodyId: tb.id, attackMode: 'strike', trajectory: 'mid' });
  expect(result.attempted).toBe(true); expect(tb.health).toBe(health);
  advance(x, 90);
  expect(tb.health).toBeLessThan(health);
  expect(x.world.events.some(e => e.type === 'attack' && e.actor === x.person.id)).toBe(true);
  expect(x.state.distanceM).toBeGreaterThan(0);
  expect(x.body.combatAction).toBeFalsy();
});

it('unsupported creatures never acquire reactive wildlife cognition, movement or normal wildlife projection', () => {
  const x = encounter(), c = makeCreature(x.world, 'future_dragon', 'unattached controller', null, null);
  const b = makeBody(x.world, c.id, v(11.5, 1, 21.5)); c.bodies.push(b.id);
  const before = JSON.stringify(c), pos = { ...b.pos };
  advance(x, 90);
  expect(JSON.stringify(c)).toBe(before); expect(b.pos).toEqual(pos); expect(b.path).toBeNull();
  expect(wildlifeProjection(x.world, x.viewer).bodies.some(s => s.creatureId === c.id)).toBe(false);
});

it('bounds active encounter broad-phase work for a 128-animal group', () => {
  const x = encounter();
  for (let i = 1; i < 128; i++) createAnimal(x.world, 'roe_deer', v(16.5 + i % 8, 1, 16.5 + Math.floor(i / 8)), { sex: 'male' });
  const before = x.world.spatialStats().bodyCandidates, start = performance.now();
  advance(x, 60);
  const candidates = x.world.spatialStats().bodyCandidates - before;
  expect(x.world.creatures().filter(c => c.wildlife?.embodiments[c.bodies[0]].encounter?.active)).toHaveLength(128);
  expect(candidates).toBeLessThan(128 * 40);
  console.info('Live wildlife scale', JSON.stringify({ animals: 128, physicalTicks: 60, bodyCandidates: candidates, elapsedMs: Math.round(performance.now() - start) }));
});

it('projection is detached, observation-gated and excludes internal needs, reproduction and future decisions', () => {
  const x = encounter(); x.viewer.yaw = -Math.PI / 2;
  const row = wildlifeProjection(x.world, x.viewer).bodies.find(b => b.bodyId === x.body.id)!;
  expect(row).toBeDefined(); expect(row.speciesId).toBe('roe_deer');
  expect(Object.keys(row).sort()).toEqual(['activity', 'ageClass', 'alive', 'bodyId', 'bodyPlan', 'condition', 'creatureId', 'dead', 'pos', 'present', 'regionId', 'scale', 'speciesId', 'vel', 'yaw'].sort());
  row.pos.x = -99; row.bodyPlan.heightM = 999;
  expect(x.body.pos.x).toBe(15.5); expect(x.world.ecology!.species.roe_deer.bodyPlan.heightM).toBe(1.5);
  x.viewer.yaw = Math.PI / 2;
  expect(wildlifeProjection(x.world, x.viewer).bodies).toHaveLength(0);
  x.viewer.yaw = -Math.PI / 2; wall(x, 13, 0, 79);
  expect(wildlifeProjection(x.world, x.viewer).bodies).toHaveLength(0);
});

function savedEncounter() {
  const s = new BridgeSession(918271), w = s.world;
  for (const p of w.livingPersons()) { setExternalControl(p, true); p.mind.plan = []; }
  const viewer = w.primaryBody(w.playerId!)!;
  const pos = { ...viewer.pos, x: viewer.pos.x + 4 };
  pos.y = w.nav.floorY(Math.floor(pos.x), Math.floor(pos.z));
  const animal = createAnimal(w, 'roe_deer', pos, { sex: 'male' });
  viewer.yaw = -Math.PI / 2;
  return { s, animal, body: w.body(animal.bodies[0])! };
}

it('schema 24 retains active threat memory, body path, both clock debts and deterministic realtime continuation', () => {
  const { s, animal, body } = savedEncounter();
  for (let i = 0; i < 7; i++) s.stepInteraction(i);
  expect(animal.wildlife!.embodiments[body.id].encounter?.active).toBe(true);
  const raw = s.save(); expect(JSON.parse(raw).version).toBe(SAVE_VERSION);
  const loaded = new BridgeSession(918271, { save: raw });
  expect(loaded.world.ecology).toEqual(s.world.ecology);
  expect(loaded.world.get(animal.id)).toEqual(animal);
  expect(loaded.world.body(body.id)).toEqual(body);
  for (let i = 0; i < 65; i++) { s.stepInteraction(i + 10); loaded.stepInteraction(i + 10); }
  expect(loaded.world.ecology).toEqual(s.world.ecology);
  expect(loaded.world.get(animal.id)).toEqual(animal);
  expect(loaded.world.body(body.id)).toEqual(body);
  expect(loaded.sim.perceptionAccum).toBe(s.sim.perceptionAccum);
  expect(loaded.snapshot().wildlife).toEqual(s.snapshot().wildlife);
}, 30000);

it('save validation rejects impossible duplicated encounter time and legacy ecology fields remain optional', () => {
  const { s, animal: original } = savedEncounter(); s.stepInteraction();
  const data = JSON.parse(s.save());
  const animal = data.creatures.find((c: { id: string }) => c.id === original.id);
  animal.wildlife.embodiments[animal.bodies[0]].encounter.accountedWorldSeconds += 900;
  expect(deserialize(JSON.stringify(data))).toBeNull();
  for (const c of data.creatures) if (c.wildlife) for (const e of Object.values(c.wildlife.embodiments) as { encounter?: unknown }[]) delete e.encounter;
  delete data.ecology.interaction;
  expect(deserialize(JSON.stringify(data))?.world.ecology?.interaction).toBeUndefined();
});

it('fresh village bridges found wildlife once, while loading and the isolated combat arena do not found animals', () => {
  const s = new BridgeSession(918271);
  const ids = s.world.creatures().filter(c => c.wildlife).map(c => c.id);
  expect(ids.length).toBeGreaterThan(0);
  const restored = new BridgeSession(918271, { save: s.save() });
  expect(restored.world.creatures().filter(c => c.wildlife).map(c => c.id)).toEqual(ids);
  const arena = new BridgeSession(918271, { arena: true });
  expect(arena.world.ecology).toBeNull();
  expect(arena.world.creatures().some(c => c.wildlife)).toBe(false);
});

it('the legacy bridge step and a restored direct Simulation step retain the live encounter clock', () => {
  const { s, animal, body } = savedEncounter();
  s.step(1 / 60);
  expect(animal.wildlife!.embodiments[body.id].encounter?.active).toBe(true);
  const loaded = deserialize(s.save())!.world, sim = new Simulation(loaded);
  const before = { ...loaded.body(body.id)!.pos }, wd = loaded.clock.advance(1 / 60);
  loaded.physicalTime += 1 / 60; sim.step(1 / 60, wd);
  expect(loaded.body(body.id)!.pos).not.toEqual(before);
  expect(loaded.ecology!.pendingWorldSeconds).toBeCloseTo(s.world.ecology!.pendingWorldSeconds + wd);
});

it('regional unload/reload preserves animal identity, depleted canonical forage and the distinction between death and absence', () => {
  const s = new BridgeSession(918271, { playable: true }), w = s.world;
  const node = w.resourceNodes.find(n => n.kind === 'forage')!;
  const animal = createAnimal(w, 'field_hare', { ...node.pos }, { sex: 'male' });
  const body = w.body(animal.bodies[0])!, state = animal.wildlife!.embodiments[body.id];
  for (const n of w.resourceNodes) if (n.kind === 'forage' && Math.hypot(n.pos.x - node.pos.x, n.pos.z - node.pos.z) < 24) n.remaining = 0;
  node.remaining = 0.01; state.physiology.energy = 0.1; state.physiology.hydration = 0.9;
  const viewer = w.primaryBody(w.playerId!)!; viewer.pos = { ...node.pos, z: node.pos.z + 1 }; viewer.yaw = 0;
  const regionId = w.geography!.regionId(node.pos.x, node.pos.z), ids = new Set([regionId]);
  const before = regionDynamics(w, ids).resources.find(n => n.id === node.id)!.remaining;
  const dt = ECOLOGY_QUANTUM_SECONDS / w.clock.timeScale, wd = w.clock.advance(dt); w.physicalTime += dt; stepWildlife(w, dt, wd);
  expect(state.foodKg).toBeGreaterThan(0);
  expect(node.remaining).toBe(0);
  expect(regionDynamics(w, ids).resources.find(n => n.id === node.id)).toMatchObject({ remaining: 0, state: 'depleted', unit: 'kg', physicallyAvailable: false });
  expect(before).toBeGreaterThan(node.remaining);
  const stream = new RegionStream(), original = { ...viewer.pos };
  expect(stream.plan(w)!.wanted).toContain(regionId);
  expect(regionDynamics(w, ids).wildlife.bodies.some(b => b.bodyId === body.id)).toBe(true);
  viewer.pos.x += w.geography!.spec.regionSize * 4;
  expect(stream.plan(w)!.unload).toContain(regionId);
  expect(wildlifeProjection(w, viewer).bodies.some(b => b.bodyId === body.id)).toBe(false);
  viewer.pos = original; expect(stream.plan(w)!.wanted).toContain(regionId);
  expect(wildlifeProjection(w, viewer).bodies.find(b => b.bodyId === body.id)?.creatureId).toBe(animal.id);
  const loaded = deserialize(serialize(w))!.world;
  expect(loaded.resourceNodes.find(n => n.id === node.id)?.remaining).toBe(0);
  expect(regionDynamics(loaded, ids).resources.find(n => n.id === node.id)?.remaining).toBe(0);
  naturalDeath(w, animal, body, state, 'old_age', w.now);
  expect(wildlifeProjection(w, viewer).bodies.find(b => b.bodyId === body.id)).toMatchObject({ dead: true, alive: false, present: true, activity: 'dead' });
  body.present = false;
  expect(wildlifeProjection(w, viewer).bodies.some(b => b.bodyId === body.id)).toBe(false);
  expect(w.body(body.id)).toBe(body); expect(body.dead).toBe(true);
}, 60000);
