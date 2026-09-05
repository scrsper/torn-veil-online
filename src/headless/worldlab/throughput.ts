import type { World } from '../../sim/core/world';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import { ENERGY_DRAIN_PER_HOUR } from '../../sim/core/physiology';
import { FOOD_HUNGER_RESTORE, GRAIN_CAP } from '../../sim/world/metabolism';
import type { Finding, LivenessCheck, Observation } from './types';

/**
 * Throughput/service health (v0.8 §P0-E, §21 class 3 of 4): "a resource transform happened" is
 * evidence the chain EXECUTED, not that it served demand. The independent audit measured grain
 * sawtoothing against `GRAIN_CAP` while bread stayed pinned under half its day-0 stock for 20
 * straight days, with 3466 `resource_shortage` events in 30 days that no existing check reads.
 */
function finding(id: string, category: string, severity: 'warning' | 'failure', message: string): Finding {
  return { id, kind: 'liveness', class: 'throughput', severity, category, message };
}

/**
 * Physiologically-derived requirement (not a tuned constant): a person's hunger reserve drains
 * at `ENERGY_DRAIN_PER_HOUR` per hour and one meal restores `FOOD_HUNGER_RESTORE` of it, so
 * simply staying fed over 24h needs `24 * ENERGY_DRAIN_PER_HOUR / FOOD_HUNGER_RESTORE` meals —
 * this self-updates if either constant is retuned, rather than silently drifting out of sync
 * with a hardcoded "2.1".
 */
const REQUIRED_MEALS_PER_DAY = (24 * ENERGY_DRAIN_PER_HOUR) / FOOD_HUNGER_RESTORE;

function nutritionAdequacyCheck(): LivenessCheck {
  return {
    id: 'throughput-nutrition-adequacy', category: 'survival', boundHours: 0,
    description: `Village-wide meals/person/day must not fall persistently below the physiologically-required rate (~${REQUIRED_MEALS_PER_DAY.toFixed(2)}).`,
    check: (_world: World, series: Observation[]) => {
      const last = series[series.length - 1];
      if (!last || last.atWorldDays < 3) return []; // too short a run to judge a rate meaningfully
      const pop = Math.max(1, last.alivePopulation);
      const rate = last.summary.metabolism.mealsEaten / (pop * last.atWorldDays);
      if (rate >= REQUIRED_MEALS_PER_DAY * 0.85) return []; // small tolerance — this is a rate, not an exact quota
      return [finding('WL-NUTRITION-DEFICIT', 'survival', 'failure',
        `Village consumed ${rate.toFixed(2)} meals/person/day against a physiologically-required rate of ~${REQUIRED_MEALS_PER_DAY.toFixed(2)} `
        + `(${last.summary.metabolism.mealsEaten} meals over ${last.atWorldDays} days, population ${pop}) — the food chain is executing but not adequately serving demand.`)];
    },
  };
}

/** FAIL if a downstream stock (bread) trends monotonically down over >=5 days while the upstream
 * stock (grain) sits at/near its cap — the exact "chain moves but backlog never clears" pattern
 * measured in the audit, distinct from a genuine, recovering shortage. */
function downstreamNotStarvingCheck(): LivenessCheck {
  const spanDays = 5;
  return {
    id: 'throughput-downstream-not-starving', category: 'production', boundHours: spanDays * 24,
    description: `Bread stock must not trend monotonically down for ${spanDays}+ days while grain sits at/near its cap.`,
    check: (_world: World, series: Observation[]) => {
      for (let i = 0; i < series.length; i++) {
        for (let j = i + 1; j < series.length; j++) {
          const spanHours = (series[j].atWorldSeconds - series[i].atWorldSeconds) / SECONDS_PER_HOUR;
          if (spanHours < spanDays * 24) continue;
          const window = series.slice(i, j + 1);
          const bread = window.map(o => o.summary.metabolism.stock.bread ?? 0);
          const grain = window.map(o => o.summary.metabolism.stock.grain ?? 0);
          const breadFalling = bread[bread.length - 1] < bread[0] && bread.every((v, k) => k === 0 || v <= bread[k - 1] + 1); // allow ±1 rounding noise
          const grainNearCap = grain.filter(v => v >= GRAIN_CAP * 0.8).length >= grain.length * 0.5;
          if (breadFalling && grainNearCap) {
            return [finding('WL-DOWNSTREAM-STARVED', 'production', 'failure',
              `Bread fell from ${bread[0]} to ${bread[bread.length - 1]} over ${spanHours.toFixed(0)}h (day ${series[i].atWorldDays}->${series[j].atWorldDays}) while grain sat `
              + `at/near its ${GRAIN_CAP}-unit cap the whole time (${grain[0]}->${grain[grain.length - 1]}) — the mill/bakery stage is the bottleneck, not raw supply.`)];
          }
          break;
        }
      }
      return [];
    },
  };
}

/** `resource_shortage` events per person per day, sustained — the audit measured ~3.6/person/day
 * for 30 straight days, all below `compactEvents`'s retention floor so invisible in the event
 * log; `world.runTally` survives compaction and is what this reads. */
function consumerBacklogCheck(): LivenessCheck {
  const boundPerPersonPerDay = 1.0;
  return {
    id: 'throughput-consumer-backlog', category: 'production', boundHours: 5 * 24,
    description: `resource_shortage events must stay under ${boundPerPersonPerDay}/person/day, sustained.`,
    check: (_world: World, series: Observation[]) => {
      const last = series[series.length - 1];
      if (!last || last.atWorldDays < 5) return [];
      const pop = Math.max(1, last.alivePopulation);
      const rate = last.summary.metabolism.resourceShortages / (pop * last.atWorldDays);
      if (rate <= boundPerPersonPerDay) return [];
      return [finding('WL-CONSUMER-BACKLOG', 'production', 'warning',
        `resource_shortage events averaged ${rate.toFixed(2)}/person/day over ${last.atWorldDays} days (${last.summary.metabolism.resourceShortages} total) — `
        + `sustained backlog, not occasional friction.`)];
    },
  };
}

export const THROUGHPUT_CHECKS: LivenessCheck[] = [
  nutritionAdequacyCheck(),
  downstreamNotStarvingCheck(),
  consumerBacklogCheck(),
];
