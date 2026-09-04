import type { EntityId, EventId, WorldEvent } from '../core/types';
import { World } from '../core/world';
import { SECONDS_PER_DAY } from '../core/time';
import { computeHistoricalSignificance } from './significance';

/**
 * The World Chronicle (Constitution §52, v0.2 Part 14): a deterministic historical
 * *selection and consolidation* layer, not a story-writing AI and not the event feed. It picks
 * out — and, where the same interaction repeats, groups — events the canonical log already
 * contains. Nothing here invents an event, a name, or a line of dialogue that didn't happen.
 * Every entry carries the canonical event id(s) it was built from and their recorded causes, so
 * a future historian (human or LLM) can walk from an entry back to exactly why it happened; the
 * summary text is drawn from `WorldEvent.summary`, written at the moment the event occurred by
 * the canonical systems that caused it — not fabricated after the fact.
 *
 * v0.2.1 stabilization (Priority 2): a two-day headless run was producing on the order of
 * 14,000+ chronicle entries — essentially the raw event feed with a significance floor, not a
 * historical record. The fix is a real selection pipeline: raw significance -> causal
 * importance (how many further events an event set off) -> the historical significance of the
 * entities involved -> consolidation of repeated interactions between the same parties into one
 * entry -> the Chronicle. "Routine cognition events should almost never become separate
 * Chronicle entries" (they're excluded outright, as before); a burst of the same two people
 * fighting or trading with each other repeatedly should read as one historical entry, not one
 * per blow.
 */
export interface ChronicleEntry {
  /** The representative (earliest) event this entry is anchored to. */
  eventId: EventId;
  day: number;
  tick: number;
  text: string;
  significance: number;
  /** Causal ancestors, unioned across every consolidated source event and deduplicated. For a
   * non-consolidated entry this is exactly that one event's own `causes` (unchanged shape from
   * pre-v0.2.1 chronicles). */
  causes: EventId[];
  /** Every canonical event id this entry represents, chronological order, always including
   * `eventId`. Length 1 for an ordinary entry; length > 1 when repeated near-identical
   * interactions (Constitution requirement: "repeated-event consolidation") were folded into
   * one historical entry. This is the field that keeps source events traceable even after
   * consolidation. */
  sourceEventIds: EventId[];
}

export interface ChronicleOptions {
  /** Minimum significance for an otherwise-ordinary event to be included. History-category
   * events are always included regardless of this threshold — they are, definitionally,
   * the events already judged to matter (marriages, deaths, floods, ...). */
  minSignificance?: number;
  /** How many of the world's most historically significant entities get a small inclusion
   * boost for events they're involved in — lets an otherwise-borderline event involving an
   * already-important person clear the bar, without changing the bar for everyone else. */
  significantEntityCount?: number;
  /** Max world-seconds gap between two same-pair, same-type events for them to be folded into
   * the same consolidated entry. Default 30 minutes: long enough to catch one scattered
   * encounter, short enough not to merge unrelated events days apart. */
  consolidationWindowSeconds?: number;
}

/** How much a raw event's own significance is boosted by causal centrality (it set off several
 * further recorded events — Constitution §51 "Causal History") and by the historical
 * significance of the people it involves, before the inclusion threshold is applied. Kept
 * separate from `computeHistoricalSignificance`'s own weighting so the Chronicle's bar and the
 * "who matters" leaderboard can be tuned independently. */
function chronicleScore(e: WorldEvent, sig: Map<EntityId, number>, maxSig: number): number {
  let score = e.significance;
  if (e.effects.length >= 2) score += Math.min(0.25, e.effects.length * 0.05);
  if (maxSig > 0) {
    const actorSig = e.actor ? (sig.get(e.actor) ?? 0) / maxSig : 0;
    const targetSig = e.target ? (sig.get(e.target) ?? 0) / maxSig : 0;
    score += Math.max(actorSig, targetSig) * 0.15;
  }
  return score;
}

/** Event types eligible for repeat consolidation — the recurring-friction types responsible for
 * the observed blow-by-blow spam (a guard and a bandit trading several blows, repeated
 * confrontations/arrest attempts). Deliberately narrow: a 'kill', 'death', 'marriage', 'birth',
 * 'leadership_changed' or 'theft' is a distinct notable event every time it happens, by nature —
 * two kills by the same actor minutes apart are two historical facts, never one. Consolidating
 * those would be exactly the "invent/merge facts that didn't happen" failure the Constitution
 * warns against, not compression. */
const CONSOLIDATABLE_TYPES = new Set<WorldEvent['type']>(['attack', 'confrontation', 'arrest_attempt']);

