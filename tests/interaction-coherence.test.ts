import { describe, expect, it } from 'vitest';
import type { Item, Person } from '../src/sim/core/types';
import { makeItem } from '../src/sim/world/factory';
import { addPerson, createTestWorld, step, v, type TestWorld } from './helpers/world';
import {
  willingnessFor, tradeOffersFrom, refusalsFrom, unitPriceFor, purchaseUnits,
  committedUnits, PERSONAL_FOOD_RESERVE,
} from '../src/sim/world/commerce';
import { actionsForWorldItem, actionsForCarriedItem, actionsForPerson } from '../src/sim/core/interaction';
import { refreshReport, shouldSeekAuthority, reportUrgencyFactor, noteReportFailed, noteReportDelivered, MAX_REPORT_ATTEMPTS } from '../src/sim/mind/reporting';
import { learn } from '../src/sim/mind/knowledge';
import { syncNeeds } from '../src/sim/core/physiology';

/**
 * v0.10.1 — the rules that decide what a player (or an NPC) may do with a thing or a person, and
 * that a transfer moves exactly what it says it moves.
 *
 * These assert the RULE, not one worked example of it: every case below is built from canonical
 * state (ownership, place, cargo, hunger, knowledge) and would break if the willingness test were
 * replaced by an occupation list or an "is merchandise" flag.
 */

/** A shop with a counter, and a keeper who works it. */
function shopWorld(seed: number): { tw: TestWorld; keeper: Person; buyer: Person } {
  const tw = createTestWorld(seed, 24);
  const tavern = tw.world.place(tw.places.tavern)!;
  const keeper = addPerson(tw, 'Keeper', 'innkeeper', v(19, 1, 3), { workId: tw.places.tavern, homeId: tw.places.chapel });
  tavern.ownerId = keeper.id; tavern.workers.push(keeper.id);
  const buyer = addPerson(tw, 'the Traveler', 'traveler', v(18, 1, 3), { controlled: true, homeId: tw.places.square });
  buyer.wealth = 100;
  return { tw, keeper, buyer };
}

/** Something on the shop's own shelf, owned by the keeper. */
function stock(tw: TestWorld, keeper: Person, type: Item['type'], qty: number): Item {
  return makeItem(tw.world, type, type, { owner: keeper.id, pos: v(19, 1, 4), placeId: tw.places.tavern, quantity: qty });
}

