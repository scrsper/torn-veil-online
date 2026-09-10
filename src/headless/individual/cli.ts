import { mkdirSync, writeFileSync } from 'node:fs';
import { runIndividualShowcase, individualMotivationComparison } from './showcase';
const report = { lineage: runIndividualShowcase(Number(process.argv[2] ?? 0)), motivation: individualMotivationComparison() };
mkdirSync('.debug/individual', { recursive: true });
writeFileSync('.debug/individual/showcase.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
