import type { World } from '../../sim/core/world';
import { detectAnomalies } from '../../sim/telemetry/anomaly';
import { topSignificantEntities } from '../../sim/history/significance';
import { buildWorldRunSummary } from '../../sim/history/summary';
import type { Observation } from './types';

export interface ProbeContext {
  seed: number;
  requestedDays: number;
  worldStart: number;
  startingPopulation: number;
}

/** Direct, live-state figure `buildWorldRunSummary` has no reason to carry (see types.ts's
 * `Observation` doc) — every silver a person could possibly hold, summed once. */
function totalCurrency(world: World): number {
  let total = 0;
  for (const p of world.persons()) total += p.wealth;
  for (const it of world.items()) if (it.type === 'coins') total += it.quantity ?? 0;
  return total;
}

/** Read-only: takes one `Observation` snapshot of the live world. Safe to call at any point in
 * a run — never mutates `world`. */
export function takeProbe(ctx: ProbeContext, world: World, worldSecondsElapsed: number): Observation {
  const anomalies = detectAnomalies(world);
  const significance = topSignificantEntities(world, 10);
  const summary = buildWorldRunSummary(world, {
    seed: ctx.seed, requestedDays: ctx.requestedDays, worldStart: ctx.worldStart,
    startingPopulation: ctx.startingPopulation, anomalies, significance,
  });
  return {
    atWorldSeconds: worldSecondsElapsed,
    atWorldDays: Math.round((worldSecondsElapsed / 86400) * 1000) / 1000,
    totalCurrency: totalCurrency(world),
    alivePopulation: summary.endingPopulation,
    summary,
    anomalies,
  };
}
