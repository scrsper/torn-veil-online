import { isExternallyControlled } from '../../sim/runtime/controllers';
import { World } from '../../sim/core/world';
import { Simulation } from '../../sim/mind/agent';
import { generateVillage } from '../../sim/world/village';
import type { EntityId, Person, Vec3, WorldEvent } from '../../sim/core/types';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import { appraiseClaim } from '../../sim/social/appraisal';
import { activeConcerns, describeConcern } from '../../sim/mind/concern';
import { personalSituationView, situationsInvolving, describeSituation } from '../../sim/social/situation';
import { selectTopic, scoreTopic, MENTION_THRESHOLD } from '../../sim/mind/conversation';
import { realizeTopic } from '../../sim/mind/realize';
import { describeRel, getRel } from '../../sim/mind/relationships';
import { woundSeverity } from '../../sim/core/attributes';
import { makeItem } from '../../sim/world/factory';

/**
 * SOCIAL CAUSALITY TRACE HARNESS (v0.9 "required in-game proof").
 *
 * Boots the REAL generated village — the same `generateVillage` the browser client and every
 * WorldLab scenario use — seeds one triggering event through a canonical `Simulation` method
 * (the same method an NPC or the player would go through), then simply watches. Nothing about
 * the outcome is scripted: who perceives it, who cares, what they decide to do and what they
 * say are all produced by the ordinary simulation.
 *
 * Participants are chosen STRUCTURALLY (by relationship shape and occupation), never by name,
 * precisely so the harness demonstrates that the mechanisms are generic rather than tuned for
 * one authored pair of characters.
 */

export type TriggerKind = 'assault' | 'theft' | 'work_disruption' | 'family_harm';

export interface TraceStep {
  tick: number; day: number; hour: number; type: string;
  actor?: string; target?: string; summary: string;
}

export interface PerspectiveReport {
  id: EntityId; name: string; occupation: string;
  /** How this person stands, structurally, to the two parties. */
  standing: string[];
  /** What they actually believe about the triggering event, with provenance. */
  belief: { key: string; source: string; from?: string; hops: number; confidence: number; claim: string } | null;
  /** What it meant to them (v0.9 §A). */
  appraisal: { weight: number; roles: string[]; reasons: string[] } | null;
  /** What they are now carrying (v0.9 §B). */
  concerns: { kind: string; about: string; intensity: number; reasons: string[] }[];
  /** How the relationship to the actor actually moved (v0.9 §C). */
  towardActor: string | null;
  /** Goals adopted since the trigger, in order (v0.9 §B/§D — behaviour, not just belief). */
  goals: string[];
  /** What they believe about whether the matter is settled — from their own knowledge only. */
  situationView: string;
  /** A representative grounded line, produced by the real conversation + realization path. */
  line: string | null;
}

export interface TraceCheck { name: string; pass: boolean; detail: string; }

export interface SocialTrace {
  id: string; title: string; seed: number;
  actorName: string; subjectName: string;
  trigger: string;
  steps: TraceStep[];
  perspectives: PerspectiveReport[];
  checks: TraceCheck[];
  secondary: string[];
}

export interface TraceSpec {
  id: string;
  title: string;
  seed: number;
  trigger: TriggerKind;
  /** World hours to let the village settle before the trigger. */
  warmupHours?: number;
  /** World hours to observe afterwards. */
  observeHours?: number;
}

const clampHour = (t: number) => (t / SECONDS_PER_HOUR) % 24;

function advance(world: World, sim: Simulation, worldSeconds: number, step = 0.15): void {
  const target = world.now + worldSeconds;
  while (world.now < target) {
    const worldDt = world.clock.advance(step);
    world.physicalTime += step;
    sim.step(step, worldDt);
    sim.flushSpeech();
  }
}

/** Ordinary villagers: not the watch, not outlaws, not children — the people the milestone's
 * "an assault between two ordinary villagers" means. Chosen by structure, never by name. */
