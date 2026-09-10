import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { discoverAndRecord, advanceUntil, placeWorker, observeNeed } from '../src/headless/kernel/continuity';
import { advanceLiving, createLivingPressure, livingSnapshot, causalAncestors } from '../src/headless/kernel/living';
import { giveBirth, diePerson } from '../src/sim/world/demographics';
import { methodsHeld } from '../src/sim/mind/invention';
import { knowsNotation, MECHANICAL_NOTATION, intactRecord, canReadRecord } from '../src/sim/mind/records';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { addPlaceStock } from '../src/sim/world/stock';
import { energyBalanceError } from '../src/sim/kernel/environment';
import { settlementCapabilities, practiceReservoirs } from '../src/sim/history/capability';
import { householdConsistencyErrors } from '../src/sim/world/household';
import type { World } from '../src/sim/core/world';

const report = (name: string, data: unknown) => { mkdirSync('.debug/continuity', { recursive: true }); writeFileSync(`.debug/continuity/${name}.json`, JSON.stringify(data, null, 2)); };
function years(world: World, sim: Simulation, count: number): void {
  for (let day = 0; day < count * 365; day++) {
    // The existing Epoch observation cadence: the same Simulation, one daily physical step.
    const dt = 86400 / world.clock.timeScale, wd = world.clock.advance(dt);
    world.physicalTime += dt; sim.step(dt, wd); sim.flushSpeech();
  }
}

