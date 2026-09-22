import { describe, expect, it, vi } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import { recordCapabilityPractice, capabilityExperience } from '../src/sim/core/capability';
import { advanceToIron, assessAdvancement, advancementBlocked } from '../src/sim/core/advancement';
import { attributeProfile } from '../src/sim/core/human';
import { deserialize, serialize } from '../src/sim/persist/save';
import { agencyWorkshop } from '../src/headless/agency/showcase';
import { createComponent } from '../src/sim/kernel/mechanics';
import { workOnAssembly } from '../src/sim/kernel/evolution';
import { initializeNearIronFixture, runCapabilityWorldLab } from '../src/headless/worldlab/capability';
import { GameSim } from '../src/sim/runtime/gameSim';
import { advanceKernelLab } from '../src/headless/kernel/lab';

describe('action-grounded capability and advancement foundation', () => {
  it('rejects empty dismantling and gives no practice for graph operations that change nothing', () => {
    const scene = agencyWorkshop(912);
    expect(workOnAssembly(scene.world, scene.a, scene.assembly, { kind: 'disconnect', from: 50, to: 51 }, {}, 60)).toBe('damaged');
    expect(scene.a.capability).toBeUndefined();
    scene.assembly.parts = []; scene.assembly.connections = [];
    const before = scene.assembly.laborSeconds;
    expect(workOnAssembly(scene.world, scene.a, scene.assembly, { kind: 'dismantle' }, {}, 60)).toBe('unavailable');
    expect(scene.assembly.laborSeconds).toBe(before);
    expect(scene.a.capability).toBeUndefined();
  });
  it('requires fresh labor when a failed fitting retries the same progress object', () => {
    const scene = agencyWorkshop(914), progress = {};
    const spare = createComponent(scene.world, `${scene.world.kernel.ruleset.id}/belt`, scene.a.id, scene.assembly.pos);
    const random = vi.spyOn(scene.world.rng, 'next').mockReturnValue(0.99999);
    const task = { kind: 'replace' as const, part: 2, componentId: spare.id };
    expect(workOnAssembly(scene.world, scene.a, scene.assembly, task, progress, 60)).toBe('damaged');
    const labor = scene.assembly.laborSeconds;
    expect(workOnAssembly(scene.world, scene.a, scene.assembly, task, progress, 60)).toBe('damaged');
    expect(scene.assembly.laborSeconds).toBeGreaterThan(labor);
    random.mockRestore();
  });
  it('credits the actual paid crafting handler once, including reduced damaged feedback', () => {
    const scene = agencyWorkshop(912), old = scene.world.kernel.components.find(c => c.id === scene.assembly.parts[2])!;
    old.condition = 0;
    const spare = createComponent(scene.world, `${scene.world.kernel.ruleset.id}/belt`, scene.a.id, scene.assembly.pos);
    const result = workOnAssembly(scene.world, scene.a, scene.assembly, { kind: 'replace', part: 2, componentId: spare.id }, {}, 60);
    expect(['fitted', 'damaged']).toContain(result);
    const event = [...scene.world.events].reverse().find(e => e.type === 'mechanism_worked')!;
    expect(event.type).toBe('mechanism_worked');
    const first = scene.a.capability?.bySkill.crafting?.effectiveSeconds ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(recordCapabilityPractice(scene.world, scene.a, { skill: 'crafting', sourceEventId: event.id, seconds: event.data.laborSeconds, outcome: result === 'fitted' ? 'success' : 'partial', actionKey: 'assembly:replace' }).credited).toBe(false);
  });

  it('credits only a real actor event and diminishes unchanged repetition deterministically', () => {
    const tw = createTestWorld(909, 24), p = addPerson(tw, 'Capable', 'villager', v(12, 1, 12));
    const first = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'connect', outcome: 'fitted', laborSeconds: 60 } });
    const second = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'connect', outcome: 'fitted', laborSeconds: 60 } });
    const a = recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: first.id, seconds: 60, outcome: 'success', challenge: 1, actionKey: 'join:machine' });
    const b = recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: second.id, seconds: 60, outcome: 'success', challenge: 1, actionKey: 'join:machine' });
    expect(a.credited).toBe(true); expect(b.credited).toBe(true); expect(b.effectiveSeconds).toBeLessThan(a.effectiveSeconds);
    expect(capabilityExperience(p, 'crafting')).toBeCloseTo(a.effectiveSeconds + b.effectiveSeconds);
    const foreign = tw.world.emit('mechanism_worked', { actor: 'someone-else', data: { operation: 'connect', outcome: 'fitted', laborSeconds: 60 } });
    expect(recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: foreign.id, seconds: 60, outcome: 'success' }).reason).toBe('unproven');
  });

  it('persists the bounded ledger and does not turn a ledger into automatic Gold', () => {
    const tw = createTestWorld(910, 24), p = addPerson(tw, 'Worker', 'villager', v(12, 1, 12));
    const e = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'connect', outcome: 'fitted', laborSeconds: 60 } });
    recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: e.id, seconds: 60, outcome: 'success', challenge: 1 });
    const loaded = deserialize(serialize(tw.world))!.world.person(p.id);
    expect(p.capability?.bySkill.crafting.effectiveSeconds).toBeGreaterThan(0);
    expect(loaded?.capability).toEqual(p.capability);
    expect(loaded?.ontology.stage).toBe('Normal');
  });

  it('requires relevant instruction, dated practice, recovered foundations and pays a causal Iron transition', () => {
    const tw = createTestWorld(911, 24), p = addPerson(tw, 'Founder', 'villager', v(12, 1, 12));
    initializeNearIronFixture(tw.world, p);
    expect(assessAdvancement(tw.world, p).eligible).toBe(false);
    const last = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'replace', outcome: 'fitted', laborSeconds: 30 } });
    recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: last.id, seconds: 1, outcome: 'failure' });
    expect(assessAdvancement(tw.world, p).eligible).toBe(true);
    p.knowledge['technique:crafting'].claim.skill = 'baking'; expect(assessAdvancement(tw.world, p).eligible).toBe(false);
    p.knowledge['technique:crafting'].claim.skill = 'crafting';
    tw.world.primaryBody(p.id)!.pose = 'sleep'; expect(advanceToIron(tw.world, p)).toBe(false);
    tw.world.primaryBody(p.id)!.pose = 'stand';
    expect(p.ontology.stage).toBe('Normal');
    const energy = p.physiology.energy, conditioning = p.physiologyTraits.conditioning;
    const events = Object.values(p.capability!.bySkill).flatMap(s => s.sourceEventIds);
    expect(advanceToIron(tw.world, p, events)).toBe(true);
    expect(p.ontology.stage).toBe('Iron');
    expect(p.physiology.energy).toBeLessThan(energy); expect(p.physiologyTraits.conditioning).toBeGreaterThan(conditioning);
    expect(tw.world.events.at(-1)?.type).toBe('ontological_advancement');
    expect(advancementBlocked('Gold')).toBe(true);
    expect(assessAdvancement(tw.world, p, ['Iron', 'Bronze']).eligible).toBe(false);
    expect(deserialize(serialize(tw.world))!.world.person(p.id)!.ontology).toEqual(p.ontology);
  });

  it('derives credit from paid source data, preserves unrelated skills and RNG, rejects replay after recent eviction', () => {
    const tw = createTestWorld(914, 24), p = addPerson(tw, 'Learner', 'villager', v(12, 1, 12));
    const before = { ...p.skills }, rng = [tw.world.rng.state(), tw.world.weatherRng.state(), tw.world.demographicRng.state()];
    const e = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'replace', outcome: 'damaged', laborSeconds: 30 } });
    const credit = recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: e.id, seconds: 9999999, outcome: 'success', challenge: 1 });
    expect(credit.credited).toBe(true); expect(credit.effectiveSeconds).toBeLessThan(30);
    expect(p.skills.crafting ?? 0).toBeGreaterThan(before.crafting ?? 0);
    const { crafting: _, ...afterOthers } = p.skills, { crafting: __, ...beforeOthers } = before;
    expect(afterOthers).toEqual(beforeOthers);
    expect([tw.world.rng.state(), tw.world.weatherRng.state(), tw.world.demographicRng.state()]).toEqual(rng);
    p.capability!.creditedEventIds = []; p.capability!.recent = [];
    expect(recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: e.id, seconds: 30, outcome: 'partial' }).credited).toBe(false);
    const noop = tw.world.emit('mechanism_worked', { actor: p.id, data: { operation: 'replace', outcome: 'fitted', laborSeconds: 0 } });
    expect(recordCapabilityPractice(tw.world, p, { skill: 'crafting', sourceEventId: noop.id, seconds: 30, outcome: 'success' }).credited).toBe(false);
    expect(recordCapabilityPractice(tw.world, p, { skill: 'baking', sourceEventId: noop.id, seconds: 30, outcome: 'success' }).credited).toBe(false);
  });

  it('demonstrates real repairs separately from the disclosed near-Iron fixture', () => {
    const result = runCapabilityWorldLab();
    expect(result.natural.events.every(e => e.seconds > 0 && e.effectiveSeconds > 0)).toBe(true);
    expect(result.natural.after.crafting).toBeGreaterThan(result.natural.before.crafting!);
    expect(result.natural.stage).toBe('Normal'); expect(result.persistenceMatches).toBe(true);
    expect(result.breakthroughFixture.initiallyReady).toBe(false); expect(result.breakthroughFixture.advanced).toBe(true);
    expect(result.breakthroughFixture.chronicle).toHaveLength(1);
    expect(result.breakthroughFixture.chronicle[0].causes).toEqual(expect.arrayContaining(result.breakthroughFixture.readiness.evidenceEventIds));
  });

  it('routes a controlled advance through the timed shared action and retains causal samples through compaction', () => {
    const tw = createTestWorld(915, 24), p = addPerson(tw, 'Ready', 'villager', v(12, 1, 12), { controlled: true });
    tw.world.clock.timeScale = 1;
    initializeNearIronFixture(tw.world, p); p.capability!.bySkill.crafting.effectiveSeconds += 0.1;
    const refs = [...p.capability!.bySkill.crafting.sourceEventIds];
    for (let i = 0; i < 30; i++) tw.world.emit('perceived', { actor: p.id, significance: 0 });
    tw.world.compactEvents(2);
    expect(refs.every(id => tw.world.event(id))).toBe(true);
    const game = new GameSim(tw.sim); game.attach('human', p.id);
    expect(game.intend('human', { kind: 'advance' })).toBe(true);
    advanceKernelLab(tw.world, tw.sim, 1); expect(p.ontology.stage).toBe('Normal');
    advanceKernelLab(tw.world, tw.sim, 61); expect(p.ontology.stage).toBe('Iron');
    expect(p.ontology.breakthroughEventId).toBeDefined();
    expect(game.intend('human', { kind: 'advance' })).toBe(true);
    advanceKernelLab(tw.world, tw.sim, 1); expect(p.ontology.stage).toBe('Iron');
  });
});
