import { isExternallyControlled } from '../runtime/controllers';
import type { EntityId, Household, Occupation, Person, Place, PlaceType, SkillId } from '../core/types';
import type { World } from '../core/world';
import { skillOf } from '../core/skills';
import { lifeStageFor } from '../core/species';
import { instructionOf } from './apprenticeship';
import { scheduleFor } from './schedule';
import { localPlaces, placeForPerson } from '../world/locality';
import { processFor, stintsOf, tradePostAt, unfitReason, type TradeProcess } from '../world/labor';

/**
 * GROWING INTO A TRADE (the consumer of `coming_of_age`).
 *
 * A village that grows by birth but never staffs itself from its own children is not generational.
 * Before this module, `coming_of_age` was emitted, weighted for historical significance, and read
 * by nothing: a person born during a run kept `occupation: 'child'` and `workId: null` for life,
 * and `mind/schedule.ts` therefore gave them a child's day — breakfast, play in the square, play
 * again — at forty years old.
 *
 * The tempting fix is to hand them an occupation string when they turn eighteen. That is exactly
 * the inversion Constitution invariant IX forbids and that Adaptive Society deleted from this
 * codebase when it removed the `p.occupation === 'miller'` gate on whether flour could be
 * ground. A label may summarise a capability; it may never confer one.
 *
 * So this module is a READING, in the same shape as `mind/vocation.ts`'s `recogniseClass`: it
 * asks whether what has actually happened to this person adds up to a trade. Four canonical
 * inputs, and no fifth:
 *
 *   taught       — a `technique` belief with a real teacher on it (mind/apprenticeship.ts),
 *                  acquired by standing at the work beside somebody doing it;
 *   practised    — proficiency that only ever rose through real successful batches (core/skills.ts);
 *   done         — `WorkStint`s: batches this person has genuinely got out of this place;
 *   opportunity  — a household that works this trade, AND room at the work — the post is going
 *                  unserved (world/labor.ts), or everyone still holding it is at the end of their
 *                  working life.
 *
 * Household proximity is a WEIGHT, never a basis. `basis` below is a hard gate: without real
 * instruction, real proficiency or real batches, being the miller's son buys nothing. That is the
 * difference between inheriting a trade and being handed a job title.
 *
 * What recognition then does is RECORD what is already true — `workId`, the place's own
 * `workers`, and an occupation summary — the same canonical fields world generation writes for
 * everybody else. `world/labor.ts` reads those and never reads `p.occupation`, so nothing about
 * whether a batch happens depends on the label this module chooses; the label exists so the
 * Chronicle, the inspector and `scheduleFor` have a word for the pattern.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * What this culture calls somebody who holds this work. A NAMING of a derived pattern, exactly
 * like `recogniseClass`'s three class names — never an input to anything. Deleting a row here
 * changes what the Chronicle calls a person and which default rhythm `scheduleFor` gives them; it
 * changes nothing about what they are able to do, who may work where, or what comes out of the
 * mill. Only place types with a real `TradeProcess` appear, because only those are work a person
 * can demonstrably have taken up.
 */
const TRADE_SUMMARY: Partial<Record<PlaceType, Occupation>> = {
  mill: 'miller',
  bakery: 'baker',
  sawpit: 'woodcutter',
  tavern: 'cook',
};

/** Enough of a pattern to be worth calling a trade. Below this, somebody is a grown person with
 * no trade of their own, which is an ordinary thing to be and must stay possible. */
export const LIVELIHOOD_THRESHOLD = 0.45;
/** Below this, being around the work is not yet worth a goal of its own — they have no reason to
 * be there and nothing to learn from being there. */
export const LEARNING_THRESHOLD = 0.2;

export interface LivelihoodProspect {
  place: Place;
  process: TradeProcess;
  skill: SkillId;
  /** 0..1 — how well the pattern holds. Never a promise; a recognition can be wrong. */
  score: number;
  /** True once they could be said to hold this work rather than merely be learning it. */
  recognised: boolean;
  reasons: string[];
  /** The canonical events behind it, for the causal trace. */
  causes: EntityId[];
  teacherId?: EntityId;
}

