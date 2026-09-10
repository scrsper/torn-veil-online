import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v } from './helpers/world';
import { GameSim } from '../src/sim/runtime/gameSim';
import { isExternallyControlled, setExternalControl } from '../src/sim/runtime/controllers';
import { introduce, interpretSocial, knownName, socialBeliefs } from '../src/sim/mind/people';
import { eventClaim, learn } from '../src/sim/mind/knowledge';
import { routineWeight, observeFields } from '../src/sim/mind/routine';
import { mechanicalHypotheses, mechanicalPersistence, actOnMechanicalTask, reverseEngineer } from '../src/sim/mind/mechanicalReasoning';
import { inspectAssembly, fittingCompetence, workOnAssembly } from '../src/sim/kernel/evolution';
import { acquireComponent, connect, contributeAssemblyLabor, createComponent, installComponent, operateAssembly, startAssembly } from '../src/sim/kernel/mechanics';
import { installRuleset, mechanicalPrimitives } from '../src/sim/kernel/definitions';
import { manufactureComponent } from '../src/sim/kernel/manufacture';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { teachPrimitive } from '../src/sim/mind/invention';
import { makeItem } from '../src/sim/world/factory';
import { ONTOLOGICAL_STAGES } from '../src/sim/core/stages';
import { ironEligible, attributeProfile } from '../src/sim/core/human';
import type { Action, Person } from '../src/sim/core/types';
import type { Method } from '../src/sim/kernel/types';
import { runAgencyShowcase, agencyWorkshop } from '../src/headless/agency/showcase';
import { advanceKernelLab } from '../src/headless/kernel/lab';
import { deserialize, serialize } from '../src/sim/persist/save';
import { Simulation } from '../src/sim/mind/agent';

function people() {
  const tw = createTestWorld(741, 24); tw.world.clock.timeScale = 1;
  const a = addPerson(tw, 'Orla Reed', 'villager', v(12, 1, 12), { controlled: true });
  const b = addPerson(tw, 'Mara Vale', 'villager', v(13, 1, 12), { controlled: true });
  const c = addPerson(tw, 'Hobb Grist', 'villager', v(12, 1, 13), { controlled: true });
  return { ...tw, a, b, c };
}
function rig() {
  const tw = people(), { world: w, a: p } = tw, pos = v(12, 1, 12), r = mechanicalPrimitives(); installRuleset(w.kernel, r);
  const q = (s: string) => `${r.id}/${s}`;
  w.kernel.energy.push({ id: 'gust', medium: 'kinetic', initialJ: 5000, remainingJ: 5000, maxPowerW: 120, origin: 'finite fixture gust', pos, ownerId: p.id });
  w.kernel.reservoirs.push({ id: 'lower', material: q('water'), quantity: 30, capacity: 30, pos, ownerId: p.id }, { id: 'upper', material: q('water'), quantity: 0, capacity: 30, pos, ownerId: p.id });
  const method: Method = { ruleset: r.id, definitions: ['intake', 'rotor', 'belt', 'impeller'].map(q), connections: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }], effect: 'transfer:liquid' };
  const assembly = startAssembly(w, p, method, { energyId: 'gust', inputId: 'lower', outputId: 'upper', placeId: tw.places.square }, pos)!;
  for (const id of method.definitions) {
    const c = createComponent(w, id, p.id, pos); acquireComponent(w, p, c.id);
    const cost = r.components.find(d => d.id === id)!.installSeconds; contributeAssemblyLabor(w, p, assembly, `install:${assembly.parts.length}`, cost, cost); installComponent(w, p, assembly, c.id);
  }
  for (const e of method.connections) { contributeAssemblyLabor(w, p, assembly, `join:${e.from}:${e.to}`, 0.5, 0.5); connect(w, p, assembly, e.from, e.to); }
  for (const d of r.components) teachPrimitive(w, p, d);
  p.attributes.perception = 16; p.attributes.intellect = 8; p.attributes.dexterity = 16; p.skills.crafting = 0.95;
  const tool = makeItem(w, 'hammer', 'work hammer', { owner: p.id, holder: p.id });
  return { ...tw, assembly, q, tool };
}
function evidence(tw: ReturnType<typeof people>, observer: Person, type: 'gift' | 'theft' | 'mechanism_trial', output = 0) {
  const event = tw.world.emit(type, { actor: tw.a.id, target: tw.c.id, pos: v(12, 1, 12), data: { output } });
  const k = learn(tw.world, observer, { key: `ev:${event.id}`, kind: 'event', claim: eventClaim(tw.world, event, true), confidence: 1, source: { type: 'witnessed', viaEvent: event.id } }, true)!;
  interpretSocial(tw.world, observer, k); return k;
}

