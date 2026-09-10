import { setExternalControl } from '../../sim/runtime/controllers';
import { createKernelLab, advanceKernelLab } from './lab';
import { methodsHeld } from '../../sim/mind/invention';
import { generateProductionNeeds } from '../../sim/world/production';
import { stockAt, stockItemsAt } from '../../sim/world/stock';
import { effectivePrice } from '../../sim/world/pricing';
import { ITEM_VALUE } from '../../sim/world/factory';
import { makeHousehold, joinHousehold } from '../../sim/world/household';

export interface PressureConditions { skill: number; primitiveKnowledge: boolean; sourceJ: number; curiosity?: number; fatigue?: number; grain?: number }
/** Change initial conditions, never selected goals or responses. All cases have the same
 * recurring canonical production demand. There is no practicalNeed/blueprint in the fixture. */
export function createPressureLab(seed: number, conditions: PressureConditions) {
  const lab = createKernelLab(seed, 'grain');
  const { world, inventor: p, recipient, place } = lab;
  world.clock.timeScale = 60;
  // Isolate this workshop demand from Ashford's unrelated authored shed project. No
  // construction response, goal, or inventory replenishment is supplied by this fixture.
  const projects = new Set(world.constructionProjects.map(p => p.id));
  world.constructionProjects = [];
  world.haulTasks = world.haulTasks.filter(t => !t.projectId || !projects.has(t.projectId));
  setExternalControl(recipient, true);
  place.type = 'mill'; place.ownerId = p.id; place.workers = [p.id]; p.workId = place.id;
  // The bin belongs to one productive household; other fixture stocks are kept elsewhere.
  for (const item of stockItemsAt(world, 'grain', place.id)) {
    if (item.ownerId !== p.id) { item.placeId = recipient.homeId = world.places().find(pl => pl.type === 'tavern')!.id; item.pos = { ...world.place(item.placeId)!.inside }; }
    else item.quantity = conditions.grain ?? 30;
  }
  for (const actor of [p, recipient]) {
    for (const k of Object.values(actor.knowledge)) if (k.claim.practicalNeed || k.claim.component) delete actor.knowledge[k.key];
  }
  // Prior craft capability and primitive education are possible initial conditions, not an
  // occupation gate. Every resident is still a 'villager' with an idle schedule.
  if (conditions.primitiveKnowledge) for (const d of world.kernel.ruleset.components)
    p.knowledge[`component:${d.id}`] = { key: `component:${d.id}`, kind: 'affordance', claim: { component: structuredClone(d) }, confidence: 1, source: { type: 'prior' }, learnedAt: world.now, hops: 0, sharedWith: [] };
  p.skills.milling = conditions.skill; p.traits.curiosity = conditions.curiosity ?? 0.7; p.physiology.fatigue = conditions.fatigue ?? 0.1;
  const energy = world.kernel.energy.find(e => e.ownerId === p.id)!; energy.initialJ = energy.remainingJ = conditions.sourceJ;
  energy.origin = `Finite ${conditions.sourceJ} J kinetic-energy parcel from a gust; initial boundary stock, no recharge.`;
  const household = makeHousehold(world, 'workshop household', place.id); joinHousehold(world, p, household);
  generateProductionNeeds(world);
  return { ...lab, conditions, household, startEnergy: p.physiology.energy };
}
export function pressureSnapshot(lab: ReturnType<typeof createPressureLab>) {
  const { world } = lab, p = world.person(lab.inventor.id)!;
  const output = stockAt(world, 'flour', lab.place.id), grain = stockItemsAt(world, 'grain', lab.place.id).filter(i => i.ownerId === p.id).reduce((n, i) => n + i.quantity, 0);
  const ours = world.events.filter(e => e.actor === p.id), assemblies = world.kernel.assemblies.filter(a => a.ownerId === p.id);
  return { seed: lab.seed, conditions: lab.conditions, output, grain, flourQuote: effectivePrice('flour', ITEM_VALUE.flour, output), energyJ: world.kernel.energy.find(e => e.ownerId === p.id)!.remainingJ,
    physiologyEnergy: p.physiology.energy, wealth: p.wealth, householdWealth: lab.household.wealth,
    assemblyLaborSeconds: assemblies.reduce((n, a) => n + a.laborSeconds, 0), methods: methodsHeld(p).length,
    paidBatchLaborSeconds: ours.filter(e => e.type === 'resource_transformed' || e.type === 'work_blocked').reduce((n, e) => n + Number(e.data.laborSeconds ?? 0), 0),
    completedRequests: world.requests.filter(r => r.type === 'production' && r.payload.placeId === lab.place.id && r.status === 'completed').length,
    goals: ours.filter(e => e.type === 'goal_changed').map(e => ({ type: e.data.to, utility: e.data.utility, summary: e.summary, causes: e.causes })),
    trials: ours.filter(e => e.type === 'mechanism_trial').map(e => e.data),
    transforms: ours.filter(e => e.type === 'resource_transformed').map(e => e.data),
    observations: ours.filter(e => e.type === 'production_observed').map(e => e.data),
  };
}
export function runPressure(seed: number, conditions: PressureConditions, seconds = 180) {
  const lab = createPressureLab(seed, conditions); advanceKernelLab(lab.world, lab.sim, seconds); return { lab, report: pressureSnapshot(lab) };
}

export const PRESSURE_CONDITIONS: PressureConditions[] = [
  { skill: 0.6, primitiveKnowledge: true, sourceJ: 5000 },
  { skill: 0, primitiveKnowledge: true, sourceJ: 5000 },
  { skill: 0, primitiveKnowledge: true, sourceJ: 260 },
  { skill: 0, primitiveKnowledge: false, sourceJ: 5000 },
  { skill: 0.6, primitiveKnowledge: false, sourceJ: 5000, grain: 0 },
];
