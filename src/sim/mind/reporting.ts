import type { EntityId, KnowledgeItem, Person, ReportProgress, ReportStatus, Tick } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_HOUR } from '../core/time';
import { situationForEvent, personalSituationView } from '../social/situation';

/**
 * v0.10.1 Part XII — telling the watch about a crime, modelled as progress toward a real outcome.
 *
 * The behaviour this replaces: `report` was proposed afresh for every unhandled crime belief on
 * every cognition tick, at a utility that clamps to 1.00 for anyone close to the victim of a
 * serious assault — the same number a critical thirst and a genuine emergency reach. If the guard
 * was walking, the `tell` action failed for being out of reach, the goal ended, and the identical
 * candidate was proposed again a moment later. v0.10 measured the result on seed 777: fourteen
 * unbroken world-hours of trying to tell the watch at thirst 1.00 and hunger 1.00, and disclosed
 * it as a known limitation rather than lowering the number, because lowering the number is not a
 * model of anything.
 *
 * What was actually missing is that nothing anywhere recorded that the person had ALREADY TRIED.
 * A real person who walks to the guardhouse and finds nobody in does not arrive back at the same
 * blazing certainty thirty seconds later; they carry "I went and he wasn't there", and that
 * changes what they do next. `ReportProgress` is that record, and everything below is derived
 * from canonical facts — who exists, who has been told (`KnowledgeItem.sharedWith`), and whether
 * the matter still stands as far as this person knows (`personalSituationView`, the only
 * sanctioned way a mind may believe something is over).
 *
 * The utility multiplier that comes out of this is not a tuning knob standing in for a model: a
 * report that has never been attempted is worth exactly what it was worth before, and one that
 * has failed four times is worth less because four failures are evidence that this is not
 * working, which is the same reason a person would ease off.
 */

/** After a failed approach, wait this long before setting out again — doubling each time, so a
 * guard who is simply elsewhere costs one wasted trip rather than an afternoon. */
export const REPORT_BACKOFF_SECONDS = 20 * 60;
export const MAX_REPORT_BACKOFF_SECONDS = 6 * SECONDS_PER_HOUR;
/** After this many failed approaches, stop treating it as something that can be got done today.
 * Not forever: `refreshReport` reopens it if an authority turns up within sight. */
export const MAX_REPORT_ATTEMPTS = 4;
/** How long a crime belief stays worth reporting at all. Matches the window `think()` already
 * applies when it gathers crimes to consider. */
export const REPORT_RELEVANCE_SECONDS = 3 * 24 * SECONDS_PER_HOUR;

export function reportsOf(p: Person): Record<string, ReportProgress> {
  p.mind.reports = p.mind.reports ?? {};
  return p.mind.reports;
}

export function reportFor(p: Person, key: string): ReportProgress | undefined {
  return p.mind.reports?.[key];
}

/** Is anyone this person could tell already in the know? The existing success test, kept in one
 * place: `tell` pushes the listener onto `sharedWith`, so a guard appearing there IS the report
 * having been delivered. */
export function toldAnAuthority(k: KnowledgeItem, authorities: readonly Person[]): Person | undefined {
  return authorities.find(g => k.sharedWith.includes(g.id));
}

/**
 * Bring this person's record of how the report is going up to date, and say whether they should
 * be setting out about it right now.
 *
 * `authorities` is the list of living guards/captains — passed in rather than recomputed, because
 * `think()` already has it and this runs per crime belief per tick.
 */
export function refreshReport(world: World, p: Person, k: KnowledgeItem, authorities: readonly Person[]): ReportProgress {
  const now = world.now;
  const store = reportsOf(p);
  let r = store[k.key];
  if (!r) { r = store[k.key] = { key: k.key, status: 'seeking', attempts: 0, firstAt: now, lastAttemptAt: now }; }

  // ---- delivered: somebody appropriate knows, because this person told them.
  const told = toldAnAuthority(k, authorities);
  if (told) {
    if (r.status !== 'delivered') {
      r.status = 'delivered'; r.deliveredToId = told.id; r.deliveredAt = now;
      r.note = `told ${told.name}`;
    }
    return r;
  }

  // ---- moot: the matter is over as far as this person is aware, or the belief has aged out.
  //
  // `personalSituationView` is deliberately the test rather than the Situation's own status: a
  // matter someone else saw settled is not settled for a person who never heard about it, and
  // that person going to the watch anyway is correct behaviour, not a bug.
  const situation = situationForEvent(world, k.claim.eventId);
  if (situation) {
    const view = personalSituationView(world, p, situation);
    if (view.status === 'resolved') {
      r.status = 'moot'; r.note = `${view.resolution ?? 'it was settled'} — no longer worth telling`;
      return r;
    }
  }
  if (now - k.learnedAt > REPORT_RELEVANCE_SECONDS) {
    r.status = 'moot'; r.note = 'old news now';
    return r;
  }

  // ---- no authority at all: nobody left alive to tell. Distinct from "I could not reach him".
  if (!authorities.length) {
    r.status = 'no_authority'; r.note = 'there is no watch to tell';
    return r;
  }

  // ---- gave up for now, but an authority in plain sight reopens it: standing in front of a
  // guard and saying nothing because of a back-off timer would be the model failing, not working.
  if (r.status === 'unavailable' || r.status === 'no_authority') {
    const inSight = p.mind.percepts.some(pc => authorities.some(g => g.id === pc.entityId));
    if (inSight) { r.status = 'seeking'; r.deferUntil = undefined; r.note = undefined; }
  }
  if (r.status === 'moot' || r.status === 'delivered') { r.status = 'seeking'; r.note = undefined; }
  return r;
}

