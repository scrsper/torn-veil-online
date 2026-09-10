import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { mechanicalPrimitives, installRuleset, validateRuleset, restoreKernel } from '../src/sim/kernel/definitions';
import { acquireComponent, connect, contributeAssemblyLabor, createComponent, disconnect, installComponent, operateAssembly, startAssembly } from '../src/sim/kernel/mechanics';
import { addPlaceStock, stockAt, worldStock } from '../src/sim/world/stock';
import type { Method, Ruleset } from '../src/sim/kernel/types';
import held from '../src/headless/kernel/held-out.json';
import { advanceKernelLab, createKernelLab, kernelMetrics } from '../src/headless/kernel/lab';
import { candidateMethods, methodsHeld } from '../src/sim/mind/invention';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';
import type { HaulTask } from '../src/sim/core/types';

/** Explicit test topology verifies physical laws only. Autonomous acceptance below uses no
 * topology fixture, and starts with zero methods, zero projects and an uninstructed recipient. */
function rig(family: 'grain' | 'water' = 'grain', variant = 'belt', material = 'water', rules = mechanicalPrimitives()) {
  const tw = createTestWorld(741, 24), w = tw.world, pos = v(12, 1, 12), p = addPerson(tw, 'operator', 'villager', pos, { controlled: true });
  rules.materials.push(...held.materials as Ruleset['materials']); rules.components.push(...held.components as Ruleset['components']); installRuleset(w.kernel, rules);
  const q = (s: string) => `${rules.id}/${s}`;
  w.kernel.energy.push({ id: 'gust', medium: 'kinetic', initialJ: 1000, remainingJ: 1000, maxPowerW: 120, origin: 'finite test boundary', pos, ownerId: p.id });
  w.kernel.reservoirs.push({ id: 'lower', material: q(material), quantity: 10, capacity: 10, pos, ownerId: p.id }, { id: 'upper', material: q(material), quantity: 0, capacity: 10, pos, ownerId: p.id });
  addPlaceStock(w, 'grain', 30, tw.places.square, p.id, undefined, 'test inputs');
  const method: Method = { ruleset: rules.id, definitions: ['intake', 'rotor', variant, family === 'grain' ? 'stones' : 'impeller'].map(q), connections: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }], effect: family === 'grain' ? q('grinding') : 'transfer:liquid' };
  const a = startAssembly(w, p, method, { energyId: 'gust', placeId: tw.places.square, inputId: 'lower', outputId: 'upper' }, pos)!;
  for (const id of method.definitions) { const c = createComponent(w, id, p.id, pos); expect(acquireComponent(w, p, c.id)).toBe(true);
    expect(installComponent(w, p, a, c.id)).toBe(false);
    const cost = rules.components.find(d => d.id === id)!.installSeconds; contributeAssemblyLabor(w, p, a, `install:${a.parts.length}`, cost, cost);
    expect(installComponent(w, p, a, c.id)).toBe(true); }
  for (const e of method.connections) { contributeAssemblyLabor(w, p, a, `join:${e.from}:${e.to}`, 0.5, 0.5); expect(connect(w, p, a, e.from, e.to)).toBe(true); }
  return { tw, w, p, a, q };
}

