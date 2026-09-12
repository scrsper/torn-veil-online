import { describe, expect, it, vi } from 'vitest';
import { addPerson, createTestWorld, v, wall } from './helpers/world';
import type { Action, Goal, Person, WorldEvent } from '../src/sim/core/types';
import type { World } from '../src/sim/core/world';
import { attributeProfile } from '../src/sim/core/human';
import { defaultPhysiology } from '../src/sim/core/physiology';
import { skillOf } from '../src/sim/core/skills';
import { makeBody, makePlace } from '../src/sim/world/factory';
import { addPlaceStock } from '../src/sim/world/stock';
import { getRel } from '../src/sim/mind/relationships';
import * as records from '../src/sim/mind/records';
import { martialGoals, martialPlan } from '../src/sim/mind/martialGoals';
import { actOnMartial, cancelMartial, canTeachTechnique, learningValue, martialActivityLevel, SOLO_MASTERY_CEILING, submitTechniqueUse, techniqueExecutionProfile } from '../src/sim/mind/martialPractice';
import { canExecuteTechnique, knowsTechnique, martialKey, masteryOf, observeTechnique, seedMartialBackground, techniqueKnowledge } from '../src/sim/mind/martialKnowledge';
import { deserializeMartial, serializeMartial } from '../src/sim/persist/martial';
import { deserialize, serialize } from '../src/sim/persist/save';

const PUNCH = 'unarmed:straight-punch';
function fixture(seed = 449) {
  const tw = createTestWorld(seed); tw.world.clock.timeScale = 1;
  const a = addPerson(tw, 'A', 'farmer', v(10, 1, 10), { traits: { curiosity: 1 } });
  const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { traits: { curiosity: 1 } });
  const c = addPerson(tw, 'C', 'farmer', v(12, 1, 10), { traits: { curiosity: 1 } });
  for (const p of [a, b, c]) { p.attributes = attributeProfile(8); p.physiology = defaultPhysiology(); p.schedule = []; }
  seedMartialBackground(tw.world, a, PUNCH, 0.65, 0.7);
  return { ...tw, a, b, c };
}
function action(world: World, p: Person, mode: string, id = PUNCH, partner?: Person): Action {
  const a: Action = { type: 'work', status: 'pending', targetEntity: partner?.id,
    data: { martial: mode, techniqueId: id, bodyId: p.bodies[0], partnerBodyId: partner?.bodies[0] } };
  p.mind.goal = { type: 'work', utility: 0.4, key: `martial:${mode}:${id}`, createdAt: world.now, reasons: ['test elected activity'], data: a.data };
  p.mind.plan = [a]; return a;
}
function advance(world: World, seconds: number) { world.physicalTime += seconds; world.clock.advance(seconds); }
function perform(world: World, p: Person, a: Action, max = 65): void {
  actOnMartial(world, p, a, 1);
  for (let n = 0; n < max && (a.status === 'pending' || a.status === 'active'); n++) { advance(world, 1); actOnMartial(world, p, a, 1); }
}
function teach(world: World, a: Person, b: Person) { const lesson = action(world, a, 'lesson', PUNCH, b); perform(world, a, lesson); expect(lesson.status).toBe('done'); }
function recordAct(world: World, p: Person, a: Action) {
  for (let n = 0; n < 90 && a.status !== 'done' && a.status !== 'failed'; n++) { advance(world, 1); records.actOnRecord(world, p, a, 1); }
  expect(a.status).toBe('done');
}
function combatReport(world: World, p: Person, options: Record<string, any> = {}): WorldEvent {
  const start = world.physicalTime; advance(world, 30);
  return world.emit('combat_action', { actor: p.id, data: { phase: 'complete', actorBodyId: p.bodies[0],
    techniqueUse: { techniqueId: PUNCH, bodyId: p.bodies[0], startPhysicalAt: start, endPhysicalAt: world.physicalTime,
      effort: 0.8, feedback: 0.8, challenge: 0.6, ...options } } });
}

