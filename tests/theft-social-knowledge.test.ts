import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, face, step, v, wall } from './helpers/world';
import { learn, MAX_KNOWLEDGE, PRUNE_MARGIN } from '../src/sim/mind/knowledge';
import { selectTopic } from '../src/sim/mind/conversation';
import { diePerson } from '../src/sim/world/demographics';
import { makeItem } from '../src/sim/world/factory';
import { deserialize, serialize } from '../src/sim/persist/save';
import { refreshReport } from '../src/sim/mind/reporting';
import { B } from '../src/sim/physical/blocks';
import type { KnowledgeItem, Person } from '../src/sim/core/types';

/**
 * How a theft enters and moves through the village's minds. The end-to-end theft trace
 * (`social-causality-trace.test.ts`) once passed without any mind holding the theft. Its
 * "knowers" were witnesses of unrelated arrests that shared a participant with the matter. Later
 * it failed with nobody knowing anything, because it staged the theft where nobody could see it,
 * against an owner in custody. These tests pin down the mechanism directly: witness, testimony
 * between bodies that can actually reach each other, survival of hearsay after the witness dies,
 * bounds, persistence and determinism. Nothing here is delivered remotely.
 */

type Scene = ReturnType<typeof createTestWorld> & { witness: Person; owner: Person; thief: Person; listener: Person; third: Person; faraway: Person };

function scene(): Scene {
  const tw = createTestWorld(4417, 32); tw.world.clock.timeScale = 1;
  // Externally controlled: nobody wanders off or gossips on their own, so every transfer below is
  // one the test performed through the canonical `tell` path.
  const witness = addPerson(tw, 'Witness', 'villager', v(10, 1, 10), { controlled: true });
  const owner = addPerson(tw, 'Owner', 'merchant', v(24, 1, 6), { controlled: true });
  const thief = addPerson(tw, 'Thief', 'villager', v(12, 1, 12), { controlled: true });
  const listener = addPerson(tw, 'Listener', 'villager', v(26, 1, 26), { controlled: true });
  const third = addPerson(tw, 'Third', 'villager', v(27, 1, 26), { controlled: true });
  const faraway = addPerson(tw, 'Far Away', 'villager', v(28, 1, 4), { controlled: true });
  return { ...tw, witness, owner, thief, listener, third, faraway };
}

/** A canonical theft through `Simulation.takeItem`, with the witness facing it. */
function stealInView(s: Scene) {
  const ring = makeItem(s.world, 'ring', "Owner's ring", { owner: s.owner.id, pos: v(12, 1, 12) });
  face(s.witness, s, v(12, 1, 12));
  const event = s.sim.takeItem(s.thief, ring, 'theft', s.owner.id);
  step(s, 0.3);
  return { event, key: `ev:${event.id}`, ring };
}

function moveBeside(s: Scene, mover: Person, anchor: Person): void {
  const a = s.world.primaryBody(anchor.id)!.pos;
  s.world.primaryBody(mover.id)!.pos = v(a.x + 1, a.y, a.z);
}

function holders(s: Scene, key: string): string[] {
  return s.world.persons().filter(p => p.alive && !!p.knowledge[key]).map(p => p.name).sort();
}

function snapshot(s: Scene, key: string) {
  return s.world.persons().filter(p => !!p.knowledge[key]).map(p => {
    const k = p.knowledge[key];
    return { who: p.id, alive: p.alive, source: k.source.type, from: k.source.from, hops: k.hops, confidence: k.confidence, actor: k.claim.actor, tick: k.claim.tick };
  });
}

/** Witness → listener → third, with the witness dying in between. Returns the shared key. */
function chain(s: Scene) {
  const { event, key } = stealInView(s);
  moveBeside(s, s.witness, s.listener);
  s.sim.tell(s.witness, s.listener, s.witness.knowledge[key]);
  diePerson(s.world, s.witness, undefined, 'a fever');
  step(s, 1);
  s.sim.tell(s.listener, s.third, s.listener.knowledge[key]);
  return { event, key };
}

