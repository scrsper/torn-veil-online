import { mkdirSync, writeFileSync } from 'node:fs';
import { runAgencyWorldLab } from './agency';
import { runCapabilityWorldLab } from './capability';

const report = runAgencyWorldLab(Number(process.argv[2] ?? 741));
mkdirSync('.debug/worldlab', { recursive: true });
writeFileSync('.debug/worldlab/agency.json', JSON.stringify(report, null, 2));
const capability = runCapabilityWorldLab();
writeFileSync('.debug/worldlab/capability.json', JSON.stringify(capability, null, 2));
console.log(JSON.stringify({ seed: report.seed, digest: report.digest, invariantErrors: report.invariantErrors, saveReplayMatches: report.outcomes.saveReplayMatches,
  capabilityPersisted: capability.persistenceMatches, fixtureAdvanced: capability.breakthroughFixture.advanced, artifacts: ['.debug/worldlab/agency.json', '.debug/worldlab/capability.json'] }, null, 2));
if (report.invariantErrors.length || !report.outcomes.saveReplayMatches || !capability.persistenceMatches || !capability.breakthroughFixture.advanced) process.exitCode = 1;
