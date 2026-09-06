import type { EntityId, Person } from '../core/types';
import type { World } from '../core/world';
import { currentScheduleEntry } from '../mind/schedule';
import { learn } from '../mind/knowledge';
import { remember } from '../mind/memory';
import { resolveSituation, situationForEvent } from './situation';
import { formConcerns } from '../mind/concern';

/**
 * ABSENCE — the generic "you were not where I expected you" inference (v0.9 §D).
 *
 * The milestone asks for REAL secondary consequences: "an injured worker being absent,
 * impaired, protected, assisted, replaced, avoided, pursued." The hard part is not making the
 * injured person stay home — physiology and goal utility already do that once injury actually
 * costs something. The hard part is that, before this, NOBODY COULD TELL. A mind only learned
 * things that were emitted as events and perceived; there is no event for "did not turn up."
 *
 * So this is an inference from an information GAP, made by a specific person, at a specific
 * place, about a specific expectation, and stamped with `source: 'inferred'` exactly like the
 * pre-existing "my item is missing from its place" inference in `Simulation.strategic`. It is
 * completely generic about WHY someone is absent: injured, in custody, dead, fled, or simply
 * off doing something else. The inference is only ever "they were not here", never "they are
 * hurt" — that stronger belief has to arrive some other honest way (seeing them, being told).
 *
 * It also cannot fabricate: the expectation itself comes from public, observable structure
 * (we work at the same place / we share a roof), and the evidence is this person's own
 * `loc:<id>` knowledge — what they have actually seen — not the world's view of where anyone is.
 */

/** How long someone must be unaccounted for, during a period I expect to see them, before it
 * registers as a real absence rather than "they stepped out." */
// Deliberately longer than one shift's worth of not happening to be in the same room. Measured
// directly on the v0.9 trace harness (seed 918271): at 5 hours, staggered tavern shifts alone
// produced a steady stream of mutual "they have not been here" inferences between people who
// were simply working different hours — a true statement, but not evidence of anything, and it
// buried the real absences in noise. Ten hours is longer than any single shift gap in the
// generated village's schedules, so what survives is a genuine failure to appear.
export const WORK_ABSENCE_SECONDS = 10 * 3600;
export const HOUSEHOLD_ABSENCE_SECONDS = 10 * 3600;
/** Do not re-notice the same absence over and over. Two full days: a continuing absence is one
 * ongoing matter that the observer already holds a belief and (often) a concern about — noticing
 * it afresh every day adds no information and, measured at seed 918271, produced roughly 80
 * inferences a day across a 32-person village. */
export const ABSENCE_RENOTICE_SECONDS = 48 * 3600;

export interface Expectation { who: EntityId; placeId: EntityId; kind: 'work' | 'household'; threshold: number; }

/**
 * Whom this person has a plain, publicly-grounded reason to expect to see right now, and where.
 * Two rules, no names: people I work with while I am at work, and people I live with at night.
 */
export function currentExpectations(world: World, p: Person, hour: number): Expectation[] {
  const out: Expectation[] = [];
  const body = world.primaryBody(p.id);
  if (!body || !p.alive || p.controlled) return out;
  const here = world.placeAt(body.pos)?.id;
  const sched = currentScheduleEntry(p, hour);
  if (p.workId && here === p.workId && sched?.activity === 'work') {
    for (const q of world.persons()) {
      if (q.id === p.id || !q.alive || q.controlled) continue;
      if (q.workId !== p.workId) continue;
      out.push({ who: q.id, placeId: p.workId, kind: 'work', threshold: WORK_ABSENCE_SECONDS });
    }
  }
  if (p.householdId && p.homeId && here === p.homeId && (hour >= 20 || hour < 6)) {
    for (const q of world.persons()) {
      if (q.id === p.id || !q.alive || q.controlled) continue;
      if (!q.householdId || q.householdId !== p.householdId) continue;
      out.push({ who: q.id, placeId: p.homeId, kind: 'household', threshold: HOUSEHOLD_ABSENCE_SECONDS });
    }
  }
  return out;
}

/**
 * Run the inference for one person. Called from the coarse strategic pass — same cadence and
 * same spirit as the existing "noticed my item is missing" inference.
 */
