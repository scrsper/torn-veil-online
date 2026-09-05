import { runHeadless } from '../runner';
import { takeProbe, type ProbeContext } from './probe';
import { verdictOf } from './scorecard';
import { structuralFindingsFrom } from './invariants';
import { telemetryToEvents } from '../../sim/telemetry/anomaly';
import type { Observation, ScenarioResult, ScenarioSeedResult, ScenarioSpec } from './types';

/** Runs one scenario against one seed: the real `runHeadless` loop (same canonical
 * World/Simulation/village generation as everything else), probed at the scenario's configured
 * interval, checked against its invariants at every probe and its liveness conditions once over
 * the full series at the end. WorldLab never repairs or influences state — every call here is
 * read-only relative to the simulation itself. */
export function runScenarioSeed(scenario: ScenarioSpec, seed: number): ScenarioSeedResult {
  const t0 = performance.now();
  const observations: Observation[] = [];
  const findings: ScenarioSeedResult['findings'] = [];
  let ctx: ProbeContext | null = null;
  let prev: Observation | null = null;

  const result = runHeadless({
    seed, days: scenario.days, probeIntervalSeconds: scenario.probeIntervalSeconds,
    // v0.8 §P0-I: a multi-day WorldLab run needs more than the browser-session-sized default
    // ring buffer for the 24h-window anomaly checks to reliably still have that much telemetry
    // on hand at probe time (see `sim/telemetry/anomaly.ts`).
    telemetryCap: 200_000,
    onSetup: (world, sim) => {
      ctx = { seed, requestedDays: scenario.days, worldStart: world.now, startingPopulation: world.persons().filter(p => p.alive).length };
      scenario.setup?.(world, sim);
    },
    onProbe: (world, _sim, worldSeconds, telemetry) => {
      if (!ctx) return;
      const obs = takeProbe(ctx, world, worldSeconds, telemetry);
      observations.push(obs);
      for (const inv of scenario.invariants) findings.push(...inv.check(world, prev, obs));
      prev = obs;
    },
  });

  for (const l of scenario.liveness) findings.push(...l.check(result.world, observations));
  findings.push(...structuralFindingsFrom(result.world, telemetryToEvents(result.telemetry.records)));

  return {
    scenarioId: scenario.id, seed, verdict: verdictOf(findings), findings, observations,
    wallClockMs: performance.now() - t0,
  };
}

export function runScenario(scenario: ScenarioSpec, seeds?: number[]): ScenarioResult {
  const seedResults = (seeds ?? scenario.seeds).map(seed => runScenarioSeed(scenario, seed));
  const worst = seedResults.some(r => r.verdict === 'FAIL') ? 'FAIL' : seedResults.some(r => r.verdict === 'DEGRADED') ? 'DEGRADED' : 'PASS';
  return { scenarioId: scenario.id, title: scenario.title, seedResults, verdict: worst };
}