function ordinaryVillagers(world: World): Person[] {
  return world.persons().filter(p => p.alive && !isExternallyControlled(p) && !p.hostile
    && !['guard', 'captain', 'child', 'bandit', 'traveler'].includes(p.occupation));
}

/** A victim with the richest surrounding social structure — someone with a spouse AND a
 * workmate — so one event can demonstrate family, work and institutional consequences at once. */
function pickSubject(world: World, requireSpouse: boolean, requireCoworker: boolean): Person | undefined {
  const candidates = ordinaryVillagers(world).filter(p => {
    // The trigger must be able to cause a NEW serious wound. Warmup can already leave the
    // most-connected spouse badly injured; selecting them makes the <0.6 loop do nothing.
    // Select an eligible participant instead of healing someone or weakening protection.
    const body = world.primaryBody(p.id);
    if (!body?.present || body.dead || woundSeverity(body) >= 0.6 || p.surrender || p.custody?.active
      || body.subduedUntil > world.physicalTime) return false;
    const spouse = Object.entries(p.relationships).some(([id, r]) => r.tags.includes('spouse') && world.person(id)?.alive);
    const coworker = !!p.workId && world.persons().some(q => q.alive && q.id !== p.id && q.workId === p.workId);
    return (!requireSpouse || spouse) && (!requireCoworker || coworker);
  });
  // Deterministic: most connected first, ties broken by id.
  return candidates.sort((a, b) => (Object.keys(b.relationships).length - Object.keys(a.relationships).length) || a.id.localeCompare(b.id))[0];
}

/** The most plausible ordinary aggressor: the highest-aggression villager who is not the
 * subject and not of the watch. Again structural. */
function pickAggressor(world: World, notId: EntityId): Person | undefined {
  return ordinaryVillagers(world).filter(p => p.id !== notId)
    .sort((a, b) => (b.traits.aggression - a.traits.aggression) || a.id.localeCompare(b.id))[0];
}

/** How long the theft trigger will wait for somebody to be in a position to see it. Half a
 * working day: long enough that ordinary schedules bring someone past a workplace, short enough
 * that the trace still observes the aftermath it was asked to observe. */
const ONLOOKER_WAIT_SECONDS = 6 * SECONDS_PER_HOUR;
const ONLOOKER_STEP_SECONDS = 15 * 60;
/** Somebody who is neither party, close enough to `spot` and with a clear line to it. Uses the
 * same `grid.lineOfSight` the simulation's own perception does, so "could see it" here means
 * what it means everywhere else. */
function onlookerAt(world: World, spot: Vec3, exclude: EntityId[]): Person | undefined {
  const eye = { x: spot.x, y: spot.y + 1, z: spot.z };
  for (const p of world.persons()) {
    if (!p.alive || isExternallyControlled(p) || exclude.includes(p.id)) continue;
    const b = world.primaryBody(p.id);
    if (!b || !b.present || b.pose === 'sleep') continue;
    if (Math.hypot(b.pos.x - spot.x, b.pos.z - spot.z) > 14) continue;
    if (world.grid.lineOfSight(eye, { x: b.pos.x, y: b.pos.y + 1.2, z: b.pos.z }, 32)) return p;
  }
  return undefined;
}
function waitForOnlooker(world: World, sim: Simulation, spot: Vec3, exclude: EntityId[]): void {
  const until = world.now + ONLOOKER_WAIT_SECONDS;
  while (world.now < until && !onlookerAt(world, spot, exclude)) {
    advance(world, sim, ONLOOKER_STEP_SECONDS);
  }
}

function placeBeside(world: World, mover: Person, anchor: Person): void {
  const ab = world.primaryBody(anchor.id); const mb = world.primaryBody(mover.id);
  if (!ab || !mb) return;
  mb.path = null; mb.pathGoal = null; mb.sitAnchor = null;
  mb.pos = { x: ab.pos.x + 1, y: ab.pos.y, z: ab.pos.z };
  mb.yaw = Math.atan2(-(ab.pos.x - mb.pos.x), -(ab.pos.z - mb.pos.z));
}

