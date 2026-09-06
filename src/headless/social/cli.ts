#!/usr/bin/env node
// v0.9 Social Causality — deterministic causal-trace harness.
//
//   npm run social:trace                       # every scenario
//   npm run social:trace -- --scenario assault # one
//   npm run social:trace -- --seed 1337
//
// Runs the exact same canonical World / Simulation / village generation as `npm run sim`, the
// WorldLab scenarios and the browser client. It seeds one triggering event through a canonical
// `Simulation` method and then only observes.
import { TRACE_SPECS, runSocialTrace, formatTrace } from './trace';

function main(): void {
  const argv = process.argv.slice(2);
  let scenario: string | null = null;
  let seed: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (flag: string) => (a === flag ? argv[++i] : a.startsWith(flag + '=') ? a.slice(flag.length + 1) : null);
    const s = val('--scenario'); if (s) { scenario = s; continue; }
    const d = val('--seed'); if (d) { seed = Number(d); continue; }
  }
  const specs = (scenario ? TRACE_SPECS.filter(s => s.id === scenario) : TRACE_SPECS)
    .map(s => (seed === null ? s : { ...s, seed }));
  if (!specs.length) {
    console.error(`Unknown scenario '${scenario}'. Known: ${TRACE_SPECS.map(s => s.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let failures = 0;
  for (const spec of specs) {
    const trace = runSocialTrace(spec);
    console.log(formatTrace(trace));
    console.log('');
    failures += trace.checks.filter(c => !c.pass).length;
  }
  if (failures) { console.error(`${failures} check(s) failed`); process.exitCode = 1; }
}

main();
