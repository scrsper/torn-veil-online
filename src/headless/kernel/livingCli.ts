import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLivingPressure, advanceLiving, livingSnapshot } from './living';
import type { LivingConditions } from './living';
import { methodsHeld } from '../../sim/mind/invention';
import { deserialize, serialize } from '../../sim/persist/save';
import { Simulation } from '../../sim/mind/agent';
import { diePerson } from '../../sim/world/demographics';
import { householdConsistencyErrors } from '../../sim/world/household';
import { restoreKernel } from '../../sim/kernel/definitions';
import type { World } from '../../sim/core/world';

const seed = Number(process.argv[2] ?? 17), seconds = 1800;
const hash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const money = (w: World) => w.persons().reduce((n, p) => n + p.wealth, 0) + w.households().reduce((n, h) => n + h.wealth, 0);
function invariants(w: World, initialMoney: number) {
  const made = w.events.filter(e => e.type === 'component_manufactured');
  const materialError = made.reduce((n, e) => n + Math.abs(e.data.massKg - e.data.consumed.reduce((sum: number, c: { quantity: number }) => sum + c.quantity * w.kernel.ruleset.materials.find(m => m.id === e.data.material)!.kgPerUnit, 0)), 0);
  const energyError = Math.abs(w.kernel.energy.reduce((n, e) => n + e.initialJ - e.remainingJ, 0) - w.kernel.assemblies.reduce((n, a) => n + a.inputJ, 0));
  return { currencyDelta: money(w) - initialMoney, materialErrorKg: materialError, energyErrorJ: energyError,
    householdErrors: householdConsistencyErrors(w), validatedKernel: JSON.stringify(restoreKernel(w.kernel)) === JSON.stringify(w.kernel),
    validStocks: w.items().every(i => Number.isFinite(i.quantity) && i.quantity >= 0),
    causalReferences: w.events.every(e => e.causes.every(id => !!w.event(id))) };
}
function run(conditions: LivingConditions = {}, multi = false) {
  const sites = multi ? [0, 1, 2].map(i => ({ id: `site_${i}`, x: 256 + i * 1000, z: 128 })) : undefined;
  const lab = createLivingPressure(seed, sites, conditions), silver = money(lab.world);
  advanceLiving(lab.world, lab.sim, seconds);
  return { state: livingSnapshot(lab.world), invariants: invariants(lab.world, silver) };
}
const normal = run(), calm = run({ calm: true }), manual = run({ manualSkill: 0.6 }), substitution = run({ sawnOnly: true });
const multi = run({}, true), replay = run();
const checkpoint = createLivingPressure(seed); advanceLiving(checkpoint.world, checkpoint.sim, 90);
const saved = serialize(checkpoint.world), loaded = deserialize(saved)!.world, loadedAgain = deserialize(saved)!.world;
const exactKernel = JSON.stringify(loaded.kernel) === JSON.stringify(checkpoint.world.kernel);
const exactKnowledge = JSON.stringify(loaded.persons().map(p => p.knowledge)) === JSON.stringify(checkpoint.world.persons().map(p => p.knowledge));
const initialMoney = money(loaded);
advanceLiving(loaded, new Simulation(loaded), seconds - 90); advanceLiving(loadedAgain, new Simulation(loadedAgain), seconds - 90);
const continuation = livingSnapshot(loaded);
const loss = createLivingPressure(seed);
while (loss.world.physicalTime < seconds && !loss.world.livingPersons().some(p => methodsHeld(p).length)) advanceLiving(loss.world, loss.sim, 1);
const holders = loss.world.livingPersons().filter(p => methodsHeld(p).length), deathAt = loss.world.physicalTime;
if (holders.length === 1) diePerson(loss.world, holders[0], undefined, 'controlled sole-holder mortality intervention');
advanceLiving(loss.world, loss.sim, 300);
const lost = { interventionAtPhysicalSecond: deathAt, holdersBefore: holders.length, livingHoldersAfter: loss.world.livingPersons().filter(p => methodsHeld(p).length).length,
  inheritedComponents: loss.world.kernel.components.filter(c => holders.some(p => p.id !== c.ownerId)).length,
  archivedMethods: holders.flatMap(methodsHeld).length };
const report = { seed, physicalSeconds: seconds, normal, calm, manual, substitution, multi,
  deterministic: hash(normal) === hash(replay), replayHash: hash(normal),
  saveLoad: { atPhysicalSecond: 90, exactKernel, exactKnowledge, deterministicContinuation: hash(continuation) === hash(livingSnapshot(loadedAgain)), matchesUninterrupted: hash(continuation) === hash(normal.state), continuationHash: hash(continuation), state: continuation, invariants: invariants(loaded, initialMoney) }, loss: lost };
const valid = (i: ReturnType<typeof invariants>) => Math.abs(i.currencyDelta) < 1e-6 && i.materialErrorKg < 1e-6 && i.energyErrorJ < 1e-6 && !i.householdErrors.length && i.validatedKernel && i.validStocks && i.causalReferences;
const passed = report.deterministic && report.saveLoad.exactKernel && report.saveLoad.exactKnowledge && report.saveLoad.deterministicContinuation && report.saveLoad.matchesUninterrupted
  && [normal, calm, manual, substitution, multi].every(r => valid(r.invariants)) && valid(report.saveLoad.invariants)
  && normal.state.some(s => s.mechanicalOutput > 0 && s.breadWithMechanicalAncestry > 0 && s.methods.length > 1)
  && calm.state.every(s => s.mechanicalOutput === 0) && substitution.state.some(s => s.mechanicalOutput > 0)
  && multi.state.some(s => s.mechanicalOutput > 0) && multi.state.some(s => s.mechanicalOutput === 0)
  && lost.holdersBefore === 1 && lost.livingHoldersAfter === 0;
mkdirSync('.debug/living', { recursive: true });
writeFileSync(`.debug/living/${seed}.json`, JSON.stringify({ passed, ...report }, null, 2));
const compact = (result: typeof normal) => result.state.map(s => ({ settlement: s.name, manufactured: s.manufactured.length, mechanicalFlour: s.mechanicalOutput,
  assemblyLaborSeconds: s.laborSeconds, energyUsedJ: s.sources.reduce((n, e) => n + e.initialJ - e.remainingJ, 0), bread: s.baked,
  breadWithMechanicalAncestry: s.breadWithMechanicalAncestry, flourDelivered: s.flourDelivered, methodHolders: s.methods.length }));
console.log(JSON.stringify({ passed, seed, normal: compact(normal), calm: compact(calm), manual: compact(manual), substitution: compact(substitution), multi: compact(multi),
  deterministic: report.deterministic, replayHash: report.replayHash, saveLoad: { exactKernel, exactKnowledge, deterministicContinuation: report.saveLoad.deterministicContinuation, matchesUninterrupted: report.saveLoad.matchesUninterrupted, continuation: compact({ state: continuation, invariants: report.saveLoad.invariants }) }, loss: lost, invariants: normal.invariants }, null, 2));
if (!passed) process.exitCode = 1;