describe('capability continuity acceptance (separate from the edit-loop suite)', () => {
  it('preserves a record through death and eighteen simulated years, then an actual later-born adult reads and operates; loaded continuation is identical', () => {
    const lab = discoverAndRecord(), { world, sim, inventor, record } = lab;
    const discovery = world.events.find(e => e.type === 'method_discovered')!;
    const mother = world.livingPersons().find(p => p.homeId === inventor.homeId && p.id !== inventor.id && p.age >= 18)!;
    const conception = world.emit('pregnancy_started', { actor: mother.id, target: inventor.id, category: 'history', tick: world.now - 280 * 86400 });
    mother.physiology.pregnancy = { gestationalParentId: mother.id, otherParentId: inventor.id, conceivedAt: conception.tick, dueAt: world.now,
      state: 'gestating', lastProgressAt: world.now, causeEventId: conception.id };
    const child = giveBirth(world, mother)!;
    expect(child.birthTick).toBeGreaterThan(discovery.tick); expect(methodsHeld(child)).toEqual([]);
    const death = diePerson(world, inventor, undefined, 'controlled inventor mortality')!;
    expect(record.ownerId).toBe(mother.id);
    expect(world.place(record.placeId)!.ownerId).toBe(mother.id);
    expect(world.livingPersons().flatMap(methodsHeld)).toEqual([]);
    years(world, sim, 9);
    const saved = serialize(world), loaded = deserialize(saved)!.world;
    years(world, sim, 9); years(loaded, new Simulation(loaded), 9);
    expect(loaded.kernel).toEqual(world.kernel);
    expect(loaded.items().filter(i => i.record)).toEqual(world.items().filter(i => i.record));
    expect(loaded.persons().map(p => p.knowledge)).toEqual(world.persons().map(p => p.knowledge));
    expect(JSON.stringify(loaded.events)).toBe(JSON.stringify(world.events));
    expect(child.alive).toBe(true); expect(child.age).toBe(18); expect(methodsHeld(child)).toEqual([]);
    expect(intactRecord(record)).toBe(true);
    const mill = world.place(record.placeId)!;
    placeWorker(world, child, mill); child.traits.curiosity = 0.95;
    const teacher = world.livingPersons().find(p => knowsNotation(p, MECHANICAL_NOTATION))!;
    placeWorker(world, teacher, mill);
    sim.tell(teacher, child, teacher.knowledge[`notation:${MECHANICAL_NOTATION}`]); // A local lesson supplies notation only.
    expect(methodsHeld(child)).toEqual([]);
    const skills = structuredClone(child.skills);
    addPlaceStock(world, 'grain', 30, mill.id, mill.ownerId, undefined, 'favorable post-epoch raw process input');
    const studyStart = { readable: canReadRecord(world, child, record), notation: child.knowledge[`notation:${MECHANICAL_NOTATION}`], owner: record.ownerId, placeOwner: mill.ownerId, hour: world.clock.hourF };
    let firstGoal: unknown;
    const acquired = advanceUntil(world, sim, () => { if (!firstGoal && child.mind.goal) firstGoal = structuredClone(child.mind.goal); return methodsHeld(child).length > 0; }, 120);
    if (!acquired) report('individual-study-diagnostic', { attributes: child.attributes, needs: child.needs, physiology: child.physiology,
      studyStart, firstGoal, goal: child.mind.goal, plan: child.mind.plan, readable: canReadRecord(world, child, record), position: world.positionOf(child.id), recordPosition: record.pos, holder: record.holderId });
    expect(acquired).toBe(true);
    expect(child.skills).toEqual(skills);
    const lesson = methodsHeld(child)[0]; expect(lesson.source.type).toBe('read'); expect(lesson.source.from).toBe(record.id);
    observeNeed(world, child, mill, 40);
    expect(advanceUntil(world, sim, () => world.events.some(e => e.type === 'mechanism_trial' && e.actor === child.id && e.data.output > 0), 180)).toBe(true);
    const operation = world.events.find(e => e.type === 'mechanism_trial' && e.actor === child.id && e.data.output > 0)!;
    expect(causalAncestors(world, operation.id).has(lesson.source.viaEvent!)).toBe(true);
    const ancestry = [...causalAncestors(world, lesson.source.viaEvent!)];
    expect(ancestry).toContain(record.record!.eventId); expect(ancestry).toContain(discovery.id); expect(ancestry).toContain(death);
    expect(householdConsistencyErrors(world)).toEqual([]);
    const restored = deserialize(serialize(world))!.world;
    expect(restored.kernel).toEqual(world.kernel); expect(restored.person(child.id)!.knowledge).toEqual(child.knowledge);
    report('generation', { passed: true, seed: world.seed, years: 18, cadence: 'one ordinary Simulation step per day between fine-grained demonstrations',
      inventor: inventor.id, death, discovery: discovery.id, record: record.id, inheritedBy: record.ownerId,
      child: { id: child.id, name: child.name, born: child.birthTick, age: child.age, lesson: lesson.source, notation: child.knowledge[`notation:${MECHANICAL_NOTATION}`].source },
      operation: { id: operation.id, ...operation.data }, ancestry, identicalNineYearLoadedContinuation: true, energyErrorJ: energyBalanceError(world),
      reservoirs: practiceReservoirs(world), limits: ['Favorable literacy encounter and raw grain supply at the adult demonstration.', 'Epoch cadence does not resolve every intervening physical action.'] });
  }, 180000);

  it('lets three ordinary generated settlements diverge under the same cognition and environmental rules', () => {
    const lab = createLivingPressure(17, [0, 1, 2].map(i => ({ id: `site_${i}`, x: 256 + i * 1000, z: 128 })));
    advanceLiving(lab.world, lab.sim, 1800);
    const snapshots = livingSnapshot(lab.world), capabilities = settlementCapabilities(lab.world);
    expect(snapshots.some(s => s.mechanicalOutput > 0)).toBe(true);
    expect(snapshots.some(s => s.mechanicalOutput === 0 && !s.methods.length)).toBe(true);
    expect(new Set(capabilities.map(c => JSON.stringify([c.livingMethods.length, c.workingAssemblies.length]))).size).toBeGreaterThan(1);
    expect(energyBalanceError(lab.world)).toBeLessThan(1e-6);
    expect(householdConsistencyErrors(lab.world)).toEqual([]);
    report('divergence', { passed: true, seed: 17, physicalSeconds: 1800, settlements: snapshots.map(s => ({ name: s.name, output: s.mechanicalOutput,
      bread: s.baked, methods: s.methods.length, manufactured: s.manufactured.length, sources: s.sources })), capabilities });
  }, 60000);
});
