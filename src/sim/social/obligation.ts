import type { EntityId, EventId, GoalType, KnowledgeItem, Obligation, ObligationKind, ObligationStatus, Person, Request, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { adjustRel, isClose, isFamily } from '../mind/relationships';
import { learn } from '../mind/knowledge';
import { requestById, requestTypeLabel } from '../core/requests';

/**
 * OBLIGATIONS — social stakes that outlive the interaction that created them (v0.10 §II).
 *
 * Torn Veil already had relationships (how I feel about you), memories (what I remember), and
 * knowledge (what I believe). What it had no representation for at all was: *I owe you*. Without
 * that, a favour done at real cost changed a couple of relationship scalars and then evaporated —
 * nothing in the simulation could later answer "why is she carrying his flour across the village
 * when she has bread of her own to bake?"
 *
 * The design constraints the milestone imposes, and how each is met here:
 *
 *  - **Provenance.** Every obligation names who feels it (the `Person` whose `mind.obligations`
 *    holds it), toward whom (`towardId`), why (`kind` + `reasons`), because of what canonical
 *    event (`causeEventId`), whether it is still live (`status`), and how it ended
 *    (`resolution`). `world.event(o.causeEventId)` is always a real event.
 *  - **Not a favour-point counter.** `magnitude` exists, but it is a property OF a specific,
 *    traceable stake, not a free-floating score. Relationship change is a consequence of keeping
 *    or breaking one (see `resolveObligation`/`failObligation`), never the obligation itself.
 *  - **Not every kindness is a debt.** `assessMagnitude` reads real context — material value
 *    relative to both purses, how badly off the beneficiary was, whether the benefactor was
 *    simply doing their paid job, and how close the two already are (kin do for one another) —
 *    and anything under `MIN_OBLIGATION_MAGNITUDE` forms nothing at all.
 *  - **Epistemics.** An obligation only ever forms from something this person actually knows:
 *    their own act (accepting a request), or a `KnowledgeItem` with real provenance whose
 *    `basisKey` is recorded. `social/situation.ts`'s rule applies here too — nothing reads
 *    canonical state a mind has no access to.
 *
 * There are no per-person special cases and no named individuals anywhere in this file.
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** Below this, a kindness is just a kindness. Nothing is recorded. */
export const MIN_OBLIGATION_MAGNITUDE = 0.15;
/** A person carries a handful of live stakes, not a ledger. Bounded like memories/knowledge/
 * concerns — the milestone explicitly warns against "obligations multiplying without bound". */
export const MAX_OBLIGATIONS = 8;
/**
 * How long a felt obligation takes to halve, per kind, in world DAYS. An accepted task does not
 * fade at all while the work is still open (it ends by being done or broken, not by being
 * forgotten) — represented by a very long half-life plus the request-status checks in
 * `maintainObligations`. A material debt outlives everything else; ordinary gratitude fades over
 * a couple of weeks, which is roughly how long a real favour stays live in ordinary social life.
 */
export const OBLIGATION_HALFLIFE_DAYS: Record<ObligationKind, number> = {
  accepted_task: 120, was_helped: 14, was_tended: 16, was_given: 18, was_protected: 20, debt: 240,
};
/** Below this a live obligation is spent and is dropped (it stops being anything at all). */
export const OBLIGATION_FLOOR = 0.06;
/** The most any single stake may ever reach. A ceiling matters because reinforcement is
 * multiplicative-ish: measured on seed 1337, a spouse tending a badly-hurt partner repeatedly
 * over one evening ratcheted a single obligation from ~0.38 to 0.92 purely by repetition. */
export const MAX_OBLIGATION_MAGNITUDE = 0.8;
/** ...and a stake is reinforced at most once per this much world time, so what accumulates is
 * the number of separate OCCASIONS someone did right by you, not the number of simulation ticks
 * the doing happened to span. */
export const OBLIGATION_REINFORCE_COOLDOWN_SECONDS = 3600;
/** Occupations for whom a given kind of help is simply the job they are paid to do — the help is
 * still real, it just creates far less of a personal stake than a neighbour doing the same thing
 * out of nothing but goodwill. Structural (an occupation set), never a name list. */
const DUTY_ROLES: Partial<Record<ObligationKind, ReadonlySet<string>>> = {
  was_tended: new Set(['herbalist', 'priest', 'acolyte']),
  was_protected: new Set(['guard', 'captain']),
};

// ---------------------------------------------------------------- accessors
export function obligationsOf(p: Person): Obligation[] { return (p.mind.obligations ??= []); }
export function liveObligations(p: Person): Obligation[] { return obligationsOf(p).filter(o => o.status === 'live'); }
export function obligationsToward(p: Person, towardId: EntityId): Obligation[] {
  return obligationsOf(p).filter(o => o.status === 'live' && o.towardId === towardId);
}
/**
 * Total live stake this person holds toward another, 0..1. This is the one number the rest of the
 * simulation reads when it only needs "how much do I owe them" — but it is DERIVED from the
 * individual traceable obligations, never stored as a score of its own. Anyone who wants to know
 * *why* asks `obligationsToward`.
 */
export function obligationCredit(p: Person, towardId: EntityId): number {
  const list = p.mind.obligations;
  if (!list || !list.length) return 0;
  let total = 0;
  for (const o of list) if (o.status === 'live' && o.towardId === towardId) total += o.magnitude;
  return clamp(total);
}

// ---------------------------------------------------------------- formation
/** Which canonical event types are BENEFITS — the single table this module is driven by. Adding a
 * new kind of help to the simulation means adding one row here, not a new handler. */
/**
 * `base` is deliberately SMALL for the kinds whose weight ought to come from what actually
 * happened. A gift is only as much of a favour as the thing given was worth to the person giving
 * it; being tended is only as much of one as you needed tending. Loading that weight into the
 * base instead would mean a shared crust of bread and a horse both put you in someone's debt,
 * which is exactly the "turn every friendly action into a debt" failure the milestone forbids —
 * and is what the base of 0.30 originally did (a worthless crumb cleared the formation threshold
 * on its own). Returning something that was lost, and settling someone's debt, carry more of
 * their own weight because the act itself is the substance.
 */
interface BenefitSpec { kind: ObligationKind; base: number; /** does `claim.target` name the person helped? */ targetIsBeneficiary: boolean; }
const BENEFITS: Record<string, BenefitSpec> = {
  heal: { kind: 'was_tended', base: 0.12, targetIsBeneficiary: true },
  gift: { kind: 'was_given', base: 0.1, targetIsBeneficiary: true },
  returned_item: { kind: 'was_given', base: 0.24, targetIsBeneficiary: true },
  debt_paid: { kind: 'was_helped', base: 0.2, targetIsBeneficiary: true },
  // A subdual/arrest names the person SUBDUED as its target — the person protected by it is
  // whoever that person was harming, which only the protected party's own beliefs can establish.
  // See `protectionBeneficiary` below.
  entity_subdued: { kind: 'was_protected', base: 0.18, targetIsBeneficiary: false },
  entity_arrested: { kind: 'was_protected', base: 0.16, targetIsBeneficiary: false },
};

/**
 * Whether THIS person was the one protected by a subdual/arrest of `subduedId`. Purely epistemic:
 * it is true only if they themselves hold a belief that the subdued person harmed them. A
 * bystander who merely watched the watch do its work owes nobody anything.
 */
function wasProtectedBy(p: Person, subduedId: EntityId | undefined, now: number): boolean {
  if (!subduedId) return false;
  for (const k of Object.values(p.knowledge)) {
    if (k.kind !== 'event') continue;
    if (k.claim.actor !== subduedId || k.claim.target !== p.id) continue;
    if (k.claim.type !== 'attack' && k.claim.type !== 'theft' && k.claim.type !== 'kill') continue;
    if (now - (k.claim.tick as number ?? k.learnedAt) < 3 * 24 * 3600) return true;
  }
  return false;
}

/**
 * How much of a stake this particular act of help actually creates for this particular person.
 * Everything read here is generic structure: material value against both purses, how badly off
 * the beneficiary was, whether the benefactor was on duty, existing closeness, and the
 * beneficiary's own disposition to feel indebted at all.
 */
function assessMagnitude(world: World, p: Person, benefactor: Person, spec: BenefitSpec, k: KnowledgeItem): { magnitude: number; reasons: string[] } {
  const reasons: string[] = [];
  let m = spec.base;

  // Material cost — what it was worth, weighed against what the giver could spare. Twenty silver
  // from a person who has thirty is a far larger thing than twenty from a person who has three
  // hundred, and that difference is real, not cosmetic.
  const item = world.item(k.claim.item as EntityId | undefined);
  if (item) {
    const worth = Math.max(0, item.value) * Math.max(1, item.quantity);
    const giverMeans = Math.max(8, benefactor.wealth);
    const costToGiver = clamp(worth / giverMeans, 0, 1);
    const worthToMe = clamp(worth / Math.max(8, p.wealth + worth), 0, 1);
    m += costToGiver * 0.3 + worthToMe * 0.18;
    if (costToGiver > 0.25) reasons.push(`${item.name} was worth ${worth} silver — real money to ${benefactor.name}`);
    else reasons.push(`${benefactor.name} gave me ${item.name}`);
  }
  if (typeof k.claim.amount === 'number') {
    const amount = Math.max(0, k.claim.amount as number);
    m += clamp(amount / Math.max(10, benefactor.wealth + amount)) * 0.3;
    reasons.push(`${amount} silver of it`);
  }

  // How badly I needed it. Being tended when you can barely stand is not the same favour as
  // being tended for a scratch.
  if (spec.kind === 'was_tended') {
    const wound = typeof k.claim.wound === 'number' ? (k.claim.wound as number) : undefined;
    const body = world.primaryBody(p.id);
    const hurt = wound ?? (body ? clamp(1 - body.health / body.maxHealth) : 0.4);
    m += hurt * 0.45;
    reasons.push(hurt > 0.5 ? `I was in a bad way and ${benefactor.name} tended me` : `${benefactor.name} tended my wounds`);
  }
  if (spec.kind === 'was_protected') {
    m += 0.14;
    reasons.push(`${benefactor.name} put a stop to it`);
  }

  // On duty. A guard keeping the peace and a herbalist treating the sick are doing the work the
  // village already sustains them for; it earns real gratitude, but much less of a personal debt
  // than a neighbour who simply chose to.
  const duty = DUTY_ROLES[spec.kind];
  if (duty?.has(benefactor.occupation)) { m *= 0.55; reasons.push(`it is ${benefactor.name}'s charge to do it`); }

  // Kin and close friends do for one another. Recording a debt for every such act would turn
  // ordinary family life into a ledger, which is exactly what the milestone warns against.
  if (isFamily(p, benefactor.id)) { m *= 0.5; reasons.push('kin do this for one another'); }
  else if (isClose(p, benefactor.id)) { m *= 0.72; reasons.push(`${benefactor.name} is dear to me`); }

  // Who feels obliged, and how much, is a matter of character.
  m *= 0.8 + p.traits.honesty * 0.25 + p.traits.loyalty * 0.15;

  // A belief you half-hold does not weigh like something you watched happen to you.
  m *= k.confidence * (k.source.type === 'witnessed' || k.source.type === 'self' ? 1 : 0.7);
  return { magnitude: clamp(m), reasons: reasons.slice(0, 3) };
}

/**
 * THE formation path from the knowledge layer. Called from every place a mind actually learns
 * something (`mind/agent.ts`'s perception and `tell`), alongside `formConcerns` — so an
 * obligation, exactly like a concern, can never exist without a belief with real provenance
 * behind it. Returns whatever was formed or reinforced.
 */
export function formObligations(world: World, p: Person, k: KnowledgeItem): Obligation[] {
  if (!p.alive || k.kind !== 'event') return [];
  const type = k.claim.type as string | undefined;
  if (!type) return [];
  const out: Obligation[] = [];

  // A pre-existing material debt I know I owe (the seeded `debt` events, and any later one).
  if (type === 'debt' && k.claim.actor === p.id && k.claim.target && k.claim.target !== p.id) {
    const creditor = world.person(k.claim.target as EntityId);
    if (creditor?.alive) {
      const amount = Math.max(0, (k.claim.amount as number) ?? 0);
      const magnitude = clamp(0.3 + clamp(amount / Math.max(15, p.wealth + amount)) * 0.5);
      const formed = record(world, p, {
        kind: 'debt', towardId: creditor.id, magnitude, causeEventId: k.claim.eventId as EventId | undefined,
        basisKey: k.key, reasons: [`I owe ${creditor.name}${amount ? ` ${amount} silver` : ''}`],
      });
      if (formed) out.push(formed);
    }
    return out;
  }

  const spec = BENEFITS[type];
  if (!spec) return out;
  const benefactorId = k.claim.actorUnknown ? undefined : (k.claim.actor as EntityId | undefined);
  if (!benefactorId || benefactorId === p.id) return out;
  const benefactor = world.person(benefactorId);
  if (!benefactor || !benefactor.alive) return out;
  // Who was actually helped.
  const beneficiaryIsMe = spec.targetIsBeneficiary
    ? k.claim.target === p.id
    : wasProtectedBy(p, k.claim.target as EntityId | undefined, world.now);
  if (!beneficiaryIsMe) return out;

  const { magnitude, reasons } = assessMagnitude(world, p, benefactor, spec, k);
  if (magnitude < MIN_OBLIGATION_MAGNITUDE) return out;
  const formed = record(world, p, {
    kind: spec.kind, towardId: benefactorId, magnitude, causeEventId: (k.claim.eventId as EventId | undefined) ?? k.source.viaEvent,
    basisKey: k.key, itemId: k.claim.item as EntityId | undefined, reasons,
  });
  if (formed) out.push(formed);
  return out;
}

/** A worker taking on a piece of commissioned work. Self-knowledge — no perception involved: you
 * always know what you yourself agreed to. This is the one obligation kind that can be BROKEN. */
export function recordAcceptedTask(world: World, worker: Person, request: Request, causeEventId?: EventId): Obligation | null {
  if (!request.requesterId || request.requesterId === worker.id) return null;
  const requester = world.person(request.requesterId);
  if (!requester || !requester.alive) return null;
  // The size of the stake is the size of what was promised — a token errand is not a solemn vow.
  const magnitude = clamp(0.28 + Math.min(0.3, request.reward / 40) + worker.traits.loyalty * 0.18);
  return record(world, worker, {
    kind: 'accepted_task', towardId: requester.id, magnitude, requestId: request.id, causeEventId,
    reasons: [`I took on ${requestTypeLabel(request.type)} for ${requester.name}`, request.cause].filter(Boolean),
  });
}

interface ObligationSpec {
  kind: ObligationKind; towardId: EntityId; magnitude: number;
  causeEventId?: EventId; basisKey?: string; requestId?: string; itemId?: EntityId; situationId?: string;
  reasons: string[];
}

/** Create or reinforce. Two favours from the same person of the same kind are one growing stake,
 * not two independent ledger rows — the same identity rule `mind/concern.ts` uses for concerns. */
function record(world: World, p: Person, s: ObligationSpec): Obligation | null {
  const list = obligationsOf(p);
  const existing = list.find(o => o.status === 'live' && o.kind === s.kind && o.towardId === s.towardId
    && (s.requestId ? o.requestId === s.requestId : !o.requestId));
  if (existing) {
    if (world.now - existing.lastReinforcedAt < OBLIGATION_REINFORCE_COOLDOWN_SECONDS) return null;
    const before = existing.magnitude;
    existing.magnitude = clamp(Math.max(existing.magnitude, s.magnitude) + s.magnitude * 0.15, 0, MAX_OBLIGATION_MAGNITUDE);
    existing.lastReinforcedAt = world.now;
    for (const r of s.reasons) if (!existing.reasons.includes(r)) existing.reasons.push(r);
    if (existing.reasons.length > 4) existing.reasons.length = 4;
    return existing.magnitude - before > 0.02 ? existing : null;
  }
  const o: Obligation = {
    id: world.nextId('ob'), kind: s.kind, towardId: s.towardId,
    causeEventId: s.causeEventId, basisKey: s.basisKey, requestId: s.requestId, itemId: s.itemId, situationId: s.situationId,
    magnitude: clamp(s.magnitude, 0, MAX_OBLIGATION_MAGNITUDE), createdAt: world.now, lastReinforcedAt: world.now, status: 'live',
    reasons: s.reasons.slice(0, 3),
  };
  list.push(o);
  const cause = world.event(s.causeEventId);
  world.emit('obligation_formed', {
    actor: p.id, target: s.towardId, category: 'social',
    causes: cause ? [cause.id] : [],
    // Same invariant every v0.9 bookkeeping event keeps: never more significant than the
    // canonical event it cites, so compaction can never orphan the cause it points at.
    significance: Math.min(0.3, o.magnitude * 0.6, cause ? cause.significance : 0.3),
    data: { obligationId: o.id, kind: o.kind, towardId: o.towardId, magnitude: Math.round(o.magnitude * 100) / 100, requestId: o.requestId },
    summary: `${p.name} ${describeObligation(world, o)}`,
  });
  trim(p);
  return o;
}

function trim(p: Person): void {
  const list = obligationsOf(p);
  if (list.length <= MAX_OBLIGATIONS) return;
  list.sort((a, b) => (b.status === 'live' ? b.magnitude + 1 : b.magnitude) - (a.status === 'live' ? a.magnitude + 1 : a.magnitude));
  list.length = MAX_OBLIGATIONS;
}

// ---------------------------------------------------------------- resolution
export function resolveObligation(world: World, p: Person, o: Obligation, status: ObligationStatus, resolution: string, causeEventId?: EventId): void {
  if (o.status !== 'live') return;
  const notable = o.magnitude >= MIN_OBLIGATION_MAGNITUDE;
  o.status = status;
  o.resolvedAt = world.now;
  o.resolution = resolution;
  if (!notable) { o.magnitude *= 0.2; return; }
  const cause = world.event(causeEventId);
  world.emit('obligation_resolved', {
    actor: p.id, target: o.towardId, category: 'social', causes: cause ? [cause.id] : [],
    significance: Math.min(0.3, o.magnitude * 0.6, cause ? cause.significance : 0.3),
    data: { obligationId: o.id, kind: o.kind, status, resolution, towardId: o.towardId },
    summary: `${p.name} no longer owes ${world.nameOf(o.towardId)} (${resolution})`,
  });
  o.magnitude *= 0.2;
}

/**
 * A responsibility that was actually taken on and then broken. Unlike every other transition in
 * this file, this one is a REAL SOCIAL EVENT that other people can learn about and react to
 * through the ordinary v0.9 machinery — see `noticeBrokenPromises` for how the wronged party
 * comes to know about it honestly, rather than by omniscience.
 */
export function failObligation(world: World, p: Person, o: Obligation, reason: string): WorldEvent | null {
  if (o.status !== 'live') return null;
  o.status = 'failed';
  o.resolvedAt = world.now;
  o.resolution = reason;
  const body = world.primaryBody(p.id);
  const ev = world.emit('obligation_failed', {
    actor: p.id, target: o.towardId, pos: body ? { ...body.pos } : undefined,
    causes: world.event(o.causeEventId) ? [o.causeEventId!] : [],
    significance: Math.min(0.45, 0.2 + o.magnitude * 0.4),
    visibility: 12, loudness: 5,
    data: { obligationId: o.id, kind: o.kind, reason, requestId: o.requestId, towardId: o.towardId },
    summary: `${p.name} did not do what they took on for ${world.nameOf(o.towardId)} — ${reason}`,
  });
  o.magnitude *= 0.4;
  return ev;
}

/** Every live obligation this person holds toward `towardId` is discharged, because they have
 * just done something materially good for them. This is what makes reciprocity CLOSE rather than
 * accumulate forever. */
export function dischargeToward(world: World, p: Person, towardId: EntityId, resolution: string, causeEventId?: EventId): Obligation[] {
  const done: Obligation[] = [];
  for (const o of obligationsOf(p)) {
    if (o.status !== 'live' || o.towardId !== towardId) continue;
    // An accepted task is discharged by DOING THAT TASK (see `settleRequestObligations`), not by
    // any other kindness — otherwise handing someone bread would count as having carried their
    // flour, and a promise would become trivially escapable.
    if (o.kind === 'accepted_task') continue;
    resolveObligation(world, p, o, 'fulfilled', resolution, causeEventId);
    done.push(o);
  }
  return done;
}

/**
 * The single hook through which every canonical benefit event discharges the actor's own standing
 * obligations toward the person they just helped. Installed on `World.eventObserver` (see
 * `mind/agent.ts`), so it can never miss an event or see one twice — and so an act of
 * reciprocity is recognised no matter WHICH system produced it (a heal action, a gift in
 * dialogue, a delivered haul, a returned item found by a passer-by).
 *
 * Note the asymmetry with formation, and why it is correct: you always know what you yourself
 * did (self-knowledge), so the actor side needs no perception check; the beneficiary side goes
 * through the knowledge layer because being helped is something you have to notice.
 */
export function noteBenefitEvent(world: World, e: WorldEvent): void {
  const spec = BENEFITS[e.type];
  if (!spec || !spec.targetIsBeneficiary) return;
  if (!e.actor || !e.target || e.actor === e.target) return;
  const actor = world.person(e.actor);
  if (!actor) return;
  dischargeToward(world, actor, e.target, e.type === 'debt_paid' ? 'settled' : 'repaid', e.id);
}

/**
 * The request lifecycle, observed rather than hooked into `core/requests.ts` directly — the same
 * one-hook-through-`World.eventObserver` pattern `social/situation.ts` uses, and for the same two
 * reasons: every canonical event passes through it exactly once (so an obligation can never be
 * missed or double-counted no matter which subsystem raised the request), and `core/` keeps its
 * freedom from any dependency on `social/`.
 */
export function noteRequestEvent(world: World, e: WorldEvent): void {
  const requestId = e.data?.requestId as string | undefined;
  if (!requestId) return;
  const request = requestById(world, requestId);
  if (!request) return;
  if (e.type === 'request_accepted') {
    const previous = world.person(e.data?.previousWorkerId as EntityId | undefined);
    if (previous && previous.id !== e.actor) {
      for (const o of liveObligations(previous)) if (o.kind === 'accepted_task' && o.requestId === request.id) {
        resolveObligation(world, previous, o, 'lapsed', 'someone else took it on', e.id);
      }
    }
    const worker = e.actor ? world.person(e.actor) : undefined;
    if (worker) recordAcceptedTask(world, worker, request, e.id);
    return;
  }
  if (e.type === 'request_completed') {
    settleRequestObligations(world, request, 'fulfilled', 'work_done', e.id);
    // Doing someone's work is one of the most ordinary ways of doing them a turn. A standing
    // stake toward the person the work was for is settled by having actually done it — which is
    // what closes the reciprocity loop instead of leaving a debt live forever after it has, in
    // fact, been answered.
    const worker = request.acceptedBy ? world.person(request.acceptedBy) : undefined;
    if (worker && request.requesterId && request.requesterId !== worker.id) {
      dischargeToward(world, worker, request.requesterId, 'repaid', e.id);
    }
    return;
  }
  if (e.type === 'request_failed') { settleRequestObligations(world, request, 'failed', (e.data?.reason as string) ?? 'the work was never finished', e.id); return; }
}

/** Request lifecycle → the accepted-task obligation it created. One place, three outcomes. */
export function settleRequestObligations(world: World, request: Request, outcome: 'fulfilled' | 'failed' | 'released', reason: string, causeEventId?: EventId): void {
  const worker = request.acceptedBy ? world.person(request.acceptedBy) : undefined;
  if (!worker) return;
  for (const o of obligationsOf(worker)) {
    if (o.status !== 'live' || o.kind !== 'accepted_task' || o.requestId !== request.id) continue;
    if (outcome === 'failed') failObligation(world, worker, o, reason);
    else resolveObligation(world, worker, o, outcome === 'fulfilled' ? 'fulfilled' : 'lapsed', reason, causeEventId);
  }
}

// ---------------------------------------------------------------- upkeep
/**
 * Periodic upkeep, on the same coarse cadence as concern/relationship evolution. Three generic
 * jobs, all of which exist to guarantee the collection cannot grow without bound:
 *  - a stake toward someone who has died lapses (there is no one left to repay);
 *  - an accepted task whose canonical `Request` is no longer open resolves to match it (the
 *    belt-and-braces backstop for the direct hooks above);
 *  - everything else fades on its own per-kind timescale, and is dropped once spent.
 */
export function maintainObligations(world: World, p: Person, hours: number): void {
  const list = p.mind.obligations;
  if (!list || !list.length) return;
  for (const o of list) {
    if (o.status !== 'live') continue;
    const other = world.person(o.towardId);
    if (!other || !other.alive) { resolveObligation(world, p, o, 'lapsed', 'they_died'); continue; }
    if (o.kind === 'accepted_task' && o.requestId) {
      const req = requestById(world, o.requestId);
      if (!req) { resolveObligation(world, p, o, 'lapsed', 'the work is gone'); continue; }
      if (req.status === 'completed') { resolveObligation(world, p, o, 'fulfilled', 'work_done'); continue; }
      if (req.status === 'failed') { failObligation(world, p, o, 'the work was never finished'); continue; }
      if (req.status === 'cancelled') { resolveObligation(world, p, o, 'lapsed', 'it was called off'); continue; }
      if (req.acceptedBy !== p.id) { resolveObligation(world, p, o, 'lapsed', 'someone else took it on'); continue; }
      continue; // a live promise does not fade with time — it is kept or broken
    }
    o.magnitude *= Math.pow(0.5, (hours / 24) / OBLIGATION_HALFLIFE_DAYS[o.kind]);
    // Fading is the absence of a transition, not one — same reasoning as `maintainConcerns`.
    if (o.magnitude < OBLIGATION_FLOOR) { o.status = 'lapsed'; o.resolution = 'faded'; o.resolvedAt = world.now; }
  }
  const kept = list.filter(o => o.status === 'live' || o.magnitude >= OBLIGATION_FLOOR * 0.5);
  if (kept.length !== list.length) { list.length = 0; list.push(...kept); }
}

/**
 * How a person comes to know that work they commissioned was taken on and then dropped —
 * honestly, without omniscience. This is an INFERENCE about their own affairs (the same shape as
 * `strategic`'s "my property is gone from its place"): they raised the request, at their own
 * place, and the goods never came. It forms a real belief with `inferred` provenance, which then
 * feeds the ordinary v0.9 appraisal → concern → relationship chain like any other belief.
 *
 * Deliberately NOT a broadcast: a villager on the other side of the vale learns of a broken
 * promise only if someone tells them.
 */
export function noticeBrokenPromises(world: World, p: Person, recentlyFailed: Request[]): void {
  if (!p.alive) return;
  for (const r of recentlyFailed) {
    if (r.requesterId !== p.id || !r.acceptedBy || r.acceptedBy === p.id) continue;
    const key = `promise_broken:${r.id}`;
    if (p.knowledge[key]) continue;
    const worker = world.person(r.acceptedBy);
    if (!worker) continue;
    const ev = world.emit('obligation_failed', {
      actor: worker.id, target: p.id, placeId: r.requesterPlaceId, significance: 0.3,
      data: { requestId: r.id, reason: 'the work never arrived', inferred: true },
      summary: `${p.name} realised ${worker.name} never finished the ${requestTypeLabel(r.type)} they took on`,
    });
    learn(world, p, {
      key, kind: 'event',
      claim: { eventId: ev.id, type: 'obligation_failed', actor: worker.id, target: p.id, requestId: r.id, tick: world.now, significance: 0.3, text: `${worker.name} took on ${requestTypeLabel(r.type)} for me and never finished it` },
      confidence: 0.85, source: { type: 'inferred', viaEvent: ev.id }, cause: ev.id,
      summary: `${worker.name} never finished the work they took on for me`,
    }, true);
    // The social consequence, through the existing relationship layer — a broken promise costs
    // trust and respect, and it is not the same thing as a crime.
    adjustRel(world, p, worker.id, { trust: -0.22, respect: -0.14, affection: -0.08 }, 'took on my work and never finished it', ev.id);
  }
}

// ---------------------------------------------------------------- behavioural bridge
/**
 * What a live obligation does to a candidate goal's utility (v0.10 §II "reciprocity must affect
 * behaviour"). Same shape and same discipline as `mind/concern.ts`'s `concernGoalBoost`:
 *
 *  - one generic table from goal type to "this goal serves the person I owe";
 *  - bounded, so an obligation bends a decision and never dictates one;
 *  - and — the v0.9 justice-concern lesson, restated — it contains NO goal that physically sends
 *    a person toward a confrontation. Debt does not make people fight; it makes them help.
 *
 * `beneficiaryId` lets a goal whose target is a PLACE or a task still declare who it is actually
 * for (a haul serves whoever requested it), so "I'll carry his flour, he stood by me" works.
 */
const OBLIGATION_GOALS: ReadonlySet<GoalType> = new Set<GoalType>(['help', 'check_on', 'help_recover_item', 'provide', 'haul', 'build']);
/** The most an obligation may add. Below the gap between idling and answering a real need. */
export const MAX_OBLIGATION_BONUS = 0.22;

export interface ObligationBoost { bonus: number; reasons: string[]; }
export function obligationGoalBoost(p: Person, goalType: GoalType, targetId?: EntityId, beneficiaryId?: EntityId): ObligationBoost {
  const list = p.mind.obligations;
  if (!list || !list.length || !OBLIGATION_GOALS.has(goalType)) return { bonus: 0, reasons: [] };
  const who = beneficiaryId ?? targetId;
  if (!who) return { bonus: 0, reasons: [] };
  let bonus = 0; let best: Obligation | null = null;
  for (const o of list) {
    if (o.status !== 'live' || o.towardId !== who) continue;
    const contribution = Math.min(MAX_OBLIGATION_BONUS, o.magnitude * 0.4);
    if (contribution <= bonus) continue;
    bonus = contribution; best = o;
  }
  if (!best) return { bonus: 0, reasons: [] };
  return { bonus, reasons: [`I owe them (${best.kind}, ${best.magnitude.toFixed(2)})`, ...best.reasons.slice(0, 2)] };
}

/**
 * How much a standing obligation should soften this person's reaction to a MINOR wrong by the
 * person they owe (v0.10 §II "forgive a minor offence"). 0 = no softening, 1 = complete. Read by
 * `mind/agent.ts`'s `reactTo`. Deliberately capped well below 1 and deliberately never applied to
 * severe harm — being owed a favour does not make anyone forgive a beating.
 */
export function forgivenessFor(p: Person, actorId: EntityId, severity: number): number {
  if (severity >= 0.5) return 0;
  return Math.min(0.5, obligationCredit(p, actorId) * 0.6);
}

export function describeObligation(world: World | undefined, o: Obligation): string {
  const who = world ? world.nameOf(o.towardId) : 'them';
  switch (o.kind) {
    case 'accepted_task': return `has taken on work for ${who}`;
    case 'was_helped': return `owes ${who} for real help`;
    case 'was_tended': return `owes ${who} for tending them`;
    case 'was_given': return `owes ${who} for what they gave`;
    case 'was_protected': return `owes ${who} for stepping in`;
    case 'debt': return `owes ${who} money`;
  }
}
