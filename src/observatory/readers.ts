import type { World } from '../sim/core/world';
import type { WorldEvent } from '../sim/core/types';
import { describeClaim } from '../sim/mind/knowledge';
import { formatWorldTime } from '../sim/core/time';
import { getPhysicalCapability } from '../sim/core/attributes';
import { isFood } from '../sim/world/factory';
import { underServedPosts } from '../sim/world/labor';
import { conversationReachable } from '../sim/mind/socialEvidence';
import { knownName } from '../sim/mind/people';
import { buildContext } from '../language/context';
import { experienceSummary } from '../sim/progression/experience';
import { personThreat } from '../sim/progression/threat';

export const EVENT_FILTERS = ['physical', 'work', 'economic', 'trade', 'social', 'communication', 'knowledge', 'combat', 'injury', 'lifecycle', 'wildlife', 'progression'] as const;
export function eventGroups(e: WorldEvent): string[] {
  const t = e.type, groups = new Set<string>();
  if (/arrived|moved|door|block_|path_|pickup|dropped/.test(t)) groups.add('physical');
  if (/work|haul|production|construct|resource_|crop_|procure/.test(t)) groups.add('work');
  if (/trade|bought|sold|paid|payment|purchase|wholesale/.test(t)) groups.add('trade');
  if (/trade|food_|water_|resource_|crop_|shortage|stock|debt|paid|production/.test(t)) groups.add('economic');
  if (/told|conversation|rumor|greeting|introduction|testimony/.test(t)) groups.add('communication');
  if (/knowledge|perceived|infer|belief|learn|read_record|taught/.test(t)) groups.add('knowledge');
  if (/attack|combat|conflict|yield|kill|arrest|theft|confront|rob/.test(t)) groups.add('combat');
  if (/injur|wound|heal|downed|attack/.test(t)) groups.add('injury');
  if (/birth|born|death|died|age|marriage|conceiv/.test(t)) groups.add('lifecycle');
  if (/animal|ecology|wildlife|hunt|butcher/.test(t)) groups.add('wildlife');
  if (/practice|skill|training|advanc|breakthrough|attribute|martial|level_|achievement/.test(t)) groups.add('progression');
  if (e.category === 'social' || /relationship|concern|pursuit|obligation|goal_/.test(t)) groups.add('social');
  if (!groups.size) groups.add(e.category === 'cognition' ? 'knowledge' : 'physical');
  return [...groups];
}
export const eventRow = (e: WorldEvent) => ({ id: e.id, tick: e.tick, time: formatWorldTime(e.tick), type: e.type, summary: e.summary, actor: e.actor, target: e.target, groups: eventGroups(e), causes: [...e.causes], perceived: e.perceivedBy.length });
export function inspectPerson(w: World, id: string) {
  const p = w.person(id); if (!p) return null;
  const bodies = p.bodies.flatMap(b => { const body = w.body(b); return body ? [body] : []; });
  const history = w.events.filter(e => e.actor === id || e.target === id || e.perceivedBy.some(s => s.who === id));
  const goal = p.mind.goal;
  const adoption = goal ? history.slice().reverse().find(e => e.actor === id && e.type === 'goal_changed' && e.data.key === goal.key && e.tick >= goal.createdAt) : undefined;
  return structuredClone({
    id, name: p.name,
    truth: {
      overview: { identity: p.id, name: p.name, age: p.age, occupation: p.occupation, alive: p.alive, bodyManifestations: bodies.map(b => ({ id: b.id, present: b.present, pos: b.pos, location: w.placeAt(b.pos)?.name ?? 'outdoors', activity: b.pose })) },
      physiology: { needs: p.needs, reserves: p.physiology, manifestations: bodies.map(b => ({ id: b.id, health: b.health, maxHealth: b.maxHealth, injuries: b.injuries ?? {}, sleepRest: b.pose, limitations: getPhysicalCapability(p, w, { body: b }) })) },
      mind: { goal: p.mind.goal, adoptionEvent: adoption ? eventRow(adoption) : null, plan: p.mind.plan, currentAction: p.mind.plan[0] ?? null, candidates: p.mind.decision, reports: p.mind.reports ?? {}, concerns: p.mind.concerns ?? [], pursuits: p.mind.pursuits ?? [], obligations: p.mind.obligations ?? [], motivation: p.mind.goal?.reasons ?? [] },
      relationships: Object.entries(p.relationships).map(([who, state]) => ({ id: who, name: w.nameOf(who), ...state, changes: history.filter(e => e.type === 'relationship_changed' && e.actor === id && e.target === who).slice(-6).map(eventRow) })),
      economy: { money: p.wealth, inventory: p.inventory.map(i => w.item(i)), owned: w.items().filter(i => i.ownerId === id), workplace: w.place(p.workId), household: w.get(p.householdId ?? ''), pressure: Object.values(p.knowledge).filter(k => /short|food|supply|work|debt/.test(k.key)).map(k => ({ belief: k.key, confidence: k.confidence })), productionRequests: w.requests.filter(r => JSON.stringify(r).includes(id)).slice(-12) },
      progression: { skills: p.skills, ontology: p.ontology, capability: p.capability, development: p.development,
        levels: experienceSummary(w, p), vessel: p.vessel ?? null, threat: personThreat(w, p) },
    },
    beliefs: Object.values(p.knowledge).sort((a, b) => b.learnedAt - a.learnedAt || a.key.localeCompare(b.key)).map(k => ({ ...k, description: describeClaim(w, k, p), learnedTime: formatWorldTime(k.learnedAt), sourceNameAsKnown: k.source.from ? knownName(p, k.source.from) : null,
      revisions: history.filter(e => /knowledge|belief|inferred/.test(e.type) && e.actor === id && (e.data.key === k.key || e.data.knowledgeKey === k.key)).slice(-8).map(eventRow) })),
    beliefLimits: 'These are beliefs, including mistakes. A missing revision or contradiction record means NOT REPRESENTED. Canonical event data belongs in the separate truth explorer.',
    memories: p.memories.slice(-40), history: history.slice(-100).reverse().map(eventRow),
    nearbySpeakers: w.persons().filter(other => conversationReachable(w, other, p)).map(other => ({ id: other.id, name: other.name })),
    language: buildContext(p),
  });
}