/** People whose lives this person's household is built around: household members, then parents. */
function householdWorkers(world: World, p: Person): Person[] {
  const out: Person[] = [];
  const seen = new Set<EntityId>([p.id]);
  const household = world.get<Household>(p.householdId);
  if (household?.kind === 'household') {
    for (const id of household.memberIds) {
      if (seen.has(id)) continue;
      const member = world.person(id);
      if (member?.alive) { seen.add(id); out.push(member); }
    }
  }
  for (const id of p.parentIds) {
    if (seen.has(id)) continue;
    const parent = world.person(id);
    if (parent?.alive) { seen.add(id); out.push(parent); }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Is there room at this work for another pair of hands?
 *
 * Two canonical answers, and neither is a vacancy flag (there is no such thing in this codebase —
 * see `world/labor.ts`). Either the work is going undone right now, or everyone still holding it
 * has reached the end of their working life and the trade needs somebody to carry it on. The
 * second is the generational one, and it is a fact about bodies and ages, not about intent.
 */
function roomAtTheWork(world: World, place: Place): { room: number; why: string } | null {
  const post = tradePostAt(world, place);
  if (!post) return null;
  if (post.underServed) return { room: 1, why: `nobody is working ${place.name}` };
  if (!post.ableStaff.length) return { room: 0.7, why: `nobody fit is at ${place.name} today` };
  const elderly = post.ableStaff.every(s => lifeStageFor(s.species, s.age) === 'elder');
  if (elderly) return { room: 0.8, why: `${post.ableStaff.map(s => s.name).join(' and ')} will not always be at ${place.name}` };
  return null;
}

/**
 * Every productive place this person has a real reason to be at, strongest first.
 *
 * Returns nothing at all for the overwhelming majority of the village — anybody who already holds
 * work of their own is skipped outright, and of those who do not, most have never been shown a
 * trade and never got a batch out of anywhere. That silence is the mechanism, the same way it is
 * in `mind/succession.ts`.
 */
export function livelihoodProspects(world: World, p: Person): LivelihoodProspect[] {
  if (p.hostile || !p.alive || p.workId) return [];
  // A grown frame, read from the body's own life stage rather than from a birthday: ordinary
  // trade work is not something an infant or a small child does.
  const stage = lifeStageFor(p.species, p.age);
  if (stage === 'infant' || stage === 'child') return [];
  if (unfitReason(world, p)) return [];

  const kin = householdWorkers(world, p);
  const stints = stintsOf(world, p.id);
  const out: LivelihoodProspect[] = [];

  for (const place of world.places()) {
    const process = processFor(place.type);
    if (!process) continue;
    const room = roomAtTheWork(world, place);

    const taught = instructionOf(p, process.skill);
    const proficiency = skillOf(p, process.skill);
    const batchesHere = stints.filter(s => s.placeId === place.id).reduce((n, s) => n + s.batches, 0);
    // ACQUIRED basis: what this person has actually been taught, practised, or got out of the
    // place. It is the hard gate on being RECOGNISED as holding the trade — being the miller's
    // son buys nothing on its own — but deliberately not on being there in the first place.
    const basis = (taught ? taught.confidence : 0) + proficiency + clamp01(batchesHere / 8);

    const kinHere = kin.filter(k => k.workId === place.id);
    const household = kinHere.length ? clamp01(0.6 + kinHere.length * 0.2) : 0;
    // Opportunity comes before instruction, chronologically and causally: a child is at the
    // family's work because that is where the family is, and being there is how they come to be
    // shown the trade at all (mind/apprenticeship.ts teaches whoever is AT the work). Requiring
    // acquired capability before somebody may go near the work would close the only door into it.
    if (basis <= 0 && household <= 0) continue;

    const reasons: string[] = [];
    const causes: EntityId[] = [];
    if (kinHere.length) reasons.push(`${kinHere.map(k => k.name).join(' and ')} work${kinHere.length === 1 ? 's' : ''} ${place.name}`);
    if (taught) {
      reasons.push(`${world.nameOf(taught.claim.teacherId as string)} showed me how ${process.skill} is done`);
      if (taught.claim.eventId) causes.push(taught.claim.eventId as string);
    }
    if (proficiency > 0.02) reasons.push(`I have ${process.verb === 'milling' ? 'ground grain' : 'done this work'} before (${process.skill} ${proficiency.toFixed(2)})`);
    if (batchesHere) reasons.push(`${batchesHere} batch${batchesHere === 1 ? '' : 'es'} have come out of it under my hands`);
    if (room) reasons.push(room.why);

    // The weights are this module's whole claim about what makes a trade, stated once here rather
    // than scattered. Note what is NOT in them: current condition. A reading of what somebody's
    // life amounts to must not depend on whether they have had breakfast — `unfitReason` above
    // already excludes anybody who could not do the work at all.
    const score = clamp01(
      clamp01(taught ? taught.confidence : 0) * 0.18
      + clamp01(proficiency / 0.35) * 0.22
      + clamp01(batchesHere / 6) * 0.18
      + household * 0.28
      + (room?.room ?? 0) * 0.14,
    );

    if (score < LEARNING_THRESHOLD) continue;
    out.push({
      place, process, skill: process.skill, score,
      // Holding a trade needs somewhere to hold it: without room at the work this is somebody
      // learning beside a tradesman who is still very much at their own stones.
      recognised: basis > 0 && score >= LIVELIHOOD_THRESHOLD && stage === 'adult' && !!room,
      reasons, causes, teacherId: taught?.claim.teacherId as EntityId | undefined,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));
}

/** The trade this person's life has actually made them a plausible holder of, or null — which is
 * the ordinary answer for nearly everybody, nearly always. */
export function recogniseLivelihood(world: World, p: Person): LivelihoodProspect | null {
  return livelihoodProspects(world, p).find(x => x.recognised) ?? null;
}

/**
 * Record a recognised trade. The ONLY writer in this module, and everything it writes is a fact
 * the reading above already established: this person works here.
 *
 * `workId` and the place's `workers` are the canonical record of where somebody works — the same
 * fields world generation writes, the same fields `world/labor.ts`'s `staffOf` reads, and the
 * reason a batch can happen at all. The occupation is written last and is a summary; nothing in
 * the labour path reads it.
 */
export function takeUpLivelihood(world: World, p: Person, prospect: LivelihoodProspect): void {
  if (p.workId === prospect.place.id) return;
  p.workId = prospect.place.id;
  if (!prospect.place.workers.includes(p.id)) prospect.place.workers.push(p.id);
  const summary = TRADE_SUMMARY[prospect.place.type];
  if (summary) p.occupation = summary;
  p.schedule = dailyScheduleFor(world, p, prospect.place.id);
  const body = world.primaryBody(p.id);
  world.emit('livelihood_taken_up', {
    actor: p.id, placeId: prospect.place.id, pos: body ? { ...body.pos } : { ...prospect.place.inside },
    causes: prospect.causes.filter(id => !!world.event(id)),
    category: 'history', significance: 0.6, visibility: 12,
    data: {
      placeId: prospect.place.id, skill: prospect.skill, proficiency: skillOf(p, prospect.skill),
      teacherId: prospect.teacherId, occupation: p.occupation, score: Math.round(prospect.score * 100) / 100,
      reasons: prospect.reasons,
    },
    summary: `${p.name} took up ${prospect.process.verb} at ${prospect.place.name}`,
  });
}

/**
 * A person's default rhythm of life, with the everyday places resolved from where they actually
 * live rather than from whichever tavern happens to be first in the world's place list. Shared by
 * birth and by taking up a trade so a newborn and a new tradesman are built the same way.
 */
export function dailyScheduleFor(world: World, p: Person, workId: EntityId | null) {
  const home = world.place(p.homeId ?? '') ?? null;
  const tavern = placeForPerson(world, p, 'tavern');
  const square = placeForPerson(world, p, 'square');
  const chapel = placeForPerson(world, p, 'chapel');
  if (!home || !tavern || !square || !chapel) return p.schedule;
  // Somebody with no post of their own still has working hours, and they spend them where the
  // village's work is actually done. This is a RHYTHM, not a post and not a permission: the
  // building is a landmark everybody in a village of thirty-three can see, `world/labor.ts`'s
  // `workAuthorization` is entirely unmoved by anybody's whereabouts, and a person standing in
  // the mill who is neither its worker nor filling in for an absent one gets no flour out of it.
  // What being there does buy is the one thing a trade cannot be learned without: being present
  // while somebody who knows the work is doing it (`mind/apprenticeship.ts`).
  const work = workId ?? (p.occupation === 'villager' ? localTradePlace(world, p)?.id ?? null : null);
  return scheduleFor(p, { work, home: home.id, tavern: tavern.id, square: square.id, chapel: chapel.id });
}

/** A place within this person's own locality where a real trade process is carried out. */
function localTradePlace(world: World, p: Person): Place | undefined {
  return localPlaces(world, world.positionOf(p.id) ?? world.place(p.homeId)?.inside).find(place => !!processFor(place.type));
}

/**
 * Once-per-calendar-day: has anybody's life added up to a trade since yesterday?
 *
 * Called from the same daily demographic pass that ages people and emits `coming_of_age`, which
 * is what makes coming of age matter rather than merely be recorded. It runs only for living
 * people who hold no work of their own — in Ashford that is the children, the vagrant and the
 * elder, so the scan below is a handful of people, not the village.
 */
export function stepLivelihoods(world: World): void {
  for (const p of world.livingPersons()) {
    // Autonomous response dispatch; neutral prospects remain available to every person.
    if (isExternallyControlled(p) || p.workId || p.hostile) continue;
    const prospect = recogniseLivelihood(world, p);
    if (prospect) takeUpLivelihood(world, p, prospect);
  }
}
