// Accelerated wall-clock execution of the unchanged 60 Hz live session path; no skipped systems,
// injected goals, state edits, or time-scale changes. Each seed has an independent evidence directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { constants, setPriority } from 'node:os';
import { BridgeSession } from '../../src/bridge/session';
import { INVARIANTS } from '../../src/headless/worldlab/invariants';
import { takeProbe } from '../../src/headless/worldlab/probe';
import type { Finding, Observation } from '../../src/headless/worldlab/types';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../../src/sim/core/time';
import { readContinuationResume } from './continuation-resume';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
assert(arg('out') && arg('seed'), '--out and --seed required');
const out = resolve(arg('out')!), seed = Number(arg('seed')), days = Number(arg('days') ?? 7), timeoutSeconds = Number(arg('timeout-seconds') ?? 7200);
const continueAfterFindings = process.argv.includes('--continue-after-findings');
assert(!existsSync(out), 'Evidence directory must be new');
assert(Number.isInteger(seed) && days > 0 && days <= 7 && timeoutSeconds >= 60 && timeoutSeconds <= 14400);
mkdirSync(out, { recursive: true });
try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not needed for correctness */ }
const resume = arg('resume') ? readContinuationResume(arg('resume')!, seed, days) : null;
const started = performance.now(), session = new BridgeSession(seed, { playable: true, defaultPlayer: false, save: resume?.save });
const world = session.world, worldStart = resume?.worldStart ?? world.now, timeScale = world.clock.timeScale;
const startingPopulation = resume?.startingPopulation ?? world.livingPersons().length;
const ctx = { seed, requestedDays: days, worldStart, startingPopulation };
const findings: Finding[] = [...(resume?.findings ?? [])], counts: Record<string, number> = { ...resume?.counts };
const episodes: unknown[] = [...(resume?.episodes ?? [])];
world.onEvent(e => {
  counts[e.type] = (counts[e.type] ?? 0) + 1;
  if (episodes.length < 100 && ['protection_requested', 'animal_threat_display', 'attack', 'kill', 'theft', 'debt', 'returned_item', 'taught', 'veil_hush'].includes(e.type)) episodes.push(structuredClone(e));
});
session.sim.profile = {};
let previous: Observation | null = resume ? takeProbe(ctx, world, world.now - worldStart) : null;
let ticks = resume?.ticks ?? 0, nextProbe = world.now - worldStart;
let nextSave = (Math.floor((world.now - worldStart) / SECONDS_PER_DAY) + 1) * SECONDS_PER_DAY;
const report: Record<string, unknown> = { seed, days, timeScale, worldStart, startingPopulation,
  resume: resume?.provenance ?? null, startingObservation: previous,
  geography: world.geography?.spec, stepSeconds: 1 / 60, skippedSystems: [], continueAfterFindings,
  path: 'BridgeSession.stepAll → Simulation.stepScheduled', status: 'running', pid: process.pid };
const persistReport = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
persistReport();
try {
  if (findings.some(f => f.severity === 'failure') && !continueAfterFindings)
    throw new Error('Source has retained invariant failures; explicit --continue-after-findings required');
  while (world.now - worldStart < days * SECONDS_PER_DAY) {
    // Cooperative cancellation retains the exact final save and findings; never a pass.
    if (existsSync(join(out, 'STOP'))) throw new Error('Operator requested a stop at a completed simulation boundary');
    if ((performance.now() - started) / 1000 > timeoutSeconds) throw new Error(`Bounded continuation timed out after ${timeoutSeconds}s`);
    if (process.memoryUsage().rss >= 2 * 1024 ** 3) throw new Error('Continuation exceeded the 2 GiB RSS acceptance budget');
    for (let i = 0; i < 600 && world.now - worldStart < days * SECONDS_PER_DAY; ++i) { session.stepAll(++ticks * 1000 / 60); }
    const elapsed = world.now - worldStart;
    if (elapsed >= nextProbe) {
      const obs = takeProbe(ctx, world, elapsed);
      const current: Finding[] = INVARIANTS.flatMap(inv => inv.check(world, previous, obs));
      findings.push(...current); previous = obs;
      const progress = { day: elapsed / SECONDS_PER_DAY, elapsedSeconds: (performance.now() - started) / 1000, ticks, living: world.livingPersons().length, creatures: world.creatures().length, events: world.events.length, requests: world.requests.map(r => ({ id: r.id, type: r.type, status: r.status })), memory: process.memoryUsage(), findings: current };
      appendFileSync(join(out, 'observations.jsonl'), JSON.stringify(progress) + '\n');
      Object.assign(report, { progress, eventCounts: counts }); persistReport();
      nextProbe = elapsed + SECONDS_PER_HOUR;
      if (current.some(f => f.severity === 'failure') && !continueAfterFindings) throw new Error('Canonical invariant failure; see observations.jsonl');
    }
    if (elapsed >= nextSave) {
      const day = Math.floor(elapsed / SECONDS_PER_DAY);
      writeFileSync(join(out, `day-${day}.save.json`), session.save());
      nextSave += SECONDS_PER_DAY;
      console.log(JSON.stringify({ seed, day, elapsedSeconds: Math.round((performance.now() - started) / 1000), living: world.livingPersons().length }));
    }
    await new Promise<void>(r => setImmediate(r));
  }
  report.status = 'complete'; report.passed = !findings.some(f => f.severity === 'failure');
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.passed = false; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  const segmentElapsedSeconds = (performance.now() - started) / 1000;
  const finalSave = session.save();
  Object.assign(report, { completedDays: (world.now - worldStart) / SECONDS_PER_DAY,
    segmentElapsedSeconds, elapsedSeconds: segmentElapsedSeconds + (resume?.previousElapsedSeconds ?? 0),
    ticks, findings, eventCounts: counts, episodes, subsystemMilliseconds: session.sim.profile, memory: process.memoryUsage(),
    finalSaveSha256: createHash('sha256').update(finalSave).digest('hex') });
  writeFileSync(join(out, 'final.save.json'), finalSave); persistReport();
  console.log(JSON.stringify({ seed, status: report.status, completedDays: report.completedDays, report: join(out, 'report.json') }));
}
