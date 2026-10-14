import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body, Creature } from '../src/sim/core/types';
import { isCrime, huntsWildGame, eventClaim } from '../src/sim/mind/knowledge';

/**
 * Bringing down a wild animal is hunting, not violence against a victim. Watching a stranger kill a
 * boar used to be appraised blow by blow as a witnessed crime: a village hunter's trust, affection
 * and respect fell to -1, fear and grudge rose to ~0.95, and the hunter attacked the stranger in
 * the square. Disclosed fixtures: the bystander is stood near, the blows are the simulation's own
 * applyHit. Attacks on people remain crimes.
 */
function standNear(w: BridgeSession['world'], body: Body, target: { x: number; y: number; z: number }, gap: number): boolean {
  for (const [dx, dz] of [[gap, 0], [-gap, 0], [0, gap], [0, -gap]]) {
    const x = Math.floor(target.x + dx) + .5, z = Math.floor(target.z + dz) + .5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - target.y) <= 0.6 && w.nav.walkCost(Math.floor(x), Math.floor(z)) < 3) { body.pos = { x, y, z }; return true; }
  }
  return false;
}

describe('hunting is not a crime', () => {
  it('a hunter watching a stranger kill a wild boar does not come to fear or hate them', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world, player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
    const boar = (w.creatures() as Creature[]).find(c => c.species === 'woodland_boar' && c.wildlife!.sex === 'male' && !c.wildlife!.parentIds.length)!;
    const bb = w.primaryBody(boar.id)!;
    const hunter = w.livingPersons().find(p => p.occupation === 'hunter' && p.id !== player.id)!, hb = w.primaryBody(hunter.id)!;
    expect(standNear(w, pb, bb.pos, 1.3)).toBe(true);
    expect(standNear(w, hb, bb.pos, 5)).toBe(true);
    for (let i = 0; i < 20 && !bb.dead; i++) { s.sim.applyHit(player, pb, bb, 30, 'kill'); s.stepInteraction(); }
    for (let i = 0; i < 120; i++) s.stepInteraction();
    expect(bb.dead).toBe(true);
    const kill = w.events.find(e => e.type === 'kill' && e.actor === player.id && e.target === boar.id)!;
    expect(kill.perceivedBy.some(x => x.who === hunter.id)).toBe(true);
    expect(huntsWildGame(w, 'kill', boar.id)).toBe(true);
    const claim = eventClaim(w, kill, true);
    expect(claim.intent).toBe('hunt');
    expect(isCrime(claim.type, claim.intent)).toBe(false);
    const rel = hunter.relationships[player.id];
    expect(rel?.grudge ?? 0).toBeLessThan(0.05);
    expect(rel?.fear ?? 0).toBeLessThan(0.05);
    expect(rel?.trust ?? 0).toBeGreaterThan(-0.05);
    expect(w.situations.some(x => x.subjectId === boar.id && x.status === 'active')).toBe(false);
  }, 120_000);

  it('attacking a person is still a crime', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world;
    const [a, b] = w.livingPersons();
    expect(huntsWildGame(w, 'attack', b.id)).toBe(false);
    expect(isCrime('attack', undefined)).toBe(true);
    expect(isCrime('kill', 'hunt')).toBe(false);
    expect(a.id).not.toBe(b.id);
  }, 120_000);
});
