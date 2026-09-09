import { it, expect } from 'vitest';
import { runSettlementWorldLab } from '../src/headless/worldlab/settlements';
import { mkdirSync, writeFileSync } from 'node:fs';

it('advances four divergent societies together for seven detailed days and replays exactly', { timeout: 1800000 }, () => {
  const run = (seed: number, suffix: string) => {
    const report = runSettlementWorldLab({ seed, days: 7, mode: 'detailed', onProgress: day => { if (day % 365 === 0) console.log(`${suffix}: day ${day}`); } });
    mkdirSync('.debug/settlements', { recursive: true });
    writeFileSync(`.debug/settlements/${seed}-7d-detailed-${suffix}.json`, JSON.stringify(report, null, 2));
    return report;
  };
  const first = run(42, 'first');
  const replay = run(42, 'replay');
  const other = run(43, 'other');
  for (const r of [first, replay, other]) {
    expect(r.errors).toEqual([]);
    expect(r.settlements.length).toBe(4);
    expect(new Set(r.settlements.map(s => s.spec.seed)).size).toBe(4);
    expect(new Set(r.settlements.map(s => JSON.stringify(s.spec.resources))).size).toBe(4);
    expect(new Set(r.settlements.map(s => JSON.stringify(s.spec.residents))).size).toBe(4);
    expect(new Set(r.settlements.map(s => JSON.stringify(s.spec.history))).size).toBe(4);
    expect(Object.keys(r.histories).length).toBe(4);
    expect(new Set(Object.values(r.histories).map(h => JSON.stringify(h))).size).toBe(4);
    expect(Object.keys(r.earlyEconomies)).toHaveLength(4);
    expect(new Set(Object.values(r.earlyEconomies).map(e => JSON.stringify([e.grain, e.flour, e.bread, e.hungry]))).size).toBeGreaterThanOrEqual(3);
    expect(r.mode).toBe('detailed');
    expect(r.stepSeconds).toBe(0.15);
    expect(r.days).toBe(7);
  }
  expect(replay.hash).toBe(first.hash);
  expect(replay.histories).toEqual(first.histories);
  expect(other.hash).not.toBe(first.hash);
  console.log(JSON.stringify([first, other].map(r => ({ seed: r.seed, population: [r.initialPopulation, r.finalPopulation], wallMs: r.wallMs, msPerDayPerInitialPerson: r.msPerDayPerInitialPerson, samples: r.samples }))));
});
