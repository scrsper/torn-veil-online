import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v, step } from './helpers/world';
import { submitCombatInput, advanceCombat, captureCombatTransforms } from '../src/sim/physical/combatAction';
import { INTERACTION_SPEC as S } from '../src/sim/physical/prediction';
import { seedMartialBackground, masteryOf, knowsTechnique, techniqueKnowledge } from '../src/sim/mind/martialKnowledge';
import { submitTechniqueUse } from '../src/sim/mind/martialPractice';
import { serialize, deserialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { skillOf } from '../src/sim/core/skills';
import { attributeProfile } from '../src/sim/core/human';

const jab = 'unarmed:jab', cross = 'unarmed:cross', kick = 'unarmed:low-kick', edge = 'unarmed:jab-to-cross';
function fixture(profile: 'untrained' | 'partial' | 'trained' = 'untrained') {
  const x = createTestWorld(198); x.world.clock.timeScale = 1;
  const p = addPerson(x, 'Actor', 'farmer', v(10, 1, 10), { controlled: true });
  const t = addPerson(x, 'Partner', 'farmer', v(11.05, 1, 10), { controlled: true });
  p.knowledge = {}; p.skills = {}; p.attributes = attributeProfile(8);
  const b = x.world.primaryBody(p.id)!, tb = x.world.primaryBody(t.id)!; b.yaw = -Math.PI / 2; tb.yaw = Math.PI / 2;
  if (profile !== 'untrained') for (const id of [jab, cross, kick, ...(profile === 'trained' ? [edge, 'unarmed:cross-to-low-kick'] : [])]) seedMartialBackground(x.world, p, id, .6, .6);
  return { ...x, p, t, b, tb };
}
function tick(x: ReturnType<typeof fixture>, n: number) { for (let i = 0; i < n; i++) { x.world.physicalTime += S.stepSeconds; x.sim.step(S.stepSeconds, S.stepSeconds); } }
function chain(profile: 'untrained' | 'partial' | 'trained', edgeMastery = .6) {
  const x = fixture(profile); x.tb.pos.x = 30; if (profile === 'trained') x.p.martial!.mastery[edge].value = edgeMastery;
  expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
  const ids = [x.b.combatAction!.techniqueId];
  tick(x, 18); expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
  tick(x, 11); ids.push(x.b.combatAction!.techniqueId); expect(x.b.pose).toBe('attack');
  tick(x, 18); expect(submitCombatInput(x.world, x.b.id, { kind: 'attack', trajectory: 'low' })).toBe('accepted');
  tick(x, 11); ids.push(x.b.combatAction!.techniqueId);
  return { x, ids };
}
describe('realtime martial/combat integration (v0.2, label-only adapter)', () => {
  it.each([
    ['untrained', ['motor:basic-punch', 'motor:second-punch', 'motor:crude-kick']],
    ['partial', [jab, 'motor:basic-punch', 'motor:crude-kick']],
    ['trained', [jab, cross, kick]],
  ] as const)('%s labels the native repertoire\'s own move sequence without changing it', (profile, expected) => {
    const { x, ids } = chain(profile); expect(ids).toEqual(expected); expect(x.b.attackSeq).toBe(3);
    expect(x.tb.health).toBe(x.tb.maxHealth); // Labeling never manufactures contact.
    if (profile === 'untrained') expect(Object.values(x.p.knowledge).some(k => k.claim.martialTechnique)).toBe(false);
  });
  it('charges once at admission, learns from resolved execution, and rejects replay without cost or reward', () => {
    const x = fixture(); x.tb.pos.x = 30; const before = x.p.physiology.fatigue;
    expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
    const cost = x.b.combatAction!.exertionCost; expect(x.p.physiology.fatigue - before).toBeCloseTo(cost, 10);
    expect(masteryOf(x.p, 'motor:basic-punch')).toBe(0); tick(x, 47);
    const ev = x.world.event(x.b.combatAction!.learningEventId!)!;
    expect(ev.data.techniqueUse.techniqueId).toBe('motor:basic-punch'); expect(ev.data.phase).toBe('complete');
    expect(masteryOf(x.p, 'motor:basic-punch')).toBeGreaterThan(0); expect(skillOf(x.p, 'unarmed')).toBeGreaterThan(0);
    const state = structuredClone({ martial: x.p.martial, skills: x.p.skills, physiology: x.p.physiology });
    expect(submitTechniqueUse(x.world, x.p, ev.id)).toBe(0);
    expect({ martial: x.p.martial, skills: x.p.skills, physiology: x.p.physiology }).toEqual(state);
    expect(knowsTechnique(x.p, jab)).toBe(false);
  });
  it('credits a performed learned transition without charging or practicing the family twice', () => {
    const { x } = chain('trained', .1); expect(masteryOf(x.p, edge)).toBeGreaterThan(.1); expect(skillOf(x.p, 'unarmed')).toBe(.6);
    const events = x.world.events.filter(e => e.data.techniqueUse?.techniqueId === cross && e.data.techniqueUse?.effort !== undefined && e.actor === x.p.id);
    expect(events.length).toBeGreaterThan(0);
  });
  it('a hit against a live opponent is credited as fully responsive practice', () => {
    const x = fixture('trained'); // touching range: contact is expected
    expect(submitCombatInput(x.world, x.b.id, { kind: 'attack', targetBodyId: x.tb.id })).toBe('accepted');
    for (let i = 0; i < 40 && x.b.combatAction!.outcome === 'pending'; i++) {
      x.world.physicalTime += S.stepSeconds;
      advanceCombat(x.world, S.stepSeconds, captureCombatTransforms(x.world), () => null);
    }
    tick(x, 20);
    const ev = x.world.event(x.b.combatAction!.learningEventId!)!;
    expect(ev.data.responsiveTarget).toBe(x.b.combatAction!.outcome === 'hit');
  });
  it('normal save/load retains repertoire labeling, mastery and evidence replay ledger', () => {
    const base = fixture('trained'), initial = deserialize(serialize(base.world))!;
    const a = { ...base, world: initial.world, sim: new Simulation(initial.world), p: initial.world.person(base.p.id)!, t: initial.world.person(base.t.id)!, b: initial.world.body(base.b.id)!, tb: initial.world.body(base.tb.id)! };
    a.tb.pos.x = 30; submitCombatInput(a.world, a.b.id, { kind: 'attack' }); tick(a, 18);
    submitCombatInput(a.world, a.b.id, { kind: 'attack' });
    const loaded = deserialize(serialize(a.world))!; expect(loaded).not.toBeNull();
    const sim = new Simulation(loaded.world), p = loaded.world.person(a.p.id)!, body = loaded.world.body(a.b.id)!;
    for (let i = 0; i < 40; i++) { tick(a, 1); loaded.world.physicalTime += S.stepSeconds; sim.step(S.stepSeconds, S.stepSeconds); }
    expect(body.combatAction).toEqual(a.b.combatAction); expect(p.martial).toEqual(a.p.martial); expect(p.knowledge).toEqual(a.p.knowledge);
    const event = loaded.world.events.find(e => e.data.techniqueUse); expect(event).toBeDefined();
    expect(submitTechniqueUse(loaded.world, p, event!.id)).toBe(0);
  });
  it('observes resolved demonstrated movement through ordinary sight; input alone grants no knowledge', () => {
    const x = fixture('trained'); x.tb.health = x.tb.maxHealth = 10000; x.t.mind.thinkInterval = Infinity;
    const watch = addPerson(x, 'Observer', 'farmer', v(10, 1, 11), { controlled: true }); watch.attributes = attributeProfile(12); watch.knowledge = {};
    for (let i = 0; i < 6; i++) {
      expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
      if (i === 0) expect(techniqueKnowledge(watch, jab)).toBeUndefined();
      step(x, 1.1, S.stepSeconds);
    }
    expect(techniqueKnowledge(watch, jab)?.source.type).toBe('witnessed'); expect(masteryOf(watch, jab)).toBe(0);
    expect(x.world.events.some(e => e.data.martialDemonstration && e.perceivedBy.some(v => v.who === watch.id && v.how === 'saw'))).toBe(true);
  });
});
