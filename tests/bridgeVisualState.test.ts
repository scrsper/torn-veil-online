import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { humanoidVisualState } from '../src/bridge/visualState';
import { deserialize, serialize } from '../src/sim/persist/save';
import { MELEE_COOLDOWN, meleeStrike } from '../src/sim/physical/melee';
import { makeBody } from '../src/sim/world/factory';
import { addPerson, createTestWorld, step, v } from './helpers/world';

describe('humanoid visual event counts', () => {
  it('keeps a canonical knock-down visible when the NPC replans a wait after the hit', () => {
    const tw = createTestWorld();
    const a = addPerson(tw, 'Attacker', 'traveler', v(10, 1, 10), { controlled: true });
    const target = addPerson(tw, 'Target', 'farmer', v(11, 1, 10));
    const ab = tw.world.primaryBody(a.id)!, tb = tw.world.primaryBody(target.id)!;
    tw.sim.applyHit(a, ab, tb, tb.health + 1, 'injure');
    expect(tb.pose).toBe('downed');
    step(tw, 1);
    expect(tb.poseUntil).toBeGreaterThan(tw.world.physicalTime);
    expect(humanoidVisualState(tb, target.name, tb.pose).incapacitated).toBe(true);
    expect(tb.vel.x).toBe(0); expect(tb.vel.z).toBe(0);
  });
  it('preserves every accepted attack and hit between snapshots and across JSON/save/reconnect', () => {
    const s = new BridgeSession(), w = s.world;
    const p = w.person(w.playerId)!, ab = w.primaryBody(p.id)!;
    const victim = w.persons().find(other => other.id !== p.id)!;
    const tb = w.primaryBody(victim.id)!;
    // Establish genuine local perception before exercising the normal snapshot path.
    tb.pos = { ...ab.pos, x: ab.pos.x + 1 };
    for (let i = 0; i < 6; i++) s.step(.05);
    const before = s.snapshot();
    expect(before.bodies.some(b => b.bodyId === tb.id)).toBe(true);
    tb.pos = { ...ab.pos, x: ab.pos.x + 1 };
    const a0 = ab.attackSeq, h0 = tb.hitSeq;
    for (let i = 1; i <= 2; i++) {
      w.physicalTime += MELEE_COOLDOWN + .01;
      expect(s.intent({ version: 1, sequence: i, type: 'attack', targetBodyId: tb.id }).result).toBe('accepted');
    }
    const after = s.snapshot();
    expect(after.bodies.find(b => b.bodyId === ab.id)!.attackSeq).toBe(a0 + 2);
    expect(after.bodies.find(b => b.bodyId === tb.id)!.hitSeq).toBe(h0 + 2);
    const events = w.events.filter(e => e.type === 'attack' && e.actor === p.id).slice(-2);
    expect(events.map(e => [e.data.attackerBodyId, e.data.targetBodyId, e.data.attackSeq, e.data.hitSeq]))
      .toEqual([[ab.id, tb.id, a0 + 1, h0 + 1], [ab.id, tb.id, a0 + 2, h0 + 2]]);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
    s.resetInput();
    expect(s.snapshot().bodies.find(b => b.bodyId === ab.id)!.attackSeq).toBe(a0 + 2);
    const resumed = new BridgeSession(918271, { save: s.save() });
    expect(resumed.world.body(ab.id)!.attackSeq).toBe(a0 + 2);
    expect(resumed.world.body(tb.id)!.hitSeq).toBe(h0 + 2);
    resumed.world.physicalTime += MELEE_COOLDOWN + .01;
    expect(resumed.intent({ version: 1, sequence: 1, type: 'attack', targetBodyId: tb.id }).result).toBe('accepted');
    expect(resumed.world.body(ab.id)!.attackSeq).toBe(a0 + 3);
    expect(resumed.world.body(tb.id)!.hitSeq).toBe(h0 + 3);
  });

  it('counts same-timestamp applied hits independently of pose and only on their manifestation', () => {
    const tw = createTestWorld(), { world: w, sim } = tw;
    const a = addPerson(tw, 'Attacker', 'traveler', v(10, 1, 10));
    const target = addPerson(tw, 'Target', 'farmer', v(11, 1, 10));
    const ab = w.primaryBody(a.id)!, tb = w.primaryBody(target.id)!;
    const other = makeBody(w, target.id, v(12, 1, 10)); target.bodies.push(other.id);
    sim.applyHit(a, ab, tb, 1);
    const first = humanoidVisualState(tb, 'Target', 'stand');
    sim.applyHit(a, ab, tb, 1);
    const second = humanoidVisualState(tb, 'Target', 'stand');
    expect(second.lastHitAt).toBe(first.lastHitAt);
    expect(second.hitSeq).toBe(first.hitSeq + 1);
    expect(other.hitSeq).toBe(0);
    expect(ab.hitSeq).toBe(0);
    expect(ab.attackSeq).toBe(0); // applyHit itself does not invent a swing.
  });

  it('does not count rejected attacks; untargeted physical swings still count', () => {
    const tw = createTestWorld(), { world: w, sim } = tw;
    const a = addPerson(tw, 'Attacker', 'traveler', v(10, 1, 10));
    const target = addPerson(tw, 'Target', 'farmer', v(11, 1, 10));
    const ab = w.primaryBody(a.id)!, tb = w.primaryBody(target.id)!;
    expect(sim.attack(a, ab, tb).attempted).toBe(true);
    expect(sim.attack(a, ab, tb).rejection).toBe('cooldown');
    expect([ab.attackSeq, tb.hitSeq]).toEqual([1, 1]);
    w.physicalTime += MELEE_COOLDOWN + .01;
    ab.yaw = Math.PI; // target is to the side, outside the forward swing arc.
    expect(meleeStrike(sim, a, ab, null)).toBe('no_target');
    expect([ab.attackSeq, tb.hitSeq]).toEqual([2, 1]);
    ab.pose = 'downed';
    w.physicalTime += MELEE_COOLDOWN + .01;
    expect(meleeStrike(sim, a, ab, tb.id)).toBe('incapacitated');
    expect([ab.attackSeq, tb.hitSeq]).toEqual([2, 1]);
  });

  it('reports actual movement without leaking sprint tuning, and snapshots detach vectors', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10));
    const b = tw.world.primaryBody(p.id)!;
    b.vel = { x: 3, y: 9, z: 4 };
    const visual = humanoidVisualState(b, p.name, b.pose, p.appearance);
    expect(visual.speed).toBe(5);
    expect(visual).not.toHaveProperty('sprintMultiplier');
    b.pos.x++; b.vel.x = 0;
    expect(visual.pos.x).toBe(10);
    expect(visual.velocity.x).toBe(3);
  });

  it('withdraws exactly one visible body even when its owner has another manifestation', () => {
    const s = new BridgeSession(), w = s.world, p = w.person(w.playerId)!;
    const ab = w.primaryBody(p.id)!;
    const other = makeBody(w, p.id, { ...ab.pos, x: ab.pos.x + 1 }); p.bodies.push(other.id);
    // The ordinary player always sees its controlled body; the developer view proves both
    // rows share one entity while retaining separate presentation identities.
    const before = s.developerSnapshot().bodies.filter(b => b.entityId === p.id);
    expect(before.map(b => b.bodyId)).toEqual([ab.id, other.id]);
    other.present = false;
    expect(s.developerSnapshot().bodies.filter(b => b.entityId === p.id).map(b => b.bodyId)).toEqual([ab.id]);
    ab.present = false;
    expect(s.snapshot().bodies.some(b => b.bodyId === ab.id)).toBe(false);
  });

  it('loads pre-counter v24 saves with a zero baseline and rejects corrupt counters', () => {
    const s = new BridgeSession();
    const data = JSON.parse(serialize(s.world));
    for (const b of data.bodies) { delete b.attackSeq; delete b.hitSeq; }
    const loaded = deserialize(JSON.stringify(data))!;
    expect(loaded).not.toBeNull();
    expect(loaded.world.bodies().every(b => b.attackSeq === 0 && b.hitSeq === 0)).toBe(true);
    data.bodies[0].attackSeq = -1;
    expect(deserialize(JSON.stringify(data))).toBeNull();
  });
});
