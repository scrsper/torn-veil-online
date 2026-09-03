import type { EntityId, EventId, WorldEvent } from '../core/types';
import { World } from '../core/world';

/**
 * A small, general anomaly detector over canonical world state and the event log (v0.2 Part
 * 4). It reports; it never repairs. Nothing here mutates World — every check is a read-only
 * scan, so running it costs nothing simulation-wise and can be called as often as a
 * developer wants (after every headless run, on demand from the browser Inspector, etc.).
 *
 * v0.2.1 stabilization (Priority 5): every finding is a single structured record with common
 * trace metadata (`occurrences`, `firstSeen`/`lastSeen`, `relatedEvents`) rather than either a
 * pile of ungrouped one-per-occurrence entries (the old dangling-reference checks) or bare
 * counts with no way back to the underlying events (the old rate-based checks) — so a developer
 * can go anomaly -> entity -> relevant events -> canonical state without manually scanning
 * thousands of unrelated log lines. Detection logic itself is unchanged; this only changes how
 * findings are reported.
 */
export interface Anomaly {
  type: string;
  entity?: EntityId;
  /** How many underlying occurrences this single finding represents (>1 for anything grouped —
   * e.g. 37 identical stuck-path failures reported as one finding, not 37). */
  occurrences: number;
  /** World tick of the earliest occurrence folded into this finding. */
  firstSeen: number;
  /** World tick of the most recent occurrence folded into this finding. */
  lastSeen: number;
  /** Canonical event ids this finding was built from, earliest first — the trace back to
   * "what actually happened" for every occurrence, capped so one finding can't itself become a
   * second copy of the event feed. */
  relatedEvents: EventId[];
  data: Record<string, unknown>;
}

export interface AnomalyOptions {
  /** Window (world seconds) used for rate-based checks (goal churn, event spam, repeated
   * lethal conflict, path-failure clustering). Default 3 hours. */
  windowSeconds?: number;
  /** Cap on how many event ids a single finding's `relatedEvents` carries — a finding
   * representing hundreds of occurrences still needs to stay a summary, not a full copy of
   * the underlying event list. */
  maxRelatedEvents?: number;
}

/** Builds the common trace-metadata fields shared by every finding below, from the exact
 * events it was grouped from. */
function trace(events: WorldEvent[], cap: number): Pick<Anomaly, 'occurrences' | 'firstSeen' | 'lastSeen' | 'relatedEvents'> {
  const ticks = events.map(e => e.tick);
  return {
    occurrences: events.length,
    firstSeen: Math.min(...ticks),
    lastSeen: Math.max(...ticks),
    relatedEvents: events.slice(0, cap).map(e => e.id),
  };
}

