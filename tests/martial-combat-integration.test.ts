import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v, step } from './helpers/world';
import { submitCombatInput, advanceCombat, captureCombatTransforms } from '../src/sim/physical/combatAction';
import { COMBAT_REPERTOIRE } from '../src/sim/physical/combatRepertoire';
import { INTERACTION_SPEC as S } from '../src/sim/physical/prediction';
import { seedMartialBackground, masteryOf, knowsTechnique, techniqueKnowledge } from '../src/sim/mind/martialKnowledge';
import { martialRepertoire } from '../src/sim/mind/martialSelection';
import { submitTechniqueUse } from '../src/sim/mind/martialPractice';
import { serialize, deserialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { skillOf } from '../src/sim/core/skills';
import { attributeProfile } from '../src/sim/core/human';

const jab = 'unarmed:jab', cross = 'unarmed:cross', kick = 'unarmed:low-kick', edge = 'unarmed:jab-to-cross';
const hook = 'unarmed:hook', feintCounter = 'unarmed:feint-counter', crossToFeint = 'unarmed:cross-to-feint-counter';
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
function chainOn(x: ReturnType<typeof fixture>) {
  x.tb.pos.x = 30;
  expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
  const ids = [x.b.combatAction!.techniqueId], moves = [x.b.combatAction!.moveId];
  tick(x, 18); expect(submitCombatInput(x.world, x.b.id, { kind: 'attack' })).toBe('accepted');
  tick(x, 11); ids.push(x.b.combatAction!.techniqueId); moves.push(x.b.combatAction!.moveId); expect(x.b.pose).toBe('attack');
  tick(x, 18); expect(submitCombatInput(x.world, x.b.id, { kind: 'attack', trajectory: 'low' })).toBe('accepted');
  tick(x, 11); ids.push(x.b.combatAction!.techniqueId); moves.push(x.b.combatAction!.moveId);
  return { ids, moves };
}
function chain(profile: 'untrained' | 'partial' | 'trained', edgeMastery = .6) {
  const x = fixture(profile); if (profile === 'trained') x.p.martial!.mastery[edge].value = edgeMastery;
  return { x, ...chainOn(x) };
}
describe('realtime martial/combat integration (v0.2, selection drives the actual move)', () => {
  it.each([
    // untrained: pure innate alternation — identical to native's own default combo.
    ['untrained', ['motor:basic-punch', 'motor:second-punch', 'motor:crude-kick'], ['jab', 'cross', 'front_kick']],
    // partial: knows jab/cross/kick individually but has NO mastered transition edge, so a
    // CHAINED follow-up cannot license the learned 'cross' (no edge = not a candidate) and
    // falls back to the innate alternation's own top-priority pick — which, since the
    // predecessor is the LEARNED 'unarmed:jab' rather than 'motor:basic-punch', does not
    // itself get the innate "alternate punches" bonus and lands on 'motor:basic-punch'
    // again. The visible consequence is exactly the point: the actual move sequence
    // regresses to a repeated jab (['jab','jab','front_kick']) instead of the smooth
    // jab-cross-kick a genuinely mastered chain gets — a real behavioral difference, not a
    // relabeling of an untouched pick.
    ['partial', [jab, 'motor:basic-punch', 'motor:crude-kick'], ['jab', 'jab', 'front_kick']],
    // trained: mastered jab-to-cross and cross-to-low-kick edges unlock the full chain.
    ['trained', [jab, cross, kick], ['jab', 'cross', 'front_kick']],
  ] as const)('%s: martial selection actually picks the technique, mapped onto the real move', (profile, expectedTechniques, expectedMoves) => {
    const { x, ids, moves } = chain(profile);
    expect(ids).toEqual(expectedTechniques); expect(x.b.attackSeq).toBe(3);
    // The physical adapter can map distinct techniques onto the SAME native move (no
    // separate "crude" asset exists yet — the documented acceptable shared-visual case),
    // but the actual SELECTED move sequence below is driven by, and can differ because of,
    // which technique the selector actually chose — not a label layered on an untouched pick.
    expect(moves).toEqual(expectedMoves);
    // Selection never manufactures or alters timing/geometry: the final resolved action's
    // active/recovery/complete timing is fully explained by its own moveId's repertoire
    // spec, unaffected by which technique (trained or not) selected that moveId.
    const finalAction = x.b.combatAction!, finalSpec = COMBAT_REPERTOIRE.moves[finalAction.moveId!];
    expect(finalAction.activeAt - finalAction.startedAt).toBeCloseTo(finalSpec.preparation, 10);
    expect(finalAction.recoveryAt - finalAction.activeAt).toBeCloseTo(finalSpec.active, 10);
    expect(finalAction.completeAt - finalAction.recoveryAt).toBeCloseTo(finalSpec.recovery, 10);
    expect(x.tb.health).toBe(x.tb.maxHealth); // Selection never manufactures contact.
    if (profile === 'untrained') expect(Object.values(x.p.knowledge).some(k => k.claim.martialTechnique)).toBe(false);
  });
  it('untrained cannot select a learned transition even when an identical edge exists in the registry', () => {
    // An untrained repertoire contains no learned techniques at all, so no edge (whose
    // destination is a learned technique) can ever be found for it — verified structurally,
    // not just by outcome, since martialRepertoire() is exactly the pool selection draws from.
    const x = fixture('untrained');
    const pool = martialRepertoire(x.world, x.p, x.b.id);
    expect(pool.every(d => d.availability === 'innate')).toBe(true);
    const { moves, ids } = chainOn(x);
    expect(ids).not.toContain(cross); expect(ids).not.toContain(jab);
    expect(moves).toEqual(['jab', 'cross', 'front_kick']); // shared asset, un-learned identity
  });
  it('knowing both technique endpoints without the transition edge is insufficient for a learned chain', () => {
    // partial() seeds jab, cross AND kick as real knowledge — deliberately NOT the edges.
    const { x, ids } = chain('partial');
    expect(knowsTechnique(x.p, jab)).toBe(true); expect(knowsTechnique(x.p, cross)).toBe(true);
    expect(ids[0]).toBe(jab); // a fresh (non-chained) attempt still finds the learned entry technique
    expect(ids[1]).not.toBe(cross); // but the CHAINED follow-up has no mastered edge to license 'cross'
    expect(ids[1]).toBe('motor:basic-punch'); // falls back to the shared innate primitive instead
  });
  it('a technique without an implemented physical move is never selected for live combat, only labeled/practiced dormant', () => {
    const x = fixture('trained');
    for (const id of [hook, feintCounter, crossToFeint]) seedMartialBackground(x.world, x.p, id, .9, .9);
    x.p.martial!.mastery[edge].value = .9;
    // Still fully present in the dormant martial repertoire (learnable/practicable/teachable).
    const pool = martialRepertoire(x.world, x.p, x.b.id);
    expect(pool.some(d => d.techniqueId === hook)).toBe(true);
    expect(pool.some(d => d.techniqueId === feintCounter)).toBe(true);
    // But never chosen for the live jab->cross->? chain: cross-to-feint-counter's destination
    // has no physical adapter, so it can never win as `d`, and selection falls back to the
    // next eligible (adapter-mapped) candidate — here, the ordinary jab-to-cross-to-low-kick
    // chain, exactly as an ordinary trained fighter without hook/feint-counter would get.
    const { ids, moves } = chainOn(x);
    expect(ids).toEqual([jab, cross, kick]); expect(moves).toEqual(['jab', 'cross', 'front_kick']);
    expect(ids).not.toContain(hook); expect(ids).not.toContain(feintCounter);
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
