import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v, wall } from './helpers/world';
import { learn, eventClaim, MAX_KNOWLEDGE, PRUNE_MARGIN } from '../src/sim/mind/knowledge';
import { introduce, interpretSocial, knownName } from '../src/sim/mind/people';
import { appearanceSignature, readRecognition, recognizeEncounter, visibleCues } from '../src/sim/mind/encounter';
import { shareIdentityObservation } from '../src/sim/mind/encounter';
import { socialEvidence, socialChoice } from '../src/sim/mind/socialEvidence';
import { GameSim } from '../src/sim/runtime/gameSim';
import { knowledgeView } from '../src/sim/runtime/knowledgeView';
import { inspectAgency } from '../src/sim/runtime/agencyInspection';
import { serialize, deserialize } from '../src/sim/persist/save';
import { selectTopic } from '../src/sim/mind/conversation';
import { makeBody, makeItem } from '../src/sim/world/factory';
import { setExternalControl } from '../src/sim/runtime/controllers';

function scene() {
  const tw = createTestWorld(9921, 28); tw.world.clock.timeScale = 1;
  const a = addPerson(tw, 'Resident A', 'villager', v(10, 1, 10), { controlled: true });
  const b = addPerson(tw, 'Resident B', 'villager', v(11, 1, 10), { controlled: true });
  const c = addPerson(tw, 'Stranger', 'traveler', v(10, 1, 11), { controlled: true });
  return { ...tw, a, b, c };
}
function observe(tw: ReturnType<typeof scene>) {
  const event = tw.world.emit('attack', { actor: tw.c.id, target: tw.b.id, significance: 0.8, pos: v(10, 1, 10), visibility: 10, loudness: 0 });
  step(tw, 0.3); return event;
}