describe('commerce: what a person will actually sell', () => {
  it('offers commercial stock and withholds personal belongings, with a stated reason', () => {
    const { tw, keeper, buyer } = shopWorld(9001);
    const shelf = stock(tw, keeper, 'bread', 12);
    // The same kind of object, at the keeper's own home, is not stock.
    const home = makeItem(tw.world, 'lantern', 'lantern', { owner: keeper.id, pos: v(3, 1, 20), placeId: tw.places.chapel });

    const offers = tradeOffersFrom(tw.world, keeper, buyer);
    expect(offers.map(o => o.item.id)).toContain(shelf.id);
    expect(offers.map(o => o.item.id)).not.toContain(home.id);
    expect(refusalsFrom(tw.world, keeper, buyer).find(r => r.item.id === home.id)?.reason).toBe('personal');
  });

  it('will not sell the tool it is carrying to work with, but will sell the ones on the rack', () => {
    const { tw, keeper, buyer } = shopWorld(9002);
    const carried = makeItem(tw.world, 'axe', 'axe', { owner: keeper.id, holder: keeper.id });
    const onRack = stock(tw, keeper, 'axe', 1);

    expect(willingnessFor(tw.world, keeper, carried, buyer).reason).toBe('needed_for_work');
    expect(willingnessFor(tw.world, keeper, onRack, buyer).reason).toBeNull();
  });

  it('reserves stock an active carrier is collecting, and sells what is left over', () => {
    const { tw, keeper, buyer } = shopWorld(9003);
    const shelf = stock(tw, keeper, 'flour', 20);
    tw.world.haulTasks.push({
      id: 'ht_1', resource: 'flour', quantity: 8, carried: 0, delivered: 0,
      sourcePlaceId: tw.places.tavern, destPlaceId: tw.places.chapel, reason: 'the bakery needs flour',
      requesterId: null, claimantId: buyer.id, status: 'claimed', priority: 0.5,
      createdAt: tw.world.now, updatedAt: tw.world.now,
    });

    expect(committedUnits(tw.world, shelf)).toBe(8);
    const w = willingnessFor(tw.world, keeper, shelf, buyer);
    expect(w.reason).toBeNull();
    expect(w.available).toBe(12);
  });

  it('refuses to sell cargo outright', () => {
    const { tw, keeper, buyer } = shopWorld(9004);
    const cargo = stock(tw, keeper, 'grain', 10);
    cargo.haulTaskId = 'ht_9';
    expect(willingnessFor(tw.world, keeper, cargo, buyer).reason).toBe('committed');
  });

  it('will not sell the food it needs itself while hungry, and will while fed', () => {
    const { tw, keeper, buyer } = shopWorld(9005);
    // Their OWN supply, carried — not shop stock. That distinction is the rule.
    const supper = makeItem(tw.world, 'bread', 'bread', { owner: keeper.id, holder: keeper.id, quantity: PERSONAL_FOOD_RESERVE });

    keeper.physiology.energy = 0.1; syncNeeds(keeper);          // hungry
    expect(willingnessFor(tw.world, keeper, supper, buyer).reason).toBe('last_food');

    keeper.physiology.energy = 1; syncNeeds(keeper);            // fed
    expect(willingnessFor(tw.world, keeper, supper, buyer).reason).toBeNull();
  });

  it('sells the surplus above its own reserve rather than refusing outright', () => {
    const { tw, keeper, buyer } = shopWorld(9006);
    const supper = makeItem(tw.world, 'bread', 'bread', { owner: keeper.id, holder: keeper.id, quantity: PERSONAL_FOOD_RESERVE + 5 });
    keeper.physiology.energy = 0.1; syncNeeds(keeper);
    expect(willingnessFor(tw.world, keeper, supper, buyer).available).toBe(5);
  });

  it('does not treat shop stock as a personal larder', () => {
    // A tavern down to two mugs needs a delivery; its keeper is not about to starve. Applying the
    // personal reserve to commercial stock also deadlocks the shop — below the reserve it could
    // never sell again, so its stock would stop circulating entirely. Found by the ale-supply
    // invariant, which hung outright.
    const { tw, keeper, buyer } = shopWorld(9006_1);
    const shelf = stock(tw, keeper, 'ale', PERSONAL_FOOD_RESERVE);
    keeper.physiology.energy = 0.05; syncNeeds(keeper);
    const w = willingnessFor(tw.world, keeper, shelf, buyer);
    expect(w.reason).toBeNull();
    expect(w.available).toBe(PERSONAL_FOOD_RESERVE);
  });

  it('will not sell what belongs to somebody else', () => {
    const { tw, keeper, buyer } = shopWorld(9007);
    const other = addPerson(tw, 'Owner', 'farmer', v(10, 1, 10));
    const theirs = makeItem(tw.world, 'cheese', 'cheese', { owner: other.id, pos: v(19, 1, 4), placeId: tw.places.tavern, quantity: 3 });
    expect(willingnessFor(tw.world, keeper, theirs, buyer).reason).toBe('not_theirs');
    expect(tradeOffersFrom(tw.world, keeper, buyer).map(o => o.item.id)).not.toContain(theirs.id);
  });

  it('refuses a buyer it fears or bears a grudge against', () => {
    const { tw, keeper, buyer } = shopWorld(9008);
    stock(tw, keeper, 'bread', 10);
    keeper.relationships[buyer.id] = { ...(keeper.relationships[buyer.id] ?? { affection: 0, trust: 0, fear: 0, respect: 0, familiarity: 0, grudge: 0 }), grudge: 0.9 };
    expect(tradeOffersFrom(tw.world, keeper, buyer)).toHaveLength(0);
    expect(refusalsFrom(tw.world, keeper, buyer)[0].reason).toBe('hostile');
  });

  it('prices from scarcity, and its personal markup is mean-preserving', () => {
    const { tw, keeper, buyer } = shopWorld(9009);
    const shelf = stock(tw, keeper, 'cheese', 4);
    keeper.traits.greed = 0.5;
    const average = unitPriceFor(tw.world, keeper, shelf, buyer);
    keeper.traits.greed = 1;
    const greedy = unitPriceFor(tw.world, keeper, shelf, buyer);
    keeper.traits.greed = 0;
    const generous = unitPriceFor(tw.world, keeper, shelf, buyer);
    expect(average).toBe(Math.max(1, Math.round(shelf.value)));
    expect(greedy).toBeGreaterThan(average);
    expect(generous).toBeLessThan(average);
  });
});

