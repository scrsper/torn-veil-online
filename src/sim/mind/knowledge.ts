import type { Person, KnowledgeItem, Source, EntityId, WorldEvent, Vec3 } from '../core/types';
import { World } from '../core/world';

/**
 * Knowledge is what a mind believes about the world, always tagged with how it was learned.
 * Objective reality lives in the World; knowledge may be incomplete, second-hand, or wrong.
 */
export function learn(world: World, p: Person, k: { key: string; kind: KnowledgeItem['kind']; claim: Record<string, any>; confidence: number; source: Source; hops?: number; summary?: string; cause?: string }, quiet = false): KnowledgeItem | null {
  const existing = p.knowledge[k.key];
  if (existing) {
    // Upgrade only if this source is more reliable (fewer hops / higher confidence)
    if (k.confidence <= existing.confidence + 0.05 && (k.hops ?? 0) >= existing.hops) return null;
    existing.confidence = Math.max(existing.confidence, k.confidence); existing.hops = Math.min(existing.hops, k.hops ?? 0);
    if ((k.hops ?? 0) < existing.hops || k.source.type === 'witnessed') existing.source = k.source;
    return null;
  }
  const item: KnowledgeItem = { key: k.key, kind: k.kind, claim: k.claim, confidence: k.confidence, learnedAt: world.now, source: k.source, hops: k.hops ?? 0, sharedWith: [] };
  p.knowledge[k.key] = item;
  if (!quiet) {
    const via = k.source.type === 'told' ? `told by ${world.nameOf(k.source.from)}` : k.source.type;
    world.emit('knowledge_gained', { actor: p.id, causes: k.cause ? [k.cause] : (k.source.viaEvent ? [k.source.viaEvent] : []), significance: Math.min(0.5, (k.claim.significance ?? 0.3) * 0.7), data: { key: k.key, source: k.source.type, from: k.source.from, hops: item.hops, confidence: k.confidence }, summary: `${p.name} now knows (${via}, ${item.hops === 0 ? 'first-hand' : `${item.hops} hop${item.hops > 1 ? 's' : ''}`}): ${k.summary ?? k.key}` });
  }
  return item;
}

export function knowsEvent(p: Person, eventId: string): KnowledgeItem | undefined { return p.knowledge[`ev:${eventId}`]; }

/** Build the knowledge claim for an event as a witness would understand it. */
export function eventClaim(world: World, e: WorldEvent, saw: boolean): Record<string, any> {
  const claim: Record<string, any> = { eventId: e.id, type: e.type, tick: e.tick, placeId: e.placeId, pos: e.pos, significance: e.significance };
  if (saw || e.type === 'told') { claim.actor = e.actor; claim.target = e.target; claim.item = e.item; }
  else { claim.target = e.target; claim.item = e.item; claim.actorUnknown = true; if (e.type === 'attack' || e.type === 'kill') claim.actor = e.actor; }
  return claim;
}

export function describeClaim(world: World, k: KnowledgeItem): string {
  const c = k.claim;
  const who = (id: string | undefined, unknown?: boolean) => unknown ? 'someone' : id ? world.nameOf(id) : 'someone';
  switch (k.kind) {
    case 'event': {
      const where = c.placeId ? ` at ${world.nameOf(c.placeId)}` : '';
      switch (c.type) {
        case 'attack': return `${who(c.actor, c.actorUnknown)} attacked ${who(c.target)}${where}`;
        case 'kill': return `${who(c.actor, c.actorUnknown)} killed ${who(c.target)}${where}`;
        case 'theft': return `${who(c.actor, c.actorUnknown)} stole ${c.item ? world.nameOf(c.item) : 'something'} from ${who(c.target)}${where}`;
        case 'item_missing': return `${c.item ? world.nameOf(c.item) : 'an item'} has gone missing from ${where || 'its place'}`;
        case 'gift': return `${who(c.actor)} gave ${c.item ? world.nameOf(c.item) : 'a gift'} to ${who(c.target)}`;
        case 'returned_item': return `${who(c.actor)} returned ${c.item ? world.nameOf(c.item) : 'an item'} to ${who(c.target)}`;
        case 'death': return `${who(c.target)} died${where}`;
        case 'debt': return `${who(c.actor)} owes ${who(c.target)} ${c.amount ?? 'money'} silver`;
        case 'dispute': return `${who(c.actor)} and ${who(c.target)} quarrelled${c.about ? ` over ${c.about}` : ''}`;
        case 'marriage': return `${who(c.actor)} married ${who(c.target)}`;
        case 'rumor': return c.text ?? 'a rumour';
        case 'heal': return `${who(c.actor)} tended to ${who(c.target)}`;
        case 'apology': return `${who(c.actor)} apologised to ${who(c.target)}`;
        case 'debt_paid': return `${who(c.actor)} paid ${who(c.target)} what was owed`;
        case 'threat_spotted': return `${who(c.actor)} was seen prowling${where}`;
        case 'confrontation': return `${who(c.actor)} confronted ${who(c.target)}${where}`;
        case 'arrest_attempt': return `${who(c.actor)} tried to arrest ${who(c.target)}${where}`;
        default: return c.text ?? `${c.type}${where}`;
      }
    }
    case 'location': return `${world.nameOf(c.entityId)} is at ${c.placeId ? world.nameOf(c.placeId) : `(${Math.round(c.pos?.x)}, ${Math.round(c.pos?.z)})`}`;
    case 'ownership': return `${world.nameOf(c.itemId)} belongs to ${world.nameOf(c.ownerId)}`;
    case 'state': return c.text ?? `${world.nameOf(c.entityId)} is ${c.state}`;
    case 'fact': return c.text ?? k.key;
  }
}

export function locationKnowledge(world: World, p: Person, entityId: EntityId, pos: Vec3, source: Source): void {
  const key = `loc:${entityId}`; const place = world.placeAt(pos);
  const ex = p.knowledge[key];
  if (ex) { ex.claim = { entityId, pos: { ...pos }, placeId: place?.id }; ex.learnedAt = world.now; ex.confidence = 1; ex.source = source; ex.hops = 0; return; }
  p.knowledge[key] = { key, kind: 'location', claim: { entityId, pos: { ...pos }, placeId: place?.id }, confidence: 1, learnedAt: world.now, source, hops: 0, sharedWith: [] };
}
export function isCrime(type: string): boolean { return type === 'attack' || type === 'kill' || type === 'theft'; }
export function crimeSeverity(type: string): number { return type === 'kill' ? 1 : type === 'attack' ? 0.6 : type === 'theft' ? 0.35 : 0; }
