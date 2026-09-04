import type { Conflict, ConflictCause, ConflictIntent, ConflictOutcome, EntityId, EventId, Person, Tick } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_HOUR, SECONDS_PER_DAY } from '../core/time';

/**
 * Canonical conflict lifecycle (Constitution §11 "Conflict Must Have Intent", v0.2.3).
 *
 * The v0.2.2 scale-readiness audit established that Torn Veil could *start* and *escalate*
 * conflicts but had almost no general way to *end* them: fear/grudge only rose, hostile
 * entities re-engaged every time a knocked-down opponent recovered, and the retained-event
 * workload therefore grew without bound over calendar time (seed 918271: 150+ retained attack
 * events in one unresolved guard/bandit encounter; an 8-day headless run went pathological).
 *
 * A `Conflict` is the smallest coherent representation that lets a fight *end, cool, change
 * form, be suspended, or become socially resolved without a death*. It is owned by the
 * canonical simulation (`World.conflicts`); telemetry/anomaly/chronicle code may read it but
 * never mutates it. Everything here is deterministic — no RNG.
 */

// --- lifecycle tuning (world-time). Deliberately legible constants, not scattered magic numbers.
/** An `active` conflict with no blow/demand/pursuit for this long, with the parties no longer in
 * contact, lapses toward `disengaging`. ~40 world-minutes: long enough to span a scrappy running
 * fight, short enough that a genuinely abandoned fight ends promptly. */
export const STALE_ACTIVE_SECONDS = 40 * 60;
/** How long a `disengaging` conflict waits before it counts as over. One clean break. */
export const DISENGAGE_GRACE_SECONDS = 20 * 60;
/** A `suspended` (nonviolent-hostility) conflict with grudge fully cooled below this for a long
 * time can finally resolve to `reconciliation` — enemies who stopped caring. */
export const RECONCILE_GRUDGE = 0.12;
export const RECONCILE_AFTER_SECONDS = 3 * SECONDS_PER_DAY;
/** Escalation added per exchanged blow. */
const ESCALATION_PER_BLOW = 0.12;

/** How much intent hardens: higher rank = more lethal. Used to decide when `conflict_escalated`
 * should fire (rank went up) versus a routine intent refresh. */
const INTENT_RANK: Record<ConflictIntent, number> = {
  avoid: 0, threaten: 1, drive_off: 2, rob: 2, arrest: 3, subdue: 3, defend: 3, injure: 4, kill: 5,
};

export function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Keep only cause ids that still exist in the event index — a `Conflict` outlives many hourly
 * event-compaction passes, so `startEventId` (and a stale `causeEvent`) may already be gone by
 * the time the conflict resolves. Passing a dead id through to `emit` would leave a dangling
 * causal reference (an integrity anomaly). The event's causal ancestry is still preserved via
 * whatever surviving events DO reference it. */
function liveCauses(world: World, ...ids: (EventId | undefined)[]): EventId[] {
  return ids.filter((id): id is EventId => !!id && !!world.event(id));
}

/** The current unresolved (active/disengaging/suspended) conflict between two entities, if any. */
export function conflictBetween(world: World, a: EntityId, b: EntityId): Conflict | undefined {
  const key = pairKey(a, b);
  for (let i = world.conflicts.length - 1; i >= 0; i--) {
    const c = world.conflicts[i];
    if (c.status === 'resolved') continue;
    if (c.participants.length === 2 && pairKey(c.participants[0], c.participants[1]) === key) return c;
  }
  return undefined;
}

/** The most recent conflict between two entities regardless of status (for "have these two
 * fought before, and how did it end" — re-engagement gating). */
export function lastConflictBetween(world: World, a: EntityId, b: EntityId): Conflict | undefined {
  const key = pairKey(a, b);
  for (let i = world.conflicts.length - 1; i >= 0; i--) {
    const c = world.conflicts[i];
    if (c.participants.length === 2 && pairKey(c.participants[0], c.participants[1]) === key) return c;
  }
  return undefined;
}

/** Every conflict still counting as live (active or disengaging) that `id` is a party to. */
export function openConflictsFor(world: World, id: EntityId): Conflict[] {
  return world.conflicts.filter(c => (c.status === 'active' || c.status === 'disengaging') && c.participants.includes(id));
}

/** Entity ids `id` currently has a live (active/disengaging) conflict with — the "is there
 * still an active threat" signal relationship evolution needs so fear/grudge don't cool while a
 * fight is genuinely ongoing. */
export function activeThreatIds(world: World, id: EntityId): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const c of world.conflicts) {
    if (c.status !== 'active' && c.status !== 'disengaging') continue;
    if (!c.participants.includes(id)) continue;
    for (const p of c.participants) if (p !== id) out.add(p);
  }
  return out;
}

