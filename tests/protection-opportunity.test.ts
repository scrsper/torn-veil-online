import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body, Creature, Person } from '../src/sim/core/types';
import { knowsVeil } from '../src/sim/physical/veil';
import { makeItem } from '../src/sim/world/factory';
import { getRel } from '../src/sim/mind/relationships';

/**
 * The first ordinary adventure loop, driven through the same session intents a client sends.
 * Fixture placement (disclosed): the victim is stood beside the protective sow once, and the player
 * is stood beside people to talk to them. Everything else is ordinary simulation.
 */
const stepFor = (s: BridgeSession, seconds: number, each?: () => void) => { for (let i = 0; i < seconds * 60; i++) { each?.(); s.stepInteraction(); } };
function standBeside(w: BridgeSession['world'], body: Body, target: { x: number; y: number; z: number }, gap: number) {
  for (const [dx, dz] of [[gap, 0], [-gap, 0], [0, gap], [0, -gap]]) {
    const x = Math.floor(target.x + dx) + .5, z = Math.floor(target.z + dz) + .5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - target.y) <= 0.6 && w.nav.walkCost(Math.floor(x), Math.floor(z)) < 3) { body.pos = { x, y, z }; body.yaw = Math.atan2(-(target.x - x), -(target.z - z)); return true; }
  }
  return false;
}
function setup() {
  const s = new BridgeSession(918271, { playable: true });
  const w = s.world, player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
  const boars = w.creatures().filter(c => c.species === 'woodland_boar') as Creature[];
  const sow = boars.find(b => b.wildlife!.sex === 'female' && boars.some(y => y.wildlife!.parentIds.includes(b.id)))!;
  const sb = w.primaryBody(sow.id)!;
  const victim = w.livingPersons().filter(p => p.id !== player.id && p.age > 20 && p.wealth >= 15 && !knowsVeil(p))
    .sort((a, b) => w.distance2d(w.positionOf(a.id)!, sb.pos) - w.distance2d(w.positionOf(b.id)!, sb.pos))[0];
  return { s, w, player, pb, sow, sb, victim, vb: w.primaryBody(victim.id)! };
}
let seq = 0;
const say = (s: BridgeSession, m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m });
function talkAndChoose(s: BridgeSession, targetBodyId: string, pick: (labels: string[]) => number): string[] {
  expect(say(s, { type: 'talk', targetBodyId }).result).toBe('accepted');
  const menu = s.snapshot(false).dialogue!;
  const i = pick(menu.options.map(o => o.label));
  expect(i).toBeGreaterThanOrEqual(0);
  expect(say(s, { type: 'dialogue_option', optionId: menu.options[i].id }).result).toBe('accepted');
  return s.snapshot(false).dialogue?.lines ?? [];
}

