import type { World } from '../../sim/core/world';
import { SECONDS_PER_HOUR } from '../../sim/core/time';
import type { Finding, LivenessCheck, Observation, PersonBands } from './types';
import { buildPersonTrace } from './trace';

/**
 * Individual/tail health (v0.8 §P0-C, §21 class 2 of 4): "did anyone eat today" is a village-wide
 * cumulative counter that stays green while a specific minority is permanently stranded — the
 * independent audit measured Skarn at ≥urgent hunger for 712 of 720 sampled world-hours while
 * every existing liveness check passed. These checks scan the per-person `personBands` snapshot
 * `probe.ts` now takes at every probe and report the true worst individual by name, not an
 * average.
 */
const DEPRIVATION_BOUND_HOURS = 48;

function finding(id: string, category: string, severity: 'warning' | 'failure', message: string, trace?: Finding['trace']): Finding {
  return { id, kind: 'liveness', class: 'individual', severity, category, message, trace };
}

interface Streak { personId: string; hours: number; }

/** Per person, the LONGEST run of consecutive probes where `need`'s band was >= urgent. Hours
 * are measured from the observation where the streak began to the one where it was longest —
 * exact to probe granularity, which is what makes this differ from (and correct) a per-day
 * average: a streak spanning many probes at a fine interval is measured precisely; at a coarse
 * interval it is still detected, just to within one probe's worth of resolution, which is more
 * than adequate for the multi-hundred-hour streaks this check exists to catch. */
function maxDeprivationStreaks(series: Observation[], need: keyof PersonBands): Streak[] {
  const ids = new Set<string>();
  for (const o of series) for (const id of Object.keys(o.personBands)) ids.add(id);
  const out: Streak[] = [];
  for (const id of ids) {
    let streakStart: number | null = null;
    let maxHours = 0;
    for (const o of series) {
      const band = o.personBands[id]?.[need];
      const bad = band === 'urgent' || band === 'critical';
      if (bad) {
        if (streakStart === null) streakStart = o.atWorldSeconds;
        maxHours = Math.max(maxHours, (o.atWorldSeconds - streakStart) / SECONDS_PER_HOUR);
      } else {
        streakStart = null;
      }
    }
    out.push({ personId: id, hours: Math.round(maxHours * 10) / 10 });
  }
  return out.sort((a, b) => b.hours - a.hours);
}

function percentile(sortedDesc: number[], p: number): number {
  if (!sortedDesc.length) return 0;
  const idx = Math.min(sortedDesc.length - 1, Math.floor((1 - p) * sortedDesc.length));
  return sortedDesc[idx];
}
function median(sortedDesc: number[]): number { return percentile(sortedDesc, 0.5); }

function deprivationCheck(need: keyof PersonBands, label: string, boundHours: number): LivenessCheck {
  return {
    id: `tail-${need}-deprivation-streak`, category: 'survival', boundHours,
    description: `No individual remains at >= urgent ${label} for more than ${boundHours} continuous world-hours.`,
    check: (world: World, series: Observation[]) => {
      const streaks = maxDeprivationStreaks(series, need);
      if (!streaks.length) return [];
      const hours = streaks.map(s => s.hours);
      const over = streaks.filter(s => s.hours > boundHours);
      if (!over.length) return [];
      const named = over.slice(0, 5).map(s => { const p = world.person(s.personId); return `${world.nameOf(s.personId)}${p ? `(${p.occupation})` : ''}=${s.hours}h`; }).join(', ');
      const worst = over[0];
      return [finding(
        `WL-${need.toUpperCase()}-DEPRIVED`, 'survival', 'failure',
        `${label} deprivation across ${streaks.length} villagers: median streak ${median(hours)}h, p90 ${percentile(hours, 0.9)}h, `
        + `p95 ${percentile(hours, 0.95)}h, max ${hours[0]}h; ${over.length} exceeded the ${boundHours}h bound: ${named}${over.length > 5 ? `, +${over.length - 5} more` : ''}.`,
        buildPersonTrace(world, 0, worst.personId, `WL-${need.toUpperCase()}-DEPRIVED`, `${label} deprivation streak`),
      )];
    },
  };
}

/** v0.8 §P0-A tail: the fraction of the village priced entirely out of the food market, sustained
 * — not a snapshot (a market can be briefly out of stock without being unaffordable). */
function purchasingPowerCheck(): LivenessCheck {
  const boundHours = 48;
  return {
    id: 'tail-purchasing-power', category: 'economy', boundHours,
    description: `No more than 25% of the village goes without the means to afford ANY food for more than ${boundHours} continuous world-hours.`,
    check: (world: World, series: Observation[]) => {
      let streakStart: number | null = null; let worstFraction = 0; let worstObs: Observation | null = null; let sawStuck = false; let stuckAt: Observation | null = null;
      for (const o of series) {
        const pop = Object.keys(o.personBands).length || 1;
        const fraction = o.economy.cannotAffordAnyMeal / pop;
        if (fraction > 0.25) {
          if (streakStart === null) streakStart = o.atWorldSeconds;
          const hours = (o.atWorldSeconds - streakStart) / SECONDS_PER_HOUR;
          if (fraction > worstFraction) { worstFraction = fraction; worstObs = o; }
          if (hours > boundHours) { sawStuck = true; stuckAt = o; }
        } else {
          streakStart = null;
        }
      }
      if (!sawStuck || !stuckAt || !worstObs) return [];
      return [finding(
        'WL-PURCHASING-POWER', 'economy', 'failure',
        `${Math.round(worstFraction * 100)}% of the village (${worstObs.economy.cannotAffordAnyMeal} of ${Object.keys(worstObs.personBands).length}) could not afford `
        + `ANY food anywhere in the village for over ${boundHours} continuous world-hours (still true at day ${stuckAt.atWorldDays}, median wealth ${stuckAt.economy.medianWealth}).`,
      )];
    },
  };
}

export const TAIL_CHECKS: LivenessCheck[] = [
  deprivationCheck('hunger', 'hunger', DEPRIVATION_BOUND_HOURS),
  deprivationCheck('thirst', 'thirst', DEPRIVATION_BOUND_HOURS),
  // Sleep debt recovers on a slower, legitimately multi-day natural cycle (a person who works a
  // long stretch then sleeps it off is not "stranded" the way permanent hunger/thirst is) — a
  // looser bound avoids false-positiving on ordinary busy schedules while still catching a
  // genuinely stuck sleepless person.
  deprivationCheck('sleep', 'sleep debt', 96),
  purchasingPowerCheck(),
];
