import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { realizeClaim } from '../src/sim/mind/realize';
import { learn } from '../src/sim/mind/knowledge';
import { adjustRel } from '../src/sim/mind/relationships';
import type { KnowledgeItem } from '../src/sim/core/types';

/**
 * "The Legible World" (v0.8) §A: NPC dialogue must be grounded — the natural-language
 * REALIZATION layer (`mind/realize.ts`) may paraphrase and vary phrasing, but it may never
 * invent a canonical fact (a person, a place, an event) that isn't already present in the
 * `KnowledgeItem` it was given. These tests assert that structurally, not by eyeballing example
 * sentences.
 */
describe('dialogue grounding (v0.8 §A — realization may paraphrase, never fabricate)', () => {
  function witnessedAttack(seed: number) {
    const tw = createTestWorld(seed, 16);
    const speaker = addPerson(tw, 'Speaker', 'guard', v(3.5, 1, 3.5));
    const actor = addPerson(tw, 'Vex', 'vagrant', v(4.5, 1, 3.5));
    const victim = addPerson(tw, 'Bramble', 'baker', v(5.5, 1, 3.5));
    const k: KnowledgeItem = {
      key: 'ev:e1', kind: 'event',
      claim: { eventId: 'e1', type: 'attack', actor: actor.id, target: victim.id, significance: 0.8, tick: tw.world.now },
      confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    };
    learn(tw.world, speaker, k, true);
    return { tw, speaker, actor, victim, k };
  }

  it('never names an actor the speaker does not actually know (actorUnknown stays "someone")', () => {
    const { tw, speaker, victim } = witnessedAttack(201);
    const realActor = addPerson(tw, 'HiddenCulprit', 'bandit', v(6.5, 1, 3.5));
    const k: KnowledgeItem = {
      key: 'ev:e2', kind: 'event',
      claim: { eventId: 'e2', type: 'attack', actor: realActor.id, actorUnknown: true, target: victim.id, significance: 0.8, tick: tw.world.now },
      confidence: 0.7, learnedAt: tw.world.now, source: { type: 'heard' }, hops: 1, sharedWith: [],
    };
    const text = realizeClaim(tw.world, speaker, k);
    expect(text).not.toContain('HiddenCulprit');
    expect(text.toLowerCase()).toContain('someone');
  });

  it('only names entities that actually appear in the claim/source — no fabricated third parties', () => {
    const { tw, speaker, actor, victim, k } = witnessedAttack(202);
    const text = realizeClaim(tw.world, speaker, k);
    // Every OTHER named person in this tiny world must not appear in the realized text.
    for (const p of tw.world.persons()) {
      if (p.id === actor.id || p.id === victim.id || p.id === speaker.id) continue;
      expect(text).not.toContain(p.name);
    }
    expect(text).toContain(actor.name);
    expect(text).toContain(victim.name);
  });

  it('attribution never claims a different provenance than the real Source', () => {
    const { tw, speaker, k } = witnessedAttack(203);
    const text = realizeClaim(tw.world, speaker, k);
    // k.source.type is 'witnessed' — the realized text must say so in some form, never "told me"
    // (which would misattribute hearsay the speaker does not have).
    expect(text).toMatch(/saw it myself|watched it happen|was there/);
    expect(text).not.toMatch(/told me/);
  });

  it('a "told" source is attributed to the actual informant named in k.source.from, not a substitute', () => {
    const tw2 = createTestWorld(204, 16);
    const speaker = addPerson(tw2, 'Speaker', 'guard', v(3.5, 1, 3.5));
    const informant = addPerson(tw2, 'Elder Godwin', 'elder', v(4.5, 1, 3.5));
    const actor = addPerson(tw2, 'Vex', 'vagrant', v(5.5, 1, 3.5));
    const victim = addPerson(tw2, 'Bramble', 'baker', v(6.5, 1, 3.5));
    const k: KnowledgeItem = {
      key: 'ev:e3', kind: 'event',
      claim: { eventId: 'e3', type: 'attack', actor: actor.id, target: victim.id, significance: 0.8, tick: tw2.world.now },
      confidence: 0.9, learnedAt: tw2.world.now, source: { type: 'told', from: informant.id }, hops: 1, sharedWith: [],
    };
    const text = realizeClaim(tw2.world, speaker, k);
    expect(text).toContain(informant.name);
  });

  it('a confidence hedge appears only when confidence is genuinely low, never invented or hidden', () => {
    const { tw, speaker, actor, victim } = witnessedAttack(205);
    const confident: KnowledgeItem = { key: 'ev:conf', kind: 'event', claim: { eventId: 'e', type: 'attack', actor: actor.id, target: victim.id, tick: tw.world.now }, confidence: 0.95, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    const doubtful: KnowledgeItem = { key: 'ev:doubt', kind: 'event', claim: { eventId: 'e', type: 'attack', actor: actor.id, target: victim.id, tick: tw.world.now }, confidence: 0.3, learnedAt: tw.world.now, source: { type: 'heard' }, hops: 2, sharedWith: [] };
    expect(realizeClaim(tw.world, speaker, confident)).not.toMatch(/half believe|wouldn't swear|even true/);
    expect(realizeClaim(tw.world, speaker, doubtful)).toMatch(/half believe|wouldn't swear|even true/);
  });

  it('relational colour commentary only appears when the speaker has a REAL relationship with the actor', () => {
    const { tw, speaker, actor, victim, k } = witnessedAttack(206);
    const noRelText = realizeClaim(tw.world, speaker, k);
    // no relationship established yet — no "watch yourself" style prefix
    expect(noRelText).not.toMatch(/stay clear of|watch yourself around|trouble, if you ask me/);
    adjustRel(tw.world, speaker, actor.id, { fear: 0.6, familiarity: 0.3 }, 'test', undefined, true);
    const withFearText = realizeClaim(tw.world, speaker, k);
    expect(withFearText).toMatch(new RegExp(actor.name));
    expect(withFearText).toMatch(/stay clear of|watch yourself around|trouble, if you ask me/);
    void victim;
  });

  it('is deterministic — the same speaker and claim always realize to the exact same text', () => {
    const { tw, speaker, k } = witnessedAttack(207);
    const a = realizeClaim(tw.world, speaker, k);
    const b = realizeClaim(tw.world, speaker, k);
    expect(a).toBe(b);
  });

  it('never asserts village-wide awareness ("everyone is talking about it" etc.) from significance/recency alone (v0.8 §1C)', () => {
    const tw = createTestWorld(209, 16);
    const speaker = addPerson(tw, 'Speaker', 'guard', v(3.5, 1, 3.5));
    const actor = addPerson(tw, 'Vex', 'vagrant', v(4.5, 1, 3.5));
    const victim = addPerson(tw, 'Bramble', 'baker', v(5.5, 1, 3.5));
    // High significance + very recent — under the old (removed) heuristic this alone used to
    // trigger a fabricated "everyone's talking about it" style clause with no actual evidence
    // that anyone besides the speaker knows.
    const k: KnowledgeItem = {
      key: 'ev:e9', kind: 'event',
      claim: { eventId: 'e9', type: 'attack', actor: actor.id, target: victim.id, significance: 1, tick: tw.world.now },
      confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    };
    const text = realizeClaim(tw.world, speaker, k);
    expect(text).not.toMatch(/everyone|half the village|all anyone|anyone's spoken|still talking about it|village has an opinion/i);
  });

  it('an arrest_attempt claim never invents an unwitnessed physical detail like "badge out" (v0.8 §1C)', () => {
    const tw = createTestWorld(210, 16);
    const speaker = addPerson(tw, 'Speaker', 'guard', v(3.5, 1, 3.5));
    const guard = addPerson(tw, 'Rowan', 'guard', v(4.5, 1, 3.5));
    const suspect = addPerson(tw, 'Vex', 'vagrant', v(5.5, 1, 3.5));
    for (let i = 0; i < 8; i++) {
      const k: KnowledgeItem = {
        key: `ev:arrest${i}`, kind: 'event',
        claim: { eventId: `arrest${i}`, type: 'arrest_attempt', actor: guard.id, target: suspect.id, tick: tw.world.now },
        confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
      };
      const text = realizeClaim(tw.world, speaker, k);
      expect(text).not.toMatch(/badge out/i);
    }
  });

  it('produces varied phrasing across different NPCs/claims rather than one fixed template (natural synthesis, not an event-log dump)', () => {
    const { tw } = witnessedAttack(208);
    const actor = addPerson(tw, 'Skarn', 'bandit', v(7.5, 1, 3.5));
    const victim2 = addPerson(tw, 'Nell', 'server', v(8.5, 1, 3.5));
    const texts = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const speaker = addPerson(tw, `Witness${i}`, 'farmer', v(3.5 + i, 1, 3.5));
      const k: KnowledgeItem = { key: `ev:v${i}`, kind: 'event', claim: { eventId: `e${i}`, type: 'attack', actor: actor.id, target: victim2.id, tick: tw.world.now }, confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
      texts.add(realizeClaim(tw.world, speaker, k));
    }
    // Not a single fixed template repeated verbatim for every speaker.
    expect(texts.size).toBeGreaterThan(1);
  });
});