export function detectAnomalies(world: World, opts: AnomalyOptions = {}): Anomaly[] {
  const out: Anomaly[] = [];
  const now = world.now;
  const window = opts.windowSeconds ?? 3 * 3600;
  const cap = opts.maxRelatedEvents ?? 20;
  const within = (e: WorldEvent, w: number) => now - e.tick <= w;

  // 1. Repeated lethal conflict: one actor with 3+ kills inside the window.
  const killsByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of world.events) {
    if (e.type !== 'kill' || !e.actor || !within(e, window * 8)) continue;
    const list = killsByActor.get(e.actor) ?? []; list.push(e); killsByActor.set(e.actor, list);
  }
  for (const [actor, kills] of killsByActor) {
    for (const anchor of kills) {
      const clustered = kills.filter(k => Math.abs(k.tick - anchor.tick) <= window);
      if (clustered.length >= 3) {
        out.push({ type: 'repeated_lethal_conflict', entity: actor, ...trace(clustered, cap), data: { worldWindowHours: window / 3600 } });
        break;
      }
    }
  }

  // 2. Village-wide death spike: several deaths clustered close together in world time.
  const deaths = world.events.filter(e => e.type === 'death').sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < deaths.length; i++) {
    const clustered = deaths.filter(d => Math.abs(d.tick - deaths[i].tick) <= window);
    if (clustered.length >= 4) { out.push({ type: 'death_spike', ...trace(clustered, cap), data: { worldWindowHours: window / 3600 } }); break; }
  }

  // 3. Dangling causal references and invalid entity ids — causal/referential integrity.
  // Grouped by the missing id itself: one broken reference cascading through many events (a
  // compacted-away event still cited as a cause, say) is one integrity defect, not N.
  const danglingCauses = new Map<string, WorldEvent[]>();
  const invalidRefs = new Map<string, WorldEvent[]>();
  for (const e of world.events) {
    for (const c of e.causes) if (!world.event(c)) { const list = danglingCauses.get(c) ?? []; list.push(e); danglingCauses.set(c, list); }
    for (const id of [e.actor, e.target, e.item, e.placeId]) if (id && !world.get(id)) { const list = invalidRefs.get(id) ?? []; list.push(e); invalidRefs.set(id, list); }
  }
  for (const [missingCause, events] of danglingCauses) out.push({ type: 'dangling_cause', ...trace(events, cap), data: { missingCause } });
  for (const [missingId, events] of invalidRefs) out.push({ type: 'invalid_entity_reference', ...trace(events, cap), data: { missingId } });

  // 4. Event spam: an identical (type, actor, target) tuple repeating far past what any
  // real routine would produce inside the window (e.g. a goal loop re-emitting the same
  // semantic event over and over without progress).
  const spamCounts = new Map<string, WorldEvent[]>();
  for (const e of world.events) {
    if (!within(e, window)) continue;
    const key = `${e.type}:${e.actor ?? ''}:${e.target ?? ''}`;
    const list = spamCounts.get(key) ?? []; list.push(e); spamCounts.set(key, list);
  }
  for (const [key, list] of spamCounts) if (list.length >= 30) out.push({ type: 'event_spam', entity: list[0].actor, ...trace(list, cap), data: { key, windowHours: window / 3600 } });

  // 5. Stuck agents: repeated path failures clustering on one entity.
  const pathFailByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of world.events) { if (e.type !== 'path_failure' || !e.actor || !within(e, window)) continue; const list = pathFailByActor.get(e.actor) ?? []; list.push(e); pathFailByActor.set(e.actor, list); }
  for (const [actor, events] of pathFailByActor) if (events.length >= 5) out.push({ type: 'stuck_agent', entity: actor, ...trace(events, cap), data: { windowHours: window / 3600 } });

  // 6. Goal churn: an actor switching goals unusually often inside the window.
  const goalChangesByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of world.events) { if (e.type !== 'goal_changed' || !e.actor || !within(e, window)) continue; const list = goalChangesByActor.get(e.actor) ?? []; list.push(e); goalChangesByActor.set(e.actor, list); }
  for (const [actor, events] of goalChangesByActor) if (events.length >= 40) out.push({ type: 'goal_churn', entity: actor, ...trace(events, cap), data: { windowHours: window / 3600 } });

  // 7. Knowledge referring to an actor the mind could not actually identify, yet somehow
  // treated as identified downstream (an epistemic-leak regression — see
  // docs/CODEX_FIRST_PASS.md's "epistemic leakage" fix this guards against staying fixed).
  // Grouped per person: one mind holding several such claims is one integrity defect for that
  // mind, not one finding per claim.
  for (const p of world.persons()) {
    const leaks = Object.values(p.knowledge).filter(k => k.kind === 'event' && k.claim.actorUnknown === true && k.claim.actor);
    if (!leaks.length) continue;
    const events = leaks.map(k => world.event(k.source.viaEvent ?? '')).filter((e): e is WorldEvent => !!e);
    out.push({
      type: 'epistemic_leak', entity: p.id,
      occurrences: leaks.length,
      firstSeen: events.length ? Math.min(...events.map(e => e.tick)) : now,
      lastSeen: events.length ? Math.max(...events.map(e => e.tick)) : now,
      relatedEvents: events.slice(0, cap).map(e => e.id),
      data: { keys: leaks.slice(0, cap).map(k => k.key) },
    });
  }

  return out;
}
