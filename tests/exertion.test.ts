import { describe, expect, it } from 'vitest';
import { RealmSession } from '../src/sim/world/realms/session';
import { advanceExertion, canSpendExertion, spendExertion, validSavedExertion } from '../src/sim/physical/exertion';
import { deserialize } from '../src/sim/persist/save';
import { getPhysicalCapability } from '../src/sim/core/attributes';

describe('shared short exertion and lasting physical work', () => {
  it('charges a brief burst and real cumulative costs identically for controlled and autonomous bodies', () => {
    const s = new RealmSession(), p = s.person, b = s.body, other = s.world.persons().find(q => q.id !== p.id)!, ob = s.world.primaryBody(other.id)!;
    other.physiology = structuredClone(p.physiology);
    const before = structuredClone(p.physiology), receipt = spendExertion(s.world, p, b, .03);
    spendExertion(s.world, other, ob, .03);
    expect(b.exertion?.load).toBeCloseTo(.15); expect(ob.exertion).toEqual(b.exertion);
    expect(other.physiology).toEqual(p.physiology);
    expect(p.physiology.fatigue).toBeGreaterThan(before.fatigue); expect(p.physiology.fatigue - before.fatigue).toBeLessThan(.001);
    expect(p.physiology.energy).toBeLessThan(before.energy); expect(p.physiology.hydration).toBeLessThan(before.hydration);
    expect(receipt.effortSeconds).toBe(3);
  });
  it('brief disengagement restores effort without erasing fatigue, injury, damage or spent food/water', () => {
    const s = new RealmSession(); s.body.injuries = { arm: .4 }; s.body.health = 41;
    spendExertion(s.world, s.person, s.body, .19); const after = structuredClone(s.person.physiology);
    expect(canSpendExertion(s.person, s.body, .03)).toBe(false);
    const exhausted = getPhysicalCapability(s.person, s.world).currentExertionCapacity;
    s.world.physicalTime += 12; advanceExertion(s.world);
    expect(canSpendExertion(s.person, s.body, .03)).toBe(true); expect(s.body.exertion?.load).toBe(0);
    expect(s.person.physiology).toEqual(after); expect(s.body.health).toBe(41); expect(s.body.injuries).toEqual({ arm: .4 });
    expect(getPhysicalCapability(s.person, s.world).currentExertionCapacity).toBeGreaterThan(exhausted);
    s.person.physiology.fatigue = .98; expect(canSpendExertion(s.person, s.body, .03)).toBe(false);
  });
  it('respects recovery delay and cannot refill from reload or duplicate scheduler visits', () => {
    let s = new RealmSession(); spendExertion(s.world, s.person, s.body, .1);
    const saved = s.save(); s = new RealmSession(0, saved); expect(s.body.exertion?.load).toBe(.5);
    s.world.physicalTime = .5; advanceExertion(s.world); expect(s.body.exertion?.load).toBe(.5);
    s.world.physicalTime = 2; advanceExertion(s.world); const load = s.body.exertion!.load;
    expect(load).toBeLessThan(.5); advanceExertion(s.world); expect(s.body.exertion?.load).toBe(load);
    const restored = new RealmSession(0, s.save()); advanceExertion(restored.world); expect(restored.body.exertion?.load).toBe(load);
    const raw = JSON.parse(saved); raw.bodies.find((b: { id: string }) => b.id === s.body.id).exertion.load = -1;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
    expect(validSavedExertion({ version: 1, load: .5, updatedAt: 10, lastSpentAt: 0 }, 2, 30)).toBe(false);
    expect(validSavedExertion({ version: 1, load: .5, updatedAt: 0, lastSpentAt: 0 }, 0, 29)).toBe(false);
  });
});