const INTERESTING_TYPES = new Set([
  'attack', 'kill', 'theft', 'item_missing', 'death', 'heal', 'situation_opened', 'situation_resolved',
  'concern_formed', 'concern_resolved', 'absence_noticed', 'told', 'perceived', 'goal_changed',
  'investigation', 'confrontation', 'arrest_attempt', 'entity_arrested', 'custody_started',
  'relationship_changed', 'work_shift', 'resource_shortage', 'returned_item', 'recovered',
]);

export function runSocialTrace(spec: TraceSpec): SocialTrace {
  const world = new World(spec.seed);
  generateVillage(world);
  const sim = new Simulation(world);

  advance(world, sim, (spec.warmupHours ?? 8) * SECONDS_PER_HOUR);

  const needsSpouse = spec.trigger === 'family_harm' || spec.trigger === 'assault';
  const needsCoworker = spec.trigger === 'work_disruption' || spec.trigger === 'assault';
  const subject = (spec.trigger === 'theft'
    ? ordinaryVillagers(world).filter(p => !!p.workId).sort((a, b) => a.id.localeCompare(b.id))[0]
    : pickSubject(world, needsSpouse, needsCoworker)) ?? pickSubject(world, false, false)!;
  const actor = pickAggressor(world, subject.id)!;

  const traceStart = world.now;
  const steps: TraceStep[] = [];
  const goalsBy = new Map<EntityId, string[]>();
  // Captured live rather than scanned afterwards: `world.compactEvents` legitimately drops
  // low-significance events on a long run (this village has a century of pre-history before the
  // trigger even fires), so a post-hoc scan of `world.events` silently loses exactly the
  // ordinary-life consequences this harness exists to show.
  const observed: WorldEvent[] = [];
  world.onEvent((e: WorldEvent) => {
    if (e.tick < traceStart) return;
    if (e.type === 'goal_changed' && e.actor) {
      const list = goalsBy.get(e.actor) ?? [];
      const label = `${e.data?.to ?? '?'}${e.data?.target ? ` -> ${world.nameOf(e.data.target)}` : ''}`;
      if (list[list.length - 1] !== label) list.push(label);
      goalsBy.set(e.actor, list);
    }
    if (INTERESTING_TYPES.has(e.type) || e.type === 'work_shift') observed.push(e);
    if (!INTERESTING_TYPES.has(e.type)) return;
    // Keep the trace readable: only events that actually touch the two parties, plus the
    // world-level bookkeeping that records the matter itself.
    const touches = e.actor === actor.id || e.actor === subject.id || e.target === actor.id || e.target === subject.id
      || e.type === 'situation_opened' || e.type === 'situation_resolved' || e.type === 'absence_noticed'
      || e.type === 'concern_formed' || e.type === 'concern_resolved';
    if (!touches) return;
    steps.push({
      tick: e.tick, day: Math.floor(e.tick / 86400), hour: Math.round(clampHour(e.tick) * 10) / 10,
      type: e.type, actor: e.actor ? world.nameOf(e.actor) : undefined, target: e.target ? world.nameOf(e.target) : undefined,
      summary: e.summary,
    });
  });

  // ---- the trigger, always through a canonical Simulation method
  let triggerText = '';
  let triggerEvent: WorldEvent | null = null;
  const subjectBody = world.primaryBody(subject.id)!;
  const actorBody = world.primaryBody(actor.id)!;
  if (spec.trigger === 'theft') {
    // Something of the subject's, kept where they work, taken by the actor: the canonical theft
    // path. Placing it at the owner's workplace is a PRECONDITION, not a scripted outcome — it is
    // what makes the loss discoverable at all if nobody happens to witness the taking, since the
    // "my property is gone from its place" inference (Simulation.strategic) only fires for an
    // owner standing where they keep their things. Without it the scenario silently reduced to a
    // coin flip on whether anyone was looking, and demonstrated nothing when they were not.
    const workPlace = world.place(subject.workId) ?? world.placeAt(subjectBody.pos);
    const spot = workPlace?.anchors.find(a => a.kind === 'work' || a.kind === 'counter')?.pos ?? workPlace?.inside ?? subjectBody.pos;
    const owned = world.items().find(i => i.ownerId === subject.id && !i.holderId && i.pos)
      ?? makeItem(world, 'ring', `${subject.name}'s ring`, { owner: subject.id, pos: { ...spot }, placeId: workPlace?.id });
    owned.pos = { ...spot }; owned.placeId = workPlace?.id ?? null;
    // ...and the SECOND coin flip, one step further along, which the note above does not cover:
    // whether anybody could see the taking. That is what decides whether this trace has more than
    // one standpoint to report at all, and it is decided by where everyone happens to be standing.
    // Measured at seed 918271: the theft was witnessed by a passing child and reached 25 people;
    // an unrelated perturbation elsewhere in the simulation moved that child, the theft went
    // unwitnessed, and the trace was left with a single speaker and nothing to compare — the
    // "different people describe it differently" check failing not because anything was broken
    // but because nobody had been looking.
    //
    // So this waits, bounded, for somebody who is neither party to be within sight of the spot.
    // It is a PRECONDITION in exactly the sense the item placement above is: it establishes that
    // the information CAN exist, and scripts nothing whatever about who ends up believing what,
    // how confidently, or what any of them do about it. If nobody turns up inside the window the
    // theft happens anyway, unwitnessed, and the owner's own "my property is gone" inference is
    // still the honest path it always was.
    waitForOnlooker(world, sim, spot, [actor.id, subject.id]);
    placeBeside(world, actor, subject);
    triggerEvent = sim.takeItem(actor, owned, 'theft', subject.id);
    triggerText = `${actor.name} stole ${owned.name} from ${subject.name} at ${workPlace?.name ?? 'their place'}`;
  } else {
    // A serious beating, delivered through the SAME `Simulation.attack` an NPC or the player
    // uses — repeated blows until the wound is genuinely serious, then the aggressor is put back
    // where they came from so the trace observes consequences rather than an ongoing brawl.
    placeBeside(world, actor, subject);
    const before = { ...actorBody.pos };
    let guard = 0;
    while (woundSeverity(subjectBody) < 0.6 && !subjectBody.dead && guard++ < 20) {
      const ev = sim.applyHit(actor, actorBody, subjectBody, 12, 'injure');
      if (ev && !triggerEvent) triggerEvent = ev;
    }
    if (!triggerEvent) throw new Error(`Social trace ${spec.id}: no canonical assault was applied to the selected subject`);
    actorBody.pos = before;
    triggerText = `${actor.name} beat ${subject.name} (wound ${woundSeverity(subjectBody).toFixed(2)})`;
  }

  advance(world, sim, (spec.observeHours ?? 30) * SECONDS_PER_HOUR);

  // ---- perspectives: chosen structurally, so the report shows materially different standings
  // The MATTER, not merely the one event that started it. Two reasons this has to be plural:
  //  - a beating is several canonical `attack` events, and a given witness may hold a belief
  //    about any one of them;
  //  - an unwitnessed theft reaches people as the OWNER'S later "my property is gone" inference
  //    (`missing:<itemId>`, its own `loss` situation) rather than as the theft itself — which is
  //    the honest outcome, and reporting only the theft key would show the whole village as
  //    knowing "nothing about it" when in fact the loss is exactly what is circulating.
  const opened = situationsInvolving(world, subject.id).filter(s => s.openedAt >= traceStart);
  const rootKeys = [
    ...new Set([
      ...opened.flatMap(s => s.eventIds.map(id => `ev:${id}`)),
      ...opened.filter(s => s.itemId).map(s => `missing:${s.itemId}`),
      ...(triggerEvent ? [`ev:${triggerEvent.id}`] : []),
    ]),
  ];
  const perspectiveIds = pickPerspectives(world, subject, actor, rootKeys);
  const perspectives = perspectiveIds.map(p => reportPerspective(world, sim, p, subject, actor, rootKeys, goalsBy));

  const secondary = collectSecondary(world, subject, actor, observed);
  const checks = buildChecks(world, subject, actor, rootKeys, perspectives, secondary, spec.trigger);

  return {
    id: spec.id, title: spec.title, seed: spec.seed,
    actorName: actor.name, subjectName: subject.name,
    trigger: triggerText, steps, perspectives, checks, secondary,
  };
}

