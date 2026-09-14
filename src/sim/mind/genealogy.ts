import { knownName } from './people';
import type { Goal, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import { peopleTogether } from '../world/locality';
import { learn } from './knowledge';

export interface GenealogyClaim { subjectId: string; relativeId: string; relationship: 'parent' | 'ancestor' | 'possible_kin'; distance?: number }
export const genealogyKey = (g: GenealogyClaim) => `genealogy:${g.subjectId}:${g.relationship}:${g.relativeId}`;
export const genealogicalBeliefs = (p: Person): KnowledgeItem[] => Object.values(p.knowledge).filter(k => k.claim.genealogy);

/** Birth supplies evidence to the adults involved, never an infant's ancestry memory. */
export function witnessParenthood(world: World, parent: Person, other: Person, child: Person, eventId: string): void {
  for (const witness of [parent, other]) {
    if (!witness.alive || (witness !== parent && !peopleTogether(world, parent, witness))) continue;
    for (const relative of [parent, other]) {
      const genealogy: GenealogyClaim = { subjectId: child.id, relativeId: relative.id, relationship: 'parent', distance: 1 };
      learn(world, witness, { key: genealogyKey(genealogy), kind: 'fact', claim: { genealogy, actor: child.id, target: relative.id, significance: 0.6 },
        confidence: relative === parent ? 0.95 : 0.8, source: { type: 'self', viaEvent: eventId } }, true);
    }
  }
}

/** Infer only across edges already in this mind. Each claim preserves both premises and their
 * actual sources; conflicting parents remain competing claims. No parentIds/world-tree query. */
export function inferGenealogy(world: World, p: Person): void {
  if (p.age < 3) return;
  const known = genealogicalBeliefs(p), edges = known.filter(k => ['parent', 'ancestor'].includes(k.claim.genealogy.relationship));
  const bySubject = new Map<string, KnowledgeItem[]>();
  for (const k of edges) { const id = k.claim.genealogy.subjectId; const list = bySubject.get(id) ?? []; list.push(k); bySubject.set(id, list); }
  let added = 0, inspected = 0;
  for (const first of edges.filter(k => k.claim.genealogy.subjectId === p.id)) {
    const a = first.claim.genealogy as GenealogyClaim;
    for (const second of bySubject.get(a.relativeId) ?? []) {
      if (++inspected > 32) return;
      const b = second.claim.genealogy as GenealogyClaim, distance = (a.distance ?? 1) + (b.distance ?? 1);
      if (distance > 6 || b.relativeId === p.id) continue;
      const genealogy: GenealogyClaim = { subjectId: p.id, relativeId: b.relativeId, relationship: 'ancestor', distance };
      const key = genealogyKey(genealogy); if (p.knowledge[key]) continue;
      const causes = [...new Set([first.source.viaEvent, second.source.viaEvent].filter((x): x is string => !!x))];
      const ev = world.emit('genealogy_inferred', { actor: p.id, causes, category: 'cognition', significance: 0.4,
        data: { premises: [first.key, second.key], genealogy }, summary: `${p.name} connected two pieces of family evidence` });
      learn(world, p, { key, kind: 'fact', claim: { genealogy, actor: p.id, target: b.relativeId, premises: [first.key, second.key], sources: [first.source, second.source] },
        confidence: Math.min(first.confidence, second.confidence) * 0.85, source: { type: 'inferred', viaEvent: ev.id }, hops: Math.max(first.hops, second.hops), cause: ev.id }, true);
      if (++added >= 2) return;
    }
  }
}

/** Names are public social evidence after an actual encounter. Never a certified cousin edge. */
export function inferSurnameKin(world: World, p: Person, other: Person): void {
  if (p.age < 8 || !peopleTogether(world, p, other) || !(p.relationships[other.id]?.familiarity)) return;
  if (!p.knowledge[`identity:${other.id}`]) return;
  const surname = (x: Person) => knownName(p, x.id).trim().split(/\s+/).at(-1);
  if (surname(p) !== surname(other)) return;
  const genealogy: GenealogyClaim = { subjectId: p.id, relativeId: other.id, relationship: 'possible_kin' };
  const key = genealogyKey(genealogy); if (p.knowledge[key]) return;
  const ev = world.emit('genealogy_inferred', { actor: p.id, target: other.id, category: 'cognition', significance: 0.1,
    data: { basis: 'shared surname during social encounter', surname: surname(p) }, summary: `${p.name} wondered about a shared surname` });
  learn(world, p, { key, kind: 'fact', claim: { genealogy, actor: p.id, target: other.id }, confidence: 0.2, source: { type: 'inferred', viaEvent: ev.id }, cause: ev.id }, true);
}

/** Ordinary social exposure offers testimony as a competing goal, with no mind-reading.
 * A newborn cannot understand it; a nearby child may learn as relatives actually talk. */
export function genealogyGoals(world: World, p: Person): Partial<Goal>[] {
  inferGenealogy(world, p);
  const goals: Partial<Goal>[] = [];
  // No beliefs change while offering these goals. Derive once per deliberation instead
  // of allocating/scanning the whole knowledge collection for every nearby person.
  const known = genealogicalBeliefs(p);
  if (!known.length) return goals;
  for (const percept of p.mind.percepts) {
    const other = world.person(percept.entityId);
    if (!other?.alive || other.age < 3 || percept.how !== 'saw' || percept.distance > 3 || !peopleTogether(world, p, other)) continue;
    for (const k of known) {
      const g = k.claim.genealogy as GenealogyClaim;
      if (k.sharedWith.includes(other.id) || ![p.id, other.id].includes(g.subjectId)) continue;
      const rel = p.relationships[other.id];
      const utility = 0.1 + p.traits.sociability * 0.2 + Math.max(0, rel?.affection ?? 0) * 0.25;
      goals.push({ type: 'share_family', utility, targetEntity: other.id, data: { key: k.key }, causeEvent: k.source.viaEvent,
        reasons: ['a nearby relative can understand family testimony', 'affection and sociability'] });
      if (goals.length >= 2) return goals;
    }
  }
  return goals;
}
