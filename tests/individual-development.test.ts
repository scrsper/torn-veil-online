import { describe, it, expect } from 'vitest';
import { ATTRIBUTE_IDS, attributeProfile, generatedHuman, inheritedInteger, ironEligible, individualRng, physicalAttribute } from '../src/sim/core/human';
import { RNG } from '../src/sim/core/rng';
import { develop, developmentRate, developThroughUnderstanding } from '../src/sim/core/development';
import { practiceSkill } from '../src/sim/core/skills';
import { getPhysicalCapability } from '../src/sim/core/attributes';
import { recoveryMultiplier } from '../src/sim/core/human';
import { stepPhysiology } from '../src/sim/core/physiology';
import { giveBirth, stepDemographics } from '../src/sim/world/demographics';
import { createTestWorld, addPerson, v } from './helpers/world';
import type { Person } from '../src/sim/core/types';

function person(tw = createTestWorld()) {
  const p = addPerson(tw, 'A person', 'villager', v(12, 1, 12));
  p.attributes = attributeProfile(8); p.attributePotential = attributeProfile(10);
  p.physiology.energy = p.physiology.hydration = 1; p.physiology.fatigue = p.physiology.sleepDebt = 0;
  return { tw, p };
}
function birth(tw: ReturnType<typeof createTestWorld>, a: Person, b: Person) {
  a.physiology.pregnancy = { gestationalParentId: a.id, otherParentId: b.id, conceivedAt: tw.world.now - 280 * 86400, dueAt: tw.world.now, state: 'gestating', lastProgressAt: tw.world.now };
  return giveBirth(tw.world, a)!;
}

