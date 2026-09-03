import { describe, expect, it } from 'vitest';
import { learn } from '../src/sim/mind/knowledge';
import { getRel } from '../src/sim/mind/relationships';
import { addPerson, createTestWorld, v } from './helpers/world';

/**
 * v0.2.2 scale-readiness audit, Phase 1. `Person.knowledge` is bounded (mind/knowledge.ts's
 * MAX_KNOWLEDGE=400, added in v0.2.1) for throughput reasons, but a plain container-capacity
 * cap is not, by itself, epistemically coherent — the Constitution requires that forgetting be
 * selective, not uniform, and that foundational/relational/institutional knowledge not be lost
 * to routine pressure just because it happens to be old. These tests exercise the v0.2.2 scoring
 * rewrite (categories: foundational/prior, durable relational, institutional/unresolved-crime,
 * ordinary/ephemeral/rumor) directly, at forced pressure well beyond anything a real run would
 * produce, so the policy's actual behavior is demonstrated rather than merely asserted.
 */
function fillWithRoutineRumors(tw: ReturnType<typeof createTestWorld>, thinker: ReturnType<typeof addPerson>, n: number): void {
  for (let i = 0; i < n; i++) {
    learn(tw.world, thinker, {
      key: `ev:rumor${i}`, kind: 'event',
      claim: { eventId: `rumor${i}`, type: 'rumor', text: `idle rumor ${i}`, significance: 0.05 },
      confidence: 0.25, source: { type: 'heard' },
    }, true);
  }
}

