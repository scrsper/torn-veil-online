import { knownName } from './people';
import type { Concern, EntityId, ItemType, KnowledgeItem, Person, Situation } from '../core/types';
import type { World } from '../core/world';
import { appraiseClaim, type Appraisal } from '../social/appraisal';
import { personalSituationView, situationForEvent } from '../social/situation';
import { activeConcerns } from './concern';
import { isCrime } from './knowledge';
import { getRel } from './relationships';
import { tradeMakes, tradeNeeds } from '../world/supply';

/**
 * CONVERSATION RELEVANCE — deciding whether something is worth saying at all (v0.9 §E).
 *
 * Previously both ambient gossip (`Simulation.pickGossip`) and player dialogue
 * (`DialogueSystem.news`) picked "the most significant unshared thing I know" and said it. That
 * is why the village behaved like an event log being read aloud: every NPC volunteered the same
 * top-ranked fact to everybody, forever, regardless of whether it mattered to either of them or
 * whether it had since been dealt with.
 *
 * This module scores a candidate on the things a person actually weighs before speaking:
 *   - MY involvement (`social/appraisal.ts` — the same appraisal that drives concerns);
 *   - whether I am carrying a live CONCERN that this bears on;
 *   - whether the matter is still UNRESOLVED as far as I know (`personalSituationView`);
 *   - how recently I learned it;
 *   - whether it is any of THIS listener's business, judged only from things I could actually
 *     know about them (see `listenerRelevance`);
 *   - and whether they plainly already know.
 *
 * Below `MENTION_THRESHOLD` the answer is silence, which is the point: "silence is valid and
 * preferable to irrelevant gossip."
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** The bar a candidate must clear before a person volunteers it. Tuned so that a witnessed
 * assault reaches a guard or the victim's kin easily, and a stale third-hand nothing reaches
 * nobody. */
export const MENTION_THRESHOLD = 0.3;
/** How fast unshared news loses its "I must tell someone" pressure, in hours. */
export const NEWS_HALFLIFE_HOURS = 20;

export interface Topic {
  k: KnowledgeItem;
  score: number;
  reasons: string[];
  appraisal: Appraisal;
  concern?: Concern;
  situation?: Situation;
  /** Whether I personally know of anything that settled this matter — what lets a speaker say
   * "and the watch has him" instead of repeating week-old alarm. */
  resolvedForSpeaker: boolean;
  /** Other grounded beliefs of MINE that bear on the same people, available for synthesis into
   * one natural statement (v0.9 §E "they may synthesize multiple grounded facts"). Never
   * anything I do not actually believe. */
  supporting: KnowledgeItem[];
}

/**
 * What I can legitimately think makes this the listener's business. Every clause here is
 * something a person in a village genuinely has access to — a public role, a shared roof, a
 * shared workplace, being named in the matter itself — never a private relationship of the
 * listener's that I was never told about (that would be omniscience wearing a social costume).
 */
function listenerRelevance(world: World, speaker: Person, listener: Person, k: KnowledgeItem): { value: number; reasons: string[] } {
  const c = k.claim;
  const reasons: string[] = [];
  let value = 0;
  const subjectId = (c.type === 'item_missing' ? c.actor : c.target) as EntityId | undefined;
  const actorId = c.actorUnknown ? undefined : (c.actor as EntityId | undefined);

  // Occupation is publicly visible. Telling the watch about a crime is the paradigm case.
  const listenerIsLaw = listener.occupation === 'guard' || listener.occupation === 'captain';
  if (listenerIsLaw && isCrime(c.type as string, c.intent as string | undefined)) {
    value += 0.55; reasons.push(`${knownName(speaker, listener.id)} is of the watch`);
  }
  // Shared household / shared workplace are plainly observable village facts.
  const subject = subjectId ? world.person(subjectId) : undefined;
  if (subject) {
    if (subject.householdId && listener.householdId === subject.householdId && listener.id !== subject.id) {
      value += 0.45; reasons.push(`${knownName(speaker, listener.id)} shares a roof with ${knownName(speaker, subject.id)}`);
    }
    if (subject.workId && listener.workId === subject.workId && listener.id !== subject.id) {
      value += 0.35; reasons.push(`${knownName(speaker, listener.id)} works alongside ${knownName(speaker, subject.id)}`);
    }
  }
  // My OWN relationship with the listener: I tell the people close to me things.
  const rel = getRel(speaker, listener.id);
  if (rel.tags.some(t => ['spouse', 'child', 'parent', 'sibling', 'friend', 'sweetheart'].includes(t))) {
    value += 0.25; reasons.push(`${knownName(speaker, listener.id)} is my ${rel.tags[0]}`);
  } else if (rel.familiarity > 0.3) value += rel.familiarity * 0.15;
  // I do not gossip to someone I distrust.
  if (rel.trust < -0.3) value -= 0.5;
  // Causal Society: a shortage is the business of whoever it actually reaches — the trades that
  // need the material or supply it, and the people who work or live where it has run out. It is
  // not the business of everybody.
  //
  // Without this clause it was: measured on a 30-day seed-918271 run, one bakery shortage reached
  // all thirty villagers inside a day and crowded a genuine theft out of the conversation
  // entirely, which `tests/social-causality-trace.test.ts` caught as "only one person in the whole
  // village knows of it at all". Every hop of that spread was a real conversation and the hop
  // counts were honest — the fault was not that the news travelled, but that it was ranked as
  // being everyone's business, so it won every chat turn it was offered in.
  const need = c.need as ItemType | undefined;
  if (need) {
    const placeId = c.placeId as EntityId | undefined;
    if (tradeNeeds(listener.occupation, need) || tradeMakes(listener.occupation, need)) {
      value += 0.3; reasons.push(`${need} is ${knownName(speaker, listener.id)}'s trade`);
    } else if (placeId && (listener.workId === placeId || listener.homeId === placeId)) {
      value += 0.25; reasons.push(`${knownName(speaker, listener.id)} is there every day`);
    } else {
      value -= 0.35;
    }
  }
  // A person named in the matter does not need to be informed of it by me.
  if (listener.id === actorId || listener.id === subjectId) value -= 1;
  return { value: clamp(value, -1, 1.2), reasons };
}

