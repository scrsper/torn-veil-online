import { formatScorecard } from './scorecard';
import type { ScenarioResult } from './types';

/** Console + human-readable report for one scenario across all its seeds (§5, §8). */
export function formatScenarioReport(result: ScenarioResult): string {
  const lines: string[] = [];
  for (const seedResult of result.seedResults) {
    lines.push(formatScorecard(result.title, seedResult));
    lines.push('');
    lines.push('-'.repeat(60));
    lines.push('');
  }
  lines.push(`SCENARIO '${result.title}': ${result.verdict} across ${result.seedResults.length} seed(s) — ${result.seedResults.map(r => `${r.seed}=${r.verdict}`).join(', ')}`);
  return lines.join('\n');
}

/** Machine-readable form (§17): findings + per-probe observation series, without the (large,
 * human-only) formatted trace text — traces are still present as structured `Finding.trace`. */
export function toJSON(results: ScenarioResult[]): unknown {
  return {
    generatedAt: new Date().toISOString(),
    overall: results.some(r => r.verdict === 'FAIL') ? 'FAIL' : results.some(r => r.verdict === 'DEGRADED') ? 'DEGRADED' : 'PASS',
    scenarios: results.map(r => ({
      scenarioId: r.scenarioId, title: r.title, verdict: r.verdict,
      seeds: r.seedResults.map(sr => ({
        seed: sr.seed, verdict: sr.verdict, wallClockMs: Math.round(sr.wallClockMs),
        findings: sr.findings,
        observationCount: sr.observations.length,
        lastObservation: sr.observations[sr.observations.length - 1] ?? null,
      })),
    })),
  };
}
