import type { EntityId, ItemType, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import { learn } from '../mind/knowledge';
import { remember } from '../mind/memory';
import { formConcerns } from '../mind/concern';

/**
 * WORK STOPPAGE AS SOMETHING A MIND CAN HOLD (Causal Society).
 *
 * The physical chain "the miller stops → no flour reaches the bakery → no bread is baked" already
 * existed and already worked. What did not exist was any COGNITIVE trace of it. `mill()`/`bake()`
 * returned `{ shortage: 'grain' }` to a caller that read only `.ok`, so a stoppage that lasted
 * days left nothing behind in anybody's head: nobody believed it, nobody carried it, nobody
 * mentioned it, and nothing anyone did later could be traced back to it. That is precisely the
 * "multi-step consequences do not propagate" gap — the propagation was blocked at the step where
 * the world would have had to become knowledge.
 *
 * This module is that one step, and nothing more. It does not decide what anyone does about a
 * shortage (that is `social/appraisal.ts` → `mind/concern.ts` → goal utility, exactly as for
 * every other belief), and it does not invent demand (the stoppage has to actually happen).
 *
 * THE BELIEF IS A STANDING STATE, NOT A STREAM OF EVENTS. Its key is `short:<place>:<resource>`,
 * so a mill that stands idle for three days leaves ONE belief that keeps being reconfirmed,
 * rather than a hundred near-identical ones — the same discipline `absence.ts` applies to a
 * continuing absence, and the reason this can be perceivable without becoming event spam.
 */

/** How long a standing shortage belief stays fresh before the same worker, failing again at the
 * same work, is treated as fresh news rather than as the same morning repeating. Chosen to be
 * longer than a working day's batch cadence (~8 world-minutes) by two orders of magnitude, so a
 * genuine multi-day stoppage produces a handful of canonical events, not hundreds. */
export const SHORTAGE_RENOTICE_SECONDS = 8 * 3600;

/**
 * How newsworthy a stoppage is in itself, before anybody appraises it. Deliberately BELOW a
 * theft or a missing item (0.45): a trade standing idle is real and consequential, but it is not
 * on a par with somebody being robbed, and it must not out-rank one in conversation for people
 * it does not touch. The people it DOES touch get their weight from their structural role in it
 * (livelihood, downstream, supplier, the one it stopped), not from this number.
 *
 * Measured: at 0.45 a bakery stockout out-scored a genuine theft in  for listeners
 * with no stake in either, which  caught as the theft
 * failing to travel at all.
 */
export const WORK_BLOCKED_SIGNIFICANCE = 0.35;

/** How far a stalled trade is visible. Small on purpose: you have to be there to see the bins
 * empty and the wheel still. It is not an announcement. */
export const WORK_BLOCKED_VISIBILITY = 9;

export function shortfallKey(placeId: EntityId, resource: ItemType): string { return `short:${placeId}:${resource}`; }

/**
 * A worker stood at their own trade and could not carry it out for want of `resource`.
 *
 * Returns the worker's own belief when this was a fresh stoppage worth a canonical event, and
 * null when it was merely the same standing shortage confirming itself again (in which case the
 * existing belief is reconfirmed in place — a mind that keeps finding the bin empty becomes more
 * certain of it, not more forgetful).
 */
export function noteWorkBlocked(world: World, worker: Person, placeId: EntityId, resource: ItemType, making: ItemType, laborSeconds?: number): KnowledgeItem | null {
  const key = shortfallKey(placeId, resource);
  const existing: KnowledgeItem | undefined = worker.knowledge[key];
  // Only my own already-recorded attempt can be quietly reconfirmed. Trying work after
  // hearing of its shortage is new firsthand evidence, with its own event and provenance.
  if (existing && existing.source.type === 'self' && existing.claim.actor === worker.id
    && existing.handled !== true && world.now - existing.learnedAt < SHORTAGE_RENOTICE_SECONDS) {
    existing.lastConfirmedAt = world.now;
    existing.confidence = 1;
    return null;
  }
  const body = world.primaryBody(worker.id);
  const place = world.place(placeId);
  const pos = body ? { ...body.pos } : place ? { ...place.inside } : undefined;
  const ev = world.emit('work_blocked', {
    causes: worker.mind.goal?.causeEvent && world.event(worker.mind.goal.causeEvent) ? [worker.mind.goal.causeEvent] : [],
    actor: worker.id, target: worker.id, placeId, pos,
    significance: WORK_BLOCKED_SIGNIFICANCE, visibility: WORK_BLOCKED_VISIBILITY,
    data: { need: resource, making, trade: worker.occupation, ...(laborSeconds === undefined ? {} : { laborSeconds }) },
    summary: `${worker.name} could not make ${making} at ${world.nameOf(placeId)}: there is no ${resource}`,
  });
  const claim = {
    eventId: ev.id, type: 'work_blocked', actor: worker.id, target: worker.id,
    placeId, need: resource, making, tick: world.now, significance: ev.significance,
  };
  // The worker knows FIRST-HAND, because they are the one who found the bin empty — the same
  // reason `applyHit` teaches a victim directly rather than waiting for them to perceive their
  // own beating. Perception cannot do it: `perceive` skips events this person is the actor of.
  //
  // A shortage that is standing again after the renotice window is refreshed IN PLACE rather than
  // re-learned: `learn` would read the new `eventId` as a bare correction and decline to touch
  // anything at all, leaving the belief pointing at a stale event. Crucially the refresh keeps
  // `sharedWith` — a stoppage that is still going on is not news to the people who were already
  // told about it, and clearing that list is how one continuing shortage turns into a village-
  // wide retelling every eight hours.
  let belief: KnowledgeItem | undefined = existing;
  if (belief) {
    // `tick` — WHEN the shortage began — is deliberately NOT refreshed. `mind/conversation.ts`
    // decays a topic's news value by how long ago the thing HAPPENED, and a shortage that has
    // been true for a week is not news however many times its owner has re-confirmed it since.
    // Refreshing it made a standing stockout permanently the freshest thing in the village and
    // let it out-talk everything else indefinitely.
    const began = belief.claim.tick;
    belief.claim = { ...belief.claim, ...claim, tick: began };
    belief.confidence = 1;
    belief.handled = undefined;
    belief.source = { type: 'self', viaEvent: ev.id };
    belief.hops = 0;
    belief.learnedAt = world.now;
    belief.lastConfirmedAt = world.now;
  } else {
    belief = learn(world, worker, {
      key, kind: 'event', claim,
      confidence: 1, source: { type: 'self', viaEvent: ev.id }, cause: ev.id,
      summary: `there is no ${resource} at ${world.nameOf(placeId)}`,
    }) ?? undefined;
  }
  if (belief) {
    formConcerns(world, worker, belief);
    remember(world, worker, {
      type: 'work_blocked',
      summary: `I could not make ${making}: there is no ${resource} at ${world.nameOf(placeId)}`,
      eventId: ev.id, entities: [], significance: 0.4, valence: -0.35,
      source: { type: 'self', viaEvent: ev.id }, placeId,
    });
  }
  return belief ?? null;
}

/**
 * The shortage is over, as far as this person can now see: they just made a batch out of the
 * very material they believed was gone. Retracts rather than deletes, for the same reason
 * `absence.ts` retracts a settled absence — a belief must track its evidence, and the fact that
 * this person once found the place empty stays true and stays sayable.
 */
export function clearShortfall(world: World, worker: Person, placeId: EntityId, resource: ItemType): void {
  const k = worker.knowledge[shortfallKey(placeId, resource)];
  if (!k || k.handled) return;
  k.handled = true;
  k.confidence = 0.15;
  k.lastConfirmedAt = world.now;
}

/** Everything this person currently believes is in short supply somewhere. Bounded by the
 * knowledge map's own cap; typically empty. */
export function shortfallBeliefs(p: Person): KnowledgeItem[] {
  const out: KnowledgeItem[] = [];
  for (const k of Object.values(p.knowledge)) {
    if (k.kind === 'event' && k.claim.type === 'work_blocked' && !k.handled) out.push(k);
  }
  return out;
}