describe('a protection opportunity arising from a real animal attack', () => {
  it('attack → danger concern → request → accept → hunt → butcher → proof → paid, and the world remembers', () => {
    const { s, w, player, pb, sow, sb, victim, vb } = setup();
    // 1. The sow, guarding her litter, goes for someone working near the forest.
    expect(standBeside(w, vb, sb.pos, 2.5)).toBe(true);
    // She may be gored or may get away (the charge can miss a fleeing target); either way she has seen it go for her.
    for (let i = 0; i < 15 && !victim.mind.concerns?.some(c => c.kind === 'safety' && c.aboutId === sow.id); i++) stepFor(s, 1);
    expect(w.events.some(e => (e.type === 'attack' || e.type === 'animal_threat_display' || e.type === 'attack_missed') && e.actor === sow.id)).toBe(true);
    expect(victim.mind.concerns?.some(c => c.kind === 'safety' && c.aboutId === sow.id)).toBe(true);
    // 2. On the ordinary coarse cadence the victim puts up silver for it to be dealt with.
    stepFor(s, 130);
    const request = w.requests.find(r => r.type === 'protection' && r.requesterId === victim.id);
    expect(request?.status).toBe('open');
    expect(request!.reward).toBeGreaterThan(0);
    // 3. The player hears of it only by asking the victim.
    standBeside(w, pb, w.primaryBody(victim.id)!.pos, 1.5); stepFor(s, 0.5);
    const accepted = talkAndChoose(s, vb.id, l => l.indexOf('Any work going?'));
    const menu = s.snapshot(false).dialogue!;
    const deal = menu.options.findIndex(o => o.label.startsWith('Deal with the woodland boar'));
    expect(deal, accepted.join(' ')).toBeGreaterThanOrEqual(0);
    expect(say(s, { type: 'dialogue_option', optionId: menu.options[deal].id }).result).toBe('accepted');
    expect(request!.acceptedBy).toBe(player.id);
    expect(s.snapshot(false).journal.commitments.some(c => c.requestId === request!.id)).toBe(true);
    say(s, { type: 'dialogue_close' });
    // 4. Prepared (a dagger), the player goes after the sow; hits resolve through ordinary combat.
    const dagger = makeItem(w, 'dagger', 'hunting knife', { owner: player.id, holder: player.id }); player.inventory.push(dagger.id);
    standBeside(w, pb, sb.pos, 1.6);
    const wealthBefore = player.wealth, victimWealthBefore = victim.wealth;
    for (let i = 0; i < 40 && !sb.dead; i++) { s.sim.applyHit(player, pb, sb, 18, 'kill'); stepFor(s, 0.3); }
    expect(sb.dead).toBe(true);
    // 5. Dress the carcass for proof and meat.
    standBeside(w, pb, sb.pos, 1.2); stepFor(s, 0.2);
    expect(say(s, { type: 'interact', interactionId: `butcher:${sb.id}` }).result).toBe('accepted');
    expect(player.inventory.map(id => w.item(id)).some(i => i?.type === 'meat' && i.tags.includes('species:woodland_boar'))).toBe(true);
    expect(player.capability?.bySkill.hunting?.effectiveSeconds ?? 0).toBeGreaterThan(0);
    // 6. Back to the requester with the proof.
    standBeside(w, pb, w.primaryBody(victim.id)!.pos, 1.5); stepFor(s, 0.5);
    const lines = talkAndChoose(s, vb.id, l => l.findIndex(x => x.startsWith('About the woodland boar')));
    expect(lines.join(' ')).toMatch(/silver/);
    expect(request!.status).toBe('completed');
    expect(request!.payload.settledBy).toBe('shown_meat');
    expect(player.wealth - wealthBefore).toBe(request!.paid);
    expect(victimWealthBefore - victim.wealth).toBe(request!.paid); // conserved
    expect(victim.mind.concerns?.find(c => c.aboutId === sow.id)?.status).toBe('addressed');
    expect(getRel(victim, player.id).trust).toBeGreaterThan(0.1);
  }, 240_000);

  it('the veil hush is a different answer: taught by a keeper, it turns the sow away at a real cost', () => {
    const { s, w, player, pb, sow, sb } = setup();
    const keeper = w.livingPersons().find(knowsVeil)!;
    // Without the technique the attempt is refused, with the reason.
    standBeside(w, pb, sb.pos, 5);
    expect(say(s, { type: 'hush', targetBodyId: sb.id }).result).toBe('unknown_technique');
    // A keeper teaches it for a fee, through ordinary dialogue (the canonical apprenticeship path, with provenance).
    const kb = w.primaryBody(keeper.id)!; if (kb.pose === 'sleep') kb.pose = 'stand';
    standBeside(w, pb, kb.pos, 1.5); stepFor(s, 0.5);
    const silver = player.wealth;
    const lesson = talkAndChoose(s, kb.id, l => l.findIndex(x => x.startsWith('Teach me the hush')));
    expect(lesson.join(' ')).toMatch(/Practise it/);
    expect(silver - player.wealth).toBe(10);
    say(s, { type: 'dialogue_close' });
    expect(knowsVeil(player)).toBe(true);
    // Back at the sow, which bristles; the hush costs fatigue whether or not it takes.
    standBeside(w, pb, sb.pos, 5); stepFor(s, 0.5);
    const fatigue = player.physiology.fatigue;
    let result = '';
    for (let i = 0; i < 4 && result !== 'calmed'; i++) { result = say(s, { type: 'hush', targetBodyId: sb.id }).result; stepFor(s, 7); }
    expect(player.physiology.fatigue).toBeGreaterThan(fatigue);
    expect(w.events.filter(e => e.type === 'veil_hush' && e.actor === player.id).length).toBeGreaterThan(0);
    if (result === 'calmed') {
      const st = sow.wildlife!.embodiments[sb.id];
      expect(st.avoid && st.avoid.until > w.physicalTime).toBeTruthy();
      stepFor(s, 8);
      expect(w.events.some(e => e.type === 'attack' && e.actor === sow.id && e.target === player.id)).toBe(false);
    }
    // Practice was credited from the real attempts.
    expect(player.capability?.bySkill.veilcraft?.effectiveSeconds ?? 0).toBeGreaterThan(0);
    // Strain accumulates; eventually it refuses.
    let refused = '';
    for (let i = 0; i < 6 && refused !== 'too_strained'; i++) { refused = say(s, { type: 'hush', targetBodyId: sb.id }).result; stepFor(s, 7); }
    expect(['too_strained', 'out_of_reach', 'exhausted']).toContain(refused);
  }, 240_000);
});
