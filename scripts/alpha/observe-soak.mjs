// Read-only wall-clock observation of a running isolated alpha service. No time acceleration.
// node scripts/alpha/observe-soak.mjs --root <environment> --out <new-directory> --seconds 7200
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; };
assert(arg('root') && arg('out'), '--root and --out required');
const root = resolve(arg('root')), out = resolve(arg('out')), seconds = Number(arg('seconds') ?? 7200);
assert(seconds >= 60 && seconds <= 14400 && !existsSync(out), 'Bounded duration and new evidence directory required');
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
const token = readFileSync(join(root, 'credentials', 'admin.token'), 'utf8').trim();
mkdirSync(out, { recursive: true });
const began = Date.now(), samples = [], errors = [];
writeFileSync(join(out, 'run.json'), JSON.stringify({ root, seconds, beganAt: new Date(began).toISOString(), pid: process.pid }, null, 2));
while (Date.now() - began < seconds * 1000) {
  const at = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/admin/status`, { headers: { 'x-torn-veil-admin': token }, signal: AbortSignal.timeout(5000) });
    assert(response.ok, `status HTTP ${response.status}`);
    const state = await response.json();
    const sample = { at: new Date().toISOString(), elapsedSeconds: (Date.now() - began) / 1000, responseMs: Date.now() - at, ...state };
    samples.push(sample); appendFileSync(join(out, 'samples.jsonl'), JSON.stringify(sample) + '\n');
  } catch (error) { const e = { at: new Date().toISOString(), error: String(error) }; errors.push(e); appendFileSync(join(out, 'errors.jsonl'), JSON.stringify(e) + '\n'); }
  const remaining = seconds * 1000 - (Date.now() - began);
  if (remaining > 0) await new Promise(r => setTimeout(r, Math.min(10_000, remaining)));
}
const first = samples[0], last = samples.at(-1), peak = read => Math.max(0, ...samples.map(read));
const checks = {
  completeDuration: Date.now() - began >= seconds * 1000,
  statusAvailable: errors.length === 0 && samples.length >= Math.floor(seconds / 11),
  sameWorld: !!first && samples.every(s => s.worldId === first.worldId),
  uninterruptedService: !!first && samples.every((s, i) => i === 0 || s.uptimeSeconds >= samples[i - 1].uptimeSeconds),
  clockAdvanced: !!last && last.world.physicalTime - first.world.physicalTime >= seconds * .95,
  rssUnder2GiB: peak(s => s.memory.rss) < 2 * 1024 ** 3,
  checkpointSerializationUnder250ms: peak(s => s.metrics.maxSerializeMs) <= 250,
  debtClears: !!last && last.scheduler.debtMs === 0,
  zeroClientPeriodObserved: samples.some(s => s.connections.length === 0),
};
const report = { kind: 'server-only realtime soak; client FPS/UI separate', root, requestedSeconds: seconds, elapsedSeconds: (Date.now() - began) / 1000,
  sampleCount: samples.length, checks, passed: Object.values(checks).every(Boolean), errors,
  peakRssBytes: peak(s => s.memory.rss), peakSerializeMs: peak(s => s.metrics.maxSerializeMs), peakDebtMs: peak(s => s.scheduler.debtMs),
  snapshotEventLoopP99ms: peak(s => s.eventLoopMs.p99), first: first?.world, last: last?.world,
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, report: join(out, 'report.json'), checks }));
process.exitCode = report.passed ? 0 : 1;