describe('theft social knowledge — witness, testimony and survival', () => {
  it('gives a facing bystander eyewitness knowledge of the theft, and nobody out of sight any', () => {
    const s = scene();
    const { event, key } = stealInView(s);
    const k = s.witness.knowledge[key];
    expect(k.source.type).toBe('witnessed');
    expect(k.confidence).toBe(1);
    expect(k.claim.type).toBe('theft');
    expect(k.claim.actor).toBe(s.thief.id);
    expect(k.claim.tick).toBe(event.tick);
    // No global omniscience: the listener, the third party and the absent owner were nowhere near.
    expect(holders(s, key)).toEqual(['Witness']);
  });

  it('keeps an unresolved theft above routine episodes, within the knowledge bound', () => {
    const s = scene();
    const { key } = stealInView(s);
    for (let i = 0; i < 900; i++) {
      learn(s.world, s.witness, { key: `routine:${i}`, kind: 'event', claim: { type: 'wave', significance: 0.6 }, confidence: 1, source: { type: 'witnessed' } }, true);
    }
    expect(s.witness.knowledge[key]?.source.type).toBe('witnessed');
    expect(Object.keys(s.witness.knowledge).length).toBeLessThanOrEqual(MAX_KNOWLEDGE + PRUNE_MARGIN);
  });

  it('offers the theft as a topic to someone who has not been told, and passes it with provenance', () => {
    const s = scene();
    const { event, key } = stealInView(s);
    moveBeside(s, s.witness, s.listener);
    const topic = selectTopic(s.world, s.witness, s.listener);
    expect(topic?.k.key).toBe(key);

    s.sim.tell(s.witness, s.listener, s.witness.knowledge[key]);
    const heard = s.listener.knowledge[key];
    expect(heard.source).toMatchObject({ type: 'told', from: s.witness.id });
    expect(heard.hops).toBe(1);
    expect(heard.confidence).toBeGreaterThan(0.3);
    expect(heard.confidence).toBeLessThan(s.witness.knowledge[key].confidence);
    expect(heard.claim.actor).toBe(s.thief.id);
    expect(heard.claim.tick).toBe(event.tick);
    // The testimony cites the witness's own perception of the theft, so the chain is walkable.
    expect(s.world.event(heard.source.viaEvent!)!.causes).toContain(s.witness.knowledge[key].source.viaEvent);
    // Once told, it is not offered to the same listener again.
    expect(selectTopic(s.world, s.witness, s.listener)?.k.key).not.toBe(key);
  });

  it('refuses testimony across a distance, so news has to be carried by a body', () => {
    const s = scene();
    const { key } = stealInView(s);
    s.sim.tell(s.witness, s.listener, s.witness.knowledge[key]);
    expect(s.listener.knowledge[key]).toBeUndefined();
  });

  it('survives the death of its only witness among the living people who were told', () => {
    const s = scene();
    const { key } = chain(s);
    expect(s.witness.alive).toBe(false);
    expect(holders(s, key)).toEqual(['Listener', 'Third']);
    expect(s.listener.knowledge[key].source).toMatchObject({ type: 'told', from: s.witness.id });
    expect(s.third.knowledge[key].source).toMatchObject({ type: 'told', from: s.listener.id });
    expect(s.third.knowledge[key].hops).toBe(2);
    // Each retelling weakens it; none amplifies it back towards eyewitness certainty.
    expect(s.third.knowledge[key].confidence).toBeLessThan(s.listener.knowledge[key].confidence);
    expect(s.third.knowledge[key].confidence).toBeGreaterThan(0);
    expect(s.faraway.knowledge[key]).toBeUndefined();
    expect(s.owner.knowledge[key]).toBeUndefined();
  });

  it('keeps a false account distinguishable from what canonically happened', () => {
    const s = scene();
    const { event, key } = stealInView(s);
    // A rumour naming the wrong person, arriving second-hand.
    const rumour = learn(s.world, s.faraway, { key, kind: 'event', claim: { ...s.witness.knowledge[key].claim, actor: s.listener.id }, confidence: 0.45, source: { type: 'told', from: s.third.id }, hops: 2 }, true) as KnowledgeItem;
    expect(rumour.claim.actor).toBe(s.listener.id);
    expect(event.actor).toBe(s.thief.id);
    expect(rumour.source.type).toBe('told');
    expect(rumour.confidence).toBeLessThan(s.witness.knowledge[key].confidence);
    // Believing the rumour changes nothing canonical.
    expect(s.world.event(event.id)!.actor).toBe(s.thief.id);
  });

  it('restores exactly who knows what, from whom, after a save and reload', () => {
    const s = scene();
    const { key } = chain(s);
    const restored = deserialize(serialize(s.world))!.world;
    const after = restored.persons().filter(p => !!p.knowledge[key]).map(p => {
      const k = p.knowledge[key];
      return { who: p.id, alive: p.alive, source: k.source.type, from: k.source.from, hops: k.hops, confidence: k.confidence, actor: k.claim.actor, tick: k.claim.tick };
    });
    expect(after).toEqual(snapshot(s, key));
  });

  it('produces the same social state from the same seed', () => {
    const a = scene(), b = scene();
    const ka = chain(a).key, kb = chain(b).key;
    expect(ka).toBe(kb);
    expect(snapshot(a, ka)).toEqual(snapshot(b, kb));
  });

  it('carries speech round a corner post an arm\'s length away, never through a wall', () => {
    const s = scene();
    const { key } = stealInView(s);
    // Two people either side of a building's corner, the straight line between their heads
    // clipping the post by a few centimetres. Measured from the generated village's guardhouse.
    for (let y = 1; y <= 3; y++) s.world.grid.set(20, y, 20, B.Planks);
    s.world.primaryBody(s.witness.id)!.pos = v(20.28, 1, 21.5);
    s.world.primaryBody(s.listener.id)!.pos = v(19.69, 1, 20.33);
    expect(s.sim.tell(s.witness, s.listener, s.witness.knowledge[key])).toBe(true);
    expect(s.listener.knowledge[key].source).toMatchObject({ type: 'told', from: s.witness.id });

    // A wall is not a post. A bend point that lands exactly on its face must not let the voice in.
    s.world.primaryBody(s.witness.id)!.pos = v(10, 1, 10);
    s.world.primaryBody(s.third.id)!.pos = v(12, 1, 10);
    wall(s, 11, 7, 13);
    expect(s.sim.tell(s.witness, s.third, s.witness.knowledge[key])).toBe(false);
    expect(s.third.knowledge[key]).toBeUndefined();
  });

  it('records a report the watch could not hear as a failed attempt, not a delivery', () => {
    for (const blocked of [true, false]) {
      const s = scene();
      const { key } = stealInView(s);
      const guard = addPerson(s, 'Guard', 'guard', v(12, 1, 10), { controlled: true, workId: s.places.guardhouse });
      if (blocked) wall(s, 11, 7, 13);
      refreshReport(s.world, s.witness, s.witness.knowledge[key], [guard]);
      s.witness.mind.plan = [{ type: 'tell', targetEntity: guard.id, data: { key }, status: 'pending' }];
      (s.sim as unknown as { act(p: Person, body: unknown, physDt: number, worldDt: number): void })
        .act(s.witness, s.world.primaryBody(s.witness.id)!, 0.05, 0.05);
      const record = s.witness.mind.reports![key];
      expect(record.status).toBe(blocked ? 'unavailable' : 'delivered');
      expect(!!guard.knowledge[key]).toBe(!blocked);
      expect(s.witness.knowledge[key].sharedWith.includes(guard.id)).toBe(!blocked);
    }
  });

  it('keeps heading to the guard it set out for, rather than switching errands as the watch moves', () => {
    const tw = createTestWorld(4418, 40); tw.world.clock.timeScale = 1;
    const witness = addPerson(tw, 'Witness', 'farmer', v(20, 1, 20));
    const thief = addPerson(tw, 'Thief', 'vagrant', v(21, 1, 21), { controlled: true });
    const first = addPerson(tw, 'First Guard', 'guard', v(30, 1, 20), { controlled: true, workId: tw.places.guardhouse });
    const second = addPerson(tw, 'Second Guard', 'guard', v(10, 1, 20), { controlled: true, workId: tw.places.guardhouse });
    const ev = tw.world.emit('theft', { actor: thief.id, target: witness.id, pos: v(21, 1, 21), significance: 0.6, summary: 'Thief stole from Witness' });
    const key = `ev:${ev.id}`;
    learn(tw.world, witness, { key, kind: 'event', claim: { type: 'theft', actor: thief.id, target: witness.id, eventId: ev.id, significance: 0.6, tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } }, true);
    for (const guard of [first, second]) learn(tw.world, witness, { key: `loc:${guard.id}`, kind: 'location', claim: { entityId: guard.id, pos: { ...tw.world.primaryBody(guard.id)!.pos } }, confidence: 1, source: { type: 'witnessed' } }, true);
    step(tw, 0.5);
    const goal = witness.mind.goal;
    expect(goal?.type).toBe('report');
    const chosen = goal!.targetEntity!;
    // The other guard is now believed to be the nearer one. The witness does not turn round.
    const other = chosen === first.id ? second : first;
    witness.knowledge[`loc:${other.id}`].claim.pos = v(20, 1, 21);
    step(tw, 1);
    expect(witness.mind.goal?.type).toBe('report');
    expect(witness.mind.goal?.targetEntity).toBe(chosen);
    expect(witness.mind.reports![key]).toMatchObject({ status: 'seeking', attempts: 0 });
  });

  it('tells the same guard about a second crime instead of repeating the first', () => {
    const tw = createTestWorld(4419, 40); tw.world.clock.timeScale = 1;
    const witness = addPerson(tw, 'Witness', 'farmer', v(20, 1, 20));
    const thief = addPerson(tw, 'Thief', 'vagrant', v(30, 1, 30), { controlled: true });
    const guard = addPerson(tw, 'Guard', 'guard', v(22, 1, 20), { controlled: true, workId: tw.places.guardhouse });
    learn(tw.world, witness, { key: `loc:${guard.id}`, kind: 'location', claim: { entityId: guard.id, pos: { ...tw.world.primaryBody(guard.id)!.pos } }, confidence: 1, source: { type: 'witnessed' } }, true);
    const keys = ['first', 'second'].map(name => {
      const ev = tw.world.emit('theft', { actor: thief.id, target: witness.id, pos: v(30, 1, 30), significance: 0.6, summary: `the ${name} theft` });
      learn(tw.world, witness, { key: `ev:${ev.id}`, kind: 'event', claim: { type: 'theft', actor: thief.id, target: witness.id, eventId: ev.id, significance: 0.6, tick: tw.world.now }, confidence: 1, source: { type: 'witnessed' } }, true);
      return `ev:${ev.id}`;
    });
    const told: string[] = [];
    tw.world.onEvent(e => { if (e.type === 'told' && e.actor === witness.id && e.target === guard.id) told.push(e.data.key); });
    step(tw, 60);
    for (const key of keys) expect(guard.knowledge[key]?.source).toMatchObject({ type: 'told', from: witness.id });
    expect(told.filter(key => key === keys[0])).toHaveLength(1);
    expect(told.filter(key => key === keys[1])).toHaveLength(1);
  });
});
