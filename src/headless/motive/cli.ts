#!/usr/bin/env node
// v0.10 Motivated Lives — deterministic motivated-life causal traces.
//
//   npm run motive:trace                          # every scenario
//   npm run motive:trace -- --scenario family     # one
//   npm run motive:trace -- --seed 1337
//
// Runs the exact same canonical World / Simulation / village generation as `npm run sim`, the
// WorldLab scenarios, `npm run social:trace` and the browser client. Each scenario discloses
// its canonical setup, then observes autonomous behavior and actual consequences.
import { MOTIVE_SPECS, runMotiveTrace, formatMotiveTrace } from './trace';

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
  const specs = (scenario ? MOTIVE_SPECS.filter(s => s.id === scenario) : MOTIVE_SPECS)
    .map(s => (seed === null ? s : { ...s, seed }));
  if (!specs.length) {
    console.error(`Unknown scenario '${scenario}'. Known: ${MOTIVE_SPECS.map(s => s.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let failures = 0;
  for (const spec of specs) {
    const trace = runMotiveTrace(spec);
    console.log(formatMotiveTrace(trace));
    console.log('');
    failures += trace.checks.filter(c => !c.pass).length;
  }
  if (failures) { console.error(`${failures} check(s) failed`); process.exitCode = 1; }
}

main();