/**
 * v0.2.3 conflict consolidation (Priority 9). Every event that belongs to a canonical
 * `Conflict` (it carries `data.conflictId`) and is operational detail of the fight — the blows,
 * the demands, the start/escalation/disengagement/resolution markers — collapses into ONE
 * historical entry for that whole conflict. The distinct turning points inside it
 * (a surrender, a subdual, an arrest, custody, a death) stay as their own entries: they are
 * "important consequences", not blow-by-blow. So a 100-attack fight reads as
 *   "Day 5 — Dunstan Mole and Vex came into conflict over a crime; Vex was arrested (17 exchanges)."
 *   "Day 5 — Vex surrendered to Dunstan Mole." / "Day 5 — Vex entered the Village Watch's custody."
 * not 100+ lines. */
const CONFLICT_DETAIL_TYPES = new Set<WorldEvent['type']>(['attack', 'confrontation', 'arrest_attempt', 'conflict_started', 'conflict_escalated', 'conflict_disengaged', 'conflict_resolved', 'fled']);
const CONFLICT_TURNING_POINTS = new Set<WorldEvent['type']>(['entity_surrendered', 'entity_subdued', 'entity_arrested', 'custody_started', 'custody_ended', 'kill', 'death']);

/** Groups events into the same historical episode when they're a consolidatable type between
 * the same two parties (direction-independent — "Dunstan attacked Vex" and "Vex attacked
 * Dunstan" are the same fight) and close enough together in world time. Every other event gets
 * a key unique to itself, so it is never merged with anything. Order-preserving: events are
 * assumed pre-sorted by tick. */
function clusterKey(e: WorldEvent): string {
  if (!CONSOLIDATABLE_TYPES.has(e.type)) return `solo:${e.id}`;
  const parties = [e.actor, e.target].filter((x): x is EntityId => !!x).sort();
  return parties.length ? `${e.type}:${parties.join('|')}` : `solo:${e.id}`;
}

/** Events that are inherently propagation, not a new happening: someone retelling an already-
 * recorded fact to someone else. The fact itself (the death, the attack, the marriage) is
 * already its own event and — if it clears the bar — its own Chronicle entry; each of the many
 * individual retellings that follow is not a new historical turning point, just the existing
 * one spreading through the epistemic graph (which telemetry/knowledge tooling already tracks
 * in full, with provenance — see mind/knowledge.ts). A single village-wide event routinely
 * produces dozens of 'told' events as it's gossiped person to person; without this exclusion
 * those retellings alone dominated the Chronicle. */
const PROPAGATION_TYPES = new Set<WorldEvent['type']>(['told', 'conversation', 'greeting']);

export function buildChronicle(world: World, opts: ChronicleOptions = {}): ChronicleEntry[] {
  const threshold = opts.minSignificance ?? 0.5;
  const window = opts.consolidationWindowSeconds ?? 30 * 60;
  const sig = computeHistoricalSignificance(world);
  const maxSig = Math.max(0, ...sig.values());

  const allCandidates = world.events
    .filter(e => e.category !== 'cognition' && !PROPAGATION_TYPES.has(e.type))
    .filter(e => e.category === 'history' || chronicleScore(e, sig, maxSig) >= threshold || (e.data?.conflictId && CONFLICT_DETAIL_TYPES.has(e.type)))
    .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));

  // v0.2.3: pull every "operational detail of a fight" event out into per-conflict buckets and
  // make one entry per conflict. Turning points and everything else fall through to the normal
  // (type, party-pair) consolidation below.
  const byConflict = new Map<string, WorldEvent[]>();
  const conflictEntries: ChronicleEntry[] = [];
  const candidates: WorldEvent[] = [];
  for (const e of allCandidates) {
    const cid = e.data?.conflictId as string | undefined;
    if (cid && CONFLICT_DETAIL_TYPES.has(e.type)) {
      const list = byConflict.get(cid) ?? []; list.push(e); byConflict.set(cid, list);
    } else {
      candidates.push(e);
    }
  }
  for (const [cid, events] of byConflict) {
    conflictEntries.push(conflictEntry(world, events, world.conflicts.find(c => c.id === cid)));
  }

  // Consolidate: walk chronologically, extending an open cluster for a (type, party-pair) key
  // as long as the next matching event falls inside the window of the cluster's *last* event;
  // otherwise close it and start a new one. Deterministic given a deterministic event log.
  const openClusters = new Map<string, WorldEvent[]>();
  const clusters: WorldEvent[][] = [];
  for (const e of candidates) {
    const key = clusterKey(e);
    const open = openClusters.get(key);
    if (open && e.tick - open[open.length - 1].tick <= window) {
      open.push(e);
    } else {
      if (open) clusters.push(open);
      openClusters.set(key, [e]);
    }
  }
  for (const open of openClusters.values()) clusters.push(open);

  const entries = [...clusters.map(clusterEntry), ...conflictEntries];
  entries.sort((a, b) => a.tick - b.tick || a.eventId.localeCompare(b.eventId));
  return entries;
}

/** One historical entry for an entire conflict, from its operational-detail events (blows,
 * demands, the start/escalation/disengagement/resolution markers). Deterministic. Preserves
 * every source event id and the union of their causal ancestors. */
