import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { meleeStrike, MELEE_REACH, MELEE_COOLDOWN } from '../src/sim/physical/melee';
import { subdue } from '../src/sim/social/custody';
import { beginConflict } from '../src/sim/social/conflict';
import { createTestWorld, addPerson, v, step, wall } from './helpers/world';

/**
 * The external client may say "I am swinging, at them". Everything that follows — whether the
 * blow lands, how hard, whether it kills, and who finds out — is the same canonical path an NPC
 * takes. These assert that boundary, not the numbers on either side of it.
 */
describe('melee intent from an external client', () => {
  it('resolves through Simulation.attack, damaging the target and emitting the canonical event', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const victim = addPerson(tw, 'Neris Vale', 'farmer', v(11.5, 1, 10));
    const pb = tw.world.primaryBody(player.id)!, vb = tw.world.primaryBody(victim.id)!;
    pb.yaw = Math.atan2(-(vb.pos.x - pb.pos.x), -(vb.pos.z - pb.pos.z));

    const before = vb.health;
    expect(meleeStrike(tw.sim, player, pb, null)).toBe('accepted');
    expect(vb.health).toBeLessThan(before);
    const attack = tw.world.events.filter(e => e.type === 'attack');
    expect(attack).toHaveLength(1);
    expect(attack[0].actor).toBe(player.id);
    expect(attack[0].target).toBe(victim.id);
    // The victim knows who hit them, through the ordinary perception path — not a client message.
    expect(Object.values(victim.knowledge).some(k => k.claim.actor === player.id)).toBe(true);
  });

  it('re-checks reach against canonical state rather than trusting the named body', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const distant = addPerson(tw, 'Distant', 'farmer', v(10 + MELEE_REACH + 4, 1, 10));
    const pb = tw.world.primaryBody(player.id)!, db = tw.world.primaryBody(distant.id)!;
    const before = db.health;
    expect(meleeStrike(tw.sim, player, pb, db.id)).toBe('out_of_reach');
    expect(db.health).toBe(before);
    expect(tw.world.events.some(e => e.type === 'attack')).toBe(false);
  });

  it('charges a whiff the same recovery as a landed blow, so swings cannot be spammed', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const victim = addPerson(tw, 'Neris Vale', 'farmer', v(11.5, 1, 10));
    const pb = tw.world.primaryBody(player.id)!;
    pb.yaw = Math.PI; // facing away — nothing in the arc
    expect(meleeStrike(tw.sim, player, pb, null)).toBe('no_target');
    expect(pb.pose).toBe('attack');
    expect(meleeStrike(tw.sim, player, pb, tw.world.primaryBody(victim.id)!.id)).toBe('cooldown');
    step(tw, MELEE_COOLDOWN + 0.1);
    // Keep range fixed: autonomous movement during recovery is tested separately.
    tw.world.primaryBody(victim.id)!.pos = { x: pb.pos.x + 1.5, y: pb.pos.y, z: pb.pos.z };
    expect(meleeStrike(tw.sim, player, pb, tw.world.primaryBody(victim.id)!.id)).toBe('accepted');
  });

  it('keeps the canonical nonlethal outcome: an ordinary beating downs rather than kills', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const victim = addPerson(tw, 'Neris Vale', 'farmer', v(11.2, 1, 10));
    const pb = tw.world.primaryBody(player.id)!, vb = tw.world.primaryBody(victim.id)!;
    vb.health = 4; // below the lightest possible bare-handed blow
    pb.yaw = Math.atan2(-(vb.pos.x - pb.pos.x), -(vb.pos.z - pb.pos.z));
    expect(meleeStrike(tw.sim, player, pb, vb.id)).toBe('accepted');
    expect(vb.pose).toBe('downed');
    expect(vb.dead).toBe(false);
    expect(victim.alive).toBe(true);
  });

  it('will not strike someone already out of the fight', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const victim = addPerson(tw, 'Neris Vale', 'farmer', v(11.2, 1, 10));
    const pb = tw.world.primaryBody(player.id)!, vb = tw.world.primaryBody(victim.id)!;
    subdue(tw.world, victim, player.id, beginConflict(tw.world, { initiator: player.id, target: victim.id, cause: 'crime_response', intent: 'subdue' }));
    const before = vb.health;
    pb.yaw = Math.atan2(-(vb.pos.x - pb.pos.x), -(vb.pos.z - pb.pos.z));
    expect(meleeStrike(tw.sim, player, pb, vb.id)).toBe('accepted'); // the swing happens
    expect(vb.health).toBe(before);                                   // the blow does not land
  });

  it('refuses to swing at all while the attacker is themselves down', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    addPerson(tw, 'Neris Vale', 'farmer', v(11.2, 1, 10));
    const pb = tw.world.primaryBody(player.id)!;
    pb.pose = 'downed';
    expect(meleeStrike(tw.sim, player, pb, null)).toBe('incapacitated');
  });
});

