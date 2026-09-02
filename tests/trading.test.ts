import { describe, expect, it } from 'vitest';
import type { Item, Person, Vec3, WorldEvent } from '../src/sim/core/types';
import type { Simulation } from '../src/sim/mind/agent';
import { makeItem } from '../src/sim/world/factory';
import { addPerson, createTestWorld, v } from './helpers/world';

interface TradingSimulation extends Simulation {
  buyItem(buyer: Person, seller: Person, item: Item, price: number): WorldEvent | null;
  sellItem(seller: Person, buyer: Person, item: Item, price: number, displayPos?: Vec3, placeId?: string): WorldEvent | null;
}

describe('canonical trading', () => {
  it('creates a real coin stack when a player without coins sells an item', () => {
    const tw = createTestWorld(81, 16);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(4.5, 1, 4.5), { controlled: true });
    const merchant = addPerson(tw, 'Merchant', 'merchant', v(5.5, 1, 4.5), { workId: tw.places.tavern });
    merchant.wealth = 50;
    const item = makeItem(tw.world, 'bread', 'travel bread', { owner: player.id, holder: player.id });

    const event = (tw.sim as TradingSimulation).sellItem(player, merchant, item, 7, v(6.5, 1, 4.5), tw.places.tavern);

    expect(event?.type).toBe('trade');
    const coins = player.inventory.map(id => tw.world.item(id)).find(i => i?.type === 'coins');
    expect(coins).toMatchObject({ ownerId: player.id, holderId: player.id, quantity: 7 });
    expect(merchant.wealth).toBe(43);
    expect(player.inventory).not.toContain(item.id);
    expect(item).toMatchObject({ ownerId: merchant.id, holderId: null, placeId: tw.places.tavern, pos: v(6.5, 1, 4.5) });
    expect(item.provenance.at(-1)).toMatchObject({ from: player.id, to: merchant.id, how: 'sold', eventId: event?.id });
  });

  it('keeps payment, ownership, holder state, and provenance consistent when buying', () => {
    const tw = createTestWorld(82, 16);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(4.5, 1, 4.5), { controlled: true });
    const merchant = addPerson(tw, 'Merchant', 'merchant', v(5.5, 1, 4.5));
    merchant.wealth = 10;
    const coins = makeItem(tw.world, 'coins', 'silver coins', { owner: player.id, holder: player.id, quantity: 12 });
    const goods = makeItem(tw.world, 'cheese', 'cheese', { owner: merchant.id, pos: v(5.5, 1, 5.5), placeId: tw.places.tavern });

    const event = (tw.sim as TradingSimulation).buyItem(player, merchant, goods, 5);

    expect(event?.type).toBe('trade');
    expect(coins.quantity).toBe(7);
    expect(merchant.wealth).toBe(15);
    expect(goods).toMatchObject({ ownerId: player.id, holderId: player.id, pos: null, placeId: null });
    expect(player.inventory).toContain(goods.id);
    expect(goods.provenance.at(-1)).toMatchObject({ from: merchant.id, to: player.id, how: 'bought', eventId: event?.id });
  });

  it('does not partially mutate an unaffordable transaction', () => {
    const tw = createTestWorld(83, 16);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(4.5, 1, 4.5), { controlled: true });
    const merchant = addPerson(tw, 'Merchant', 'merchant', v(5.5, 1, 4.5));
    const coins = makeItem(tw.world, 'coins', 'silver coins', { owner: player.id, holder: player.id, quantity: 2 });
    const goods = makeItem(tw.world, 'cheese', 'cheese', { owner: merchant.id, pos: v(5.5, 1, 5.5) });

    expect((tw.sim as TradingSimulation).buyItem(player, merchant, goods, 5)).toBeNull();
    expect(coins.quantity).toBe(2);
    expect(goods).toMatchObject({ ownerId: merchant.id, holderId: null, pos: v(5.5, 1, 5.5) });
  });
});