function conflictEntry(world: World, events: WorldEvent[], conflict: World['conflicts'][number] | undefined): ChronicleEntry {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  const first = sorted[0];
  const day = Math.floor(first.tick / SECONDS_PER_DAY);
  const lastDay = Math.floor(sorted[sorted.length - 1].tick / SECONDS_PER_DAY);
  const attacks = sorted.filter(e => e.type === 'attack').length;
  const parties = conflict ? conflict.participants.map(id => world.nameOf(id)) : [...new Set(sorted.flatMap(e => [e.actor, e.target].filter(Boolean) as string[]))].map(id => world.nameOf(id));
  const causePhrase: Record<string, string> = {
    robbery: 'a robbery', crime_response: 'a crime', self_defense: 'an assault', faction_hostility: 'old enmity',
    retaliation: 'a grievance', dispute: 'a quarrel', territorial: 'a boundary', unknown: 'a dispute',
  };
  const outcomePhrase: Record<string, string> = {
    objective_completed: 'the aggressor got what they came for', robbery_completed: 'the robbery succeeded',
    target_fled: 'the target got away', aggressor_fled: 'the aggressor fled', surrender: 'one side surrendered',
    subdual: 'one side was subdued', arrest: 'it ended in an arrest', custody: 'it ended with a detention',
    withdrawal: 'the aggressor withdrew', deterrence: 'the aggressor was driven off', reconciliation: 'it cooled to nothing',
    death: 'it ended in a death',
  };
  const cause = conflict ? (causePhrase[conflict.cause] ?? 'a dispute') : 'a dispute';
  const span = lastDay > day ? ` (day ${day}–${lastDay})` : '';
  let text: string;
  if (conflict && conflict.status === 'resolved' && conflict.outcome) {
    text = `Day ${day} — ${joinNames(parties)} came into conflict over ${cause}; ${outcomePhrase[conflict.outcome] ?? conflict.outcome.replace(/_/g, ' ')}${attacks ? ` (${attacks} exchange${attacks === 1 ? '' : 's'})` : ''}${span}.`;
  } else if (conflict && (conflict.status === 'suspended')) {
    text = `Day ${day} — ${joinNames(parties)} came into conflict over ${cause}; it went quiet without being settled${attacks ? ` (${attacks} exchange${attacks === 1 ? '' : 's'})` : ''}${span}.`;
  } else {
    text = `Day ${day} — ${joinNames(parties)} came into conflict over ${cause}${attacks ? ` (${attacks} exchange${attacks === 1 ? '' : 's'})` : ''}${span}.`;
  }
  return {
    eventId: first.id, day, tick: first.tick, text,
    significance: Math.max(0.5, ...sorted.map(e => e.significance)),
    causes: [...new Set(sorted.flatMap(e => e.causes))],
    sourceEventIds: sorted.map(e => e.id),
  };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'someone';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function clusterEntry(events: WorldEvent[]): ChronicleEntry {
  const first = events[0];
  const day = Math.floor(first.tick / SECONDS_PER_DAY);
  const sourceEventIds = events.map(e => e.id);
  const causes = [...new Set(events.flatMap(e => e.causes))];
  const significance = Math.max(...events.map(e => e.significance));
  if (events.length === 1) {
    // Unchanged shape from the pre-consolidation Chronicle for the common single-event case.
    return { eventId: first.id, day, tick: first.tick, text: `Day ${day} — ${first.summary}`, significance, causes, sourceEventIds };
  }
  const last = events[events.length - 1];
  const lastDay = Math.floor(last.tick / SECONDS_PER_DAY);
  const span = lastDay > day ? ` (day ${day}–${lastDay})` : '';
  const text = `Day ${day} — ${consolidatedSummary(events)}, ${events.length} times${span}`;
  return { eventId: first.id, day, tick: first.tick, text, significance, causes, sourceEventIds };
}

/** A consolidated entry's summary is built from the first event's own recorded summary (never
 * fabricated), trimmed of a trailing clause a repeat count would otherwise duplicate. */
function consolidatedSummary(events: WorldEvent[]): string {
  return events[0].summary.replace(/\s*\([^)]*\)\s*$/, '');
}

export function formatChronicle(entries: ChronicleEntry[]): string {
  return entries.map(e => e.text).join('\n');
}

/** Walks an entry's `causes` chain back through the full event graph (not just the
 * chronicle's own filtered entries), for tooling that wants the complete causal ancestry of
 * a historical moment rather than just its chronicle-level summary. */
export function causalAncestry(world: World, eventId: EventId, maxDepth = 12): WorldEvent[] {
  const out: WorldEvent[] = [];
  const seen = new Set<EventId>();
  const walk = (id: EventId, depth: number) => {
    if (depth > maxDepth || seen.has(id)) return;
    seen.add(id);
    const e = world.event(id);
    if (!e) return;
    out.push(e);
    for (const c of e.causes) walk(c, depth + 1);
  };
  walk(eventId, 0);
  return out;
}
