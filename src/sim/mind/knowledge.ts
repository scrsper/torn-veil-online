import type { Person, KnowledgeItem, Source, EntityId, WorldEvent, Vec3 } from '../core/types';
import { World } from '../core/world';

/**
 * Knowledge is what a mind believes about the world, always tagged with how it was learned.
 * Objective reality lives in the World; knowledge may be incomplete, second-hand, or wrong.
 */
export function learn(world: World, p: Person, k: { key: string; kind: KnowledgeItem['kind']; claim: Record<string, any>; confidence: number; source: Source; hops?: number; summary?: string; cause?: string }, quiet = false): KnowledgeItem | null {
  const existing = p.knowledge[k.key];
  if (existing) {
    const incomingHops = k.hops ?? 0;
    const refinement = refinesClaim(existing.claim, k.claim);
    const correction = correctsClaim(existing.claim, k.claim);
    const betterConfidence = k.confidence > existing.confidence + 0.05;
    const betterHops = incomingHops < existing.hops;
    const betterSource = sourceRank(k.source) > sourceRank(existing.source);
    if (!refinement && !betterConfidence && !betterHops && !betterSource) return null;

    if (refinement || correction || betterConfidence || betterHops || betterSource) existing.claim = mergeClaim(existing.claim, k.claim);
    existing.confidence = Math.max(existing.confidence, k.confidence);
    // A more specific claim may legitimately come through an extra hop. Its provenance must
    // describe the evidence responsible for the refinement rather than pretending it was heard.
    if (refinement || betterSource || (betterHops && k.confidence >= existing.confidence - 0.1) || betterConfidence) {
      existing.source = { ...k.source };
      existing.hops = incomingHops;
    }
    existing.learnedAt = world.now;
    if (refinement || correction) existing.sharedWith = [];
    if (!quiet) emitKnowledge(world, p, existing, k.summary ?? k.key, k.cause, true);
    return existing;
  }
  const item: KnowledgeItem = { key: k.key, kind: k.kind, claim: k.claim, confidence: k.confidence, learnedAt: world.now, source: k.source, hops: k.hops ?? 0, sharedWith: [] };
  p.knowledge[k.key] = item;
  pruneKnowledge(world, p);
  if (!quiet) emitKnowledge(world, p, item, k.summary ?? k.key, k.cause, false);
  return item;
}

/**
 * v0.2.1 Priority 9 (long-running throughput). `Person.knowledge` had no bound at all — every
 * witnessed event, every heard rumor, every learned location added a permanent entry, unlike
 * `Person.memories` (mind/memory.ts's own MAX_MEMORIES=60, same "computational pragmatism"
 * reasoning). Several hot-path scans read a mind's ENTIRE knowledge map every think() tick
 * (`Object.values(p.knowledge).filter(...)` in mind/agent.ts's think(), knownCrimesBy(), and
 * the gossip-sharing candidate scan in maybeChat()), so as knowledge accumulated across a long
 * run this cost grew with it — measured directly as the dominant driver behind a 30-day
 * headless benchmark (seed 918271) becoming clearly superlinear (marginal per-day wall-clock
 * cost climbing roughly 51s -> 112s -> 188s -> 280s across four ~5-day windows before the run
 * was stopped, rather than the flat per-day cost a bounded-state simulation should have).
 *
 * Mirrors memory.ts's own eviction: prune only after growing past a generous cap (so no
 * realistic short/medium run — including every test in this suite — is ever affected), keeping
 * whatever scores highest by confidence, claimed significance, and recency, with an explicit
 * bonus for an UNRESOLVED crime report (Constitution §11/§37: a guard's ability to eventually
 * act on a known crime must not be silently lost to a cache eviction before it's ever
 * `handled`). This is purely a memory/perf bound — like event compaction, it does not change
 * WHICH claims a mind currently holds until the cap is actually exceeded, and pruning always
 * removes the least-valuable entries first, never the ones currently relevant to a decision.
 */
const MAX_KNOWLEDGE = 400;
function knowledgeScore(k: KnowledgeItem, now: number): number {
  const ageDays = (now - k.learnedAt) / 86400;
  const unresolvedCrime = k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled;
  return k.confidence * (1 + (k.claim.significance ?? 0.2)) + (unresolvedCrime ? 2 : 0) - ageDays * 0.01;
}
function pruneKnowledge(world: World, p: Person): void {
  const keys = Object.keys(p.knowledge);
  if (keys.length <= MAX_KNOWLEDGE) return;
  const now = world.now;
  keys.sort((a, b) => knowledgeScore(p.knowledge[b], now) - knowledgeScore(p.knowledge[a], now));
  for (const key of keys.slice(MAX_KNOWLEDGE)) delete p.knowledge[key];
}