describe('martial learning: separate knowledge, skill, mastery and capacity', () => {
  it('teaches with named causal provenance, then pays time/effort for gradual mastery and family skill', () => {
    const { world, a, b } = fixture();
    expect(knowsTechnique(b, PUNCH)).toBe(false); expect(masteryOf(b, PUNCH)).toBe(0);
    const beforeA = structuredClone(a.skills), beforeEnergy = b.physiology.energy;
    teach(world, a, b);
    const belief = techniqueKnowledge(b, PUNCH)!;
    expect(belief.source.type).toBe('told'); expect(belief.source.from).toBe(a.id);
    expect(world.event(belief.source.viaEvent!)?.type).toBe('work_taught');
    expect(belief.claim.teacherId).toBe(a.id); expect(belief.learnedAt).toBe(world.now);
    expect(knowsTechnique(b, PUNCH)).toBe(true); expect(masteryOf(b, PUNCH)).toBe(0); expect(skillOf(b, 'unarmed')).toBe(0);
    expect(a.skills).toEqual(beforeA); expect(b.physiology.energy).toBeLessThan(beforeEnergy);
    const time = world.physicalTime, energy = b.physiology.energy;
    perform(world, b, action(world, b, 'practice'));
    expect(world.physicalTime - time).toBe(60); expect(b.physiology.energy).toBeLessThan(energy);
    expect(masteryOf(b, PUNCH)).toBeGreaterThan(0); expect(masteryOf(b, PUNCH)).toBeLessThan(0.03);
    expect(skillOf(b, 'unarmed')).toBeGreaterThan(0); expect(b.development.exposure.dexterity).toBeGreaterThan(0);
  });

  it('attributes never confer unknown techniques; an instructed novice has different execution from a master', () => {
    const { world, a, b, c } = fixture(); c.attributes = attributeProfile(20);
    expect(canExecuteTechnique(world, c, 'unarmed:slip-counter')).toBe(false);
    expect(techniqueExecutionProfile(world, c, c.bodies[0], PUNCH)).toBeNull();
    teach(world, a, b);
    const master = techniqueExecutionProfile(world, a, a.bodies[0], PUNCH)!;
    const novice = techniqueExecutionProfile(world, b, b.bodies[0], PUNCH)!;
    expect(master.coordination).toBeGreaterThan(novice.coordination);
    expect(master.timingUncertaintySeconds).toBeLessThan(novice.timingUncertaintySeconds);
    seedMartialBackground(world, b, 'unarmed:slip-counter', 0.8, 0);
    expect(canExecuteTechnique(world, b, 'unarmed:slip-counter')).toBe(false); // Missing slip prerequisite.
  });

  it('rejects unqualified teachers, inaccessible/distrusted partners and urgent needs', () => {
    const { world, a, b, c } = fixture();
    seedMartialBackground(world, c, PUNCH, 0.9, 0);
    expect(canTeachTechnique(world, c, PUNCH)).toBe(false);
    const unqualified = action(world, c, 'lesson', PUNCH, b); perform(world, c, unqualified); expect(unqualified.status).toBe('failed');
    getRel(b, a.id).trust = -0.6;
    const distrusted = action(world, a, 'lesson', PUNCH, b); perform(world, a, distrusted); expect(distrusted.status).toBe('failed');
    getRel(b, a.id).trust = 0; world.body(b.bodies[0])!.pos.x = 25;
    const remote = action(world, a, 'lesson', PUNCH, b); perform(world, a, remote); expect(remote.status).toBe('failed');
    world.body(b.bodies[0])!.pos.x = 11; b.physiology.hydration = 0.1;
    const thirsty = action(world, a, 'lesson', PUNCH, b); perform(world, a, thirsty); expect(thirsty.status).toBe('failed');
    expect(knowsTechnique(b, PUNCH)).toBe(false);
  });

  it('requires line of sight and respects an occupied partner instead of taking over their work', () => {
    const tw = fixture(); const { world, a, b } = tw;
    world.body(b.bodies[0])!.pos.x = 13; wall(tw, 12, 8, 12);
    const blocked = action(world, a, 'lesson', PUNCH, b); perform(world, a, blocked); expect(blocked.status).toBe('failed');
    world.body(b.bodies[0])!.pos.x = 11;
    b.mind.goal = { type: 'work', utility: 0.9, key: 'employment', createdAt: world.now, reasons: [] };
    b.mind.plan = [{ type: 'work', status: 'active' }];
    const occupied = action(world, a, 'lesson', PUNCH, b); perform(world, a, occupied); expect(occupied.status).toBe('failed');
    expect(b.mind.plan[0].status).toBe('active');
  });

  it('cannot farm mastery from idle, rejected actions, zero effort, paused clock or an old action', () => {
    const { world, a, b } = fixture();
    const unknown = action(world, b, 'practice'); perform(world, b, unknown); expect(unknown.status).toBe('failed');
    teach(world, a, b);
    const practice = action(world, b, 'practice'); actOnMartial(world, b, practice, 1);
    for (let n = 0; n < 100; n++) actOnMartial(world, b, practice, 60);
    expect(masteryOf(b, PUNCH)).toBe(0); expect(practice.data?.progress).toBeUndefined();
    // An idle gap is not accrued practice when the next action asks for a one-second slice.
    advance(world, 100); actOnMartial(world, b, practice, 1); expect(practice.status).toBe('failed');
    const done = action(world, b, 'practice'); perform(world, b, done);
    const earned = masteryOf(b, PUNCH); advance(world, 60); actOnMartial(world, b, done, 60); expect(masteryOf(b, PUNCH)).toBe(earned);
    expect(learningValue(60, 0, 1, 1)).toBe(0); expect(learningValue(60, 1, 0, 1)).toBe(0); expect(learningValue(NaN, 1, 1, 1)).toBe(0);
  });

  it('sparring spends both participants time/effort and improves both without an injury award', () => {
    const { world, a, b } = fixture(); teach(world, a, b);
    const health = [world.body(a.bodies[0])!.health, world.body(b.bodies[0])!.health];
    const energy = [a.physiology.energy, b.physiology.energy];
    const spar = action(world, b, 'spar', PUNCH, a); perform(world, b, spar);
    expect(spar.status).toBe('done'); expect(masteryOf(b, PUNCH)).toBeGreaterThan(0);
    expect(skillOf(a, 'unarmed')).toBeGreaterThan(0.65); expect(a.physiology.energy).toBeLessThan(energy[0]); expect(b.physiology.energy).toBeLessThan(energy[1]);
    expect([world.body(a.bodies[0])!.health, world.body(b.bodies[0])!.health]).toEqual(health);
  });

  it('does not let another body multiply a mind’s elapsed activity credit', () => {
    const { world, a, b } = fixture(); teach(world, a, b);
    const extra = makeBody(world, b.id, v(11, 1, 11)); b.bodies.push(extra.id);
    const practice = action(world, b, 'practice'); actOnMartial(world, b, practice, 1);
    advance(world, 30); actOnMartial(world, b, practice, 30);
    const ev = world.emit('combat_action', { actor: b.id, data: { phase: 'complete', actorBodyId: extra.id, techniqueUse: {
      techniqueId: PUNCH, bodyId: extra.id, startPhysicalAt: world.physicalTime - 20, endPhysicalAt: world.physicalTime,
      effort: 0.9, feedback: 0.9, challenge: 0.9 } } });
    expect(submitTechniqueUse(world, b, ev.id)).toBe(0); expect(masteryOf(b, PUNCH)).toBe(0);
    advance(world, 30); actOnMartial(world, b, practice, 30); expect(masteryOf(b, PUNCH)).toBeGreaterThan(0);
  });

  it('classifies both sparring partners for shared physiology and releases them on a paid interruption', () => {
    const { world, a, b } = fixture(); teach(world, a, b);
    const spar = action(world, b, 'spar', PUNCH, a); actOnMartial(world, b, spar, 1);
    expect(martialActivityLevel(world, a)).toBe('chop'); expect(martialActivityLevel(world, b)).toBe('chop');
    const energy = b.physiology.energy; advance(world, 20); actOnMartial(world, b, spar, 20);
    expect(b.physiology.energy).toBeLessThan(energy); const ledger = b.martial!.creditedThrough;
    cancelMartial(world, b, 'urgent thirst'); b.mind.plan = [];
    expect(martialActivityLevel(world, a)).toBeUndefined(); expect(b.martial!.session).toBeUndefined();
    expect(b.martial!.creditedThrough).toBe(ledger); expect(masteryOf(b, PUNCH)).toBe(0);
    expect(world.events.at(-1)!.data.phase).toBe('interrupted'); expect(deserializeMartial(serializeMartial(world))).not.toBeNull();
  });

  it('uses any available manifestation and intellect affects understanding without granting mastery', () => {
    const { world, a, b, c } = fixture();
    b.attributes.intellect = 4; c.attributes.intellect = 16;
    teach(world, a, b); teach(world, a, c);
    expect(techniqueKnowledge(c, PUNCH)!.claim.understanding).toBeGreaterThan(techniqueKnowledge(b, PUNCH)!.claim.understanding);
    expect(masteryOf(b, PUNCH)).toBe(0); expect(masteryOf(c, PUNCH)).toBe(0);
    world.body(c.bodies[0])!.present = false;
    const manifestation = makeBody(world, c.id, v(12, 1, 11)); c.bodies.push(manifestation.id);
    const goal = martialGoals(world, c).find(g => g.data?.martial === 'practice')!;
    expect(goal.data!.bodyId).toBe(manifestation.id);
  });
});