describe('generative universe kernel physical laws', () => {
  it('uses one executor for real production and finite water; balances all modeled energy and mass', () => {
    for (const family of ['grain', 'water'] as const) {
      const { w, p, a } = rig(family); const result = operateAssembly(w, p, a, 1);
      expect(result.output).toBeCloseTo(2.43); expect(result.inputJ).toBe(120); expect(result.usefulJ + result.dissipatedJ).toBeCloseTo(120);
      expect(w.kernel.energy[0].remainingJ).toBe(880);
      if (family === 'grain') expect(worldStock(w, 'grain') + worldStock(w, 'flour') * 0.75).toBeCloseTo(30);
      else expect(w.kernel.reservoirs.reduce((n, r) => n + r.quantity, 0)).toBeCloseTo(10);
      expect(w.event(result.eventId)!.causes.length).toBeGreaterThan(0);
    }
  });
  it('held-out JSON changes behavior through component strength and liquid density alone', () => {
    const strong = rig('water', 'held-coupler', 'held-dense-liquid'), weak = rig('water', 'held-weak-coupler', 'held-dense-liquid');
    const pass = operateAssembly(strong.w, strong.p, strong.a, 1), fail = operateAssembly(weak.w, weak.p, weak.a, 1);
    expect(pass.output).toBeCloseTo(2.1375); expect(fail.reason).toBe('insufficient power'); expect(fail.output).toBe(0); expect(fail.inputJ).toBe(120);
    expect(weak.w.kernel.reservoirs[0].quantity).toBe(10);
    strong.p.name = 'watermill impossible failure'; strong.a.method.definitions = []; // intent/name never drives physics
    expect(operateAssembly(strong.w, strong.p, strong.a, 1).output).toBeGreaterThan(0);
  });
  it('accounts for finite inputs, destination capacity, lifted mass, byproducts and source exhaustion', () => {
    const water = rig('water'); water.w.kernel.reservoirs[1].pos = v(12, 3, 12); const lifted = operateAssembly(water.w, water.p, water.a, 1);
    expect(lifted.output).toBeCloseTo(72.9 / (30 + 19.62));
    water.w.kernel.reservoirs[1].quantity = 9.9;
    const limited = operateAssembly(water.w, water.p, water.a, 1); expect(limited.output).toBeCloseTo(0.1); expect(limited.inputJ).toBeLessThan(120);
    const before = water.w.kernel.energy[0].remainingJ;
    expect(operateAssembly(water.w, water.p, water.a, 1).output).toBe(0); expect(water.w.kernel.energy[0].remainingJ).toBe(before);
    const rules = mechanicalPrimitives(); const q = (s: string) => `${rules.id}/${s}`;
    rules.processes[0].output.quantity = 3; rules.processes[0].byproducts = [{ material: q('grain'), quantity: 0.75 }];
    const grain = rig('grain', 'belt', 'water', rules); operateAssembly(grain.w, grain.p, grain.a, 1);
    expect(worldStock(grain.w, 'grain') + worldStock(grain.w, 'flour') * 0.75).toBeCloseTo(30);
    grain.w.kernel.energy[0].remainingJ = 0; expect(operateAssembly(grain.w, grain.p, grain.a, 1).reason).toBe('source exhausted');
  });
  it('broken, absent, incompatible, cyclic and duplicate components cannot produce free work', () => {
    const { w, p, a } = rig(); const before = JSON.stringify(w.kernel.energy);
    expect(connect(w, p, a, 3, 0)).toBe(false); expect(connect(w, p, a, 0, 2)).toBe(false);
    expect(disconnect(w, p, a, 1, 2)).toBe(true); expect(operateAssembly(w, p, a, 1).output).toBe(0); expect(JSON.stringify(w.kernel.energy)).toBe(before);
    contributeAssemblyLabor(w, p, a, 'join:1:2', 0.5, 0.5); expect(connect(w, p, a, 1, 2)).toBe(true); w.kernel.components[2].condition = 0;
    expect(operateAssembly(w, p, a, 1).reason).toBe('broken'); w.kernel.components[2].condition = 1;
    w.kernel.components[2].assemblyId = null; expect(operateAssembly(w, p, a, 1).output).toBe(0);
    w.kernel.components[2].assemblyId = a.id; a.parts[2] = a.parts[1]; expect(operateAssembly(w, p, a, 1).output).toBe(0);
    expect(JSON.stringify(w.kernel.energy)).toBe(before);
  });
  it('preserves locality, title and reservations; shared mechanics accept any embodied actor', () => {
    const { tw, w, p, a } = rig(); const stranger = addPerson(tw, 'stranger', 'miller', v(12, 1, 12), { controlled: true });
    expect(operateAssembly(w, stranger, a, 1).reason).toBe('inaccessible');
    w.kernel.energy[0].ownerId = stranger.id; expect(operateAssembly(w, p, a, 1).inputJ).toBe(0); w.kernel.energy[0].ownerId = p.id;
    for (const i of w.items()) if (i.type === 'grain') i.ownerId = stranger.id;
    expect(operateAssembly(w, p, a, 1).output).toBe(0); expect(worldStock(w, 'grain')).toBe(30);
    for (const i of w.items()) if (i.type === 'grain') i.ownerId = p.id;
    w.haulTasks.push({ id: 'reserved', sourcePlaceId: tw.places.square, resource: 'grain', status: 'needed', quantity: 30, delivered: 0, carried: 0 } as HaulTask);
    expect(operateAssembly(w, p, a, 1).output).toBe(0); expect(worldStock(w, 'grain')).toBe(30); w.haulTasks = [];
    w.primaryBody(p.id)!.pos.x += 10; expect(operateAssembly(w, p, a, 1).inputJ).toBe(0);
    const second = { ...w.primaryBody(p.id)!, id: w.nextId('b'), pos: v(12, 1, 12) }; w.add(second); p.bodies.push(second.id);
    expect(operateAssembly(w, p, a, 1).output).toBeGreaterThan(0);
    expect(stranger.wealth).toBeGreaterThanOrEqual(0);
  });
  it('rejects nonfinite, energy-gaining, unscoped, mass-creating and corrupt save definitions', () => {
    for (const change of [(r: Ruleset) => { r.components[1].efficiency = 1.01; }, (r: Ruleset) => { r.materials[0].maxPowerW = NaN; }, (r: Ruleset) => { r.components[0].id = 'global'; }, (r: Ruleset) => { r.processes[0].output.quantity = 5; }]) {
      const r = mechanicalPrimitives(); change(r); expect(() => validateRuleset(r)).toThrow();
    }
    const { w } = rig(); w.kernel.energy[0].remainingJ = 1001; expect(() => restoreKernel(w.kernel)).toThrow();
  });
  it('zero material power and wrong phase stop work without NaN or fabricated inputs', () => {
    const rules = mechanicalPrimitives(); rules.materials[0].maxPowerW = 0; rules.components.forEach(c => c.minPowerW = 0);
    const zero = rig('grain', 'belt', 'water', rules); const result = operateAssembly(zero.w, zero.p, zero.a, 1);
    expect(result.reason).toBe('insufficient power'); expect(result.inputJ).toBe(0); expect(result.output).toBe(0); expect(Number.isFinite(result.usefulJ)).toBe(true);
    const solid = rig('water', 'belt', 'grain'); expect(operateAssembly(solid.w, solid.p, solid.a, 1).reason).toBe('incompatible material');
  });
});