function sourceRank(source: Source): number {
  switch (source.type) {
    case 'self': case 'witnessed': return 5;
    case 'heard': return 4;
    case 'told': return 3;
    case 'prior': return 2;
    case 'inferred': return 1;
  }
}

function refinesClaim(current: Record<string, any>, incoming: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (key.endsWith('Unknown')) continue;
    if ((current[key] === undefined || current[key] === null) && value !== undefined) return true;
    if (current[`${key}Unknown`] === true) return true;
  }
  return false;
}

function correctsClaim(current: Record<string, any>, incoming: Record<string, any>): boolean {
  return Object.entries(incoming).some(([key, value]) => !key.endsWith('Unknown') && value !== undefined && value !== null && current[key] !== undefined && JSON.stringify(current[key]) !== JSON.stringify(value));
}

function mergeClaim(current: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (key.endsWith('Unknown') && value === true) {
      const field = key.slice(0, -'Unknown'.length);
      if (merged[field] !== undefined && merged[field] !== null) continue;
    }
    merged[key] = value;
    if (!key.endsWith('Unknown')) delete merged[`${key}Unknown`];
  }
  return merged;
}

function emitKnowledge(world: World, p: Person, item: KnowledgeItem, summary: string, cause: string | undefined, upgraded: boolean): void {
  const via = item.source.type === 'told' ? `told by ${world.nameOf(item.source.from)}` : item.source.type;
  world.emit('knowledge_gained', {
    actor: p.id,
    causes: cause ? [cause] : (item.source.viaEvent ? [item.source.viaEvent] : []),
    significance: Math.min(0.5, (item.claim.significance ?? 0.3) * 0.7),
    data: { key: item.key, source: item.source.type, from: item.source.from, hops: item.hops, confidence: item.confidence, upgraded },
    summary: `${p.name} ${upgraded ? 'refined what they know' : 'now knows'} (${via}, ${item.hops === 0 ? 'first-hand' : `${item.hops} hop${item.hops > 1 ? 's' : ''}`}): ${summary}`,
  });
}

export function knowsEvent(p: Person, eventId: string): KnowledgeItem | undefined { return p.knowledge[`ev:${eventId}`]; }

/** Build the knowledge claim for an event as a witness would understand it. */
export function eventClaim(world: World, e: WorldEvent, saw: boolean): Record<string, any> {
  const claim: Record<string, any> = { eventId: e.id, type: e.type, tick: e.tick, placeId: e.placeId, pos: e.pos, significance: e.significance };
  // Carry explicit conflict intent (Constitution §11) into the claim so a witness can tell a
  // guard's lawful subdual/arrest apart from an actual crime — see isCrime below.
  if (e.data?.intent) claim.intent = e.data.intent;
  if (saw || e.type === 'told') { claim.actor = e.actor; claim.target = e.target; claim.item = e.item; }
  else { claim.target = e.target; claim.item = e.item; claim.actorUnknown = true; }
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
  pruneKnowledge(world, p);
}
// Conflict intents that represent lawful or defensive force rather than criminal aggression
// (Constitution §11: hostile force is not automatically a crime, and a guard's own arrest
// cannot be indistinguishable from the crime it's answering — without this, every witnessed
// subdual/arrest was itself learned as a fresh "attack" crime, which every other guard would
// then independently confront/arrest, producing an endless mutual-arrest loop between the
// same actors instead of an encounter that actually resolves). 'rob', 'threaten', 'injure',
// 'kill' and undefined (older/edge-case attacks with no recorded intent) remain crimes.
const LAWFUL_INTENTS = new Set(['subdue', 'arrest', 'defend', 'avoid', 'drive_off']);
export function isCrime(type: string, intent?: string): boolean {
  if (type !== 'attack' && type !== 'kill' && type !== 'theft') return false;
  if (type === 'attack' && intent && LAWFUL_INTENTS.has(intent)) return false;
  return true;
}
export function crimeSeverity(type: string): number { return type === 'kill' ? 1 : type === 'attack' ? 0.6 : type === 'theft' ? 0.35 : 0; }
