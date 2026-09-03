#!/usr/bin/env node
// Developer entry point for the headless world runner (v0.2 Part 1):
//   npm run sim -- --seed 918271 --days 30
//
// Node-only (uses node:fs via FileSink). Run with `tsx` (declared in devDependencies) so it
// executes the TypeScript sources directly — the same canonical World/Simulation the browser
// client uses, never a second implementation.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runHeadless } from './runner';
import { FileSink } from '../sim/telemetry/fileSink';
import { formatWorldRunSummary } from '../sim/history/summary';
import { formatChronicle } from '../sim/history/chronicle';

function parseArgs(argv: string[]): { seed: number; days: number } {
  let seed = Math.floor(Math.random() * 1_000_000);
  let days = 7;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') seed = Number(argv[++i]);
    else if (a === '--days') days = Number(argv[++i]);
    else if (a.startsWith('--seed=')) seed = Number(a.slice('--seed='.length));
    else if (a.startsWith('--days=')) days = Number(a.slice('--days='.length));
  }
  if (!Number.isFinite(seed)) throw new Error('--seed must be a number');
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
  return { seed, days };
}

async function main(): Promise<void> {
  const { seed, days } = parseArgs(process.argv.slice(2));
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-seed${seed}`;
  const outDir = join(process.cwd(), '.debug', 'headless', runId);
  await mkdir(outDir, { recursive: true });
  const sink = new FileSink(join(outDir, 'telemetry.jsonl'));

  console.log(`Torn Veil Online — headless run: seed=${seed} days=${days}`);
  console.log(`Output: ${outDir}`);
  const t0 = Date.now();
  const result = runHeadless({
    seed, days, sinks: [sink],
    onProgress: (d) => process.stdout.write(`\r  simulating... day ${d}/${days}`),
  });
  await sink.close();
  process.stdout.write('\n');
  console.log(`Simulated ${result.summary.simulatedWorldDays} world-day(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s wall-clock.\n`);

  await writeFile(join(outDir, 'summary.json'), JSON.stringify(result.summary, null, 2));
  await writeFile(join(outDir, 'chronicle.txt'), formatChronicle(result.chronicle));
  await writeFile(join(outDir, 'anomalies.json'), JSON.stringify(result.anomalies, null, 2));

  console.log(formatWorldRunSummary(result.summary));
  console.log('');
  console.log(`Wrote summary.json, chronicle.txt (${result.chronicle.length} entries), anomalies.json (${result.anomalies.length}), and telemetry.jsonl (${result.telemetry.records.length} records) to:`);
  console.log(`  ${outDir}`);

  if (result.anomalies.length) process.exitCode = 0; // anomalies are informational, not a failure signal
}

main().catch(err => { console.error(err); process.exitCode = 1; });
