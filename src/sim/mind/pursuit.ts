import type { Concern, EntityId, EventId, Goal, GoalType, Item, Obligation, Person, Pursuit, PursuitKind, PursuitStatus, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { concernsOf, concernGoalBoost } from './concern';
import { getRel, isClose, isFamily } from './relationships';
import { liveObligations, obligationsOf, obligationGoalBoost } from '../social/obligation';
import { woundSeverity, SERIOUS_WOUND } from '../core/attributes';
import { isFood } from '../world/factory';
import { SECONDS_PER_HOUR } from '../core/time';
import { requestById } from '../core/requests';

/**
 * PURSUITS — persistent purposes (v0.10 §I).
 *
 * The gap this closes. Before v0.10 the deepest thing a Torn Veil mind could hold was a
 * `Concern`: a live worry that bent the utility of whatever goals happened to be proposed that
 * tick. That is enough to make someone react, and it is what v0.9 delivered. It is NOT enough to
 * make someone *trying to do something*: the moment a `check_on` plan finished, the concern had
 * nothing left to express itself as, and the person simply went back to their day. There was no
 * representation anywhere of "I am still, over hours, working on this."
 *
 * A `Pursuit` is that representation, and it is deliberately thin:
 *
 *   an ORIENTATION  (kind + subject)   — what I am trying to bring about
 *   a live SOURCE   (concern/obligation/desire/request) — why it still matters
 *   a PRIORITY      (recomputed each upkeep) — how it stands against my other purposes
 *   bounds          (expiry, attempt budget, count cap) — so no purpose is immortal
 *
 * It carries no plan and no script. `pursuitSteps` below re-derives, from the current world and
 * from what this person actually knows, which ORDINARY EXISTING GOAL serves the purpose right
 * now. That is what makes a multi-step life — go and look, fetch something, carry it over, look
 * again, conclude they are alright — fall out of state rather than out of an authored sequence.
 * Change the world and the same purpose produces different actions; that is the whole point.
 *
 * Three disciplines this module holds to, each learned from a real regression:
 *
 *  1. **No approach-the-suspect goals.** v0.9 measured a 40x combat explosion when a justice
 *     concern was allowed to boost `investigate`/`confront`: an approach goal renews contact,
 *     the renewed fight emits fresh crime events, which strengthen the concern, which boosts the
 *     approach goal again. `STEP_GOALS` below contains no combat or confrontation goal of any
 *     kind, and `formPursuits` refuses to orient anyone toward someone they fear or across the
 *     outlaw line. See `PURSUIT_FORBIDDEN_GOALS` for the enforced statement of this.
 *  2. **People stay embodied.** A purpose's utility is multiplied by an embodiment factor the
 *     caller computes from real physiological severity and threat, so no purpose can ever
 *     outbid eating, drinking, sleeping or fleeing. A village where a devoted spouse starves is
 *     a failed simulation, not a moving one.
 *  3. **Everything terminates.** Expiry, an attempt budget, a no-progress backstop, a count cap,
 *     and the requirement that the source stay live. A purpose that cannot be finished is
 *     abandoned with a reason, which is itself an honest outcome.
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** A person is oriented toward a handful of things at once, not a quest log. */
export const MAX_PURSUITS = 6;
/** How many may be ACTIVE (i.e. actually proposing steps) at once. The rest are deferred — real,
 * remembered, and waiting, which is what "defer" means in ordinary life. */
export const MAX_ACTIVE_PURSUITS = 2;
/** Hard ceiling on a purpose's life, per kind, in world HOURS. Nothing is immortal. */
export const PURSUIT_MAX_HOURS: Record<PursuitKind, number> = {
  tend: 4 * 24, recover: 6 * 24, discharge: 36, reciprocate: 20 * 24,
};
/** How many times a step may be adopted before a purpose that is getting nowhere is given up. */
export const MAX_PURSUIT_ATTEMPTS = 8;
/** ...and how long without any real progress counts as "getting nowhere". */
export const NO_PROGRESS_SECONDS = 30 * SECONDS_PER_HOUR;
/** Below this a concern is felt but is not something a person organises their day around. */
export const TEND_CONCERN_THRESHOLD = 0.28;
/** Below this an obligation is remembered and biases decisions, but is not a purpose of its own. */
export const RECIPROCATE_THRESHOLD = 0.3;
/**
 * Utility range a pursuit-driven step may propose, before `fit` and the caller's embodiment
 * factor scale it down: 0.24 at the faintest, 0.80 at the most pressing.
 *
 * The top of the band is chosen against the things it has to be weighed against, not picked out
 * of the air. An ordinary scheduled work shift sits at ~0.55; idling at 0.10; socialising at
 * ~0.5-0.8 depending on need; a claimed haul in hand at 0.68; bedtime sleep, a critical thirst
 * and a genuine emergency all reach 1.00. So a maximal purpose — a spouse you believe is badly
 * hurt — outweighs your shift and your evening in the tavern, and still loses to your own body
 * and to danger. Measured directly: at the previous ceiling (0.62 before `fit`), a villager who
 * had just been told her husband was beaten, with bread in the larder to bring him, scored the
 * errand at 0.40 against a 0.55 work shift and simply went to work — which is a person who
 * "has a purpose" in name only, the exact failure mode this milestone defines itself against.
 */
export const PURSUIT_BASE_UTILITY = 0.24;
export const PURSUIT_UTILITY_SPAN = 0.56;
/** The most an active pursuit may add to a candidate someone else proposed. */
export const MAX_PURSUIT_BONUS = 0.2;
/** A newly-active pursuit holds its place for at least this long, and must be beaten by
 * `PRIORITY_MARGIN` to be displaced — the anti-oscillation rule the milestone asks for
 * ("the person should not oscillate every cognition tick"). */
export const PURSUIT_MIN_DWELL_SECONDS = 45 * 60;
export const PRIORITY_MARGIN = 0.08;
/** After a purpose ends, the same purpose does not immediately re-form. Without this, a worry
 * that keeps being renewed (a spouse in and out of view all evening) produced a stream of
 * near-identical short-lived purposes rather than one that a person is actually holding. */
export const PURSUIT_REFORM_COOLDOWN_SECONDS = 3 * SECONDS_PER_HOUR;
/** How long after setting out to look in on someone before setting out again is reasonable. The
 * same value `mind/concern.ts` uses for acting on a concern, for the same reason. */
export const CHECK_ON_STEP_COOLDOWN_SECONDS = 3 * SECONDS_PER_HOUR;

/**
 * Goal types a pursuit is NEVER allowed to propose or boost, stated once and enforced by a test.
 * Every one of these physically sends a person toward a confrontation; the v0.9 justice-concern
 * regression is what this list exists to make impossible to reintroduce by accident.
 */
export const PURSUIT_FORBIDDEN_GOALS: ReadonlySet<GoalType> = new Set<GoalType>([
  'attack', 'confront', 'rob', 'investigate', 'escort_custody', 'flee', 'surrender',
]);
/**
 * The goal types that actually SERVE a person, and therefore the only ones an active purpose may
 * add weight to when they happen to be aimed at that person.
 *
 * A whitelist rather than a "not forbidden" test, because of a real defect this caught: `report`
 * takes a GUARD as its target, so a villager who owed a favour to someone who happens to be of
 * the watch had "tell the watch about a crime" credited to the purpose of doing right by them —
 * and boosted accordingly. Reporting a crime to your benefactor is not repaying them. Only goals
 * whose whole point is to do the target some good belong here.
 */
export const PURSUIT_SERVING_GOALS: ReadonlySet<GoalType> = new Set<GoalType>([
  'help', 'check_on', 'help_recover_item', 'provide', 'recover_item', 'haul', 'build',
]);

export function pursuitsOf(p: Person): Pursuit[] { return (p.mind.pursuits ??= []); }
export function livePursuits(p: Person): Pursuit[] { return pursuitsOf(p).filter(x => x.status === 'active' || x.status === 'deferred'); }
export function activePursuits(p: Person): Pursuit[] { return pursuitsOf(p).filter(x => x.status === 'active'); }
export function pursuitById(p: Person, id: string | undefined): Pursuit | undefined { return id ? pursuitsOf(p).find(x => x.id === id) : undefined; }

/** What makes two purposes THE SAME purpose. Deliberately about the ORIENTATION, not the source:
 * a worry and a debt that both amount to "look after this person" must not become two competing
 * errands to the same door. */
export function pursuitIdentity(kind: PursuitKind, subjectId?: EntityId, itemId?: EntityId): string {
  return `${kind}:${itemId ?? subjectId ?? '?'}`;
}

// ---------------------------------------------------------------- formation
/**
 * Derive purposes from the live things that justify them. Idempotent and called on the coarse
 * upkeep cadence: a source that already has a purpose reinforces it rather than creating a
 * second one.
 *
 * Note what is NOT here: a justice pursuit. A justice concern already moves people to TELL the
 * watch (mind/concern.ts), and the watch's own role-and-severity reasoning already decides
 * whether to investigate or confront, with v0.2.3's re-engagement gating intact. Wrapping that
 * in a persistent purpose would walk straight past that gating and rebuild the v0.9 feedback
 * loop with a new name.
 */
export function formPursuits(world: World, p: Person): Pursuit[] {
  if (p.controlled || !p.alive) return [];
  const formed: Pursuit[] = [];
  const add = (spec: PursuitSpec): void => { const pu = record(world, p, spec); if (pu) formed.push(pu); };

  // ---- welfare concern → tend
  for (const c of concernsOf(p)) {
    if (c.status !== 'active' || c.kind !== 'welfare' || !c.subjectId || c.subjectId === p.id) continue;
    if (c.intensity < TEND_CONCERN_THRESHOLD) continue;
    const subject = world.person(c.subjectId);
    if (!subject || !subject.alive) continue;
    // The same two safety gates the v0.9 `check_on` goal already applies, applied here at the
    // level of the PURPOSE so a person never becomes oriented toward crossing a line they would
    // never actually cross: concern is not courage, and it does not reach across the outlaw
    // divide.
    if (subject.hostile !== p.hostile) continue;
    if (getRel(p, c.subjectId).fear > 0.25) continue;
    // There has to be something to actually pursue. Someone standing in front of me, plainly
    // unhurt, is not a purpose — the concern's own upkeep will discharge on the strength of
    // having seen them. A purpose needs either a real information gap ("I have not seen her")
    // or real believed harm ("I know she was beaten"). Measured directly on seed 1337: without
    // this gate roughly four in five `tend` purposes formed and resolved without a single step
    // ever being taken, which is churn dressed up as motivation.
    const seenNow = p.mind.percepts.some(pc => pc.entityId === c.subjectId);
    const harm = believedHarm(world, p, c.subjectId);
    if (seenNow && harm < 0.2) continue;
    add({
      kind: 'tend', subjectId: c.subjectId, source: { kind: 'concern', id: c.id },
      situationId: c.situationId, causeEventId: causeOfConcern(world, p, c),
      reasons: [`I am worried about ${subject.name}`, ...c.reasons.slice(0, 2)],
    });
  }

  // ---- an unfulfilled recover_item desire → recover (mine, or someone else's I agreed to find)
  for (const d of p.desires) {
    if (d.fulfilled || d.type !== 'recover_item' || !d.targetId) continue;
    const it = world.item(d.targetId);
    if (!it) continue;
    add({
      kind: 'recover', itemId: it.id, subjectId: it.ownerId ?? p.id,
      source: { kind: 'desire', id: `desire:${d.targetId}` },
      reasons: [d.note],
    });
  }
  // Someone else asked me to find something and I said I would (the `wanted:` belief is the
  // record of that). Same purpose, different owner.
  for (const k of Object.values(p.knowledge)) {
    if (k.kind !== 'fact' || !k.claim.wantedItem || !k.claim.itemId) continue;
    const requesterId = k.claim.requesterId as EntityId | undefined;
    if (!requesterId || requesterId === p.id) continue;
    const requester = world.person(requesterId);
    if (!requester?.alive) continue;
    if (!requester.desires.some(d => d.type === 'recover_item' && d.targetId === k.claim.itemId && !d.fulfilled)) continue;
    add({
      kind: 'recover', itemId: k.claim.itemId as EntityId, subjectId: requesterId,
      source: { kind: 'desire', id: `wanted:${k.claim.itemId}` },
      causeEventId: k.source.viaEvent,
      reasons: [`${requester.name} asked me to find ${world.nameOf(k.claim.itemId as EntityId)}`],
    });
  }

  // ---- obligations → discharge (a promise I made) / reciprocate (a kindness I owe for)
  for (const o of liveObligations(p)) {
    if (o.kind === 'accepted_task' && o.requestId) {
      const req = requestById(world, o.requestId);
      if (!req || req.status !== 'accepted') continue;
      add({
        kind: 'discharge', subjectId: o.towardId, source: { kind: 'request', id: req.id },
        causeEventId: o.causeEventId, reasons: o.reasons.slice(0, 2),
      });
      continue;
    }
    if (o.magnitude < RECIPROCATE_THRESHOLD) continue;
    const other = world.person(o.towardId);
    if (!other?.alive || other.hostile !== p.hostile) continue;
    if (getRel(p, o.towardId).fear > 0.3) continue;
    add({
      kind: 'reciprocate', subjectId: o.towardId, source: { kind: 'obligation', id: o.id },
      causeEventId: o.causeEventId, reasons: o.reasons.slice(0, 2),
    });
  }
  return formed;
}

/** The canonical event that ultimately lies behind a concern, when one can be traced — this is
 * what makes "what caused this purpose" answerable in the observer overlay. */
function causeOfConcern(world: World, p: Person, c: Concern): EventId | undefined {
  for (const key of c.basisKeys) {
    const k = p.knowledge[key];
    const id = (k?.claim.eventId as EventId | undefined) ?? k?.source.viaEvent;
    if (id && world.event(id)) return id;
  }
  return undefined;
}

interface PursuitSpec {
  kind: PursuitKind; subjectId?: EntityId; itemId?: EntityId; placeId?: EntityId;
  source: Pursuit['source']; causeEventId?: EventId; situationId?: string; reasons: string[];
}

function record(world: World, p: Person, s: PursuitSpec): Pursuit | null {
  const list = pursuitsOf(p);
  const identity = pursuitIdentity(s.kind, s.subjectId, s.itemId);
  const existing = list.find(x => (x.status === 'active' || x.status === 'deferred')
    && pursuitIdentity(x.kind, x.subjectId, x.itemId) === identity);
  if (!existing) {
    // Recently finished with this exact purpose: leave it finished for a while. Fresh grounds
    // that genuinely matter will still be there when the cooldown lapses.
    const settled = list.find(x => x.status !== 'active' && x.status !== 'deferred'
      && pursuitIdentity(x.kind, x.subjectId, x.itemId) === identity
      && world.now - (x.resolvedAt ?? 0) < PURSUIT_REFORM_COOLDOWN_SECONDS);
    if (settled) return null;
  }
  if (existing) {
    // Fresh grounds for something I am already trying to do: the purpose is renewed, not doubled.
    existing.source = s.source;
    if (!existing.causeEventId) existing.causeEventId = s.causeEventId;
    for (const r of s.reasons) if (r && !existing.reasons.includes(r)) existing.reasons.push(r);
    if (existing.reasons.length > 4) existing.reasons.length = 4;
    return null;
  }
  const now = world.now;
  const pu: Pursuit = {
    id: world.nextId('pu'), kind: s.kind, subjectId: s.subjectId, itemId: s.itemId, placeId: s.placeId,
    source: s.source, causeEventId: s.causeEventId, situationId: s.situationId,
    priority: 0, createdAt: now, lastProgressAt: now, attempts: 0,
    expiresAt: now + PURSUIT_MAX_HOURS[s.kind] * SECONDS_PER_HOUR,
    status: 'deferred', steps: [], reasons: s.reasons.filter(Boolean).slice(0, 3),
  };
  list.push(pu);
  const cause = world.event(s.causeEventId);
  world.emit('pursuit_formed', {
    actor: p.id, target: s.subjectId, item: s.itemId, category: 'cognition',
    causes: cause ? [cause.id] : [],
    significance: Math.min(0.35, cause ? cause.significance : 0.2),
    data: { pursuitId: pu.id, kind: pu.kind, subjectId: pu.subjectId, itemId: pu.itemId, source: pu.source.kind },
    summary: `${p.name} set themselves to ${describePursuit(world, pu)}`,
  });
  prune(world, p);
  return pu;
}

function prune(world: World, p: Person): void {
  const list = pursuitsOf(p);
  if (list.length <= MAX_PURSUITS) return;
  // Drop the lowest-priority LIVE purpose (with its own honest resolution) rather than silently
  // deleting a row — a purpose that was crowded out is a real thing that happened to a person.
  const live = list.filter(x => x.status === 'active' || x.status === 'deferred').sort((a, b) => a.priority - b.priority);
  while (list.length > MAX_PURSUITS && live.length) {
    const victim = live.shift()!;
    resolvePursuit(world, p, victim, 'abandoned', 'superseded');
    const i = list.indexOf(victim);
    if (i >= 0) list.splice(i, 1);
  }
  if (list.length > MAX_PURSUITS) {
    const settled = list.filter(x => x.status !== 'active' && x.status !== 'deferred').sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    for (const s of settled) { if (list.length <= MAX_PURSUITS) break; list.splice(list.indexOf(s), 1); }
  }
}

// ---------------------------------------------------------------- priority
/** How hard this purpose presses on this person right now, 0..1, recomputed from the live source
 * every upkeep so it tracks reality rather than drifting. */
export function pursuitPriority(world: World, p: Person, pu: Pursuit): number {
  switch (pu.kind) {
    case 'tend': {
      const c = concernsOf(p).find(x => x.id === pu.source.id);
      const base = c && c.status === 'active' ? c.intensity : 0;
      const tie = pu.subjectId ? (isFamily(p, pu.subjectId) ? 1 : isClose(p, pu.subjectId) ? 0.85 : 0.62) : 0.6;
      const believed = pu.subjectId ? believedHarm(world, p, pu.subjectId) : 0;
      return clamp(base * tie + believed * 0.25);
    }
    case 'recover': {
      const desire = p.desires.find(d => d.type === 'recover_item' && d.targetId === pu.itemId && !d.fulfilled);
      const reward = desire ? Math.min(0.3, desire.reward / 50) : 0.12;
      const mine = pu.subjectId === p.id;
      const c = concernsOf(p).find(x => x.status === 'active' && x.kind === 'property' && x.itemId === pu.itemId);
      return clamp(0.24 + reward + (mine ? 0.16 : 0.08) + (c ? c.intensity * 0.3 : 0));
    }
    case 'discharge': {
      const o = obligationsOf(p).find(x => x.status === 'live' && x.requestId === pu.source.id);
      return clamp(o ? o.magnitude : 0.3);
    }
    case 'reciprocate': {
      const o = obligationsOf(p).find(x => x.id === pu.source.id);
      return clamp((o && o.status === 'live' ? o.magnitude : 0) * 0.75);
    }
  }
}

/** How badly this person BELIEVES the other is hurt — from their own beliefs only (a first-hand
 * look, or a harm belief they hold), never from the canonical body. 0..1. */
export function believedHarm(world: World, p: Person, subjectId: EntityId): number {
  const st = p.knowledge[`state:${subjectId}`];
  if (st) {
    const state = st.claim.state as string | undefined;
    if (state === 'dead') return 1;
    if (state === 'badly hurt') return 0.8;
    if (state === 'hurt') return 0.45;
    if (state === 'unharmed') return 0;
  }
  let worst = 0;
  for (const k of Object.values(p.knowledge)) {
    if (k.kind !== 'event' || k.claim.target !== subjectId) continue;
    const type = k.claim.type as string;
    if (type !== 'attack' && type !== 'kill') continue;
    if (world.now - ((k.claim.tick as number) ?? k.learnedAt) > 2 * 24 * 3600) continue;
    // Confidence scales this GENTLY on purpose. It is not "how likely is it that this happened"
    // — the concern layer already discounts a third-hand rumour on exactly that axis, and
    // discounting twice is what made a spouse who had been told her husband was beaten treat it
    // as barely worth bringing anything for. This answers a different question: GIVEN that I
    // believe it, how badly off do I think they are? A beating is a beating.
    worst = Math.max(worst, type === 'kill' ? 1 : 0.4 + 0.25 * k.confidence);
  }
  return worst;
}

// ---------------------------------------------------------------- steps
export interface PursuitStep {
  goal: GoalType;
  targetEntity?: EntityId;
  targetPlace?: EntityId;
  targetPos?: Vec3;
  data?: Record<string, any>;
  /** 0..1 — how directly this step serves the purpose right now. Scales the proposed utility. */
  fit: number;
  reason: string;
}

/**
 * What, given the world exactly as it is and as this person believes it to be, would actually
 * serve this purpose right now. Re-derived every time; never cached, never a stored plan.
 *
 * This is the composition rule the milestone asks for: the purpose knows what it wants, the
 * world decides which existing capability currently gets there. Someone tending an injured
 * spouse walks over when they do not know where she is, tends her when she is in front of them,
 * and fetches food from the larder when they know she is hurt and have something to bring —
 * three different goals, one purpose, no script.
 */
export function pursuitSteps(world: World, p: Person, pu: Pursuit): PursuitStep[] {
  switch (pu.kind) {
    case 'tend': return tendSteps(world, p, pu);
    case 'recover': return recoverSteps(world, p, pu);
    case 'discharge': return dischargeSteps(world, p, pu);
    case 'reciprocate': return reciprocateSteps(world, p, pu);
  }
}

function tendSteps(world: World, p: Person, pu: Pursuit): PursuitStep[] {
  const subjectId = pu.subjectId; if (!subjectId) return [];
  const subject = world.person(subjectId); if (!subject || !subject.alive) return [];
  const body = world.primaryBody(p.id); if (!body) return [];
  const seen = p.mind.percepts.find(pc => pc.entityId === subjectId);
  const theirBody = seen ? world.body(seen.bodyId) : world.primaryBody(subjectId);

  // They are in front of me. If they are hurt, tend them; if I am carrying something they can
  // use, hand it over. If they are plainly well, there is nothing to do and the concern's own
  // upkeep will discharge on the strength of having seen them.
  if (seen && theirBody) {
    const wound = woundSeverity(theirBody);
    if (wound > 0.08 || theirBody.pose === 'downed') {
      const steps: PursuitStep[] = [{
        goal: 'help', targetEntity: subjectId, fit: 1,
        reason: `${subject.name} is hurt and in front of me`,
      }];
      const carried = carriedProvision(world, p);
      if (carried && wound >= SERIOUS_WOUND) steps.push({
        goal: 'provide', targetEntity: subjectId, targetPos: { ...theirBody.pos },
        data: { itemId: carried.id }, fit: 0.95,
        reason: `I have ${carried.name} for ${subject.name}`,
      });
      return steps;
    }
    return [];
  }

  // Not in front of me. If I believe they are hurt and I can lay hands on something worth
  // bringing, that is a better answer than turning up empty-handed.
  const believed = believedHarm(world, p, subjectId);
  if (believed >= 0.35) {
    const provision = provisionFor(world, p);
    if (provision) {
      const dest = believedPosition(world, p, subjectId);
      if (dest) return [{
        goal: 'provide', targetEntity: subjectId, targetPos: dest.pos, targetPlace: dest.placeId,
        data: { itemId: provision.item.id, sourcePlaceId: provision.sourcePlaceId },
        // The most direct thing you can do for someone you believe is hurt and cannot see:
        // pick something up and take it to them.
        fit: 1,
        reason: `${subject.name} is hurt — I can bring ${provision.item.name}`,
      }];
    }
  }
  const dest = believedPosition(world, p, subjectId);
  if (!dest) return []; // I have no idea where to even look; going nowhere is honest
  // Going to look is an ERRAND, and errands are spaced out. Without this the purpose re-proposed
  // the same walk the instant the previous one's plan finished — measured directly as a
  // check_on/socialize alternation four times inside twenty minutes, which is oscillation
  // wearing a purpose's clothes. Mirrors `mind/concern.ts`'s own action cooldown, which the
  // v0.9 `check_on` candidate already respects; the purpose must respect it too or it simply
  // routes around it.
  if (pu.steps[pu.steps.length - 1] === 'check_on' && world.now - (pu.lastAttemptAt ?? 0) < CHECK_ON_STEP_COOLDOWN_SECONDS) return [];
  return [{
    goal: 'check_on', targetEntity: subjectId, targetPos: dest.pos, targetPlace: dest.placeId,
    data: { concernId: pu.source.kind === 'concern' ? pu.source.id : undefined },
    fit: 0.8,
    reason: `I have not seen ${subject.name} and I want to know how they are`,
  }];
}

function recoverSteps(world: World, p: Person, pu: Pursuit): PursuitStep[] {
  const itemId = pu.itemId; if (!itemId) return [];
  const it = world.item(itemId); if (!it) return [];
  const mine = it.ownerId === p.id;
  const ownerId = it.ownerId ?? pu.subjectId;

  if (it.holderId === p.id) {
    if (mine || !ownerId) return []; // already back where it belongs
    return [{
      goal: 'help_recover_item', targetEntity: itemId, fit: 1,
      data: { deliverTo: ownerId }, reason: `I have ${it.name} — it should go back to ${world.nameOf(ownerId)}`,
    }];
  }
  const loc = p.knowledge[`loc:${itemId}`];
  const pos = loc?.claim.pos as Vec3 | undefined;
  if (pos && !it.holderId) {
    return [mine
      ? { goal: 'recover_item', targetEntity: itemId, targetPos: { ...pos }, fit: 1, reason: `I know where ${it.name} is` }
      : { goal: 'help_recover_item', targetEntity: itemId, targetPos: { ...pos }, data: { deliverTo: ownerId }, fit: 0.95, reason: `I know where ${it.name} is and ${world.nameOf(ownerId)} wants it back` }];
  }
  // I do not know where it is. Asking around is a real step, not a placeholder — the conversation
  // layer (`maybeAskForHelp`, `pickGossip`) is how `wanted:` and `loc:` beliefs actually travel
  // between people, so being among people is genuinely how a lost thing gets found here.
  //
  // But it is deliberately NOT a special trip. It is gated on the person already having some
  // appetite for company, so what this expresses is "I'll raise it while I'm among people
  // anyway", not "a lost ring sends everyone to the square". Measured directly: ungated, this
  // step outbid `idle` for anyone holding an unlocated lost-item purpose, which turned standing
  // about into a standing errand and pulled people away from where they were — including away
  // from items they were about to notice for themselves, which is the opposite of helpful.
  if (p.needs.social < 0.32) return [];
  const gathering = world.places().find(pl => pl.type === 'square') ?? world.places().find(pl => pl.type === 'tavern');
  if (!gathering) return [];
  return [{
    goal: 'socialize', targetPlace: gathering.id, fit: 0.4,
    data: { askingAbout: itemId }, reason: `nobody knows where ${it.name} went — I'll ask about it while I'm among people`,
  }];
}

function dischargeSteps(world: World, p: Person, pu: Pursuit): PursuitStep[] {
  const req = requestById(world, pu.source.id);
  if (!req || req.status !== 'accepted') return [];
  const beneficiary = req.requesterId ?? undefined;
  if (req.type === 'haul') {
    const task = world.haulTasks.find(t => t.requestId === req.id);
    if (!task || task.status === 'delivered' || task.status === 'failed' || task.status === 'cancelled') return [];
    const src = world.place(task.sourcePlaceId);
    return [{
      goal: 'haul', targetPlace: src ? task.sourcePlaceId : undefined, targetPos: src?.inside,
      data: { taskId: task.id, beneficiary }, fit: 1,
      reason: `I said I would carry ${task.resource} to ${world.nameOf(task.destPlaceId)}`,
    }];
  }
  if (req.type === 'construction_labor' && req.payload.projectId) {
    const proj = world.constructionProjects.find(x => x.id === req.payload.projectId);
    if (!proj || proj.status === 'complete' || proj.status === 'cancelled') return [];
    return [{
      goal: 'build', targetPlace: proj.sitePlaceId, data: { projectId: proj.id, beneficiary }, fit: 1,
      reason: `I took on a hand's work at ${proj.name}`,
    }];
  }
  if (req.type === 'production' && req.payload.placeId) {
    return [{
      goal: 'work', targetPlace: req.payload.placeId, data: { beneficiary, label: req.cause }, fit: 0.9,
      reason: `I took on ${req.cause}`,
    }];
  }
  return [];
}

/**
 * Repayment never becomes an errand of its own. A `reciprocate` purpose proposes a step ONLY when
 * ordinary world state has thrown up a real opportunity to do the person some good — they are
 * hurt, they need something carried, they have lost something I know the whereabouts of. The rest
 * of the time it sits there, live and remembered, biasing decisions through
 * `obligationGoalBoost` and proposing nothing at all. That is what "do not force immediate
 * repayment" and "the opportunity must arise through ordinary world state" mean mechanically.
 */
function reciprocateSteps(world: World, p: Person, pu: Pursuit): PursuitStep[] {
  const towardId = pu.subjectId; if (!towardId) return [];
  const other = world.person(towardId); if (!other || !other.alive) return [];
  const steps: PursuitStep[] = [];

  // They are hurt and I know it.
  const believed = believedHarm(world, p, towardId);
  if (believed >= 0.4) {
    const seen = p.mind.percepts.find(pc => pc.entityId === towardId);
    if (seen) steps.push({ goal: 'help', targetEntity: towardId, fit: 0.95, reason: `${other.name} is hurt, and I owe them` });
    else {
      const dest = believedPosition(world, p, towardId);
      if (dest) steps.push({ goal: 'check_on', targetEntity: towardId, targetPos: dest.pos, targetPlace: dest.placeId, fit: 0.7, reason: `${other.name} is hurt, and I owe them` });
    }
  }
  // They have work out that nobody has taken.
  const task = world.haulTasks.find(t => t.status === 'needed' && t.requesterId === towardId);
  if (task) {
    const src = world.place(task.sourcePlaceId);
    steps.push({
      goal: 'haul', targetPlace: src ? task.sourcePlaceId : undefined, targetPos: src?.inside,
      data: { taskId: task.id, beneficiary: towardId }, fit: 0.85,
      reason: `${other.name} needs ${task.resource} carried, and I owe them a turn`,
    });
  }
  // They have lost something and I happen to know where it is.
  for (const k of Object.values(p.knowledge)) {
    if (k.kind !== 'fact' || !k.claim.wantedItem || k.claim.requesterId !== towardId) continue;
    const itemId = k.claim.itemId as EntityId;
    const it = world.item(itemId); const loc = p.knowledge[`loc:${itemId}`];
    if (!it || it.holderId || !loc?.claim.pos) continue;
    steps.push({
      goal: 'help_recover_item', targetEntity: itemId, targetPos: { ...(loc.claim.pos as Vec3) },
      data: { deliverTo: towardId }, fit: 0.9,
      reason: `${other.name} is looking for ${it.name}, and I owe them`,
    });
    break;
  }
  return steps;
}

/** Where this person BELIEVES the other is — their own remembered sighting, else that person's
 * home, which is ordinary social knowledge. Never the live body. */
function believedPosition(world: World, p: Person, subjectId: EntityId): { pos: Vec3; placeId?: EntityId } | null {
  const loc = p.knowledge[`loc:${subjectId}`];
  const remembered = loc?.claim.pos as Vec3 | undefined;
  if (remembered) return { pos: { ...remembered }, placeId: (loc.claim.placeId as EntityId | undefined) };
  const subject = world.person(subjectId);
  const home = subject?.homeId ? world.place(subject.homeId) : undefined;
  if (home) return { pos: { ...home.inside }, placeId: home.id };
  return null;
}

/** Food already in hand. */
function carriedProvision(world: World, p: Person): Item | null {
  for (const id of p.inventory) { const it = world.item(id); if (it && isFood(it.type) && it.quantity > 0) return it; }
  return null;
}

/**
 * Something worth bringing someone who is hurt, and where to pick it up. Deliberately restricted
 * to what this person may actually take — their own food, or their household's larder — so a
 * caring act can never quietly manufacture a theft. `householdAccess` is the same access rule
 * `world/metabolism.ts`'s `findAccessibleFood` already uses for eating.
 */
export function provisionFor(world: World, p: Person): { item: Item; sourcePlaceId?: EntityId } | null {
  const carried = carriedProvision(world, p);
  if (carried) return { item: carried };
  const home = p.homeId ? world.place(p.homeId) : undefined;
  if (!home) return null;
  const residents = new Set(home.residents ?? []);
  for (const it of world.items()) {
    if (it.holderId || it.placeId !== home.id || !isFood(it.type) || it.quantity <= 0) continue;
    if (it.ownerId && it.ownerId !== p.id && !residents.has(it.ownerId)) continue;
    return { item: it, sourcePlaceId: home.id };
  }
  return null;
}

// ---------------------------------------------------------------- outcome + upkeep
/** Whether this purpose is still live, and if not, why not — read from the live source and from
 * canonical world state, never from a stored plan. */
export function pursuitOutcome(world: World, p: Person, pu: Pursuit): { status: PursuitStatus; resolution: string } | null {
  const now = world.now;
  if (pu.subjectId) {
    const subject = world.person(pu.subjectId);
    if (subject && !subject.alive) return { status: 'impossible', resolution: 'they_died' };
  }
  switch (pu.source.kind) {
    case 'concern': {
      const c = concernsOf(p).find(x => x.id === pu.source.id);
      if (!c) return { status: 'abandoned', resolution: 'source_gone' };
      if (c.status === 'addressed') return { status: 'satisfied', resolution: 'seen_well' };
      if (c.status === 'faded') return { status: 'abandoned', resolution: 'no_longer_pressing' };
      break;
    }
    case 'obligation': {
      const o = obligationsOf(p).find(x => x.id === pu.source.id);
      if (!o) return { status: 'abandoned', resolution: 'source_gone' };
      if (o.status === 'fulfilled') return { status: 'satisfied', resolution: 'repaid' };
      if (o.status === 'forgiven') return { status: 'satisfied', resolution: 'forgiven' };
      if (o.status !== 'live') return { status: 'abandoned', resolution: o.resolution ?? 'source_gone' };
      break;
    }
    case 'request': {
      const req = requestById(world, pu.source.id);
      if (!req) return { status: 'abandoned', resolution: 'source_gone' };
      if (req.status === 'completed') return { status: 'satisfied', resolution: 'work_done' };
      if (req.status === 'failed') return { status: 'abandoned', resolution: 'never_finished' };
      if (req.status === 'cancelled') return { status: 'abandoned', resolution: 'called_off' };
      if (req.acceptedBy !== p.id) return { status: 'abandoned', resolution: 'someone_else_took_it' };
      break;
    }
    case 'desire': {
      if (pu.itemId) {
        const it = world.item(pu.itemId);
        if (!it) return { status: 'impossible', resolution: 'source_gone' };
        const ownerId = it.ownerId ?? pu.subjectId;
        if (ownerId && it.holderId === ownerId) return { status: 'satisfied', resolution: 'delivered' };
        const owner = ownerId ? world.person(ownerId) : undefined;
        if (owner && !owner.desires.some(d => d.type === 'recover_item' && d.targetId === pu.itemId && !d.fulfilled)) {
          return { status: 'satisfied', resolution: 'delivered' };
        }
      }
      break;
    }
  }
  if (now >= pu.expiresAt) return { status: 'abandoned', resolution: 'expired' };
  if (pu.attempts >= MAX_PURSUIT_ATTEMPTS && now - pu.lastProgressAt > NO_PROGRESS_SECONDS) {
    return { status: 'abandoned', resolution: 'no_progress' };
  }
  return null;
}

/**
 * The cheap, immediate satisfaction test, run from think() rather than only from the coarse
 * upkeep pass. A purpose whose condition is ALREADY met must end at the moment it is met, not up
 * to ten world-minutes later.
 *
 * This is not an optimisation. Measured directly (seed 4242): a husband carrying bread to his
 * wife arrived at the shop where they both work, saw her plainly recovered — at which point
 * `pursuitSteps` correctly had nothing left to propose — and then flipped between the errand and
 * his own work shift every three minutes until the next upkeep pass got round to discharging the
 * concern behind it. The purpose was over; only the bookkeeping had not caught up, and the
 * oscillation was entirely an artefact of that gap.
 */
export function satisfiedNow(world: World, p: Person, pu: Pursuit): string | null {
  if (pu.status !== 'active' && pu.status !== 'deferred') return null;
  if (pu.kind === 'tend' && pu.subjectId) {
    const subject = world.person(pu.subjectId);
    const seen = p.mind.percepts.some(pc => pc.entityId === pu.subjectId);
    if (!subject || !seen) return null;
    const body = world.primaryBody(pu.subjectId);
    if (subject.alive && body && !body.dead && body.pose !== 'downed' && body.health >= body.maxHealth * 0.9) return 'seen_well';
    return null;
  }
  if (pu.kind === 'recover' && pu.itemId) {
    const it = world.item(pu.itemId);
    const ownerId = it?.ownerId ?? pu.subjectId;
    if (it && ownerId && it.holderId === ownerId) return 'delivered';
  }
  return null;
}

export function resolvePursuit(world: World, p: Person, pu: Pursuit, status: PursuitStatus, resolution: string): void {
  if (pu.status !== 'active' && pu.status !== 'deferred') return;
  pu.status = status;
  pu.resolvedAt = world.now;
  pu.resolution = resolution;
  pu.currentStep = undefined;
  world.emit('pursuit_resolved', {
    actor: p.id, target: pu.subjectId, item: pu.itemId, category: 'cognition',
    significance: status === 'satisfied' ? 0.28 : 0.2,
    data: { pursuitId: pu.id, kind: pu.kind, status, resolution, steps: pu.steps.slice(0, 8), sinceTick: pu.createdAt },
    summary: `${p.name} ${status === 'satisfied' ? 'saw through' : status === 'impossible' ? 'could no longer' : 'gave up'} ${describePursuit(world, pu)} (${resolution})`,
  });
}

/**
 * Periodic upkeep, on the same coarse cadence as concern/obligation/relationship evolution.
 * Resolves what is finished, reprioritises what is left, and decides which purposes are ACTIVE.
 *
 * The active/deferred split, with its dwell time and its priority margin, is the whole of the
 * "motivations compete without oscillating" requirement: a person genuinely has several live
 * purposes, only the most pressing couple of them are organising their day, the choice is
 * explainable from the numbers, and it changes when the numbers change — not every tick.
 */
export function maintainPursuits(world: World, p: Person): void {
  const list = p.mind.pursuits;
  if (!list || !list.length) return;
  const now = world.now;
  for (const pu of list) {
    if (pu.status !== 'active' && pu.status !== 'deferred') continue;
    const outcome = pursuitOutcome(world, p, pu);
    if (outcome) { resolvePursuit(world, p, pu, outcome.status, outcome.resolution); continue; }
    pu.priority = pursuitPriority(world, p, pu);
  }
  // Keep the settled ones as a short history, then decide the live ordering.
  const live = list.filter(x => x.status === 'active' || x.status === 'deferred').sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  const holding = live.filter(x => x.status === 'active' && now - (x.lastAttemptAt ?? x.createdAt) < PURSUIT_MIN_DWELL_SECONDS);
  const chosen: Pursuit[] = [...holding];
  for (const pu of live) {
    if (chosen.length >= MAX_ACTIVE_PURSUITS) break;
    if (chosen.includes(pu)) continue;
    // A purpose already in place is only displaced by one that is meaningfully more pressing.
    const weakest = chosen.length ? Math.min(...chosen.map(x => x.priority)) : -1;
    if (chosen.length < MAX_ACTIVE_PURSUITS || pu.priority > weakest + PRIORITY_MARGIN) chosen.push(pu);
  }
  for (const pu of live) {
    const shouldBeActive = chosen.includes(pu);
    if (shouldBeActive && pu.status !== 'active') pu.status = 'active';
    else if (!shouldBeActive && pu.status === 'active') { pu.status = 'deferred'; pu.currentStep = undefined; }
  }
  const settled = list.filter(x => x.status !== 'active' && x.status !== 'deferred').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const keep = [...live, ...settled.slice(0, 3)];
  if (keep.length !== list.length) { list.length = 0; list.push(...keep); }
  // Whatever this person is doing right now may already be serving one of these purposes — see
  // `linkGoalToPursuit` for why catching it here as well as at adoption time is necessary.
  linkGoalToPursuit(world, p, p.mind.goal);
}

/**
 * Record that this person's CURRENT goal is serving `pu`, if it is — and that no other purpose is.
 *
 * Called from two places, and it needs both. `setGoal` catches the ordinary case, where a goal is
 * adopted while the purpose already exists. The upkeep pass catches the case that ordinary case
 * misses entirely: a haul is adopted, `plan()` claims the task, claiming it accepts the canonical
 * `Request`, accepting it creates the obligation, and only at the NEXT upkeep does the purpose to
 * discharge it exist — by which point the goal is long since adopted and hysteresis will keep it
 * for the rest of the job, so `setGoal` is never called again. Measured on seed 42424242: every
 * single `discharge` purpose in a two-day run reported zero attempts and no steps, while the work
 * it stood for was being done the whole time.
 *
 * `attempts` counts how many times this purpose has taken the reins, not how many ticks it has
 * held them, so re-recording the same goal key is a no-op.
 */
export function linkGoalToPursuit(world: World, p: Person, goal: Goal | null): Pursuit | undefined {
  if (!goal) return undefined;
  const pu = pursuitForGoal(world, p, goal);
  for (const other of pursuitsOf(p)) if (other !== pu && other.currentStep) other.currentStep = undefined;
  if (!pu || pu.status !== 'active') return undefined;
  goal.data = { ...(goal.data ?? {}), pursuitId: pu.id };
  if (pu.currentStep === goal.key) return pu;
  pu.attempts += 1;
  pu.lastAttemptAt = world.now;
  pu.currentStep = goal.key;
  if (pu.steps[pu.steps.length - 1] !== goal.type) pu.steps.push(goal.type);
  if (pu.steps.length > 12) pu.steps.splice(0, pu.steps.length - 12);
  return pu;
}
/** A step of this purpose actually got somewhere — resets the no-progress backstop. */
export function notePursuitProgress(world: World, pu: Pursuit): void { pu.lastProgressAt = world.now; }

// ---------------------------------------------------------------- behavioural bridge
/**
 * What an ACTIVE purpose adds to a candidate goal someone else already proposed. Complements
 * `pursuitSteps` (which proposes goals of its own): the ordinary "help someone hurt in front of
 * me" rule, or a schedule slot that happens to take me to the right place, should also feel the
 * pull of what I am trying to do.
 *
 * Bounded, and never applied to a forbidden goal — a purpose can make you helpful, never
 * belligerent.
 */
export interface PursuitBoost { bonus: number; reasons: string[]; pursuitId?: string; }
export function pursuitGoalBoost(p: Person, goalType: GoalType, targetId?: EntityId, beneficiaryId?: EntityId): PursuitBoost {
  const list = p.mind.pursuits;
  if (!list || !list.length || !PURSUIT_SERVING_GOALS.has(goalType)) return { bonus: 0, reasons: [] };
  let bonus = 0; let best: Pursuit | null = null;
  for (const pu of list) {
    if (pu.status !== 'active') continue;
    const who = beneficiaryId ?? targetId;
    const serves = (pu.subjectId && who === pu.subjectId) || (pu.itemId && targetId === pu.itemId);
    if (!serves) continue;
    const contribution = Math.min(MAX_PURSUIT_BONUS, pu.priority * 0.3);
    if (contribution <= bonus) continue;
    bonus = contribution; best = pu;
  }
  if (!best) return { bonus: 0, reasons: [] };
  return { bonus, reasons: [`purpose: ${describePursuit(undefined, best)} (${best.priority.toFixed(2)})`, ...best.reasons.slice(0, 1)], pursuitId: best.id };
}

/**
 * THE single behavioural bridge every candidate goal passes through (v0.10 §III).
 *
 * Before this there was one (`concernGoalBoost`). There are now three things a mind can carry
 * that ought to bend what it does — a live concern, a standing obligation, an active purpose —
 * and if each simply added its own bonus, a person with all three could see a candidate lifted
 * by more than 0.7, which is not "bending a decision" but replacing it. So they are combined
 * here and capped ONCE, at `MAX_MOTIVATION_BONUS`, which keeps the v0.9 guarantee intact: a
 * motivated person's ordinary behaviour genuinely bends, and never becomes a special mode.
 */
export const MAX_MOTIVATION_BONUS = 0.34;
export interface MotivationBoost { bonus: number; reasons: string[]; pursuitId?: string; }
export function motivationBoost(p: Person, goalType: GoalType, targetId?: EntityId, beneficiaryId?: EntityId): MotivationBoost {
  const concern = concernGoalBoost(p, goalType, targetId);
  const obligation = obligationGoalBoost(p, goalType, targetId, beneficiaryId);
  const purpose = pursuitGoalBoost(p, goalType, targetId, beneficiaryId);
  const raw = concern.bonus + obligation.bonus + purpose.bonus;
  if (raw <= 0) return { bonus: 0, reasons: [] };
  const bonus = Math.min(MAX_MOTIVATION_BONUS, raw);
  const reasons: string[] = [];
  if (purpose.bonus) reasons.push(...purpose.reasons);
  if (concern.bonus) reasons.push(...concern.reasons);
  if (obligation.bonus) reasons.push(...obligation.reasons);
  return { bonus, reasons: reasons.slice(0, 4), pursuitId: purpose.pursuitId };
}

/** The utility a pursuit-proposed step should be offered at. `embodiment` is the caller's own
 * measure of how much room this person has for anything but their body right now — see
 * `mind/agent.ts`'s think(). */
export function pursuitStepUtility(pu: Pursuit, step: PursuitStep, embodiment: number): number {
  return clamp((PURSUIT_BASE_UTILITY + pu.priority * PURSUIT_UTILITY_SPAN) * step.fit * embodiment);
}

export function describePursuit(world: World | undefined, pu: Pursuit): string {
  const who = pu.subjectId ? (world ? world.nameOf(pu.subjectId) : 'them') : 'someone';
  const what = pu.itemId ? (world ? world.nameOf(pu.itemId) : 'it') : 'it';
  switch (pu.kind) {
    case 'tend': return `see to ${who}`;
    case 'recover': return `get ${what} back${pu.subjectId ? ` to ${who}` : ''}`;
    case 'discharge': return `finish the work they took on for ${who}`;
    case 'reciprocate': return `do right by ${who}`;
  }
}

/** Nearest active pursuit to a goal key — used by the observer overlay and the trace harness to
 * answer "why is this person doing this". */
export function pursuitForGoalKey(p: Person, goalKey: string | undefined): Pursuit | undefined {
  if (!goalKey) return undefined;
  return pursuitsOf(p).find(pu => pu.status === 'active' && pu.currentStep === goalKey);
}

/**
 * Which purpose, if any, the goal a person has just adopted is actually serving.
 *
 * The obvious answer — "the one that proposed it" — is not enough, and assuming it was produced a
 * real and misleading gap. A purpose competes by PROPOSING an ordinary goal, but the simulation
 * frequently had an equally good reason of its own to adopt that same goal: a hauler picks up the
 * very task they promised to do because it is also the nearest useful work, and the ordinary
 * candidate (0.68) simply outscores the purpose's own (≈0.5). Measured on seed 42424242: every
 * haul serving a `discharge` purpose was adopted through the ordinary path, so the purpose looked
 * — in its own records and in the observer overlay — as though it had never done anything, while
 * the work it stood for was in fact being carried out.
 *
 * So the link is established by MATCHING, not by attribution: a goal serves a purpose when it is
 * aimed at that purpose's subject, item, or deliverable. That is also the right answer for the
 * observer overlay, which has to explain a goal however it came to be chosen.
 */
export function pursuitForGoal(world: World, p: Person, goal: Goal): Pursuit | undefined {
  const explicit = pursuitById(p, goal.data?.pursuitId as string | undefined);
  if (explicit) return explicit;
  if (!PURSUIT_SERVING_GOALS.has(goal.type)) return undefined;
  for (const pu of pursuitsOf(p)) {
    if (pu.status !== 'active') continue;
    switch (pu.kind) {
      case 'discharge': {
        if (goal.type === 'haul' && goal.data?.taskId) {
          const task = world.haulTasks.find(t => t.id === goal.data!.taskId);
          if (task && task.requestId === pu.source.id) return pu;
        }
        if (goal.type === 'build' && goal.data?.projectId) {
          const req = requestById(world, pu.source.id);
          if (req?.payload.projectId === goal.data.projectId) return pu;
        }
        break;
      }
      case 'recover': {
        if (pu.itemId && goal.targetEntity === pu.itemId) return pu;
        break;
      }
      case 'tend': case 'reciprocate': {
        if (pu.subjectId && (goal.targetEntity === pu.subjectId || goal.data?.deliverTo === pu.subjectId || goal.data?.beneficiary === pu.subjectId)) return pu;
        if (pu.subjectId && goal.type === 'haul' && goal.data?.taskId) {
          const task = world.haulTasks.find(t => t.id === goal.data!.taskId);
          if (task && task.requesterId === pu.subjectId) return pu;
        }
        break;
      }
    }
  }
  return undefined;
}
