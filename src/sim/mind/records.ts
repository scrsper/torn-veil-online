import { learnIdentity, interpretSocial } from './people';
import type { Action, Goal, Item, KnowledgeItem, Person } from '../core/types';
import type { World } from '../core/world';
import { getPhysicalCapability } from '../core/attributes';
import { makeItem, RESOURCE_MASS_KG } from '../world/factory';
import { stockItemsAt, retireStack, outboundStock } from '../world/stock';
import { distance, mayUseProperty, owns, reachable } from '../kernel/mechanics';
import { learn } from './knowledge';
import { cognitiveCapability } from '../core/human';
import { developThroughUnderstanding } from '../core/development';

export const MECHANICAL_NOTATION = 'workshop-diagrams';
export const RECORD_MASS_KG = 0.5;
export function teachNotation(world: World, p: Person): void {
  learn(world, p, { key: `notation:${MECHANICAL_NOTATION}`, kind: 'technique', claim: { notation: MECHANICAL_NOTATION }, confidence: 0.9, source: { type: 'prior' } }, true);
}
export function knowsNotation(p: Person, notation: string): boolean {
  return Object.values(p.knowledge).some(k => k.claim.notation === notation && k.confidence > 0.2);
}
export const intactRecord = (i: Item) => !!i.record && i.quantity > 0 && (i.condition ?? 1) > 0.2;

/** Possession gives physical access even to stolen writing; rightful ownership stays intact.
 * A record lying at work is readable by the owner's assigned workers, never remotely. */
export function canReadRecord(world: World, p: Person, i: Item): boolean {
  const owner = world.person(i.ownerId);
  const householdAccess = i.placeId === p.homeId && !!p.householdId && owner?.householdId === p.householdId;
  return p.age >= 8 && intactRecord(i) && knowsNotation(p, i.record!.notation)
    && (i.holderId === p.id ? p.bodies.some(id => { const b = world.body(id); return !!b?.present && !b.dead && reachable(world, p, b.pos); })
      : !i.holderId && !!i.pos && reachable(world, p, i.pos) && (householdAccess || mayUseProperty(world, p, i.ownerId, i.placeId ?? undefined)));
}
export function localRecords(world: World, p: Person): Item[] {
  const found = new Map<string, Item>();
  for (const b of p.bodies.map(id => world.body(id)).filter((b): b is NonNullable<typeof b> => !!b?.present && !b.dead))
    for (const i of world.nearbyItems(b.pos, 3)) if (canReadRecord(world, p, i)) found.set(i.id, i);
  for (const id of p.inventory) { const i = world.item(id); if (i && canReadRecord(world, p, i)) found.set(id, i); }
  return [...found.values()];
}
function writingStock(world: World, p: Person, placeId: string): Item[] {
  const place = world.place(placeId);
  if (!place || !reachable(world, p, place.inside) || !mayUseProperty(world, p, place.ownerId, placeId)) return [];
  return stockItemsAt(world, 'plank', placeId).filter(i => owns(p, i.ownerId) && i.pos && reachable(world, p, i.pos));
}
function hasSubstrate(world: World, p: Person, placeId: string): boolean {
  return writingStock(world, p, placeId).reduce((n, i) => n + i.quantity, 0) - outboundStock(world, 'plank', placeId) >= RECORD_MASS_KG / RESOURCE_MASS_KG.plank!;
}
const snapshot = (k: KnowledgeItem): NonNullable<Item['record']>['knowledge'] => structuredClone({ key: k.key, kind: k.kind, claim: k.claim, confidence: k.confidence, source: k.source, hops: k.hops });

/** Interruptible physical labor. The action is saved by the ordinary plan serializer. A copy
 * snapshots the accessible source, including mistakes; no lookup of a certified method. */