describe('manuals, observation, discovery and combat feedback', () => {
  it('writes, obtains, reads, copies, gives and destroys physical manuals preserving mistakes and causal lineage', () => {
    const { world, sim, a, b, c, places } = fixture();
    const place = world.place(places.square)!; place.ownerId = a.id; a.homeId = place.id;
    for (const p of [a, b, c]) { world.body(p.bodies[0])!.pos = { ...place.inside }; records.teachNotation(world, p); }
    addPlaceStock(world, 'plank', 5, place.id, a.id, undefined, 'manual substrate');
    techniqueKnowledge(a, PUNCH)!.claim.components = ['mistaken-foot-position'];
    recordAct(world, a, { type: 'write_record', placeId: place.id, status: 'pending', data: { key: martialKey(PUNCH) } });
    const manual = world.items().find(i => i.record)!;
    expect(manual.type).toBe('book'); expect(manual.record!.authorId).toBe(a.id);
    expect(records.canReadRecord(world, b, manual)).toBe(false);
    sim.takeItem(b, manual, 'theft'); expect(manual.ownerId).toBe(a.id);
    expect(records.canReadRecord(world, b, manual)).toBe(true);
    recordAct(world, b, { type: 'read_record', status: 'pending', data: { recordId: manual.id } });
    expect(knowsTechnique(b, PUNCH)).toBe(true); expect(masteryOf(b, PUNCH)).toBe(0);
    const read = techniqueKnowledge(b, PUNCH)!;
    expect(read.source.from).toBe(manual.id); expect(read.source.type).toBe('read'); expect(read.claim.components).toEqual(['mistaken-foot-position']);
    expect(world.event(read.source.viaEvent!)!.causes).toContain(manual.record!.eventId);
    sim.giveItem(b, a, manual);
    recordAct(world, a, { type: 'copy_record', placeId: place.id, status: 'pending', data: { recordId: manual.id } });
    const copy = world.items().find(i => i.record?.copiedFrom === manual.id)!;
    expect(copy.record!.knowledge).toEqual(manual.record!.knowledge);
    expect(world.event(copy.record!.eventId)!.causes).toContain(manual.record!.eventId);
    sim.takeItem(a, copy, 'pickup'); sim.giveItem(a, c, copy);
    recordAct(world, c, { type: 'read_record', status: 'pending', data: { recordId: copy.id } });
    for (let n = 0; n < 4; n++) recordAct(world, c, { type: 'read_record', status: 'pending', data: { recordId: copy.id } });
    expect(masteryOf(c, PUNCH)).toBe(0); expect(skillOf(c, 'unarmed')).toBe(0);
    expect(records.damageRecord(world, manual, 1)).toBe(true); expect(records.canReadRecord(world, a, manual)).toBe(false);
    expect(records.canReadRecord(world, c, copy)).toBe(true);
    expect(records.damageRecord(world, copy, 1)).toBe(true); expect(knowsTechnique(c, PUNCH)).toBe(true);
  });

  it('incomplete/uncertain manuals and unknown notation do not confer full understanding', () => {
    const { world, sim, a, b, places } = fixture(); const place = world.place(places.square)!;
    place.ownerId = a.id; world.body(a.bodies[0])!.pos = { ...place.inside }; world.body(b.bodies[0])!.pos = { ...place.inside };
    records.teachNotation(world, a); addPlaceStock(world, 'plank', 2, place.id, a.id, undefined, 'manual substrate');
    techniqueKnowledge(a, PUNCH)!.claim.understanding = 0.25;
    recordAct(world, a, { type: 'write_record', placeId: place.id, status: 'pending', data: { key: martialKey(PUNCH) } });
    const manual = world.items().find(i => i.record)!; sim.takeItem(b, manual, 'theft');
    expect(records.canReadRecord(world, b, manual)).toBe(false); records.teachNotation(world, b);
    recordAct(world, b, { type: 'read_record', status: 'pending', data: { recordId: manual.id } });
    expect(techniqueKnowledge(b, PUNCH)).toBeDefined(); expect(knowsTechnique(b, PUNCH)).toBe(false);
  });

  it('requires repeated actual sightings and never teaches mastery or hidden lineage by observation', () => {
    const { world, a, b, c } = fixture();
    for (let n = 0; n < 8; n++) {
      perform(world, a, action(world, a, 'practice'));
      const ev = [...world.events].reverse().find(e => e.data.martialDemonstration)!;
      expect(observeTechnique(world, c, ev.id)).toBeNull(); // No supported perception.
      ev.perceivedBy.push({ who: b.id, how: 'saw', tick: world.now });
      observeTechnique(world, b, ev.id);
      const understanding = techniqueKnowledge(b, PUNCH)!.claim.understanding;
      expect(observeTechnique(world, b, ev.id)).toBeNull();
      expect(techniqueKnowledge(b, PUNCH)!.claim.understanding).toBe(understanding);
      if (n === 0) expect(knowsTechnique(b, PUNCH)).toBe(false);
    }
    expect(knowsTechnique(b, PUNCH)).toBe(true); expect(masteryOf(b, PUNCH)).toBe(0); expect(skillOf(b, 'unarmed')).toBe(0);
    expect(techniqueKnowledge(b, PUNCH)!.claim.creatorId).toBeUndefined(); expect(techniqueKnowledge(b, PUNCH)!.claim.parentId).toBeUndefined();
  });

  it('creates one deterministic descendant with discoverer provenance but zero instant mastery', () => {
    const run = () => { const { world, a } = fixture(889); perform(world, a, action(world, a, 'experiment'));
      const d = Object.values(world.martialDefinitions!)[0]; expect(d.parentId).toBe(PUNCH); expect(d.creatorId).toBe(a.id);
      expect(world.event(d.originEventId!)!.data.discovery.techniqueId).toBe(d.techniqueId);
      expect(techniqueKnowledge(a, d.techniqueId)!.source.type).toBe('self'); expect(masteryOf(a, d.techniqueId)).toBe(0);
      const again = action(world, a, 'experiment'); perform(world, a, again); expect(again.status).toBe('failed');
      expect(Object.keys(world.martialDefinitions!)).toHaveLength(1); return { d, knowledge: a.knowledge, mastery: a.martial!.mastery }; };
    expect(run()).toEqual(run());
  });

  it('accepts meaningful failed-hit feedback once and caps unresponsive-target farming', () => {
    const { world, a, b } = fixture(); teach(world, a, b);
    const first = combatReport(world, b); first.data.hit = false;
    expect(submitTechniqueUse(world, b, first.id)).toBeGreaterThan(0); expect(submitTechniqueUse(world, b, first.id)).toBe(0);
    const before = masteryOf(b, PUNCH);
    const rejected = combatReport(world, b); rejected.data.phase = 'rejected'; expect(submitTechniqueUse(world, b, rejected.id)).toBe(0);
    const zero = combatReport(world, b, { effort: 0 }); expect(submitTechniqueUse(world, b, zero.id)).toBe(0); expect(masteryOf(b, PUNCH)).toBe(before);
    for (let n = 0; n < 300; n++) { const ev = combatReport(world, b); submitTechniqueUse(world, b, ev.id); }
    expect(masteryOf(b, PUNCH)).toBe(SOLO_MASTERY_CEILING); expect(skillOf(b, 'unarmed')).toBeLessThanOrEqual(0.35);
    const responding = combatReport(world, b, { targetBodyId: a.bodies[0] }); responding.data.responsiveTarget = true;
    expect(submitTechniqueUse(world, b, responding.id)).toBeGreaterThan(0);
  });
});

