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
};
function categoryFor(type: string): TelemetryRecord['category'] { return EVENT_CATEGORY[type] ?? 'cognition'; }

// High-frequency, low-value-per-record event types that would otherwise dominate the
// stream without adding observability (Part 3: "record meaningful semantic changes rather
// than rendering frames"). `arrived`/`block_changed` fire constantly as NPCs walk their
// routines and open doors; they carry no anomaly or narrative signal on their own.
const SKIP_TYPES = new Set(['arrived', 'block_changed']);

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
    const record: TelemetryRecord = {
      t: Date.now(), worldTick: e.tick, category: categoryFor(e.type), type: e.type,
      data: { id: e.id, actor: e.actor, target: e.target, item: e.item, placeId: e.placeId, significance: e.significance, summary: e.summary, causes: e.causes, ...e.data },
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
