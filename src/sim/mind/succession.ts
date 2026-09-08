import type { EntityId, ItemType, Person, SkillId } from '../core/types';
import type { World } from '../core/world';
import { getPhysicalCapability } from '../core/attributes';
import { skillOf } from '../core/skills';
import { activeConcerns } from './concern';
import { laborIncentive } from './economy';
import { isClose, isFamily } from './relationships';
import { obligationCredit } from '../social/obligation';
import { shortfallBeliefs } from '../world/shortfall';
import { openStintFor, unfitReason, type TradePost } from '../world/labor';
import { instructionOf } from './apprenticeship';

/**
 * WHO STEPS IN (Adaptive Society v0.5).
 *
 * This module answers ONE question, and does not act on the answer: given everything this person
 * already knows, is, owns and owes, how plausible is it that they would take up work that nobody
 * is doing? It returns a number and the reasons behind it. What happens next is entirely
 * ordinary — `mind/agent.ts` turns that number into one more `work` candidate among twenty-five,
 * and it competes with sleep, hunger, their own trade, their own errands, and everything else.
 * Nothing here assigns anybody to anything, and there is no successor list.
 *
 * WHY THIS IS NOT SCRIPTED REPLACEMENT, stated so it can be checked rather than trusted:
 *
 *  1. **Nothing consults who is missing.** No branch below reads "the miller is dead", or reads
 *     the vacant post's former worker at all. It reads only facts about the CANDIDATE and about
 *     the material. A post is a post; a corpse is not an input.
 *  2. **Awareness is required, and is ordinary knowledge.** Somebody who has not learned that the
 *     material is short scores zero — not a low score, zero, by short-circuit. That belief has to
 *     have been acquired the way every belief in this simulation is acquired (Constitution §III),
 *     which is why the nearest idle villager is usually NOT the responder: they have no idea.
 *  3. **The score is a sum of independent pressures, none of them decisive.** Capability,
 *     kinship, need, opportunity and fitness each contribute; no single one reaches the
 *     threshold alone, so changing any one person's circumstances can change who responds.
 *  4. **Nobody may be plausible.** The threshold is real. A village with no one who knows, no one
 *     who can, and no one who needs to simply stays short — see `tests/adaptive-society.test.ts`'s
 *     no-successor case. Societies fail; that outcome is not a bug to be tuned away.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Work that draws on some of the same hands and habits. Related experience is not the trade —
 * it is why a baker is a more plausible miller than a priest, and it is worth a fraction of the
 * real skill. Kept deliberately short and defensible: milling and baking are both grain work in
 * a dusty room; hauling is the sacks.
 */
const RELATED_SKILLS: Partial<Record<SkillId, Partial<Record<SkillId, number>>>> = {
  milling: { baking: 0.5, hauling: 0.3, construction: 0.15 },
  baking: { milling: 0.5, cooking: 0.4, hauling: 0.15 },
};

/** How much of the real skill a related one is worth, before its own weight above. */
export const RELATED_SKILL_DISCOUNT = 0.55;

/** Enough plausibility to be worth proposing at all. Below this the candidate goal is never
 * built, so nobody "considers and declines" — they simply have no reason to be there. */
export const STAND_IN_THRESHOLD = 0.3;

/** The ceiling on a stand-in candidate's own utility before the ordinary bridges
 * (`motivationBoost`) add anything. Below a genuine physiological emergency and below a person's
 * own committed work, on purpose: taking up somebody else's trade is a real motive, never an
 * overriding one. */
export const MAX_STAND_IN_UTILITY = 0.62;

export interface StandInCandidacy {
  /** 0..1 plausibility. Below `STAND_IN_THRESHOLD` this is not returned at all. */
  score: number;
  /** The utility a `work` goal at this post should be proposed with, before concerns/obligations. */
  utility: number;
  reasons: string[];
  /** The canonical events behind the belief they are acting on, for the causal trace. */
  causes: EntityId[];
  /** Whoever taught them the trade, if anyone had — carried onto the `WorkStint`. */
  teacherId?: EntityId;
}

/**
 * How much this person already knows that bears on this post's work going undone.
 *
 * Three ways in, all of them ordinary beliefs with real provenance, and no fourth:
 *  - a live supply worry about the material this place makes, or about what it is made from;
 *  - a first-hand or second-hand belief that somebody, somewhere, could not get that material;
 *  - a worry about one of the people this place is worked by (v0.9's 'work' concern — "short-
 *    handed without Hobb"), which is how a household or a neighbour can be aware of a stoppage
 *    before any shortage has reached them.
 *
 * Returns 0 when the person has no idea, and 0 is a hard stop for the whole candidacy.
 */
