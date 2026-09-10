import { isExternallyControlled } from '../src/sim/runtime/controllers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLivingPressure, createLivingWorld, advanceLiving, livingSnapshot, causalAncestors } from '../src/headless/kernel/living';
import { createKernelLab } from '../src/headless/kernel/lab';
import { manufactureComponent, settlementPrimitives } from '../src/sim/kernel/manufacture';
import { materialFits, restoreKernel, validateRuleset } from '../src/sim/kernel/definitions';
import { startAssembly } from '../src/sim/kernel/mechanics';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { methodsHeld, teachPrimitive } from '../src/sim/mind/invention';
import { candidateMethods } from '../src/sim/mind/invention';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import { diePerson } from '../src/sim/world/demographics';
import { householdConsistencyErrors } from '../src/sim/world/household';
import { buildChronicle } from '../src/sim/history/chronicle';
import { RESOURCE_MASS_KG } from '../src/sim/world/factory';
import { energyBalanceError } from '../src/sim/kernel/environment';

const run = (conditions = {}, seconds = 1800) => { const lab = createLivingPressure(17, undefined, conditions); advanceLiving(lab.world, lab.sim, seconds); return lab; };
let ordinary: ReturnType<typeof run>, calm: ReturnType<typeof run>, manual: ReturnType<typeof run>;
describe('living universe integration', () => {
  beforeAll(() => { ordinary = run(); calm = run({ calm: true }); manual = run({ manualSkill: 0.6 }); }, 60000);
  it('starts procedural towns with primitive education and resources but no components or methods', () => {
    const lab = createLivingWorld(17);
    expect(lab.world.kernel.components).toEqual([]); expect(lab.world.kernel.assemblies).toEqual([]);
    expect(lab.world.persons().flatMap(methodsHeld)).toEqual([]);
    expect(lab.world.persons().some(p => Object.values(p.knowledge).some(k => k.claim.practicalNeed))).toBe(false);
    expect(lab.world.persons().every(p => !isExternallyControlled(p))).toBe(true);
  });
  it('manufactures its own components, pays labor, and drives the normal grain→flour→bakery chain', () => {
    const { world } = ordinary, [report] = livingSnapshot(world);
    expect(world.kernel.components.length).toBeGreaterThanOrEqual(5);
    const made = world.events.filter(e => e.type === 'component_manufactured');
    expect(made).toHaveLength(world.kernel.components.length);
    for (const e of made) {
      const component = world.kernel.components.find(c => c.id === e.data.componentId)!;
      expect(component.madeEvent).toBe(e.id); expect(component.ownerId).toBe(e.actor);
      const material = world.kernel.ruleset.materials.find(m => m.id === e.data.material)!;
      expect(e.data.consumed.reduce((n: number, c: { quantity: number }) => n + c.quantity * material.kgPerUnit, 0)).toBeCloseTo(e.data.massKg, 8);
      expect(e.data.laborSeconds).toBeGreaterThan(0);
      expect(e.causes.length).toBeGreaterThan(0);
    }
    expect(report.mechanicalOutput).toBeGreaterThan(10); expect(report.breadWithMechanicalAncestry).toBeGreaterThan(0);
    for (const trial of report.trials) expect(trial.consumed * RESOURCE_MASS_KG.grain!).toBeCloseTo(trial.output * RESOURCE_MASS_KG.flour!, 8);
    expect(report.flourDelivered).toBeGreaterThan(0);
    const bread = world.events.find(e => e.type === 'resource_transformed' && e.data.to === 'bread' && [...causalAncestors(world, e.id)].some(id => world.event(id)?.type === 'component_manufactured'))!;
    expect(bread).toBeDefined();
    expect([...causalAncestors(world, bread.id)].some(id => world.event(id)?.type === 'resource_extracted')).toBe(true);
    expect(buildChronicle(world).some(e => e.sourceEventIds.some(id => world.event(id)?.type === 'component_manufactured' || world.event(id)?.type === 'mechanism_trial'))).toBe(true);
  });
  it('preserves a costly failed experiment and a matched calm-air failure while manual work remains effective', () => {
    const normal = livingSnapshot(ordinary.world)[0], control = livingSnapshot(calm.world)[0], familiar = livingSnapshot(manual.world)[0];
    const stalled = normal.trials.find(t => t.reason === 'insufficient power')!;
    expect(stalled.inputJ).toBeGreaterThan(0); expect(stalled.consumed).toBe(0); expect(stalled.output).toBe(0);
    expect(control.mechanicalOutput).toBe(0); expect(control.laborSeconds).toBeGreaterThan(0); expect(control.methods).toEqual([]);
    expect(control.baked).toBeLessThan(normal.baked);
    expect(familiar.mechanicalOutput).toBe(0); expect(familiar.baked).toBeGreaterThan(normal.baked);
    expect(energyBalanceError(ordinary.world)).toBeLessThan(1e-6);
    for (const lab of [ordinary, calm, manual]) {
      expect(householdConsistencyErrors(lab.world)).toEqual([]);
      expect(lab.world.kernel.assemblies.every(a => Math.abs(a.inputJ - a.usefulJ - a.dissipatedJ) < 1e-7)).toBe(true);
    }
  });
  it('spreads a discovered method through conversations without unlocking it for unrelated people', () => {
    const holders = ordinary.world.livingPersons().filter(p => methodsHeld(p).length);
    expect(holders.length).toBeGreaterThan(1); expect(holders.length).toBeLessThan(ordinary.world.livingPersons().length);
    const recipient = holders.find(p => methodsHeld(p).some(k => k.source.type === 'told'))!;
    expect(recipient).toBeDefined();
    const lesson = methodsHeld(recipient).find(k => k.source.type === 'told')!;
    expect(lesson.source.from).toBeTruthy(); expect(lesson.source.viaEvent).toBeTruthy();
    expect(lesson.claim.components.length).toBe(lesson.claim.method.definitions.length);
    expect(ordinary.world.kernel.assemblies.filter(a => a.ownerId === recipient.id)).toEqual([]);
    expect(recipient.skills.crafting ?? 0).toBe(0); // instruction did not grant proficiency
  });
  it('replays the same seed and initial conditions exactly', () => {
    expect(livingSnapshot(run().world)).toEqual(livingSnapshot(ordinary.world));
  }, 30000);
  it('substitutes shaped timber for rough timber through the same manufacture and execution path', () => {
    const lab = run({ sawnOnly: true }), [report] = livingSnapshot(lab.world);
    expect(report.mechanicalOutput).toBeGreaterThan(0); expect(report.breadWithMechanicalAncestry).toBeGreaterThan(0);
    const woodParts = lab.world.kernel.components.filter(c => lab.world.kernel.ruleset.components.find(d => d.id === c.definition)?.kind !== 'process');
    expect(woodParts.length).toBeGreaterThan(0);
    expect(woodParts.every(c => lab.world.kernel.ruleset.components.find(d => d.id === c.definition)?.material.endsWith('/stock-plank'))).toBe(true);
    expect(lab.world.events.some(e => e.type === 'resource_delivered' && e.data.resource === 'plank')).toBe(true);
    expect(report.methods.length).toBeGreaterThan(1);
  }, 30000);
  it('preserves unfinished manufacture, sources, methods and their ancestry through save/load continuation', () => {
    const lab = run({}, 90), kernel = structuredClone(lab.world.kernel);
    expect(kernel.assemblies.length).toBeGreaterThan(0);
    const saved = serialize(lab.world), a = deserialize(saved)!.world, b = deserialize(saved)!.world;
    expect(a.kernel).toEqual(kernel); expect(a.resourceNodes).toEqual(lab.world.resourceNodes);
    const original = lab.world.person(lab.settlements[0].places.mill.ownerId)!;
    expect(a.person(original.id)!.knowledge).toEqual(original.knowledge);
    advanceLiving(a, new Simulation(a), 1710); advanceLiving(b, new Simulation(b), 1710);
    expect(livingSnapshot(a)).toEqual(livingSnapshot(b));
    expect(livingSnapshot(a)).toEqual(livingSnapshot(ordinary.world));
    expect(a.kernel).toEqual(ordinary.world.kernel);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(ordinary.world.events));
    expect(a.kernel.assemblies.reduce((n, s) => n + s.outputQuantity, 0)).toBeGreaterThan(0);
    const restored = deserialize(serialize(ordinary.world))!.world;
    expect(restored.kernel).toEqual(ordinary.world.kernel);
    expect(restored.persons().map(p => p.knowledge)).toEqual(ordinary.world.persons().map(p => p.knowledge));
    expect(restored.events.every(e => e.causes.every(id => !!restored.event(id)))).toBe(true);
  }, 30000);
  it('loses living access if the sole holder dies before teaching', () => {
    const lab = createLivingPressure(17);
    while (lab.world.physicalTime < 1800 && !lab.world.livingPersons().some(p => methodsHeld(p).length)) advanceLiving(lab.world, lab.sim, 1);
    const holders = lab.world.livingPersons().filter(p => methodsHeld(p).length); expect(holders).toHaveLength(1);
    const p = holders[0]; diePerson(lab.world, p, undefined, 'controlled sole-holder mortality intervention');
    expect(lab.world.kernel.components.every(c => c.ownerId !== p.id)).toBe(true);
    expect(lab.world.kernel.assemblies.every(a => a.creatorId === p.id && a.ownerId !== p.id)).toBe(true);
    expect(restoreKernel(lab.world.kernel)).toEqual(lab.world.kernel);
    advanceLiving(lab.world, lab.sim, 300);
    expect(lab.world.livingPersons().flatMap(methodsHeld)).toHaveLength(0);
    expect(methodsHeld(p).length).toBeGreaterThan(0); // archived evidence is not living access
    const restored = deserialize(serialize(lab.world))!.world;
    expect(restored.livingPersons().flatMap(methodsHeld)).toHaveLength(0);
  }, 30000);
  it('lets three settlements diverge under identical cognition and production rules', () => {
    const lab = createLivingPressure(17, [0, 1, 2].map(i => ({ id: `site_${i}`, x: 256 + i * 1000, z: 128 })));
    advanceLiving(lab.world, lab.sim, 1800);
    const reports = livingSnapshot(lab.world);
    expect(reports.some(s => s.mechanicalOutput > 0)).toBe(true);
    expect(reports.some(s => !s.mechanicalOutput && !s.methods.length)).toBe(true);
    expect(new Set(reports.map(s => JSON.stringify([s.mechanicalOutput, s.baked, s.householdFood]))).size).toBe(3);
    for (const s of reports) for (const method of s.methods) {
      expect(s.workers.some(p => p.id === method.holder) || lab.world.person(method.holder)?.homeId).toBeTruthy();
      if (method.source.from) expect(reports.find(r => r.methods.some(m => m.holder === method.source.from))?.id).toBe(s.id);
    }
  }, 30000);
});

