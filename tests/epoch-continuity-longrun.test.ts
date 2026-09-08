import { describe, expect, it } from 'vitest';
import { runEpochWorldLab } from '../src/headless/worldlab/epoch';

const deterministicShape = (report: ReturnType<typeof runEpochWorldLab>) => ({
  stateHash: report.stateHash,
  totals: report.totals,
  final: report.final,
  yearly: report.yearsTelemetry.map(y => ({
    year: y.year, livingPopulation: y.livingPopulation, cumulativePeople: y.cumulativePeople,
    cumulativeEntities: y.cumulativeEntities, births: y.births, deaths: y.deaths,
    inheritances: y.inheritances, eventLogSize: y.eventLogSize,
    chronicleDetailedEntries: y.chronicleDetailedEntries, chronicleEraCount: y.chronicleEraCount,
  })),
});

describe('epoch demographic acceptance', () => {
  it('is non-monotonic, conserved, invariant-clean, and deterministic over five years', { timeout: 90_000 }, () => {
    const first = runEpochWorldLab({ seed: 1, years: 5 });
    const replay = runEpochWorldLab({ seed: 1, years: 5 });
    const populations = [first.initialLivingPopulation, ...first.yearsTelemetry.map(y => y.livingPopulation)];
    expect(first.totals.births).toBeGreaterThan(0);
    expect(first.totals.deaths).toBeGreaterThan(0);
    expect(populations.some((n, i) => i > 0 && n > populations[i - 1])).toBe(true);
    expect(populations.some((n, i) => i > 0 && n < populations[i - 1])).toBe(true);
    expect(first.final.bornDuringRunWithParents).toBe(first.final.bornDuringRunPeople);
    expect(first.final.inheritanceTransfers).toBeGreaterThan(0);
    expect(first.final.demographicHistoryEvents).toBeGreaterThanOrEqual(first.totals.births + first.totals.deaths + first.totals.inheritances);
    expect(first.final.deadPeople).toBeGreaterThan(0);
    expect(first.final.cumulativePeople).toBeGreaterThan(first.final.livingPopulation);
    expect(first.conservation.currencyUnexplainedDelta).toBeCloseTo(0, 6);
    expect(first.conservation.invalidItemOwners).toBe(0);
    expect(first.invariantErrors).toEqual([]);
    expect(deterministicShape(replay)).toEqual(deterministicShape(first));
  });

  it('sustains natural generations and compacted history for twenty-five years', { timeout: 180_000 }, () => {
    const report = runEpochWorldLab({ seed: 1, years: 25 });
    expect(report.yearsTelemetry).toHaveLength(25);
    expect(report.totals.births).toBeGreaterThan(1);
    expect(report.totals.deaths).toBeGreaterThan(1);
    expect(report.yearsTelemetry.slice(5).some(y => y.births > 0)).toBe(true);
    expect(report.final.bornDuringRunAdults).toBeGreaterThan(0);
    expect(report.final.bornDuringRunWithParents).toBe(report.final.bornDuringRunPeople);
    expect(report.final.maxLineageDepth).toBeGreaterThanOrEqual(3);
    expect(report.final.inheritanceTransfers).toBeGreaterThan(0);
    expect(report.final.cumulativePeople).toBeGreaterThan(report.final.livingPopulation);
    expect(report.final.chronicleEraCount).toBeGreaterThan(0);
    expect(report.final.chronicleDetailedEntries).toBeLessThan(250);
    expect(report.final.eventLogSize).toBeLessThan(12_000);
    expect(report.final.eventLogSize).toBeLessThan(report.yearsTelemetry[5].eventLogSize * 1.5);
    expect(report.conservation.currencyUnexplainedDelta).toBeCloseTo(0, 6);
    expect(report.conservation.invalidItemOwners).toBe(0);
    expect(report.invariantErrors).toEqual([]);
  });
});
