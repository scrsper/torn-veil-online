import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, face, v } from './helpers/world';
import { makeItem } from '../src/sim/world/factory';

/**
 * v0.8 §P0-G/H (independent audit §4.6): proves the recovery chain becomes actionable starting
 * from a genuinely NATURAL condition — a lost item nobody has been told the location of — rather
 * than a WorldLab scenario (or a test) pre-authoring the answer via a scripted `learn()` call.
 * Every fact either party ends up knowing here is produced by the real mechanism that would
 * produce it in play: `mind/agent.ts`'s item-location `perceive()`, `pickGossip`/`tell` (gossip
 * carrying it onward), `maybeAskForHelp` (third-party authorization), and real goal-formation +
 * physical pickup/delivery — never a direct `learn()` call in the test itself.
 */
describe('P0-G/H: emergent item recovery (no pre-authored knowledge)', () => {
  it('a witness perceives a lost ring on their own; gossip carries the location to the owner; the owner recovers it themselves', () => {
    const tw = createTestWorld(801, 60);
    const owner = addPerson(tw, 'Rosalind', 'farmer', v(50, 1, 50), { traits: { sociability: 0.9, honesty: 0.9 } });
    const witness = addPerson(tw, 'Cobb', 'apprentice', v(3, 1, 4), { traits: { sociability: 0.9, honesty: 0.9 } });
    const ring = makeItem(tw.world, 'ring', "Rosalind's ring", { owner: owner.id, pos: v(3, 1, 3) });
    // The one fact the owner is entitled to know without witnessing anything: their OWN item is
    // missing (Constitution §9/§37 — an owner's belief about their own property is not
    // omniscience). Nobody, including the witness, has been told WHERE it is.
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: "My ring was lost. I would give anything to have it back.", reward: 20, fulfilled: false });

    expect(owner.knowledge[`loc:${ring.id}`]).toBeUndefined();
    expect(witness.knowledge[`loc:${ring.id}`]).toBeUndefined();

    // Step 1: the witness, standing right next to the loose ring, perceives it on their own —
    // no scripted knowledge grant.
    face(witness, tw, ring.pos!);
    step(tw, 5);
    const witnessLoc = witness.knowledge[`loc:${ring.id}`];
    expect(witnessLoc).toBeDefined();
    expect(witnessLoc!.source.type).toBe('witnessed');
    // The owner, 66+ units away on the far side of the map, still knows nothing.
    expect(owner.knowledge[`loc:${ring.id}`]).toBeUndefined();

    // Step 2: bring the witness into the owner's presence (they had never been physically close
    // before this point) and let real gossip do the rest.
    const ownerBody = tw.world.primaryBody(owner.id)!;
    const witnessBody = tw.world.primaryBody(witness.id)!;
    witnessBody.pos = { x: ownerBody.pos.x + 1.5, y: ownerBody.pos.y, z: ownerBody.pos.z };
    face(witness, tw, ownerBody.pos);
    face(owner, tw, witnessBody.pos);
    step(tw, 120);

    const ownerLoc = owner.knowledge[`loc:${ring.id}`];
    expect(ownerLoc).toBeDefined();
    expect(ownerLoc!.source.type).toBe('told');

    // Step 3: the owner's own cognition, acting on knowledge it genuinely acquired, walks back
    // across the map and physically recovers the ring — closing REQUEST EXISTS -> ... -> RETURNED.
    step(tw, 900);
    expect(ring.holderId).toBe(owner.id);
    expect(owner.desires.find(d => d.targetId === ring.id)!.fulfilled).toBe(true);
  });

  it('a third party who is both authorized (asked for help) and informed (perceived the location) fetches and delivers the item themselves', () => {
    const tw = createTestWorld(802, 60);
    const owner = addPerson(tw, 'Marek', 'farmer', v(3, 1, 4), { traits: { sociability: 0.9, honesty: 0.9 } });
    const helper = addPerson(tw, 'Ysolde', 'apprentice', v(3, 1, 3.8), { traits: { sociability: 0.9, honesty: 0.9 } });
    const ring = makeItem(tw.world, 'ring', "Marek's ring", { owner: owner.id, pos: v(50, 1, 50) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: "My ring was lost. I would give anything to have it back.", reward: 20, fulfilled: false });

    // The helper starts right next to the owner (so they will talk) but on the OPPOSITE side of
    // the map from the ring — any location knowledge they end up with must come from travel +
    // real perception, not proximity to the owner.
    face(owner, tw, tw.world.primaryBody(helper.id)!.pos);
    face(helper, tw, tw.world.primaryBody(owner.id)!.pos);
    step(tw, 60); // owner asks for help (maybeAskForHelp) -> helper learns `wanted:<ring.id>`
    expect(helper.knowledge[`wanted:${ring.id}`]).toBeDefined();
    expect(helper.knowledge[`loc:${ring.id}`]).toBeUndefined();

    // Walk the helper over to where the ring actually is and let them perceive it for real.
    const helperBody = tw.world.primaryBody(helper.id)!;
    helperBody.pos = { x: ring.pos!.x + 1, y: ring.pos!.y, z: ring.pos!.z };
    face(helper, tw, ring.pos!);
    step(tw, 5);
    expect(helper.knowledge[`loc:${ring.id}`]).toBeDefined();

    // Now the helper has BOTH facts through real channels — enough for the new
    // 'help_recover_item' goal to form and for them to fetch and deliver the ring themselves.
    step(tw, 900);
    expect(ring.holderId).toBe(owner.id);
    const desire = owner.desires.find(d => d.targetId === ring.id)!;
    expect(desire.fulfilled).toBe(true);
  });
});
