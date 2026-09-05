import type { EntityId, EventId, WorldEvent } from '../core/types';
import { World } from '../core/world';
import type { TelemetryRecord } from './types';

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

/** Semantic world events that are naturally bursty and already treated as high-frequency /
 * low-significance by the engine (TALLIED_TYPES + compaction). A cluster of these is a wave of
 * real activity, not a stuck loop. */
const HIGH_FREQUENCY_SEMANTIC = new Set<WorldEvent['type']>([
  'crop_planted', 'crop_matured', 'crop_harvested', 'resource_transformed', 'food_consumed', 'water_consumed', 'meal',
  'resource_picked_up', 'resource_delivered', 'resource_extracted', 'construction_material_delivered', 'construction_progress', 'resource_spoiled',
  // v0.8 §P0-I: `block_changed` (a door/gate opening) rejoined the telemetry stream (see
  // recorder.ts's `SKIP_TYPES`) purely so `dangling_cause` can trace real perception causally —
  // it is exactly as bursty as any other routine world activity and must not count as spam here.
  'block_changed',
]);

/**
 * v0.8 §P0-I (independent audit §4.7): reconstitutes a `WorldEvent`-shaped array from
 * `TelemetryRecorder`'s `MemorySink` records — a much longer, un-compacted event history than
 * `World.events` (`World.compactEvents` keeps only the most recent ~4000 entries plus anything
 * significance >= 0.5, dropping older low-significance events like `item_missing` (0.45),
 * `food_consumed` (0.1), `resource_shortage` (0.2-0.3) — exactly the kind of low-per-event-
 * significance-but-meaningful-in-aggregate signal a rate/clustering-based anomaly check over a
 * multi-day run needs). Every field `detectAnomalies` below actually reads is reconstructed from
 * `TelemetryRecord.data`, which `TelemetryRecorder.onEvent` already carries the full original
 * event's `id`/`actor`/`target`/`item`/`placeId`/`causes`/`significance`/`summary` plus payload
 * inside (see telemetry/recorder.ts). Read-only, never mutates anything.
 */
export function telemetryToEvents(records: TelemetryRecord[]): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const r of records) {
    const d = r.data ?? {};
    out.push({
      id: (d.id as string) ?? `tel:${r.worldTick}:${out.length}`, type: r.type as WorldEvent['type'], tick: r.worldTick,
      // `category` here is a placeholder — no check below reads it (see the taxonomy note above
      // TelemetryRecorder.categoryFor, a DIFFERENT, richer category axis that doesn't map 1:1
      // onto `EventCategory`'s coarse world/social/cognition/history split).
      category: 'world',
      actor: d.actor as EntityId | undefined, target: d.target as EntityId | undefined, item: d.item as EntityId | undefined,
      placeId: d.placeId as EntityId | undefined, causes: (d.causes as EventId[] | undefined) ?? [], effects: [],
      perceivedBy: [], significance: (d.significance as number | undefined) ?? 0.2, summary: (d.summary as string | undefined) ?? r.type,
      data: d,
    });
  }
  return out;
}