export function actOnRecord(world: World, p: Person, action: Action, seconds: number): void {
  if (action.status === 'done' || action.status === 'failed') return;
  const data = action.data ??= {};
  const source = world.item(data.recordId);
  const reading = action.type === 'read_record', copying = action.type === 'copy_record';
  const held = p.knowledge[data.key] as KnowledgeItem | undefined;
  const capacity = getPhysicalCapability(p, world).currentExertionCapacity;
  if (!p.alive || p.age < 8 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60 || capacity <= 0.15
    || ((reading || copying) && (!source || !canReadRecord(world, p, source)))
    || (!reading && (!hasSubstrate(world, p, action.placeId!) || !knowsNotation(p, MECHANICAL_NOTATION)))
    || (!reading && !copying && !held?.claim.method && !held?.claim.genealogy && !held?.claim.identity && !held?.claim.martialTechnique)) { action.status = 'failed'; return; }
  const required = reading ? 4 : 12;
  const rate = capacity * (reading ? cognitiveCapability(p).reasoning : 0.5 + (p.skills.crafting ?? 0));
  const spent = Math.min(seconds, Math.max(0, required - (data.progress ?? 0)) / rate);
  data.progress = (data.progress ?? 0) + spent * rate; data.laborSeconds = (data.laborSeconds ?? 0) + spent;
  if (data.progress < required - 1e-9) return;
  if (reading) {
    const record = source!.record!, k = record.knowledge;
    const ev = world.emit('record_read', { actor: p.id, item: source!.id, placeId: source!.placeId ?? undefined, pos: world.positionOf(p.id),
      category: 'history', significance: 0.65, visibility: 4, causes: [...new Set([record.eventId, ...source!.provenance.flatMap(v => v.eventId ? [v.eventId] : [])])],
      data: { key: k.key, authorId: record.authorId, laborSeconds: data.laborSeconds }, summary: `${p.name} studied a physical record` });
    const acquired = learn(world, p, { ...structuredClone(k), confidence: Math.min(0.8, k.confidence) * (source!.condition ?? 1),
      source: { type: 'read', from: source!.id, viaEvent: ev.id }, hops: k.hops + 1, cause: ev.id });
    if (acquired) interpretSocial(world, p, acquired);
    if (k.claim.identity) learnIdentity(world, p, k.claim.identity.subject, k.claim.identity.name, { type: 'read', from: source!.id, viaEvent: ev.id }, Math.min(0.8, k.confidence) * (source!.condition ?? 1));
    if (acquired && k.claim.method) developThroughUnderstanding(world, p, k.key, k.claim.method.connections.length + 1, data.laborSeconds, ev.id);
    if (acquired && k.claim.martialTechnique) developThroughUnderstanding(world, p, k.key, k.claim.complexity ?? 1, data.laborSeconds, ev.id);
  } else {
    const k = copying ? structuredClone(source!.record!.knowledge) : snapshot(held!);
    let remaining = RECORD_MASS_KG / RESOURCE_MASS_KG.plank!;
    const consumed: { itemId: string; quantity: number }[] = [];
    const causes = [copying ? source!.record!.eventId : k.source.viaEvent].filter((s): s is string => !!s);
    for (const i of writingStock(world, p, action.placeId!).sort((a, b) => a.id.localeCompare(b.id))) {
      const take = Math.min(i.quantity, remaining); if (take <= 0) continue;
      remaining -= take; i.quantity -= take; consumed.push({ itemId: i.id, quantity: take });
      const origin = i.provenance.at(-1)?.eventId; if (origin) causes.push(origin);
      if (i.quantity <= 1e-9) retireStack(world, i);
    }
    const place = world.place(action.placeId)!;
    const family = !!k.claim.genealogy;
    const item = makeItem(world, 'book', k.claim.martialTechnique ? 'Carved martial manual' : family ? 'Carved family testimony' : 'Carved workshop notes', { owner: p.id, placeId: place.id, pos: place.inside, condition: 1, named: true,
      description: family ? 'A wooden tablet of family testimony; its claims may be wrong.' : 'A wooden tablet of practical diagrams; its claims may be wrong.' });
    const ev = world.emit(copying ? 'record_copied' : 'record_written', { actor: p.id, item: item.id, placeId: place.id, pos: place.inside,
      category: 'history', visibility: 6, significance: 0.7, causes: [...new Set(causes)], data: { key: k.key, copiedFrom: source?.id, consumed, substrateKg: RECORD_MASS_KG, laborSeconds: data.laborSeconds },
      summary: `${p.name} ${copying ? 'copied' : 'inscribed'} practical instructions in wood` });
    item.record = { notation: copying ? source!.record!.notation : MECHANICAL_NOTATION, authorId: copying ? source!.record!.authorId : p.id,
      eventId: ev.id, copiedFrom: copying ? source!.id : undefined, knowledge: k, substrateKg: RECORD_MASS_KG };
    item.provenance.push({ tick: world.now, eventId: ev.id, from: null, to: p.id, how: copying ? 'copied inscription' : 'inscription' });
  }
  action.status = 'done';
}

