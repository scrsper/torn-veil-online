import type { EntityId, WorldEvent } from '../core/types';
import { World } from '../core/world';

/**
 * A small, general anomaly detector over canonical world state and the event log (v0.2 Part
 * 4). It reports; it never repairs. Nothing here mutates World — every check is a read-only
 * scan, so running it costs nothing simulation-wise and can be called as often as a
 * developer wants (after every headless run, on demand from the browser Inspector, etc.).
 */
export interface Anomaly {
  type: string;
  entity?: EntityId;
  data: Record<string, unknown>;
}

export interface AnomalyOptions {
  /** Window (world seconds) used for rate-based checks (goal churn, event spam, repeated
   * lethal conflict, path-failure clustering). Default 3 hours. */
  windowSeconds?: number;
}

export function detectAnomalies(world: World, opts: AnomalyOptions = {}): Anomaly[] {
  const out: Anomaly[] = [];
  const now = world.now;
  const window = opts.windowSeconds ?? 3 * 3600;
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
        out.push({ type: 'repeated_lethal_conflict', entity: actor, data: { worldWindowHours: window / 3600, kills: clustered.length, eventIds: clustered.map(k => k.id) } });
        break;
      }
    }
  }

  // 2. Village-wide death spike: several deaths clustered close together in world time.
  const deaths = world.events.filter(e => e.type === 'death').sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < deaths.length; i++) {
    const clustered = deaths.filter(d => Math.abs(d.tick - deaths[i].tick) <= window);
    if (clustered.length >= 4) { out.push({ type: 'death_spike', data: { worldWindowHours: window / 3600, deaths: clustered.length, eventIds: clustered.map(d => d.id) } }); break; }
  }

  // 3. Dangling causal references and invalid entity ids — causal/referential integrity.
  for (const e of world.events) {
    for (const c of e.causes) if (!world.event(c)) out.push({ type: 'dangling_cause', data: { eventId: e.id, missingCause: c } });
    for (const id of [e.actor, e.target, e.item, e.placeId]) if (id && !world.get(id)) out.push({ type: 'invalid_entity_reference', data: { eventId: e.id, missingId: id } });
  }

  // 4. Event spam: an identical (type, actor, target) tuple repeating far past what any
  // real routine would produce inside the window (e.g. a goal loop re-emitting the same
  // semantic event over and over without progress).
  const spamCounts = new Map<string, WorldEvent[]>();
  for (const e of world.events) {
    if (!within(e, window)) continue;
    const key = `${e.type}:${e.actor ?? ''}:${e.target ?? ''}`;
    const list = spamCounts.get(key) ?? []; list.push(e); spamCounts.set(key, list);
  }
  for (const [key, list] of spamCounts) if (list.length >= 30) out.push({ type: 'event_spam', data: { key, count: list.length, windowHours: window / 3600 } });

  // 5. Stuck agents: repeated path failures clustering on one entity.
  const pathFailByActor = new Map<EntityId, number>();
  for (const e of world.events) { if (e.type !== 'path_failure' || !e.actor || !within(e, window)) continue; pathFailByActor.set(e.actor, (pathFailByActor.get(e.actor) ?? 0) + 1); }
  for (const [actor, count] of pathFailByActor) if (count >= 5) out.push({ type: 'stuck_agent', entity: actor, data: { pathFailures: count, windowHours: window / 3600 } });

  // 6. Goal churn: an actor switching goals unusually often inside the window.
  const goalChangesByActor = new Map<EntityId, number>();
  for (const e of world.events) { if (e.type !== 'goal_changed' || !e.actor || !within(e, window)) continue; goalChangesByActor.set(e.actor, (goalChangesByActor.get(e.actor) ?? 0) + 1); }
  for (const [actor, count] of goalChangesByActor) if (count >= 40) out.push({ type: 'goal_churn', entity: actor, data: { goalChanges: count, windowHours: window / 3600 } });

  // 7. Knowledge referring to an actor the mind could not actually identify, yet somehow
  // treated as identified downstream (an epistemic-leak regression — see
  // docs/CODEX_FIRST_PASS.md's "epistemic leakage" fix this guards against staying fixed).
  for (const p of world.persons()) {
    for (const k of Object.values(p.knowledge)) {
      if (k.kind === 'event' && k.claim.actorUnknown === true && k.claim.actor) {
        out.push({ type: 'epistemic_leak', entity: p.id, data: { key: k.key, claimedActor: k.claim.actor } });
      }
    }
  }

  return out;
}