export function detectAnomalies(world: World, opts: AnomalyOptions = {}, eventSource?: WorldEvent[]): Anomaly[] {
  const out: Anomaly[] = [];
  const now = world.now;
  const window = opts.windowSeconds ?? 3 * 3600;
  const cap = opts.maxRelatedEvents ?? 20;
  const within = (e: WorldEvent, w: number) => now - e.tick <= w;
  // v0.8 §P0-I: prefer a richer telemetry-derived event source when the caller has one (see
  // `telemetryToEvents` above); every check below reads through this local, never `world.events`
  // directly, so plugging in telemetry improves every one of them uniformly. Falls back to
  // `World.events` (unchanged, pre-v0.8 behavior) for every EXISTING caller that doesn't pass one
  // (the browser Inspector, ad-hoc scripts) — never a breaking change.
  const events = eventSource ?? world.events;

  // 1. Repeated lethal conflict: one actor with 3+ kills inside the window.
  const killsByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of events) {
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
  const deaths = events.filter(e => e.type === 'death').sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < deaths.length; i++) {
    const clustered = deaths.filter(d => Math.abs(d.tick - deaths[i].tick) <= window);
    if (clustered.length >= 4) { out.push({ type: 'death_spike', ...trace(clustered, cap), data: { worldWindowHours: window / 3600 } }); break; }
  }

  // 3. Dangling causal references and invalid entity ids — causal/referential integrity.
  // Grouped by the missing id itself: one broken reference cascading through many events is one
  // integrity defect, not N.
  // v0.8 §P0-I fix: a cause id is only really "dangling" if it never existed anywhere, not merely
  // if `World.compactEvents` has since pruned it from `world.events` — the whole reason a fuller
  // `events` source (telemetry, when the caller passes one) is preferred here is that IT still
  // has the cited event even after canonical compaction, so `knownEventIds` (built from the SAME
  // `events` array being scanned) is checked first; `world.event(c)` remains a second, cheaper
  // check for the plain `world.events`-only fallback case where the two collapse to the same set.
  const knownEventIds = new Set(events.map(e => e.id));
  const danglingCauses = new Map<string, WorldEvent[]>();
  const invalidRefs = new Map<string, WorldEvent[]>();
  for (const e of events) {
    for (const c of e.causes) if (!knownEventIds.has(c) && !world.event(c)) { const list = danglingCauses.get(c) ?? []; list.push(e); danglingCauses.set(c, list); }
    for (const id of [e.actor, e.target, e.item, e.placeId]) if (id && !world.get(id)) { const list = invalidRefs.get(id) ?? []; list.push(e); invalidRefs.set(id, list); }
  }
  for (const [missingCause, events] of danglingCauses) out.push({ type: 'dangling_cause', ...trace(events, cap), data: { missingCause } });
  for (const [missingId, events] of invalidRefs) out.push({ type: 'invalid_entity_reference', ...trace(events, cap), data: { missingId } });

  // 4. Event spam: an identical (type, actor, target) tuple repeating far past what any
  // real routine would produce inside the window (e.g. a goal loop re-emitting the same
  // semantic event over and over without progress). High-frequency *semantic* world events —
  // crop maturation waves, deliveries, extractions, spoilage — are legitimately bursty (a
  // whole field ripens together) and are already compaction-dropped; they are not a defect.
  const spamCounts = new Map<string, WorldEvent[]>();
  for (const e of events) {
    if (!within(e, window)) continue;
    if (HIGH_FREQUENCY_SEMANTIC.has(e.type)) continue;
    const key = `${e.type}:${e.actor ?? ''}:${e.target ?? ''}`;
    const list = spamCounts.get(key) ?? []; list.push(e); spamCounts.set(key, list);
  }
  for (const [key, list] of spamCounts) if (list.length >= 30) out.push({ type: 'event_spam', entity: list[0].actor, ...trace(list, cap), data: { key, windowHours: window / 3600 } });

  // 5. Stuck agents: repeated path failures clustering on one entity.
  const pathFailByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of events) { if (e.type !== 'path_failure' || !e.actor || !within(e, window)) continue; const list = pathFailByActor.get(e.actor) ?? []; list.push(e); pathFailByActor.set(e.actor, list); }
  for (const [actor, events] of pathFailByActor) if (events.length >= 5) out.push({ type: 'stuck_agent', entity: actor, ...trace(events, cap), data: { windowHours: window / 3600 } });

  // 6. Goal churn: an actor switching goals unusually often inside the window.
  const goalChangesByActor = new Map<EntityId, WorldEvent[]>();
  for (const e of events) { if (e.type !== 'goal_changed' || !e.actor || !within(e, window)) continue; const list = goalChangesByActor.get(e.actor) ?? []; list.push(e); goalChangesByActor.set(e.actor, list); }
  for (const [actor, events] of goalChangesByActor) if (events.length >= 40) out.push({ type: 'goal_churn', entity: actor, ...trace(events, cap), data: { windowHours: window / 3600 } });

  // 7. Conflict-resolution failures (v0.2.3). Reads canonical World.conflicts + the event log;
  // observational only, never touches the sim. Grouped so one stuck fight is one finding.
  for (const c of world.conflicts) {
    if (c.status !== 'active' && c.status !== 'disengaging') continue;
    const openHours = (now - c.startedAt) / 3600;
    // A fight open far longer than any real encounter should run, still trading blows, with no
    // resolution — the exact shape the v0.2.2 audit flagged at seed 918271.
    if (openHours >= 12 && c.attackCount >= 25) {
      const evs = events.filter(e => e.data?.conflictId === c.id);
      out.push({
        type: 'unresolved_conflict_loop', entity: c.participants[0],
        occurrences: c.attackCount, firstSeen: c.startedAt, lastSeen: c.lastMeaningfulInteraction,
        relatedEvents: evs.slice(0, cap).map(e => e.id),
        data: { participants: c.participants, cause: c.cause, status: c.status, durationWorldHours: Math.round(openHours * 10) / 10, attackEvents: c.attackCount },
      });
    }
  }

  // 8. Attacks on someone who is out of the fight — surrender/custody being ignored (a
  // resolution semantics bug). Grouped by the (attacker, victim) pair.
  const ignoredResolution = new Map<string, WorldEvent[]>();
  for (const e of events) {
    if (e.type !== 'attack' || !within(e, window) || !e.target) continue;
    const victim = world.person(e.target);
    if (!victim) continue;
    // The held state must have PREDATED this blow — otherwise a victim who surrenders (or is
    // detained) a tick after being hit by someone else retroactively turns an ordinary,
    // already-landed attack into a false "ignored surrender" finding.
    const heldBefore = (victim.custody?.active && (victim.custody.since ?? 0) < e.tick)
      || (victim.surrender && victim.surrender.at < e.tick);
    if (heldBefore && e.data?.intent !== 'kill') {
      const key = `${e.actor}:${e.target}`;
      const list = ignoredResolution.get(key) ?? []; list.push(e); ignoredResolution.set(key, list);
    }
  }
  for (const [key, list] of ignoredResolution) out.push({ type: 'surrender_or_custody_ignored', entity: list[0].actor, ...trace(list, cap), data: { key } });

  // 9. Repeated arrest of the same person inside the window — a revolving-door custody problem.
  const arrestsByDetainee = new Map<EntityId, WorldEvent[]>();
  for (const e of events) {
    if (e.type !== 'entity_arrested' || !e.target || !within(e, window * 8)) continue;
    const list = arrestsByDetainee.get(e.target) ?? []; list.push(e); arrestsByDetainee.set(e.target, list);
  }
  for (const [detainee, list] of arrestsByDetainee) {
    for (const anchor of list) {
      const clustered = list.filter(a => Math.abs(a.tick - anchor.tick) <= window * 8);
      if (clustered.length >= 4) { out.push({ type: 'repeated_arrest', entity: detainee, ...trace(clustered, cap), data: { worldWindowHours: (window * 8) / 3600 } }); break; }
    }
  }

  // 10. Knowledge referring to an actor the mind could not actually identify, yet somehow
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
