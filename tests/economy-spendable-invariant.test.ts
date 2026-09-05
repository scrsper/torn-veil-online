import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem } from '../src/sim/world/factory';
import type { RNG } from '../src/sim/core/rng';

/** Forces a specific compliance/take outcome deterministically (same pattern as robbery.test.ts). */
class FixedRNG {
  constructor(private valueOf: number) {}
  next(): number { return this.valueOf; }
  range(a: number, b: number): number { return a + (b - a) * this.valueOf; }
  int(a: number, b: number): number { return Math.floor(this.range(a, b + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.valueOf * arr.length))]; }
  chance(p: number): boolean { return this.valueOf < p; }
  shuffle<T>(arr: T[]): T[] { return arr; }
  fork(): RNG { return this as unknown as RNG; }
}

describe('P0-B: robbing a victim who carries no physical coins transfers spendable wealth directly', () => {
  it('does not mint an inert coins item, and total wealth is exactly conserved', () => {
    const tw = createTestWorld(720, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.8 } });
    bandit.hostile = true; bandit.wealth = 0;
    const villager = addPerson(tw, 'Villager', 'farmer', v(11, 1, 10), { traits: { courage: 0.1, aggression: 0.1 } });
    villager.wealth = 40; // no coins ITEM carried — selectRobberyTake must fall to the 'wealth' branch
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG; // force compliance, skip the fight

    const coinItemCountBefore = tw.world.items().filter(i => i.type === 'coins').length;
    const totalWealthBefore = bandit.wealth + villager.wealth;

    let robbed = false;
    for (let i = 0; i < 160 && !robbed; i++) {
      step(tw, 0.25);
      if (tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id)) robbed = true;
    }
    expect(robbed).toBe(true);

    // The core structural fix: no new coins Item was created by this robbery.
    const coinItemCountAfter = tw.world.items().filter(i => i.type === 'coins').length;
    expect(coinItemCountAfter).toBe(coinItemCountBefore);

    // Wealth moved, spendably, from victim to bandit — not into an inert item.
    expect(bandit.wealth).toBeGreaterThan(0);
    expect(villager.wealth).toBeLessThan(40);
    expect(bandit.wealth + villager.wealth).toBeCloseTo(totalWealthBefore, 5);

    const theftEvent = tw.world.events.find(e => e.type === 'theft' && e.actor === bandit.id)!;
    expect(theftEvent.data.wealth).toBe(true);
    expect(theftEvent.data.amount).toBe(bandit.wealth);
    expect(theftEvent.item).toBeUndefined(); // no item backs a pure wealth transfer
  });

  it('a stolen coin ITEM (e.g. from the player) is banked into the non-player robber\'s wealth, not left as an inert stack', () => {
    const tw = createTestWorld(721, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.8 } });
    bandit.hostile = true; bandit.wealth = 0;
    const victim = addPerson(tw, 'Traveler', 'traveler', v(11, 1, 10), { traits: { courage: 0.1, aggression: 0.1 } });
    const coins = makeItem(tw.world, 'coins', 'silver coins', { owner: victim.id, holder: victim.id, quantity: 25 });
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG;

    let robbed = false;
    for (let i = 0; i < 160 && !robbed; i++) {
      step(tw, 0.25);
      if (tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id)) robbed = true;
    }
    expect(robbed).toBe(true);
    expect(bandit.wealth).toBeGreaterThanOrEqual(25);
    expect(bandit.inventory).not.toContain(coins.id);
    expect(coins.quantity).toBe(0);
  });
});