function awareness(world: World, p: Person, post: TradePost): { weight: number; reasons: string[]; causes: EntityId[] } {
  const reasons: string[] = [];
  const causes: EntityId[] = [];
  let weight = 0;
  const { output, input } = post.process;
  for (const c of activeConcerns(p)) {
    if (c.kind === 'supply' && (c.resource === output || c.resource === input)) {
      const w = c.resource === output ? 1 : 0.6;
      if (c.intensity * w > weight) { weight = c.intensity * w; }
      reasons.push(`I am short of ${c.resource} (worry ${c.intensity.toFixed(2)})`);
    } else if (c.kind === 'work' && c.subjectId && post.staff.some(s => s.id === c.subjectId)) {
      const w = c.intensity * 0.8;
      if (w > weight) weight = w;
      reasons.push(`${world.nameOf(c.subjectId)} is not at ${post.place.name} (worry ${c.intensity.toFixed(2)})`);
    }
  }
  for (const k of shortfallBeliefs(p)) {
    if (k.claim.need !== output && k.claim.making !== output) continue;
    const w = k.confidence * (k.hops === 0 ? 0.9 : 0.6);
    if (w > weight) weight = w;
    reasons.push(`there is no ${k.claim.need} at ${world.nameOf(k.claim.placeId as string)}${k.hops ? ' (so I am told)' : ''}`);
    if (k.claim.eventId) causes.push(k.claim.eventId as string);
  }
  return { weight: clamp01(weight), reasons: reasons.slice(0, 2), causes: causes.slice(0, 2) };
}

/** Real proficiency at this trade, plus a discounted share of the nearest related work. */
export function tradeReadiness(p: Person, skill: SkillId): { value: number; own: number; related: number } {
  const own = skillOf(p, skill);
  let related = 0;
  for (const [other, weight] of Object.entries(RELATED_SKILLS[skill] ?? {})) {
    related = Math.max(related, skillOf(p, other as SkillId) * (weight ?? 0));
  }
  return { value: clamp01(own + related * RELATED_SKILL_DISCOUNT), own, related };
}

/**
 * Everything above, weighed. The weights are the milestone's own list of what should count, and
 * they are stated once here rather than scattered through `think()`.
 */
export function standInCandidacy(world: World, p: Person, post: TradePost): StandInCandidacy | null {
  if (p.controlled || p.hostile) return null;
  // Fitness first, and through the SAME call that decided the post was under-served — so a person
  // who is dead, downed, badly hurt, held, or spent is never a candidate, and "cannot work" means
  // exactly one thing in this milestone.
  //
  // Note the missing second argument, and it matters: `unfitReason` without a place asks only
  // whether this person can work AT ALL — alive, on their feet, not badly hurt, not held, not
  // spent. It deliberately does NOT ask whether they are standing at the mill, because a
  // candidate's whole decision is whether to WALK there. Distance belongs in the score below,
  // where it can be outweighed by a strong enough reason, not in a gate that would silently
  // limit adaptation to whoever happened to already be in the room.
  if (unfitReason(world, p)) return null;
  // A child's body is the reason, not a child's label: ordinary work needs a grown frame, and
  // `getPhysicalCapability` already knows how much of one this person has.
  if (p.age < 14) return null;
  if (post.staff.some(s => s.id === p.id)) return null;

  const aware = awareness(world, p, post);
  if (aware.weight <= 0) return null;

  const readiness = tradeReadiness(p, post.process.skill);
  const cap = getPhysicalCapability(p, world);
  const body = world.primaryBody(p.id);
  if (!body) return null;

  // Proximity: how far the work is from where this person's life already is — their own work,
  // then their home, then wherever they happen to be standing. Real distance over the real map.
  const anchor = world.place(p.workId ?? '')?.inside ?? world.place(p.homeId ?? '')?.inside ?? body.pos;
  const metres = Math.hypot(anchor.x - post.place.inside.x, anchor.z - post.place.inside.z);
  const proximity = clamp01(1 - metres / 140);

  // Obligation and household. Somebody's kin, or somebody who owes them, has a claim on their
  // work that a stranger does not — and it is read from the standing social record
  // (v0.10's `Obligation`) and from real relationship tags, never from a family tree lookup.
  let household = 0;
  const staffReasons: string[] = [];
  for (const s of post.staff) {
    if (p.homeId && s.homeId === p.homeId) { household = Math.max(household, 0.8); staffReasons.push(`I live where ${s.name} lives`); }
    else if (isFamily(p, s.id)) { household = Math.max(household, 0.7); staffReasons.push(`${s.name} is family`); }
    else if (isClose(p, s.id)) { household = Math.max(household, 0.35); staffReasons.push(`${s.name} matters to me`); }
    const credit = obligationCredit(p, s.id);
    if (credit > 0) { household = Math.max(household, clamp01(credit)); staffReasons.push(`I owe ${s.name}`); }
  }

  // Economic need — the same wage-pressure signal every other paid-labour candidate is weighted
  // by (mind/economy.ts). Re-centred to 0..1 here rather than used as a multiplier, because for a
  // stand-in it is one motive among several, not a scaling of an existing one.
  const need = clamp01((laborIncentive(p) - 0.7) / 0.6);

  // Opportunity: my own trade is stopped for want of the very thing this place makes, so the
  // hours are there and the reason is immediate. Derived from what they believe, not from their
  // schedule — a baker with no flour is idle whatever the timetable says.
  const ownWorkBlocked = shortfallBeliefs(p).some(k => k.claim.need === post.process.output && k.claim.placeId === p.workId);
  const opportunity = ownWorkBlocked ? 1 : (p.mind.commitment && p.mind.commitment.status === 'active' ? 0 : 0.35);

  const score = clamp01(
    aware.weight * 0.22
    + readiness.value * 0.26
    + proximity * 0.14
    + household * 0.16
    + need * 0.1
    + opportunity * 0.12,
  ) * clamp01(0.35 + cap.currentExertionCapacity * 0.85);

  if (score < STAND_IN_THRESHOLD) return null;

  const taught = instructionOf(p, post.process.skill);
  const already = openStintFor(world, p.id, post.place.id);
  const reasons = [
    `${post.place.name} is standing idle and ${post.process.output} is wanted`,
    ...aware.reasons,
    readiness.own > 0.05
      ? `I have ${post.process.verb === 'milling' ? 'ground grain' : 'done this work'} before (${post.process.skill} ${readiness.own.toFixed(2)})`
      : readiness.related > 0.05 ? `my own trade is not far from it (${readiness.value.toFixed(2)} of the way there)`
      : `I have never done it, but somebody must`,
    ...staffReasons.slice(0, 1),
    ownWorkBlocked ? 'my own work is stopped for want of it' : '',
    need > 0.4 ? 'and I could use the silver' : '',
    already ? `I have got ${already.batches} batch${already.batches === 1 ? '' : 'es'} out of it so far` : '',
    taught ? `${world.nameOf(taught.claim.teacherId as string)} showed me how it is done` : '',
  ].filter(Boolean);

  return {
    score,
    utility: Math.min(MAX_STAND_IN_UTILITY, score * cap.currentExertionCapacity),
    reasons,
    causes: aware.causes,
    teacherId: taught?.claim.teacherId as EntityId | undefined,
  };
}