describe('private minds, epistemic identity and controller parity', () => {
  it('does not teach names to an unconscious or distant body', () => {
    const tw = people(), body = tw.world.primaryBody(tw.b.id)!;
    body.pose = 'sleep'; expect(introduce(tw.world, tw.a, tw.b)).toBe(false);
    body.pose = 'stand'; body.pos.x += 10; expect(introduce(tw.world, tw.a, tw.b)).toBe(false);
    expect(knownName(tw.b, tw.a.id)).toBe('an unfamiliar person');
  });
  it('acquires and revises crop evidence locally, without a remote schedule revealing it', () => {
    const tw = people(), field = { id: 'test-field', placeId: tw.places.square, ownerId: tw.a.id, soilMoisture: 0.5,
      plots: [{ x: 12, y: 1, z: 13, crop: 'wheat' as const, state: 'mature' as const, growth: 1, plantedAt: 0 }] };
    tw.world.fields.push(field); observeFields(tw.world, tw.a);
    const key = `field-observation:${field.id}`;
    expect(tw.a.knowledge[key].claim.ripe).toBe(true);
    const plot = tw.world.fields[0].plots[0]; plot.state = 'fallow'; tw.world.physicalTime += 3;
    observeFields(tw.world, tw.a); expect(tw.a.knowledge[key].claim).toMatchObject({ ripe: false, fallow: true });
    const remote = tw.world.primaryBody(tw.b.id)!; remote.pos.x += 50;
    tw.b.schedule = [{ start: 0, end: 24, activity: 'work', placeId: field.placeId, label: 'farm' }];
    observeFields(tw.world, tw.b); expect(tw.b.knowledge[key]).toBeUndefined();
  });
  it('perceives unfamiliar people without names, hidden stats, intent or control status in either direction', () => {
    const tw = people(), game = new GameSim(tw.sim); game.attach('human-one', tw.a.id); game.attach('human-two', tw.b.id);
    step(tw, 0.3);
    expect(tw.b.mind.percepts.some(p => p.entityId === tw.a.id)).toBe(true);
    expect(knownName(tw.b, tw.a.id)).toBe('an unfamiliar person');
    expect(knownName(tw.a, tw.b.id)).toBe('an unfamiliar person');
    expect('controlled' in tw.a).toBe(false); expect('controller' in tw.a.mind).toBe(false);
    expect(isExternallyControlled(tw.a)).toBe(true);
    const json = JSON.stringify(game.perceive('human-one'));
    for (const forbidden of ['traits', 'skills', 'attributes', 'intention', 'parentIds', 'controlled', 'Mara Vale']) expect(json).not.toContain(forbidden);
    expect(game.debugTruth(tw.b.id)!.traits).toEqual(tw.b.traits);
  });
  it('learns identity from introductions, retains a false name, and allows later contradictory testimony', () => {
    const tw = people(); introduce(tw.world, tw.a, tw.b, 'Elin Moss');
    expect(knownName(tw.b, tw.a.id)).toBe('Elin Moss'); expect(tw.a.name).toBe('Orla Reed');
    introduce(tw.world, tw.a, tw.b);
    expect(knownName(tw.b, tw.a.id)).toBe('Orla Reed');
    expect(tw.b.knowledge[`identity:${tw.a.id}`].claim.evidence).toHaveLength(2);
    expect(knownName(tw.c, tw.a.id)).toBe('an unfamiliar person');
  });
  it('forms materially different evidence-backed impressions of the same failed experiment', () => {
    const tw = people(); tw.b.traits.curiosity = 1; tw.b.traits.courage = 1; tw.c.traits.curiosity = 0; tw.c.traits.courage = 0;
    const k = evidence(tw, tw.b, 'mechanism_trial');
    const copy = learn(tw.world, tw.c, { ...k, source: { ...k.source } }, true)!; interpretSocial(tw.world, tw.c, copy);
    const key = `social:${tw.a.id}:disposition:curious`;
    expect(tw.b.knowledge[key].claim.social.support).toBeGreaterThan(0);
    expect(tw.c.knowledge[key].claim.social.support).toBeLessThan(0);
    expect(tw.b.knowledge[key].source.type).toBe('inferred');
    expect(tw.world.event(tw.b.knowledge[key].source.viaEvent!)!.causes).toContain(k.source.viaEvent);
  });
  it('revises beliefs after contradictory behavior without inspecting the target substrate', () => {
    const tw = people(); Object.defineProperty(tw.a, 'traits', { get() { throw Error('hidden traits read'); } });
    evidence(tw, tw.b, 'gift'); const key = `social:${tw.a.id}:disposition:generous`;
    expect(tw.b.knowledge[key].claim.social.support).toBeGreaterThan(0);
    evidence(tw, tw.b, 'theft'); evidence(tw, tw.b, 'theft');
    expect(tw.b.knowledge[key].claim.social.support).toBeLessThan(0);
    expect(tw.b.knowledge[key].claim.social.evidence).toHaveLength(3);
    expect(socialBeliefs(tw.b).every(k => k.confidence < 1)).toBe(true);
  });
  it('infers intent from visible action and never copies canonical intent or anonymous attribution', () => {
    const tw = people(); const event = tw.world.emit('attack', { actor: tw.a.id, target: tw.c.id, data: { intent: 'kill', goal: 'rob', traits: tw.a.traits } });
    const claim = eventClaim(tw.world, event, true); expect(claim.intent).toBeUndefined(); expect(claim.traits).toBeUndefined();
    const heard = learn(tw.world, tw.b, { key: 'heard', kind: 'event', claim: eventClaim(tw.world, event, false), confidence: 0.5, source: { type: 'heard', viaEvent: event.id } }, true)!;
    interpretSocial(tw.world, tw.b, heard); expect(socialBeliefs(tw.b)).toHaveLength(0);
    const seen = learn(tw.world, tw.b, { key: 'seen', kind: 'event', claim, confidence: 1, source: { type: 'witnessed', viaEvent: event.id } }, true)!;
    interpretSocial(tw.world, tw.b, seen); expect(socialBeliefs(tw.b).some(k => k.claim.social.family === 'intent')).toBe(true);
  });
  it('human intentions use canonical handlers and latent dispositions do not select an autonomous plan', () => {
    const tw = people(), game = new GameSim(tw.sim); game.attach('human', tw.a.id);
    tw.a.traits.aggression = 1; tw.a.traits.curiosity = 1; tw.a.schedule = [{ start: 0, end: 24, activity: 'work', placeId: tw.places.square, label: 'work' }];
    step(tw, 0.5); expect(tw.a.mind.goal).toBeNull();
    expect(game.intend('human', { kind: 'introduce', target: tw.b.id })).toBe(true); step(tw, 0.2);
    expect(knownName(tw.b, tw.a.id)).toBe(tw.a.name); expect(tw.world.events.some(e => e.type === 'introduction' && e.actor === tw.a.id)).toBe(true);
  });
  it('a known loved-one welfare concern weakens routine work while circumstances otherwise match', () => {
    const tw = people(); Object.assign(tw.b.traits, tw.a.traits); Object.assign(tw.b.needs, tw.a.needs);
    tw.b.relationships[tw.c.id] = { ...tw.b.relationships[tw.c.id], affection: 0.95 } as any;
    tw.b.mind.concerns = [{ kind: 'welfare', subjectId: tw.c.id, intensity: 1, status: 'active' } as any];
    expect(routineWeight(tw.b)).toBeLessThan(routineWeight(tw.a) * 0.5);
  });
  it('declares only ordered future stages and derives Iron readiness without transition', () => {
    const tw = people(); tw.a.attributes = attributeProfile(15);
    expect(ONTOLOGICAL_STAGES).toEqual(['Normal', 'Iron', 'Bronze', 'Silver', 'Gold', 'Diamond', 'God', 'Astral King', 'Astral Being', 'John Smith']);
    expect(ironEligible(tw.a)).toBe(true); expect(tw.a.ontology.stage).toBe('Normal');
  });
});

