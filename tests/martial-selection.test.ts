import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import type { Person, Action } from '../src/sim/core/types';
import type { World } from '../src/sim/core/world';
import type { MartialInput, MartialStance } from '../src/sim/core/martialTypes';
import { attributeProfile } from '../src/sim/core/human';
import { skillOf } from '../src/sim/core/skills';
import { makeBody } from '../src/sim/world/factory';
import { addPlaceStock } from '../src/sim/world/stock';
import { martialRepertoire, selectMartialAction, type MartialSelection, type MartialSelectionContext } from '../src/sim/mind/martialSelection';
import { canExecuteTechnique, knowsTechnique, martialKey, masteryOf, seedMartialBackground, techniqueKnowledge } from '../src/sim/mind/martialKnowledge';
import { actOnMartial } from '../src/sim/mind/martialPractice';
import { actOnRecord, teachNotation } from '../src/sim/mind/records';
import { deserializeMartial, serializeMartial } from '../src/sim/persist/martial';

const JAB = 'unarmed:jab', CROSS = 'unarmed:cross', KICK = 'unarmed:low-kick';
const JAB_CROSS = 'unarmed:jab-to-cross', CROSS_KICK = 'unarmed:cross-to-low-kick';
const inputs: MartialInput[] = ['Light', 'Heavy', 'Dodge', 'Duck'];
function fixture() {
  const tw = createTestWorld(715); tw.world.clock.timeScale = 1;
  const p = addPerson(tw, 'Untrained', 'farmer', v(10, 1, 10));
  p.knowledge = {}; p.skills = {}; p.attributes = attributeProfile(8);
  return { ...tw, p };
}
function ready(world: World, p: Person, stance: MartialStance = 'neutral'): MartialSelectionContext {
  return { bodyId: p.bodies[0], stance, opportunity: { kind: 'ready', previousActionId: world.body(p.bodies[0])!.combatAction?.id,
    opensAt: world.physicalTime, closesAt: world.physicalTime + 1, allowedInputs: inputs } };
}
/** Fixture of ONE independently authoritative action already in its recovery phase.
 * Selection itself never installs this state and never resolves its hit/miss outcome. */
function priorAction(world: World, p: Person, selected: MartialSelection): MartialSelectionContext {
  const body = world.body(p.bodies[0])!, at = world.physicalTime, id = world.nextId('action');
  const ev = world.emit('combat_action', { actor: p.id, data: { phase: 'recovery', actorBodyId: body.id, actionId: id, techniqueId: selected.techniqueId } });
  body.combatAction = { id, actorBodyId: body.id, kind: 'attack', targetBodyId: null, weaponId: null, definition: selected.techniqueId,
    techniqueId: selected.techniqueId, transitionTechniqueId: selected.transitionTechniqueId, trajectory: 'mid', startedAt: at, startTick: 0,
    activeAt: at + 0.2, recoveryAt: at + 0.4, completeAt: at + 1.2, phase: 'recovery', outcome: 'miss', facing: 0, initialFacing: 0,
    trackingUntil: at, turnRate: 1, turnBudget: 1, reach: 1, radius: 0.2, impact: 4, exertionCost: 0.02, intent: 'injure',
    direction: v(0, 0, 1), distance: 0, appliedDistance: 0, eventId: ev.id };
  world.physicalTime = at + 0.5;
  return { bodyId: body.id, stance: selected.endStance, opportunity: { kind: 'chain', previousActionId: id,
    opensAt: at + 0.45, closesAt: at + 1.2, allowedInputs: inputs } };
}
function taught(world: World, p: Person, ids = [JAB, CROSS, KICK, JAB_CROSS, CROSS_KICK], mastery = 0.6) {
  for (const id of ids) seedMartialBackground(world, p, id, 0.6, mastery);
}
function runSession(world: World, p: Person, id: string, mode: string, partner?: Person) {
  const a: Action = { type: 'work', status: 'pending', targetEntity: partner?.id,
    data: { martial: mode, techniqueId: id, bodyId: p.bodies[0], partnerBodyId: partner?.bodies[0] } };
  p.mind.plan = [a]; p.mind.goal = { type: 'work', key: id, utility: 0.4, reasons: [], createdAt: world.now, data: a.data };
  actOnMartial(world, p, a, 1);
  for (let n = 0; n < 65 && a.status !== 'done' && a.status !== 'failed'; n++) { world.physicalTime++; world.clock.advance(1); actOnMartial(world, p, a, 1); }
  expect(a.status).toBe('done');
}