/** Six structurally distinct standpoints on the same event, if the village supplies them. */
function pickPerspectives(world: World, subject: Person, actor: Person, rootKeys: string[]): Person[] {
  const out: Person[] = [subject];
  const push = (p?: Person) => { if (p && p.alive && !out.some(x => x.id === p.id)) out.push(p); };
  // the subject's spouse
  push(world.persons().find(q => q.alive && q.id !== subject.id && getRel(q, subject.id).tags.includes('spouse')));
  // a workmate of the subject's
  push(world.persons().find(q => q.alive && q.id !== subject.id && !!subject.workId && q.workId === subject.workId
    && !getRel(q, subject.id).tags.includes('spouse')));
  // the watch
  push(world.persons().find(q => q.alive && (q.occupation === 'captain' || q.occupation === 'guard')));
  // someone tied to the ACTOR rather than the subject
  push(world.persons().find(q => q.alive && q.id !== actor.id && q.id !== subject.id
    && (getRel(q, actor.id).familiarity > 0.2 || getRel(q, actor.id).affection > 0.2)));
  // an unrelated stranger: least familiar with either party
  push(world.persons().filter(q => q.alive && !q.hostile && !out.some(x => x.id === q.id))
    .sort((a, b) => (getRel(a, subject.id).familiarity + getRel(a, actor.id).familiarity)
      - (getRel(b, subject.id).familiarity + getRel(b, actor.id).familiarity))[0]);
  // ...and, finally, up to two people who ACTUALLY ended up holding a belief about the matter
  // and are not already represented. The six structural standpoints above are chosen before the
  // simulation runs; whether any given one of them happens to hear about an unwitnessed theft is
  // down to who walked past whom, which is exactly the kind of thing a report about how news
  // travels should be showing rather than being at the mercy of. Deterministic (id order).
  for (const q of world.persons().filter(q => q.alive && rootKeys.some(k => !!q.knowledge[k])).sort((a, b) => a.id.localeCompare(b.id))) {
    if (out.length >= 8) break;
    push(q);
  }
  return out;
}

