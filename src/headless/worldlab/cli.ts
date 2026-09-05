#!/usr/bin/env node
// WorldLab developer entry point (v0.8 §8/§17):
//   npm run world:smoke
//   npm run world:check
//   npm run world:soak
//   npm run world:check -- --scenario baseline-village --seeds 918271,42424242 --days 30
//
// Runs the exact same canonical World/Simulation/village generation as `npm run sim` and the
// browser client — WorldLab only observes it (see docs/WORLDLAB.md).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENARIOS, scenarioById } from './scenarios';
import { runScenario } from './matrix';
import { formatScenarioReport, toJSON } from './report';
import type { ScenarioResult, ScenarioSpec, Tier } from './types';

interface CliArgs { tier: Tier; scenario: string | null; seeds: number[] | null; days: number | null; }

function parseArgs(argv: string[]): CliArgs {
  let tier: Tier = 'check';
  let scenario: string | null = null;
  let seeds: number[] | null = null;
  let days: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (flag: string) => a === flag ? argv[++i] : a.startsWith(flag + '=') ? a.slice(flag.length + 1) : null;
    const t = val('--tier'); if (t) { tier = t as Tier; continue; }
    const s = val('--scenario'); if (s) { scenario = s; continue; }
    const sd = val('--seeds'); if (sd) { seeds = sd.split(',').map(Number); continue; }
    const d = val('--days'); if (d) { days = Number(d); continue; }
  }
  return { tier, scenario, seeds, days };
}

/** §8 tiers: smoke is fast enough for every dev iteration; check is the standard pre-milestone
 * bar; soak is the long overnight/milestone validation. All three run the exact same
 * invariant/liveness checks — only seed count and duration change. */
function applyTier(scenario: ScenarioSpec, tier: Tier, overrideSeeds: number[] | null, overrideDays: number | null): ScenarioSpec {
  const days = overrideDays ?? (tier === 'smoke' ? Math.min(2, scenario.days) : tier === 'soak' ? Math.max(scenario.days * 4, 45) : scenario.days);
  const seedCount = tier === 'smoke' ? 1 : tier === 'soak' ? scenario.seeds.length : Math.min(scenario.seeds.length, 3);
  const seeds = overrideSeeds ?? scenario.seeds.slice(0, seedCount);
  return { ...scenario, days, seeds };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = args.scenario ? [scenarioById(args.scenario)].filter((s): s is ScenarioSpec => !!s) : SCENARIOS;
  if (args.scenario && !scenarios.length) {
    console.error(`Unknown scenario '${args.scenario}'. Known scenarios: ${SCENARIOS.map(s => s.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`WorldLab (${args.tier} tier) — ${scenarios.length} scenario(s)`);
  const results: ScenarioResult[] = [];
  for (const spec of scenarios) {
    const tiered = applyTier(spec, args.tier, args.seeds, args.days);
    console.log(`\n== ${tiered.title} (seeds ${tiered.seeds.join(',')}, ${tiered.days}d) ==`);
    const result = runScenario(tiered);
    results.push(result);
    console.log(formatScenarioReport(result));
  }

  const overall = results.some(r => r.verdict === 'FAIL') ? 'FAIL' : results.some(r => r.verdict === 'DEGRADED') ? 'DEGRADED' : 'PASS';
  console.log(`\n${'='.repeat(60)}\nWORLDLAB OVERALL: ${overall}`);

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${args.tier}`;
  const outDir = join(process.cwd(), '.debug', 'worldlab', runId);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'report.json'), JSON.stringify(toJSON(results), null, 2));
  console.log(`\nWrote machine-readable report to ${outDir}/report.json`);

  // §17: a real invariant/liveness FAILURE exits non-zero; warnings (DEGRADED) do not.
  process.exitCode = overall === 'FAIL' ? 1 : 0;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
