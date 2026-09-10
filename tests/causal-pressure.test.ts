import { setExternalControl } from '../src/sim/runtime/controllers';
import { describe, expect, it } from 'vitest';
import { PRESSURE_CONDITIONS, createPressureLab, pressureSnapshot, runPressure } from '../src/headless/kernel/pressure';
import { advanceKernelLab, createKernelLab } from '../src/headless/kernel/lab';
import { candidateMethods, inventionGoals, methodsHeld, methodSignature } from '../src/sim/mind/invention';
import { observeProduction, productionWorkGoals } from '../src/sim/mind/productionOpportunity';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { diePerson } from '../src/sim/world/demographics';
import { getRel } from '../src/sim/mind/relationships';
import { stockAt, stockItemsAt, worldStock } from '../src/sim/world/stock';
import { fulfillProductionRequest } from '../src/sim/world/production';
import { createRequest } from '../src/sim/core/requests';
import { learn } from '../src/sim/mind/knowledge';
import { runTradeBatch, tradePostAt } from '../src/sim/world/labor';

describe('local production pressure and historical alternatives', () => {
  it.each([918271, 44017])('same demand admits practice, invention, exhaustion, ignorance and material failure (%s)', seed => {
    const runs = PRESSURE_CONDITIONS.map(c => runPressure(seed, c));
    const [practice, invention, exhausted, ignorant, empty] = runs.map(r => r.report);
    expect(practice.goals[0].type).toBe('work'); expect(practice.methods).toBe(0);
    expect(practice.output).toBeGreaterThan(0); expect(practice.energyJ).toBe(5000);
    expect(practice.paidBatchLaborSeconds).toBeGreaterThan(0);
    expect(invention.goals[0].type).toBe('compose'); expect(invention.methods).toBe(1);
    expect(invention.trials[0].reason).toBe('insufficient power');
    expect(invention.trials[0].consumed).toBe(0); expect(invention.trials[0].inputJ).toBeGreaterThan(0);
    expect(invention.completedRequests).toBeGreaterThan(0);
    expect(exhausted.energyJ).toBe(0); expect(exhausted.output).toBeLessThan(invention.output);
    expect(exhausted.completedRequests).toBe(0); expect(exhausted.assemblyLaborSeconds).toBeGreaterThan(invention.assemblyLaborSeconds);
    expect(exhausted.physiologyEnergy).toBeLessThan(ignorant.physiologyEnergy);
    expect(ignorant.output).toBe(0); expect(ignorant.methods).toBe(0); expect(ignorant.assemblyLaborSeconds).toBe(0);
    expect(empty.output).toBe(0); expect(empty.transforms).toHaveLength(0);
    expect(empty.paidBatchLaborSeconds).toBeGreaterThan(0);
    expect(runs[4].lab.world.events.some(e => e.actor === runs[4].lab.inventor.id && e.type === 'work_blocked')).toBe(true);
    for (const { lab, report } of runs) {
      expect(report.grain + report.output * 0.75).toBeCloseTo(lab.conditions.grain ?? 30);
      expect(report.wealth + report.householdWealth).toBe(10);
      expect(lab.world.events.filter(e => e.actor === lab.inventor.id && e.type === 'resource_transformed').every(e => e.placeId === lab.place.id)).toBe(true);
      const used = lab.world.kernel.assemblies.filter(a => a.ownerId === lab.inventor.id);
      expect(used.reduce((n, a) => n + a.usefulJ + a.dissipatedJ, 0)).toBeCloseTo(lab.conditions.sourceJ - report.energyJ);
      expect(Object.values(lab.inventor.knowledge).filter(k => k.key.startsWith('production-need:')).every(k => k.source.type === 'inferred' && lab.world.event(k.source.viaEvent!)?.type === 'production_observed')).toBe(true);
    }
  });

  it('stocks change local labor pressure and decisions; successful work need not fill the reserve', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[0]);
    const initial = productionWorkGoals(lab.world, lab.inventor, observeProduction(lab.world, lab.inventor))[0];
    advanceKernelLab(lab.world, lab.sim, 90);
    const report = pressureSnapshot(lab), later = lab.world.events.filter(e => e.actor === lab.inventor.id && e.type === 'goal_changed');
    expect(report.output).toBeGreaterThan(0); expect(report.output).toBeLessThan(24);
    expect(later.some(e => e.data.from === 'work' && e.data.to !== 'work')).toBe(true);
    const obs = lab.inventor.knowledge[`production-observed:${lab.place.id}`];
    expect(obs.claim.output).toBe(report.output); expect(obs.claim.input).toBe(report.grain);
    const after = productionWorkGoals(lab.world, lab.inventor, observeProduction(lab.world, lab.inventor))[0];
    // The actor may have left to satisfy another need: lack of reach must also stop proposals.
    if (after) expect(after.utility!).toBeLessThan(initial.utility!);
    const transform = lab.world.events.find(e => e.actor === lab.inventor.id && e.type === 'resource_transformed')!;
    expect(lab.world.event(transform.causes[0])!.type).toBe('production_observed');
    expect(lab.world.events.some(e => e.type === 'production_observed' && e.causes.includes(transform.id))).toBe(true);
    const stillNeeded = lab.world.requests.some(r => r.type === 'production' && r.payload.placeId === lab.place.id && r.status !== 'completed');
    expect(stillNeeded).toBe(true);
  });

  it('knowing a remote or inaccessible bin is not a live stock observation; labels confer no craft knowledge', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[3]);
    lab.inventor.name = 'The Guaranteed Inventor'; lab.inventor.occupation = 'miller';
    expect(productionWorkGoals(lab.world, lab.inventor, observeProduction(lab.world, lab.inventor))).toEqual([]);
    expect(inventionGoals(lab.world, lab.inventor, observeProduction(lab.world, lab.inventor))).toEqual([]);
    const before = structuredClone(lab.inventor.knowledge);
    lab.world.primaryBody(lab.inventor.id)!.pos.x += 20;
    stockItemsAt(lab.world, 'grain', lab.place.id)[0].quantity = 1;
    expect(observeProduction(lab.world, lab.inventor)).toEqual([]);
    expect(lab.inventor.knowledge).toEqual(before);
  });

  it('manual dispatch cannot borrow inputs from a different nearby mill, a private owner, or a distant post', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[0]);
    const post = tradePostAt(lab.world, lab.place)!;
    const grain = stockItemsAt(lab.world, 'grain', lab.place.id)[0];
    grain.ownerId = lab.recipient.id;
    const before = worldStock(lab.world, 'grain');
    expect(runTradeBatch(lab.world, lab.inventor, post).ok).toBe(false);
    expect(worldStock(lab.world, 'grain')).toBe(before);
    grain.ownerId = lab.inventor.id; lab.world.primaryBody(lab.inventor.id)!.pos.x += 20;
    expect(runTradeBatch(lab.world, lab.inventor, post).ok).toBe(false);
    expect(worldStock(lab.world, 'grain')).toBe(before);
  });

  it('failed arrangements are reconsidered after changed observed power, rather than a guaranteed retry timer', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[1]);
    const source = lab.world.kernel.energy.find(e => e.ownerId === lab.inventor.id)!; source.maxPowerW = 20;
    advanceKernelLab(lab.world, lab.sim, 60);
    const need = lab.inventor.knowledge[`production-need:${lab.place.id}`].claim.practicalNeed;
    expect(methodsHeld(lab.inventor)).toHaveLength(0);
    expect(candidateMethods(lab.world, lab.inventor, need)).toHaveLength(0);
    source.maxPowerW = 120; // Controlled environmental change; same finite remaining energy.
    expect(candidateMethods(lab.world, lab.inventor, need).length).toBeGreaterThan(0);
  });

  it('partial physical output pays only after the requested quantity; zero output and duplicate settlement pay nothing', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[3]), w = lab.world;
    const request = createRequest(w, { type: 'production', requesterId: lab.inventor.id, reward: 3, cause: 'local demand', payload: { placeId: lab.place.id, resource: 'flour', quantity: 4 } });
    const total = lab.inventor.wealth + lab.recipient.wealth;
    expect(fulfillProductionRequest(w, request, lab.recipient, 0)).toBe(0);
    expect(fulfillProductionRequest(w, request, lab.recipient, 2)).toBe(0);
    expect(request.status).toBe('accepted'); expect(request.fulfilledQuantity).toBe(2);
    const loaded = deserialize(serialize(w))!.world, restored = loaded.requests.find(r => r.id === request.id)!;
    expect(restored.fulfilledQuantity).toBe(2);
    expect(fulfillProductionRequest(loaded, restored, loaded.person(lab.recipient.id)!, 2)).toBe(3);
    expect(fulfillProductionRequest(loaded, restored, loaded.person(lab.recipient.id)!, 4)).toBe(0);
    expect(loaded.person(lab.inventor.id)!.wealth + loaded.person(lab.recipient.id)!.wealth).toBe(total);
  });

  it('manual work pays its first batch time and save/load preserves paid progress and empty canonical lists', () => {
    const lab = createPressureLab(918271, PRESSURE_CONDITIONS[0]);
    advanceKernelLab(lab.world, lab.sim, 4);
    expect(stockAt(lab.world, 'flour', lab.place.id)).toBe(0);
    const plan = lab.inventor.mind.plan;
    expect(plan.some(a => a.type === 'work' && a.data?.productionOpportunity)).toBe(true);
    lab.world.fields = []; lab.world.resourceNodes = [];
    const loaded = deserialize(serialize(lab.world))!.world;
    expect(loaded.fields).toEqual([]); expect(loaded.resourceNodes).toEqual([]); expect(loaded.constructionProjects).toEqual([]);
    expect(loaded.person(lab.inventor.id)!.mind.plan).toEqual(plan);
    expect(loaded.person(lab.inventor.id)!.knowledge).toEqual(lab.inventor.knowledge);
    advanceKernelLab(lab.world, lab.sim, 4); advanceKernelLab(loaded, new Simulation(loaded), 4);
    expect(stockAt(loaded, 'flour', lab.place.id)).toBe(stockAt(lab.world, 'flour', lab.place.id));
    expect(stockAt(loaded, 'flour', lab.place.id)).toBe(0);
    advanceKernelLab(lab.world, lab.sim, 3); advanceKernelLab(loaded, new Simulation(loaded), 3);
    expect(stockAt(loaded, 'flour', lab.place.id)).toBeGreaterThan(0);
    expect(stockAt(loaded, 'flour', lab.place.id)).toBe(stockAt(lab.world, 'flour', lab.place.id));
  });

  it('same seed replays the causal report, independent of names', () => {
    const first = runPressure(44017, PRESSURE_CONDITIONS[1]);
    const second = runPressure(44017, PRESSURE_CONDITIONS[1]);
    expect(second.report).toEqual(first.report);
    const third = createPressureLab(44017, PRESSURE_CONDITIONS[1]); third.inventor.name = 'Impossible'; third.recipient.name = 'Winner';
    advanceKernelLab(third.world, third.sim, 180);
    expect(pressureSnapshot(third).output).toBe(first.report.output);
    expect(pressureSnapshot(third).trials).toEqual(first.report.trials);
  });
});

