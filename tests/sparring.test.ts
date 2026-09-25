import { expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body } from '../src/sim/core/types';

/** A player asks an ordinary villager to spar; both train through the one martial session
 * mechanic (mind/martialPractice.ts) and both are credited. Disclosed fixture: placement only. */
const stepFor = (s: BridgeSession, seconds: number) => { for (let i = 0; i < seconds * 60; i++) s.stepInteraction(); };
function standBeside(s: BridgeSession, body: Body, target: { x: number; y: number; z: number }) {
  const w = s.world;
  for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
    const x = Math.floor(target.x + dx) + .5, z = Math.floor(target.z + dz) + .5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - target.y) <= 0.6 && w.nav.walkCost(Math.floor(x), Math.floor(z)) < 3) { body.pos = { x, y, z }; body.yaw = Math.atan2(-(target.x - x), -(target.z - z)); return true; }
  }
  return false;
}

it('sparring through dialogue runs real martial sessions that develop and credit both partners', () => {
  const s = new BridgeSession(918271, { playable: true }), w = s.world, player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
  let seq = 0; const say = (m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m });
  const candidates = w.livingPersons().filter(p => p.id !== player.id && p.age >= 18 && p.age < 50 && !p.hostile && w.primaryBody(p.id)?.pose !== 'sleep');
  let partner = candidates[0], menu: string[] = [];
  for (const c of candidates) {
    standBeside(s, pb, w.primaryBody(c.id)!.pos); stepFor(s, 0.5);
    if (say({ type: 'talk', targetBodyId: w.primaryBody(c.id)!.id }).result !== 'accepted') continue;
    menu = s.snapshot(false).dialogue!.options.map(o => o.label);
    if (menu.includes('Spar with me a few rounds')) { partner = c; break; }
    say({ type: 'dialogue_close' });
  }
  const options = s.snapshot(false).dialogue!.options;
  const spar = options.find(o => o.label === 'Spar with me a few rounds');
  expect(spar, menu.join(' | ')).toBeTruthy();
  const dex = player.development.exposure.dexterity;
  expect(say({ type: 'dialogue_option', optionId: spar!.id }).result).toBe('accepted');
  say({ type: 'dialogue_close' });
  stepFor(s, 330);
  const rounds = w.events.filter(e => e.type === 'work_shift' && e.actor === player.id && e.target === partner.id && e.data.martial === 'spar' && e.data.phase === 'completed');
  expect(rounds.length).toBeGreaterThanOrEqual(3);
  expect(player.capability?.bySkill.unarmed?.effectiveSeconds ?? 0).toBeGreaterThan(0);
  expect(partner.capability?.bySkill.unarmed?.effectiveSeconds ?? 0).toBeGreaterThan(0);
  expect(player.development.exposure.dexterity).toBeGreaterThan(dex);
  expect(rounds.every(e => e.data.capabilityCredits?.[player.id] > 0 && e.data.capabilityCredits?.[partner.id] > 0)).toBe(true);
}, 300_000);