describe('causal repair and fallible mechanical models', () => {
  it('manufactures a real spare for a completed assembly using known shape, stock and paid labor', () => {
    const tw = rig(), { world: w, a: p, assembly: a } = tw;
    const definition = w.kernel.ruleset.components.find(d => d.id === tw.q('belt'))!;
    const material = w.kernel.ruleset.materials.find(m => m.id === definition.material)!;
    material.legacyItem = 'plank'; material.kgPerUnit = 4; definition.fabrication = { seconds: 4, min: {} };
    w.place(tw.places.square)!.inside = { ...a.pos }; w.place(tw.places.square)!.ownerId = p.id;
    addPlaceStock(w, 'plank', 10, tw.places.square, p.id, undefined, 'physical test stock');
    const before = stockAt(w, 'plank', tw.places.square), parts = [...a.parts];
    expect(manufactureComponent(w, p, a, definition, 0.1, 'spare')).toBe('working');
    expect(stockAt(w, 'plank', tw.places.square)).toBe(before);
    expect(manufactureComponent(w, p, a, definition, 60, 'spare')).toBe('made');
    expect(before - stockAt(w, 'plank', tw.places.square)).toBeCloseTo(definition.massKg / material.kgPerUnit);
    expect(a.parts).toEqual(parts);
    const spare = w.kernel.components.at(-1)!; expect(spare.assemblyId).toBeNull();
    expect(w.event(spare.madeEvent!)!.data.laborSeconds).toBeGreaterThan(0);
  });
  it('PER changes evidence and unfamiliar examples do not disclose definitions or complete graphs', () => {
    const tw = rig(); tw.world.kernel.components.find(c => c.id === tw.assembly.parts[2])!.condition = 0.7;
    tw.a.attributes.perception = 2; const low = inspectAssembly(tw.world, tw.a, tw.assembly)!;
    tw.a.attributes.perception = 20; const high = inspectAssembly(tw.world, tw.a, tw.assembly)!;
    expect(high.joints.length).toBeGreaterThan(low.joints.length);
    expect(high.parts.filter(p => p.wear).length).toBeGreaterThan(low.parts.filter(p => p.wear).length);
    const stranger = inspectAssembly(tw.world, tw.b, tw.assembly)!;
    expect(stranger.parts.every(p => !p.definition)).toBe(true);
    expect('method' in stranger).toBe(false); expect('condition' in stranger.parts[0]).toBe(false);
  });
  it('a genuine break stops output; paid replacement and kernel testing can restore it, with all parts conserved', () => {
    const tw = rig(), { world: w, a: p, assembly: a } = tw;
    const old = w.kernel.components.find(c => c.id === a.parts[2])!; old.condition = 0;
    expect(operateAssembly(w, p, a, 1).reason).toBe('broken');
    const spare = createComponent(w, tw.q('belt'), p.id, a.pos), progress = {};
    const count = w.kernel.components.length, before = a.laborSeconds;
    const result = workOnAssembly(w, p, a, { kind: 'replace', part: 2, componentId: spare.id }, progress, 60);
    expect(result).toBe('fitted'); expect(a.laborSeconds).toBeGreaterThan(before); expect(tw.tool.condition!).toBeLessThan(1);
    expect(old.assemblyId).toBeNull(); expect(old.condition).toBe(0); expect(w.kernel.components).toHaveLength(count);
    expect(operateAssembly(w, p, a, 1).output).toBeGreaterThan(0); expect(a.history!.at(-1)!.parents.length).toBeGreaterThan(0);
  });
  it('legitimate poor fitting can waste labor and damage a real spare instead of restoring condition', () => {
    const tw = rig(), { world: w, a: p, assembly: a } = tw; p.skills.crafting = 0; p.attributes.dexterity = 1; p.attributes.intellect = 1;
    const old = w.kernel.components.find(c => c.id === a.parts[2])!; old.condition = 0;
    const spare = createComponent(w, tw.q('belt'), p.id, a.pos);
    const result = workOnAssembly(w, p, a, { kind: 'replace', part: 2, componentId: spare.id }, {}, 60);
    expect(result).toBe('damaged'); expect(spare.condition).toBeLessThan(1); expect(a.parts[2]).toBe(old.id);
    expect(operateAssembly(w, p, a, 1).output).toBe(0);
  });
  it('skill dominates practical fitting, INT changes hypotheses, and WILL changes bounded persistence', () => {
    const tw = rig(); tw.a.attributes.intellect = 6; tw.b.attributes.intellect = 20; tw.b.skills.crafting = 0;
    expect(fittingCompetence(tw.a)).toBeGreaterThan(fittingCompetence(tw.b));
    const e = inspectAssembly(tw.world, tw.a, tw.assembly)!; e.parts[2].wear = 'worn'; e.looseEnds = [1];
    tw.a.skills.crafting = 0; tw.a.attributes.intellect = 1; const low = mechanicalHypotheses(tw.a, e);
    tw.a.attributes.intellect = 20; const high = mechanicalHypotheses(tw.a, e);
    expect(high).not.toEqual(low);
    tw.a.attributes.will = 1; const lowWill = mechanicalPersistence(tw.a, 3); tw.a.attributes.will = 20;
    expect(mechanicalPersistence(tw.a, 3)).toBeGreaterThan(lowWill); expect(mechanicalPersistence(tw.a, 20)).toBe(0);
  });
  it('reverse engineering can remain incomplete and an inferred copy is validated by the ordinary kernel', () => {
    const tw = rig(); const e = inspectAssembly(tw.world, tw.b, tw.assembly)!;
    const incomplete = reverseEngineer(tw.world, tw.b, e, e.eventId);
    expect(incomplete.claim.method).toBeUndefined(); expect(incomplete.claim.inferredMethod.definitions).toContain(null);
    const observed = inspectAssembly(tw.world, tw.a, tw.assembly)!;
    const inferred = reverseEngineer(tw.world, tw.a, observed, observed.eventId);
    const copy = startAssembly(tw.world, tw.a, inferred.claim.method, tw.assembly.bindings, tw.assembly.pos)!;
    expect(copy.history![0].parents).toContain(observed.eventId); expect(operateAssembly(tw.world, tw.a, copy, 1).output).toBe(0);
  });
  it('rejects remote/foreign work and malformed action indices before mutation', () => {
    const tw = rig(), game = new GameSim(tw.sim); game.attach('human', tw.b.id);
    const before = JSON.stringify(tw.assembly);
    expect(workOnAssembly(tw.world, tw.b, tw.assembly, { kind: 'dismantle' }, {}, 10)).toBe('unavailable');
    expect(game.intend('human', { kind: 'replace', assemblyId: tw.assembly.id, part: NaN, componentId: 'missing' })).toBe(false);
    expect(JSON.stringify(tw.assembly)).toBe(before);
  });
  it('exposes local action handles without allowing a caller to inject labor or outcomes', () => {
    const tw = rig(), game = new GameSim(tw.sim); game.attach('human', tw.a.id);
    const spare = createComponent(tw.world, tw.q('belt'), tw.a.id, tw.assembly.pos);
    expect(game.perceive('human')!.visibleMechanisms.map(a => a.assemblyId)).toContain(tw.assembly.id);
    expect(game.perceive('human')!.visibleComponents.map(c => c.componentId)).toContain(spare.id);
    expect(game.intend('human', { kind: 'replace', assemblyId: tw.assembly.id, part: 2, componentId: spare.id, labor: 100, result: 'fitted' } as any)).toBe(true);
    expect(tw.a.mind.plan[0].data!.labor).toBeUndefined(); expect(tw.a.mind.plan[0].data!.result).toBeUndefined();
    step(tw, 0.1); expect(tw.assembly.parts[2]).not.toBe(spare.id);
    game.attach('human', tw.a.id); expect(tw.a.mind.plan[0].status).toBe('active');
  });
  it('a material-compatible substitute changes actual measured output and retains ancestry', () => {
    const tw = rig(), { world: w, assembly: a, a: p } = tw;
    const before = operateAssembly(w, p, a, 1);
    const original = w.kernel.ruleset.components.find(d => d.id === tw.q('belt'))!;
    const variant = { ...original, id: tw.q('rough-belt'), efficiency: original.efficiency * 0.4 };
    w.kernel.ruleset.components.push(variant);
    const spare = createComponent(w, variant.id, p.id, a.pos);
    expect(workOnAssembly(w, p, a, { kind: 'replace', part: 2, componentId: spare.id }, {}, 60)).toBe('fitted');
    const after = operateAssembly(w, p, a, 1);
    expect(after.output).toBeLessThan(before.output * 0.5); expect(after.inputJ).toBeCloseTo(before.inputJ);
    expect(after.usefulJ + after.dissipatedJ).toBeCloseTo(after.inputJ);
    expect(a.history!.at(-1)!.method.definitions).toContain(variant.id);
    expect(a.history!.at(-1)!.parents.length).toBeGreaterThan(0);
  });
  it('a plausible but wrong inferred topology is rejected by the existing connection kernel', () => {
    const tw = rig(), { world: w, a: p, assembly: a } = tw;
    [a.parts[1], a.parts[2]] = [a.parts[2], a.parts[1]];
    a.connections = [{ from: 0, to: 2 }, { from: 2, to: 1 }, { from: 1, to: 3 }];
    p.attributes.intellect = 1; p.attributes.perception = 1; p.skills.crafting = 0;
    const observation = inspectAssembly(w, p, a)!;
    const k = reverseEngineer(w, p, observation, observation.eventId);
    expect(k.claim.method.connections).not.toEqual(a.connections);
    const copy = startAssembly(w, p, k.claim.method, a.bindings, a.pos)!;
    for (const definition of k.claim.method.definitions) {
      const c = createComponent(w, definition, p.id, a.pos); acquireComponent(w, p, c.id);
      const cost = w.kernel.ruleset.components.find(d => d.id === definition)!.installSeconds;
      contributeAssemblyLabor(w, p, copy, `install:${copy.parts.length}`, cost, cost); installComponent(w, p, copy, c.id);
    }
    const first = k.claim.method.connections[0]; contributeAssemblyLabor(w, p, copy, `join:${first.from}:${first.to}`, 0.5, 0.5);
    expect(connect(w, p, copy, first.from, first.to)).toBe(false);
    expect(operateAssembly(w, p, copy, 1).output).toBe(0);
  });
});

