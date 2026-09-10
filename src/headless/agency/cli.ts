import { mkdirSync, writeFileSync } from 'node:fs';
import { runAgencyShowcase } from './showcase';
const report = runAgencyShowcase(Number(process.argv[2] ?? 741));
mkdirSync('.debug/agency', { recursive: true });
writeFileSync('.debug/agency/showcase.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ seed: report.seed, replayMatches: report.replayMatches, replayDifferences: report.replayDifferences, decisions: report.npcDecisions,
  output: report.canonical.assembly.output, laborSeconds: report.canonical.assembly.laborSeconds,
  repairs: report.causalEvents.filter(e => e.type === 'mechanism_worked').map(e => e.data), artifact: '.debug/agency/showcase.json' }, null, 2));