describe('local method histories', () => {
  it('shared work/home permits teaching and construction, while distrust keeps a successful method private', () => {
    for (const distrust of [false, true]) {
      const lab = createKernelLab(918271, 'water');
      if (distrust) { const rel = getRel(lab.inventor, lab.recipient.id); rel.trust = -0.8; rel.affection = -0.8; }
      advanceKernelLab(lab.world, lab.sim, 80);
      expect(methodsHeld(lab.inventor)).toHaveLength(1);
      expect(methodsHeld(lab.recipient)).toHaveLength(distrust ? 0 : 1);
      expect(lab.world.kernel.assemblies.some(a => a.ownerId === lab.recipient.id && a.outputQuantity > 0)).toBe(!distrust);
      if (!distrust) expect(methodsHeld(lab.recipient)[0].source).toMatchObject({ type: 'told', from: lab.inventor.id });
    }
  });

  it('death of the sole holder loses living access to a method; loading does not unlock it or create a successor', () => {
    const lab = createKernelLab(918271, 'water');
    getRel(lab.inventor, lab.recipient.id).trust = -0.8;
    advanceKernelLab(lab.world, lab.sim, 40);
    expect(methodsHeld(lab.inventor)).toHaveLength(1); expect(methodsHeld(lab.recipient)).toHaveLength(0);
    const death = diePerson(lab.world, lab.inventor, undefined, 'fixture loss of the sole skilled holder');
    const loaded = deserialize(serialize(lab.world))!.world;
    advanceKernelLab(loaded, new Simulation(loaded), 80);
    expect(loaded.event(death!)!.type).toBe('death');
    expect([...loaded.livingPersons()].flatMap(methodsHeld)).toHaveLength(0);
    expect(loaded.kernel.assemblies.some(a => a.ownerId === lab.recipient.id)).toBe(false);
    expect(loaded.person(lab.recipient.id)!.skills).toEqual(lab.recipient.skills);
  });

  it('a communicated erroneous method is an unverified belief, fails physically, and pays construction/dismantling costs', () => {
    const lab = createKernelLab(918271, 'water'); setExternalControl(lab.inventor, true);
    const method = candidateMethods(lab.world, lab.inventor, lab.inventor.knowledge['workshop-need'].claim.practicalNeed)[0];
    method.connections = [{ from: 0, to: 2 }, { from: 2, to: 1 }, { from: 1, to: 3 }];
    const belief = learn(lab.world, lab.inventor, { key: `method:${methodSignature(method)}`, kind: 'technique', claim: { method }, confidence: 0.7, source: { type: 'inferred' } }, true)!;
    const before = lab.world.kernel.components.map(c => c.condition), stock = worldStock(lab.world, 'grain');
    lab.sim.tell(lab.inventor, lab.recipient, belief);
    expect(methodsHeld(lab.recipient)[0].source.type).toBe('told');
    advanceKernelLab(lab.world, lab.sim, 40);
    const projects = lab.world.kernel.assemblies.filter(a => a.ownerId === lab.recipient.id);
    expect(projects).toHaveLength(1); expect(projects[0].lastReason).toBe('connection rejected');
    expect(projects[0].parts).toHaveLength(0); expect(projects[0].laborSeconds).toBeGreaterThan(5);
    expect(projects[0].inputJ).toBe(0); expect(projects[0].outputQuantity).toBe(0);
    expect(lab.world.kernel.components.map(c => c.condition)).toEqual(before); expect(worldStock(lab.world, 'grain')).toBe(stock);
    expect(Object.values(lab.recipient.knowledge).some(k => k.claim.experiment && !k.claim.success)).toBe(true);
    expect(methodsHeld(lab.recipient)[0].claim.verifiedEvent).toBeUndefined();
    expect(lab.world.events.some(e => e.type === 'assembly_changed' && e.actor === lab.recipient.id && e.data.operation === 'connection rejected')).toBe(true);
  });
});