export function noticeAbsences(world: World, p: Person, hour: number): void {
  const expectations = currentExpectations(world, p, hour);
  if (!expectations.length) return;
  const now = world.now;
  for (const exp of expectations) {
    const key = `absent:${exp.who}`;
    const seenNow = p.mind.percepts.some(pc => pc.entityId === exp.who);
    const existing = p.knowledge[key];
    if (seenNow) {
      // They are here after all: my own eyes settle it. Retract rather than let a stale,
      // confident false belief sit in the map (Constitution §5 — beliefs must track evidence).
      if (existing && !existing.handled) {
        existing.handled = true;
        existing.confidence = 0.1;
        existing.lastConfirmedAt = now;
        // Settle the real ongoing matter this absence opened, through the same
        // `resolveSituation` every other resolution goes through — an earlier version emitted a
        // bare `situation_resolved` event that referred to no Situation at all, so the matter
        // stayed 'active' forever in `World.situations` while the event log claimed otherwise.
        //
        // Deliberately NO resolving event: the evidence here is this observer's own eyes, which
        // is already recorded as their `loc:` knowledge and as `handled` on the belief above —
        // not a happening in the world. Synthesizing one purely to have something to cite was
        // worse than nothing: the invented `arrived` event is excluded from the telemetry stream
        // (recorder.ts's SKIP_TYPES), so every situation_resolved that cited one became a
        // genuinely broken causal reference, which is exactly what WorldLab's `dangling_cause`
        // check exists to catch. A matter no one else can know is settled correctly reads as
        // still open to everyone else (personalSituationView).
        const sit = situationForEvent(world, existing.claim.eventId as string | undefined);
        if (sit && sit.status === 'active') resolveSituation(world, sit, 'returned_to_work');
      }
      continue;
    }
    if (existing && (existing.handled !== true) && now - existing.learnedAt < ABSENCE_RENOTICE_SECONDS) continue;
    if (existing && existing.handled && now - existing.learnedAt < ABSENCE_RENOTICE_SECONDS) continue;
    // What do my own eyes actually say about when I last saw them?
    const loc = p.knowledge[`loc:${exp.who}`];
    const lastSeenAt = loc?.learnedAt ?? -Infinity;
    const gap = now - lastSeenAt;
    if (!(gap > exp.threshold)) continue;
    // A gap I have no way to have measured (I have literally never seen this person) is not
    // evidence of an absence — do not manufacture one.
    if (!loc) continue;

    const ev = world.emit('absence_noticed', {
      actor: p.id, target: exp.who, placeId: exp.placeId, pos: world.primaryBody(p.id)?.pos,
      significance: exp.kind === 'work' ? 0.4 : 0.45,
      data: { kind: exp.kind, hoursUnseen: Math.round(gap / 3600) },
      summary: `${p.name} noticed ${world.nameOf(exp.who)} has not been at ${world.nameOf(exp.placeId)}`,
    });
    const belief = learn(world, p, {
      key, kind: 'event',
      claim: { eventId: ev.id, type: 'absence_noticed', actor: p.id, target: exp.who, placeId: exp.placeId, tick: now, significance: ev.significance, hoursUnseen: Math.round(gap / 3600) },
      confidence: 0.85, source: { type: 'inferred', viaEvent: ev.id }, cause: ev.id,
      summary: `${world.nameOf(exp.who)} has not been at ${world.nameOf(exp.placeId)}`,
    });
    // Same rule as every other acquisition path: a belief that matters to this person becomes
    // something they carry (v0.9 §B). Noticing that your workmate has not turned up for two days
    // is the beginning of worrying about them, not merely a fact filed away.
    if (belief) formConcerns(world, p, belief);
    remember(world, p, {
      type: 'absence_noticed',
      summary: `${world.nameOf(exp.who)} has not been at ${world.nameOf(exp.placeId)}`,
      eventId: ev.id, entities: [exp.who], significance: 0.4, valence: -0.3,
      source: { type: 'inferred', viaEvent: ev.id }, placeId: exp.placeId,
    });
  }
}