describe('commerce: the transaction itself', () => {
  it('moves money and goods exactly once, and never leaves the item in two places', () => {
    const { tw, keeper, buyer } = shopWorld(9010);
    const shelf = stock(tw, keeper, 'bread', 10);
    const keeperBefore = keeper.wealth, buyerBefore = buyer.wealth;

    const r = purchaseUnits(tw.world, buyer, keeper, shelf, 3);

    expect(r.units).toBe(3);
    expect(buyer.wealth).toBe(buyerBefore - r.paid);
    expect(keeper.wealth).toBe(keeperBefore + r.paid);
    expect(shelf.quantity).toBe(7);
    expect(r.stack!.quantity).toBe(3);
    expect(r.stack!.ownerId).toBe(buyer.id);
    expect(r.stack!.holderId).toBe(buyer.id);
    expect(r.stack!.placeId).toBeNull();
    // Total bread in the world is conserved.
    expect(tw.world.items().filter(i => i.type === 'bread').reduce((n, i) => n + i.quantity, 0)).toBe(10);
    // The buyer holds it once, and nobody else's inventory mentions it.
    expect(buyer.inventory.filter(id => id === r.stack!.id)).toHaveLength(1);
    expect(keeper.inventory).not.toContain(r.stack!.id);
  });

  it('detaches a stack it has drained rather than leaving a ghost on the shelf', () => {
    const { tw, keeper, buyer } = shopWorld(9011);
    const shelf = stock(tw, keeper, 'cheese', 2);
    const r = purchaseUnits(tw.world, buyer, keeper, shelf, 2);
    expect(r.units).toBe(2);
    expect(shelf.quantity).toBe(0);
    expect(shelf.placeId).toBeNull();
    expect(shelf.pos).toBeNull();
  });

  it('buys nothing at all when the buyer cannot afford one unit', () => {
    const { tw, keeper, buyer } = shopWorld(9012);
    const shelf = stock(tw, keeper, 'ring', 1);
    buyer.wealth = 1;
    const r = purchaseUnits(tw.world, buyer, keeper, shelf, 1);
    expect(r.units).toBe(0);
    expect(buyer.wealth).toBe(1);
    expect(shelf.quantity).toBe(1);
    expect(shelf.ownerId).toBe(keeper.id);
  });

  it('re-checks willingness at the till, not only when the menu was drawn', () => {
    const { tw, keeper, buyer } = shopWorld(9013);
    const supper = makeItem(tw.world, 'bread', 'bread', { owner: keeper.id, holder: keeper.id, quantity: PERSONAL_FOOD_RESERVE });
    keeper.physiology.energy = 1; syncNeeds(keeper);            // well fed: it is on the menu
    expect(tradeOffersFrom(tw.world, keeper, buyer).map(o => o.item.id)).toContain(supper.id);
    keeper.physiology.energy = 0.1; syncNeeds(keeper);          // and then they get hungry
    const r = purchaseUnits(tw.world, buyer, keeper, supper, 1);
    expect(r.units).toBe(0);
    expect(r.refused).toBe('last_food');
  });
});

