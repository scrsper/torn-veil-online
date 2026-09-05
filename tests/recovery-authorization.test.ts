import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { makeItem } from '../src/sim/world/factory';
import { learn } from '../src/sim/mind/knowledge';

/**
 * v0.8 §1A: `Simulation.takeItem`/`isAuthorizedRecovery` must not record a legitimate,
 * evidence-gated recovery as theft — but must also NOT globally exempt owned items from theft.
 * Only the narrow case (active request for THIS item + actor actually learned of THAT request)
 * is authorized; every other owned-item pickup remains theft.
 */
describe('recover-item authorization is grounded, not a blanket exemption (v0.8 §1A)', () => {
  it('picking up an unrelated owned item (no recovery request at all) is still theft', () => {
    const tw = createTestWorld(101, 20);
    const owner = addPerson(tw, 'Mira', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const hat = makeItem(tw.world, 'flowers', "Mira's hat", { owner: owner.id, pos: v(4, 1, 4) });

    const ev = tw.sim.takeItem(taker, hat, 'pickup');
    expect(ev.type).toBe('theft');
  });

  it('picking up the exact item someone has an active request for, without ever having learned of that request, is still theft', () => {
    const tw = createTestWorld(102, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 10, fulfilled: false });
    // `taker` never asked Cedric or anyone else, so they hold no `wanted:<id>` knowledge.

    const ev = tw.sim.takeItem(taker, ring, 'pickup');
    expect(ev.type).toBe('theft');
  });

  it('picking up the exact requested item, having actually learned of the active request, is an authorized recovery — not theft', () => {
    const tw = createTestWorld(103, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 10, fulfilled: false });
    // Grounded knowledge, granted the same way DialogueSystem.hearDesire grants it.
    learn(tw.world, taker, { key: `wanted:${ring.id}`, kind: 'fact', claim: { text: 'lost ring', wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 10 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);

    const ev = tw.sim.takeItem(taker, ring, 'pickup');
    expect(ev.type).toBe('recovered');
    expect(ring.holderId).toBe(taker.id);
    expect(ring.ownerId).toBe(owner.id); // ownership doesn't transfer just by carrying it back
  });

  it('a request that has already been fulfilled no longer authorizes a further pickup', () => {
    const tw = createTestWorld(104, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 10, fulfilled: true });
    learn(tw.world, taker, { key: `wanted:${ring.id}`, kind: 'fact', claim: { text: 'lost ring', wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 10 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);

    const ev = tw.sim.takeItem(taker, ring, 'pickup');
    expect(ev.type).toBe('theft');
  });

  it('knowledge about a DIFFERENT item does not authorize picking up this one', () => {
    const tw = createTestWorld(105, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    const otherRing = makeItem(tw.world, 'ring', "Cedric's other ring", { owner: owner.id, pos: v(5, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 10, fulfilled: false });
    learn(tw.world, taker, { key: `wanted:${otherRing.id}`, kind: 'fact', claim: { text: 'lost other ring', wantedItem: true, itemId: otherRing.id, requesterId: owner.id, reward: 5 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);

    const ev = tw.sim.takeItem(taker, ring, 'pickup');
    expect(ev.type).toBe('theft');
  });

  it('returning an authorized recovery pays the real, conserved reward when the requester can afford it in full', () => {
    const tw = createTestWorld(106, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    owner.wealth = 100;
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 10, fulfilled: false });
    learn(tw.world, taker, { key: `wanted:${ring.id}`, kind: 'fact', claim: { text: 'lost ring', wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 10 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    tw.sim.takeItem(taker, ring, 'pickup');

    const takerWealthBefore = taker.wealth;
    const ev = tw.sim.giveItem(taker, owner, ring);
    expect(ev.type).toBe('returned_item');
    expect(owner.desires.find(d => d.targetId === ring.id)?.fulfilled).toBe(true);
    expect(owner.wealth).toBe(90);
    expect(taker.wealth).toBe(takerWealthBefore + 10);
    expect(tw.world.events.some(e => e.type === 'reward_paid' && e.data.amount === 10)).toBe(true);
  });

  it('an insolvent requester pays only what they actually have — no debt, no manufactured currency', () => {
    const tw = createTestWorld(107, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    owner.wealth = 3;
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 30, fulfilled: false });
    learn(tw.world, taker, { key: `wanted:${ring.id}`, kind: 'fact', claim: { text: 'lost ring', wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 30 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    tw.sim.takeItem(taker, ring, 'pickup');

    const takerWealthBefore = taker.wealth;
    tw.sim.giveItem(taker, owner, ring);
    expect(owner.wealth).toBe(0); // paid everything it had, not more
    expect(taker.wealth).toBe(takerWealthBefore + 3);
  });

  it('a zero reward pays nothing and emits no reward_paid event', () => {
    const tw = createTestWorld(108, 20);
    const owner = addPerson(tw, 'Cedric', 'farmer', v(4, 1, 4));
    const taker = addPerson(tw, 'Taker', 'traveler', v(4, 1, 4), { controlled: true });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(4, 1, 4) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'Lost my ring.', reward: 0, fulfilled: false });
    learn(tw.world, taker, { key: `wanted:${ring.id}`, kind: 'fact', claim: { text: 'lost ring', wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 0 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    tw.sim.takeItem(taker, ring, 'pickup');

    const ownerWealthBefore = owner.wealth; const takerWealthBefore = taker.wealth;
    tw.sim.giveItem(taker, owner, ring);
    expect(owner.wealth).toBe(ownerWealthBefore);
    expect(taker.wealth).toBe(takerWealthBefore);
    expect(tw.world.events.some(e => e.type === 'reward_paid')).toBe(false);
  });
});
