import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ecologyScenario, advanceEcology, ecologySnapshot } from './scenarios';
import { ecologyQueries } from '../../sim/ecology/sensing';

const started = performance.now();
const report: Record<string, unknown> = {};
for (const seed of [701, 711]) {
  const world = ecologyScenario(seed), history = [ecologySnapshot(world)];
  for (const days of [10, 40, 50]) { advanceEcology(world, days); history.push(ecologySnapshot(world)); }
  report[`healthy_${seed}`] = history;
}
const crowded = ecologyScenario(702, 48, { foodKg: 5 });
crowded.resourceNodes = crowded.resourceNodes.filter(n => n.kind === 'surface_water' || n.pos.x < 24);
const forage = crowded.resourceNodes.filter(n => n.kind === 'forage');
for (const node of forage) node.remaining = node.capacity = 5 / forage.length;
const pressure = [ecologySnapshot(crowded)];
for (const days of [3, 7, 10, 30]) { advanceEcology(crowded, days); pressure.push(ecologySnapshot(crowded)); }
report.overcrowded = pressure;
const dry = ecologyScenario(703, 6, { water: false });
advanceEcology(dry, 10); report.water_scarcity = ecologySnapshot(dry);
const scale = ecologyScenario(719, 1000, { size: 256 });
for (const [i, animal] of scale.creatures().entries()) scale.body(animal.bodies[0])!.pos = { x: 4.5 + i % 32 * 7, y: 1, z: 4.5 + Math.floor(i / 32) * 7 };
const queries = ecologyQueries(scale), before = queries.resources.candidates, start = performance.now();
advanceEcology(scale, 1);
report.performance = { individuals: 1000, days: 1, quantumSeconds: 900, elapsedMs: +(performance.now() - start).toFixed(1),
  resourceNodes: scale.resourceNodes.length, resourceCandidates: queries.resources.candidates - before, pathSearches: scale.nav.searches,
  snapshot: ecologySnapshot(scale) };
report.elapsedMs = +(performance.now() - started).toFixed(1);
writeFileSync('docs/ecology-acceptance.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