describe('integrated autonomous history and durable epistemics', () => {
  it('demonstrates local intentions, avatar parity, observed competence and exact same-seed replay', () => {
    const report = runAgencyShowcase(741), replay = runAgencyShowcase(741);
    expect(report).toEqual(replay); expect(report.replayMatches, report.replayDifferences.join('\n')).toBe(true);
    expect(report.firstEncounter).toMatchObject({ npcNameForAvatar: 'an unfamiliar person', avatarNameForNPC: 'an unfamiliar person', personHasControlField: false });
    const choices = report.npcDecisions as { choices: string[] }[];
    expect(choices[0].choices).toContain('maintain_mechanism'); expect(choices[1].choices[0]).toBe('socialize');
    expect(report.causalEvents.some(e => e.type === 'mechanism_worked' && e.data.outcome === 'fitted')).toBe(true);
    const avatarId = report.canonical.people.at(-1)!.id;
    expect(report.privateBeliefs.some(p => p.social.some(k => k.claim.social.subject === avatarId))).toBe(true);
    expect(report.playerVisible!.people.some(p => p.knownName)).toBe(true);
    expect(JSON.stringify(report.playerVisible)).not.toContain('attributes');
  });
  it('persists partially paid human work, unknown identities and subjective models independently of the controller', () => {
    const lab = agencyWorkshop(741), { world: w, sim, game, assembly, avatar } = lab;
    game.intend('local', { kind: 'inspect', assemblyId: assembly.id }); advanceKernelLab(w, sim, 0.6);
    const saved = JSON.parse(serialize(w));
    expect(saved.persons.find((p: Person) => p.id === avatar.id).controlled).toBeUndefined();
    const loaded = deserialize(JSON.stringify(saved))!.world, resumed = new Simulation(loaded);
    expect(loaded.person(avatar.id)!.knowledge).toEqual(avatar.knowledge);
    expect(loaded.person(avatar.id)!.mind.plan).toEqual(avatar.mind.plan);
    advanceKernelLab(w, sim, 4); advanceKernelLab(loaded, resumed, 4);
    expect(loaded.kernel).toEqual(w.kernel); expect(loaded.person(avatar.id)!.knowledge).toEqual(avatar.knowledge);
    const canonical = structuredClone(loaded.person(avatar.id)!);
    setExternalControl(loaded.person(avatar.id)!, false);
    expect(loaded.person(avatar.id)).toEqual(canonical);
  });
});
