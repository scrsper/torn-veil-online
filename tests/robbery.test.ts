import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem } from '../src/sim/world/factory';
import { resolveRobberyCompliance, selectRobberyTake } from '../src/sim/mind/robbery';
import type { RNG } from '../src/sim/core/rng';

/** Deterministic stand-in for World.rng: every draw returns the same fixed value, so a test can
 * force a specific compliance/take outcome instead of hunting for a lucky seed. Implements the
 * full RNG surface (not just next()) so unrelated code paths that also draw from world.rng
 * during a step() don't crash. */
class FixedRNG {
  constructor(private v: number) {}
  next(): number { return this.v; }
  range(a: number, b: number): number { return a + (b - a) * this.v; }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.v * arr.length))]; }
  chance(p: number): boolean { return this.v < p; }
  shuffle<T>(arr: T[]): T[] { return arr; }
  fork(_salt: number): RNG { return this as unknown as RNG; }
}

describe('robbery decision logic (pure functions, mind/robbery.ts)', () => {
  it('a low-courage, unarmed, healthy, non-guard victim complies far more often than a courageous armed defender', () => {
    const tw = createTestWorld(300);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(5, 1, 5), { traits: { aggression: 0.5 } });
    const coward = addPerson(tw, 'Coward', 'farmer', v(6, 1, 5), { traits: { courage: 0, aggression: 0 } });
    const brave = addPerson(tw, 'Brave Guard', 'guard', v(7, 1, 5), { traits: { courage: 1, aggression: 1 } });
    makeItem(tw.world, 'sword', 'a sword', { owner: brave.id, holder: brave.id });
    let cowardCompliant = 0, braveCompliant = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      if (resolveRobberyCompliance(tw.world, coward, bandit)) cowardCompliant++;
      if (resolveRobberyCompliance(tw.world, brave, bandit)) braveCompliant++;
    }
    expect(cowardCompliant).toBeGreaterThan(N * 0.6);
    expect(braveCompliant).toBeLessThan(N * 0.2);
  });

  it('selects an existing coin item over abstract wealth, and abstract wealth over another valuable', () => {
    const tw = createTestWorld(301);
    const withCoins = addPerson(tw, 'Withcoins', 'farmer', v(5, 1, 5));
    const coins = makeItem(tw.world, 'coins', 'silver coins', { owner: withCoins.id, holder: withCoins.id, quantity: 12 });
    const takeCoins = selectRobberyTake(tw.world, withCoins);
    expect(takeCoins).not.toBeNull();
    expect(takeCoins!.kind).toBe('coins');
    if (takeCoins!.kind === 'coins') expect(takeCoins!.item.id).toBe(coins.id);

    const withWealthOnly = addPerson(tw, 'Withwealth', 'farmer', v(6, 1, 5));
    withWealthOnly.wealth = 30;
    const takeWealth = selectRobberyTake(tw.world, withWealthOnly);
    expect(takeWealth).not.toBeNull();
    expect(takeWealth!.kind).toBe('wealth');
    if (takeWealth!.kind === 'wealth') { expect(takeWealth!.amount).toBeGreaterThan(0); expect(takeWealth!.amount).toBeLessThanOrEqual(30); }

    const withRingOnly = addPerson(tw, 'Withring', 'farmer', v(7, 1, 5));
    withRingOnly.wealth = 0;
    const ring = makeItem(tw.world, 'ring', 'a ring', { owner: withRingOnly.id, holder: withRingOnly.id, value: 80 });
    const takeItem = selectRobberyTake(tw.world, withRingOnly);
    expect(takeItem).not.toBeNull();
    expect(takeItem!.kind).toBe('item');
    if (takeItem!.kind === 'item') expect(takeItem!.item.id).toBe(ring.id);
  });

  it('returns null when the target genuinely has nothing worth taking', () => {
    const tw = createTestWorld(302);
    const pauper = addPerson(tw, 'Pauper', 'farmer', v(5, 1, 5));
    pauper.wealth = 0;
    expect(selectRobberyTake(tw.world, pauper)).toBeNull();
  });
});

