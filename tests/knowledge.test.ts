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
});
