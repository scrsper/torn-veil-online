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
 * v0.2.1 Priority 9 / v0.2.2 (long-running throughput + epistemic coherence).
 * `Person.knowledge` had no bound at all — every witnessed event, every heard rumor, every
 * learned location added a permanent entry, unlike `Person.memories` (mind/memory.ts's own
 * MAX_MEMORIES=60, same "computational pragmatism" reasoning). Several hot-path scans read a
 * mind's ENTIRE knowledge map every think() tick (`Object.values(p.knowledge).filter(...)` in
 * mind/agent.ts's think(), knownCrimesBy(), and the gossip-sharing candidate scan in
 * maybeChat()), so as knowledge accumulated across a long run this cost grew with it — measured
 * directly as the dominant driver behind a 30-day headless benchmark (seed 918271) becoming
 * clearly superlinear.
 *
 * A flat "confidence x significance, minus a fixed age decay" score (the original v0.2.1 fix)
 * is not semantically sound on its own: the Constitution requires epistemic coherence, and a
 * plain container-capacity eviction can silently erode knowledge that should be nearly
 * permanent. The v0.2.2 audit found this concretely — village generation teaches every villager
 * every neighbor's home (`home:<id>`, kind 'fact') and several heirloom ownership records
 * (`owner:<id>`, kind 'ownership') as `source.type: 'prior'` (backstory, known since before the
 * story started). Under the flat scoring, those foundational facts (confidence ~0.9, no
 * explicit significance so defaulting to 0.2) scored *below* an ordinary witnessed event
 * (confidence 1, significance 0.3), and their `learnedAt` never refreshes during play (nothing
 * re-teaches a home location once seeded), so a flat per-day age penalty would eventually erase
 * them on a long enough run even though nothing about them ever became less true. Real people do
 * not gradually forget where their spouse lives at a fixed daily rate just because the world got
 * eventful; forgetting must be selective, not uniform.
 *
 * This scoring instead recognizes categories WITHOUT naming any entity (Constitution: identity
 * and family/relationship facts are never stored as knowledge at all — see the module-level note
 * below — so they cannot be evicted by construction; this only has to handle what genuinely
 * lives in `Person.knowledge`):
 *  - **foundational** (`source.type === 'prior'`): backstory the mind has always held. Given a
 *    score far above anything ordinary play can produce, so it is displaced only if the cap is
 *    somehow filled entirely with other foundational/near-foundational facts — never by routine
 *    gossip or a single eventful day.
 *  - **durable relational**: knowledge ABOUT an entity `p` has a real relationship with (family,
 *    friendship, rivalry, fear — any nonzero familiarity/affection/respect/fear/grudge) is given a
 *    floor (`DURABLE_BASE`, scaled by relationship strength) added BEFORE age decay, not folded
 *    into the same small importance value ordinary knowledge decays from — decaying a value that
 *    can cross zero cannot guarantee an old-but-durable fact beats a flood of brand-new,
 *    zero-age, low-value rumor; decaying slowly off a high floor can. "I know where my captain
 *    lives" should outlast "I once glimpsed a traveler," at any age.
 *  - **institutional/core**: an unresolved crime report gets the same floor-before-decay
 *    treatment (Constitution §11/§37: a guard's ability to eventually act on a known crime must
 *    not be silently lost to a cache eviction before it's ever `handled`).
 *  - **ordinary factual / ephemeral observation / rumor**: everything else, scored by
 *    confidence x significance as before, but now with age decay SCALED BY IMPORTANCE — a highly
 *    significant, high-confidence witnessed killing decays far slower than "someone heard a
 *    rumor about a stray cat" (decay rate is `baseRate / (1 + importance)`), so low-value rumor
 *    is reliably the first thing evicted under pressure, exactly as the brief requires.
 *
 * Purely a memory/perf bound — like event compaction, it does not change WHICH claims a mind
 * currently holds until the cap is actually exceeded, eviction always removes the lowest-scored
 * entries first, and it never adds knowledge (no accidental omniscience). When an evicted entry
 * was still materially relevant to cognition (an unresolved crime, or a key an active goal/plan
 * step still references), the eviction is made observable via a `knowledge_forgotten` event
 * rather than happening silently underneath live behavior.
 */
const MAX_KNOWLEDGE = 400;
const FOUNDATIONAL_SCORE = 1000; // backstory ('prior') knowledge: effectively pinned
// Durable relational / institutional-core tier: a floor well above anything routine gossip can
// produce (ordinary importance tops out well under 2 — see below), but far under FOUNDATIONAL.
// Critically this is a FLOOR added before age decay, not a multiplier on an already-decayed
// value — decaying *toward* a high floor (rather than decaying an importance score that can
// cross zero) is what actually keeps a real relationship from losing to a flood of brand-new,
// zero-age trivial rumor once enough simulated time has passed. See knowledgeScore below.
const DURABLE_BASE = 10;

/** How much `p` cares about the entity a piece of knowledge concerns, 0..~1.7. Any real
 * relationship (positive OR negative — a rival or a feared threat is just as worth remembering
 * as a friend) raises this; a stranger contributes 0. Never keyed by name/id. */
function relationalWeight(p: Person, k: KnowledgeItem): number {
  const about = (k.claim.entityId ?? k.claim.actor ?? k.claim.target) as EntityId | undefined;
  if (!about) return 0;
  const r = p.relationships[about];
  if (!r) return 0;
  return Math.min(1.7, r.familiarity + Math.abs(r.affection) * 0.4 + Math.abs(r.respect) * 0.3 + r.fear * 0.5 + r.grudge * 0.4);
}

function knowledgeScore(p: Person, k: KnowledgeItem, now: number): number {
  if (k.source.type === 'prior') return FOUNDATIONAL_SCORE + k.confidence;
  const significance = k.claim.significance ?? 0.2;
  const unresolvedCrime = k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled;
  const relWeight = relationalWeight(p, k);
  const ageDays = (now - k.learnedAt) / 86400;

  // Durable relational / institutional-core: any real relationship (nonzero relWeight) or an
  // unresolved crime gets a floor added BEFORE decay, scaled by how much it matters (relationship
  // strength; a flat institutional bonus for an unresolved crime). Decay is a slow erosion off
  // that floor, not of a small importance value that can cross zero — so an old-but-durable fact
  // reliably outranks a mountain of fresh, zero-age, low-value rumor, which a plain
  // "importance minus linear age penalty" formula cannot guarantee once enough time has passed.
  if (relWeight > 0 || unresolvedCrime) {
    const base = DURABLE_BASE + relWeight * 20 + (unresolvedCrime ? 15 : 0);
    const decayRate = 0.002 / (1 + relWeight + (unresolvedCrime ? 2 : 0));
    return base + k.confidence - ageDays * decayRate;
  }

  const importance = k.confidence * (0.4 + significance);
  const decayRate = 0.01 / (1 + importance);
  return importance - ageDays * decayRate;
}

/** True if evicting `key` would remove something an active decision could still reach: an
 * unresolved crime report, or a key an in-flight goal/plan step names directly (Constitution:
 * forgetting must not silently pull the rug out from under live cognition — see the
 * `knowledge_forgotten` emission below). */
function isActivelyRelevant(p: Person, key: string, k: KnowledgeItem): boolean {
  if (k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled) return true;
  if (p.mind.goal?.data?.crime === key) return true;
  return p.mind.plan.some(a => a.data?.crime === key || a.data?.key === key);
}

function pruneKnowledge(world: World, p: Person): void {
  const keys = Object.keys(p.knowledge);
  if (keys.length <= MAX_KNOWLEDGE) return;
  const now = world.now;
  keys.sort((a, b) => knowledgeScore(p, p.knowledge[b], now) - knowledgeScore(p, p.knowledge[a], now));
  for (const key of keys.slice(MAX_KNOWLEDGE)) {
    const k = p.knowledge[key];
    if (isActivelyRelevant(p, key, k)) {
      world.emit('knowledge_forgotten', {
        actor: p.id, significance: 0, category: 'cognition',
        data: { key, kind: k.kind, wasUnresolvedCrime: k.kind === 'event' && isCrime(k.claim.type, k.claim.intent) && !k.handled },
        summary: `${p.name} forgot something still relevant: ${describeClaim(world, k)}`,
      });
    }
    delete p.knowledge[key];
  }
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
