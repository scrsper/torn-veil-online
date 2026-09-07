import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { BridgeSession } from '../src/bridge/session';
import { handInteractions, performHandInteraction } from '../src/sim/physical/hand';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { createTestWorld, addPerson, v, wall } from './helpers/world';
function setup() {
  const tw = createTestWorld();
  const p = addPerson(tw, 'Buyer', 'traveler', v(10, 1, 10), { controlled: true });
  const stall = makePlace(tw.world, 'stall', 'Food counter', { x0: 9, x1: 14, z0: 9, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 10) });
  const seller = addPerson(tw, 'Seller', 'baker', v(12, 1, 10), { workId: stall.id });
  stall.ownerId = seller.id; stall.workers.push(seller.id); stall.anchors.push({ kind: 'display', pos: v(11.5, 1, 10) });
  const bread = makeItem(tw.world, 'bread', 'Bread', { owner: seller.id, pos: v(11.5, 1, 10), placeId: stall.id, quantity: 10 });
  p.wealth = 100;
  const well = makePlace(tw.world, 'well', 'Water', { x0: 18, x1: 22, z0: 8, z1: 12, y0: 1, y1: 3 }, { inside: v(20, 1, 10) });
  const act = (id: string) => performHandInteraction(tw.sim, p, id);
  return { ...tw, p, seller, bread, well, act };
}
describe('canonical hand interactions', () => {
  it('buys exactly one unit, conserves payment, transfers possession, and consumes it', () => {
    const t = setup(); const offer = handInteractions(t.sim, t.p).find(a => a.kind === 'buy')!;
    expect(offer).toBeDefined(); const money = t.p.wealth + t.seller.wealth, before = t.p.wealth;
    expect(t.act(offer.id)).toBe('accepted'); expect(t.bread.quantity).toBe(9);
    expect(t.p.wealth).toBeLessThan(before); expect(t.p.wealth + t.seller.wealth).toBe(money);
    const food = t.world.item(t.p.inventory[0])!;
    expect(food.holderId).toBe(t.p.id); expect(food.ownerId).toBe(t.p.id); expect(food.quantity).toBe(1);
    t.p.needs.hunger = 0.7;
    expect(t.act(`consume:${food.id}`)).toBe('accepted');
    expect(t.p.needs.hunger).toBeLessThan(0.7); expect(food.quantity).toBe(0);
    expect(t.act(`consume:${food.id}`)).toBe('unavailable_stock');
  });
  it('reaches merchandise above its supporting counter without reaching through walls', () => {
    const t = setup(); t.world.grid.set(11, 1, 10, B.Counter);
    expect(t.act(`buy:${t.bread.id}`)).toBe('accepted');
    t.world.grid.set(11, 2, 10, B.Stone);
    expect(t.act(`buy:${t.bread.id}`)).toBe('interaction_unavailable');
  });
  it('refuses insufficient funds without changing stock or payment', () => {
    const t = setup(); t.p.wealth = 0; const money = t.seller.wealth;
    expect(t.act(`buy:${t.bread.id}`)).toBe('insufficient_funds');
    expect(t.bread.quantity).toBe(10); expect(t.seller.wealth).toBe(money); expect(t.p.inventory).toHaveLength(0);
  });
  it('rechecks depleted stock from a stale prompt', () => {
    const t = setup(); const offer = handInteractions(t.sim, t.p)[0]; t.bread.quantity = 0;
    expect(t.act(offer.id)).toBe('unavailable_stock'); expect(t.p.wealth).toBe(100);
  });
  it('refuses unheld food and fabricated interactions', () => {
    const t = setup(); expect(t.act(`consume:${t.bread.id}`)).toBe('not_carried');
    expect(t.act('consume:missing')).toBe('unavailable_stock');
    expect(t.act('grant:bread')).toBe('invalid_interaction'); expect(t.act('')).toBe('invalid_interaction');
    expect(t.act(`drink:${t.bread.id}`)).toBe('interaction_unavailable');
  });
  it('refuses purchases through solid walls and from far away', () => {
    const t = setup(); wall(t, 11, 8, 12);
    expect(t.act(`buy:${t.bread.id}`)).toBe('interaction_unavailable');
    t.world.primaryBody(t.p.id)!.pos = v(3, 1, 3);
    expect(t.act(`buy:${t.bread.id}`)).toBe('interaction_unavailable'); expect(t.p.wealth).toBe(100);
  });
  it('requires physical access to the seller as well as the stock', () => {
    const t = setup(); t.world.primaryBody(t.seller.id)!.pos = v(13, 1, 10); wall(t, 12, 8, 12);
    expect(t.act(`buy:${t.bread.id}`)).toBe('interaction_unavailable');
  });
  it('drinks from a reachable source, refusing distance, height, and walls', () => {
    const t = setup(); t.p.needs.thirst = 0.8;
    expect(t.act(`drink:${t.well.id}`)).toBe('interaction_unavailable'); expect(t.p.needs.thirst).toBe(0.8);
    const b = t.world.primaryBody(t.p.id)!; b.pos = v(18, 1, 10);
    expect(t.act(`drink:${t.well.id}`)).toBe('accepted'); expect(t.p.needs.thirst).toBeLessThan(0.8);
    wall(t, 19, 8, 12); const thirst = t.p.needs.thirst;
    expect(t.act(`drink:${t.well.id}`)).toBe('interaction_unavailable'); expect(t.sim.drinkHere(t.p)).toBe(false);
    b.pos = v(20, 7, 10); expect(t.sim.drinkHere(t.p)).toBe(false); expect(t.p.needs.thirst).toBe(thirst);
  });
  it('refuses actions while incapacitated', () => {
    const t = setup(); t.world.primaryBody(t.p.id)!.pose = 'downed';
    expect(t.act(`buy:${t.bread.id}`)).toBe('incapacitated'); expect(handInteractions(t.sim, t.p)).toEqual([]);
  });
  it('rejects replayed interaction packets and invalid types at the real bridge boundary', () => {
    const s = new BridgeSession(); const p = s.world.person(s.world.playerId)!;
    const food = makeItem(s.world, 'bread', 'Bread', { holder: p.id, owner: p.id, quantity: 2 }); p.needs.hunger = 0.7;
    const packet = { version: 1, sequence: 1, type: 'interact', interactionId: `consume:${food.id}` };
    expect(s.intent(packet).result).toBe('accepted'); expect(food.quantity).toBe(1);
    expect(s.intent(packet).result).toBe('invalid_sequence_or_version'); expect(food.quantity).toBe(1);
    expect(s.intent({ ...packet, sequence: 2, interactionId: 'grant:bread' }).result).toBe('invalid_interaction');
    expect(s.intent({ ...packet, sequence: 3, type: 'grant' }).result).toBe('invalid_intent');
    const snap = s.snapshot(); const player = snap.bodies.find(b => b.entityId === p.id)!;
    expect(player.wealth).toBe(p.wealth); expect(player.needs.hunger).toBeLessThan(0.7);
    expect(player.inventory.find(i => i.id === food.id)!.quantity).toBe(1);
  });
  it('keeps nearby resource extraction available through the real bridge interact path', () => {
    const s = new BridgeSession(); const p = s.world.person(s.world.playerId)!;
    const node = s.world.resourceNodes.find(n => n.state === 'available' && n.remaining > 0)!;
    expect(node).toBeDefined();
    const body = s.world.primaryBody(p.id)!;
    body.pos = { x: node.pos.x + 1.5, y: node.pos.y, z: node.pos.z };
    body.yaw = Math.PI / 2;
    const action = s.snapshot().interactions.find(a => a.kind === 'gather');
    expect(action).toBeDefined();
    const before = node.remaining;
    expect(s.intent({ version: 1, sequence: 1, type: 'interact', interactionId: action!.id }).result).toBe('accepted');
    expect(node.remaining).toBeLessThan(before);
    expect(s.world.events.some(e => e.type === 'resource_extracted' && e.actor === p.id)).toBe(true);
  });
});