/** Other beliefs of the speaker's that bear on the same people — the material for a statement
 * that reads like a person describing a situation rather than reciting one row. */
function supportingFacts(world: World, speaker: Person, k: KnowledgeItem, limit = 2): KnowledgeItem[] {
  const c = k.claim;
  const subjectId = (c.type === 'item_missing' ? c.actor : c.target) as EntityId | undefined;
  if (!subjectId) return [];
  const out: KnowledgeItem[] = [];
  for (const other of Object.values(speaker.knowledge)) {
    if (other.key === k.key) continue;
    if (out.length >= limit) break;
    const oc = other.claim;
    const namesSubject = oc.target === subjectId || oc.actor === subjectId || oc.entityId === subjectId;
    if (!namesSubject) continue;
    // Only facts that add something to the picture: a state, an absence, a follow-up event.
    if (other.kind === 'event' && ['absence_noticed', 'heal', 'entity_arrested', 'arrest_attempt', 'death', 'item_missing'].includes(oc.type as string)) out.push(other);
    else if (other.kind === 'state') out.push(other);
  }
  void world;
  return out;
}

export interface TopicOptions {
  /** Skip the "they already know" test — the player dialogue path wants everything the speaker
   * would be willing to say, and the player's own knowledge map is the caller's business. */
  ignoreListenerKnowledge?: boolean;
  /** Lower the bar (a player who explicitly ASKED for news has invited a lower-value answer than
   * one who happened to walk past). Never below zero — a speaker with nothing relevant still
   * says nothing. */
  threshold?: number;
}

/** Score one candidate belief as a thing to say to this listener, right now. */
export function scoreTopic(world: World, speaker: Person, listener: Person, k: KnowledgeItem): Topic {
  const reasons: string[] = [];
  const appraisal = appraiseClaim(world, speaker, k);
  const situation = situationForEvent(world, k.claim.eventId as string | undefined);
  const view = situation ? personalSituationView(world, speaker, situation) : null;

  // 1. how much it means to me
  let score = appraisal.weight * 0.5;
  if (appraisal.reasons.length) reasons.push(appraisal.reasons[0]);

  // 2. am I carrying something about it. (The contribution itself is added in step 4, after the
  // freshness decay, so a live worry is not discounted for the age of the event behind it.)
  let concern: Concern | undefined;
  for (const c of activeConcerns(speaker)) {
    if (!c.basisKeys.includes(k.key)
      && c.subjectId !== appraisal.subjectId && c.aboutId !== appraisal.actorId) continue;
    if (!concern || c.intensity > concern.intensity) concern = c;
  }
  if (concern) reasons.push(`it is on my mind (${concern.kind})`);

  // 3. is it still live, as far as I know
  let resolvedForSpeaker = false;
  if (view) {
    if (view.status === 'resolved') {
      resolvedForSpeaker = true;
      // Still worth mentioning — but as a settled thing, briefly, not as alarm.
      score = score * 0.45 + 0.05;
      reasons.push(`it has been settled (${view.resolution ?? 'settled'})`);
    } else {
      reasons.push('it is not settled yet');
    }
  }

  // 4. how long ago it actually HAPPENED — not how long ago I filed it away.
  //
  // This distinction is the whole of v0.9 §G at the conversational level, and getting it wrong
  // was visible immediately: keying decay off `learnedAt` alone, every villager cheerfully
  // volunteered their own decades-old marriage and long-ago gifts as the day's news, because
  // world generation seeds all that backstory with a `learnedAt` of "now" (see
  // world/village.ts's pre-history) even though the events themselves are years old. A fact's
  // NEWS value decays with the age of the occurrence; having only just heard it adds a small,
  // bounded urge to pass it on; and knowledge the mind has simply always held ('prior') is by
  // definition not news at all — `realize.ts` already has it saying "that's old news to me".
  //
  // Deliberately applied to the personal-significance term ONLY. The concern and unresolved-
  // situation terms above are already time-aware in their own right (concerns decay on their own
  // half-lives, `situationRelevance` floors an ACTIVE matter at 0.4), and an unsettled matter
  // must stay worth raising even once it is no longer fresh — that is the difference between
  // "recent occurrence" and "active situation" the milestone asks the world to distinguish.
  const happenedAt = typeof k.claim.tick === 'number' ? (k.claim.tick as number) : k.learnedAt;
  const eventAgeHours = Math.max(0, (world.now - happenedAt) / 3600);
  const learnedAgoHours = Math.max(0, (world.now - k.learnedAt) / 3600);
  const freshness = Math.max(0.05, Math.pow(0.5, eventAgeHours / NEWS_HALFLIFE_HOURS));
  score = score * freshness + (concern ? concern.intensity * 0.3 : 0) + (view && view.status === 'unresolved' ? view.relevance * 0.25 : 0);
  if (learnedAgoHours < 24) score += 0.05;
  if (k.source.type === 'prior') { score *= 0.3; reasons.push('old news to me'); }

  // 5. is it this listener's business
  const lr = listenerRelevance(world, speaker, listener, k);
  score += lr.value * 0.4;
  reasons.push(...lr.reasons);

  // 6. a sociable person volunteers more; a taciturn one keeps it to themselves
  score += (speaker.traits.sociability - 0.5) * 0.12;

  return { k, score: clamp(score, -1, 2), reasons: reasons.filter(Boolean).slice(0, 4), appraisal, concern, situation: situation ?? undefined, resolvedForSpeaker, supporting: [] };
}

