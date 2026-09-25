import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeSession } from '../src/bridge/session';
import { SECONDS_PER_DAY } from '../src/sim/core/time';
import { readContinuationResume } from '../scripts/alpha/continuation-resume';

let root: string, session: BridgeSession, saved: string, report: Record<string, unknown>;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tvo-continuation-resume-'));
  session = new BridgeSession(918271, { playable: true, defaultPlayer: false });
  const worldStart = session.world.now, startingPopulation = session.world.livingPersons().length;
  for (let i = 1; i <= 7; i++) session.stepAll(i * 1000 / 60);
  saved = session.save();
  report = { status: 'failed', seed: 918271, days: 7, timeScale: 6, stepSeconds: 1 / 60,
    skippedSystems: [], path: 'BridgeSession.stepAll → Simulation.stepScheduled', ticks: 7,
    completedDays: (session.world.now - worldStart) / SECONDS_PER_DAY, worldStart, startingPopulation,
    elapsedSeconds: 12, geography: session.world.geography?.spec, episodes: [], eventCounts: { sample: 2 },
    // Evidence fixture: inherited failures must stay failures across a harness restart.
    findings: [{ id: 'retained-fixture', kind: 'invariant', severity: 'failure' }],
    finalSaveSha256: createHash('sha256').update(saved).digest('hex') };
  writeFileSync(join(root, 'observations.jsonl'), JSON.stringify({ living: startingPopulation }) + '\n');
}, 30000);
afterAll(() => {
  expect(resolve(root).startsWith(join(tmpdir(), 'tvo-continuation-resume-'))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});
function write(change: Record<string, unknown> = {}, save = saved) {
  writeFileSync(join(root, 'report.json'), JSON.stringify({ ...report, ...change }));
  writeFileSync(join(root, 'final.save.json'), save);
}
it('keeps origin, counters, failure evidence and persisted scheduler phase across resume', () => {
  write();
  const resume = readContinuationResume(root, 918271, 7);
  expect(resume.worldStart).toBe(report.worldStart);
  expect(resume.findings).toEqual(report.findings);
  expect(resume.counts).toEqual({ sample: 2 });
  expect(resume.previousElapsedSeconds).toBe(12);
  const restored = new BridgeSession(918271, { save: resume.save, defaultPlayer: false });
  for (let i = 8; i <= 15; i++) { session.stepAll(i * 1000 / 60); restored.stepAll(i * 1000 / 60); }
  expect(restored.world.now).toBe(session.world.now);
  expect(restored.world.rng.state()).toBe(session.world.rng.state());
  expect(restored.world.executionSnapshot?.()).toEqual(session.world.executionSnapshot?.());
  expect(restored.world.events).toEqual(session.world.events);
}, 30000);
it('rejects a running source, different seed/target, modified save, and mismatched final ticks', () => {
  write({ status: 'running' }); expect(() => readContinuationResume(root, 918271, 7)).toThrow('finished');
  write(); expect(() => readContinuationResume(root, 918272, 7)).toThrow('match');
  expect(() => readContinuationResume(root, 918271, 6)).toThrow('match');
  write({}, saved + ' '); expect(() => readContinuationResume(root, 918271, 7)).toThrow('hash');
  write({ ticks: 8 }); expect(() => readContinuationResume(root, 918271, 7)).toThrow('tick');
  write({ completedDays: 1 }); expect(() => readContinuationResume(root, 918271, 7)).toThrow('elapsed-days');
});
it('imports a legacy final pair with explicit absent-hash provenance and original population', () => {
  write({ finalSaveSha256: undefined, startingPopulation: undefined, worldStart: undefined });
  const before = readFileSync(join(root, 'final.save.json'), 'utf8');
  const resume = readContinuationResume(root, 918271, 7);
  expect(resume.provenance.priorHashAvailable).toBe(false);
  expect(resume.startingPopulation).toBe(report.startingPopulation);
  expect(resume.worldStart).toBe(report.worldStart);
  expect(readFileSync(join(root, 'final.save.json'), 'utf8')).toBe(before);
});
