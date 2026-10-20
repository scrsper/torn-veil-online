import { mkdirSync, writeFileSync } from 'node:fs';
import { levelingReport } from './report';

const report = levelingReport();
mkdirSync('.debug/leveling', { recursive: true });
writeFileSync('.debug/leveling/report.json', JSON.stringify(report, null, 2));
for (const [section, rows] of Object.entries(report)) {
  console.log(`\n## ${section}`);
  console.table((rows as object[]).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]))));
}
console.log('\nWritten to .debug/leveling/report.json');
