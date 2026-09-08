import type { EntityId, ItemType, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import { learn } from './knowledge';
import { remember } from './memory';
import { formConcerns } from './concern';
import { adjustRel } from './relationships';
import { appraiseClaim } from '../social/appraisal';
import { shortfallBeliefs } from '../world/shortfall';
import { TRADE_NEEDS, tradesThatMake } from '../world/supply';

/**
 * INFERENCE — working out WHY, from what I already believe (Causal Society).
 *
 * The gap this closes is the one the milestone names last and cares about most. A mind could
 * already hold "the bakery has no flour" and "Hobb the miller was set upon on the east road" at
 * the same time, with real provenance on both, and there was nothing anywhere in the simulation
 * that could put them together. So an economic catastrophe caused by a crime was, to everyone it
 * ruined, simply weather. Nobody could be said to believe anything about who was behind it, which
 * is why the only thing a mind could ever offer about an event was to recite it back.
 *
 * What this produces is a third kind of belief with its own separate confidence: a `cause`
 * belief, "this is so BECAUSE that", naming both beliefs it was drawn from. Four properties make
 * it honest rather than a back door to omniscience:
 *
 *  1. **It is drawn only from beliefs this person already holds.** Both premises must be in their
 *     own `knowledge` map, with their own provenance. It never reads canonical world state to
 *     find out what actually happened, and it can therefore be WRONG — a baker may well conclude
 *     the mill stopped because the miller was hurt when in truth the grain simply never arrived.
 *  2. **It is weaker than its premises.** Confidence is the product of both premises' confidence
 *     times a per-rule strength, and its `hops` is the worse of the two — a conclusion is never
 *     closer to the source than the evidence it rests on.
 *  3. **It names a person only when the evidence does.** An `attack` belief whose actor the mind
 *     could not make out (`actorUnknown`) yields a cause with no one responsible in it. Nothing
 *     here ever fills in a name to make a story work.
 *  4. **It reaches behaviour through the ordinary machinery.** Concluding that a crime is what
 *     ruined your living re-appraises THAT CRIME for you, with a real material stake — and the
 *     concern that then forms is an ordinary justice concern, subject to the same v0.9 rule that
 *     it may move you to tell the watch and may never move you toward the suspect.
 *
 * The public trades table (`world/supply.ts`) is what makes any of this expressible: it is how a
 * mind knows that flour is a miller's business, and therefore that a miller's misfortune is a
 * candidate explanation for there being no flour.
 */

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** A person holds a few working explanations, not a theory of everything. */
export const MAX_CAUSE_BELIEFS = 6;
/** How long a conclusion stands before the same reasoning is worth doing again. */
export const REINFER_SECONDS = 24 * 3600;
/** The largest relationship movement a purely inferred material grievance may cause. Deliberately
 * far below what witnessing the same act would do: believing someone ruined your trade is a real
 * and reasonable thing to hold against them, and it is not the same as having seen them do it. */
export const MAX_INFERRED_GRIEVANCE = 0.12;

export function causeKeyFor(effectKey: string): string { return `why:${effectKey}`; }

/** How much a given kind of premise actually explains a stoppage. Ordered, and stated once. */
type RuleId = 'producer_harmed' | 'producer_dead' | 'producer_hurt' | 'producer_absent' | 'upstream_short';
const RULE_STRENGTH: Record<RuleId, number> = {
  producer_harmed: 0.75,
  producer_dead: 0.8,
  producer_hurt: 0.7,
  producer_absent: 0.55,
  upstream_short: 0.6,
};

interface Candidate {
  rule: RuleId;
  premise: KnowledgeItem;
  /** The person whose misfortune this is, when the premise is about a person. */
  producerId?: EntityId;
  /** Who this person believes did it, when the premise is a crime with a visible hand. */
  responsibleId?: EntityId;
  text: string;
}

/**
 * Run the reasoning for one person. Called from the coarse strategic pass, next to the other
 * inference in the simulation (`social/absence.ts`'s "you were not where I expected you"), and
 * cheap-gated: somebody who does not currently believe anything is short of anything has nothing
 * to explain and does no work at all.
 */
export function drawInferences(world: World, p: Person): void {
  if (!p.alive || p.controlled) return;
  const shortages = shortfallBeliefs(p);
  if (!shortages.length) return;
  for (const s of shortages) {
    const resource = s.claim.need as ItemType | undefined;
    if (!resource) continue;
    const key = causeKeyFor(s.key);
    const held = p.knowledge[key];
    if (held && world.now - held.learnedAt < REINFER_SECONDS) continue;
    const cand = bestExplanation(world, p, s, resource);
    if (!cand) continue;
    recordCause(world, p, s, cand, resource);
  }
  trimCauseBeliefs(p);
}

/** The strongest explanation this person's own beliefs offer for one shortage, or none. */
function bestExplanation(world: World, p: Person, s: KnowledgeItem, resource: ItemType): Candidate | null {
  const trades = tradesThatMake(resource);
  // What the trades that make this resource need in turn — the premise for an upstream shortage.
  const inputs = new Set<ItemType>();
  for (const t of trades) for (const need of TRADE_NEEDS[t] ?? []) inputs.add(need);

  let best: Candidate | null = null;
  let bestScore = 0;
  const consider = (c: Candidate) => {
    // A conclusion is worth drawing in proportion to how well the rule explains it and how sure
    // the person is of the premise. Deterministic; ties broken by the premise's own key.
    const score = RULE_STRENGTH[c.rule] * c.premise.confidence;
    if (score > bestScore || (score === bestScore && best && c.premise.key < best.premise.key)) { best = c; bestScore = score; }
  };
  /** Is this someone whose trade is one of the ones that makes the missing material? */
  const producerOfMissing = (id: EntityId | undefined): Person | null => {
    if (!id || id === p.id) return null;
    const q = world.person(id);
    if (!q) return null;
    return trades.includes(q.occupation) ? q : null;
  };

  for (const k of Object.values(p.knowledge)) {
    if (k.key === s.key) continue;
    const c = k.claim;
    if (k.kind === 'event' && (c.type === 'attack' || c.type === 'kill')) {
      const victim = producerOfMissing(c.target as EntityId | undefined);
      if (!victim) continue;
      consider({
        rule: c.type === 'kill' ? 'producer_dead' : 'producer_harmed',
        premise: k, producerId: victim.id,
        responsibleId: c.actorUnknown ? undefined : (c.actor as EntityId | undefined),
        text: `no ${resource} because ${victim.name} was ${c.type === 'kill' ? 'killed' : 'set upon'}`,
      });
      continue;
    }
    if (k.kind === 'event' && c.type === 'death') {
      const victim = producerOfMissing(c.target as EntityId | undefined);
      if (!victim) continue;
      consider({ rule: 'producer_dead', premise: k, producerId: victim.id, text: `no ${resource} because ${victim.name} is dead` });
      continue;
    }
    if (k.kind === 'event' && c.type === 'absence_noticed' && !k.handled) {
      const missing = producerOfMissing(c.target as EntityId | undefined);
      if (!missing) continue;
      consider({ rule: 'producer_absent', premise: k, producerId: missing.id, text: `no ${resource} because ${missing.name} has not been at their work` });
      continue;
    }
    if (k.kind === 'state' && (c.state === 'dead' || c.state === 'badly hurt')) {
      const who = producerOfMissing(c.entityId as EntityId | undefined);
      if (!who) continue;
      consider({
        rule: c.state === 'dead' ? 'producer_dead' : 'producer_hurt',
        premise: k, producerId: who.id,
        text: `no ${resource} because ${who.name} is ${c.state}`,
      });
      continue;
    }
    // An upstream stoppage: they have nothing to make it OUT of. Requires a real belief about the
    // upstream material, which in practice means having been there or been told.
    if (k.kind === 'event' && c.type === 'work_blocked' && !k.handled && inputs.has(c.need as ItemType)) {
      consider({ rule: 'upstream_short', premise: k, text: `no ${resource} because there is no ${c.need} to make it from` });
    }
  }
  return best;
}

/** Write the conclusion down, and let it do what a belief with a material stake in it does. */
function recordCause(world: World, p: Person, s: KnowledgeItem, cand: Candidate, resource: ItemType): void {
  const key = causeKeyFor(s.key);
  const confidence = clamp(s.confidence * cand.premise.confidence * RULE_STRENGTH[cand.rule], 0.1, 0.9);
  const hops = Math.max(s.hops, cand.premise.hops);
  const belief = learn(world, p, {
    key, kind: 'cause',
    claim: {
      effectKey: s.key, becauseKey: cand.premise.key,
      rule: cand.rule, resource, placeId: s.claim.placeId,
      subjectId: cand.producerId, responsibleId: cand.responsibleId,
      // Written once, here, out of the two beliefs it was drawn from — see `describeClaim`.
      text: cand.text,
      tick: world.now, significance: 0.4,
      // The canonical event behind the PREMISE, so a trace can keep walking backwards past this
      // conclusion into the world's own causal chain.
      eventId: cand.premise.claim.eventId,
    },
    confidence, hops,
    source: { type: 'inferred', viaEvent: cand.premise.source.viaEvent },
    summary: cand.text,
  });
  if (!belief) return;
  remember(world, p, {
    type: 'inference', summary: `I think ${cand.text}`, entities: [cand.producerId, cand.responsibleId].filter(Boolean) as string[],
    significance: 0.35, valence: -0.3, source: { type: 'inferred' }, placeId: s.claim.placeId as string | undefined,
  });

  // The conclusion changes what the PREMISE means to me. This is the whole point of drawing it:
  // an attack on a man I barely know, which I heard about second-hand and shrugged at, is a
  // different matter once I believe it is the reason I have no work. Re-appraised with a real
  // material stake, through the ordinary appraisal path — so whatever concern it now justifies is
  // an ordinary concern, under the ordinary rules (a justice concern may send me to the watch and
  // may never send me at the man himself).
  const materialStake = confidence * (0.5 + (s.claim.target === p.id ? 0.5 : 0.2));
  const reappraised = appraiseClaim(world, p, cand.premise, {
    materialStake,
    reason: `I believe this is why there is no ${resource}`,
  });
  formConcerns(world, p, cand.premise, reappraised);

  // ...and it is a real, if modest, thing to hold against whoever I believe did it. Bounded well
  // below what witnessing the act would do, applied once per conclusion (a conclusion only
  // re-forms after `REINFER_SECONDS`), and never applied to the victim: nobody resents a miller
  // for having been attacked.
  if (cand.responsibleId && cand.responsibleId !== p.id) {
    const mag = Math.min(MAX_INFERRED_GRIEVANCE, confidence * materialStake * 0.35);
    adjustRel(world, p, cand.responsibleId, { trust: -mag, respect: -mag * 0.6, grudge: mag * 0.8 },
      `I believe ${world.nameOf(cand.responsibleId)} is why there is no ${resource} (inferred, confidence ${confidence.toFixed(2)})`,
      cand.premise.claim.eventId as string | undefined);
  }
}

function trimCauseBeliefs(p: Person): void {
  const causes = Object.values(p.knowledge).filter(k => k.kind === 'cause');
  if (causes.length <= MAX_CAUSE_BELIEFS) return;
  causes.sort((a, b) => (b.confidence - a.confidence) || (b.learnedAt - a.learnedAt) || a.key.localeCompare(b.key));
  for (const k of causes.slice(MAX_CAUSE_BELIEFS)) delete p.knowledge[k.key];
}

/** Every explanation this person currently holds. Used by the causal trace and by tests. */
export function causeBeliefs(p: Person): KnowledgeItem[] {
  return Object.values(p.knowledge).filter(k => k.kind === 'cause');
}

/** What this person believes is behind `effectKey`, if anything. */
export function causeOf(p: Person, effectKey: string): KnowledgeItem | undefined {
  return p.knowledge[causeKeyFor(effectKey)];
}
