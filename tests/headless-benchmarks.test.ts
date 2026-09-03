import { describe, expect, it } from 'vitest';
import { runHeadless } from '../src/headless/runner';
import { detectAnomalies } from '../src/sim/telemetry/anomaly';

// These runs use a small `days` value (a fraction of a world-day) so the suite stays fast;
// the mechanism under test — a fixed-step, fully headless loop sharing the exact canonical
// World/Simulation the browser client uses — does not change with run length. Real multi-day
// exploratory runs (`npm run sim -- --seed 918271 --days 30`) are exercised manually and
// documented, with their performance characteristics, in docs/V0_2_WORLD_ENGINE.md.
const SHORT_DAYS = 0.05;

describe('headless benchmarks (v0.2 Part 16)', () => {
  it('Benchmark A — Player Absent: a fixed-seed run completes with no player and no renderer, and canonical state stays internally valid throughout', () => {
    const result = runHeadless({ seed: 918271, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });

    expect(result.world.persons().length).toBeGreaterThan(0);
    expect(result.summary.requestedDays).toBe(SHORT_DAYS);
    // Village generation always authors a "Traveler" player-slot entity (the same generation
    // code the browser client uses — Part 1 forbids a second implementation), but no renderer,
    // input, or `main.ts` ever ran: the entity simply sits controlled-and-idle, untouched by
    // this run, exactly as "no player" should look from the simulation's own point of view.
    if (result.world.playerId) {
      const player = result.world.person(result.world.playerId)!;
      expect(player.controlled).toBe(true);
      expect(result.world.events.some(e => e.actor === player.id)).toBe(false);
    }

    // Referential/causal integrity must hold even though nothing repaired it — these are the
    // same read-only checks Part 4's anomaly detector runs; a headless run producing dangling
    // causes or invalid entity references would mean the causal graph itself is broken, not
    // merely that something "interesting" happened.
    const anomalies = detectAnomalies(result.world);
    expect(anomalies.some(a => a.type === 'dangling_cause')).toBe(false);
    expect(anomalies.some(a => a.type === 'invalid_entity_reference')).toBe(false);

    // Every faction's leader, if any, must be a real, currently-known entity.
    for (const f of result.world.ofKind<import('../src/sim/core/types').Faction>('faction')) {
      if (f.leaderId) expect(result.world.get(f.leaderId)).toBeDefined();
    }

    // The run automatically explains itself: telemetry, a chronicle, and a structured summary
    // all exist without any manual "record" step (Part 3/5/18's core acceptance requirement).
    expect(result.telemetry.records.length).toBeGreaterThan(0);
    expect(Array.isArray(result.chronicle)).toBe(true);
    expect(result.summary.seed).toBe(918271);
  });

  it('Benchmark B — Deterministic Replay: the same seed and duration reproduce the same canonical history', () => {
    const a = runHeadless({ seed: 42, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const b = runHeadless({ seed: 42, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });

    expect(a.world.events.length).toBe(b.world.events.length);
    expect(a.world.events.map(e => e.type)).toEqual(b.world.events.map(e => e.type));
    expect(a.world.events.map(e => e.summary)).toEqual(b.world.events.map(e => e.summary));
    expect(a.summary).toEqual(b.summary);
    expect(a.chronicle.map(c => c.text)).toEqual(b.chronicle.map(c => c.text));
    expect(a.world.persons().map(p => ({ id: p.id, alive: p.alive, wealth: p.wealth }))).toEqual(
      b.world.persons().map(p => ({ id: p.id, alive: p.alive, wealth: p.wealth })),
    );
  });

  it('Benchmark C — Divergent Seed: a second seed remains internally valid and need not match the first', () => {
    const a = runHeadless({ seed: 1, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const c = runHeadless({ seed: 2, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });

    const anomaliesC = detectAnomalies(c.world);
    expect(anomaliesC.some(x => x.type === 'dangling_cause' || x.type === 'invalid_entity_reference')).toBe(false);
    expect(c.world.persons().length).toBeGreaterThan(0);
    // Not a strict requirement that they differ (a short enough window could coincidentally
    // match), but two different seeds over real village generation should not be identical.
    expect(a.world.events.length === c.world.events.length && JSON.stringify(a.summary) === JSON.stringify(c.summary)).toBe(false);
  });

  it('clamps the final step so simulated world time lands close to the requested duration rather than overshooting by a full substep*timeScale', () => {
    const result = runHeadless({ seed: 7, days: SHORT_DAYS });
    const requestedSeconds = SHORT_DAYS * 86400;
    expect(result.summary.simulatedWorldSeconds).toBeGreaterThanOrEqual(requestedSeconds - 1);
    expect(result.summary.simulatedWorldSeconds).toBeLessThan(requestedSeconds + 20); // one physical substep's worth of world-time slack, not a full extra chunk
  });
});