/**
 * The cheap pre-filter: whose head currently contains ANYTHING that could bear on a shortage
 * anywhere. Built once per coarse strategic pass (`mind/agent.ts`) and consulted per think() tick
 * in place of running the full candidacy, which is what makes this layer cost effectively nothing
 * in an ordinary village where nobody knows of any shortage — which is almost always.
 *
 * This exists because of a measured regression rather than by design. `standInCandidacy`'s first
 * act is a scan of the person's whole knowledge map; running that for every villager on every
 * deliberation tick, for as long as any post anywhere was going unworked, was enough to starve a
 * neighbouring test of CPU (`tests/embodied-economy.test.ts`'s currency-conservation run, which
 * has a tight per-test budget, timed out). The set is deliberately GENEROUS — it asks only
 * "could this person have a reason", never "is this person a candidate", so the answers
 * `standInCandidacy` gives are unchanged; it just is not asked most of the time.
 */
export function peopleAwareOfShortage(world: World): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const p of world.livingPersons()) {
    if (p.controlled) continue;
    let aware = false;
    for (const c of p.mind.concerns ?? []) {
      if (c.status === 'active' && (c.kind === 'supply' || c.kind === 'work')) { aware = true; break; }
    }
    if (!aware) { for (const k of Object.values(p.knowledge)) {
      if (k.kind === 'event' && k.claim.type === 'work_blocked' && !k.handled) { aware = true; break; }
    } }
    if (aware) out.add(p.id);
  }
  return out;
}

/**
 * Everyone the world currently makes a plausible responder for one post, strongest first. Nothing
 * in the simulation's decision path calls this — each person evaluates only themselves, in their
 * own `think()`. It exists for tests, traces and the developer overlay, so "who could have" is
 * inspectable without asking the simulation to compute a ranking it never uses.
 */
export function plausibleRespondersTo(world: World, post: TradePost): { person: Person; candidacy: StandInCandidacy }[] {
  const out: { person: Person; candidacy: StandInCandidacy }[] = [];
  for (const p of world.persons()) {
    const candidacy = standInCandidacy(world, p, post);
    if (candidacy) out.push({ person: p, candidacy });
  }
  return out.sort((a, b) => b.candidacy.score - a.candidacy.score || a.person.id.localeCompare(b.person.id));
}

/** What material this post's work would put out — used by `mind/agent.ts` to declare the goal's
 * resource, so a supply worry can lift the very work that answers it. */
export function postResource(post: TradePost): ItemType { return post.process.output; }
