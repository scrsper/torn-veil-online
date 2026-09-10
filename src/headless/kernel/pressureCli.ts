import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PRESSURE_CONDITIONS, runPressure } from './pressure';
import { runKnowledgeHistory } from './knowledgeHistory';
const seed = Number(process.argv[2] ?? 918271);
const reports = PRESSURE_CONDITIONS.map(c => runPressure(seed, c).report);
const knowledge = (['shared', 'private', 'holder_lost'] as const).map(c => runKnowledgeHistory(seed, c));
const hash = createHash('sha256').update(JSON.stringify({ reports, knowledge })).digest('hex');
mkdirSync('.debug/pressure', { recursive: true });
writeFileSync(`.debug/pressure/${seed}.json`, JSON.stringify({ hash, reports, knowledge }, null, 2));
console.log(JSON.stringify({ hash, results: reports.map(({ goals, observations, transforms, trials, ...r }) => ({ ...r, trials: trials.map(t => t.reason), transforms: transforms.length, firstQuote: observations[0]?.quote })),
  knowledge: knowledge.map(k => ({ condition: k.condition, livingMethodHolders: k.livingMethodHolders.length, recipientOutputLitres: k.people[1].outputLitres, saved: k.kernelPreserved && k.knowledgePreserved })) }, null, 2));
if (!(reports[0].output > 0 && reports[0].grain < 30 && reports[0].transforms.some(t => t.how === 'milled') && reports[1].methods > 0 && reports[1].output > 0 && reports[2].energyJ === 0 && reports[2].output < reports[1].output && reports[3].output === 0 && reports[4].output === 0 && reports[4].transforms.length === 0)) process.exitCode = 1;
if (!(knowledge.every(k => k.discoveredBeforeIntervention === 1 && k.kernelPreserved && k.knowledgePreserved) && knowledge[0].livingMethodHolders.length === 2 && knowledge[0].people[1].outputLitres > 0 && knowledge[1].livingMethodHolders.length === 1 && knowledge[1].people[1].outputLitres === 0 && knowledge[2].livingMethodHolders.length === 0)) process.exitCode = 1;
