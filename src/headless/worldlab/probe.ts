import type { World } from '../../sim/core/world';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import { detectAnomalies } from '../../sim/telemetry/anomaly';
import { topSignificantEntities } from '../../sim/history/significance';
import { buildWorldRunSummary } from '../../sim/history/summary';
import { hungerBand, thirstBand, sleepBand } from '../../sim/core/physiology';
import { stockAt } from '../../sim/world/stock';
import { effectivePrice } from '../../sim/world/pricing';
import { isFood } from '../../sim/world/factory';
import type { EconomySnapshot, Observation, PersonBands } from './types';

export interface ProbeContext {
  seed: number;
  requestedDays: number;
  worldStart: number;
  startingPopulation: number;
}

function gini(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = v.length; if (!n) return 0;
  const sum = v.reduce((a, b) => a + b, 0); if (sum <= 0) return 0;
  let cum = 0; for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * v[i];
  return Math.round((cum / (n * sum)) * 1000) / 1000;
}
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length / 2)] * 100) / 100 : 0;
}

/** Cheapest unit price of any food currently for sale anywhere (what `buyFoodPortion` charges) —
 * shared logic with the independent audit's own probe, now promoted into WorldLab itself. */
function cheapestMealPrice(world: World): number {
  let best = Infinity;
  for (const it of world.items()) {
    if (it.holderId || !it.placeId || it.quantity <= 0 || !isFood(it.type)) continue;
    if (!it.ownerId || !world.person(it.ownerId)?.alive) continue;
    best = Math.min(best, effectivePrice(it.type, it.value ?? 2, stockAt(world, it.type, it.placeId)));
  }
  return Number.isFinite(best) ? best : Infinity;
}

/** v0.8 §P0-A: the decomposed economic snapshot — see `types.ts`'s `EconomySnapshot` doc for
 * why `spendableWealth`/`coinItems` are never collapsed into one figure. */
function economySnapshot(world: World): EconomySnapshot {
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  const wealths = alive.map(p => p.wealth);
  const spendableWealth = Math.round(wealths.reduce((a, b) => a + b, 0) * 100) / 100;
  let coinItems = 0;
  for (const it of world.items()) if (it.type === 'coins') coinItems += it.quantity ?? 0;
  const sorted = [...wealths].sort((a, b) => a - b);
  const q = Math.max(1, Math.floor(sorted.length / 4));
  const poorestQ = sorted.slice(0, q).reduce((a, b) => a + b, 0);
  const cheapest = cheapestMealPrice(world);
  return {
    spendableWealth, coinItems, totalCurrency: Math.round((spendableWealth + coinItems) * 100) / 100,
    gini: gini(wealths), medianWealth: median(wealths),
    poorestQuartileShare: spendableWealth > 0 ? Math.round((poorestQ / spendableWealth) * 1000) / 10 : 0,
    richestShare: spendableWealth > 0 && wealths.length ? Math.round((Math.max(...wealths) / spendableWealth) * 1000) / 10 : 0,
    cannotAffordAnyMeal: wealths.filter(w => w < cheapest).length,
    externalSinkAmount: world.runTally.supply_cost_amount ?? 0,
    wagesPaidAmount: world.runTally.wage_paid_amount ?? 0,
    purchasesAmount: world.runTally.purchase_amount ?? 0,
    wholesaleAmount: world.runTally.wholesale_amount ?? 0,
    rewardsPaidAmount: world.runTally.reward_paid_amount ?? 0,
  };
}

/** v0.8 §P0-C: cheap per-person severity snapshot — no event scanning, just the same live
 * `Person.needs`-derived bands the simulation itself already computes every strategic tick. */
function personBandsSnapshot(world: World): Record<string, PersonBands> {
  const out: Record<string, PersonBands> = {};
  for (const p of world.persons()) {
    if (!p.alive || p.controlled) continue;
    out[p.id] = { hunger: hungerBand(p), thirst: thirstBand(p), sleep: sleepBand(p) };
  }
  return out;
}

function maxOpenHaulTaskAgeHours(world: World): number {
  let max = 0;
  for (const t of world.haulTasks) {
    if (t.status !== 'claimed' && t.status !== 'in_transit') continue;
    max = Math.max(max, (world.now - t.updatedAt) / SECONDS_PER_HOUR);
  }
  return Math.round(max * 10) / 10;
}
function maxActiveConflictAgeHours(world: World): number {
  let max = 0;
  for (const c of world.conflicts) {
    if (c.status !== 'active') continue;
    max = Math.max(max, (world.now - c.lastMeaningfulInteraction) / SECONDS_PER_HOUR);
  }
  return Math.round(max * 10) / 10;
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
    economy: economySnapshot(world),
    personBands: personBandsSnapshot(world),
    maxOpenHaulTaskAgeHours: maxOpenHaulTaskAgeHours(world),
    maxActiveConflictAgeHours: maxActiveConflictAgeHours(world),
    alivePopulation: summary.endingPopulation,
    summary,
    anomalies,
  };
}