describe('autonomous invention acceptance', () => {
  it.each(['grain', 'water'] as const)('%s is discovered, communicated, and physically reproduced; broken control has zero effect', family => {
    const lab = createKernelLab(918271, family);
    expect(lab.world.kernel.assemblies).toHaveLength(0); expect(methodsHeld(lab.inventor)).toHaveLength(0); expect(methodsHeld(lab.recipient)).toHaveLength(0);
    expect(candidateMethods(lab.world, lab.recipient, lab.recipient.knowledge['workshop-need'].claim.practicalNeed)).toHaveLength(0);
    const skills = structuredClone(lab.recipient.skills);
    advanceKernelLab(lab.world, lab.sim, 80); const metrics = kernelMetrics(lab);
    expect(metrics.people.every(p => p.output > 2 && p.acquired >= 4)).toBe(true);
    expect(lab.recipient.knowledge['observed:workshop-need'].claim.quantity).toBeCloseTo(metrics.people[1].output);
    expect(metrics.people[0].trials[0].reason).toBe('insufficient power'); expect(metrics.people[0].trials[0].consumed).toBe(0);
    const learned = methodsHeld(lab.recipient)[0]; expect(learned.source.type).toBe('told'); expect(learned.source.from).toBe(lab.inventor.id); expect(learned.claim.verifiedEvent).toBeTruthy();
    const told = lab.world.event(learned.source.viaEvent)!; expect(told.type).toBe('told'); expect(told.causes.length).toBeGreaterThan(0);
    expect(lab.recipient.skills).toEqual(skills); expect(metrics.people.every(p => p.wealth === 10)).toBe(true);
    const control = createKernelLab(918271, family, true); advanceKernelLab(control.world, control.sim, 80);
    expect(kernelMetrics(control).people.every(p => p.output === 0)).toBe(true);
  });
  it('same seed replays the full autonomous report deterministically', () => {
    const a = createKernelLab(44017, 'water'), b = createKernelLab(44017, 'water');
    advanceKernelLab(a.world, a.sim, 80); advanceKernelLab(b.world, b.sim, 80);
    expect(kernelMetrics(a)).toEqual(kernelMetrics(b));
  });
  it('autonomously discovers and teaches a held-out JSON variant', () => {
    const lab = createKernelLab(918271, 'water', false, true); advanceKernelLab(lab.world, lab.sim, 80);
    const report = kernelMetrics(lab); expect(report.people.every(p => p.output > 2 && p.acquired >= 4)).toBe(true);
    expect(report.people[0].trials[0].reason).toBe('insufficient power');
    expect(report.people[1].methods[0].source).toBe('told');
    expect(report.people[1].methods[0].definitions).toContain('torn-veil:mechanics-v1/held-coupler');
  });
  it('round trips definitions, partial construction, methods, finite sources and resumed physical execution', () => {
    const lab = createKernelLab(918271, 'grain'); advanceKernelLab(lab.world, lab.sim, 3.3);
    const saved = serialize(lab.world), loaded = deserialize(saved)!.world;
    expect(loaded.kernel).toEqual(lab.world.kernel); expect(loaded.kernel.assemblies[0].progress).toEqual(lab.world.kernel.assemblies[0].progress);
    advanceKernelLab(loaded, new Simulation(loaded), 80);
    expect(methodsHeld(loaded.person(lab.recipient.id)!)[0].source.type).toBe('told');
    const reloaded = deserialize(serialize(loaded))!.world; expect(reloaded.kernel).toEqual(loaded.kernel);
    const a = loaded.kernel.assemblies.find(a => a.learned)!, b = reloaded.kernel.assemblies.find(b => b.id === a.id)!;
    const left = operateAssembly(loaded, loaded.person(a.ownerId)!, a, 1), right = operateAssembly(reloaded, reloaded.person(b.ownerId)!, b, 1);
    expect(right).toEqual(left); expect(reloaded.kernel).toEqual(loaded.kernel);
    expect(stockAt(reloaded, 'flour', lab.place.id)).toBeCloseTo(stockAt(loaded, 'flour', lab.place.id));
  });
});
