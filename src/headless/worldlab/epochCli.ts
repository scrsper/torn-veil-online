#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runEpochWorldLab } from './epoch';

function parse(argv: string[]): { seed: number; years: 1 | 5 | 25 } {
  let seed = 918271; let years: 1 | 5 | 25 = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') seed = Number(argv[++i]); else if (a.startsWith('--seed=')) seed = Number(a.slice(7));
    else if (a === '--years') years = Number(argv[++i]) as 1 | 5 | 25; else if (a.startsWith('--years=')) years = Number(a.slice(8)) as 1 | 5 | 25;
  }
  if (!Number.isFinite(seed) || ![1, 5, 25].includes(years)) throw new Error('--seed must be numeric and --years must be 1, 5, or 25');
  return { seed, years };
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  console.log(`WorldLab epoch tier — seed ${args.seed}, ${args.years} year(s)`);
  const report = runEpochWorldLab(args);
  console.table(report.yearsTelemetry.map(y => ({
    year: y.year, wall_s: +(y.wallMs / 1000).toFixed(2), heap_mb: +(y.heapUsedBytes / 1048576).toFixed(1),
    living: y.livingPopulation, people: y.cumulativePeople, entities: y.cumulativeEntities,
    births: y.births, deaths: y.deaths, inheritances: y.inheritances, events: y.eventLogSize,
    chronicle: y.chronicleDetailedEntries, eras: y.chronicleEraCount,
    ms_tick: +y.msPerTick.toFixed(3), us_tick_living: +(y.msPerTickPerLiving * 1000).toFixed(3),
  })));
  console.log(`Total ${(report.totalWallMs / 1000).toFixed(2)}s; births ${report.totals.births}, deaths ${report.totals.deaths}, inheritances ${report.totals.inheritances}.`);
  console.log(`Normalized first→last change: ${report.trend.normalizedChangePercent.toFixed(1)}%; living ${report.final.livingPopulation}, cumulative people ${report.final.cumulativePeople}, dead ${report.final.deadPeople}.`);
  console.log(`Born-during-run adults ${report.final.bornDuringRunAdults}; maximum lineage depth ${report.final.maxLineageDepth}.`);
  console.log(`State ${report.stateHash}; unexplained currency delta ${report.conservation.currencyUnexplainedDelta.toFixed(4)}; invalid item owners ${report.conservation.invalidItemOwners}.`);
  if (report.invariantErrors.length) { console.error(`Invariant failures: ${report.invariantErrors.join('; ')}`); process.exitCode = 1; }
  const outDir = join(process.cwd(), '.debug', 'worldlab', 'epoch');
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `seed${args.seed}-${args.years}y.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(`Wrote ${path}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