describe('interaction: possession, ownership and what the player is told', () => {
  it('offers to BUY a shop\'s goods first, with theft as the named alternative', () => {
    const { tw, keeper, buyer } = shopWorld(9020);
    const tavern = tw.world.place(tw.places.tavern)!;
    tavern.anchors.push({ pos: v(19, 1, 4), kind: 'display', label: 'counter' });
    const shelf = stock(tw, keeper, 'bread', 6);
    keeper.physiology.energy = 1; syncNeeds(keeper);

    const acts = actionsForWorldItem(tw.world, buyer, shelf);
    expect(acts[0].kind).toBe('buy');
    expect(acts[0].price).toBeGreaterThan(0);
    const steal = acts.find(a => a.kind === 'steal');
    expect(steal).toBeTruthy();
    expect(steal!.grave).toBe(true);
    expect(steal!.detail).toMatch(/theft/);
  });

  it('calls taking an unowned thing what it is, and does not pretend a stranger\'s property is unowned', () => {
    const { tw, keeper, buyer } = shopWorld(9021);
    const loose = makeItem(tw.world, 'stick', 'stick', { pos: v(12, 1, 12) });
    expect(actionsForWorldItem(tw.world, buyer, loose)[0].kind).toBe('take');

    const theirs = makeItem(tw.world, 'ring', 'ring', { owner: keeper.id, pos: v(12, 1, 13) });
    const acts = actionsForWorldItem(tw.world, buyer, theirs);
    expect(acts.some(a => a.kind === 'steal')).toBe(true);
    expect(acts.some(a => a.kind === 'take')).toBe(false);
  });

  it('says only what the player actually knows about who owns it', () => {
    const { tw, keeper, buyer } = shopWorld(9022);
    const theirs = makeItem(tw.world, 'ring', 'ring', { owner: keeper.id, pos: v(12, 1, 13) });

    const before = actionsForWorldItem(tw.world, buyer, theirs).find(a => a.kind === 'steal')!;
    expect(before.detail).toMatch(/not sure/);

    learn(tw.world, buyer, { key: `owner:${theirs.id}`, kind: 'fact', claim: { itemId: theirs.id, ownerId: keeper.id }, confidence: 1, source: { type: 'witnessed' }, summary: 'saw whose it was' });
    const after = actionsForWorldItem(tw.world, buyer, theirs).find(a => a.kind === 'steal')!;
    expect(after.detail).toMatch(new RegExp(keeper.name));
  });

  it('offers recovery, not theft, once the owner has actually asked for it back', () => {
    const { tw, keeper, buyer } = shopWorld(9023);
    const lost = makeItem(tw.world, 'ring', 'ring', { owner: keeper.id, pos: v(12, 1, 13) });
    keeper.desires.push({ type: 'recover_item', targetId: lost.id, note: 'my ring', reward: 5, fulfilled: false });
    learn(tw.world, buyer, { key: `wanted:${lost.id}`, kind: 'fact', claim: { wantedItem: true, itemId: lost.id, requesterId: keeper.id }, confidence: 1, source: { type: 'told', from: keeper.id }, summary: 'asked me to find it' });

    const acts = actionsForWorldItem(tw.world, buyer, lost);
    expect(acts.some(a => a.kind === 'recover')).toBe(true);
    expect(acts.some(a => a.kind === 'steal')).toBe(false);
  });

  it('will not sell you goods on an unattended counter — that is a theft, not a transaction', () => {
    const { tw, keeper, buyer } = shopWorld(9026);
    const tavern = tw.world.place(tw.places.tavern)!;
    tavern.anchors.push({ pos: v(19, 1, 4), kind: 'display', label: 'counter' });
    const shelf = stock(tw, keeper, 'bread', 6);
    keeper.physiology.energy = 1; syncNeeds(keeper);
    expect(actionsForWorldItem(tw.world, buyer, shelf)[0].kind).toBe('buy');

    // The keeper wanders off; the bread does not become free.
    tw.world.primaryBody(keeper.id)!.pos = v(2, 1, 2);
    const alone = actionsForWorldItem(tw.world, buyer, shelf);
    expect(alone.some(a => a.kind === 'buy')).toBe(false);
    expect(alone.some(a => a.kind === 'steal')).toBe(true);
  });

  it('offers Trade on a person only when they would really sell something', () => {
    const { tw, keeper, buyer } = shopWorld(9024);
    expect(actionsForPerson(tw.world, buyer, keeper, []).some(a => a.kind === 'trade')).toBe(false);
    stock(tw, keeper, 'bread', 5);
    expect(actionsForPerson(tw.world, buyer, keeper, []).some(a => a.kind === 'trade')).toBe(true);
  });

  it('offers only the carried actions the simulation can actually perform', () => {
    const { tw, keeper, buyer } = shopWorld(9025);
    const bread = makeItem(tw.world, 'bread', 'bread', { owner: buyer.id, holder: buyer.id, quantity: 2 });
    const axe = makeItem(tw.world, 'axe', 'axe', { owner: buyer.id, holder: buyer.id });

    const forBread = actionsForCarriedItem(tw.world, buyer, bread, keeper).map(a => a.kind);
    expect(forBread).toContain('eat');
    expect(forBread).toContain('give');
    expect(forBread).toContain('drop');

    const forAxe = actionsForCarriedItem(tw.world, buyer, axe, null).map(a => a.kind);
    expect(forAxe).not.toContain('eat');
    expect(forAxe).not.toContain('give');   // nobody is close enough to hand it to
    expect(forAxe).toContain('drop');
  });
});