export function causalGraph(w: World, eventId: string, limit = 100) {
  const root = w.event(eventId); if (!root) return { nodes: [], edges: [], truncated: false, unknown: ['CAUSE UNKNOWN / NOT REPRESENTED: event not retained'] };
  const ids = new Set([root.id]), queue = [root.id], nodes: { id: string; label: string; tick?: number; missing: boolean }[] = [], edges: { from: string; to: string; label: string }[] = [];
  const children = new Map<string, WorldEvent[]>();
  for (const e of w.events) for (const cause of e.causes) { const list = children.get(cause) ?? []; list.push(e); children.set(cause, list); }
  let truncated = false;
  while (queue.length) {
    const id = queue.shift()!, e = w.event(id);
    nodes.push({ id, label: e?.summary ?? 'CAUSE UNKNOWN / NOT REPRESENTED (not retained)', tick: e?.tick, missing: !e });
    const links = [...(e?.causes ?? []).map(from => ({ from, to: id, next: from })), ...(children.get(id) ?? []).map(child => ({ from: id, to: child.id, next: child.id }))];
    for (const link of links) {
      if (!ids.has(link.next)) { if (ids.size >= limit) { truncated = true; continue; } ids.add(link.next); queue.push(link.next); }
      if (!edges.some(x => x.from === link.from && x.to === link.to)) edges.push({ from: link.from, to: link.to, label: 'stored event.causes' });
    }
  }
  return { nodes, edges, truncated, unknown: root.causes.length ? [] : ['CAUSE UNKNOWN / NOT REPRESENTED: this event stores no cause'] };
}
export function inspectEvent(w: World, id: string) {
  const e = w.event(id); return e ? structuredClone({ event: e, involved: [...new Set([e.actor, e.target, e.item, e.placeId].filter((x): x is string => !!x))].map(id => ({ id, name: w.nameOf(id), kind: w.get(id)?.kind })),
    perceivedBy: e.perceivedBy.map(p => ({ ...p, name: w.nameOf(p.who) })), graph: causalGraph(w, id),
    beliefs: w.persons().flatMap(p => Object.values(p.knowledge).filter(k => k.claim.eventId === id || k.source.viaEvent === id).map(k => ({ person: p.id, name: p.name, key: k.key, confidence: k.confidence, source: k.source }))) }) : null;
}