describe('ordinary human foundations', () => {
  it('generates seven integer attributes centered on 8, with independent potential and no traits coupling', () => {
    const profiles = Array.from({ length: 1000 }, (_, i) => generatedHuman(71, String(i), 30));
    for (const id of ATTRIBUTE_IDS) {
      expect(profiles.every(p => Number.isInteger(p.attributes[id]) && Number.isInteger(p.potential[id]))).toBe(true);
      expect(profiles.reduce((n, p) => n + p.attributes[id], 0) / profiles.length).toBeCloseTo(8, 0);
      expect(new Set(profiles.map(p => p.attributes[id])).size).toBeGreaterThan(1);
    }
    expect(physicalAttribute(8)).toBe(0.5);
    const { tw, p } = person();
    expect(getPhysicalCapability(p, tw.world).safeCarryMassKg).toBe(38);
    const before = structuredClone(p.attributePotential); p.traits.curiosity = 0; p.traits.courage = 0; p.attributes.intellect = 19; p.attributes.will = 18;
    expect(p.attributePotential).toEqual(before); expect(p.traits.curiosity).toBe(0);
  });
  it('uses an unbiased, discrete triangular parental law with central combinations favored', () => {
    const rng = new RNG(153), counts = new Map<number, number>();
    for (let n = 0; n < 30000; n++) { const value = inheritedInteger(rng, 10, 6); counts.set(value, (counts.get(value) ?? 0) + 1); }
    expect([...counts.keys()].sort()).toEqual([6, 7, 8, 9, 10].sort());
    expect(counts.get(8)!).toBeGreaterThan(counts.get(6)! * 2.7);
    expect([...counts].reduce((n, [value, count]) => n + value * count, 0) / 30000).toBeCloseTo(8, 1);
    expect(inheritedInteger(rng, 8, 8)).toBe(8);
    expect(() => inheritedInteger(rng, 8.1, 10)).toThrow();
  });
  it('keeps sustained exertion, bodily recovery and age expression distinct', () => {
    const { tw, p: ordinary } = person(), enduring = person(tw).p;
    enduring.attributes.endurance = 18;
    stepPhysiology(tw.world, ordinary, 1, 'quarry'); stepPhysiology(tw.world, enduring, 1, 'quarry');
    expect(enduring.physiology.fatigue).toBeLessThan(ordinary.physiology.fatigue);
    const baseline = recoveryMultiplier(ordinary); ordinary.attributes.vitality = 18;
    expect(recoveryMultiplier(ordinary)).toBeGreaterThan(baseline);
    const child = person(tw).p; child.age = 5;
    const young = getPhysicalCapability(child, tw.world).effectiveStrength;
    child.age = 30; expect(getPhysicalCapability(child, tw.world).effectiveStrength).toBeGreaterThan(young);
    const adult = person(tw).p;
    expect(getPhysicalCapability(child, tw.world).effectiveStrength).toBe(getPhysicalCapability(adult, tw.world).effectiveStrength);
    expect(child.attributes).toEqual(attributeProfile(8));
  });
  it('births siblings deterministically from potential, independent of injuries, stats, skills and wealth', () => {
    function family(altered: boolean) {
      const { tw, p: a } = person(), b = person(tw).p;
      a.attributePotential = attributeProfile(6); b.attributePotential = attributeProfile(10);
      if (altered) { a.attributes = attributeProfile(20); a.physiology.fatigue = 1; a.skills.crafting = 1; a.wealth = 100000; tw.world.primaryBody(b.id)!.injuries = { arm: 0.8 }; }
      return Array.from({ length: 6 }, () => birth(tw, a, b)).map(c => ({ potential: c.attributePotential, lineage: c.lineage, parents: c.parentIds, knowledge: c.knowledge }));
    }
    const a = family(false); expect(a).toEqual(family(false)); expect(a).toEqual(family(true));
    expect(new Set(a.map(c => JSON.stringify(c.potential))).size).toBeGreaterThan(1);
    expect(a.every(c => Object.values(c.potential).every(n => Number.isInteger(n) && n >= 6 && n <= 10))).toBe(true);
    expect(a.every(c => Object.keys(c.knowledge).length === 0)).toBe(true);
  });
  it('develops only from credited activity, with softer resistance for high potential and no hard potential cap', () => {
    const { tw, p: low } = person(), high = person(tw).p, idle = person(tw).p;
    high.attributePotential.strength = idle.attributePotential.strength = 18;
    idle.occupation = 'smith';
    for (let day = 0; day < 5000; day++) {
      tw.world.clock.worldSeconds += 86400;
      for (const p of [low, high]) develop(tw.world, p, { weights: { strength: 1 }, seconds: 8 * 3600, intensity: 1 });
    }
    expect(low.attributes.strength).toBeGreaterThan(low.attributePotential.strength);
    expect(high.attributes.strength).toBeGreaterThan(low.attributes.strength);
    expect(low.attributes.strength).toBeGreaterThan(idle.attributes.strength);
    expect(idle.attributes).toEqual(attributeProfile(8));
    expect(high.development.progress.strength).toBe(0); // reached Normal ceiling
    expect(developmentRate(11, 18)).toBeGreaterThan(developmentRate(11, 10));
    expect(developmentRate(15, 10)).toBeGreaterThan(0);
    expect(developmentRate(20, 18)).toBe(0);
    expect(tw.world.events.filter(e => e.type === 'attribute_developed').length).toBeLessThan(10);
  });
  it('preserves fractional progress and enforces Normal 20 without automatically becoming Iron', () => {
    const { tw, p } = person(); p.attributes.strength = 20;
    develop(tw.world, p, { weights: { strength: 1, dexterity: 1 }, seconds: 3600, intensity: 1 });
    expect(p.attributes.strength).toBe(20); expect(p.development.progress.strength).toBe(0);
    expect(p.development.progress.dexterity).toBeGreaterThan(0); expect(ironEligible(p)).toBe(false);
    for (const id of ATTRIBUTE_IDS) { p.attributes = attributeProfile(15); p.attributes[id] = 14; expect(ironEligible(p)).toBe(false); }
    p.attributes = attributeProfile(15); expect(ironEligible(p)).toBe(true); expect(p.ontology.stage).toBe('Normal');
  });
  it('does not convert idle years, empty practice, repeated facts or injuries into progress', () => {
    const { tw, p } = person(); const before = structuredClone(p.development);
    practiceSkill(p, 'crafting', 0, tw.world); developThroughUnderstanding(tw.world, p, 'trivial', 1, 3600);
    expect(p.development).toEqual(before);
    tw.world.clock.worldSeconds += 86400; stepDemographics(tw.world); expect(p.attributes).toEqual(attributeProfile(8));
    developThroughUnderstanding(tw.world, p, 'complex', 4, 30);
    const progress = p.development.progress.intellect;
    for (let i = 0; i < 100; i++) developThroughUnderstanding(tw.world, p, 'complex', 4, 30);
    expect(p.development.progress.intellect).toBe(progress);
    tw.world.primaryBody(p.id)!.health = 10;
    develop(tw.world, p, { weights: { vitality: 1 }, seconds: 3600, intensity: 1 });
    expect(p.development.progress.vitality).toBe(0);
    expect(p.lineage.imprints).toHaveLength(0);
  });
  it('requires years of sustained exceptional practice before a rare imprint assessment', () => {
    // Select a disclosed favorable seed, never change the one-shot probability or person's name.
    const id = person().p.id;
    const seed = Array.from({ length: 100 }, (_, i) => i).find(n => individualRng(n, `${id}:strength:imprint`).next() < 0.08)!;
    const { tw, p } = person(createTestWorld(seed)); p.attributes.strength = 16;
    p.attributePotential.strength = 12;
    develop(tw.world, p, { weights: { strength: 1 }, seconds: 28800, intensity: 1 });
    expect(p.lineage.imprints).toHaveLength(0);
    for (let day = 0; day < 4000; day++) { tw.world.clock.worldSeconds += 86400; develop(tw.world, p, { weights: { strength: 1 }, seconds: 28800, intensity: 1 }); }
    expect(p.lineage.imprints).toHaveLength(1);
    const i = p.lineage.imprints[0]; expect(i.magnitude).toBe(2); expect(i.originPersonId).toBe(p.id);
    expect(tw.world.event(i.originatingEventId)!.causes).toContain(p.development.exceptional.strength!.qualificationEventId);
    for (let day = 0; day < 500; day++) { tw.world.clock.worldSeconds += 86400; develop(tw.world, p, { weights: { strength: 1 }, seconds: 28800, intensity: 1 }); }
    expect(p.lineage.imprints).toHaveLength(1);
  });
});