function reportPerspective(world: World, sim: Simulation, p: Person, subject: Person, actor: Person, rootKeys: string[], goalsBy: Map<EntityId, string[]>): PerspectiveReport {
  const k = rootKeys.map(key => p.knowledge[key]).find(Boolean);
  const relS = getRel(p, subject.id); const relA = getRel(p, actor.id);
  const standing: string[] = [];
  if (p.id === subject.id) standing.push('the person it happened to');
  if (p.id === actor.id) standing.push('the one who did it');
  if (relS.tags.length) standing.push(`${relS.tags.join('/')} of ${subject.name}`);
  if (relA.tags.length && p.id !== actor.id) standing.push(`${relA.tags.join('/')} of ${actor.name}`);
  if (p.workId && p.workId === subject.workId && p.id !== subject.id) standing.push(`works at ${world.nameOf(p.workId)} alongside ${subject.name}`);
  if (p.occupation === 'guard' || p.occupation === 'captain') standing.push('of the watch');
  if (!standing.length) standing.push(`unrelated ${p.occupation}`);

  const appraisal = k ? appraiseClaim(world, p, k) : null;
  const sits = situationsInvolving(world, subject.id).map(s => ({ s, v: personalSituationView(world, p, s) }))
    .filter(x => x.v.status !== 'unknown').sort((a, b) => b.v.relevance - a.v.relevance);
  const view = sits[0]
    ? `${sits[0].v.status}${sits[0].v.resolution ? ` (${sits[0].v.resolution})` : ''} — ${describeSituation(world, sits[0].s)}`
    : 'knows of no such matter';

  // A representative line: what this person would actually raise with a listener who has real
  // reason to hear it, through the real conversation + realization path.
  // Scored against THIS matter specifically, so the report shows how each person would describe
  // the event being traced rather than whatever else happens to rank highest in their head.
  let line: string | null = null;
  const listener = world.persons().find(q => q.alive && q.id !== p.id && (q.occupation === 'captain' || q.occupation === 'guard') && q.id !== p.id)
    ?? world.persons().find(q => q.alive && q.id !== p.id);
  if (listener && k) {
    const topic = scoreTopic(world, p, listener, k);
    topic.supporting = (selectTopic(world, p, listener, { ignoreListenerKnowledge: true, threshold: -1 })?.k.key === k.key
      ? selectTopic(world, p, listener, { ignoreListenerKnowledge: true, threshold: -1 })!.supporting : []);
    if (topic.score >= MENTION_THRESHOLD * 0.4) line = realizeTopic(world, p, topic);
  }
  void sim;

  return {
    id: p.id, name: p.name, occupation: p.occupation, standing,
    belief: k ? {
      key: k.key, source: k.source.type, from: k.source.from ? world.nameOf(k.source.from) : undefined,
      hops: k.hops, confidence: Math.round(k.confidence * 100) / 100,
      claim: `${k.claim.actorUnknown ? 'someone' : world.nameOf(k.claim.actor)} -> ${world.nameOf(k.claim.target)} (${k.claim.type})`,
    } : null,
    appraisal: appraisal ? { weight: Math.round(appraisal.weight * 100) / 100, roles: appraisal.roles, reasons: appraisal.reasons } : null,
    concerns: activeConcerns(p).map(c => ({
      kind: c.kind, about: describeConcern(world, c), intensity: Math.round(c.intensity * 100) / 100, reasons: c.reasons,
    })),
    towardActor: p.id === actor.id ? null : `${describeRel(relA)} (trust ${relA.trust.toFixed(2)}, fear ${relA.fear.toFixed(2)}, grudge ${relA.grudge.toFixed(2)})`,
    goals: (goalsBy.get(p.id) ?? []).slice(0, 8),
    situationView: view,
    line,
  };
}

