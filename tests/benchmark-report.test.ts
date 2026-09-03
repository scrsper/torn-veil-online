import { describe, expect, it } from 'vitest';
import { runHeadless } from '../src/headless/runner';
import { buildBenchmarkReport, canonicalStateHash, benchmarkReportPath } from '../src/headless/benchmarkReport';

// Small `days` value so the suite stays fast — see headless-benchmarks.test.ts's own note;
// the report-building mechanism under test doesn't change with run length.
const SHORT_DAYS = 0.05;

describe('machine-comparable benchmark report (v0.2.1 Priority 10)', () => {
  it('produces every documented field, all derived (never invented) from the actual run', () => {
    const result = runHeadless({ seed: 918271, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const report = buildBenchmarkReport(result, { seed: 918271, requestedDays: SHORT_DAYS, runtimeMs: 1234 });

    expect(report.seed).toBe(918271);
    expect(report.requestedDays).toBe(SHORT_DAYS);
    expect(report.runtimeMs).toBe(1234);
    expect(report.canonicalEventCount).toBe(result.world.events.length);
    expect(report.chronicleEntryCount).toBe(result.chronicle.length);
    expect(report.population.start).toBe(result.summary.startingPopulation);
    expect(report.population.end).toBe(result.summary.endingPopulation);
    expect(report.deaths).toBe(result.summary.deaths.total);
    expect(report.conflicts).toBe(result.summary.violentIncidents);
    expect(report.robberies).toBe(result.summary.robberies);
    expect(report.knowledgeTransfers).toBe(result.summary.knowledgeTransfers);
    expect(report.pathfindingFailures).toBe(result.summary.pathFailures);
    expect(report.factionChanges).toEqual({ leadership: result.summary.leadershipChanges, membership: result.summary.factionMembershipChanges });
    expect(report.topSignificantEntities.length).toBeGreaterThan(0);
    expect(report.topSignificantEntities.length).toBeLessThanOrEqual(10);
    // appVersion comes from package.json and commit from git — both may vary by environment,
    // but must at least be present in the documented shape (string, or null for commit if git
    // is genuinely unavailable — never a fabricated placeholder).
    expect(typeof report.appVersion).toBe('string');
    expect(report.commit === null || typeof report.commit === 'string').toBe(true);
    expect(/^[0-9a-f]{8}$/.test(report.stateHash)).toBe(true);
  });

  it('groups anomaly findings by type rather than repeating the raw anomaly list', () => {
    const result = runHeadless({ seed: 918271, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const report = buildBenchmarkReport(result, { seed: 918271, requestedDays: SHORT_DAYS, runtimeMs: 1 });
    const types = new Set(result.anomalies.map(a => a.type));
    expect(report.anomalyGroups.length).toBe(types.size);
    for (const g of report.anomalyGroups) {
      expect(g.count).toBe(result.anomalies.filter(a => a.type === g.type).length);
    }
  });

  it('canonicalStateHash is identical for two runs at the same seed and duration (determinism), and does not require anomalies/timing/telemetry to match', () => {
    const a = runHeadless({ seed: 55, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const b = runHeadless({ seed: 55, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    expect(canonicalStateHash(a.world)).toBe(canonicalStateHash(b.world));
  });

  it('canonicalStateHash differs across distinct seeds (not a constant/degenerate hash)', () => {
    const a = runHeadless({ seed: 1, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    const c = runHeadless({ seed: 2, days: SHORT_DAYS, maintenanceIntervalSeconds: 300 });
    expect(canonicalStateHash(a.world)).not.toBe(canonicalStateHash(c.world));
  });

  it('benchmarkReportPath names the artifact by seed and requested day count', () => {
    expect(benchmarkReportPath(918271, 7)).toBe('.debug/benchmarks/918271-7d-summary.json');
  });
});