describe('property-based component manufacture', () => {
  it('accepts log and plank stock and a held-out data material, rejects unsuitable hardness, and conserves their mass', () => {
    const rules = settlementPrimitives(), first = rules.components.find(d => d.id.endsWith('intake~stock-log'))!;
    const held = { id: `${rules.id}/held-stick`, unit: 'bundle', kgPerUnit: RESOURCE_MASS_KG.stick!, phase: 'solid' as const, maxPowerW: 12, legacyItem: 'stick' as const, properties: { hardness: 0.3 } };
    rules.materials.push(held);
    rules.components.push({ ...first, id: `${rules.id}/held-intake`, material: held.id });
    validateRuleset(rules);
    expect(materialFits({ ...held, properties: { hardness: 0.05 } }, first.fabrication!)).toBe(false);
    for (const suffix of ['intake~stock-log', 'intake~stock-plank', 'held-intake']) {
      const { world, inventor: p, place } = createKernelLab(99);
      world.kernel = { ruleset: structuredClone(rules), components: [], reservoirs: [], energy: [], assemblies: [] }; place.ownerId = p.id;
      const d = rules.components.find(d => d.id.endsWith(suffix))!, material = rules.materials.find(m => m.id === d.material)!;
      const input = addPlaceStock(world, material.legacyItem!, 20, place.id, p.id, undefined, 'raw material test stock');
      const a = startAssembly(world, p, { ruleset: rules.id, definitions: [d.id, rules.components.at(-2)!.id], connections: [], effect: 'test' }, { energyId: '', placeId: place.id }, place.inside)!;
      for (let i = 0; i < 200 && !world.kernel.components.length; i++) manufactureComponent(world, p, a, d, 0.25);
      expect(world.kernel.components).toHaveLength(1);
      expect((20 - input.quantity) * material.kgPerUnit).toBeCloseTo(d.massKg, 8);
      expect(restoreKernel(world.kernel)).toEqual(world.kernel);
    }
  });
  it('cannot remotely manufacture or spend somebody else’s stock, and no phantom part appears after partial work', () => {
    const lab = createLivingPressure(17), { world } = lab, place = lab.settlements[0].places.mill, p = world.person(place.ownerId)!;
    const d = world.kernel.ruleset.components[0], material = world.kernel.ruleset.materials.find(m => m.id === d.material)!;
    const owner = world.persons().find(q => q.id !== p.id)!;
    const input = addPlaceStock(world, material.legacyItem!, 2, place.id, owner.id, undefined, 'private raw stock');
    const a = startAssembly(world, p, { ruleset: world.kernel.ruleset.id, definitions: [d.id, d.id], connections: [], effect: 'test' }, { energyId: '', placeId: place.id }, place.inside)!;
    expect(manufactureComponent(world, p, a, d, 1)).toBe('missing'); expect(input.quantity).toBe(2);
    input.ownerId = p.id;
    expect(manufactureComponent(world, p, a, { ...d, massKg: 0.001, fabrication: { ...d.fabrication!, seconds: 0.001 } }, 0.25)).toBe('working');
    expect(world.kernel.components).toHaveLength(0); expect(input.quantity).toBe(2);
    world.primaryBody(p.id)!.pos.x += 100;
    expect(manufactureComponent(world, p, a, d, 60)).toBe('inaccessible'); expect(input.quantity).toBe(2);
  });
});
