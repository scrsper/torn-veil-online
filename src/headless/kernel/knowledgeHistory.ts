import { createKernelLab, advanceKernelLab, kernelMetrics } from './lab';
import { methodsHeld } from '../../sim/mind/invention';
import { getRel } from '../../sim/mind/relationships';
import { diePerson } from '../../sim/world/demographics';
import { deserialize, serialize } from '../../sim/persist/save';
import { Simulation } from '../../sim/mind/agent';

/** Relations and the loss of a holder are controlled initial conditions/interventions.
 * Discovery, willingness to teach, receipt of a claim, and construction remain autonomous. */
export function runKnowledgeHistory(seed: number, condition: 'shared' | 'private' | 'holder_lost') {
  const lab = createKernelLab(seed, 'water');
  if (condition !== 'shared') {
    const rel = getRel(lab.inventor, lab.recipient.id); rel.trust = -0.8; rel.affection = -0.8;
  }
  advanceKernelLab(lab.world, lab.sim, 40);
  const discoveredBeforeIntervention = methodsHeld(lab.inventor).length;
  if (condition === 'holder_lost') diePerson(lab.world, lab.inventor, undefined, 'controlled loss of the sole method holder');
  const loaded = deserialize(serialize(lab.world))!.world;
  const kernelPreserved = JSON.stringify(loaded.kernel) === JSON.stringify(lab.world.kernel);
  const knowledgePreserved = [lab.inventor, lab.recipient].every(p => JSON.stringify(loaded.person(p.id)!.knowledge) === JSON.stringify(p.knowledge));
  advanceKernelLab(loaded, new Simulation(loaded), 40);
  const metrics = kernelMetrics({ ...lab, world: loaded });
  return { condition, discoveredBeforeIntervention, kernelPreserved, knowledgePreserved,
    livingMethodHolders: [...loaded.livingPersons()].filter(p => methodsHeld(p).length > 0).map(p => p.id),
    people: metrics.people.map(p => ({ id: p.id, alive: loaded.person(p.id)!.alive, outputLitres: p.output, methods: p.methods, laborSeconds: p.laborSeconds, inputJ: p.inputJ, acquired: p.acquired })),
  };
}