export interface BeginConflictOpts {
  initiator: EntityId;
  target: EntityId;
  cause: ConflictCause;
  intent: ConflictIntent;
  causeEvent?: EventId;
}

/**
 * Start a conflict, or return the existing unresolved one between the same two parties
 * (idempotent — a fight is one conflict no matter how many blows it contains). A `suspended`
 * conflict that is being freshly re-engaged is reactivated in place rather than duplicated.
 */
export function beginConflict(world: World, o: BeginConflictOpts): Conflict {
  const existing = conflictBetween(world, o.initiator, o.target);
  if (existing) {
    if (existing.status === 'suspended' || existing.status === 'disengaging') {
      existing.status = 'active';
      existing.lastMeaningfulInteraction = world.now;
      world.emit('conflict_started', {
        actor: o.initiator, target: o.target, causes: liveCauses(world, o.causeEvent), significance: 0.4,
        data: { conflictId: existing.id, cause: o.cause, intent: o.intent, reactivated: true },
        summary: `${world.nameOf(o.initiator)} renewed the conflict with ${world.nameOf(o.target)}`,
      });
    }
    return existing;
  }
  const id = world.nextId('cf');
  const startEvent = world.emit('conflict_started', {
    // Significance 0.5 keeps it past event compaction: a `conflict_resolved` (retained history)
    // cites it as its cause, and that reference must not dangle once the conflict ends hours later.
    actor: o.initiator, target: o.target, causes: liveCauses(world, o.causeEvent), significance: 0.5,
    data: { conflictId: id, cause: o.cause, intent: o.intent },
    summary: `${world.nameOf(o.initiator)} entered a conflict with ${world.nameOf(o.target)} (${o.cause.replace(/_/g, ' ')})`,
  });
  const c: Conflict = {
    id, participants: [o.initiator, o.target], initiator: o.initiator, cause: o.cause, intent: o.intent,
    status: 'active', escalation: 0, attackCount: 0, startedAt: world.now, lastMeaningfulInteraction: world.now,
    startEventId: startEvent.id,
  };
  world.conflicts.push(c);
  return c;
}

/** Record an exchanged blow: bumps escalation, refreshes the "still live" timestamp, and — if
 * the aggressor's intent has hardened — emits `conflict_escalated`. */
export function recordConflictBlow(world: World, c: Conflict, attacker: EntityId, intent?: ConflictIntent): void {
  c.attackCount++;
  c.escalation = Math.min(1, c.escalation + ESCALATION_PER_BLOW);
  c.lastMeaningfulInteraction = world.now;
  if (c.status === 'disengaging' || c.status === 'suspended') c.status = 'active';
  if (intent && INTENT_RANK[intent] > INTENT_RANK[c.intent]) {
    const from = c.intent; c.intent = intent;
    world.emit('conflict_escalated', {
      actor: attacker, target: c.participants.find(p => p !== attacker), significance: 0.5,
      data: { conflictId: c.id, from, to: intent, escalation: c.escalation },
      summary: `${world.nameOf(attacker)}'s intent toward ${world.nameOf(c.participants.find(p => p !== attacker))} hardened from ${from} to ${intent}`,
    });
  }
}

/** Note a non-violent but meaningful interaction (a demand, a confrontation, a pursuit step) so
 * a conflict that is still being actively prosecuted does not lapse as "stale". */
export function touchConflict(world: World, c: Conflict): void {
  c.lastMeaningfulInteraction = world.now;
  if (c.status === 'disengaging') c.status = 'active';
}

/** One side breaks off. Moves an active conflict to `disengaging` (a short grace before it
 * counts as over); `maintainConflicts` later settles it to `suspended`/`resolved`. */
export function disengageConflict(world: World, c: Conflict, who: EntityId, reason: string): void {
  if (c.status === 'resolved') return;
  if (c.status !== 'disengaging') {
    c.status = 'disengaging';
    c.lastMeaningfulInteraction = world.now;
    world.emit('conflict_disengaged', {
      actor: who, target: c.participants.find(p => p !== who), significance: 0.35,
      data: { conflictId: c.id, reason },
      summary: `${world.nameOf(who)} broke off the conflict with ${world.nameOf(c.participants.find(p => p !== who))} (${reason})`,
    });
  }
  c.data_disengagedBy = who; // transient hint for maintainConflicts' outcome choice
}

/** Terminally resolve a conflict with an outcome (Constitution §51: a real consequence, linked
 * causally). Idempotent — a second call on an already-resolved conflict is a no-op. */