describe('attack over the bridge protocol', () => {
  it('accepts a versioned attack intent and reports combat state back in the snapshot', () => {
    const s = new BridgeSession();
    const player = s.world.person(s.world.playerId)!;
    const pb = s.world.primaryBody(player.id)!;
    const victim = s.developerSnapshot().bodies.find(b => b.entityId !== s.world.playerId)!;
    const vb = s.world.body(victim.bodyId)!;
    // Stand the Traveler next to a real member of the cast.
    pb.pos = { x: vb.pos.x + 1, y: vb.pos.y, z: vb.pos.z };

    expect(s.intent({ version: 1, sequence: 1, type: 'attack', targetBodyId: vb.id }).result).toBe('accepted');
    const after = s.developerSnapshot();
    const row = after.bodies.find(b => b.bodyId === vb.id)!;
    const self = after.bodies.find(b => b.entityId === s.world.playerId)!;
    expect(row.health).toBeLessThan(row.maxHealth);
    expect(self.pose).toBe('attack');
    expect(self.attackTarget).toBe(vb.ownerId);
    expect(after.events.some(e => e.type === 'attack' && e.actor === player.id)).toBe(true);
    // Reach, cooldown and the canonical event are all the simulation's to state.
    expect(typeof after.bodies[0].reach).toBe('number');
    expect(s.intent({ version: 1, sequence: 2, type: 'attack', targetBodyId: vb.id }).result).toBe('cooldown');
  });

  it('does not let a client name a body across the village', () => {
    const s = new BridgeSession();
    const rows = s.developerSnapshot().bodies.filter(b => b.entityId !== s.world.playerId);
    const pb = s.world.primaryBody(s.world.playerId)!;
    const far = rows.map(b => ({ b, d: Math.hypot(b.pos.x - pb.pos.x, b.pos.z - pb.pos.z) })).sort((a, c) => c.d - a.d)[0];
    expect(far.d).toBeGreaterThan(MELEE_REACH);
    expect(s.intent({ version: 1, sequence: 1, type: 'attack', targetBodyId: far.b.bodyId }).result).toBe('out_of_reach');
    // The village's own seeded history contains fights; only the player's swing is in question.
    expect(s.world.events.some(e => e.type === 'attack' && e.actor === s.world.playerId)).toBe(false);
  });
});

/**
 * Reach is a distance AND a clear path. The browser player has never been able to strike through
 * a wall — it picks its target by raycast, so the wall stops the pick before the swing exists.
 * The external-client path picked by distance alone, which let a client stand outside a building
 * and hit whoever was inside it. These pin the canonical rule, not the client that motivated it.
 */
describe('melee cannot pass through canonical solid geometry', () => {
  const between = (tw: ReturnType<typeof createTestWorld>) => wall(tw, 11, 6, 14);

  it('refuses a named target standing on the other side of a wall, at a distance it could otherwise reach', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const inside = addPerson(tw, 'Osric Bramble', 'baker', v(12, 1, 10));
    between(tw);
    const pb = tw.world.primaryBody(player.id)!, ib = tw.world.primaryBody(inside.id)!;
    // Close enough that only the wall can be the reason.
    expect(Math.hypot(ib.pos.x - pb.pos.x, ib.pos.z - pb.pos.z)).toBeLessThan(MELEE_REACH);

    const before = ib.health;
    expect(meleeStrike(tw.sim, player, pb, ib.id)).toBe('out_of_reach');
    expect(ib.health).toBe(before);
    expect(tw.world.events.some(e => e.type === 'attack' && e.actor === player.id)).toBe(false);
  });

  it('refuses the same target on an untargeted swing, so aiming by facing is no way around it', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const inside = addPerson(tw, 'Osric Bramble', 'baker', v(12, 1, 10));
    between(tw);
    const pb = tw.world.primaryBody(player.id)!, ib = tw.world.primaryBody(inside.id)!;
    pb.yaw = Math.atan2(-(ib.pos.x - pb.pos.x), -(ib.pos.z - pb.pos.z));

    const before = ib.health;
    expect(meleeStrike(tw.sim, player, pb, null)).toBe('no_target');
    expect(ib.health).toBe(before);
  });

  it('still lands on the same geometry once the two are on the same side of it', () => {
    const tw = createTestWorld();
    const player = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10), { controlled: true });
    const near = addPerson(tw, 'Mara Bramble', 'baker', v(8.6, 1, 10));
    between(tw);
    const pb = tw.world.primaryBody(player.id)!, nb = tw.world.primaryBody(near.id)!;

    const before = nb.health;
    expect(meleeStrike(tw.sim, player, pb, nb.id)).toBe('accepted');
    expect(nb.health).toBeLessThan(before);
  });
});
