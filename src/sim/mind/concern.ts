import type { Concern, ConcernKind, EntityId, GoalType, ItemType, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import { appraiseClaim, proposeConcerns, type Appraisal } from '../social/appraisal';
import { personalSituationView, situationById, situationForEvent } from '../social/situation';
import { tradeMakes } from '../world/supply';

/**
 * CONCERNS — the mechanism by which knowledge acquires behavioural force (v0.9 §B).
 *
 * The milestone's hard requirement: "the milestone is incomplete if the primary outcome remains
 * merely 'NPCs know more things.'" A `KnowledgeItem` is inert — it sits in a map waiting to be
 * repeated. A `Concern` is what a person is now carrying: it competes for their attention, it
 * changes which goals they adopt (`concernGoalBoost` below, read by `mind/agent.ts`'s think()),
 * it decides what is worth saying (`mind/conversation.ts`), and it fades when the matter that
 * caused it is settled — from THAT PERSON'S point of view, not the world's.
 *
 * There are seven kinds and one formation rule (`social/appraisal.ts`'s `proposeConcerns`). There
 * are no per-event-type reaction handlers here. The seventh, 'supply', is Causal Society's: the
 * material a person's living depends on is not to be had. It is the shortage counterpart of
 * 'work', which is about a PERSON the work depends on.
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** Bounded like memories and knowledge. A person carries a handful of live worries, not a log. */
export const MAX_CONCERNS = 10;
/** Below this a concern is no longer doing anything and is dropped. */
export const FADE_FLOOR = 0.08;
/** Below this a concern is real but not worth a world event of its own — see `formConcerns`. */
export const EVENT_WORTHY_INTENSITY = 0.25;
/** Concern intensity half-life in hours, per kind. Grief outlasts everything; a work worry
 * fades within a couple of days if nothing renews it. These are the "situations age" knobs at
 * the personal level, complementing `Situation`'s own ageing at the world level (v0.9 §G). */
export const CONCERN_HALFLIFE_HOURS: Record<ConcernKind, number> = {
  // Causal Society: a supply worry fades on roughly a work-worry's timescale. A shortage that is
  // still real keeps renewing it (every fresh stoppage reinforces), and one that has been made
  // good stops pressing on its own — which is the honest outcome for somebody who never found
  // out either way.
  welfare: 30, safety: 26, justice: 60, property: 72, work: 22, grief: 400, supply: 20,
};
/** How long after acting on a concern before acting on it again is reasonable. Without this a
 * worried spouse re-crosses the village every think() tick. */
export const CONCERN_ACTION_COOLDOWN_SECONDS = 3 * 3600;

export function concernsOf(p: Person): Concern[] {
  return (p.mind.concerns ??= []);
}
export function activeConcerns(p: Person): Concern[] {
  return concernsOf(p).filter(c => c.status === 'active');
}
/**
 * What makes two concerns THE SAME concern. Deliberately kind-specific, because "the same
 * worry" means different things for different kinds:
 *  - welfare/work/grief are about a PERSON — a second piece of bad news about the same person is
 *    the same worry, pressing harder, not a second worry;
 *  - safety/justice are about the person to be feared or answered for — three crimes by the same
 *    hand are one growing case against them, not three independent worries;
 *  - property is about the specific thing that is gone.
 * Getting this wrong is not cosmetic: it was producing several near-identical entries per
 * person, which crowded `MAX_CONCERNS` and made `concernGoalBoost` read the same intensity
 * repeatedly instead of a single accumulating one.
 */
export function concernIdentity(kind: ConcernKind, subjectId?: EntityId, aboutId?: EntityId, itemId?: EntityId, resource?: ItemType): string {
  switch (kind) {
    case 'welfare': case 'work': case 'grief': return `${kind}:${subjectId ?? '?'}`;
    case 'safety': case 'justice': return `${kind}:${aboutId ?? '?'}`;
    case 'property': return `${kind}:${itemId ?? subjectId ?? '?'}`;
    // Causal Society: keyed by the MATERIAL alone, not by the place. Finding no flour at the
    // bakery and then no flour at the mill is one deepening worry about flour, not two — and it
    // is the one that should carry the more recent, more useful place with it.
    case 'supply': return `supply:${resource ?? '?'}`;
  }
}
export function concernAbout(p: Person, kind: ConcernKind, subjectId?: EntityId, aboutId?: EntityId, itemId?: EntityId, resource?: ItemType): Concern | undefined {
  const id = concernIdentity(kind, subjectId, aboutId, itemId, resource);
  return concernsOf(p).find(c => concernIdentity(c.kind, c.subjectId, c.aboutId, c.itemId, c.resource) === id);
}
/**
 * The single formation path: a belief was acquired (or refined), it was appraised, and the
 * appraisal justifies carrying something about it. Called from `mind/agent.ts` at every place a
 * mind actually learns something — perception and being told — so a concern can never exist
 * without a belief with real provenance behind it.
 */
export function formConcerns(world: World, p: Person, k: KnowledgeItem, ap?: Appraisal): Concern[] {
  const appraisal = ap ?? appraiseClaim(world, p, k);
  const proposals = proposeConcerns(world, p, appraisal);
  if (!proposals.length) return [];
  const situation = situationForEvent(world, k.claim.eventId as string | undefined);
  const formed: Concern[] = [];
  const list = concernsOf(p);
  for (const prop of proposals) {
    if (prop.intensity < 0.12) continue;
    const existing = concernAbout(p, prop.kind, prop.subjectId, prop.aboutId, prop.itemId, prop.resource);
    if (existing) {
      // Fresh evidence for something I already carry: it presses harder, and it is live again.
      const before = existing.intensity;
      existing.intensity = clamp(Math.max(existing.intensity, prop.intensity) + 0.08);
      existing.lastReinforcedAt = world.now;
      existing.status = 'active';
      existing.addressedAt = undefined;
      if (!existing.basisKeys.includes(k.key)) existing.basisKeys.push(k.key);
      if (situation && !existing.situationId) existing.situationId = situation.id;
      // Causal Society: the place a supply worry points at is the freshest one I have evidence
      // for, so "there is no flour" travels with me from the bakery to the mill.
      if (prop.placeId) existing.placeId = prop.placeId;
      for (const r of prop.reasons) if (!existing.reasons.includes(r)) existing.reasons.push(r);
      if (existing.intensity - before > 0.05) formed.push(existing);
      continue;
    }
    const concern: Concern = {
      id: world.nextId('cn'),
      kind: prop.kind,
      subjectId: prop.subjectId,
      aboutId: prop.aboutId,
      itemId: prop.itemId,
      resource: prop.resource,
      placeId: prop.placeId,
      situationId: situation?.id,
      basisKeys: [k.key],
      intensity: clamp(prop.intensity),
      createdAt: world.now,
      lastReinforcedAt: world.now,
      status: 'active',
      reasons: prop.reasons.slice(0, 3),
    };
    list.push(concern);
    formed.push(concern);
    // Only a concern strong enough to actually DO something is worth an event. A faint one is
    // real (it still colours appraisal and conversation) but emitting one for every passing
    // twinge is exactly the event spam the codebase's own conventions warn against for
    // goal_committed/intention_formed — and it measurably shortened the telemetry observation
    // window for everything else.
    if (concern.intensity < EVENT_WORTHY_INTENSITY) continue;
    // Prefer the ORIGINAL canonical event over this mind's own ephemeral perception of it — the
    // same reasoning `Simulation.tell` already applies to gossip: a retained attack/theft outlives
    // compaction where a `perceived` record does not. And cap significance at the cause's own, so
    // this cognition event can never outlive the event it points at (see situation.ts's invariant).
    const causeEvent = world.event(k.claim.eventId as string | undefined) ?? world.event(k.source.viaEvent);
    world.emit('concern_formed', {
      actor: p.id, target: prop.subjectId ?? prop.aboutId, category: 'cognition',
      causes: causeEvent ? [causeEvent.id] : [],
      significance: Math.min(0.45, concern.intensity * 0.7, causeEvent ? causeEvent.significance : 0.45),
      data: { concernId: concern.id, kind: concern.kind, subjectId: concern.subjectId, aboutId: concern.aboutId, intensity: Math.round(concern.intensity * 100) / 100, situationId: concern.situationId },
      summary: `${p.name} is now ${describeConcern(world, concern)}`,
    });
  }
  trimConcerns(p);
  return formed;
}

function trimConcerns(p: Person): void {
  const list = concernsOf(p);
  if (list.length <= MAX_CONCERNS) return;
  list.sort((a, b) => scoreForRetention(b) - scoreForRetention(a));
  list.length = MAX_CONCERNS;
}
function scoreForRetention(c: Concern): number {
  return c.intensity * (c.status === 'active' ? 1 : 0.4);
}

/**
 * Periodic upkeep. Two generic jobs:
 *  - concerns fade on their own timescale (per-kind half-life above);
 *  - a concern is DISCHARGED when this person personally learns of something that settled the
 *    matter behind it. Note `personalSituationView`: hearing about the arrest is what ends the
 *    worry, not the arrest itself happening somewhere out of sight (Constitution §III).
 */
export function maintainConcerns(world: World, p: Person, hours: number): void {
  const list = concernsOf(p);
  if (!list.length) return;
  for (const c of list) {
    if (c.status !== 'active') continue;
    const sit = situationById(world, c.situationId);
    if (sit) {
      const view = personalSituationView(world, p, sit);
      if (view.status === 'resolved') { resolveConcern(world, p, c, view.resolution ?? 'settled'); continue; }
    }
    // A property concern about an item I am holding again is over regardless of anything else.
    if (c.kind === 'property' && c.itemId) {
      const item = world.item(c.itemId);
      if (item && (item.holderId === p.id || (item.ownerId === p.id && !item.holderId && item.placeId && item.placeId === p.homeId))) {
        resolveConcern(world, p, c, 'recovered'); continue;
      }
    }
    // Causal Society: a supply worry ends when the shortage it rests on has actually been made
    // good in this person's own experience — `world/shortfall.ts`'s `clearShortfall` marks the
    // belief `handled` when they themselves next get a batch out of the material they believed
    // was gone. Somebody who only ever HEARD about the shortage holds a belief nothing will ever
    // mark handled, and their worry fades on its half-life instead: they stopped worrying, they
    // did not find out. That distinction is the point.
    if (c.kind === 'supply') {
      const basis = c.basisKeys.map(key => p.knowledge[key]).filter(Boolean);
      if (basis.length && basis.every(b => b.handled === true)) { resolveConcern(world, p, c, 'supplied'); continue; }
    }
    // A welfare concern about someone I can see up and about, who is not hurt, is discharged.
    if ((c.kind === 'welfare' || c.kind === 'work') && c.subjectId) {
      const subject = world.person(c.subjectId);
      const body = subject ? world.primaryBody(subject.id) : undefined;
      const seenNow = p.mind.percepts.some(pc => pc.entityId === c.subjectId);
      if (subject && subject.alive && body && seenNow && body.health >= body.maxHealth * 0.9 && body.pose !== 'downed') {
        resolveConcern(world, p, c, 'seen_well'); continue;
      }
      if (subject && !subject.alive && c.kind === 'work') { resolveConcern(world, p, c, 'died'); continue; }
    }
    c.intensity *= Math.pow(0.5, hours / CONCERN_HALFLIFE_HOURS[c.kind]);
    // Fading is the ABSENCE of a transition, not one: a worry that quietly stopped pressing has
    // no moment worth recording, and emitting one per fade produced a steady drip of cognition
    // events with nothing in them. A real DISCHARGE — I heard it was settled, I saw them well —
    // still emits, in `resolveConcern`.
    if (c.intensity < FADE_FLOOR) c.status = 'faded';
  }
  const kept = list.filter(c => c.status === 'active' || c.intensity >= FADE_FLOOR);
  if (kept.length !== list.length) { list.length = 0; list.push(...kept); }
}

export function resolveConcern(world: World, p: Person, c: Concern, resolution: string): void {
  if (c.status !== 'active') return;
  const wasNotable = c.intensity >= EVENT_WORTHY_INTENSITY;
  c.status = 'addressed';
  c.addressedAt = world.now;
  c.intensity *= 0.25;
  // Symmetric with formation: only a concern that was worth an event when it formed is worth one
  // when it is discharged.
  if (!wasNotable) return;
  world.emit('concern_resolved', {
    actor: p.id, target: c.subjectId ?? c.aboutId, category: 'cognition',
    significance: Math.min(0.3, c.intensity),
    data: { concernId: c.id, kind: c.kind, resolution },
    summary: `${p.name} no longer needs to worry (${resolution}): ${describeConcern(world, c)}`,
  });
}

/** Mark that this person has just done something about a concern — used to space out repeated
 * action on the same worry without pretending the worry itself is gone. */
export function noteConcernActedOn(world: World, c: Concern): void {
  c.lastActedAt = world.now;
}
export function concernActionable(world: World, c: Concern): boolean {
  return c.status === 'active' && (c.lastActedAt === undefined || world.now - c.lastActedAt > CONCERN_ACTION_COOLDOWN_SECONDS);
}

/**
 * THE behavioural bridge (v0.9 §B): what a live concern does to a candidate goal's utility.
 * One generic table from concern kind to the goal types that concern actually answers — not a
 * bespoke handler per event. `mind/agent.ts`'s think() adds this to the goals it was already
 * building, so a concerned person's ordinary behaviour genuinely bends rather than being
 * replaced by a special mode.
 *
 * `targetId` is the goal's own target where it has one, so a welfare concern about Bram boosts
 * "go and see Bram" and not "go and see anyone".
 */
const CONCERN_GOALS: Record<ConcernKind, { subject: GoalType[]; about: GoalType[]; any: GoalType[] }> = {
  // I care what has become of you: go and see, or help you if you are in front of me.
  welfare: { subject: ['check_on', 'help'], about: [], any: [] },
  // Someone dangerous is about: keeping away from them, and getting home, is the answer.
  safety: { subject: [], about: ['flee'], any: ['go_home', 'return_home_safe'] },
  // This should be answered for: tell the watch, or (if the watch is me) look into it.
  //
  // Deliberately ONLY 'report'. A justice concern moves someone to TELL the watch; it must not
  // add weight to any goal that physically sends a person toward the suspect.
  //
  // Measured directly (seed 918271, 5 days, bisected one concern kind at a time): boosting
  // 'investigate'/'confront' here drove attacks from 34 to 1442, with 1255 blows between a single
  // pair, against a baseline range of 33-86 across five seeds. The mechanism is a feedback loop,
  // not a tuning problem — an approach goal brings the guard back into contact, the renewed fight
  // emits fresh crime events, those become fresh justice-concern evidence, which boosts the
  // approach goal again. think()'s own threat assessment already scores confrontation and
  // investigation with the right role and severity terms AND with v0.2.3's re-engagement gating
  // that stops a settled encounter from restarting; a flat bonus applied from outside walks
  // straight past that gating. Reporting has no such loop: it terminates when the watch is told.
  justice: { subject: [], about: [], any: ['report'] },
  // My things are gone: go and get them.
  property: { subject: [], about: [], any: ['recover_item', 'help_recover_item'] },
  // The work is short-handed: turn up to it.
  work: { subject: [], about: [], any: ['work', 'haul'] },
  grief: { subject: [], about: [], any: ['mourn'] },
  // The material is not to be had: carry some, make some, or go and buy some. Every one of these
  // is an ordinary goal the simulation already proposes for ordinary reasons; the concern only
  // makes the ones that answer THIS shortage compete harder. Note what is absent — nothing here
  // walks anybody toward another person, which is the v0.9 justice-concern discipline applied to
  // a new kind rather than re-litigated.
  supply: { subject: [], about: [], any: ['haul', 'work', 'shop', 'harvest', 'plant', 'chop', 'gather'] },
};

export interface ConcernBoost { bonus: number; reasons: string[]; }

/**
 * Causal Society: `resource` is the material the candidate goal would actually move, when it
 * would move one (a haul carries a named resource). It exists so a flour shortage makes the
 * FLOUR haul more attractive and not every haul on the board — the same targeting discipline
 * `targetId` already gives a welfare concern, applied to a goal whose object is a material
 * rather than a person.
 */
export function concernGoalBoost(p: Person, goalType: GoalType, targetId?: EntityId, resource?: ItemType): ConcernBoost {
  let bonus = 0;
  const reasons: string[] = [];
  // Iterating the raw list rather than `activeConcerns` deliberately: this runs once per
  // CANDIDATE GOAL per think() tick (roughly 25 candidates x every deliberating person), and
  // `activeConcerns` allocates a filtered array on each call. Same semantics, no garbage.
  const list = p.mind.concerns;
  if (!list || !list.length) return { bonus: 0, reasons };
  for (const c of list) {
    if (c.status !== 'active') continue;
    const spec = CONCERN_GOALS[c.kind];
    let matches = false;
    if (targetId && c.subjectId === targetId && spec.subject.includes(goalType)) matches = true;
    else if (targetId && c.aboutId === targetId && spec.about.includes(goalType)) matches = true;
    else if (spec.any.includes(goalType)) matches = true;
    if (!matches) continue;
    if (c.kind === 'supply') {
      // A haul only answers this worry if it is carrying the very thing that has run out.
      if (goalType === 'haul' && resource !== c.resource) continue;
      if (['harvest', 'plant', 'chop', 'gather'].includes(goalType) && resource !== c.resource) continue;
      // Turning up to work only answers it if the work actually puts that material out. A baker
      // standing at an empty bakery does not make flour appear by being there.
      //
      // Two ways a `work` goal can qualify, and the order matters. FIRST: the goal itself
      // declares the material it would produce — that is Adaptive Society's stand-in candidate
      // (mind/succession.ts), which names a real place with a real canonical process behind it,
      // so the claim "this work makes flour" is grounded in `world/labor.ts` rather than in what
      // anybody is called. SECOND, and only when the goal declares nothing: the pre-v0.5
      // fallback, the public trades table's description of what this person's trade puts out.
      // Keeping the label path second rather than removing it is deliberate — an ordinary
      // scheduled shift declares no resource, and a miller turning up to the mill because flour
      // is short is a true and useful boost — but it is now the WEAKER of the two readings, and
      // it can no longer be the only way somebody's work counts as answering a shortage. That
      // was the §IX inversion: before this, a person capable of milling, standing at a mill
      // nobody was working, got no help from their own worry because their occupation said
      // otherwise.
      if (goalType === 'work') {
        if (resource) { if (resource !== c.resource) continue; }
        else if (!(c.resource && tradeMakes(p.occupation, c.resource))) continue;
      }
    }
    // Deliberately bounded: a concern bends a decision, it never dictates one. Even a maximal
    // concern adds less than the gap between idling and answering a physiological emergency.
    const contribution = Math.min(0.3, c.intensity * 0.42);
    if (contribution <= bonus) continue;
    bonus = contribution;
    reasons.length = 0;
    reasons.push(`concern: ${describeConcern(undefined, c)} (${c.intensity.toFixed(2)})`);
    reasons.push(...c.reasons.slice(0, 2));
  }
  return { bonus, reasons: reasons.filter(Boolean) };
}

export function describeConcern(world: World | undefined, c: Concern): string {
  const name = (id?: EntityId) => (id ? (world ? world.nameOf(id) : 'them') : 'someone');
  switch (c.kind) {
    case 'welfare': return `worried about ${name(c.subjectId)}`;
    case 'safety': return `wary of ${name(c.aboutId)}`;
    case 'justice': return `set on seeing ${c.aboutId ? `${name(c.aboutId)} answer for it` : 'this answered for'}`;
    case 'property': return `after ${c.itemId ? name(c.itemId) : 'what was taken'}`;
    case 'work': return `short-handed without ${name(c.subjectId)}`;
    case 'grief': return `grieving ${name(c.subjectId)}`;
    case 'supply': return `short of ${c.resource ?? 'what is needed'}${c.placeId ? ` at ${name(c.placeId)}` : ''}`;
  }
}