describe('reporting: progress toward a real outcome', () => {
  function crimeWorld(seed: number): { tw: TestWorld; witness: Person; guard: Person; key: string } {
    const tw = createTestWorld(seed, 24);
    const witness = addPerson(tw, 'Witness', 'farmer', v(5, 1, 5));
    const guard = addPerson(tw, 'Guard', 'guard', v(20, 1, 20), { workId: tw.places.guardhouse });
    const thief = addPerson(tw, 'Thief', 'vagrant', v(6, 1, 6));
    const ev = tw.world.emit('theft', { actor: thief.id, target: witness.id, pos: v(6, 1, 6), significance: 0.6, summary: 'Thief stole from Witness' });
    const key = `ev:${ev.id}`;
    learn(tw.world, witness, { key, kind: 'event', claim: { type: 'theft', actor: thief.id, target: witness.id, eventId: ev.id, significance: 0.6 }, confidence: 1, source: { type: 'witnessed' }, summary: ev.summary });
    return { tw, witness, guard, key };
  }

  it('is worth setting out about when nothing has been tried yet', () => {
    const { tw, witness, guard, key } = crimeWorld(9030);
    const r = refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    expect(r.status).toBe('seeking');
    expect(shouldSeekAuthority(tw.world, r)).toBe(true);
    expect(reportUrgencyFactor(r)).toBe(1);
  });

  it('stops once the watch has actually been told', () => {
    const { tw, witness, guard, key } = crimeWorld(9031);
    witness.knowledge[key].sharedWith.push(guard.id);
    const r = refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    expect(r.status).toBe('delivered');
    expect(r.deliveredToId).toBe(guard.id);
    expect(shouldSeekAuthority(tw.world, r)).toBe(false);
  });

  it('backs off after a failed approach instead of setting out again immediately', () => {
    const { tw, witness, guard, key } = crimeWorld(9032);
    refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    noteReportFailed(tw.world, witness, key, guard.id, 'he had moved on');
    const r = witness.mind.reports![key];
    expect(r.status).toBe('unavailable');
    expect(shouldSeekAuthority(tw.world, r)).toBe(false);
    expect(reportUrgencyFactor(r)).toBeLessThan(1);
  });

  it('eases off, and finally gives up for the day, as repeated trips come to nothing', () => {
    const { tw, witness, guard, key } = crimeWorld(9033);
    refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    let previous = 1;
    for (let i = 0; i < MAX_REPORT_ATTEMPTS; i++) {
      noteReportFailed(tw.world, witness, key, guard.id, 'nobody there');
      const factor = reportUrgencyFactor(witness.mind.reports![key]);
      expect(factor).toBeLessThan(previous);
      previous = factor;
    }
    const r = witness.mind.reports![key];
    expect(r.status).toBe('no_authority');
    expect(shouldSeekAuthority(tw.world, r)).toBe(false);
  });

  it('reopens the moment an authority is actually in sight', () => {
    const { tw, witness, guard, key } = crimeWorld(9034);
    for (let i = 0; i < MAX_REPORT_ATTEMPTS; i++) noteReportFailed(tw.world, witness, key, guard.id, 'nobody there');
    expect(witness.mind.reports![key].status).toBe('no_authority');

    witness.mind.percepts = [{ entityId: guard.id, bodyId: tw.world.primaryBody(guard.id)!.id, pos: v(20, 1, 20), distance: 2, how: 'saw', tick: tw.world.now }];
    const r = refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    expect(r.status).toBe('seeking');
    expect(shouldSeekAuthority(tw.world, r)).toBe(true);
  });

  it('has nobody to tell when there is no watch, and says so', () => {
    const { tw, witness, key } = crimeWorld(9035);
    const r = refreshReport(tw.world, witness, witness.knowledge[key], []);
    expect(r.status).toBe('no_authority');
    expect(shouldSeekAuthority(tw.world, r)).toBe(false);
  });

  it('records who it was finally told to', () => {
    const { tw, witness, guard, key } = crimeWorld(9036);
    refreshReport(tw.world, witness, witness.knowledge[key], [guard]);
    noteReportDelivered(tw.world, witness, key, guard.id);
    const r = witness.mind.reports![key];
    expect(r.status).toBe('delivered');
    expect(r.deliveredToId).toBe(guard.id);
    expect(r.deliveredAt).toBe(tw.world.now);
  });
});

