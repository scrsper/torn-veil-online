import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { DialogueSystem } from '../src/sim/mind/dialogue';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { learn } from '../src/sim/mind/knowledge';

/**
 * v0.8 "The Legible World" §E: a generated lost/stolen-property task (`Desire` type
 * `recover_item`) must be completable end-to-end using real canonical entities and items — no
 * quest-only phantom copy, no teleporting quest object, no fake scripted completion. This
 * exercises the exact chain the acceptance criteria describe:
 *   identify who wants it → find who knows where it is → find the real item → pick it up →
 *   return it → real payment/knowledge-state changes as a result.
 */
describe('generated lost/stolen-property task, end to end (v0.8 §E)', () => {
  it('the player can learn a desire exists, ask a DIFFERENT knowledgeable NPC where the item is, then actually return it', () => {
    const tw = createTestWorld(960, 20);
    const player = addPerson(tw, 'the Traveler', 'traveler', v(3.5, 1, 3.5), { controlled: true });
    const requester = addPerson(tw, 'Cedric', 'farmer', v(4.5, 1, 3.5));
    const witness = addPerson(tw, 'Old Wyn', 'herbalist', v(5.5, 1, 3.5));
    const shrine = makePlace(tw.world, 'chapel', 'the old shrine', { x0: 10, z0: 10, x1: 16, z1: 16, y0: 1, y1: 4 }, { inside: v(13, 1, 13) });
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: requester.id, pos: v(13, 1, 13), placeId: shrine.id });
    requester.desires.push({ type: 'recover_item', targetId: ring.id, note: "My ring was lost. I'd give anything to have it back.", reward: 30, fulfilled: false });
    // Only the witness has real, first-hand location knowledge — the requester does NOT (they
    // don't know where it ended up, only that it's gone), and the player starts knowing nothing.
    learn(tw.world, witness, { key: `loc:${ring.id}`, kind: 'location', claim: { entityId: ring.id, pos: ring.pos, placeId: shrine.id }, confidence: 0.9, source: { type: 'witnessed' } }, true);

    const dlg = new DialogueSystem(tw.world, tw.sim);

    // 1. Player identifies who wants the item back.
    const withRequester = dlg.start(requester, player);
    const needOption = withRequester.options.find(o => o.label === 'Is there anything you need?');
    expect(needOption).toBeTruthy();
    const heard = needOption!.next()!;
    expect(heard.lines.join(' ')).toContain('ring');
    expect(player.knowledge[`wanted:${ring.id}`]).toBeTruthy(); // real, retained knowledge — not just ephemeral UI text

    // 2. Player asks a DIFFERENT NPC (the actual knowledge-holder) about the item.
    const withWitness = dlg.start(witness, player);
    const askOption = withWitness.options.find(o => o.label === 'Ask about an item…');
    expect(askOption).toBeTruthy();
    const itemMenu = askOption!.next()!;
    const ringOption = itemMenu.options.find(o => o.label.includes('ring'));
    expect(ringOption).toBeTruthy();
    const answer = ringOption!.next()!;
    expect(answer.lines.join(' ')).toContain('old shrine'); // the REAL canonical place, grounded in witness's own knowledge
    expect(answer.lines.join(' ')).not.toContain('Cedric said'); // never attributed to someone who doesn't actually know

    // 3. Player physically travels to the real place and picks up the REAL item (no phantom copy).
    const pickedUp = tw.sim.takeItem(player, ring, 'pickup');
    expect(pickedUp.type).toBe('theft'); // it still belongs to Cedric — taking it without him present is recorded honestly
    expect(ring.holderId).toBe(player.id);
    expect(player.inventory).toContain(ring.id);

    // 4. Player returns it to the actual requester — real canonical payment/state change.
    const returnEv = tw.sim.giveItem(player, requester, ring);
    expect(returnEv.type).toBe('returned_item');
    expect(ring.ownerId).toBe(requester.id);
    expect(requester.desires.find(d => d.targetId === ring.id)?.fulfilled).toBe(true);
  });
});
