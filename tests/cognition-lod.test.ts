import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { thinkIntervalFor, setCognitiveLOD, rebalanceCognitiveLOD } from '../src/sim/core/cognition';
import { computeHistoricalSignificance } from '../src/sim/history/significance';

describe('Cognitive Level of Detail (Constitution §21-27, v0.2 Part 8)', () => {
  it('changing fidelity only touches thinkInterval — it can never alter what an entity already knows', () => {
    const tw = createTestWorld(300);
    const p = addPerson(tw, 'Mara', 'baker', v(5, 1, 5));
    p.knowledge['ev:fake'] = { key: 'ev:fake', kind: 'event', claim: { type: 'attack', actor: 'x', target: 'y' }, confidence: 0.8, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    p.memories.push({ id: 'm1', tick: tw.world.now, type: 'attack', summary: 'saw a fight', entities: [], significance: 0.5, valence: -0.5, source: { type: 'witnessed' }, recalled: 0 });
    p.relationships['other'] = { trust: 0.4, affection: 0.1, fear: 0, respect: 0, familiarity: 0.5, grudge: 0, tags: [], lastUpdated: tw.world.now };
    const knowledgeBefore = JSON.stringify(p.knowledge);
    const memoriesBefore = JSON.stringify(p.memories);
    const relationshipsBefore = JSON.stringify(p.relationships);

    setCognitiveLOD(tw.world, p, 'lightweight');
    expect(p.cognitiveLOD).toBe('lightweight');
    expect(p.mind.thinkInterval).toBe(thinkIntervalFor('lightweight'));
    setCognitiveLOD(tw.world, p, 'full');
    expect(p.cognitiveLOD).toBe('full');
    expect(p.mind.thinkInterval).toBe(thinkIntervalFor('full'));

    expect(JSON.stringify(p.knowledge)).toBe(knowledgeBefore);
    expect(JSON.stringify(p.memories)).toBe(memoriesBefore);
    expect(JSON.stringify(p.relationships)).toBe(relationshipsBefore);
  });

  it('emits an observational cognitive_lod_changed event and is a no-op when the level is unchanged', () => {
    const tw = createTestWorld(301);
    const p = addPerson(tw, 'Osric', 'baker', v(5, 1, 5));
    const before = tw.world.events.length;
    setCognitiveLOD(tw.world, p, 'full'); // already full by default — must not emit
    expect(tw.world.events.length).toBe(before);
    setCognitiveLOD(tw.world, p, 'lightweight');
    const ev = tw.world.events[tw.world.events.length - 1];
    expect(ev.type).toBe('cognitive_lod_changed');
    expect(ev.data.from).toBe('full');
    expect(ev.data.to).toBe('lightweight');
  });

  it('rebalances by proximity to the player and by historical significance, never touching the player themselves', () => {
    const tw = createTestWorld(302, 200);
    const player = addPerson(tw, 'Player', 'traveler', v(10, 1, 10), { controlled: true });
    const near = addPerson(tw, 'Near', 'baker', v(15, 1, 10));
    const far = addPerson(tw, 'Far', 'farmer', v(190, 1, 190));
    const significantButFar = addPerson(tw, 'Hero', 'guard', v(190, 1, 10));
    // Give the far "hero" a real, deterministic reason to be historically significant: they
    // actually killed someone (computeHistoricalSignificance is event-log-derived, not asserted).
    const victim = addPerson(tw, 'Victim', 'farmer', v(191, 1, 10));
    tw.world.emit('kill', { actor: significantButFar.id, target: victim.id, significance: 1, summary: 'test kill' });

    const significance = computeHistoricalSignificance(tw.world);
    expect(significance.get(significantButFar.id)).toBeGreaterThan(0.5);

    const playerLODBefore = player.cognitiveLOD;
    const result = rebalanceCognitiveLOD(tw.world, significance, { nearRadius: 40, significanceFloor: 0.5 });
    expect(player.cognitiveLOD).toBe(playerLODBefore); // controlled entities are skipped entirely, left exactly as they were
    expect(near.cognitiveLOD).toBe('full');
    expect(far.cognitiveLOD).toBe('lightweight');
    expect(significantButFar.cognitiveLOD).toBe('full'); // significance overrides distance
    expect(result.fullCount).toBeGreaterThanOrEqual(2);
    expect(result.lightweightCount).toBeGreaterThanOrEqual(1);
  });
});
