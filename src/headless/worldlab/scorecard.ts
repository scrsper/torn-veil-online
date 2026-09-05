import type { Finding, ScenarioSeedResult, Verdict } from './types';
import { formatTrace } from './trace';

const CATEGORY_ORDER = ['survival', 'agriculture', 'production', 'economy', 'logistics', 'cognition', 'construction', 'social'];
const CATEGORY_LABEL: Record<string, string> = {
  survival: 'SURVIVAL', agriculture: 'AGRICULTURE', production: 'PRODUCTION', economy: 'ECONOMY',
  logistics: 'LOGISTICS', cognition: 'COGNITION', construction: 'CONSTRUCTION', social: 'SOCIAL',
};

/** §4/§20: FAIL if any invariant/liveness finding is a hard failure, DEGRADED if only warnings
 * were found, PASS otherwise. Never a single opaque numeric score (§5). */
export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some(f => f.severity === 'failure')) return 'FAIL';
  if (findings.length) return 'DEGRADED';
  return 'PASS';
}

/** §5 "readable report": grouped by category, worst finding per category shown with its own
 * line, everything passing shown as one ✓ line — never collapsed into one opaque score. */
export function formatScorecard(title: string, result: ScenarioSeedResult): string {
  const lines: string[] = [];
  lines.push('TORN VEIL WORLD HEALTH');
  lines.push(`scenario: ${title}`);
  lines.push(`seed: ${result.seed}`);
  const days = result.observations.length ? result.observations[result.observations.length - 1].atWorldDays : 0;
  lines.push(`duration: ${days} day(s)`);
  lines.push('');
  const byCategory = new Map<string, Finding[]>();
  for (const f of result.findings) byCategory.set(f.category, [...(byCategory.get(f.category) ?? []), f]);
  const categories = [...new Set([...CATEGORY_ORDER, ...byCategory.keys()])].filter(c => byCategory.size === 0 ? CATEGORY_ORDER.includes(c) : true);
  for (const cat of categories) {
    const findings = byCategory.get(cat);
    if (!findings || !findings.length) continue;
    lines.push(CATEGORY_LABEL[cat] ?? cat.toUpperCase());
    for (const f of findings) {
      const mark = f.severity === 'failure' ? '✗' : '!';
      lines.push(`${mark} [${f.id}] ${f.message}`);
    }
    lines.push('');
  }
  if (!result.findings.length) { lines.push('✓ no invariant or liveness violations found'); lines.push(''); }
  lines.push(`OVERALL: ${result.verdict}`);
  const traces = result.findings.map(f => f.trace).filter((t): t is NonNullable<typeof t> => !!t);
  if (traces.length) {
    lines.push('');
    lines.push('CAUSAL TRACES');
    for (const t of traces) { lines.push(''); lines.push(formatTrace(t)); }
  }
  return lines.join('\n');
}
