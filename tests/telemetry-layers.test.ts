import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { TelemetryRecorder, MemorySink } from '../src/sim/telemetry/recorder';
import { detectAnomalies } from '../src/sim/telemetry/anomaly';
import { buildChronicle, causalAncestry } from '../src/sim/history/chronicle';
import { buildWorldRunSummary } from '../src/sim/history/summary';
import { topSignificantEntities } from '../src/sim/history/significance';

/**
 * v0.2.1 Priority 4 (telemetry quality). The brief requires the four observational layers —
 * raw semantic trace (telemetry), anomaly report, world summary, and historical Chronicle —
 * to serve genuinely distinct purposes rather than collapsing into copies of the same event
 * stream, AND to support tracing an anomaly all the way back to canonical state ("anomaly ->
 * entity -> goal/intent -> relevant events -> causal ancestry -> canonical state") without
 * manually scanning thousands of unrelated entries. Priorities 2, 3, and 5 already reshaped
 * each layer independently (Chronicle compression, compaction cadence, grouped anomalies with
 * `relatedEvents`); this test is the composed, end-to-end proof that the pieces actually chain
 * together the way the brief describes.
 */
describe('the four telemetry layers stay distinct and composably traceable (v0.2.1 Priority 4)', () => {
  it('produces a genuinely different shape/size at each layer, not four copies of the same event stream', () => {
    const tw = createTestWorld(900, 30);
    const sink = new MemorySink();
    new TelemetryRecorder(tw.world, [sink]);
    const guard = addPerson(tw, 'Guard', 'guard', v(10, 1, 10), { traits: { courage: 0.8, aggression: 0.5 } });
    const bandit = addPerson(tw, 'Raider', 'bandit', v(11, 1, 10), { traits: { courage: 0.9, aggression: 0.9 } });
    bandit.hostile = true;
    const bystander = addPerson(tw, 'Farmhand', 'farmer', v(12, 1, 10));
    // A burst of the same repeated conflict (Chronicle should consolidate this into ~1 entry,
    // not one per blow — see history/chronicle.ts's Priority 2 rework).
    for (let i = 0; i < 40; i++) {
      tw.world.emit('attack', { actor: bandit.id, target: guard.id, significance: 0.7, tick: tw.world.now + i, summary: `Raider struck Guard (${i})` });
    }
    // A batch of low-value routine events (telemetry itself already filters these; the
    // Chronicle must also never surface them).
    for (let i = 0; i < 50; i++) tw.world.emit('arrived', { actor: bystander.id, significance: 0.05, tick: tw.world.now + i, summary: `Farmhand arrived (${i})` });

    const telemetryCount = sink.records.length;
    const anomalies = detectAnomalies(tw.world);
    const chronicle = buildChronicle(tw.world);
    const summary = buildWorldRunSummary(tw.world, {
      seed: 900, requestedDays: 1, worldStart: 0, startingPopulation: 3, anomalies, significance: topSignificantEntities(tw.world),
    });

    // Raw trace: routine events are filtered at the telemetry layer, but still far larger than
    // the Chronicle — it's a trace, not a curated history.
    expect(telemetryCount).toBeGreaterThan(chronicle.length);
    // Anomaly report: a small number of GROUPED findings, not 40 individual "repeated attack"
    // warnings — Priority 5's whole point.
    expect(anomalies.length).toBeLessThan(10);
    // Chronicle: real historical compression — the 40-blow burst becomes very few entries, and
    // none of the 50 routine "arrived" events appear at all.
    expect(chronicle.length).toBeLessThan(10);
    expect(chronicle.some(c => c.text.includes('arrived'))).toBe(false);
    // Summary: a single fixed-shape aggregate object, not a list of events at all.
    expect(Array.isArray(summary)).toBe(false);
    expect(typeof summary.violentIncidents).toBe('number');
    expect(summary.violentIncidents).toBeGreaterThan(0);
  });

  it('traces an anomaly all the way to canonical state: entity -> goal/intent -> related events -> causal ancestry -> live world data', () => {
    const tw = createTestWorld(901, 20);
    const p = addPerson(tw, 'Stuck', 'farmer', v(5, 1, 5));
    p.mind.thinkInterval = 100; // isolate: no natural rethink competing with the manual plan below
    p.mind.goal = { type: 'idle', utility: 0.1, reasons: ['test'], createdAt: tw.world.now, key: 'idle:pinned' };
    // Repeated, real path_failure events against the same unreachable destination — the exact
    // shape a genuinely stuck agent produces (see tests/pathfinding-livelock.test.ts for the
    // fix that stops this from happening every physics substep; here we just need enough real
    // events to anomaly-detect and trace).
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const ev = tw.world.emit('path_failure', { actor: p.id, pos: { x: 5, y: 1, z: 5 }, significance: 0, tick: tw.world.now + i * 200, data: { reason: 'no path found', goal: 'idle' }, summary: `${p.name} could not path (no path found)` });
      ids.push(ev.id);
    }

    const anomalies = detectAnomalies(tw.world);
    const stuck = anomalies.find(a => a.type === 'stuck_agent' && a.entity === p.id);
    expect(stuck).toBeDefined();

    // 1. anomaly -> entity
    const entity = tw.world.person(stuck!.entity!)!;
    expect(entity.id).toBe(p.id);
    // 2. entity -> current goal/intent (live canonical mind state, not a telemetry copy)
    expect(entity.mind.goal?.type).toBe('idle');
    // 3. anomaly -> relevant events (no manual search of the full event log required)
    expect(stuck!.relatedEvents.length).toBeGreaterThan(0);
    expect(stuck!.relatedEvents.every(id => ids.includes(id))).toBe(true);
    const firstEvent = tw.world.event(stuck!.relatedEvents[0])!;
    expect(firstEvent.type).toBe('path_failure');
    // 4. related event -> causal ancestry (empty here — these events have no upstream causes —
    // but the call must succeed and return exactly the traceable chain, not throw or scan
    // unrelated history).
    const ancestry = causalAncestry(tw.world, firstEvent.id);
    expect(ancestry.map(e => e.id)).toContain(firstEvent.id);
    // 5. -> back to live canonical state: the actor named in the traced event still resolves
    // to a real, current entity.
    expect(tw.world.person(firstEvent.actor!)).toBe(entity);
  });
});
