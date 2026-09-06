import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makePlace, makeItem } from '../src/sim/world/factory';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { createHaulTask, canHaul } from '../src/sim/logistics/haul';
import { canAcceptHaul, haulOffersFrom, progressHaul } from '../src/sim/logistics/participation';
import { DialogueSystem } from '../src/sim/mind/dialogue';
import { newWorld } from '../src/sim/persist/save';

/**
 * Player embodiment (docs/PLAYER_EMBODIMENT.md): the player lives under the same physiology,
 * currency and Request market as every NPC, through the same functions. These tests drive the
 * player-facing Simulation entry points and assert on canonical state — never on UI text.
 */

function haulWorld(seed = 9100) {
  const tw = createTestWorld(seed, 48);
  const src = makePlace(tw.world, 'mill', 'the mill', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
  const dst = makePlace(tw.world, 'bakery', 'the bakery', { x0: 36, z0: 36, x1: 44, z1: 44, y0: 1, y1: 3 }, { inside: v(40, 1, 40), indoor: true });
  const baker = addPerson(tw, 'Baker', 'baker', v(40, 1, 41), { workId: dst.id });
  dst.workers.push(baker.id); dst.ownerId = baker.id; baker.wealth = 30;
  const player = addPerson(tw, 'Traveler', 'traveler', v(20, 1, 20), { controlled: true });
  player.wealth = 5;
  addPlaceStock(tw.world, 'flour', 12, src.id, null, undefined, 'milled');
  const task = createHaulTask(tw.world, { resource: 'flour', quantity: 6, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'the bakery is low on flour', requesterId: baker.id, priority: 0.8 });
  return { tw, src, dst, baker, player, task };
}
const totalWealth = (tw: ReturnType<typeof createTestWorld>) => tw.world.persons().reduce((n, p) => n + p.wealth, 0);
const moveTo = (tw: ReturnType<typeof createTestWorld>, p: { id: string }, pos: { x: number; y: number; z: number }) => { tw.world.primaryBody(p.id)!.pos = { ...pos }; };

describe('player embodiment — same physiology', () => {
  it("the player's hunger and thirst rise through the same physiology step as everyone else's", () => {
    const tw = createTestWorld(9101, 24);
    const player = addPerson(tw, 'Traveler', 'traveler', v(12, 1, 12), { controlled: true });
    const npc = addPerson(tw, 'Villager', 'farmer', v(14, 1, 12));
    const h0 = player.needs.hunger, t0 = player.needs.thirst;
    step(tw, 60 * 6); // 6 world hours (physical seconds x 60 timeScale)
    expect(player.needs.hunger).toBeGreaterThan(h0 + 0.1);
    expect(player.needs.thirst).toBeGreaterThan(t0 + 0.1);
    // same model: an idle NPC drifts by a comparable amount (not identical — activity differs)
    expect(Math.abs(npc.needs.hunger - player.needs.hunger)).toBeLessThan(0.25);
  });

  it('eating carried food goes through eatFood: one unit consumed, energy restored, a food_consumed event by the player', () => {
    const tw = createTestWorld(9102, 24);
    const player = addPerson(tw, 'Traveler', 'traveler', v(12, 1, 12), { controlled: true });
    const bread = makeItem(tw.world, 'bread', 'bread', { owner: player.id, holder: player.id, quantity: 2 });
    player.inventory.push(bread.id);
    player.physiology.energy = 0.3; player.needs.hunger = 0.7;
    expect(tw.sim.eatAtHand(player)).toBe('bread');
    expect(bread.quantity).toBe(1);
    expect(player.physiology.energy).toBeGreaterThan(0.6);
    expect(tw.world.events.some(e => e.type === 'food_consumed' && e.actor === player.id)).toBe(true);
    expect(tw.sim.eatAtHand(player)).toBe('bread');
    expect(player.inventory.includes(bread.id)).toBe(false); // stack retired, inventory cleaned
    expect(tw.sim.eatAtHand(player)).toBeNull();
  });

  it('drinking works only at a real water source (a well Place) and restores hydration via drinkAt', () => {
    const tw = createTestWorld(9103, 30);
    const well = makePlace(tw.world, 'well', 'the well', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22), indoor: false });
    const player = addPerson(tw, 'Traveler', 'traveler', v(4, 1, 4), { controlled: true });
    player.physiology.hydration = 0.2;
    expect(tw.sim.drinkHere(player)).toBe(false);
    expect(player.physiology.hydration).toBeCloseTo(0.2);
    moveTo(tw, player, v(22.5, 1, 22.5));
    expect(tw.sim.drinkHere(player)).toBe(true);
    expect(player.physiology.hydration).toBeGreaterThan(0.8);
    expect(tw.world.events.some(e => e.type === 'water_consumed' && e.actor === player.id && e.placeId === well.id)).toBe(true);
  });
});

