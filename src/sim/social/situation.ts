import type { EntityId, EventId, Person, Situation, SituationKind, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { crimeSeverity, isCrime } from '../mind/knowledge';

/**
 * SITUATIONS — the canonical "this matter is still going on" layer (v0.9 §G).
 *
 * The whole module is table-driven and names no individual, no place and no specific storyline.
 * `OPENERS` says which canonical event types start an ongoing matter and who its subject is;
 * `RESOLVERS` says which canonical event types can end one and how. Everything else — assault,
 * theft, missing property, a death, a noticed absence, a debt — flows through the same two
 * tables. There is deliberately no `if (type === 'attack')` branch anywhere below.
 *
 * A Situation is world bookkeeping, not knowledge. See `personalSituationView` for the only
 * sanctioned way a MIND is allowed to form a belief about whether a matter is over.
 */

/** How long an active situation with no further events goes quiet before it stops being "live
 * news" and becomes an old matter. Three world days: long enough that a fight on Monday is still
 * the talk of Wednesday, short enough that it is not still front-page a fortnight later. */
export const DORMANT_AFTER_SECONDS = 3 * 24 * 3600;
/** Beyond this, even a resolved/dormant situation contributes essentially nothing to relevance.
 * (It is still kept as history — see `MAX_SITUATIONS`.) */
export const RELEVANCE_HALFLIFE_SECONDS = 36 * 3600;
/** How near in time and identity two events must be to count as the SAME ongoing matter rather
 * than a fresh one — a second blow in the same brawl is not a second situation. */
export const ESCALATION_WINDOW_SECONDS = 12 * 3600;
/** Bounded like every other unbounded-by-time collection in the World (Constitution §71). The
 * oldest fully-settled matters are dropped first; an active one is never dropped. */
export const MAX_SITUATIONS = 240;

interface OpenerSpec {
  kind: SituationKind;
  /** Which field of the canonical event names the person the matter is happening TO. */
  subject: 'target' | 'actor';
  /** Which field, if any, names the person responsible. */
  responsible?: 'actor' | 'none';
}

/**
 * Which canonical event types open an ongoing matter. Adding a new significant event type to the
 * simulation means adding one row here — not a new reaction handler, not a new goal, not a new
 * dialogue template.
 */
const OPENERS: Record<string, OpenerSpec> = {
  attack: { kind: 'harm', subject: 'target', responsible: 'actor' },
  kill: { kind: 'harm', subject: 'target', responsible: 'actor' },
  death: { kind: 'grief', subject: 'target', responsible: 'none' },
  theft: { kind: 'property', subject: 'target', responsible: 'actor' },
  // `item_missing` is emitted BY the owner who noticed (actor), about their own item, with no
  // known culprit — the loss case as distinct from a witnessed theft.
  item_missing: { kind: 'loss', subject: 'actor', responsible: 'none' },
  // v0.9 §D: a real, inferred information gap in ordinary life — see social/absence.ts.
  absence_noticed: { kind: 'disruption', subject: 'target', responsible: 'none' },
  dispute: { kind: 'obligation', subject: 'target', responsible: 'actor' },
  debt: { kind: 'obligation', subject: 'target', responsible: 'actor' },
};

interface ResolverSpec {
  /** Which situation kinds this event type can settle. */
  kinds: SituationKind[];
  /** Whose identity the event must match for it to count. */
  match: 'actor_is_responsible' | 'subject_is_subject' | 'target_is_subject' | 'item_matches' | 'pair_matches' | 'pair_or_behalf';
  resolution: string;
}

/**
 * Which canonical event types can END a matter, and how. Again: no event names an individual.
 * A resolver only fires when the identities actually line up with the situation's own
 * participants — an arrest of somebody else does not settle this assault.
 */
const RESOLVERS: Record<string, ResolverSpec[]> = {
  entity_arrested: [{ kinds: ['harm', 'property', 'obligation'], match: 'actor_is_responsible', resolution: 'answered_for' }],
  custody_started: [{ kinds: ['harm', 'property', 'obligation'], match: 'actor_is_responsible', resolution: 'answered_for' }],
  returned_item: [{ kinds: ['property', 'loss'], match: 'item_matches', resolution: 'returned' }],
  recovered: [{ kinds: ['property', 'loss'], match: 'item_matches', resolution: 'recovered' }],
  apology: [{ kinds: ['harm', 'obligation', 'property'], match: 'pair_matches', resolution: 'settled' }],
  // A debt can be discharged by someone other than the debtor (a friend settling it for them —
  // see dialogue.ts's `payDebt`), so the settlement is matched on whose obligation it names.
  debt_paid: [{ kinds: ['obligation'], match: 'pair_or_behalf', resolution: 'settled' }],
  death: [{ kinds: ['harm', 'disruption'], match: 'target_is_subject', resolution: 'died' }],
};

/** Events that BEAR ON a matter without settling it — they keep it alive and are part of its
 * causal record (so "who did what about it" is answerable), but the matter itself continues. */
const CONTRIBUTORS: Record<string, SituationKind[]> = {
  heal: ['harm'],
  investigation: ['harm', 'property', 'loss'],
  confrontation: ['harm', 'property', 'obligation'],
  arrest_attempt: ['harm', 'property', 'obligation'],
  conflict_started: ['harm'],
  conflict_resolved: ['harm'],
  entity_surrendered: ['harm'],
  entity_subdued: ['harm'],
  told: [],
};

function participantsOf(e: WorldEvent, spec: OpenerSpec): { subjectId?: EntityId; actorId?: EntityId } {
  const subjectId = spec.subject === 'target' ? e.target : e.actor;
  const actorId = spec.responsible === 'actor' ? e.actor : undefined;
  return { subjectId, actorId };
}

/**
 * Event -> situation index. `situationForEvent` is called once per candidate belief inside
 * `mind/conversation.ts`'s `selectTopic`, which itself runs over a mind's whole knowledge map on
 * every chat opportunity — a linear scan of every situation, each scanning its own `eventIds`,
 * would make that quadratic in exactly the place it is called most. Rebuilt lazily whenever the
 * situation list changes identity (a new matter, or a prune), which is rare; `eventIds` growth on
 * an existing situation is applied incrementally at the two places that push to it.
 */
const eventIndex = new WeakMap<World, { map: Map<EventId, Situation>; count: number }>();
function indexFor(world: World): Map<EventId, Situation> {
  let entry = eventIndex.get(world);
  if (!entry || entry.count !== world.situations.length) {
    const map = new Map<EventId, Situation>();
    for (const s of world.situations) for (const id of s.eventIds) map.set(id, s);
    entry = { map, count: world.situations.length };
    eventIndex.set(world, entry);
  }
  return entry.map;
}
function indexEvent(world: World, eventId: EventId, sit: Situation): void {
  const entry = eventIndex.get(world);
  if (entry && entry.count === world.situations.length) entry.map.set(eventId, sit);
}

export function situationsInvolving(world: World, id: EntityId): Situation[] {
  return world.situations.filter(s => s.subjectId === id || s.actorId === id);
}
export function situationById(world: World, id: string | undefined): Situation | undefined {
  return id ? world.situations.find(s => s.id === id) : undefined;
}
/** The situation a given canonical event belongs to, if any. */
export function situationForEvent(world: World, eventId: EventId | undefined): Situation | undefined {
  if (!eventId) return undefined;
  return indexFor(world).get(eventId);
}

/**
 * The single entry point: every canonical event passes through here exactly once. Opens a new
 * matter, escalates an existing one, records a contribution, or settles one — all by table.
 */
export function noteEventForSituations(world: World, e: WorldEvent): Situation | null {
  applyResolvers(world, e);
  applyContributors(world, e);
  const spec = OPENERS[e.type];
  if (!spec) return null;
  const { subjectId, actorId } = participantsOf(e, spec);
  if (!subjectId) return null;
  const severity = isCrime(e.type, e.data?.intent) ? crimeSeverity(e.type) : Math.min(1, e.significance);
  // v0.9: a lawful subdual/arrest is not a fresh grievance-shaped matter (mind/knowledge.ts's
  // `isCrime` already draws this line for beliefs — situations must draw it in the same place,
  // or every arrest would open its own "harm" matter and the village would investigate the watch).
  if (e.type === 'attack' && !isCrime(e.type, e.data?.intent)) return null;

  const existing = world.situations.find(s =>
    s.status === 'active' && s.kind === spec.kind && s.subjectId === subjectId
    && (s.actorId ?? null) === (actorId ?? null)
    && world.now - s.lastEventAt < ESCALATION_WINDOW_SECONDS);
  if (existing) {
    existing.eventIds.push(e.id);
    indexEvent(world, e.id, existing);
    existing.lastEventAt = e.tick;
    existing.severity = Math.max(existing.severity, severity);
    return existing;
  }

  const sit: Situation = {
    id: world.nextId('sit'),
    kind: spec.kind,
    rootEventId: e.id,
    rootType: e.type,
    eventIds: [e.id],
    subjectId,
    actorId,
    itemId: e.item,
    placeId: e.placeId,
    openedAt: e.tick,
    lastEventAt: e.tick,
    status: 'active',
    severity,
  };
  world.situations.push(sit);
  // INVARIANT: a bookkeeping event's significance must never EXCEED that of the canonical event
  // it cites as its cause. `World.compactEvents` keeps events by significance, so a more
  // significant child outliving a less significant parent leaves a cause id pointing at nothing —
  // which is exactly what WorldLab's `dangling_cause` anomaly caught here (13 occurrences across
  // the construction scenario, all of them `situation_opened` citing a compacted
  // `absence_noticed`). Capping at the cause's own significance makes the pair compact together.
  world.emit('situation_opened', {
    actor: actorId, target: subjectId, item: e.item, placeId: e.placeId, causes: [e.id],
    significance: Math.min(0.5, severity, e.significance),
    data: { situationId: sit.id, kind: sit.kind, rootType: e.type },
    summary: `an unresolved matter began: ${describeSituation(world, sit)}`,
  });
  pruneSituations(world);
  return sit;
}

function applyContributors(world: World, e: WorldEvent): void {
  const kinds = CONTRIBUTORS[e.type];
  if (!kinds || !kinds.length) return;
  for (const s of world.situations) {
    if (s.status !== 'active' || !kinds.includes(s.kind)) continue;
    const touches = (e.actor && (e.actor === s.subjectId || e.actor === s.actorId))
      || (e.target && (e.target === s.subjectId || e.target === s.actorId));
    if (!touches) continue;
    if (!s.eventIds.includes(e.id)) { s.eventIds.push(e.id); indexEvent(world, e.id, s); }
    s.lastEventAt = e.tick;
  }
}

function applyResolvers(world: World, e: WorldEvent): void {
  const specs = RESOLVERS[e.type];
  if (!specs) return;
  for (const spec of specs) {
    for (const s of world.situations) {
      if (s.status !== 'active' || !spec.kinds.includes(s.kind)) continue;
      let ok = false;
      switch (spec.match) {
        case 'actor_is_responsible': ok = !!s.actorId && (e.target === s.actorId || e.actor === s.actorId); break;
        case 'subject_is_subject': ok = !!s.subjectId && e.actor === s.subjectId; break;
        case 'target_is_subject': ok = !!s.subjectId && e.target === s.subjectId; break;
        case 'item_matches': ok = !!s.itemId && e.item === s.itemId; break;
        case 'pair_matches': ok = !!s.actorId && !!s.subjectId && e.actor === s.actorId && e.target === s.subjectId; break;
        case 'pair_or_behalf': ok = !!s.actorId && !!s.subjectId && e.target === s.subjectId
          && (e.actor === s.actorId || e.data?.onBehalfOf === s.actorId); break;
      }
      if (!ok) continue;
      resolveSituation(world, s, spec.resolution, e.id);
    }
  }
}

export function resolveSituation(world: World, s: Situation, resolution: string, resolvingEventId?: EventId): void {
  if (s.status === 'resolved') return;
  s.status = 'resolved';
  s.resolvedAt = world.now;
  s.resolution = resolution;
  s.resolvingEventId = resolvingEventId;
  if (resolvingEventId && !s.eventIds.includes(resolvingEventId)) { s.eventIds.push(resolvingEventId); indexEvent(world, resolvingEventId, s); }
  s.lastEventAt = world.now;
  // Same invariant as `situation_opened` above: never outlive the resolving event we point at.
  const resolver = resolvingEventId ? world.event(resolvingEventId) : undefined;
  world.emit('situation_resolved', {
    actor: s.actorId, target: s.subjectId, placeId: s.placeId, causes: resolver ? [resolver.id] : [],
    significance: Math.min(0.5, s.severity, resolver ? resolver.significance : 0.5),
    data: { situationId: s.id, kind: s.kind, resolution },
    summary: `a matter was settled (${resolution}): ${describeSituation(world, s)}`,
  });
}

/**
 * Periodic upkeep (called from the same coarse strategic cadence as conflict/custody upkeep).
 * Two jobs, both generic:
 *  - a HARM matter whose subject has physically recovered, with nothing fresh happening, is over;
 *  - anything that has simply gone quiet long enough stops being live news.
 */
export function maintainSituations(world: World): void {
  const now = world.now;
  for (const s of world.situations) {
    if (s.status !== 'active') continue;
    if (s.kind === 'harm' && s.subjectId) {
      const subject = world.person(s.subjectId);
      const body = subject ? world.primaryBody(subject.id) : undefined;
      if (subject && !subject.alive) { resolveSituation(world, s, 'died'); continue; }
      // Physically recovered AND nothing has happened for a while: the harm itself is over. The
      // grudge it caused is a separate, longer-lived thing (mind/relationships.ts) — this only
      // says the injury has healed, not that anyone has forgiven anyone.
      if (body && !body.dead && body.health >= body.maxHealth * 0.95 && now - s.lastEventAt > 6 * 3600) {
        resolveSituation(world, s, 'recovered');
        continue;
      }
    }
    if (now - s.lastEventAt > DORMANT_AFTER_SECONDS) {
      s.status = 'dormant';
      s.resolution = s.resolution ?? 'faded';
    }
  }
  pruneSituations(world);
}

function pruneSituations(world: World): void {
  if (world.situations.length <= MAX_SITUATIONS) return;
  const settled = world.situations
    .map((s, i) => ({ s, i }))
    .filter(x => x.s.status !== 'active')
    .sort((a, b) => a.s.lastEventAt - b.s.lastEventAt);
  const drop = new Set(settled.slice(0, world.situations.length - MAX_SITUATIONS).map(x => x.s.id));
  if (!drop.size) return;
  world.situations = world.situations.filter(s => !drop.has(s.id));
}

/**
 * How much this matter should still weigh on anyone, purely as a function of its own status and
 * age — the "recent occurrence / active unresolved / resolved consequence / old memory"
 * distinction v0.9 §G asks for, expressed as one number.
 */
export function situationRelevance(s: Situation, now: number): number {
  const age = Math.max(0, now - s.lastEventAt);
  const decay = Math.pow(0.5, age / RELEVANCE_HALFLIFE_SECONDS);
  // An ACTIVE matter keeps a floor under it however long it has dragged on — an unsettled
  // assault is still unsettled a week later. A RESOLVED one drops sharply: the thing is over.
  if (s.status === 'active') return Math.max(0.4, decay);
  if (s.status === 'resolved') return 0.28 * decay;
  return 0.14 * decay;
}

export type PersonalSituationStatus = 'unresolved' | 'resolved' | 'unknown';
export interface PersonalSituationView {
  /** What THIS person is entitled to believe about the matter, from their own knowledge alone. */
  status: PersonalSituationStatus;
  /** The resolving event they actually know about, if any — the grounding for 'resolved'. */
  viaKey?: string;
  resolution?: string;
  /** Relevance as this person should weigh it: canonical ageing, but never "resolved" ageing for
   * someone who has not heard that it was resolved. */
  relevance: number;
}

/**
 * THE epistemic gate on situations (Constitution §III/§5, v0.9 §F). A mind may not read
 * `Situation.status`. It may only know: I know of the root event, and I do/do not know of any
 * event that settled it. A villager who never heard about the arrest still believes — correctly,
 * from their own evidence — that nothing has been done.
 */
export function personalSituationView(world: World, p: Person, s: Situation): PersonalSituationView {
  const knowsRoot = s.eventIds.some(id => !!p.knowledge[`ev:${id}`]);
  if (!knowsRoot) return { status: 'unknown', relevance: 0 };
  if (s.resolvingEventId) {
    const key = `ev:${s.resolvingEventId}`;
    if (p.knowledge[key]) {
      return { status: 'resolved', viaKey: key, resolution: s.resolution, relevance: situationRelevance(s, world.now) };
    }
  }
  // Not resolved, or resolved without this person hearing about it: from where they stand, the
  // matter is still open, and ages like an open matter.
  const asOpen: Situation = { ...s, status: 'active' };
  return { status: 'unresolved', relevance: situationRelevance(asOpen, world.now) };
}

export function describeSituation(world: World, s: Situation): string {
  const who = (id?: EntityId) => (id ? world.nameOf(id) : 'someone');
  switch (s.kind) {
    case 'harm': return `${who(s.subjectId)} was hurt${s.actorId ? ` by ${who(s.actorId)}` : ''}`;
    case 'property': return `${who(s.subjectId)}'s ${s.itemId ? world.nameOf(s.itemId) : 'property'} was taken${s.actorId ? ` by ${who(s.actorId)}` : ''}`;
    case 'loss': return `${who(s.subjectId)}'s ${s.itemId ? world.nameOf(s.itemId) : 'property'} went missing`;
    case 'disruption': return `${who(s.subjectId)} has not been where they were expected`;
    case 'grief': return `${who(s.subjectId)} died`;
    case 'obligation': return `something unsettled between ${who(s.actorId)} and ${who(s.subjectId)}`;
  }
}
