import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body, Person } from '../src/sim/core/types';

/**
 * Talking to someone is a real interaction: the person spoken to stops and faces the speaker
 * while the conversation is open (unless their own goal is urgent) and carries on afterwards;
 * someone who cannot talk says why instead of nothing happening. Placement is the only fixture.
 */
type W = BridgeSession['world'];
let seq = 0;
const say = (s: BridgeSession, m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m });
const stepFor = (s: BridgeSession, seconds: number) => { for (let i = 0; i < seconds * 20; i++) s.step(0.05); };
function beside(w: W, body: Body, at: { x: number; y: number; z: number }) {
  for (const [dx, dz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) {
    const x = Math.floor(at.x + dx) + .5, z = Math.floor(at.z + dz) + .5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - at.y) <= 0.6) { body.pos = { x, y, z }; body.yaw = Math.atan2(-(at.x - x), -(at.z - z)); return true; }
  }
  return false;
}
const speed = (b: Body) => Math.hypot(b.vel.x, b.vel.z);
const facingError = (b: Body, target: Body) => {
  const want = Math.atan2(-(target.pos.x - b.pos.x), -(target.pos.z - b.pos.z));
  return Math.abs(Math.atan2(Math.sin(b.yaw - want), Math.cos(b.yaw - want)));
};

describe('talking to someone', () => {
  it('a walking villager stops and faces the player while spoken to, then carries on', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world;
    const player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
    let walker: Person | undefined;
    for (let t = 0; t < 120 && !walker; t++) {
      stepFor(s, 1);
      walker = w.livingPersons().find(p => p.id !== player.id && p.mind.plan.some(a => a.type === 'goto' && a.status === 'active') && speed(w.primaryBody(p.id)!) > 0.5
        && !['flee', 'report', 'attack', 'confront', 'help'].includes(p.mind.goal?.type ?? ''));
    }
    expect(walker, 'someone out walking').toBeDefined();
    const wb = w.primaryBody(walker!.id)!;
    expect(beside(w, pb, wb.pos)).toBe(true);
    // Press talk when the prompt is there, as a player does (perception takes a moment).
    for (let i = 0; i < 40 && !(s.snapshot(false) as any).talkTargets.some((t: { bodyId: string }) => t.bodyId === wb.id); i++) s.step(0.05);
    expect(say(s, { type: 'talk', targetBodyId: wb.id }).result).toBe('accepted');
    stepFor(s, 2);
    expect(speed(wb)).toBeLessThan(0.05);
    expect(facingError(wb, pb)).toBeLessThan(0.2);
    expect((s.snapshot(false) as any).bodies.find((b: { bodyId: string }) => b.bodyId === wb.id).embodiment.activity.family).toBe('socialize');
    expect(say(s, { type: 'dialogue_close' }).result).toBe('accepted');
    let resumed = false;
    for (let t = 0; t < 40 && !resumed; t++) { stepFor(s, 0.5); resumed = speed(wb) > 0.3 || !walker!.mind.plan.some(a => a.type === 'goto' && a.status === 'active'); }
    expect(resumed, 'the trip resumes once nobody is talking to them').toBe(true);
  }, 120000);

  it('a villager busy in place (working, resting) turns to face the player who speaks to them', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world;
    const player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
    // Where to stand to be behind someone: 1.4 m from them along their back, on open ground.
    const behind = (b: Body) => {
      const x = Math.floor(b.pos.x + Math.sin(b.yaw) * 1.4) + .5, z = Math.floor(b.pos.z + Math.cos(b.yaw) * 1.4) + .5;
      const y = w.nav.floorY(Math.floor(x), Math.floor(z));
      return y >= 0 && Math.abs(y - b.pos.y) <= 0.6 && w.nav.clearWalk(b.pos, { x, y, z }) ? { x, y, z } : null;
    };
    let still: Person | undefined;
    for (let t = 0; t < 180 && !still; t++) {
      stepFor(s, 1);
      // Someone in the middle of a task in place: a reply of their own would not turn them.
      still = w.livingPersons().find(p => p.id !== player.id && p.age > 12 && speed(w.primaryBody(p.id)!) < 0.05
        && p.mind.plan.some(x => x.status === 'active' && ['work', 'rest', 'eat', 'chop', 'gather'].includes(x.type))
        && !['flee', 'report', 'attack', 'confront', 'help'].includes(p.mind.goal?.type ?? '') && !!behind(w.primaryBody(p.id)!));
    }
    expect(still, 'someone busy in place, with open ground behind them').toBeDefined();
    const sb = w.primaryBody(still!.id)!;
    pb.pos = behind(sb)!;
    pb.yaw = Math.atan2(-(sb.pos.x - pb.pos.x), -(sb.pos.z - pb.pos.z));
    for (let i = 0; i < 40 && !(s.snapshot(false) as any).talkTargets.some((t: { bodyId: string }) => t.bodyId === sb.id); i++) s.step(0.05);
    expect(facingError(sb, pb), 'their back is to the player before being spoken to').toBeGreaterThan(1.2);
    expect(say(s, { type: 'talk', targetBodyId: sb.id }).result).toBe('accepted');
    stepFor(s, 1);
    expect(facingError(sb, pb)).toBeLessThan(0.2);
  }, 120000);

  it('a sleeping villager cannot be spoken to, and the player is told why', () => {
    const s = new BridgeSession(918271, { playable: true }), w = s.world;
    const player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
    const sleeper = w.livingPersons().find(p => p.id !== player.id && p.age > 18)!;
    const sb = w.primaryBody(sleeper.id)!;
    expect(beside(w, pb, sb.pos)).toBe(true);
    sb.pose = 'sleep'; sb.poseUntil = w.physicalTime + 60;
    stepFor(s, 0.5); sb.pose = 'sleep';
    const snap = s.snapshot(false) as any;
    expect(snap.talkTargets.some((t: { bodyId: string }) => t.bodyId === sb.id)).toBe(false);
    expect(snap.talkRefusals.find((t: { bodyId: string }) => t.bodyId === sb.id)?.reason).toBe('asleep');
    expect(say(s, { type: 'talk', targetBodyId: sb.id }).result).toBe('talk_asleep');
  }, 60000);
});
