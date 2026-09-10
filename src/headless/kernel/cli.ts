import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { advanceKernelLab, createKernelLab, kernelMetrics } from './lab';

const seed = Number(process.argv[2] ?? 918271);
const reports = [];
for (const family of ['grain', 'water'] as const) for (const control of [false, true]) {
  const lab = createKernelLab(seed, family, control);
  advanceKernelLab(lab.world, lab.sim, 80);
  const report = kernelMetrics(lab); reports.push(report);
  console.log(JSON.stringify(report, null, 2));
}
const held = createKernelLab(seed, 'water', false, true); advanceKernelLab(held.world, held.sim, 80);
reports.push(kernelMetrics(held)); console.log(JSON.stringify(reports.at(-1), null, 2));
const hash = createHash('sha256').update(JSON.stringify(reports)).digest('hex');
mkdirSync('.debug/kernel', { recursive: true });
writeFileSync(`.debug/kernel/${seed}.json`, JSON.stringify({ hash, reports }, null, 2));
console.log(`Deterministic report SHA256: ${hash}`);
if (reports.some(r => r.people.some((p, i) => r.control ? p.output !== 0 : p.output <= 0 || p.methods.length === 0 || p.acquired < 4 || (i === 1 && !p.methods.some(m => m.source === 'told'))))) process.exitCode = 1;