describe('item transfer integrity across a whole chain', () => {
  it('keeps one item in one place through buy → give → drop → pick up', () => {
    const { tw, keeper, buyer } = shopWorld(9040);
    const other = addPerson(tw, 'Neighbour', 'farmer', v(17, 1, 3));
    const shelf = stock(tw, keeper, 'cheese', 4);

    const check = (label: string) => {
      for (const it of tw.world.items()) {
        if (it.quantity <= 0) continue;
        const holders = tw.world.persons().filter(p => p.inventory.includes(it.id));
        expect(holders.length, `${label}: ${it.type} is in ${holders.length} inventories`).toBeLessThanOrEqual(1);
        if (it.holderId) {
          expect(holders.map(h => h.id), `${label}: ${it.type} held by ${it.holderId} but listed elsewhere`).toEqual([it.holderId]);
          expect(it.pos, `${label}: ${it.type} is both held and lying in the world`).toBeNull();
          expect(it.placeId, `${label}: ${it.type} is both held and stocked at a place`).toBeNull();
        } else {
          expect(holders, `${label}: ${it.type} is unheld but in someone's inventory`).toHaveLength(0);
        }
      }
    };

    check('at the start');
    const bought = purchaseUnits(tw.world, buyer, keeper, shelf, 2).stack!;
    check('after buying');
    tw.sim.giveItem(buyer, other, bought);
    check('after giving it away');
    tw.sim.dropItem(other, bought, v(17, 1, 4));
    check('after it was set down');
    tw.sim.takeItem(buyer, bought, 'pickup');
    check('after it was picked up again');

    // And the cheese in the world is still exactly what the shop started with.
    expect(tw.world.items().filter(i => i.type === 'cheese').reduce((n, i) => n + i.quantity, 0)).toBe(4);
  });

  it('holds through an ordinary stretch of village life', () => {
    const { tw, keeper, buyer } = shopWorld(9041);
    stock(tw, keeper, 'bread', 20);
    addPerson(tw, 'Neighbour', 'farmer', v(10, 1, 10));
    void buyer;
    step(tw, 240);
    for (const it of tw.world.items()) {
      if (it.quantity <= 0) continue;
      const holders = tw.world.persons().filter(p => p.inventory.includes(it.id));
      expect(holders.length, `${it.type} is in ${holders.length} inventories`).toBeLessThanOrEqual(1);
      if (it.holderId) expect(it.pos).toBeNull();
    }
  });
});