describe('persistence and ordinary autonomous choice', () => {
  it('round-trips discovery, manuals, skills, provenance and an unfinished session, then continues identically', () => {
    const { world, a, b, places } = fixture(); teach(world, a, b);
    perform(world, a, action(world, a, 'experiment'));
    const place = world.place(places.square)!; place.ownerId = a.id; world.body(a.bodies[0])!.pos = { ...place.inside };
    records.teachNotation(world, a); addPlaceStock(world, 'plank', 2, place.id, a.id, undefined, 'manual substrate');
    recordAct(world, a, { type: 'write_record', placeId: place.id, status: 'pending', data: { key: martialKey(PUNCH) } });
    const practice = action(world, b, 'practice'); actOnMartial(world, b, practice, 1); advance(world, 20); actOnMartial(world, b, practice, 20);
    const raw = serializeMartial(world), loaded = deserializeMartial(raw)!.world, lb = loaded.person(b.id)!;
    expect(loaded.martialDefinitions).toEqual(world.martialDefinitions); expect(lb.martial).toEqual(b.martial);
    expect(lb.knowledge).toEqual(b.knowledge); expect(lb.skills).toEqual(b.skills);
    const manual = world.items().find(i => i.record)!; expect(loaded.item(manual.id)!.record).toEqual(manual.record);
    for (const [w, p] of [[world, b], [loaded, lb]] as const) {
      const pending = p.mind.plan[0]; advance(w, 40); actOnMartial(w, p, pending, 40); expect(pending.status).toBe('done');
    }
    expect(lb.martial).toEqual(b.martial); expect(lb.skills).toEqual(b.skills); expect(lb.physiology).toEqual(b.physiology);
    const event = combatReport(loaded, lb); expect(submitTechniqueUse(loaded, lb, event.id)).toBeGreaterThan(0);
    const reloaded = deserializeMartial(serializeMartial(loaded))!.world;
    expect(submitTechniqueUse(reloaded, reloaded.person(b.id)!, event.id)).toBe(0);
    expect(deserialize(serialize(world))!.world.person(b.id)!.martial).toEqual(b.martial); // Ordinary Person fields already round-trip.
  });

  it('accepts old saves and rejects corrupt mastery, skills, time ledgers and dangling discoveries', () => {
    const { world, a } = fixture(); expect(deserializeMartial(serialize(world))).not.toBeNull();
    perform(world, a, action(world, a, 'experiment'));
    const original = JSON.parse(serializeMartial(world));
    const corrupt = (edit: (d: any) => void) => { const d = structuredClone(original); edit(d); expect(deserializeMartial(JSON.stringify(d))).toBeNull(); };
    corrupt(d => { d.persons.find((p: any) => p.id === a.id).martial.mastery[PUNCH].value = 9; });
    corrupt(d => { d.persons.find((p: any) => p.id === a.id).skills.unarmed = -1; });
    corrupt(d => { d.persons.find((p: any) => p.id === a.id).martial.creditedThrough = d.physicalTime + 1; });
    corrupt(d => { Object.values<any>(d.martialLearning.definitions)[0].parentId = 'missing:technique'; });
  });

  it('preserves mastery evidence and its exact teaching ancestry through event compaction and save/load', () => {
    const { world, a, b } = fixture(); teach(world, a, b);
    const lessonId = techniqueKnowledge(b, PUNCH)!.source.viaEvent!;
    perform(world, b, action(world, b, 'practice'));
    const practiceId = b.martial!.mastery[PUNCH].lastEventId!;
    const startedId = world.event(practiceId)!.causes[0];
    for (const p of [a, b]) { p.knowledge = {}; p.memories = []; p.mind.goal = null; p.mind.plan = []; }
    // Dead persons are still serialized, so their actual mastery provenance must survive.
    b.alive = false;
    for (let n = 0; n < 100; n++) world.emit('work_shift', { significance: 0.01 });
    const count = world.events.length; world.compactEvents(20); expect(world.events.length).toBeLessThan(count);
    expect(world.event(practiceId)!.causes).toContain(startedId); expect(world.event(startedId)!.causes).toContain(lessonId);
    const restored = deserializeMartial(serializeMartial(world))!.world;
    expect(restored.person(b.id)!.martial).toEqual(b.martial); expect(restored.event(lessonId)).toBeDefined();
    expect(restored.event(practiceId)!.causes).toEqual(world.event(practiceId)!.causes);
  });

  it('keeps a discovered definition and origin ancestry after its discoverer forgets and dies', () => {
    const { world, a } = fixture(); perform(world, a, action(world, a, 'experiment'));
    const definition = Object.values(world.martialDefinitions!)[0], originId = definition.originEventId!;
    const ancestors = [...world.event(originId)!.causes];
    a.knowledge = {}; a.memories = []; a.mind.goal = null; a.mind.plan = []; a.alive = false;
    for (let n = 0; n < 100; n++) world.emit('work_shift', { significance: 0.01 });
    world.compactEvents(20);
    expect(world.event(originId)!.causes).toEqual(ancestors); for (const cause of ancestors) expect(world.event(cause)).toBeDefined();
    const restored = deserializeMartial(serializeMartial(world))!.world;
    expect(restored.martialDefinitions![definition.techniqueId]).toEqual(definition);
    expect(restored.person(a.id)!.alive).toBe(false); expect(restored.event(originId)!.causes).toEqual(ancestors);
  });

  it('offers all relevant opportunities from personal evidence without scanning hidden teacher knowledge', () => {
    const { world, a, b } = fixture();
    a.mind.percepts = [{ entityId: b.id, bodyId: b.bodies[0], how: 'saw', pos: world.body(b.bodies[0])!.pos, distance: 1, tick: world.now }];
    expect(martialGoals(world, a).some(g => g.data?.martial === 'lesson')).toBe(true);
    expect(martialGoals(world, a).some(g => g.data?.martial === 'experiment')).toBe(true);
    expect(martialGoals(world, b)).toEqual([]); // Nearby canonical master is not mind knowledge.
    teach(world, a, b);
    b.mind.percepts = [{ entityId: a.id, bodyId: a.bodies[0], how: 'saw', pos: world.body(a.bodies[0])!.pos, distance: 1, tick: world.now }];
    expect(martialGoals(world, b).some(g => g.data?.martial === 'spar')).toBe(true);
    expect(martialGoals(world, b).some(g => g.data?.martial === 'practice')).toBe(true);
  });

  it('lets the real existing think/utility loop choose practice, with urgent thirst winning instead', () => {
    const tw = fixture(); const { world, sim, a, b } = tw; teach(world, a, b);
    // Test-only registration of the deferred provider hook. The real think() and its
    // motivation/commitment/needs selection run unchanged in this parallel branch.
    const original = records.recordGoals;
    const registered = vi.spyOn(records, 'recordGoals').mockImplementation((w, p) => [...original(w, p), ...martialGoals(w, p)]);
    try {
      b.mind.goal = null; b.mind.plan = []; b.needs.hunger = 0; b.needs.thirst = 0; b.needs.energy = 0; b.needs.social = 0;
      sim['think'](b, world.body(b.bodies[0])!);
      expect((b.mind.goal as Goal | null)?.data?.martial).toBe('practice');
      b.mind.plan = martialPlan(world, b.mind.goal!)!;
      perform(world, b, b.mind.plan[0]); expect(masteryOf(b, PUNCH)).toBeGreaterThan(0);
      b.physiology.hydration = 0.01; b.needs.thirst = 0.99; b.mind.goal = null; b.mind.plan = [];
      makePlace(world, 'well', 'Test well', { x0: 8, z0: 8, x1: 9, z1: 9, y0: 1, y1: 3 }, { inside: v(9, 1, 9) });
      sim['think'](b, world.body(b.bodies[0])!);
      expect((b.mind.goal as Goal | null)?.data?.martial).toBeUndefined(); expect(['drink', 'drink_water']).toContain((b.mind.goal as Goal | null)?.type);
    } finally { registered.mockRestore(); }
  });
});
