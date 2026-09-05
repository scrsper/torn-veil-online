import type { WorldEvent } from '../core/types';
import { World } from '../core/world';
import type { TelemetryRecord, TelemetrySink } from './types';

const EVENT_CATEGORY: Partial<Record<string, TelemetryRecord['category']>> = {
  goal_changed: 'cognition', goal_completed: 'cognition', cognitive_lod_changed: 'cognition',
  perceived: 'perception',
  knowledge_gained: 'knowledge',
  relationship_changed: 'relationship', emotion_changed: 'relationship',
  attack: 'conflict', kill: 'conflict', death: 'conflict', theft: 'conflict',
  confrontation: 'conflict', arrest_attempt: 'conflict', fled: 'conflict', threat_spotted: 'conflict',
  told: 'social', conversation: 'social', rumor: 'social', greeting: 'social', gift: 'social',
  returned_item: 'social', apology: 'social', debt: 'social', debt_paid: 'social', dispute: 'social',
  marriage: 'social', birth: 'social', mourning: 'social', prayer: 'social',
  institutional_report: 'institutional', leadership_changed: 'institutional',
  path_failure: 'integrity', item_missing: 'integrity',
  // v0.2.4 world metabolism
  crop_planted: 'metabolism', crop_matured: 'metabolism', crop_harvested: 'metabolism',
  resource_transformed: 'metabolism', food_consumed: 'metabolism', water_consumed: 'metabolism',
  resource_shortage: 'metabolism', resource_spoiled: 'metabolism',
  // v0.3 Living World I — logistics & construction
  haul_requested: 'logistics', haul_started: 'logistics', resource_picked_up: 'logistics',
  resource_delivered: 'logistics', haul_failed: 'logistics',
  resource_extracted: 'logistics', resource_depleted: 'logistics', resource_regrew: 'logistics',
  construction_started: 'construction', construction_material_delivered: 'construction',
  construction_progress: 'construction', construction_completed: 'construction', construction_cancelled: 'construction',
};
function categoryFor(type: string): TelemetryRecord['category'] { return EVENT_CATEGORY[type] ?? 'cognition'; }

// High-frequency, low-value-per-record event types that would otherwise dominate the
// stream without adding observability (Part 3: "record meaningful semantic changes rather
// than rendering frames"). `arrived` fires constantly as NPCs walk their routines (pure
// movement telemetry, never cited as a `causes` reference by anything); it carries no anomaly
// or narrative signal on its own.
// v0.8 §P0-I (independent audit §4.7): `block_changed` USED to be skipped here too, on the same
// "fires constantly" reasoning — but `mind/agent.ts`'s `perceive()` routinely cites a
// `block_changed` event as a `perceived` event's `causes` (someone genuinely perceiving a door
// open/close). Skipping it from telemetry meant that causal link could never be traced back
// through the fuller telemetry history `detectAnomalies`'s `dangling_cause` check now prefers
// (see `telemetryToEvents`) — every such perception looked like a genuine dangling reference,
// even though nothing was actually broken; the door event legitimately happened. Recording it
// (still excluded from `event_spam`/other rate checks — see `HIGH_FREQUENCY_SEMANTIC`) closes
// that gap for the one thing telemetry is actually used for here: causal tracing.
const SKIP_TYPES = new Set(['arrived']);

/**
 * Subscribes to World's canonical event stream and turns a curated subset into structured
 * telemetry records (v0.2 Part 3). Purely observational (Constitution §53): this class must
 * never call anything that mutates World, Person, Faction, or any other canonical state —
 * it only reads events World already emitted for its own reasons.
 */
export class TelemetryRecorder {
  constructor(private world: World, private sinks: TelemetrySink[]) {
    world.onEvent(e => this.onEvent(e));
  }

  private onEvent(e: WorldEvent): void {
    if (SKIP_TYPES.has(e.type)) return;
    // v0.8 §P0-I: `e.data` (the payload each emit() call writes) legitimately reuses common key
    // names for DIFFERENT things than the canonical top-level fields — e.g. `settleWholesale`'s
    // `data.item` is a resource TYPE string ('grain'), not the EntityId `WorldEvent.item` means.
    // The canonical identity fields (id/actor/target/item/placeId/...) MUST win over any
    // same-named payload key, so they are spread LAST — anyone reading `record.data.item` back
    // out as an EntityId (see `telemetry/anomaly.ts`'s `telemetryToEvents`) needs that guarantee
    // to hold, and a same-named payload key was previously free to silently clobber it.
    const record: TelemetryRecord = {
      t: Date.now(), worldTick: e.tick, category: categoryFor(e.type), type: e.type,
      data: { ...e.data, id: e.id, actor: e.actor, target: e.target, item: e.item, placeId: e.placeId, significance: e.significance, summary: e.summary, causes: e.causes },
    };
    this.writeAll(record);
  }

  runStart(meta: Record<string, unknown>): void { this.writeAll({ t: Date.now(), worldTick: this.world.now, category: 'run', type: 'run_start', data: meta }); }
  runEnd(meta: Record<string, unknown>): void { this.writeAll({ t: Date.now(), worldTick: this.world.now, category: 'run', type: 'run_end', data: meta }); }

  private writeAll(record: TelemetryRecord): void {
    for (const sink of this.sinks) {
      try { sink.write(record); } catch { /* a broken sink must never break the simulation */ }
    }
  }
}

/** In-memory ring-buffer sink: safe in the browser (no filesystem), and used by the headless
 * runner as the source for the final world-run summary/anomaly pass. */
export class MemorySink implements TelemetrySink {
  records: TelemetryRecord[] = [];
  constructor(private cap = 20000) {}
  write(r: TelemetryRecord): void {
    this.records.push(r);
    // Trim in one batch only once we're ~10% over cap, not on every single write past it — a
    // per-write `splice(0, 1)` is an O(cap) array shift, so on a long run (where the recorder
    // sees far more raw events than the compacted `world.events` count — every perceived,
    // knowledge_gained, told, ... included) that shift becomes the dominant cost, billed
    // opaquely to whichever subsystem's `emit()` call it happened inside. Amortized O(1).
    if (this.records.length > this.cap * 1.1) this.records.splice(0, this.records.length - this.cap);
  }
  toJSONL(): string { return this.records.map(r => JSON.stringify(r)).join('\n'); }
  countByCategory(): Record<string, number> { const out: Record<string, number> = {}; for (const r of this.records) out[r.category] = (out[r.category] ?? 0) + 1; return out; }
}
