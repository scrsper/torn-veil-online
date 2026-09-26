import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import { challengeFactor, deliberateResponse, develop, developThroughExertion, ironFoundationsFor, MAX_DAILY_EXPOSURE } from '../src/sim/core/development';
import { recordCapabilityPractice } from '../src/sim/core/capability';
import { assessAdvancement, advanceToIron } from '../src/sim/core/advancement';
import { attributeProfile, ironEligible } from '../src/sim/core/human';
import { learn } from '../src/sim/mind/knowledge';
import { meditateOnVeil, veilStrain } from '../src/sim/physical/veil';
import { techniqueKey } from '../src/sim/core/skills';
import { definitionClaim, learnTechnique } from '../src/sim/mind/martialKnowledge';
import { techniqueDefinition } from '../src/sim/core/martialDefinitions';

const DAY = 86400;
function person(seed = 951) {
  const tw = createTestWorld(seed, 24), p = addPerson(tw, 'Trainee', 'villager', v(12, 1, 12));
  p.attributes = attributeProfile(8); p.attributePotential = attributeProfile(10);
  return { tw, w: tw.world, p };
}
const nextDay = (w: ReturnType<typeof person>['w']) => { w.clock.worldSeconds += DAY; };

describe('Living Alpha progression calibration', () => {
  it('keeps every routine demand unchanged and bounds the deliberate response', () => {
    for (const demand of [undefined, Infinity, 0, 9.5, 10, 10.5, 11, 11.5, 12]) expect(deliberateResponse(demand)).toBe(1);
    expect(deliberateResponse(13)).toBe(4);
    expect(deliberateResponse(15.5)).toBe(11.5);
    expect(deliberateResponse(100)).toBe(12);
  });
  it('a body adapts to what challenges it: routine labour plateaus near its demand, harder practice goes on', () => {
    const { w, p } = person(), trained = person(952).p;
    for (let day = 0; day < 120; day++) {
      nextDay(w);
      developThroughExertion(w, p, 'haul', 8);
      develop(w, trained, { weights: { strength: 1 }, seconds: 8 * 3600, intensity: 0.4, challenge: 16 });
      p.physiology.fatigue = trained.physiology.fatigue = 0;
    }
    // Four months of hauling makes an ordinary person clearly stronger, then stops mattering.
    expect(p.attributes.strength).toBeGreaterThanOrEqual(10);
    expect(p.attributes.strength).toBeLessThanOrEqual(12);
    expect(trained.attributes.strength).toBeGreaterThan(p.attributes.strength + 2);
    expect(challengeFactor(8, 11)).toBeGreaterThan(0.999);
    expect(challengeFactor(12, 11)).toBeLessThan(0.003);
    expect(challengeFactor(12)).toBe(1);
  });

  it('meaningful early progress in a single session of deliberate practice', () => {
    const { w, p } = person();
    // One session: ~3 world hours of instructed, demanding practice for one foundation.
    develop(w, p, { weights: { dexterity: 0.8 }, seconds: 3 * 3600, intensity: 0.85, instruction: 1.3, challenge: 15.5 });
    expect(p.attributes.dexterity).toBeGreaterThanOrEqual(9);
  });

  it('each foundation has its own daily adaptation budget', () => {
    const { w, p } = person();
    nextDay(w);
    develop(w, p, { weights: { strength: 1 }, seconds: MAX_DAILY_EXPOSURE, intensity: 1 });
    const strength = p.development.exposure.strength;
    develop(w, p, { weights: { strength: 1 }, seconds: 3600, intensity: 1 });
    expect(p.development.exposure.strength).toBe(strength); // spent for today
    develop(w, p, { weights: { perception: 1 }, seconds: 3600, intensity: 1 });
    expect(p.development.exposure.perception).toBeGreaterThan(0); // a different system
  });

  it('Iron is anchored on a practiced path: its core foundations at 15, every other at least 11', () => {
    expect(ironFoundationsFor('unarmed')).toEqual(['dexterity', 'endurance']);
    expect(ironFoundationsFor('veilcraft')).toEqual(['will', 'perception']);
    expect(ironFoundationsFor('hunting')).toEqual(['perception', 'endurance', 'dexterity']);
    const { p } = person();
    p.attributes = { ...attributeProfile(11), dexterity: 15, endurance: 15 };
    expect(ironEligible(p, ironFoundationsFor('unarmed'))).toBe(true);
    expect(ironEligible(p)).toBe(false); // the strict all-round reading is still available
    p.attributes.will = 10;
    expect(ironEligible(p, ironFoundationsFor('unarmed'))).toBe(false);
  });

  it('a sparring path: evidence credited to both partners over three days permits a causal Iron transition', () => {
    const { tw, w, p } = person(953), partner = addPerson(tw, 'Partner', 'villager', v(13, 1, 12));
    p.attributes = { ...attributeProfile(11), dexterity: 15, endurance: 15 };
    const teacher = w.emit('work_taught', { actor: partner.id, target: p.id, data: { martial: 'lesson', phase: 'completed' } });
    // The shape a real martial lesson leaves (it names the technique's family, not a trade skill).
    expect(learnTechnique(w, p, definitionClaim(techniqueDefinition(w, 'unarmed:straight-punch')!, 0.7), 0.7, { type: 'told', from: partner.id, viaEvent: teacher.id })).toBeTruthy();
    (p.skills as Record<string, number>).unarmed = 0.6;
    let n = 0;
    for (let day = 0; day < 4; day++) {
      nextDay(w);
      for (let i = 0; i < 70; i++) {
        const e = w.emit('work_shift', { actor: partner.id, target: p.id, data: { martial: 'spar', phase: 'completed', techniqueId: `jab-${n++ % 8}`, family: 'unarmed', seconds: 60, effort: 0.9 } });
        expect(recordCapabilityPractice(w, p, { skill: 'unarmed', sourceEventId: e.id }).credited || i > 0).toBe(true);
        recordCapabilityPractice(w, partner, { skill: 'unarmed', sourceEventId: e.id });
        w.clock.worldSeconds += 60;
      }
    }
    expect(partner.capability?.bySkill.unarmed?.effectiveSeconds ?? 0).toBeGreaterThan(0);
    p.attributes = { ...attributeProfile(11), dexterity: 15, endurance: 15 }; // foundations fixed after practice side effects
    const a = assessAdvancement(w, p);
    expect(a.reasons).toEqual([]);
    expect(a.path).toEqual({ skill: 'unarmed', core: ['dexterity', 'endurance'] });
    expect(advanceToIron(w, p)).toBe(true);
    const ev = w.events.at(-1)!;
    expect(ev.type).toBe('ontological_advancement');
    expect(ev.data.path).toBe('unarmed');
    expect(ev.causes).toContain(teacher.id);
  });

  it('meditation develops will only as far as solitary discipline demands, eases strain, and is not evidence', () => {
    const { w, p } = person(954);
    const keeper = w.emit('work_taught', { actor: 'keeper', target: p.id, data: {} });
    learn(w, p, { key: techniqueKey('veilcraft'), kind: 'technique', claim: { skill: 'veilcraft' }, confidence: 0.8, source: { type: 'told', from: 'keeper', viaEvent: keeper.id } }, true);
    p.veil = { strain: 0.9, strainAt: w.physicalTime, lastAt: w.physicalTime };
    expect(meditateOnVeil(w, p)).toBe(true);
    expect(veilStrain(w, p)).toBeLessThan(0.75);
    for (let day = 0; day < 200; day++) { nextDay(w); for (let i = 0; i < 16; i++) meditateOnVeil(w, p); p.physiology.fatigue = 0; }
    expect(p.attributes.will).toBeGreaterThanOrEqual(12);
    expect(p.attributes.will).toBeLessThanOrEqual(14);
    expect(p.capability?.bySkill.veilcraft).toBeUndefined();
  });
});
