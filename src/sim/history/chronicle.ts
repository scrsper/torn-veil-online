import type { EventId, WorldEvent } from '../core/types';
import { World } from '../core/world';
import { SECONDS_PER_DAY } from '../core/time';

/**
 * The World Chronicle (Constitution §52, v0.2 Part 14): a deterministic historical
 * *selection* layer, not a story-writing AI. It picks out events the canonical log already
 * contains — nothing here invents an event, a name, or a line of dialogue that didn't
 * happen. Every entry carries the canonical event id and its recorded causes, so a future
 * historian (human or LLM) can walk from an entry back to exactly why it happened; the
 * summary text is drawn from `WorldEvent.summary`, which is written at the moment the event
 * occurred, by the canonical systems that caused it — not fabricated after the fact.
 */
export interface ChronicleEntry {
  eventId: EventId;
  day: number;
  tick: number;
  text: string;
  significance: number;
  causes: EventId[];
}

export interface ChronicleOptions {
  /** Minimum significance for an otherwise-ordinary event to be included. History-category
   * events are always included regardless of this threshold — they are, definitionally,
   * the events already judged to matter (marriages, deaths, floods, ...). */
  minSignificance?: number;
}

export function buildChronicle(world: World, opts: ChronicleOptions = {}): ChronicleEntry[] {
  const threshold = opts.minSignificance ?? 0.5;
  const entries: ChronicleEntry[] = [];
  for (const e of world.events) {
    if (e.category === 'cognition') continue;
    const include = e.category === 'history' || e.significance >= threshold;
    if (!include) continue;
    entries.push(chronicleEntryFor(e));
  }
  entries.sort((a, b) => a.tick - b.tick);
  return entries;
}

function chronicleEntryFor(e: WorldEvent): ChronicleEntry {
  const day = Math.floor(e.tick / SECONDS_PER_DAY);
  return { eventId: e.id, day, tick: e.tick, text: `Day ${day} — ${e.summary}`, significance: e.significance, causes: e.causes };
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