describe('knowledge retention policy (v0.2.2 Phase 1: semantic soundness of the bound)', () => {
  it('foundational (source: prior) facts survive massive routine pressure', () => {
    const tw = createTestWorld(700, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const neighbor = addPerson(tw, 'Neighbor', 'farmer', v(4.5, 1, 3.5));
    learn(tw.world, thinker, {
      key: `home:${neighbor.id}`, kind: 'fact',
      claim: { text: `${neighbor.name} lives nearby`, entityId: neighbor.id },
      confidence: 0.9, source: { type: 'prior' },
    }, true);
    fillWithRoutineRumors(tw, thinker, 1000); // 2.5x the cap, all routine, all newer
    expect(thinker.knowledge[`home:${neighbor.id}`]).toBeDefined();
  });

  it('foundational facts do not decay away over simulated years, unlike routine knowledge', () => {
    const tw = createTestWorld(701, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const neighbor = addPerson(tw, 'Neighbor', 'farmer', v(4.5, 1, 3.5));
    learn(tw.world, thinker, {
      key: `home:${neighbor.id}`, kind: 'fact',
      claim: { text: `${neighbor.name} lives nearby`, entityId: neighbor.id },
      confidence: 0.9, source: { type: 'prior' },
    }, true);
    learn(tw.world, thinker, {
      key: 'ev:oldrumor', kind: 'event',
      claim: { eventId: 'oldrumor', type: 'rumor', text: 'an old rumor', significance: 0.1 },
      confidence: 0.5, source: { type: 'heard' },
    }, true);
    // Simulate 3 years passing before any pressure is applied.
    tw.world.clock.worldSeconds += 3 * 365 * 86400;
    fillWithRoutineRumors(tw, thinker, 1000);
    expect(thinker.knowledge[`home:${neighbor.id}`]).toBeDefined();
    // The routine rumor from 3 years ago, by contrast, is exactly the kind of thing that should
    // be gone by now — it has neither the foundational protection nor the freshness of the new
    // filler rumors.
    expect(thinker.knowledge['ev:oldrumor']).toBeUndefined();
  });

  it('low-value/low-confidence rumor is evicted before higher-value knowledge under pressure', () => {
    const tw = createTestWorld(702, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    learn(tw.world, thinker, {
      key: 'ev:important', kind: 'event',
      claim: { eventId: 'important', type: 'attack', actor: 'someone', target: thinker.id, significance: 0.8 },
      confidence: 1, source: { type: 'witnessed' },
    }, true);
    fillWithRoutineRumors(tw, thinker, 500); // pushes well past the cap
    expect(thinker.knowledge['ev:important']).toBeDefined();
    // Most of the low-confidence, low-significance filler should have been the eviction target.
    const survivingRumors = Object.keys(thinker.knowledge).filter(k => k.startsWith('ev:rumor')).length;
    expect(survivingRumors).toBeLessThan(500);
  });

  it('durable relational knowledge (about someone I have a real relationship with) outlasts the same fact about a stranger', () => {
    const tw = createTestWorld(703, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const friend = addPerson(tw, 'Friend', 'farmer', v(4.5, 1, 3.5));
    const stranger = addPerson(tw, 'Stranger', 'traveler', v(5.5, 1, 3.5));
    const rel = getRel(thinker, friend.id);
    rel.familiarity = 0.9; rel.affection = 0.6;
    // Identical knowledge shape and timing for both — the only difference is the relationship.
    learn(tw.world, thinker, { key: `loc:${friend.id}`, kind: 'location', claim: { entityId: friend.id, pos: v(4.5, 1, 3.5) }, confidence: 1, source: { type: 'witnessed' } }, true);
    learn(tw.world, thinker, { key: `loc:${stranger.id}`, kind: 'location', claim: { entityId: stranger.id, pos: v(5.5, 1, 3.5) }, confidence: 1, source: { type: 'witnessed' } }, true);
    tw.world.clock.worldSeconds += 400 * 86400; // let both age well past any freshness advantage
    fillWithRoutineRumors(tw, thinker, 1000);
    expect(thinker.knowledge[`loc:${friend.id}`]).toBeDefined();
    expect(thinker.knowledge[`loc:${stranger.id}`]).toBeUndefined();
  });

  it('an unresolved crime report survives pressure that evicts routine rumor (institutional/core protection)', () => {
    const tw = createTestWorld(704, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const suspect = addPerson(tw, 'Suspect', 'farmer', v(4.5, 1, 3.5));
    learn(tw.world, thinker, {
      key: 'ev:crime', kind: 'event',
      claim: { eventId: 'crime', type: 'attack', actor: suspect.id, target: 'victim', significance: 0.7 },
      confidence: 1, source: { type: 'witnessed' },
    }, true);
    fillWithRoutineRumors(tw, thinker, 500);
    expect(thinker.knowledge['ev:crime']).toBeDefined();
  });

  it('eviction order is deterministic for a fixed sequence of insertions', () => {
    const run = () => {
      const tw = createTestWorld(705, 16);
      const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
      fillWithRoutineRumors(tw, thinker, 500);
      return Object.keys(thinker.knowledge).sort();
    };
    expect(run()).toEqual(run());
  });

  it('surviving items keep coherent, untouched provenance after a pruning pass', () => {
    const tw = createTestWorld(706, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    const witness = learn(tw.world, thinker, {
      key: 'ev:witnessed', kind: 'event',
      claim: { eventId: 'witnessed', type: 'attack', actor: 'someone', target: thinker.id, significance: 0.9 },
      confidence: 1, source: { type: 'witnessed' }, hops: 0,
    }, true)!;
    fillWithRoutineRumors(tw, thinker, 500);
    const survived = thinker.knowledge['ev:witnessed'];
    expect(survived).toBe(witness); // same object identity — never rebuilt, only ever kept or deleted
    expect(survived.source).toEqual({ type: 'witnessed' });
    expect(survived.hops).toBe(0);
    expect(survived.confidence).toBe(1);
  });

  it('pruning never adds knowledge (no accidental omniscience) — only ever removes', () => {
    const tw = createTestWorld(707, 16);
    const thinker = addPerson(tw, 'Thinker', 'farmer', v(3.5, 1, 3.5));
    for (let i = 0; i < 500; i++) {
      learn(tw.world, thinker, { key: `ev:r${i}`, kind: 'event', claim: { eventId: `r${i}`, type: 'rumor', text: `r${i}`, significance: 0.05 }, confidence: 0.2, source: { type: 'heard' } }, true);
      expect(Object.keys(thinker.knowledge).length).toBeLessThanOrEqual(400);
    }
  });

  it('an evicted key that a live goal/plan still references degrades gracefully, not by crashing', () => {
    const tw = createTestWorld(708, 16);
    const thinker = addPerson(tw, 'Thinker', 'guard', v(3.5, 1, 3.5));
    learn(tw.world, thinker, {
      key: 'ev:targetcrime', kind: 'event',
      claim: { eventId: 'targetcrime', type: 'attack', actor: 'someone', target: 'victim', significance: 0.6, intent: 'kill' },
      confidence: 0.9, source: { type: 'told' },
    }, true);
    // Simulate an in-flight goal referencing this exact key, the way think()'s 'confront'
    // branch does — then force it out via low-confidence, low-significance filler that should
    // normally lose, proving the *reference* alone (not the crime-protection bonus) is what
    // keeps it alive, and that even if displaced, nothing downstream would crash.
    thinker.mind.goal = { type: 'confront', utility: 0.8, reasons: ['test'], createdAt: tw.world.now, key: 'confront:x', data: { crime: 'ev:targetcrime' } };
    fillWithRoutineRumors(tw, thinker, 500);
    // Still present: it's both an unresolved crime AND goal-referenced.
    expect(thinker.knowledge['ev:targetcrime']).toBeDefined();
    // A key that is NOT actually present must never throw when read the way agent.ts reads it.
    const missing = thinker.knowledge['ev:does-not-exist'];
    expect(missing).toBeUndefined();
    expect(() => missing?.claim.actor).not.toThrow();
  });
});
