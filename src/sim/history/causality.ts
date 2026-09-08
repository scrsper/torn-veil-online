import type { Concern, EntityId, Goal, KnowledgeItem, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { describeClaim } from '../mind/knowledge';
import { concernsOf, describeConcern } from '../mind/concern';
import { causeKeyFor } from '../mind/inference';
import { describeRel } from '../mind/relationships';

/**
 * CAUSAL TRACE — walking one decision, worry or belief back to what caused it.
 *
 * Deliberately NOT a general explainability engine. It is a reader over links that already exist
 * in canonical state, added because verifying this milestone by hand meant repeatedly doing the
 * same walk by eye:
 *
 *   a goal      names the concerns that lifted it        (mind/concern.ts's CONCERN_GOALS)
 *   a concern   names the beliefs it rests on            (Concern.basisKeys)
 *   a belief    names how it was come by                 (KnowledgeItem.source / hops / confidence)
 *   a belief    may have an explanation                  (mind/inference.ts's `why:<key>` cause belief)
 *   an event    names the events that caused it          (WorldEvent.causes)
 *
 * Nothing here computes or stores anything of its own, so a trace cannot disagree with the world:
 * if the walk is empty, the causal link genuinely is not there, which is exactly the failure a
 * test wants to catch. It is also strictly EPISTEMIC where a person is involved — it walks what
 * THIS person believes and how they came by it, never the world's own record of what happened, so
 * a trace of somebody's mistaken conclusion correctly shows a mistaken conclusion.
 */

export type CausalKind = 'goal' | 'concern' | 'belief' | 'cause' | 'event';

export interface CausalNode {
  kind: CausalKind;
  /** How far down the chain this link sits. 0 is the thing being explained; every node at depth
   * d is a reason for the nearest node above it at depth d-1. Two nodes at the SAME depth are
   * SIBLING reasons for the same thing, not a chain — getting this wrong is how a trace starts
   * asserting causal links the world never recorded, which is the one thing it must not do. */
  depth: number;
  /** What this link asserts, in grounded terms. */
  what: string;
  /** How it is held or known — 'witnessed', 'told by Mara', 'inferred', 'the world's own record'. */
  via: string;
  confidence?: number;
  hops?: number;
  /** The knowledge key or event id this node stands for, so a test can assert on identity rather
   * than on prose. */
  ref?: string;
}

const MAX_DEPTH = 8;

function provenanceOf(world: World, k: KnowledgeItem): string {
  switch (k.source.type) {
    case 'self': return 'I found it so myself';
    case 'witnessed': return 'witnessed directly';
    case 'heard': return 'heard it happen';
    case 'told': return `told by ${k.source.from ? world.nameOf(k.source.from) : 'someone'}`;
    case 'inferred': return 'inferred';
    case 'prior': return 'known since before';
  }
}

/** One belief, its provenance, its explanation (if this mind has drawn one), and the canonical
 * chain behind the event it names — as far as the world still remembers. */
export function explainBelief(world: World, p: Person, k: KnowledgeItem, seen = new Set<string>(), depth = 0): CausalNode[] {
  if (depth >= MAX_DEPTH || seen.has(k.key)) return [];
  seen.add(k.key);
  const out: CausalNode[] = [{
    kind: k.kind === 'cause' ? 'cause' : 'belief',
    depth,
    what: describeClaim(world, k),
    via: provenanceOf(world, k),
    confidence: Math.round(k.confidence * 100) / 100,
    hops: k.hops,
    ref: k.key,
  }];
  // Has this person worked out WHY? If so, that conclusion — and the belief it was drawn from —
  // are the next links, not the world's own causal chain.
  const cause = p.knowledge[causeKeyFor(k.key)];
  if (cause && cause !== k) {
    out.push(...explainBelief(world, p, cause, seen, depth + 1));
    const premise = p.knowledge[cause.claim.becauseKey as string];
    if (premise) out.push(...explainBelief(world, p, premise, seen, depth + 1));
    return out;
  }
  // Otherwise follow the world's own record of what led to the event this belief is about. This
  // is the one place the trace leaves the person's head, and it is labelled as such: it is what a
  // developer can see, not what the villager believes.
  const ev = world.event(k.claim.eventId as string | undefined);
  if (ev) out.push(...explainEvent(world, ev, seen, depth + 1));
  return out;
}

export function explainEvent(world: World, e: WorldEvent, seen = new Set<string>(), depth = 0): CausalNode[] {
  if (depth >= MAX_DEPTH || seen.has(e.id)) return [];
  seen.add(e.id);
  const out: CausalNode[] = [];
  for (const id of e.causes ?? []) {
    const parent = world.event(id);
    if (!parent) continue;
    out.push({ kind: 'event', depth, what: parent.summary, via: "the world's own record", ref: parent.id });
    out.push(...explainEvent(world, parent, seen, depth + 1));
    break; // one line of descent is a trace; the full graph is the event log's job
  }
  return out;
}

/** A worry, and everything this person actually knows that justifies it. */
export function explainConcern(world: World, p: Person, c: Concern, baseDepth = 0): CausalNode[] {
  const out: CausalNode[] = [{
    kind: 'concern',
    depth: baseDepth,
    what: `${p.name} is ${describeConcern(world, c)}`,
    via: `carried since day ${Math.floor(c.createdAt / 86400)} (intensity ${c.intensity.toFixed(2)})`,
    ref: c.id,
  }];
  const seen = new Set<string>();
  for (const key of c.basisKeys) {
    const k = p.knowledge[key];
    if (k) out.push(...explainBelief(world, p, k, seen, baseDepth + 1));
  }
  return out;
}

/**
 * Why is this person doing this? Answered by finding the worries that could have lifted this
 * particular goal — matched the same way `concernGoalBoost` matches, so a trace can never claim a
 * concern was responsible for a goal that concern could not have boosted.
 */
export function explainGoal(world: World, p: Person, goal: Goal): CausalNode[] {
  const out: CausalNode[] = [{
    kind: 'goal',
    depth: 0,
    what: `${p.name} chose to ${goal.type}${goal.targetEntity ? ` (${world.nameOf(goal.targetEntity)})` : goal.targetPlace ? ` at ${world.nameOf(goal.targetPlace)}` : ''}`,
    via: `utility ${goal.utility.toFixed(2)}${goal.reasons.length ? ` — ${goal.reasons[0]}` : ''}`,
    ref: goal.key,
  }];
  const target = goal.targetEntity ?? goal.targetPlace;
  const resource = goal.data?.resource;
  for (const c of concernsOf(p)) {
    if (c.status !== 'active') continue;
    const relevant = (target && (c.subjectId === target || c.aboutId === target))
      || (c.kind === 'supply' && !!resource && c.resource === resource)
      || (c.kind === 'supply' && goal.type === 'work' && !!c.resource);
    if (!relevant) continue;
    out.push(...explainConcern(world, p, c, 1));
  }
  return out;
}

/** Why does this person feel about that one the way they do — over their own beliefs, in the
 * order that most bears on it. The relationship state itself is the head of the chain; what
 * follows is the evidence this person actually holds for it. */
export function explainRelationship(world: World, p: Person, otherId: EntityId, limit = 3): CausalNode[] {
  const rel = p.relationships[otherId];
  if (!rel) return [];
  const out: CausalNode[] = [{
    kind: 'belief',
    depth: 0,
    what: `${p.name} → ${world.nameOf(otherId)}: ${describeRel(rel)}`,
    via: `trust ${rel.trust.toFixed(2)}, affection ${rel.affection.toFixed(2)}, grudge ${rel.grudge.toFixed(2)}, fear ${rel.fear.toFixed(2)}`,
    ref: otherId,
  }];
  const bearing = Object.values(p.knowledge)
    .filter(k => k.claim.actor === otherId || k.claim.target === otherId || k.claim.responsibleId === otherId)
    .sort((a, b) => ((b.claim.significance ?? 0.3) * b.confidence) - ((a.claim.significance ?? 0.3) * a.confidence));
  const seen = new Set<string>();
  for (const k of bearing.slice(0, limit)) out.push(...explainBelief(world, p, k, seen, 1));
  return out;
}

/**
 * Render a chain as indented "X / because Y / because Z" lines — the shape the milestone's own
 * examples are written in.
 *
 * Indentation follows each node's own DEPTH, never its position in the list. That distinction is
 * the whole correctness of this function: a worry commonly rests on several independent beliefs,
 * and rendering those siblings as a descending chain silently asserts that each caused the next —
 * a fabricated causal claim, in the one tool whose job is to show what actually caused what.
 */
export function traceLines(nodes: CausalNode[]): string[] {
  return nodes.map(n => {
    const indent = '  '.repeat(Math.min(n.depth, 6));
    const head = n.depth === 0 ? '' : 'because ';
    const detail = [n.via, n.confidence !== undefined ? `confidence ${n.confidence}` : '', n.hops ? `${n.hops} hop${n.hops > 1 ? 's' : ''}` : '']
      .filter(Boolean).join(', ');
    return `${indent}${head}${n.what}${detail ? `  [${detail}]` : ''}`;
  });
}
