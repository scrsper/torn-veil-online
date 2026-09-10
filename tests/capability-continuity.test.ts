import { beforeAll, describe, expect, it } from 'vitest';
import { discoverAndRecord, arrangeReader, advanceUntil, placeWorker, observeNeed } from '../src/headless/kernel/continuity';
import { advanceLiving, causalAncestors, createLivingPressure } from '../src/headless/kernel/living';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { methodsHeld } from '../src/sim/mind/invention';
import { actOnRecord, canReadRecord, damageRecord, intactRecord, MECHANICAL_NOTATION, weatherRecords } from '../src/sim/mind/records';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { energyBalanceError, stepEnvironmentalEnergy } from '../src/sim/kernel/environment';
import { operateAssembly } from '../src/sim/kernel/mechanics';
import { buildChronicle } from '../src/sim/history/chronicle';
import { practiceReservoirs, settlementCapabilities } from '../src/sim/history/capability';
import { householdConsistencyErrors } from '../src/sim/world/household';
import { diePerson } from '../src/sim/world/demographics';
import { RESOURCE_MASS_KG } from '../src/sim/world/factory';
import type { Action } from '../src/sim/core/types';
import { restoreKernel } from '../src/sim/kernel/definitions';

let checkpoint: string;
beforeAll(() => { checkpoint = serialize(discoverAndRecord().world); }, 30000);
function fork() {
  const world = deserialize(checkpoint)!.world, sim = new Simulation(world);
  const record = world.items().find(i => i.record)!, inventor = world.person(record.record!.authorId)!;
  const mill = world.place(record.placeId)!;
  return { world, sim, record, inventor, mill };
}
function readerAtWork() {
  const lab = fork(), { world, sim, inventor, mill } = lab;
  const reader = arrangeReader(world, inventor, mill), skills = structuredClone(reader.skills);
  expect(advanceUntil(world, sim, () => methodsHeld(reader).length > 0, 120)).toBe(true);
  expect(reader.skills).toEqual(skills);
  return { ...lab, reader };
}