describe('player embodiment — one currency', () => {
  it('buyItem/sellItem move wealth to wealth; no coin item is created and total currency is conserved', () => {
    const tw = createTestWorld(9104, 24);
    const merchant = addPerson(tw, 'Merchant', 'merchant', v(12, 1, 12));
    const player = addPerson(tw, 'Traveler', 'traveler', v(13, 1, 12), { controlled: true });
    merchant.wealth = 10; player.wealth = 8;
    const lantern = makeItem(tw.world, 'lantern', 'a lantern', { owner: merchant.id, pos: v(12, 1, 13), placeId: null, value: 5 });
    expect(tw.sim.buyItem(player, merchant, lantern, 20)).toBeNull(); // cannot overspend
    const before = totalWealth(tw);
    expect(tw.sim.buyItem(player, merchant, lantern, 5)).not.toBeNull();
    expect(player.wealth).toBe(3); expect(merchant.wealth).toBe(15);
    expect(lantern.holderId).toBe(player.id);
    expect(tw.sim.sellItem(player, merchant, lantern, 4)).not.toBeNull();
    expect(player.wealth).toBe(7); expect(merchant.wealth).toBe(11);
    expect(totalWealth(tw)).toBe(before);
    expect(tw.world.items().some(i => i.type === 'coins')).toBe(false);
  });

  it('the generated village gives the Traveler wealth, not a carried coin stack', () => {
    const { world } = newWorld(918271);
    const player = world.person(world.playerId)!;
    expect(player.wealth).toBeGreaterThan(0);
    expect(player.inventory.map(id => world.item(id)?.type)).not.toContain('coins');
  });

  it('a meal bought in dialogue goes through buyFoodPortion: real stock, real price, food in hand', () => {
    const tw = createTestWorld(9105, 24);
    const bakery = makePlace(tw.world, 'bakery', 'the bakery', { x0: 8, z0: 8, x1: 16, z1: 16, y0: 1, y1: 3 }, { inside: v(12, 1, 12) });
    const baker = addPerson(tw, 'Baker', 'baker', v(12, 1, 12), { workId: bakery.id });
    const player = addPerson(tw, 'Traveler', 'traveler', v(13, 1, 12), { controlled: true });
    player.wealth = 10; baker.wealth = 0;
    const loaf = addPlaceStock(tw.world, 'bread', 5, bakery.id, baker.id, undefined, 'baked');
    const before = totalWealth(tw);
    const got = tw.sim.buyMeal(player, baker, 1);
    expect(got?.type).toBe('bread'); expect(got?.holderId).toBe(player.id);
    expect(loaf.quantity).toBe(4);
    expect(player.wealth).toBeLessThan(10); expect(baker.wealth).toBeGreaterThan(0);
    expect(totalWealth(tw)).toBe(before);
    // and the dialogue actually offers it
    const ds = new DialogueSystem(tw.world, tw.sim);
    const state = ds.start(baker, player);
    expect(state.options.some(o => o.label.startsWith('Buy a meal'))).toBe(true);
  });
});