describe('robbery causal loop (Priority 1 stabilization)', () => {
  function setupBanditAndVictim(seed: number, victimTraits: Partial<{ courage: number; aggression: number }> = {}) {
    const tw = createTestWorld(seed, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.8 } });
    bandit.hostile = true; bandit.wealth = 0;
    const villager = addPerson(tw, 'Villager', 'farmer', v(11, 1, 10), { traits: { courage: 0.1, aggression: 0.1, ...victimTraits } });
    return { tw, bandit, villager };
  }

  it('a robbery goal has an explicit semantic goal type distinct from generic attack', () => {
    const { tw, bandit } = setupBanditAndVictim(310);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG; // force compliance so the fight step is skipped
    let goal: string | undefined;
    for (let i = 0; i < 80 && !goal; i++) {
      step(tw, 0.25);
      if (bandit.mind.goal?.type === 'rob') goal = bandit.mind.goal.type;
    }
    expect(goal).toBe('rob');
  });

  it('voluntary compliance: an intimidated victim hands over valuables without ever being downed', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(311);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG; // resistWill for this coward is well under 0.99
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 20 });
    const vb = tw.world.primaryBody(villager.id)!;
    let robbed = false;
    for (let i = 0; i < 160 && !robbed; i++) {
      step(tw, 0.25);
      if (tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id)) robbed = true;
      expect(vb.pose).not.toBe('downed'); // compliance path must never require force
    }
    expect(robbed).toBe(true);
    expect(bandit.inventory.length).toBeGreaterThan(0);
  });

  it('resisted robbery: a defiant, armed target is subdued (not automatically killed) before anything is taken', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(312, { courage: 1, aggression: 1 });
    tw.world.rng = new FixedRNG(0.0) as unknown as RNG; // resistWill > 0 for this target, so 0 >= resistWill is false: resistant
    // v0.2.3: the bandit is armed so it can actually overpower a defiant target — a robber that
    // is simply outmatched now (correctly) breaks off or yields rather than looping forever.
    makeItem(tw.world, 'sword', 'a notched sword', { owner: bandit.id, holder: bandit.id, damage: 26 });
    makeItem(tw.world, 'dagger', 'a dagger', { owner: villager.id, holder: villager.id, damage: 14 });
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 15 });
    const vb = tw.world.primaryBody(villager.id)!;
    let wasDowned = false;
    let theftEvent = null as null | { actor?: string };
    for (let i = 0; i < 200 && !theftEvent; i++) {
      step(tw, 0.25);
      if (vb.pose === 'downed') wasDowned = true;
      const t = tw.world.events.find(e => e.type === 'theft' && e.actor === bandit.id);
      if (t) theftEvent = t;
    }
    expect(wasDowned).toBe(true); // resistance was actually met with force
    expect(vb.dead).toBe(false); // Constitution §11: robbery intent must not be automatically lethal
    expect(villager.alive).toBe(true);
    expect(theftEvent).not.toBeNull(); // and the robbery still completed afterward
  });

  it('actually transfers valuables through canonical item APIs, with provenance', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(313);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG;
    const coins = makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 20 });
    for (let i = 0; i < 160 && coins.holderId !== bandit.id; i++) step(tw, 0.25);
    expect(coins.holderId).toBe(bandit.id);
    expect(bandit.inventory).toContain(coins.id);
    expect(villager.inventory).not.toContain(coins.id);
    const lastProvenance = coins.provenance[coins.provenance.length - 1];
    expect(lastProvenance.how).toBe('stolen');
    expect(lastProvenance.from).toBe(villager.id);
    expect(lastProvenance.to).toBe(bandit.id);
    expect(lastProvenance.eventId).toBeTruthy();
  });

  it('robbery goal completes (goal_completed) rather than persisting indefinitely', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(314);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG;
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 10 });
    let completed = false;
    for (let i = 0; i < 200 && !completed; i++) {
      step(tw, 0.25);
      if (tw.world.events.some(e => e.type === 'goal_completed' && e.actor === bandit.id && e.summary.includes('rob'))) completed = true;
    }
    expect(completed).toBe(true);
  });

  it('disengages (retreats) after a successful robbery instead of lingering on the victim', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(315);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG;
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 10 });
    const bb = tw.world.primaryBody(bandit.id)!; const vb = tw.world.primaryBody(villager.id)!;
    let robbedAt = -1;
    for (let i = 0; i < 200; i++) {
      step(tw, 0.25);
      if (robbedAt < 0 && tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id)) robbedAt = i;
      if (robbedAt >= 0 && i > robbedAt + 60) break;
    }
    expect(robbedAt).toBeGreaterThanOrEqual(0);
    const dx = bb.pos.x - vb.pos.x, dz = bb.pos.z - vb.pos.z;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(4); // moved away rather than standing over the victim
  });

  it('does not repeatedly re-attack a downed/recovering robbery victim', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(316, { courage: 0.9, aggression: 0.7 });
    tw.world.rng = new FixedRNG(0.0) as unknown as RNG; // force the resistance path so the victim is actually downed
    makeItem(tw.world, 'sword', 'a notched sword', { owner: bandit.id, holder: bandit.id, damage: 26 });
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 10 });
    // Run well past the ~45s downed-recovery window so the victim stands back up while still
    // within the bandit's perception range, which is exactly the scenario the old code looped on.
    step(tw, 90);
    const attacksOnVictim = tw.world.events.filter(e => e.type === 'attack' && e.actor === bandit.id && e.target === villager.id);
    // A single robbery may land a couple of hits while subduing, but must not keep re-engaging
    // once the target has been downed and the robbery has completed.
    const theftHappened = tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id);
    expect(theftHappened).toBe(true);
    const attacksAfterTheft = (() => {
      const theftTick = tw.world.events.find(e => e.type === 'theft' && e.actor === bandit.id)!.tick;
      return attacksOnVictim.filter(e => e.tick > theftTick + 1).length;
    })();
    expect(attacksAfterTheft).toBe(0);
  });

  it('flees from materially superior opposition (nearby guard backup) instead of engaging', () => {
    const tw = createTestWorld(317, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.5, aggression: 0.5 } });
    bandit.hostile = true; bandit.wealth = 0;
    const villager = addPerson(tw, 'Villager', 'farmer', v(11, 1, 10), { traits: { courage: 0.3 } });
    // Two armed guards standing right beside the intended victim: overwhelming, visible backup.
    const g1 = addPerson(tw, 'Guard One', 'guard', v(11.5, 1, 10.5));
    const g2 = addPerson(tw, 'Guard Two', 'guard', v(10.5, 1, 10.5));
    makeItem(tw.world, 'sword', 'a sword', { owner: g1.id, holder: g1.id });
    makeItem(tw.world, 'sword', 'a sword', { owner: g2.id, holder: g2.id });
    let sawFlee = false; let robbedVillager = false;
    for (let i = 0; i < 120; i++) {
      step(tw, 0.25);
      if (bandit.mind.goal?.type === 'flee') sawFlee = true;
      if (tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id && e.target === villager.id)) robbedVillager = true;
    }
    expect(sawFlee).toBe(true);
    expect(robbedVillager).toBe(false);
  });

  it('witnesses perceive only what they legitimately perceive, and the victim\'s knowledge carries real provenance back to the theft event', () => {
    const { tw, bandit, villager } = setupBanditAndVictim(318);
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG;
    // A distant, unrelated bystander far outside perception range should learn nothing directly.
    const bystander = addPerson(tw, 'Distant Bystander', 'farmer', v(29, 1, 29));
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 10 });
    for (let i = 0; i < 160 && !tw.world.events.some(e => e.type === 'theft'); i++) step(tw, 0.25);
    const theftEvent = tw.world.events.find(e => e.type === 'theft' && e.actor === bandit.id)!;
    expect(theftEvent).toBeTruthy();
    const victimKnowledge = Object.values(villager.knowledge).find(k => k.kind === 'event' && k.claim.type === 'theft');
    expect(victimKnowledge).toBeTruthy();
    expect(victimKnowledge!.source.type).toBe('witnessed');
    expect(victimKnowledge!.confidence).toBe(1);
    expect(victimKnowledge!.source.viaEvent).toBeTruthy();
    const bystanderKnowledge = Object.values(bystander.knowledge).find(k => k.kind === 'event' && k.claim.type === 'theft');
    expect(bystanderKnowledge).toBeUndefined();
  });
});
