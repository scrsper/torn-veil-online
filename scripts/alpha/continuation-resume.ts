import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SECONDS_PER_DAY } from '../../src/sim/core/time';
import type { Finding } from '../../src/headless/worldlab/types';

/** Resume only a finished segment's exact final save; never a live report/day checkpoint pair. */
export function readContinuationResume(directory: string, seed: number, days: number) {
  const source = resolve(directory);
  const reportRaw = readFileSync(join(source, 'report.json'), 'utf8');
  const report = JSON.parse(reportRaw);
  assert(['failed', 'complete'].includes(report.status), 'Source segment must have finished');
  assert(report.seed === seed && report.days === days, 'Seed and total requested days must match');
  assert(report.stepSeconds === 1 / 60 && report.timeScale === 6
    && Array.isArray(report.skippedSystems) && report.skippedSystems.length === 0
    && report.path === 'BridgeSession.stepAll → Simulation.stepScheduled', 'Unrecognised execution path');
  assert(Number.isFinite(report.completedDays) && report.completedDays > 0
    && report.completedDays < days, 'Source must be a partial continuation');
  assert(Number.isSafeInteger(report.ticks) && report.ticks > 0
    && Number.isFinite(report.elapsedSeconds) && report.elapsedSeconds >= 0, 'Missing final counters');
  assert(Array.isArray(report.findings) && report.findings.every((f: Finding) =>
    f && typeof f.id === 'string' && ['warning', 'failure'].includes(f.severity)), 'Missing findings');
  assert(report.eventCounts && Object.values(report.eventCounts).every(n =>
    Number.isSafeInteger(n) && Number(n) >= 0) && Array.isArray(report.episodes), 'Missing event evidence');
  const save = readFileSync(join(source, 'final.save.json'), 'utf8');
  const saveHash = createHash('sha256').update(save).digest('hex');
  if (report.finalSaveSha256) assert(report.finalSaveSha256 === saveHash, 'Final save hash mismatch');
  const data = JSON.parse(save);
  assert(data.seed === seed && data.clock?.timeScale === report.timeScale
    && JSON.stringify(data.geography) === JSON.stringify(report.geography), 'Final save identity mismatch');
  assert(data.execution?.version === 1, 'Missing persisted scheduler state');
  assert(Number.isFinite(data.physicalTime)
    && Math.abs(data.physicalTime - report.ticks / 60) < .01, 'Final save tick mismatch');
  assert(Math.abs(report.completedDays * SECONDS_PER_DAY - data.physicalTime * report.timeScale) < .1,
    'Final elapsed-days mismatch');
  const worldStart = data.clock.worldSeconds - report.completedDays * SECONDS_PER_DAY;
  assert(Number.isFinite(worldStart) && (!Number.isFinite(report.worldStart)
    || Math.abs(worldStart - report.worldStart) < .01), 'Final save world-time mismatch');
  // Older segments did not put the initial population in report.json. Their first
  // observation is retained; do not reset a cumulative baseline to the current population.
  const startingPopulation = report.startingPopulation ?? JSON.parse(
    readFileSync(join(source, 'observations.jsonl'), 'utf8').split('\n')[0]).living;
  assert(Number.isSafeInteger(startingPopulation) && startingPopulation > 0, 'Missing starting population');
  return { save, worldStart, ticks: report.ticks as number,
    completedDays: report.completedDays as number,
    findings: report.findings as Finding[], counts: report.eventCounts as Record<string, number>,
    episodes: report.episodes as unknown[], previousElapsedSeconds: report.elapsedSeconds as number,
    startingPopulation: startingPopulation as number,
    provenance: { directory: source, saveSha256: saveHash,
      reportSha256: createHash('sha256').update(reportRaw).digest('hex'),
      sourceStatus: report.status, sourceCompletedDays: report.completedDays,
      priorHashAvailable: typeof report.finalSaveSha256 === 'string' } };
}
