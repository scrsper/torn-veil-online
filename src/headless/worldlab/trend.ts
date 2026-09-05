import type { World } from '../../sim/core/world';
import type { Finding, LivenessCheck, Observation } from './types';

/**
 * Trend/sustainability health (v0.8 §P0-A/P1, §21 class 4 of 4): a world can look fine at any
 * single instant while heading predictably toward exhaustion. The independent audit measured
 * spendable currency falling 31-48% per simulated month with `currency-conservation` reporting a
 * perfect residual throughout (the drain was fully tracked, just never reported as a
 * TRAJECTORY), and a felled forest with no reachable regrowth within any run this project will
 * ever perform. Neither is a bug to "fix" by faking a source or shortening a regrow timer —
 * Constitution §64/§71 prefer an honestly-reported real constraint over a convenient fake one.
 * These checks exist to make the trajectory visible, not to force it to zero.
 */
function finding(id: string, category: string, severity: 'warning' | 'failure', message: string): Finding {
  return { id, kind: 'liveness', class: 'trend', severity, category, message };
}

/**
 * A world may legitimately have an open economy (village pays real money for imported goods —
 * `restockTavern`'s ale supply cost, tracked in `economy.externalSinkAmount`). That is fine as
 * long as it is causally accounted for AND the resulting trajectory is reported, not silently
 * certified as healthy because the loss is "explained". This extrapolates the observed decline
 * in SPENDABLE wealth (not `totalCurrency` — see `probe.ts`) and reports how far away exhaustion
 * actually is, rather than requiring exact constancy.
 */
function moneySupplySolvencyCheck(): LivenessCheck {
  return {
    id: 'trend-money-supply-solvency', category: 'economy', boundHours: 0,
    description: 'Extrapolates the observed decline in spendable village wealth; reports the projected trajectory rather than requiring exact conservation.',
    check: (_world: World, series: Observation[]) => {
      if (series.length < 4) return [];
      const first = series[0]; const last = series[series.length - 1];
      const spanDays = last.atWorldDays - first.atWorldDays;
      if (spanDays < 5) return []; // too short to distinguish a trend from noise
      const dropPerDay = (first.economy.spendableWealth - last.economy.spendableWealth) / spanDays;
      if (dropPerDay <= 0) return []; // flat or growing — not a drain
      const daysToZero = last.economy.spendableWealth / dropPerDay;
      const monthlyRatePct = first.economy.spendableWealth > 0 ? Math.round(100 * dropPerDay * 30 / first.economy.spendableWealth) : 0;
      if (monthlyRatePct < 5) return []; // a genuinely slow, sustainable drift is not worth reporting
      const sinkDelta = Math.round((last.economy.externalSinkAmount - first.economy.externalSinkAmount) * 10) / 10;
      const severity: 'warning' | 'failure' = monthlyRatePct >= 20 ? 'failure' : 'warning';
      return [finding('WL-MONEY-SUPPLY-TREND', 'economy', severity,
        `Spendable village wealth fell ${monthlyRatePct}%/month (${first.economy.spendableWealth} -> ${last.economy.spendableWealth} over ${spanDays.toFixed(0)} days, `
        + `~${dropPerDay.toFixed(1)}/day) with a tracked external sink of ${sinkDelta} over the same window and no offsetting income source — `
        + `at this rate spendable wealth reaches zero in ~${Math.round(daysToZero)} more days. The loss is fully accounted for; it is not sustainable.`)];
    },
  };
}

/**
 * `capacity / consumption_rate` vs. `regrow_period` (P1-D, previous audit §3.4): reports the
 * REAL arithmetic rather than letting a finite forest quietly run out unremarked. Deliberately
 * WARNING-only and does not, and must not, motivate shortening `regrowHours` — see the doc
 * comment on `resources.ts`'s `TREE_REGROW_HOURS`.
 */
function timberSustainabilityCheck(): LivenessCheck {
  return {
    id: 'trend-renewable-horizon', category: 'agriculture', boundHours: 0,
    description: 'Reports standing timber capacity against real regrowth time once the grove is materially depleted.',
    check: (world: World) => {
      const trees = world.resourceNodes.filter(n => n.kind === 'tree');
      if (!trees.length) return [];
      const standing = trees.reduce((a, n) => a + n.remaining, 0);
      const everCapacity = trees.reduce((a, n) => a + n.capacity, 0);
      if (everCapacity <= 0) return [];
      const fractionLeft = standing / everCapacity;
      if (fractionLeft > 0.15) return [];
      const regrowDays = Math.round((trees[0]?.regrowHours ?? 0) / 24);
      return [finding('WL-TIMBER-HORIZON', 'agriculture', 'warning',
        `Standing timber capacity is ${standing} of ${everCapacity} logs across ${trees.length} tracked trees (${Math.round(fractionLeft * 100)}% remaining); `
        + `a felled mature tree takes ~${regrowDays} world-days to regrow. This is a real, finite budget at the current stock size — not a bug, and not something `
        + `to fix by shortening regrowth (Constitution §64/§71): if more timber is genuinely needed, the fix is more/larger groves, not faster biology.`)];
    },
  };
}

export const TREND_CHECKS: LivenessCheck[] = [
  moneySupplySolvencyCheck(),
  timberSustainabilityCheck(),
];