/**
 * A cheap structural pre-filter, applied before the (comparatively costly) full appraisal.
 * `selectTopic` runs over a mind's ENTIRE knowledge map on every chat opportunity, and the
 * overwhelming majority of entries are trivial or long stale; scoring them properly only to
 * discard them is pure waste. Nothing here can promote a candidate — it only skips ones whose
 * full score could not possibly clear the mention bar. Same shape as the filter the pre-v0.9
 * `pickGossip` applied inline.
 */
function worthScoring(world: World, k: KnowledgeItem): boolean {
  const crime = isCrime(k.claim.type as string, k.claim.intent as string | undefined);
  if (!crime && (k.claim.significance ?? 0.3) < 0.15) return false;
  // A crime stays worth weighing however old; anything else stops being news.
  if (!crime && world.now - k.learnedAt > 5 * 86400) return false;
  if (k.confidence < 0.15) return false;
  return true;
}

/**
 * Choose what (if anything) `speaker` would raise with `listener`. Returns null for silence —
 * the common, correct answer.
 */
export function selectTopic(world: World, speaker: Person, listener: Person, opts: TopicOptions = {}): Topic | null {
  const threshold = opts.threshold ?? MENTION_THRESHOLD;
  let best: Topic | null = null;
  for (const k of Object.values(speaker.knowledge)) {
    if (k.kind !== 'event') continue;
    if (k.sharedWith.includes(listener.id)) continue;
    if (!opts.ignoreListenerKnowledge && listener.knowledge[k.key]) continue;
    if (k.claim.actor === listener.id) continue; // do not narrate someone's own deeds at them
    if (k.source.from === listener.id) continue; // they told me this
    if (!worthScoring(world, k)) continue;
    const t = scoreTopic(world, speaker, listener, k);
    if (!best || t.score > best.score) best = t;
  }
  if (!best || best.score < threshold) return null;
  best.supporting = supportingFacts(world, speaker, best.k);
  return best;
}

/**
 * The listener-independent version: what is most on this person's mind right now, for cases
 * where there is no specific listener yet (the Inspector, a headless trace, a "what's troubling
 * you" dialogue option). Same appraisal, no listener-relevance term.
 */
export function foremostMatter(world: World, p: Person): Topic | null {
  let best: Topic | null = null;
  for (const c of activeConcerns(p)) {
    for (const key of c.basisKeys) {
      const k = p.knowledge[key];
      if (!k || k.kind !== 'event') continue;
      const situation = situationForEvent(world, k.claim.eventId as string | undefined);
      const view = situation ? personalSituationView(world, p, situation) : null;
      const appraisal = appraiseClaim(world, p, k);
      const score = c.intensity * 0.7 + appraisal.weight * 0.3;
      if (best && score <= best.score) continue;
      best = {
        k, score, appraisal, concern: c, situation: situation ?? undefined,
        resolvedForSpeaker: view?.status === 'resolved',
        reasons: [...c.reasons].slice(0, 3),
        supporting: supportingFacts(world, p, k),
      };
    }
  }
  return best;
}