describe('player embodiment — the same haul market', () => {
  it('eligibility: the player passes the shared rule but is never planned for by NPC cognition', () => {
    const { player, baker } = haulWorld(9106);
    expect(canAcceptHaul(player)).toBe(true);
    expect(canHaul(player)).toBe(false);
    expect(canHaul(baker)).toBe(true);
    expect(canAcceptHaul(baker)).toBe(true);
  });

  it('the requester offers the job; accepting claims the same HaulTask/Request an NPC would', () => {
    const { tw, player, baker, task } = haulWorld(9107);
    const offers = haulOffersFrom(tw.world, baker);
    expect(offers.map(o => o.task.id)).toEqual([task.id]);
    expect(tw.sim.acceptHaul(player, task)).toBe(true);
    expect(task.claimantId).toBe(player.id); expect(task.status).toBe('claimed');
    const req = tw.world.requests.find(r => r.id === task.requestId)!;
    expect(req.status).toBe('accepted'); expect(req.acceptedBy).toBe(player.id);
    expect(tw.sim.acceptHaul(player, task)).toBe(false); // one job at a time / already claimed
    expect(haulOffersFrom(tw.world, baker)).toHaveLength(0);
  });

  it('load at the source, carry real cargo, deposit at the destination, get paid by completeRequest — wealth conserved', () => {
    const { tw, src, dst, player, baker, task } = haulWorld(9108);
    tw.sim.acceptHaul(player, task);
    const before = totalWealth(tw);
    // far from the source: nothing loads
    let r = tw.sim.progressHaul(player);
    expect(r.kind).toBe('go_to'); if (r.kind === 'go_to') expect(r.leg).toBe('source');
    expect(task.carried).toBe(0);
    moveTo(tw, player, v(6.5, 1, 6.5));
    r = tw.sim.progressHaul(player);
    expect(r.kind).toBe('loaded');
    expect(task.carried).toBeGreaterThan(0);
    const cargo = tw.world.item(task.cargoItemId!)!;
    expect(cargo.holderId).toBe(player.id); expect(player.inventory).toContain(cargo.id);
    expect(stockAt(tw.world, 'flour', src.id)).toBe(12 - task.carried);
    // at the wrong place: no deposit
    moveTo(tw, player, v(20, 1, 20));
    r = tw.sim.progressHaul(player);
    expect(r.kind).toBe('go_to'); if (r.kind === 'go_to') expect(r.leg).toBe('destination');
    // deliver
    moveTo(tw, player, v(40.5, 1, 40.5));
    const wealthBefore = player.wealth;
    r = tw.sim.progressHaul(player);
    expect(r.kind).toBe('delivered');
    if (r.kind === 'delivered') { expect(r.complete).toBe(true); expect(r.paid).toBeGreaterThan(0); expect(r.paid).toBe(player.wealth - wealthBefore); }
    expect(task.status).toBe('delivered');
    expect(stockAt(tw.world, 'flour', dst.id)).toBe(6);
    expect(player.inventory).not.toContain(cargo.id);
    const req = tw.world.requests.find(r => r.id === task.requestId)!;
    expect(req.status).toBe('completed');
    expect(baker.wealth).toBe(30 - (player.wealth - 5));
    expect(totalWealth(tw)).toBe(before);
    expect(tw.world.events.some(e => e.type === 'wage_paid' && e.target === player.id)).toBe(true);
    expect(player.skills.hauling ?? 0).toBeGreaterThan(0);
  });

  it('a carry too heavy for one trip stays the same job and pays once, on completion — like an NPC hauler', () => {
    const { tw, src, dst, player, baker } = haulWorld(9109);
    // stone at 15 kg/unit: an average adult carries 2 per trip — this job genuinely takes several
    addPlaceStock(tw.world, 'stone', 6, src.id, null, undefined, 'quarried');
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 6, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'the bakery wants stone for a new oven', requesterId: baker.id, priority: 0.8 });
    tw.sim.acceptHaul(player, task);
    moveTo(tw, player, v(6.5, 1, 6.5));
    expect(tw.sim.progressHaul(player).kind).toBe('loaded');
    const firstTrip = task.carried;
    expect(firstTrip).toBeLessThan(6);
    moveTo(tw, player, v(40.5, 1, 40.5));
    const w0 = player.wealth;
    const r = tw.sim.progressHaul(player);
    expect(r.kind).toBe('delivered'); if (r.kind === 'delivered') { expect(r.complete).toBe(false); expect(r.paid).toBe(0); }
    expect(player.wealth).toBe(w0); expect(task.status).toBe('claimed');
    moveTo(tw, player, v(6.5, 1, 6.5)); tw.sim.progressHaul(player);
    moveTo(tw, player, v(40.5, 1, 40.5));
    while (task.status !== 'delivered') { const rr = tw.sim.progressHaul(player); if (rr.kind === 'go_to') moveTo(tw, player, rr.leg === 'source' ? v(6.5, 1, 6.5) : v(40.5, 1, 40.5)); if (rr.kind === 'failed') throw new Error(rr.reason); }
    expect(player.wealth).toBeGreaterThan(w0);
    expect(stockAt(tw.world, 'stone', src.id)).toBe(0);
  });

  it('setting the cargo down fails the haul honestly: no wage, cargo stays canonical on the ground', () => {
    const { tw, player, task } = haulWorld(9110);
    tw.sim.acceptHaul(player, task);
    moveTo(tw, player, v(6.5, 1, 6.5)); tw.sim.progressHaul(player);
    const cargo = tw.world.item(task.cargoItemId!)!; const qty = cargo.quantity;
    moveTo(tw, player, v(20, 1, 20));
    tw.sim.dropItem(player, cargo, v(20, 1, 21));
    const w0 = player.wealth;
    const r = progressHaul(tw.world, player, v(40.5, 1, 40.5));
    expect(r.kind).toBe('failed');
    expect(task.status).toBe('failed'); expect(player.wealth).toBe(w0);
    expect(cargo.quantity).toBe(qty); expect(cargo.holderId).toBeNull(); expect(cargo.pos).not.toBeNull();
    expect(tw.world.requests.find(r => r.id === task.requestId)!.status).toBe('failed');
  });
});
