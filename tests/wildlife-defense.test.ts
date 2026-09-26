import { requestGuard } from '../src/sim/physical/guard';
import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body, Creature } from '../src/sim/core/types';
import { menacingAnimals } from '../src/sim/ecology/defense';

/** Scenario fixture: a boar and the local Traveler placed near each other in the regional world.
 * Placement is test setup; everything after it runs through ordinary stepping and commands. */
function encounter(gapM: number) {
  const s = new BridgeSession(918271, { playable: true });
  const w = s.world, player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
  const boar = w.creatures().find(c => c.species === 'woodland_boar' && c.wildlife?.sex === 'male' && w.primaryBody(c.id) && !w.primaryBody(c.id)!.dead) as Creature;
  const bb = w.primaryBody(boar.id)!;
  // Stand the player on open walkable ground next to the boar's own position.
  for (const [dx, dz] of [[gapM, 0], [-gapM, 0], [0, gapM], [0, -gapM]]) {
    const x = Math.floor(bb.pos.x + dx) + 0.5, z = Math.floor(bb.pos.z + dz) + 0.5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - bb.pos.y) <= 0.5 && w.nav.walkCost(Math.floor(x), Math.floor(z)) < 3 && w.grid.lineOfSight({ ...bb.pos, y: bb.pos.y + 0.8 }, { x, y: y + 1.5, z }, gapM + 2)) { pb.pos = { x, y, z }; break; }
  }
  pb.yaw = Math.atan2(-(bb.pos.x - pb.pos.x), -(bb.pos.z - pb.pos.z));
  return { s, w, player, pb, boar, bb };
}
const run = (s: BridgeSession, seconds: number, each?: () => void) => { for (let i = 0; i < seconds * 60; i++) { each?.(); s.stepInteraction(); } };
const modeOf = (boar: Creature, bb: Body) => boar.wildlife!.embodiments[bb.id].defense?.mode;

describe('defensive wildlife', () => {
  it('a boar surprised at close quarters displays, then charges and gores a person who presses on', () => {
    const { s, w, player, pb, boar, bb } = encounter(5);
    run(s, 0.5);
    expect(modeOf(boar, bb)).toBe('warn');
    expect(w.events.some(e => e.type === 'animal_threat_display' && e.actor === boar.id)).toBe(true);
    expect(menacingAnimals(w, player).map(m => m.animal.id)).toContain(boar.id);
    const health = pb.health;
    let seq = 0;
    run(s, 8, () => { const d = { x: bb.pos.x - pb.pos.x, z: bb.pos.z - pb.pos.z }, l = Math.hypot(d.x, d.z) || 1; if (l > 1.6) s.intent({ version: 1, type: 'move', sequence: ++seq, x: d.x / l, z: d.z / l, sprint: false }); });
    const gore = w.events.find(e => e.type === 'attack' && e.actor === boar.id && e.target === player.id);
    expect(gore).toBeTruthy();
    expect(pb.health).toBeLessThan(health);
    expect(Object.keys(pb.injuries ?? {}).length).toBeGreaterThan(0);
    expect(player.alive).toBe(true); // drive-off intent never kills
  }, 60_000);


  it('holding a frontal guard braces a real boar impact without making it harmless', () => {
    const { s, w, player, pb, boar, bb } = encounter(5);
    const health = pb.health; let seq = 0;
    run(s, 8, () => {
      const dx = bb.pos.x - pb.pos.x, dz = bb.pos.z - pb.pos.z, distance = Math.hypot(dx, dz) || 1;
      if (distance > 1.6) s.intent({ version: 1, type: 'move', sequence: ++seq, x: dx / distance, z: dz / distance, sprint: false });
      requestGuard(w, pb.id, true);
    });
    const brace = w.events.find(e => e.data.kind === 'guard' && e.target === boar.id && e.data.phase === 'contact');
    expect(brace?.data.outcome).toBe('blocked');
    expect(brace?.data.impact).toBeCloseTo(brace!.data.incomingImpact * .65);
    expect(w.events.some(e => e.type === 'attack' && e.actor === boar.id && e.causes.includes(brace!.id))).toBe(true);
    expect(pb.health).toBeLessThan(health); expect(player.alive).toBe(true);
  }, 60_000);

  it('backing away out of range ends the display without a fight', () => {
    const { s, w, player, pb, boar, bb } = encounter(6);
    run(s, 0.4);
    expect(modeOf(boar, bb)).toBe('warn');
    const away = { x: pb.pos.x - bb.pos.x, z: pb.pos.z - bb.pos.z }, len = Math.hypot(away.x, away.z);
    let seq = 0;
    run(s, 4, () => { s.intent({ version: 1, type: 'move', sequence: ++seq, x: away.x / len, z: away.z / len, sprint: true }); });
    expect(w.events.some(e => e.type === 'attack' && e.actor === boar.id)).toBe(false);
    expect(player.alive && pb.health === pb.maxHealth).toBe(true);
  }, 60_000);

  it('a person who strikes a boar provokes it; killing it leaves a carcass', () => {
    const { s, w, player, pb, boar, bb } = encounter(1.2);
    const blow = s.sim.applyHit(player, pb, bb, 30, 'kill');
    expect(blow).toBeTruthy();
    expect(boar.wildlife!.embodiments[bb.id].provokedBy?.bodyId).toBe(pb.id);
    s.sim.applyHit(player, pb, bb, 200, 'kill');
    expect(bb.dead).toBe(true);
    expect(bb.present).toBe(true);
    expect(boar.wildlife!.embodiments[bb.id].deathCause).toBe('killed');
  }, 60_000);
});
