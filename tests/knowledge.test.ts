import { describe, expect, it } from 'vitest';
import { learn } from '../src/sim/mind/knowledge';
import { addPerson, createTestWorld, v } from './helpers/world';

describe('knowledge upgrades', () => {
  it('refines an uncertain claim with better evidence without allowing regression', () => {
    const tw = createTestWorld(51, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const actor = addPerson(tw, 'Known Actor', 'farmer', v(4.5, 1, 3.5));
    const first = learn(tw.world, thinker, {
      key: 'ev:test', kind: 'event', claim: { eventId: 'test', type: 'attack', actorUnknown: true, target: 'target', significance: 0.7 },
      confidence: 0.45, source: { type: 'told', from: 'rumor-source', viaEvent: 'telling-1' }, hops: 2,
    }, true)!;
    first.sharedWith.push('someone');

    const upgraded = learn(tw.world, thinker, {
      key: 'ev:test', kind: 'event', claim: { eventId: 'test', type: 'attack', actor: actor.id, target: 'target', significance: 0.7 },
      confidence: 1, source: { type: 'witnessed', viaEvent: 'perception-2' }, hops: 0,
    }, true);

    expect(upgraded).toBe(first);
    expect(first.claim.actor).toBe(actor.id);
    expect(first.claim.actorUnknown).not.toBe(true);
    expect(first.confidence).toBe(1);
    expect(first.hops).toBe(0);
    expect(first.source).toEqual({ type: 'witnessed', viaEvent: 'perception-2' });
    expect(first.sharedWith).toEqual([]);

    learn(tw.world, thinker, {
      key: 'ev:test', kind: 'event', claim: { eventId: 'test', type: 'attack', actorUnknown: true, target: 'target' },
      confidence: 0.2, source: { type: 'told', from: 'bad-source' }, hops: 4,
    }, true);
    expect(first.claim.actor).toBe(actor.id);
    expect(first.claim.actorUnknown).not.toBe(true);
    expect(first.confidence).toBe(1);
    expect(first.hops).toBe(0);
    expect(first.source.type).toBe('witnessed');
  });

  it('corrects a false actor belief when first-hand evidence arrives and permits re-sharing', () => {
    const tw = createTestWorld(52, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const wrong = addPerson(tw, 'Wrong Suspect', 'farmer', v(4.5, 1, 3.5));
    const actual = addPerson(tw, 'Actual Actor', 'farmer', v(5.5, 1, 3.5));
    const belief = learn(tw.world, thinker, { key: 'ev:false', kind: 'event', claim: { eventId: 'false', type: 'theft', actor: wrong.id }, confidence: 0.55, source: { type: 'told', from: 'source' }, hops: 2 }, true)!;
    belief.sharedWith.push('friend');

    learn(tw.world, thinker, { key: 'ev:false', kind: 'event', claim: { eventId: 'false', type: 'theft', actor: actual.id }, confidence: 1, source: { type: 'witnessed', viaEvent: 'seen' }, hops: 0 }, true);

    expect(belief.claim.actor).toBe(actual.id);
    expect(belief.source).toEqual({ type: 'witnessed', viaEvent: 'seen' });
    expect(belief.hops).toBe(0);
    expect(belief.sharedWith).toEqual([]);
  });

  it('does not bound knowledge for any realistic short-run size (the cap is generous)', () => {
    // Guards against the fix below becoming an accidental behavior change for ordinary,
    // well-under-the-cap runs — every existing test in this suite must keep working unchanged.
    const tw = createTestWorld(53, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    for (let i = 0; i < 100; i++) {
      learn(tw.world, thinker, { key: `ev:e${i}`, kind: 'event', claim: { eventId: `e${i}`, type: 'rumor', text: `rumor ${i}` }, confidence: 0.5, source: { type: 'heard' } }, true);
    }
    expect(Object.keys(thinker.knowledge).length).toBe(100);
  });

  it('bounds a mind\'s knowledge map once it grows past a generous cap (v0.2.1 Priority 9)', () => {
    // Regression: `Person.knowledge` had no bound at all, unlike `Person.memories`
    // (MAX_MEMORIES=60 in mind/memory.ts). Several hot-path scans read a mind's entire
    // knowledge map every think() tick, so unbounded growth over a long run made those scans —
    // and the run itself — progressively and eventually superlinearly slower. Measured directly
    // on a 30-day headless benchmark (seed 918271): marginal per-day wall-clock cost climbed
    // from ~51s to ~280s across the run before it was stopped as impractically slow. See the
    // MAX_KNOWLEDGE comment in mind/knowledge.ts.
    const tw = createTestWorld(54, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    for (let i = 0; i < 500; i++) {
      learn(tw.world, thinker, { key: `ev:e${i}`, kind: 'event', claim: { eventId: `e${i}`, type: 'rumor', text: `rumor ${i}`, significance: 0.1 }, confidence: 0.3, source: { type: 'heard' } }, true);
    }
    const count = Object.keys(thinker.knowledge).length;
    expect(count).toBeLessThan(500);
    expect(count).toBeGreaterThan(0);
  });

  it('protects an unresolved crime report from eviction ahead of routine/low-value knowledge', () => {
    const tw = createTestWorld(55, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const suspect = addPerson(tw, 'Suspect', 'farmer', v(4.5, 1, 3.5));
    // One important, unresolved, first-hand crime witness...
    learn(tw.world, thinker, {
      key: 'ev:crime', kind: 'event', claim: { eventId: 'crime', type: 'attack', actor: suspect.id, target: 'victim', significance: 0.7 },
      confidence: 1, source: { type: 'witnessed' },
    }, true);
    // ...followed by enough low-value rumors to force eviction well past the cap.
    for (let i = 0; i < 500; i++) {
      learn(tw.world, thinker, { key: `ev:rumor${i}`, kind: 'event', claim: { eventId: `rumor${i}`, type: 'rumor', text: `idle rumor ${i}`, significance: 0.05 }, confidence: 0.2, source: { type: 'heard' } }, true);
    }
    expect(thinker.knowledge['ev:crime']).toBeDefined();
    expect(Object.keys(thinker.knowledge).length).toBeLessThan(501);
  });
});
