import type { Person, Request } from '../core/types';
import type { World } from '../core/world';
import { acceptRequest, cancelRequest, completeRequest, createRequest } from '../core/requests';
import { isFood } from '../world/factory';
import { isExternallyControlled } from '../runtime/controllers';

/**
 * Provision requests: someone hungry, carrying no food, asks aloud for something to eat and
 * puts up what silver they can.
 *
 * The same shape as protection requests (social/protection.ts) and just as unscripted. The ask
 * exists only while the person is actually hungry and actually holds no food; it is an audible
 * event, so only those who see or hear it know of it; it is met by whoever really hands them
 * food (any person, by the ordinary gift path) and that giver is paid the ordinary conserved
 * request wage from the requester's own wealth. Food they find for themselves just ends it.
 */
export const PROVISION = Object.freeze({
  /** Physiological energy below which an empty-handed person asks (1 = fed, 0 = starving). */
  hungryBelow: .55,
  /** Metres at which the ask is heard / seen. */
  loudness: 9, visibility: 12,
  /** Do not ask again within this many world seconds of the last ask. */
  repeatSeconds: 6 * 3600, expirySeconds: 2 * 86400, maxReward: 4,
});

export function foodHeld(world: World, p: Person): number {
  let n = 0;
  for (const id of p.inventory) { const it = world.item(id); if (it && it.holderId === p.id && it.quantity > 0 && isFood(it.type)) n += it.quantity; }
  return n;
}
/** The person who handed the requester food after they asked, read from the canonical `gift`
 * events (newest first), so a gift already eaten still counts as the need having been met. */
function giftSince(world: World, p: Person, r: Request): { giverId: string; eventId: string } | null {
  for (let i = world.events.length - 1; i >= 0; i--) {
    const e = world.events[i]; if (e.tick < r.createdAt) break;
    if (e.type === 'gift' && e.target === p.id && e.actor && e.actor !== p.id && isFood(e.data.itemType)) return { giverId: e.actor, eventId: e.id };
  }
  return null;
}

/** Coarse-cadence upkeep: settle met needs, drop ended ones, and let the newly hungry ask. */
export function maintainProvisionRequests(world: World): void {
  for (const r of world.requests) {
    if (r.type !== 'provision' || (r.status !== 'open' && r.status !== 'accepted')) continue;
    const requester = r.requesterId ? world.person(r.requesterId) : undefined;
    if (!requester?.alive || world.now - r.createdAt > PROVISION.expirySeconds) { cancelRequest(world, r); continue; }
    const gift = giftSince(world, requester, r), giver = gift && world.person(gift.giverId);
    if (gift && giver) {
      if (r.acceptedBy !== giver.id) acceptRequest(world, r, giver, r.acceptedBy);
      r.payload.fulfilledByEventId = gift.eventId;
      completeRequest(world, r);
    } else if (foodHeld(world, requester)) cancelRequest(world, r); // found food for themselves
  }
  for (const p of world.livingPersons()) {
    if (isExternallyControlled(p) || p.physiology.energy >= PROVISION.hungryBelow || foodHeld(world, p)) continue;
    const body = world.primaryBody(p.id); if (!body?.present || body.dead || body.pose === 'sleep' || body.pose === 'downed') continue;
    if (world.requests.some(r => r.type === 'provision' && r.requesterId === p.id && ((r.status === 'open' || r.status === 'accepted') || world.now - r.createdAt < PROVISION.repeatSeconds))) continue;
    const reward = Math.max(0, Math.min(PROVISION.maxReward, Math.floor(p.wealth * .2)));
    createRequest(world, { type: 'provision', requesterId: p.id, requesterPlaceId: world.placeAt(body.pos)?.id, reward,
      cause: `${p.name} is going hungry with nothing to eat${reward ? ` and offers ${reward} silver for food` : ''}`,
      payload: { seenAt: { ...body.pos } }, announce: { actor: p.id, pos: body.pos, loudness: PROVISION.loudness, visibility: PROVISION.visibility } });
    p.speech = { text: reward ? `Has anyone food to spare? I can pay ${reward} silver.` : 'Has anyone a bite to spare?', until: world.physicalTime + 5 };
  }
}