describe('civilizational capability continuity', () => {
  it('learns from a physical record, operates non-owned equipment, then independently procures, manufactures and reproduces', () => {
    const { world, sim, inventor, mill, reader, record } = readerAtWork();
    const lesson = methodsHeld(reader)[0]; expect(lesson.source.type).toBe('read'); expect(lesson.source.from).toBe(record.id);
    expect(world.kernel.components.some(c => c.ownerId === reader.id)).toBe(false);
    observeNeed(world, reader, mill, 40);
    expect(advanceUntil(world, sim, () => world.events.some(e => e.type === 'mechanism_trial' && e.actor === reader.id && e.data.output > 0), 120)).toBe(true);
    const operation = world.events.find(e => e.type === 'mechanism_trial' && e.actor === reader.id && e.data.output > 0)!;
    expect(causalAncestors(world, operation.id).has(lesson.source.viaEvent!)).toBe(true);
    expect(world.kernel.assemblies.find(a => a.learned)!.ownerId).toBe(inventor.id);
    const site = world.places().find(p => p.type === 'sawpit')!;
    addPlaceStock(world, 'plank', 6, site.id, site.ownerId, undefined, 'favorable raw supplier endowment');
    placeWorker(world, reader, site); addPlaceStock(world, 'grain', 12, site.id, reader.id, undefined, 'raw process input'); observeNeed(world, reader, site, 10);
    expect(advanceUntil(world, sim, () => world.events.some(e => e.type === 'method_reproduced' && e.actor === reader.id), 900)).toBe(true);
    const reproduced = world.events.find(e => e.type === 'method_reproduced' && e.actor === reader.id)!;
    const a = world.kernel.assemblies.find(a => a.id === reproduced.data.assemblyId)!;
    expect(a.outputQuantity).toBeGreaterThan(0); expect(a.creatorId).toBe(reader.id);
    expect(a.parts).toHaveLength(4);
    for (const id of a.parts) {
      const part = world.kernel.components.find(c => c.id === id)!;
      expect(world.event(part.madeEvent!)!.actor).toBe(reader.id);
      expect(world.event(part.madeEvent!)!.data.laborSeconds).toBeGreaterThan(0);
    }
    expect(reader.skills.crafting).toBeGreaterThan(0); expect(reader.skills.crafting).toBeLessThan(inventor.skills.crafting!);
    const ancestry = [...causalAncestors(world, reproduced.id)].map(id => world.event(id)?.type);
    for (const type of ['record_read', 'record_written', 'method_discovered', 'resource_delivered', 'resource_extracted']) expect(ancestry).toContain(type);
    expect(world.haulTasks.some(t => t.buyerId === reader.id && t.resource === 'stone' && t.status === 'delivered')).toBe(true);
    expect(energyBalanceError(world)).toBeLessThan(1e-6);
    expect(householdConsistencyErrors(world)).toEqual([]);
    expect(buildChronicle(world).some(e => e.sourceEventIds.includes(reproduced.id))).toBe(true);
  }, 30000);

  it('copies with paid labor/materials, moves and inherits the physical source, and preserves it after the author dies', () => {
    const { world, sim, reader, inventor, mill, record } = readerAtWork();
    addPlaceStock(world, 'plank', 0.25, mill.id, reader.id, undefined, 'personal writing stock');
    const before = stockAt(world, 'plank', mill.id);
    expect(advanceUntil(world, sim, () => world.events.some(e => e.type === 'record_copied' && e.actor === reader.id), 120)).toBe(true);
    const copy = world.items().find(i => i.record?.copiedFrom === record.id)!;
    expect(copy.record!.knowledge).toEqual(record.record!.knowledge);
    expect((before - stockAt(world, 'plank', mill.id)) * RESOURCE_MASS_KG.plank!).toBeCloseTo(copy.record!.substrateKg, 8);
    expect(world.event(copy.record!.eventId)!.data.laborSeconds).toBeGreaterThan(0);
    sim.takeItem(reader, copy, 'pickup'); sim.dropItem(reader, copy, world.place(reader.homeId)!.inside);
    expect(copy.holderId).toBe(null); expect(copy.placeId).toBe(reader.homeId);
    diePerson(world, inventor, undefined, 'controlled inventor mortality');
    expect(intactRecord(record)).toBe(true); expect(intactRecord(copy)).toBe(true);
    expect(record.provenance.some(v => v.how === 'inheritance')).toBe(true);
    expect(copy.ownerId).toBe(reader.id);
    const loaded = deserialize(serialize(world))!.world;
    expect(loaded.item(copy.id)).toEqual(copy);
  });

  it('requires access and notation, permits stolen possession, and never certifies mistaken instructions', () => {
    const { world, inventor, record, mill, sim } = fork();
    const reader = arrangeReader(world, inventor, mill);
    const skills = structuredClone(reader.skills);
    delete reader.knowledge[`notation:${MECHANICAL_NOTATION}`];
    expect(canReadRecord(world, reader, record)).toBe(false);
    const notation = inventor.knowledge[`notation:${MECHANICAL_NOTATION}`]; sim.tell(inventor, reader, notation);
    expect(canReadRecord(world, reader, record)).toBe(true);
    world.primaryBody(reader.id)!.pos.x += 50;
    expect(canReadRecord(world, reader, record)).toBe(false);
    world.primaryBody(reader.id)!.pos = { ...mill.inside };
    reader.workId = null; expect(canReadRecord(world, reader, record)).toBe(false);
    sim.takeItem(reader, record, 'theft'); expect(record.ownerId).toBe(inventor.id); expect(canReadRecord(world, reader, record)).toBe(true);
    record.record!.knowledge.claim.method.connections = []; // An incomplete inscription is still an inscription.
    const a: Action = { type: 'read_record', status: 'pending', data: { recordId: record.id } };
    for (let n = 0; n < 20 && a.status !== 'done'; n++) actOnRecord(world, reader, a, 1);
    expect(a.status).toBe('done'); expect(methodsHeld(reader)[0].claim.method.connections).toEqual([]);
    expect(reader.skills).toEqual(skills);
    expect(methodsHeld(inventor)[0].claim.method.connections).toHaveLength(3);
    damageRecord(world, record, 1);
    expect(canReadRecord(world, reader, record)).toBe(false);
  });

  it('meters weather power, stops in calm conditions and retains conserved state across load', () => {
    const { world, inventor, mill } = fork(); placeWorker(world, inventor, mill);
    const a = world.kernel.assemblies.find(a => a.learned)!;
    addPlaceStock(world, 'grain', 10, mill.id, inventor.id, undefined, 'raw energy test input');
    const wind = world.kernel.energy.find(e => e.id === a.bindings.energyId)!;
    stepEnvironmentalEnergy(world, 1); expect(operateAssembly(world, inventor, a, 1).output).toBeGreaterThan(0);
    world.weather.wind = 0; stepEnvironmentalEnergy(world, 1);
    const before = stockAt(world, 'grain', mill.id);
    expect(operateAssembly(world, inventor, a, 1).inputJ).toBe(0); expect(stockAt(world, 'grain', mill.id)).toBe(before);
    world.weather.wind = 0.3; stepEnvironmentalEnergy(world, 1); expect(operateAssembly(world, inventor, a, 1).output).toBeGreaterThan(0);
    expect(wind.wind!.importedJ).toBeGreaterThan(0); expect(wind.wind!.escapedJ).toBeGreaterThan(0);
    expect(energyBalanceError(world)).toBeLessThan(1e-6); expect(restoreKernel(world.kernel)).toEqual(world.kernel);
    expect(deserialize(serialize(world))!.world.kernel).toEqual(world.kernel);
    expect(settlementCapabilities(world)[0].workingAssemblies).toContain(a.id);
    const edge = a.connections.pop()!;
    expect(settlementCapabilities(world)[0].workingAssemblies).not.toContain(a.id);
    a.connections.push(edge);
    world.kernel.components.find(c => c.id === a.parts[0])!.condition = 0;
    expect(operateAssembly(world, inventor, a, 1).reason).toBe('broken');
  });

  it('separates operation permission, knowledge, physical capacity and local presence', () => {
    const { world, inventor, mill } = fork();
    const reader = arrangeReader(world, inventor, mill), assembly = world.kernel.assemblies.find(a => a.learned)!;
    const before = assembly.inputJ;
    // Unfamiliar controls are still physically usable; knowledge is not permission.
    expect(methodsHeld(reader)).toHaveLength(0);
    expect(operateAssembly(world, reader, assembly, 1).reason).toBe('productive');
    const afterAttempt = assembly.inputJ; expect(afterAttempt).toBeGreaterThan(before);
    const record = world.items().find(i => i.record)!;
    const action: Action = { type: 'read_record', status: 'pending', data: { recordId: record.id } };
    for (let i = 0; i < 20 && action.status !== 'done'; i++) actOnRecord(world, reader, action, 1);
    expect(action.status).toBe('done');
    reader.workId = null; expect(operateAssembly(world, reader, assembly, 1).reason).toBe('inaccessible');
    reader.workId = mill.id; world.primaryBody(reader.id)!.pos.x += 50;
    expect(operateAssembly(world, reader, assembly, 1).reason).toBe('inaccessible');
    world.primaryBody(reader.id)!.pos = { ...mill.inside }; world.primaryBody(reader.id)!.pose = 'downed';
    expect(operateAssembly(world, reader, assembly, 1).reason).toBe('inaccessible');
    expect(assembly.inputJ).toBe(afterAttempt);
  });

  it('loses exposed writing to ordinary weather while sheltered writing survives', () => {
    const { world, record } = fork();
    const square = world.places().find(p => p.type === 'square')!;
    world.weather.kind = 'rain'; world.weather.intensity = 1;
    const rain = world.emit('weather', { data: { kind: 'rain', wind: world.weather.wind, intensity: 1 } });
    weatherRecords(world, 8 * 86400); expect(intactRecord(record)).toBe(true);
    record.pos = { ...square.inside }; record.placeId = square.id;
    weatherRecords(world, 8 * 86400); expect(intactRecord(record)).toBe(false);
    expect(record.quantity * RESOURCE_MASS_KG.book!).toBe(record.record!.substrateKg);
    const loss = world.events.find(e => e.type === 'record_destroyed' && e.item === record.id)!;
    expect(loss.causes).toContain(rain.id); expect(loss.causes).toContain(record.record!.eventId);
  });

  it('derives a shared practice reservoir and loses local access when people, records and examples are gone', () => {
    const { world, sim, reader, inventor, mill } = readerAtWork();
    observeNeed(world, reader, mill, 40);
    expect(advanceUntil(world, sim, () => world.events.some(e => e.type === 'mechanism_trial' && e.actor === reader.id && e.data.output > 0), 120)).toBe(true);
    expect(advanceUntil(world, sim, () => practiceReservoirs(world).some(r => r.placeId === mill.id && r.state === 'shared practice'), 60)).toBe(true);
    const holders = world.livingPersons().filter(p => methodsHeld(p).length);
    for (const p of holders) diePerson(world, p, undefined, 'controlled loss of method holders');
    for (const item of world.items().filter(i => i.record)) damageRecord(world, item, 1);
    // Physical failures destroy working examples; plans archived in the kernel are not read by minds.
    for (const part of world.kernel.components) part.condition = 0;
    expect(world.livingPersons().flatMap(methodsHeld)).toHaveLength(0);
    expect(world.items().filter(intactRecord)).toHaveLength(0);
    expect(settlementCapabilities(world)[0].workingAssemblies).toHaveLength(0);
    expect(practiceReservoirs(world).some(r => r.placeId === mill.id && r.state === 'lost')).toBe(true);
    advanceLiving(world, sim, 60);
    expect(world.livingPersons().flatMap(methodsHeld)).toHaveLength(0);
    expect(world.events.some(e => e.type === 'record_destroyed')).toBe(true);
    expect(methodsHeld(inventor).length).toBeGreaterThan(0); // Archives are not access.
  });

  it('replays autonomous discovery/record-making and resumes records, practice and wind exactly', () => {
    const repeat = discoverAndRecord();
    const original = deserialize(checkpoint)!.world;
    expect(repeat.world.kernel).toEqual(original.kernel);
    expect(repeat.world.items().filter(i => i.record)).toEqual(original.items().filter(i => i.record));
    expect(JSON.stringify(repeat.world.events)).toBe(JSON.stringify(original.events));
    const { world, sim, reader, mill } = readerAtWork();
    addPlaceStock(world, 'plank', 0.25, mill.id, reader.id, undefined, 'copy substrate');
    advanceLiving(world, sim, 2);
    const loaded = deserialize(serialize(world))!.world;
    advanceLiving(world, sim, 90); advanceLiving(loaded, new Simulation(loaded), 90);
    expect(loaded.kernel).toEqual(world.kernel);
    expect(loaded.items().filter(i => i.record)).toEqual(world.items().filter(i => i.record));
    expect(loaded.persons().map(p => p.knowledge)).toEqual(world.persons().map(p => p.knowledge));
    expect(practiceReservoirs(loaded)).toEqual(practiceReservoirs(world));
    expect(JSON.stringify(loaded.events)).toBe(JSON.stringify(world.events));
  }, 30000);
});
