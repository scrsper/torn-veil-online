import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { installRuleset, mechanicalPrimitives } from '../src/sim/kernel/definitions';
import { createComponent, startAssembly } from '../src/sim/kernel/mechanics';
import { manufactureComponent } from '../src/sim/kernel/manufacture';
import { candidateMethods, inventionGoals, inventionPlan, actOnMechanism, practicalNeed, teachPrimitive, observeMechanisms } from '../src/sim/mind/invention';
import { attributeProfile } from '../src/sim/core/human';
import { makeItem } from '../src/sim/world/factory';
import type { Goal } from '../src/sim/core/types';
import { createKernelLab, advanceKernelLab, kernelMetrics } from '../src/headless/kernel/lab';

function workshop() {
  const tw = createTestWorld(), w = tw.world, place = w.place(tw.places.tavern)!, pos = place.inside;
  const p = addPerson(tw, 'Observer', 'villager', pos); p.attributes = attributeProfile(8);
  p.physiology.energy = p.physiology.hydration = 1; p.physiology.fatigue = p.physiology.sleepDebt = 0;
  const r = mechanicalPrimitives(); installRuleset(w.kernel, r); const q = (id: string) => `${r.id}/${id}`;
  for (const d of r.components) { createComponent(w, d.id, p.id, pos); teachPrimitive(w, p, d); }
  w.kernel.reservoirs.push({ id: 'input', material: q('water'), quantity: 20, capacity: 20, pos, ownerId: p.id }, { id: 'output', material: q('water'), quantity: 0, capacity: 20, pos, ownerId: p.id });
  w.kernel.energy.push({ id: 'energy', medium: 'kinetic', initialJ: 10000, remainingJ: 10000, maxPowerW: 120, origin: 'test physical boundary', ownerId: p.id, pos });
  const need = { effect: 'transfer:liquid', targetQuantity: 3, pos, bindings: { energyId: 'energy', inputId: 'input', outputId: 'output' } };
  practicalNeed(w, p, 'need', need);
  return { tw, w, p, r, q, need, place };
}

describe('individual differences in ordinary invention cognition', () => {
  it('changes noticed physical evidence with PER, while blocked sight and distance reveal nothing', () => {
    const { w, p } = workshop(); const c = w.kernel.components[0]; c.condition = 0.88;
    p.attributes.perception = 8; observeMechanisms(w, p); expect(p.knowledge[`mechanism-damage:${c.id}`]).toBeUndefined();
    p.attributes.perception = 18; observeMechanisms(w, p);
    const k = p.knowledge[`mechanism-damage:${c.id}`]; expect(k.claim.damage).toBeGreaterThan(0); expect(k.source.type).toBe('witnessed');
    expect(w.event(k.source.viaEvent!)!.type).toBe('mechanism_observed');
    const n = w.events.length; observeMechanisms(w, p); expect(w.events.length).toBe(n);
    delete p.knowledge[k.key]; w.primaryBody(p.id)!.pos = v(1, 1, 1); observeMechanisms(w, p);
    expect(p.knowledge[k.key]).toBeUndefined();
  });
  it('orders hypotheses by inferred loss from the same evidence without granting knowledge or extra search nodes', () => {
    const { w, p, need, r } = workshop();
    const known = structuredClone(p.knowledge);
    p.attributes.intellect = 8; const ordinary = candidateMethods(w, p, need);
    p.attributes.intellect = 19; const gifted = candidateMethods(w, p, need);
    const efficiency = (m: typeof ordinary[0]) => m.definitions.reduce((n, id) => n * (r.components.find(d => d.id === id)!.efficiency ?? 1), 1);
    expect(gifted).toHaveLength(ordinary.length); expect(efficiency(gifted[0])).toBeGreaterThan(efficiency(ordinary[0]));
    expect(p.knowledge).toEqual(known);
    p.knowledge = {}; expect(candidateMethods(w, p, need)).toHaveLength(0);
  });
  it('modulates persistence after a real failed trial, while curiosity independently changes willingness', () => {
    const { w, p } = workshop(); p.traits.curiosity = 0.9;
    const goal = inventionGoals(w, p).find(g => g.type === 'compose')!;
    for (const action of inventionPlan(w, p, goal as Goal).filter(a => a.type !== 'goto')) {
      for (let i = 0; i < 30 && !['done', 'failed'].includes(action.status); i++) actOnMechanism(w, p, action, 1);
    }
    const operate = { type: 'operate_mechanism' as const, status: 'pending' as const, data: { needKey: 'need', assemblyId: w.kernel.assemblies[0].id } };
    actOnMechanism(w, p, operate, 1);
    expect(Object.values(p.knowledge).some(k => k.claim.experiment && !k.claim.success)).toBe(true);
    p.attributes.will = 5; const low = inventionGoals(w, p).find(g => g.type === 'compose')!.utility!;
    p.attributes.will = 18; const high = inventionGoals(w, p).find(g => g.type === 'compose')!.utility!;
    expect(high).toBeGreaterThan(low);
    const potential = structuredClone(p.attributePotential);
    p.traits.curiosity = 0; const disinterested = inventionGoals(w, p).find(g => g.type === 'compose')!.utility!;
    expect(disinterested).toBeLessThan(high); expect(p.attributePotential).toEqual(potential);
    expect(p.development.progress.intellect).toBeGreaterThan(0);
  });
  it('lets learned crafting outweigh raw dexterity at actual component manufacture', () => {
    const lab = workshop(), { w, p, place, r } = lab;
    const d = w.kernel.ruleset.components.find(d => d.kind === 'transmission')!;
    d.fabrication = { seconds: 30, min: {} }; const mat = w.kernel.ruleset.materials.find(m => m.id === d.material)!;
    mat.legacyItem = 'plank'; mat.kgPerUnit = 1; place.ownerId = p.id;
    // Physical stock and separate projects for each trial; compare labor, not a copied formula.
    makeItem(w, 'plank', 'available stock', { owner: p.id, placeId: place.id, pos: place.inside, quantity: 100 });
    const method = { ruleset: r.id, definitions: [d.id, d.id], connections: [], effect: 'transfer:liquid' };
    const labor = (dexterity: number, skill: number) => {
      p.attributes.dexterity = dexterity; p.skills.crafting = skill;
      const a = startAssembly(w, p, method, { placeId: place.id, energyId: 'energy' }, place.inside)!;
      for (let i = 0; i < 10; i++) if (manufactureComponent(w, p, a, d, 60) === 'made') return a.laborSeconds;
      throw new Error('Failed to manufacture');
    };
    const novice = labor(18, 0.1), veteran = labor(9, 0.92);
    expect(veteran).toBeLessThan(novice * 0.7);
  });
  it('changes real autonomous investigation with curiosity under the same ordinary goal competition', () => {
    const outcomes = [0, 0.95].map(curiosity => {
      const lab = createKernelLab(918271);
      lab.inventor.traits.curiosity = curiosity; lab.inventor.attributes.intellect = 8;
      advanceKernelLab(lab.world, lab.sim, 25);
      return kernelMetrics(lab).people[0];
    });
    expect(outcomes[1].laborSeconds).toBeGreaterThan(outcomes[0].laborSeconds);
  });
});