/** Should a `report` candidate be raised for this belief at all right now? */
export function shouldSeekAuthority(world: World, r: ReportProgress): boolean {
  if (r.status === 'delivered' || r.status === 'moot' || r.status === 'no_authority') return false;
  if (r.deferUntil !== undefined && world.now < r.deferUntil) return false;
  return true;
}

/**
 * How much of its base urgency a report still carries. 1 for something not yet attempted; falling
 * with each failed approach, because a person who has walked to the guardhouse three times
 * without finding anyone has learned something about how likely a fourth trip is to work.
 */
export function reportUrgencyFactor(r: ReportProgress): number {
  if (r.attempts <= 0) return 1;
  return Math.max(0.35, 1 - r.attempts * 0.18);
}

/** Record that the person got to an authority and said their piece. */
export function noteReportDelivered(world: World, p: Person, key: string, toId: EntityId): void {
  const r = reportsOf(p)[key];
  if (!r) return;
  r.status = 'delivered'; r.deliveredToId = toId; r.deliveredAt = world.now;
  r.lastAttemptAt = world.now; r.attempts += 1;
  r.note = `told ${world.nameOf(toId)}`;
}

/**
 * Record that the person went and could not deliver it — the authority had moved on, or was
 * never reachable. Backs off, doubling, and after `MAX_REPORT_ATTEMPTS` stops treating it as
 * today's business at all.
 */
export function noteReportFailed(world: World, p: Person, key: string, towardId: EntityId | undefined, why: string): void {
  const store = reportsOf(p);
  const r = store[key] ?? (store[key] = { key, status: 'seeking', attempts: 0, firstAt: world.now, lastAttemptAt: world.now });
  r.attempts += 1;
  r.lastAttemptAt = world.now;
  r.towardId = towardId;
  const backoff = Math.min(MAX_REPORT_BACKOFF_SECONDS, REPORT_BACKOFF_SECONDS * Math.pow(2, Math.max(0, r.attempts - 1)));
  r.deferUntil = world.now + backoff;
  r.status = r.attempts >= MAX_REPORT_ATTEMPTS ? 'no_authority' : 'unavailable';
  r.note = r.status === 'no_authority' ? `gave up trying to find the watch (${why})` : why;
}

/** Drop records that have nothing left to say, so `Mind.reports` does not accumulate for the life
 * of a long run. Called from the coarse upkeep pass, not per tick. */
export function pruneReports(world: World, p: Person): void {
  const store = p.mind.reports;
  if (!store) return;
  for (const key of Object.keys(store)) {
    const r = store[key];
    const stale = world.now - r.lastAttemptAt > REPORT_RELEVANCE_SECONDS;
    if (!p.knowledge[key] || (stale && (r.status === 'delivered' || r.status === 'moot' || r.status === 'no_authority'))) delete store[key];
  }
}

/** For the Inspector and the traces: what this person would say about how it is going. */
export function describeReport(world: World, r: ReportProgress): string {
  const status: Record<ReportStatus, string> = {
    seeking: 'looking for someone to tell',
    unavailable: 'could not find anyone to tell',
    delivered: 'told the watch',
    no_authority: 'has nobody to tell',
    moot: 'no longer worth telling',
  };
  const who = r.deliveredToId ? ` (${world.nameOf(r.deliveredToId)})` : r.towardId ? ` (was looking for ${world.nameOf(r.towardId)})` : '';
  return `${status[r.status]}${who}${r.attempts ? `, ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : ''}${r.note ? ` — ${r.note}` : ''}`;
}