/** Real, physical/economic knock-on effects — not dialogue about them. */
function collectSecondary(world: World, subject: Person, actor: Person, observed: WorldEvent[]): string[] {
  const out: string[] = [];
  const body = world.primaryBody(subject.id);
  if (body) out.push(`${subject.name} is at ${Math.round((body.health / body.maxHealth) * 100)}% health (wound ${woundSeverity(body).toFixed(2)})`);
  const lowest = observed.filter(e => e.type === 'attack' && e.target === subject.id).length;
  if (lowest) out.push(`${subject.name} took ${lowest} blow(s)`);
  for (const a of observed.filter(e => e.type === 'absence_noticed' && e.target === subject.id)) out.push(a.summary);
  const shifts = observed.filter(e => e.type === 'work_shift' && e.actor === subject.id).length;
  out.push(`${subject.name} completed ${shifts} work shift(s) since`);
  for (const c of observed.filter(e => e.type === 'goal_changed' && e.data?.to === 'check_on').slice(0, 6)) out.push(c.summary);
  for (const h of observed.filter(e => e.type === 'heal' && e.target === subject.id).slice(0, 3)) out.push(h.summary);
  for (const l of observed.filter(e => ['confrontation', 'arrest_attempt', 'entity_arrested', 'custody_started', 'investigation'].includes(e.type) && (e.target === actor.id || e.data?.suspect === actor.id)).slice(0, 4)) out.push(l.summary);
  return out;
}

