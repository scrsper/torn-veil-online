import { describe, expect, it } from 'vitest';
import { combatPresentation } from '../src/bridge/combatPresentation';
import { deserialize, newWorld, serialize } from '../src/sim/persist/save';
import { meleeStrike } from '../src/sim/physical/melee';
import { makeBody } from '../src/sim/world/factory';
import { Simulation } from '../src/sim/mind/agent';
import { BridgeSession } from '../src/bridge/session';
import { addPerson, createTestWorld, step, v } from './helpers/world';

describe('combat presentation stream', () => {
  it('replays three direct canonical attacks between publications and preserves order', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { controlled: true });
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    ab.yaw = -Math.PI / 2;
    const visible = new Set([ab.id, bb.id]);
    expect(tw.sim.attack(a, ab, bb).attempted).toBe(true);
    expect(combatPresentation(tw.world, visible, a.id).events).toEqual([]);
    step(tw, .8);
    const first = combatPresentation(tw.world, visible, a.id);
    for (let i = 0; i < 2; i++) {
      expect(tw.sim.attack(a, ab, bb).attempted).toBe(true);
      step(tw, .8);
    }
    const replay = combatPresentation(tw.world, visible, a.id);
    expect(replay.events.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(replay.events.map(e => e.eventId)).toEqual(expect.arrayContaining([first.events[0].eventId]));
    expect(combatPresentation(tw.world, visible, a.id)).toEqual(replay);
  });

  it('normal snapshots expose only the combat facts allowlist', () => {
    const s = new BridgeSession();
    const stream = s.snapshot().combatPresentation;
    const allowed = new Set(['eventId', 'actionId', 'seq', 'physicalTime', 'actorBodyId', 'targetBodyId', 'actorPosition', 'targetPosition', 'targetVelocity', 'actorYaw', 'weaponType', 'weaponId', 'action', 'outcome', 'attackSeq', 'hitSeq', 'capability']);
    for (const event of stream.events) {
      expect(Object.keys(event).every(key => allowed.has(key))).toBe(true);
      expect(event).not.toHaveProperty('intent');
      expect(event).not.toHaveProperty('damage');
    }
  });

  it('does not fabricate a replay stream from legacy attack events', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { controlled: true });
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    tw.world.emit('attack', { actor: a.id, target: b.id, pos: { ...bb.pos } });
    const stream = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    expect(stream.events).toEqual([]);
    expect(stream.latestSeq).toBe(0);
    expect(stream.firstAvailableSeq).toBe(1);
  });

  it('orders accepted hits and misses with monotonic independent action counters', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { controlled: true });
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    ab.yaw = -Math.PI / 2;
    expect(meleeStrike(tw.sim, a, ab, bb.id)).toBe('accepted');
    step(tw, .8);
    ab.yaw = Math.PI;
    expect(meleeStrike(tw.sim, a, ab, null)).toBe('accepted');
    step(tw, .5);
    const stream = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    expect(stream.events.map(e => e.outcome)).toEqual(['hit', 'miss']);
    expect(stream.events.map(e => e.seq)).toEqual([1, 2]);
    expect(stream.latestSeq).toBe(2);
    expect(stream.events[0].eventId).not.toBe(stream.events[1].eventId);
  });

  it('detaches snapshots and does not consume RNG', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { controlled: true });
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    tw.sim.applyHit(a, ab, bb, 1);
    const before = tw.world.rng.state();
    const first = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    first.events[0].actorPosition.x = 999; first.events.push({ ...first.events[0] });
    const second = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].actorPosition.x).toBe(10);
    expect(tw.world.rng.state()).toBe(before);
  });

  it('persists immutable facts and continues the action sequence after reload', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const a = world.person(world.playerId)!; const b = gen.people.tomas;
    const ab = world.primaryBody(a.id)!; const bb = world.primaryBody(b.id)!;
    sim.applyHit(a, ab, bb, 1);
    const facts = world.events.find(e => e.data.combatFacts)!.data.combatFacts;
    const loaded = deserialize(serialize(world));
    expect(loaded).not.toBeNull();
    const rw = loaded!.world; const rs = new Simulation(rw);
    const ra = rw.person(a.id)!; const rb = rw.person(b.id)!;
    rs.applyHit(ra, rw.primaryBody(ra.id)!, rw.primaryBody(rb.id)!, 1);
    const hitFacts = rw.events.filter(e => e.data.combatFacts).map(e => e.data.combatFacts);
    expect(hitFacts[0]).toEqual(facts);
    expect(hitFacts.at(-1).seq).toBe(facts.seq + 1);
  });

  it('reports retention floor at capacity and after expiry', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const ab = tw.world.primaryBody(a.id)!; ab.yaw = Math.PI;
    const b = addPerson(tw, 'Retention fixture', 'farmer', v(11, 1, 10), { controlled: true });
    const bb = tw.world.primaryBody(b.id)!;
    for (let i = 0; i < 130; i++) tw.sim.applyHit(a, ab, bb, 0);
    const full = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    expect(full.events).toHaveLength(128);
    expect(full.firstAvailableSeq).toBe(3);
    tw.world.physicalTime += 9;
    const expired = combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id);
    expect(expired.events).toHaveLength(0);
    expect(expired.firstAvailableSeq).toBe(expired.latestSeq + 1);
  });

  it('isolates manifestations and requires sight for uninvolved observers', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'A', 'traveler', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { controlled: true });
    const observer = addPerson(tw, 'Observer', 'farmer', v(20, 1, 20));
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    const second = makeBody(tw.world, a.id, v(30, 1, 30)); a.bodies.push(second.id);
    tw.sim.applyHit(a, ab, bb, 1);
    const event = tw.world.events.find(e => e.data.combatFacts)!;
    event.perceivedBy.push({ who: observer.id, how: 'heard', tick: event.tick });
    expect(combatPresentation(tw.world, new Set([second.id, bb.id]), observer.id).events).toHaveLength(0);
    expect(combatPresentation(tw.world, new Set([ab.id, bb.id]), observer.id).events).toHaveLength(0);
    event.perceivedBy.push({ who: observer.id, how: 'saw', tick: event.tick });
    expect(combatPresentation(tw.world, new Set([ab.id, bb.id]), observer.id).events).toHaveLength(1);
    const legacy = tw.world.emit('attack', { actor: a.id, target: b.id, pos: { ...bb.pos } });
    expect(legacy.data.combatFacts).toBeUndefined();
    expect(combatPresentation(tw.world, new Set([ab.id, bb.id]), a.id).events).toHaveLength(1);
  });
});