export function resolveConflict(world: World, c: Conflict, outcome: ConflictOutcome, causeEvent?: EventId): void {
  if (c.status === 'resolved') return;
  c.status = 'resolved';
  c.outcome = outcome;
  c.resolvedAt = world.now;
  const [a, b] = c.participants;
  const ev = world.emit('conflict_resolved', {
    actor: c.initiator, target: c.participants.find(p => p !== c.initiator), causes: liveCauses(world, causeEvent, c.startEventId),
    significance: outcome === 'death' ? 0.9 : 0.6, category: 'history',
    data: { conflictId: c.id, outcome, cause: c.cause, attackCount: c.attackCount, durationWorldHours: Math.round((world.now - c.startedAt) / SECONDS_PER_HOUR * 10) / 10 },
    summary: `The conflict between ${world.nameOf(a)} and ${world.nameOf(b)} ended: ${outcome.replace(/_/g, ' ')}`,
  });
  c.resolveEventId = ev.id;
}

/** Suspend a conflict: the fighting has stopped but the hostility has not been resolved
 * (Constitution §11 "persistent nonviolent hostility"). Distinct from `resolved` — a suspended
 * conflict is exactly the state two rivals / feuding families / enemy factions sit in when they
 * are not currently attacking each other. */
export function suspendConflict(world: World, c: Conflict, reason: string): void {
  if (c.status === 'resolved' || c.status === 'suspended') return;
  c.status = 'suspended';
  c.lastMeaningfulInteraction = world.now;
  world.emit('conflict_disengaged', {
    actor: c.initiator, target: c.participants.find(p => p !== c.initiator), significance: 0.3,
    data: { conflictId: c.id, reason, suspended: true },
    summary: `The conflict between ${world.nameOf(c.participants[0])} and ${world.nameOf(c.participants[1])} went quiet (${reason})`,
  });
}

/**
 * Periodic conflict upkeep (call once per world-minute from `strategic()`, and from the
 * headless maintenance pass). Purely deterministic transitions over canonical state:
 *  - a party died           → resolve `death`
 *  - a party is in custody   → resolve `custody`
 *  - `active` but stale + parties out of contact → `disengaging`
 *  - `disengaging` past the grace window → `suspended` or `resolved` by who broke off / the cause
 *  - `suspended` with grudge long-cooled → `resolved` `reconciliation`
 */
export function maintainConflicts(world: World): void {
  const now = world.now;
  for (const c of world.conflicts) {
    if (c.status === 'resolved') continue;
    const parties = c.participants.map(id => world.person(id));
    const dead = parties.find(p => p && !p.alive);
    if (dead) { resolveConflict(world, c, 'death'); continue; }
    const detained = parties.find(p => p?.custody?.active);
    if (detained) { resolveConflict(world, c, 'custody'); continue; }

    const [pa, pb] = parties;
    const inContact = !!pa && !!pb && bodiesWithin(world, pa, pb, 16);
    const stale = now - c.lastMeaningfulInteraction;

    if (c.status === 'active') {
      if (stale >= STALE_ACTIVE_SECONDS && !inContact) {
        c.status = 'disengaging';
        c.lastMeaningfulInteraction = now;
        world.emit('conflict_disengaged', {
          actor: c.participants[0], target: c.participants[1], significance: 0.3,
          data: { conflictId: c.id, reason: 'contact lost' },
          summary: `The conflict between ${world.nameOf(c.participants[0])} and ${world.nameOf(c.participants[1])} petered out`,
        });
      }
      continue;
    }

    if (c.status === 'disengaging' && stale >= DISENGAGE_GRACE_SECONDS) {
      const brokeOff = c.data_disengagedBy;
      // Who left decides the outcome. If the aggressor broke off: withdrawal/deterrence.
      // If the defender/target fled: target_fled. Otherwise it just went cold → suspended.
      if (brokeOff && brokeOff === c.initiator) {
        resolveConflict(world, c, c.cause === 'crime_response' ? 'deterrence' : 'withdrawal');
      } else if (brokeOff && brokeOff !== c.initiator) {
        resolveConflict(world, c, c.cause === 'crime_response' ? 'aggressor_fled' : 'target_fled');
      } else {
        suspendConflict(world, c, 'no further contact');
      }
      continue;
    }

    if (c.status === 'suspended' && now - c.lastMeaningfulInteraction >= RECONCILE_AFTER_SECONDS) {
      const mutualGrudge = Math.max(
        pa?.relationships[c.participants[1]]?.grudge ?? 0,
        pb?.relationships[c.participants[0]]?.grudge ?? 0,
      );
      const grievance = Math.max(
        pa?.relationships[c.participants[1]]?.grievance ?? 0,
        pb?.relationships[c.participants[0]]?.grievance ?? 0,
      );
      if (mutualGrudge < RECONCILE_GRUDGE && grievance < RECONCILE_GRUDGE) {
        resolveConflict(world, c, 'reconciliation');
      }
    }
  }
}

function bodiesWithin(world: World, a: Person, b: Person, d: number): boolean {
  const ba = world.primaryBody(a.id); const bb = world.primaryBody(b.id);
  if (!ba || !bb) return false;
  return Math.hypot(ba.pos.x - bb.pos.x, ba.pos.z - bb.pos.z) <= d;
}
