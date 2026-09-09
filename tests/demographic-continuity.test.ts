import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/core/world';
import { generateVillage } from '../src/sim/world/village';
import { compactChronicle } from '../src/sim/history/chronicle';
import { computeHistoricalSignificance, computeHistoricalSignificanceFull } from '../src/sim/history/significance';
import { diePerson, giveBirth, marry } from '../src/sim/world/demographics';
import { householdConsistencyErrors } from '../src/sim/world/household';
import { deserialize, serialize } from '../src/sim/persist/save';
import { stepDemographics } from '../src/sim/world/demographics';

function village(seed = 99173) { const world = new World(seed); const gen = generateVillage(world); return { world, ...gen }; }

describe('demographic continuity and year-scale substrate', () => {
  it('keeps cumulative identities while living indices and households remain exact', () => {
    const { world } = village();
    expect(world.livingIndexErrors()).toEqual([]);
    expect(householdConsistencyErrors(world)).toEqual([]);
    const living = world.livingPersons()[0];
    const cumulative = world.persons().length;
    diePerson(world, living, undefined, 'test mortality');
    expect(world.person(living.id)).toBe(living);
    expect(world.persons()).toHaveLength(cumulative);
    expect(world.isLivingIndexed(living.id)).toBe(false);
    expect(world.livingIndexErrors()).toEqual([]);
    expect(householdConsistencyErrors(world)).toEqual([]);
    expect(diePerson(world, living)).toBeNull();
    expect(world.events.filter(e => e.type === 'death' && e.target === living.id)).toHaveLength(1);
  });

  it('creates an ordinary persisted child with lineage and a real household', () => {
    const { world, people } = village();
    const mother = people.greta; const father = people.alwin;
    mother.physiology.pregnancy = { gestationalParentId: mother.id, otherParentId: father.id, conceivedAt: world.now - 280 * 86400, dueAt: world.now, state: 'gestating', lastProgressAt: world.now, causeEventId: world.emit('pregnancy_started', { actor: mother.id, target: father.id, category: 'history' }).id };
    const child = giveBirth(world, mother)!;
    expect(child.kind).toBe('person');
    expect(child.parentIds).toEqual([mother.id, father.id]);
    expect(child.lifeStage).toBe('infant');
    expect(world.isLivingIndexed(child.id)).toBe(true);
    expect(world.get(child.householdId)?.kind).toBe('household');
    expect(householdConsistencyErrors(world)).toEqual([]);
    const loaded = deserialize(serialize(world))!.world;
    const restored = loaded.person(child.id)!;
    expect(restored.parentIds).toEqual(child.parentIds);
    expect(restored.householdId).toBe(child.householdId);
    expect(loaded.isLivingIndexed(child.id)).toBe(true);
    expect(loaded.livingIndexErrors()).toEqual([]);
  });

  it('marries through the declared event and conserves an inherited estate', () => {
    const { world, people } = village();
    const a = people.tomas; const b = people.mara;
    // Marriage requires both participants to attend, just like the ordinary courtship action.
    world.primaryBody(b.id)!.pos = { ...world.primaryBody(a.id)!.pos };
    expect(marry(world, a, b)).toBe(true);
    expect(world.events.some(e => e.type === 'marriage' && e.actor === a.id && e.target === b.id)).toBe(true);
    expect(a.householdId).toBe(b.householdId);
    const beforeCurrency = world.persons().reduce((sum, p) => sum + p.wealth, 0) + world.households().reduce((sum, h) => sum + h.wealth, 0);
    const owned = world.items().find(i => i.ownerId === a.id);
    diePerson(world, a, undefined, 'test mortality');
    const afterCurrency = world.persons().reduce((sum, p) => sum + p.wealth, 0) + world.households().reduce((sum, h) => sum + h.wealth, 0);
    expect(afterCurrency).toBeCloseTo(beforeCurrency, 8);
    if (owned) {
      expect(owned.ownerId).toBe(b.id);
      expect(owned.provenance.at(-1)?.how).toBe('inheritance');
    }
    expect(world.events.filter(e => e.type === 'inheritance' && e.actor === a.id)).toHaveLength(1);
  });

  it('keeps incremental significance equivalent and compacts old Chronicle detail idempotently', () => {
    const { world, people } = village();
    const cause = world.emit('attack', { actor: people.rowan.id, target: people.skarn.id, significance: 0.8 });
    for (let i = 0; i < 4; i++) world.emit('told', { actor: people.rowan.id, target: people.hale.id, causes: [cause.id], significance: 0.2 });
    expect([...computeHistoricalSignificance(world).entries()]).toEqual([...computeHistoricalSignificanceFull(world.events).entries()]);
    const oldA = world.emit('attack', { tick: world.now - 10 * 365 * 86400, actor: people.rowan.id, target: people.skarn.id, significance: 0.8 });
    const oldB = world.emit('attack', { tick: oldA.tick + 60, actor: people.rowan.id, target: people.skarn.id, significance: 0.8 });
    compactChronicle(world);
    const first = JSON.stringify(world.chronicleEras);
    expect(world.chronicleEras.length).toBeGreaterThan(0);
    compactChronicle(world);
    expect(JSON.stringify(world.chronicleEras)).toBe(first);
    for (let i = 0; i < 4; i++) world.emit('arrived', { actor: people.hale.id, significance: 0.01 });
    const scoreBeforeEventCompaction = [...world.historicalSignificance.entries()];
    world.compactEvents(2);
    expect(world.event(oldB.id)?.id).toBe(world.chronicleEventAliases.get(oldB.id));
    expect([...world.historicalSignificance.entries()]).toEqual(scoreBeforeEventCompaction);
    const loaded = deserialize(serialize(world))!.world;
    expect(loaded.chronicleEras).toEqual(world.chronicleEras);
    expect(loaded.event(oldB.id)).toBeDefined();
    expect([...loaded.historicalSignificance.entries()]).toEqual([...world.historicalSignificance.entries()]);
  });

  it('round-trips a pregnancy without changing its deterministic future birth', () => {
    const { world, people } = village(77421);
    const mother = people.greta; const father = people.alwin;
    const started = world.emit('pregnancy_started', { actor: mother.id, target: father.id, category: 'history' });
    mother.physiology.pregnancy = {
      gestationalParentId: mother.id, otherParentId: father.id, conceivedAt: world.now,
      dueAt: world.now + 3 * 86400, state: 'gestating', lastProgressAt: world.now, causeEventId: started.id,
    };
    const loaded = deserialize(serialize(world))!.world;
    for (let day = 0; day < 4; day++) {
      world.clock.advance(86400 / world.clock.timeScale); loaded.clock.advance(86400 / loaded.clock.timeScale);
      stepDemographics(world); stepDemographics(loaded);
    }
    const originalChild = world.persons().find(p => p.birthTick >= started.tick && p.parentIds.includes(mother.id));
    const restoredChild = loaded.persons().find(p => p.birthTick >= started.tick && p.parentIds.includes(mother.id));
    expect(restoredChild).toMatchObject({ id: originalChild?.id, name: originalChild?.name, parentIds: originalChild?.parentIds, householdId: originalChild?.householdId });
    expect(loaded.demographicRng.state()).toBe(world.demographicRng.state());
  });
});