export interface Metric { key: string; label: string; value: number; unit: string; scope: string; evidence: { kind: string; id: string; label: string; value?: number }[] }
export function resourceState(w: World) {
  const stocks: Record<string, number> = {};
  for (const item of w.items()) stocks[item.type] = (stocks[item.type] ?? 0) + item.quantity;
  return { stocks, nodes: w.resourceNodes.map(n => ({ id: n.id, kind: n.kind, remaining: n.remaining, capacity: n.capacity })),
    currency: w.persons().reduce((n, p) => n + p.wealth, 0) + w.households().reduce((n, h) => n + h.wealth, 0) + (stocks.coins ?? 0),
    canonicalTallies: { ...w.runTally } };
}
export function settlementMetrics(w: World): Metric[] {
  const people = w.persons(), items = w.items();
  const events = (key: string, label: string, re: RegExp, amount?: (e: WorldEvent) => number): Metric => { const es = w.events.filter(e => re.test(e.type)); return { key, label, value: es.reduce((n, e) => n + (amount ? amount(e) : 1), 0), unit: amount ? 'units' : 'events', scope: 'Retained canonical events only; compaction can reduce this count', evidence: es.map(e => ({ kind: 'event', id: e.id, label: e.summary, value: amount ? amount(e) : 1 })) }; };
  const food = items.filter(i => isFood(i.type) && i.quantity > 0), injured = w.bodies().filter(b => !b.dead && b.health < b.maxHealth), posts = underServedPosts(w);
  return [
    { key: 'population', label: 'Living population', value: people.filter(p => p.alive).length, unit: 'people', scope: 'Current canonical people', evidence: people.filter(p => p.alive).map(p => ({ kind: 'person', id: p.id, label: p.name })) },
    { key: 'food', label: 'Food stock', value: food.reduce((n, i) => n + i.quantity, 0), unit: 'item units', scope: 'Edible items; units differ by type', evidence: food.map(i => ({ kind: 'item', id: i.id, label: `${i.name} · ${i.type}`, value: i.quantity })) },
    { key: 'resources', label: 'Resource nodes', value: w.resourceNodes.length, unit: 'nodes', scope: 'Inspect quantities separately; resource units are not summed', evidence: w.resourceNodes.map(n => ({ kind: 'resource', id: n.id, label: `${n.kind}: ${n.remaining} / ${n.capacity}`, value: n.remaining })) },
    { key: 'stress', label: 'Households under pressure', value: w.households().filter(h => h.memberIds.some(id => (w.person(id)?.needs.hunger ?? 0) > .7 || (w.person(id)?.needs.thirst ?? 0) > .7)).length, unit: 'households', scope: 'At least one member hunger or thirst > 0.7; observation threshold', evidence: w.households().filter(h => h.memberIds.some(id => (w.person(id)?.needs.hunger ?? 0) > .7 || (w.person(id)?.needs.thirst ?? 0) > .7)).flatMap(h => h.memberIds.map(id => ({ kind: 'person', id, label: `${h.name}: ${w.nameOf(id)}` }))) },
    { key: 'labor', label: 'Labor shortages', value: posts.length, unit: 'posts', scope: 'Existing underServedPosts: demand, capability and output', evidence: posts.map(p => ({ kind: 'place', id: p.place.id, label: p.place.name })) },
    { key: 'injuries', label: 'Injured manifestations', value: injured.length, unit: 'bodies', scope: 'Current health below maximum', evidence: injured.map(b => ({ kind: 'person', id: b.ownerId, label: `${w.nameOf(b.ownerId)} · ${b.id}: ${b.health}/${b.maxHealth}` })) },
    { key: 'wildlife', label: 'Embodied wildlife', value: w.creatures().filter(c => c.wildlife).length, unit: 'creatures', scope: 'Wildlife records, including retained dead individuals', evidence: w.creatures().filter(c => c.wildlife).map(c => ({ kind: 'entity', id: c.id, label: c.name })) },
    events('production', 'Production / work output', /resource_transformed|mechanism_worked|crop_harvested|construction_progress/),
    events('consumption', 'Consumption', /food_consumed|water_consumed/), events('trade', 'Trade activity', /trade|bought|sold|wholesale|purchase/),
    events('births', 'Births', /^(birth|animal_born)$/), events('deaths', 'Deaths', /^(death|animal_died)$/),
    events('conflict', 'Crime / conflict', /theft|attack|robbery|confrontation|arrest/), events('knowledge', 'Knowledge propagation', /knowledge_gained|told|institutional_report/),
    events('progression', 'Training / progression', /skill|practice|training|advanc|breakthrough/), events('shortages', 'Shortage observations', /shortage|work_blocked|haul_failed/),
    { key: 'events', label: 'Retained event growth', value: w.events.length, unit: 'events', scope: 'Current retained log; not a duplicate lifetime counter', evidence: w.events.map(e => ({ kind: 'event', id: e.id, label: e.summary })) },
  ];
}

export function worldOverview(w: World) {
  return structuredClone({ time: formatWorldTime(w.now), tick: w.now, physicalTime: w.physicalTime, seed: w.seed, eventCount: w.events.length,
    entities: w.persons().map(p => ({ id: p.id, name: p.name, occupation: p.occupation, alive: p.alive, goal: p.mind.goal?.type ?? 'none', beliefs: Object.keys(p.knowledge).length,
      bodies: p.bodies.flatMap(id => { const b = w.body(id); return b ? [{ id, pos: b.pos, present: b.present, pose: b.pose }] : []; }) })),
    places: w.places().map(p => ({ id: p.id, name: p.name, type: p.type, bounds: p.bounds })),
    animals: w.creatures().flatMap(c => c.bodies.flatMap(id => { const b = w.body(id); return b ? [{ id: c.id, name: c.name, pos: b.pos, dead: b.dead }] : []; })),
    metrics: settlementMetrics(w).map(({ evidence, ...m }) => ({ ...m, evidenceCount: evidence.length })),
  });
}
