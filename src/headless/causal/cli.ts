#!/usr/bin/env node
// Causal Society — deterministic long-run causal-trace harness.
//
//   npm run causal:trace                                   # both scenarios, 30 world days
//   npm run causal:trace -- --scenario producer_struck
//   npm run causal:trace -- --days 60 --seed 1337
//
// Runs the exact same canonical World / Simulation / village generation as `npm run sim`, the
// WorldLab scenarios and the browser client, with NO player embodied. The `producer_struck`
// scenario seeds exactly one happening — a bandit's killing blow, through `Simulation.applyHit`,
// the same method every NPC fight goes through — and then only observes.
import { runCausalTrace, formatCausalReport, type CausalScenario } from './trace';

const ALL: CausalScenario[] = ['undisturbed', 'producer_struck'];

function main(): void {
  const argv = process.argv.slice(2);
  let scenario: string | null = null;
  let seed: number | null = null;
  let days: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (flag: string) => (a === flag ? argv[++i] : a.startsWith(flag + '=') ? a.slice(flag.length + 1) : null);
    const s = val('--scenario'); if (s) { scenario = s; continue; }
    const d = val('--seed'); if (d) { seed = Number(d); continue; }
    const n = val('--days'); if (n) { days = Number(n); continue; }
  }
  const scenarios = scenario ? ALL.filter(s => s === scenario) : ALL;
  if (!scenarios.length) {
    console.error(`Unknown scenario '${scenario}'. Known: ${ALL.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let notObserved = 0;
  for (const s of scenarios) {
    const report = runCausalTrace({ scenario: s, seed: seed ?? undefined, days: days ?? undefined });
    console.log(formatCausalReport(report));
    console.log('');
    notObserved += Object.values(report.acceptance).filter(v => !v.length).length;
  }
  if (notObserved) console.error(`${notObserved} acceptance item(s) not observed in these runs.`);
}

main();