function buildChecks(world: World, subject: Person, actor: Person, rootKeys: string[], perspectives: PerspectiveReport[], secondary: string[], trigger: TriggerKind): TraceCheck[] {
  const checks: TraceCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  const sits = situationsInvolving(world, subject.id);
  add('a situation was opened', sits.length > 0, sits.map(s => `${s.kind}/${s.status}${s.resolution ? `:${s.resolution}` : ''}`).join(', ') || 'none');

  const knowers = world.persons().filter(p => p.alive && rootKeys.some(key => !!p.knowledge[key]));
  add('more than one mind learned of it', knowers.length > 1, `${knowers.length} people: ${knowers.slice(0, 6).map(p => p.name).join(', ')}`);

  // Only people who actually hold a belief about it can have appraised it — someone who never
  // heard has no significance to report, and injecting a 0 for them would fake a spread.
  //
  // Measured over EVERYONE in the village who holds such a belief, not only the six structurally
  // chosen perspectives. The property under test is "the same event meant materially different
  // things to different people"; sampling it through a fixed cast of six, any number of whom may
  // simply never have been told, measures how news happened to travel on this seed rather than
  // the property itself. Verified across five seeds on both v0.9 and v0.10: which particular
  // neighbour hears about an unwitnessed theft swings freely with ordinary movement, while the
  // spread across actual knowers is stable.
  const weights = knowers.map(p => {
    const k = rootKeys.map(key => p.knowledge[key]).find(Boolean);
    return k ? appraiseClaim(world, p, k).weight : null;
  }).filter((x): x is number => typeof x === 'number');
  const spread = weights.length > 1 ? Math.max(...weights) - Math.min(...weights) : 0;
  add('the same event meant materially different things', spread > 0.15,
    weights.length > 1
      ? `personal significance ranged ${Math.min(...weights).toFixed(2)}..${Math.max(...weights).toFixed(2)} across ${weights.length} who know of it`
      : `only ${weights.length} person in the whole village knows of it at all`);

  const concerned = world.persons().filter(p => activeConcerns(p).length > 0);
  add('knowledge produced concerns', concerned.length > 0, `${concerned.length} people carrying ${concerned.reduce((n, p) => n + activeConcerns(p).length, 0)} concerns`);

  const concernDriven = world.persons().filter(p => (p.mind.goal?.reasons ?? []).some(r => r.startsWith('concern:'))
    || world.events.some(e => e.type === 'goal_changed' && e.actor === p.id && ['check_on', 'report', 'investigate', 'help'].includes(e.data?.to)));
  add('concerns changed what people did', concernDriven.length > 0, concernDriven.slice(0, 6).map(p => `${p.name}:${p.mind.goal?.type ?? '-'}`).join(', ') || 'none');

  const moved = world.persons().filter(p => p.id !== actor.id && (getRel(p, actor.id).trust < -0.05 || getRel(p, actor.id).grudge > 0.05 || getRel(p, actor.id).fear > 0.05));
  add('relationships toward the actor moved', moved.length > 0, `${moved.length} people`);

  // Same reasoning as the significance spread above: gathered from the people who actually hold a
  // belief about the matter (capped for cost), so the check measures whether the realization
  // layer produces different accounts, not whether the pre-chosen cast happened to be told.
  const spoke = perspectives.filter(p => !!p.line);
  const distinct = new Set(spoke.map(p => p.line));
  for (const p of knowers.slice(0, 8)) {
    if (distinct.size > 1) break;
    if (perspectives.some(x => x.id === p.id)) continue;
    const k = rootKeys.map(key => p.knowledge[key]).find(Boolean);
    const listener = world.persons().find(q => q.alive && q.id !== p.id && (q.occupation === 'captain' || q.occupation === 'guard'))
      ?? world.persons().find(q => q.alive && q.id !== p.id);
    if (!k || !listener) continue;
    const topic = scoreTopic(world, p, listener, k);
    if (topic.score >= MENTION_THRESHOLD * 0.4) distinct.add(realizeTopic(world, p, topic));
  }
  add('different people describe it differently', distinct.size > 1, `${distinct.size} distinct grounded lines from ${Math.max(spoke.length, distinct.size)} speakers`);

  const silent = perspectives.filter(p => !p.line);
  add('silence is a real outcome for the uninvolved', silent.length > 0 || perspectives.length < 3, `${silent.length} of ${perspectives.length} had nothing worth saying`);

  if (trigger === 'assault' || trigger === 'work_disruption' || trigger === 'family_harm') {
    add('a real secondary consequence occurred', secondary.some(s => /has not been|check_on|tended|confronted|arrest|0 work shift/.test(s)), secondary.slice(0, 4).join(' | '));
  } else {
    add('a real secondary consequence occurred', secondary.length > 0, secondary.slice(0, 3).join(' | '));
  }
  return checks;
}

