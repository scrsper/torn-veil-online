import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson } from './helpers/world';
import { restockTavern, buyFoodPortion, BREW_RATIO } from '../src/sim/world/metabolism';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { createFire, igniteFire } from '../src/sim/world/fire';
import { settleWholesale } from '../src/sim/world/trade';

/** The former import pass-through invariant is replaced by a material-backed supply chain.
 * Profit may circulate; there is no longer an external currency drain to offset a free restock. */
describe('ale supply — material and monetary conservation', () => {
  for (const cycles of [1, 5, 500]) it(`conserves all currency and consumes the exact grain input over ${cycles} batches`, () => {
    const tw = createTestWorld(9001, 20), { world } = tw, tavern = world.place(tw.places.tavern)!;
    const brewer = addPerson(tw, 'Brewer', 'innkeeper', tavern.inside, { workId: tavern.id });
    const farmer = addPerson(tw, 'Farmer', 'farmer', tavern.inside);
    const buyer = addPerson(tw, 'Buyer', 'farmer', tavern.inside);
    brewer.wealth = 10000; buyer.wealth = 100000; tavern.ownerId = brewer.id;
    const total = () => world.persons().reduce((n, p) => n + p.wealth, 0);
    const before = total(), farmerBefore = farmer.wealth;
    addPlaceStock(world, 'grain', cycles * BREW_RATIO.in, tavern.id, brewer.id, undefined, 'delivered');
    expect(settleWholesale(world, farmer.id, brewer.id, 'grain', cycles * BREW_RATIO.in, tavern.id)).toBe(cycles * BREW_RATIO.in);
    const fire = createFire(world, tavern.id, tavern.inside, false);
    addPlaceStock(world, 'stick', 2, tavern.id, brewer.id, undefined, 'seeded');
    expect(igniteFire(world, fire, brewer, 'stick', 2)).toBe(true);
    for (let i = 0; i < cycles; i++) {
      expect(restockTavern(world, brewer)).toBe(true);
      const ale = world.itemsAtPlaces([tavern.id]).find(i => i.type === 'ale' && i.quantity > 0)!;
      expect(buyFoodPortion(world, buyer, ale, ale.quantity)?.quantity).toBe((i + 1) * BREW_RATIO.out);
    }
    expect(stockAt(world, 'grain', tavern.id)).toBe(0);
    expect(restockTavern(world, brewer)).toBe(false);
    expect(farmer.wealth - farmerBefore).toBe(cycles * BREW_RATIO.in);
    expect(world.runTally.supply_cost_amount ?? 0).toBe(0);
    expect(total()).toBeCloseTo(before, 6);
  });
});