describe('autonomous social frontier invariants', () => {
  it('does not turn receiving property while asleep into eyewitness knowledge of the giver', () => {
    for (const asleep of [true, false]) {
      const tw = scene();
      tw.world.primaryBody(tw.a.id)!.pose = asleep ? 'sleep' : 'stand';
      const item = makeItem(tw.world, 'bread', 'gift', { owner: tw.b.id, holder: tw.b.id, value: 20 });
      const event = tw.sim.giveItem(tw.b, tw.a, item);
      step(tw, 0.3);
      expect(item.ownerId).toBe(tw.a.id);
      const knowledge = tw.a.knowledge[`ev:${event.id}`];
      expect(knowledge.source.type).toBe(asleep ? 'heard' : 'witnessed');
      expect(knowledge.claim.actor).toBe(asleep ? undefined : tw.b.id);
      expect(tw.a.mind.obligations?.some(o => o.kind === 'was_given' && o.towardId === tw.b.id) ?? false).toBe(!asleep);
    }
  });
  it('retains the evidence supporting a bounded obligation under episodic pressure', () => {
    const tw = scene(), key = 'ev:gift-evidence';
    learn(tw.world, tw.a, { key, kind: 'event', claim: { eventId: 'gift-evidence', type: 'gift', actor: tw.b.id, target: tw.a.id }, confidence: 1, source: { type: 'witnessed' } }, true);
    tw.a.mind.obligations = [{ id: 'test-obligation', kind: 'was_given', towardId: tw.b.id, causeEventId: 'gift-evidence', basisKey: key, magnitude: 0.5, createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'live', reasons: ['a valuable gift'] }];
    for (let i = 0; i < 600; i++) learn(tw.world, tw.a, { key: `episode:${i}`, kind: 'event', claim: { significance: 1 }, confidence: 1, source: { type: 'witnessed' } }, true);
    expect(tw.a.knowledge[key].source.type).toBe('witnessed');
    expect(Object.keys(tw.a.knowledge).length).toBeLessThanOrEqual(MAX_KNOWLEDGE + PRUNE_MARGIN);
    tw.a.mind.obligations = [];
    for (let i = 600; i < 1200; i++) learn(tw.world, tw.a, { key: `episode:${i}`, kind: 'event', claim: { significance: 1 }, confidence: 1, source: { type: 'witnessed' } }, true);
    expect(tw.a.knowledge[key]).toBeUndefined();
  });
  it('receives eyewitness evidence, propagates hearsay with its actual chain and preserves event time', () => {
    const tw = scene(); tw.world.primaryBody(tw.b.id)!.pos = v(26, 1, 26);
    const event = observe(tw), key = `ev:${event.id}`, witnessed = tw.a.knowledge[key];
    expect(witnessed.source.type).toBe('witnessed'); expect(tw.b.knowledge[key]).toBeUndefined();
    tw.world.primaryBody(tw.b.id)!.pos = v(11, 1, 10);
    const rng = tw.world.rng.state();
    tw.sim.tell(tw.a, tw.b, witnessed);
    const hearsay = tw.b.knowledge[key];
    expect(hearsay.source).toMatchObject({ type: 'told', from: tw.a.id });
    expect(hearsay.hops).toBe(1); expect(hearsay.confidence).toBeLessThan(witnessed.confidence);
    expect(hearsay.claim.tick).toBe(event.tick);
    expect(tw.world.event(hearsay.source.viaEvent!)!.causes).toContain(witnessed.source.viaEvent);
    expect(tw.world.rng.state()).toBe(rng);
    expect(tw.b.relationships[tw.c.id].fear).toBeGreaterThan(0); // human minds receive consequences too
  });

  it('refuses remote, unconscious, wall-blocked and fabricated communication', () => {
    const tw = scene(), e = observe(tw), k = tw.a.knowledge[`ev:${e.id}`];
    delete tw.b.knowledge[k.key];
    tw.world.primaryBody(tw.b.id)!.pose = 'sleep'; tw.sim.tell(tw.a, tw.b, k); expect(tw.b.knowledge[k.key]).toBeUndefined();
    tw.world.primaryBody(tw.b.id)!.pose = 'stand'; tw.world.primaryBody(tw.b.id)!.pos = v(20, 1, 10);
    tw.sim.tell(tw.a, tw.b, k); expect(tw.b.knowledge[k.key]).toBeUndefined();
    tw.world.primaryBody(tw.b.id)!.pos = v(12, 1, 10); wall(tw, 11, 7, 13);
    tw.sim.tell(tw.a, tw.b, k); expect(tw.b.knowledge[k.key]).toBeUndefined();
    tw.world.primaryBody(tw.b.id)!.pos = v(10, 1, 9);
    tw.sim.tell(tw.a, tw.b, { ...k, claim: { type: 'kill' } }); expect(tw.b.knowledge[k.key]).toBeUndefined();
  });

  it('changes an ordinary selected goal using fallible beliefs without changing canonical truth', () => {
    const tw = scene();
    tw.a.traits.courage = 0; tw.a.needs.social = 0; tw.a.schedule = []; tw.a.mind.thinkInterval = 0.25;
    step(tw, 0.3);
    // Synthetic uncertain testimony is explicitly a belief fixture, not a canonical attack.
    const testimony = tw.world.emit('told', { actor: tw.b.id, target: tw.a.id });
    const k = learn(tw.world, tw.a, { key: 'uncertain-report', kind: 'event', claim: { type: 'attack', actor: tw.c.id, tick: tw.world.now },
      confidence: 0.6, source: { type: 'told', from: tw.b.id, viaEvent: testimony.id }, hops: 1 }, true)!;
    interpretSocial(tw.world, tw.a, k);
    setExternalControl(tw.a, false); step(tw, 0.3);
    expect(tw.a.mind.goal?.type).toBe('flee');
    expect(tw.a.mind.goal?.data?.beliefInputs).toContain(`social:${tw.c.id}:intent:attacking`);
    expect(tw.world.events.some(e => e.type === 'attack')).toBe(false);
    expect(socialEvidence(tw.a, tw.c.id, tw.world.now).caution).toBeGreaterThan(0);
  });

  it('does not read the recipient knowledge when choosing gossip', () => {
    const tw = scene(), e = observe(tw);
    Object.defineProperty(tw.b, 'knowledge', { get: () => { throw Error('private mind read'); } });
    expect(() => selectTopic(tw.world, tw.a, tw.b)).not.toThrow();
    expect(tw.a.knowledge[`ev:${e.id}`]).toBeDefined();
  });

  it('supports multiple human controls, retained encounter memory, false identity and detached projections', () => {
    const tw = scene(), game = new GameSim(tw.sim); game.attach('one', tw.a.id); game.attach('two', tw.c.id);
    step(tw, 0.3); expect(knownName(tw.a, tw.c.id)).toBe('an unfamiliar person');
    expect(introduce(tw.world, tw.c, tw.a, 'A claimed name')).toBe(true);
    step(tw, 0.3);
    const body = tw.world.primaryBody(tw.c.id)!;
    expect(readRecognition(tw.a, tw.c.id, body.id, appearanceSignature(visibleCues(tw.world, body)))).toBe('identified');
    const report = inspectAgency(tw.world, tw.a.id, tw.c.id)!;
    report.truth.skills.crafting = 1; report.memories[0].summary = 'forged';
    const view = game.perceive('one')!; view.people.find(p => p.entityId === tw.c.id)!.appearance.shirt = 0;
    expect(tw.a.skills.crafting).not.toBe(1); expect(tw.a.memories[0].summary).not.toBe('forged');
    expect(tw.c.appearance.shirt).not.toBe(0); expect(tw.c.name).toBe('Stranger');
    const restored = deserialize(serialize(tw.world))!.world;
    expect(restored.person(tw.a.id)!.memories).toEqual(tw.a.memories);
    expect(restored.person(tw.a.id)!.knowledge).toEqual(tw.a.knowledge);
  });

  it('observes from a second awake body and does not identify a changed face by canonical id', () => {
    const tw = scene(); tw.world.primaryBody(tw.a.id)!.pose = 'sleep';
    tw.a.bodies.push(makeBody(tw.world, tw.a.id, v(10, 1, 10)).id);
    step(tw, 0.3); expect(tw.a.memories.some(m => m.type === 'encounter')).toBe(true);
    introduce(tw.world, tw.c, tw.a); const b = tw.world.primaryBody(tw.c.id)!;
    tw.c.appearance.hair = 0xffffff;
    if (tw.c.appearance.description) tw.c.appearance.description.hairColor = 'white';
    expect(readRecognition(tw.a, tw.c.id, b.id, appearanceSignature(visibleCues(tw.world, b)))).toBe('unknown');
    const observation = { subjectId: tw.c.id, bodyId: b.id, observerBodyId: tw.a.bodies[1], how: 'saw' as const };
    recognizeEncounter(tw.world, tw.a, observation);
    tw.world.clock.advance(61);
    recognizeEncounter(tw.world, tw.a, observation);
    const projected = knowledgeView(tw.world, tw.a).people.find(p => p.entityId === tw.c.id)!;
    expect(projected.recognition).toBe('familiar');
    expect(projected.identity).toBeNull(); expect(projected.knownName).toBe(false);
  });

  it('copies identity description evidence through testimony without consulting the named person', () => {
    const tw = scene(); introduce(tw.world, tw.c, tw.a, 'Traveller');
    const identity = tw.a.knowledge[`identity:${tw.c.id}`];
    tw.sim.tell(tw.a, tw.b, identity); shareIdentityObservation(tw.a, tw.b, tw.c.id);
    expect(tw.b.knowledge[identity.key].claim.identity.signatures).toEqual(identity.claim.identity.signatures);
    expect(tw.b.knowledge[identity.key].hops).toBe(1);
    expect(tw.c.name).toBe('Stranger');
  });

  it('keys speech variation without advancing unrelated RNG', () => {
    const tw = scene(), state = [tw.world.rng.state(), tw.world.weatherRng.state(), tw.world.demographicRng.state()];
    expect(socialChoice(tw.world, tw.a, 'test', 10)).toBe(socialChoice(tw.world, tw.a, 'test', 10));
    expect([tw.world.rng.state(), tw.world.weatherRng.state(), tw.world.demographicRng.state()]).toEqual(state);
  });
});