export const TRACE_SPECS: TraceSpec[] = [
  { id: 'assault', title: 'Assault between two ordinary villagers (primary acceptance case)', seed: 918271, trigger: 'assault', warmupHours: 9, observeHours: 36 },
  { id: 'theft', title: 'Theft / missing property', seed: 918271, trigger: 'theft', warmupHours: 9, observeHours: 40 },
  { id: 'work-disruption', title: 'Work and economic disruption from an injured worker', seed: 42424242, trigger: 'work_disruption', warmupHours: 9, observeHours: 40 },
  { id: 'family', title: 'A family consequence of harm to a spouse', seed: 12345, trigger: 'family_harm', warmupHours: 9, observeHours: 36 },
];

export function formatTrace(t: SocialTrace): string {
  const L: string[] = [];
  L.push(`== ${t.title} ==`);
  L.push(`seed ${t.seed} — trigger: ${t.trigger}`);
  L.push('');
  L.push('-- causal trace --');
  for (const s of t.steps.slice(0, 60)) L.push(`  d${s.day} ${String(s.hour).padStart(4)}h  ${s.type.padEnd(20)} ${s.summary}`);
  if (t.steps.length > 60) L.push(`  ... ${t.steps.length - 60} more`);
  L.push('');
  L.push('-- perspectives --');
  for (const p of t.perspectives) {
    L.push(`  ${p.name} (${p.occupation}) — ${p.standing.join('; ')}`);
    L.push(`     believes: ${p.belief ? `${p.belief.claim} [${p.belief.source}${p.belief.from ? ` by ${p.belief.from}` : ''}, ${p.belief.hops} hop(s), conf ${p.belief.confidence}]` : 'nothing about it'}`);
    if (p.appraisal) L.push(`     it meant: ${p.appraisal.weight} (${p.appraisal.roles.join(', ')}) — ${p.appraisal.reasons.slice(0, 2).join('; ')}`);
    if (p.concerns.length) L.push(`     carrying: ${p.concerns.map(c => `${c.about} [${c.intensity}]`).join(' | ')}`);
    if (p.towardActor) L.push(`     toward ${t.actorName}: ${p.towardActor}`);
    if (p.goals.length) L.push(`     did: ${p.goals.join(' -> ')}`);
    L.push(`     status: ${p.situationView}`);
    L.push(`     says: ${p.line ?? '(nothing — not worth mentioning)'}`);
    L.push('');
  }
  L.push('-- secondary consequences --');
  for (const s of t.secondary) L.push(`  ${s}`);
  L.push('');
  L.push('-- checks --');
  for (const c of t.checks) L.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  return L.join('\n');
}