/** Curiosity and a shared practice context compete with hunger, wages and other goals.
 * Two local copies are a bounded preference, not a preservation service or global audit. */
export function recordGoals(world: World, p: Person): Partial<Goal>[] {
  if (p.age < 8 || !knowsNotation(p, MECHANICAL_NOTATION)) return [];
  const records = localRecords(world, p), goals: Partial<Goal>[] = [];
  for (const item of records) {
    const k = item.record!.knowledge;
    const existing = p.knowledge[k.key];
    const relevant = item.placeId === p.workId || item.placeId === p.homeId;
    if (!existing || existing.confidence < k.confidence * (item.condition ?? 1) - 0.1)
      goals.push({ type: 'study_record', utility: 0.15 + p.traits.curiosity * 0.3 + (relevant ? 0.2 : 0), targetEntity: item.id,
        data: { recordId: item.id }, causeEvent: item.record!.eventId, reasons: ['physically accessible intelligible instructions', 'curiosity and relevance to daily practice'] });
  }
  const place = [world.place(p.workId), world.place(p.homeId)].find(pl => pl && hasSubstrate(world, p, pl.id));
  if (!place) return goals;
  for (const k of Object.values(p.knowledge).filter(k => (k.claim.method || k.claim.genealogy || k.claim.martialTechnique) && k.confidence > 0.4)) {
    const copies = records.filter(i => i.record!.knowledge.key === k.key && i.placeId === place.id);
    if (copies.length >= 2 || copies.some(i => i.ownerId === p.id)) continue;
    const source = copies[0];
    goals.push({ type: 'record_method', utility: 0.2 + p.traits.curiosity * 0.3 + p.traits.sociability * 0.12 + (place.id === p.workId ? 0.12 : 0),
      targetPlace: place.id, data: { key: k.key, recordId: source?.id }, causeEvent: source?.record!.eventId ?? k.source.viaEvent,
      reasons: ['useful instructions can be kept at the place of practice', 'available wood and time compete with other needs'] });
  }
  return goals;
}
export function recordPlan(world: World, g: Goal): Action[] {
  if (g.type === 'study_record') return [{ type: 'read_record', status: 'pending', data: { recordId: g.data?.recordId } }];
  const place = world.place(g.targetPlace); if (!place) return [];
  return [{ type: 'goto', pos: place.inside, status: 'pending' }, { type: g.data?.recordId ? 'copy_record' : 'write_record', placeId: place.id, status: 'pending', data: { ...g.data } }];
}

/** Destruction leaves physical ruined substrate and historical evidence, but no readable
 * source. Called by physical damage, never by a history reader. */
export function damageRecord(world: World, item: Item, damage: number, cause?: string): boolean {
  if (!intactRecord(item) || !Number.isFinite(damage) || damage <= 0) return false;
  item.condition = Math.max(0, (item.condition ?? 1) - damage);
  if (intactRecord(item)) return false;
  const ev = world.emit('record_destroyed', { item: item.id, placeId: item.placeId ?? undefined, pos: item.pos ?? undefined, category: 'history', visibility: 6, significance: 0.75,
    causes: [...new Set([item.record!.eventId, ...(cause ? [cause] : [])])], data: { key: item.record!.knowledge.key, substrateKg: item.record!.substrateKg }, summary: `The instructions on ${item.name} became unreadable` });
  item.provenance.push({ tick: world.now, eventId: ev.id, from: item.ownerId, to: item.ownerId, how: 'inscription destroyed; substrate remains' });
  return true;
}
export function weatherRecords(world: World, worldSeconds: number): void {
  for (const i of world.items()) {
    if (!intactRecord(i) || i.holderId || !i.pos) continue;
    const fire = world.fires.find(f => f.lit && f.intensity > 0 && distance(f.pos, i.pos!) < 1.5);
    if (fire) {
      const cause = [...world.events].reverse().find(e => e.type === 'fire_lit' && e.data.fireId === fire.id)?.id;
      damageRecord(world, i, worldSeconds * fire.intensity / 3600, cause);
    } else if (!world.place(i.placeId)?.indoor && ['rain', 'storm'].includes(world.weather.kind)) {
      damageRecord(world, i, worldSeconds * world.weather.intensity / (7 * 86400), [...world.events].reverse().find(e => e.type === 'weather')?.id);
    }
  }
}