describe('innate motor actions and specific learned transition selection', () => {
  it('blank-knowledge Light → Light → Heavy selects crude punch → second punch → kick, one action at a time', () => {
    const { world, p } = fixture(); const before = structuredClone(p.knowledge), events = world.events.length;
    const first = selectMartialAction(world, p, 'Light', ready(world, p))!;
    expect(first.techniqueId).toBe('motor:basic-punch'); expect(world.events.length).toBe(events); expect(p.martial).toBeUndefined();
    const secondContext = priorAction(world, p, first), prior = structuredClone(world.body(p.bodies[0])!.combatAction);
    const second = selectMartialAction(world, p, 'Light', secondContext)!;
    expect(world.body(p.bodies[0])!.combatAction).toEqual(prior); expect(second.techniqueId).toBe('motor:second-punch');
    const third = selectMartialAction(world, p, 'Heavy', priorAction(world, p, second))!;
    expect(third.techniqueId).toBe('motor:crude-kick');
    for (const selected of [first, second, third]) {
      expect(selected.type).toBe('single-action'); expect(selected.availability).toBe('innate');
      expect(selected).not.toHaveProperty('actions'); expect(selected).not.toHaveProperty('outcome'); expect(selected).not.toHaveProperty('hit');
      expect(selected.transitionTechniqueId).toBeUndefined();
    }
    expect(p.knowledge).toEqual(before); expect(martialRepertoire(world, p, p.bodies[0])).toHaveLength(8);
  });

  it('the same inputs select jab → cross → low kick only with the specific known edges', () => {
    const { world, p } = fixture(); taught(world, p);
    const first = selectMartialAction(world, p, 'Light', ready(world, p))!; expect(first.techniqueId).toBe(JAB);
    const context = priorAction(world, p, first), edge = p.knowledge[martialKey(JAB_CROSS)];
    delete p.knowledge[martialKey(JAB_CROSS)];
    const unavailable = selectMartialAction(world, p, 'Light', context)!;
    expect(unavailable.availability).toBe('innate'); // Knowing both movements did not invent their connection.
    p.knowledge[martialKey(JAB_CROSS)] = edge;
    const second = selectMartialAction(world, p, 'Light', context)!;
    expect(second.techniqueId).toBe(CROSS); expect(second.transitionTechniqueId).toBe(JAB_CROSS);
    const third = selectMartialAction(world, p, 'Heavy', priorAction(world, p, second))!;
    expect(third.techniqueId).toBe(KICK); expect(third.transitionTechniqueId).toBe(CROSS_KICK);
    expect(third.transitionQuality).toBeGreaterThan(unavailable.transitionQuality);
  });

  it('never opens closed/early/blocked opportunities or shortens interruption recovery', () => {
    const { world, p } = fixture(); const first = selectMartialAction(world, p, 'Light', ready(world, p))!;
    const context = priorAction(world, p, first), previous = world.body(p.bodies[0])!.combatAction!;
    expect(selectMartialAction(world, p, 'Light', { ...context, opportunity: { ...context.opportunity, allowedInputs: ['Duck'] } })).toBeNull();
    expect(selectMartialAction(world, p, 'Light', { ...context, opportunity: { ...context.opportunity, closesAt: world.physicalTime - 0.1 } })).toBeNull();
    expect(selectMartialAction(world, p, 'Light', { ...context, opportunity: { ...context.opportunity, previousActionId: 'stale-action' } })).toBeNull();
    previous.phase = 'active'; expect(selectMartialAction(world, p, 'Heavy', context)).toBeNull();
    previous.phase = 'interrupted'; previous.outcome = 'interrupted'; expect(selectMartialAction(world, p, 'Heavy', context)).toBeNull();
    expect(selectMartialAction(world, p, 'Light', ready(world, p))).toBeNull();
    world.physicalTime = previous.completeAt;
    expect(selectMartialAction(world, p, 'Light', ready(world, p))!.type).toBe('single-action');
  });

  it('high physical attributes improve crude execution without granting learned moves or complexity tiers', () => {
    const { world, p } = fixture(); const plain = selectMartialAction(world, p, 'Light', ready(world, p))!;
    p.attributes = attributeProfile(20); p.skills = { unarmed: 1 } as Person['skills'];
    const strong = selectMartialAction(world, p, 'Light', ready(world, p))!;
    expect(strong.techniqueId).toBe('motor:basic-punch'); expect(strong.execution.forceCapacity).toBeGreaterThan(plain.execution.forceCapacity);
    expect(strong.execution.coordination).toBeGreaterThan(plain.execution.coordination); expect(p.knowledge).toEqual({});
    expect(canExecuteTechnique(world, p, 'unarmed:feint-counter')).toBe(false);
    taught(world, p, ['unarmed:hook']);
    expect(knowsTechnique(p, 'unarmed:hook')).toBe(true); expect(canExecuteTechnique(world, p, 'unarmed:feint-counter')).toBe(false);
  });

  it('a specific advanced branch also requires its own transition mastery', () => {
    const { world, p } = fixture(); taught(world, p);
    taught(world, p, ['unarmed:feint-counter', 'unarmed:cross-to-feint-counter'], 0);
    const cross = { ...selectMartialAction(world, p, 'Light', ready(world, p))!, techniqueId: CROSS, endStance: 'extended' as const };
    const context = priorAction(world, p, cross);
    expect(selectMartialAction(world, p, 'Heavy', context)!.techniqueId).toBe(KICK);
    seedMartialBackground(world, p, 'unarmed:cross-to-feint-counter', 0.6, 0.5);
    expect(selectMartialAction(world, p, 'Heavy', context)!.techniqueId).toBe('unarmed:feint-counter');
  });

  it('uses coarse canonical limbs, humanoid shape, selected body and stance; exposes basic evasions/cover/shove', () => {
    const { world, p } = fixture(); const body = world.body(p.bodies[0])!, context = ready(world, p);
    expect(selectMartialAction(world, p, 'Duck', context)!.motion).toBe('duck');
    expect(selectMartialAction(world, p, 'Dodge', context)!.motion).toBe('sidestep');
    expect(selectMartialAction(world, p, 'Dodge', { ...context, preferredMotion: 'backstep' })!.motion).toBe('backstep');
    expect(selectMartialAction(world, p, 'Light', { ...context, preferredMotion: 'cover' })!.motion).toBe('cover');
    expect(selectMartialAction(world, p, 'Heavy', { ...context, preferredMotion: 'shove' })!.motion).toBe('shove');
    expect(selectMartialAction(world, p, 'Heavy', ready(world, p, 'crouched'))).toBeNull();
    body.injuries = { arm: 0.95 }; expect(selectMartialAction(world, p, 'Light', context)).toBeNull();
    expect(selectMartialAction(world, p, 'Heavy', context)!.motion).toBe('kick');
    body.injuries.leg = 0.95; expect(selectMartialAction(world, p, 'Dodge', context)).toBeNull();
    body.injuries = {}; body.shape = 'wisp'; expect(selectMartialAction(world, p, 'Light', context)).toBeNull();
    const second = makeBody(world, p.id, v(11, 1, 10)); p.bodies.push(second.id);
    expect(selectMartialAction(world, p, 'Light', { ...context, bodyId: second.id })!.techniqueId).toBe('motor:basic-punch');
  });

  it('real innate practice spends effort and improves practical competence/family skill while knowledge stays empty', () => {
    const { world, p } = fixture(); const energy = p.physiology.energy;
    runSession(world, p, 'motor:basic-punch', 'practice');
    expect(p.physiology.energy).toBeLessThan(energy); expect(masteryOf(p, 'motor:basic-punch')).toBeGreaterThan(0); expect(skillOf(p, 'unarmed')).toBeGreaterThan(0);
    expect(p.knowledge).toEqual({}); expect(knowsTechnique(p, 'motor:basic-punch')).toBe(false);
    expect(canExecuteTechnique(world, p, 'unarmed:jab')).toBe(false); expect(canExecuteTechnique(world, p, 'unarmed:feint-counter')).toBe(false);
    const loaded = deserializeMartial(serializeMartial(world))!.world, restored = loaded.person(p.id)!;
    expect(restored.knowledge).toEqual({}); expect(restored.martial).toEqual(p.martial); expect(restored.skills).toEqual(p.skills);
  });

  it('specific transition instruction/manuals give understanding, then practice builds separate edge mastery', () => {
    const tw = fixture(), { world, p: teacher, sim } = tw;
    const student = addPerson(tw, 'Student', 'farmer', v(11, 1, 10)), reader = addPerson(tw, 'Reader', 'farmer', v(12, 1, 10));
    taught(world, teacher); taught(world, student, [JAB, CROSS], 0); taught(world, reader, [JAB, CROSS], 0);
    runSession(world, teacher, JAB_CROSS, 'lesson', student);
    expect(knowsTechnique(student, JAB_CROSS)).toBe(true); expect(masteryOf(student, JAB_CROSS)).toBe(0);
    expect(techniqueKnowledge(student, JAB_CROSS)!.claim.transition).toMatchObject({ from: JAB, to: CROSS });
    runSession(world, student, JAB_CROSS, 'practice'); expect(masteryOf(student, JAB_CROSS)).toBeGreaterThan(0);
    const place = world.place(tw.places.square)!; place.ownerId = teacher.id;
    for (const q of [teacher, reader]) { world.body(q.bodies[0])!.pos = { ...place.inside }; teachNotation(world, q); }
    addPlaceStock(world, 'plank', 2, place.id, teacher.id, undefined, 'transition manual substrate');
    const write: Action = { type: 'write_record', status: 'pending', placeId: place.id, data: { key: martialKey(JAB_CROSS) } };
    for (let n = 0; n < 60 && write.status !== 'done'; n++) actOnRecord(world, teacher, write, 1);
    expect(write.status).toBe('done'); const manual = world.items().find(i => i.record)!; sim.takeItem(reader, manual, 'theft');
    const read: Action = { type: 'read_record', status: 'pending', data: { recordId: manual.id } };
    for (let n = 0; n < 30 && read.status !== 'done'; n++) actOnRecord(world, reader, read, 1);
    expect(read.status).toBe('done'); expect(knowsTechnique(reader, JAB_CROSS)).toBe(true); expect(masteryOf(reader, JAB_CROSS)).toBe(0);
    expect(techniqueKnowledge(reader, JAB_CROSS)!.source.from).toBe(manual.id);
  });

  it('retains learned semantics for old v1 discoveries missing the additive availability/selection fields', () => {
    const { world, p } = fixture(); taught(world, p, ['unarmed:straight-punch']);
    runSession(world, p, 'unarmed:straight-punch', 'experiment');
    const data = JSON.parse(serializeMartial(world)), definition = Object.values<any>(data.martialLearning.definitions)[0];
    delete definition.availability; delete definition.selection; delete definition.transition;
    const loaded = deserializeMartial(JSON.stringify(data))!.world, restored = loaded.person(p.id)!;
    expect(canExecuteTechnique(loaded, restored, definition.techniqueId)).toBe(true);
    delete restored.knowledge[martialKey(definition.techniqueId)];
    expect(canExecuteTechnique(loaded, restored, definition.techniqueId)).toBe(false); // Missing metadata never means innate.
    expect(() => seedMartialBackground(loaded, restored, 'motor:basic-punch', 0, 0)).toThrow('must not be seeded');
  });
});
