import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { restockTavern, buyFoodPortion, ALE_RESTOCK_TRIGGER } from '../src/sim/world/metabolism';
import { ITEM_VALUE } from '../src/sim/world/factory';
import { stockAt } from '../src/sim/world/stock';

/**
 * v0.7 follow-up (corrected): the tavern's ale restock must be a STRUCTURAL invariant — bounded
 * regardless of how long the village runs — not a margin tuned until a specific benchmark
 * window happens to look flat. Two earlier attempts (flat 1/unit, then `ITEM_VALUE.ale - 0.1`)
 * both charged a positive per-unit margin that, however small, compounds linearly with the
 * number of restock cycles. These tests prove the fix does not merely make that compounding
 * slow — it removes the compounding entirely, by construction, at any number of cycles.
 */
describe('ale supply cost — structural invariant (v0.7 follow-up, corrected)', () => {
  function runCycles(cycles: number): { innkeeper: ReturnType<typeof addPerson>; startingWealth: number } {
    const tw = createTestWorld(9001, 20);
    const innkeeper = addPerson(tw, 'Innkeeper', 'innkeeper', v(5, 1, 5), { workId: tw.places.tavern });
    const buyer = addPerson(tw, 'Buyer', 'farmer', v(5, 1, 5));
    buyer.wealth = 1_000_000; // never the affordability constraint in this test
    innkeeper.wealth = 500;
    const startingWealth = innkeeper.wealth;
    for (let i = 0; i < cycles; i++) {
      const restocked = restockTavern(tw.world, innkeeper);
      expect(restocked).toBe(true);
      // buy out every unit just restocked, one at a time, so the tavern always starts each
      // cycle genuinely empty (below ALE_RESTOCK_TRIGGER) — the worst case for any margin bug.
      let forSale = tw.world.items().find(i => i.type === 'ale' && i.placeId === tw.places.tavern && i.quantity > 0);
      while (forSale) {
        buyFoodPortion(tw.world, buyer, forSale, forSale.quantity);
        forSale = tw.world.items().find(i => i.type === 'ale' && i.placeId === tw.places.tavern && i.quantity > 0);
      }
      expect(stockAt(tw.world, 'ale', tw.places.tavern)).toBe(0);
    }
    return { innkeeper, startingWealth };
  }

  it('a single restock-then-sell-out cycle leaves the innkeeper\'s wealth exactly unchanged', () => {
    const { innkeeper, startingWealth } = runCycles(1);
    expect(innkeeper.wealth).toBeCloseTo(startingWealth, 6);
  });

  it('net wealth change stays exactly zero whether the cycle runs 5 times or 500 times — not merely small, not proportional to run length', () => {
    const short = runCycles(5);
    const long = runCycles(500);
    const shortDelta = short.innkeeper.wealth - short.startingWealth;
    const longDelta = long.innkeeper.wealth - long.startingWealth;
    // Both must be (numerically) zero. If a positive margin had crept back in, `longDelta`
    // would be roughly 100x `shortDelta` (500 cycles vs 5) — this is the exact failure mode
    // both earlier "fixes" had, just moved further out. Asserting both are zero, rather than
    // asserting one benchmark-scale number "looks small", is what makes this a structural test.
    expect(shortDelta).toBeCloseTo(0, 6);
    expect(longDelta).toBeCloseTo(0, 6);
  });

  it('the supply cost is exactly ale\'s flat retail price, not a tuned fraction of it', () => {
    // This is the actual mechanism: cost-per-unit-restocked === price-per-unit-sold, both
    // literally `ITEM_VALUE.ale`. Nothing here is calibrated to any benchmark outcome.
    const tw = createTestWorld(9002, 20);
    const innkeeper = addPerson(tw, 'Innkeeper', 'innkeeper', v(5, 1, 5), { workId: tw.places.tavern });
    innkeeper.wealth = 500;
    const before = innkeeper.wealth;
    restockTavern(tw.world, innkeeper);
    const spent = before - innkeeper.wealth;
    const qtyRestocked = stockAt(tw.world, 'ale', tw.places.tavern);
    expect(spent).toBeCloseTo(qtyRestocked * ITEM_VALUE.ale, 6);
  });

  it('unsold stock left at run-end is the ONLY source of drift, and it is bounded by the restock batch size — never by elapsed time', () => {
    const tw = createTestWorld(9003, 20);
    const innkeeper = addPerson(tw, 'Innkeeper', 'innkeeper', v(5, 1, 5), { workId: tw.places.tavern });
    innkeeper.wealth = 500;
    const startingWealth = innkeeper.wealth;
    // Restock repeatedly and never sell, until stock finally clears ALE_RESTOCK_TRIGGER — the
    // worst case for "leftover inventory" drift (every restocked unit sits unsold).
    while (restockTavern(tw.world, innkeeper)) { /* keep restocking until >= trigger */ }
    const qty = stockAt(tw.world, 'ale', tw.places.tavern);
    expect(qty).toBeGreaterThanOrEqual(ALE_RESTOCK_TRIGGER);
    const drift = startingWealth - innkeeper.wealth;
    // Drift equals exactly the value of what's sitting in stock, unsold — not a growing debt.
    expect(drift).toBeCloseTo(qty * ITEM_VALUE.ale, 6);
    // And restocking again now that stock is above trigger spends nothing further — the drift
    // does not compound just because more time/cycles pass once stock is adequate.
    const restockedAgain = restockTavern(tw.world, innkeeper);
    expect(restockedAgain).toBe(false);
    expect(startingWealth - innkeeper.wealth).toBeCloseTo(drift, 6);
  });
});
