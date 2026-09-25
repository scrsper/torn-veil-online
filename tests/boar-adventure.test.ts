import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import type { Body, Creature, Person, Vec3 } from '../src/sim/core/types';
import { knowsVeil, veilStrain } from '../src/sim/physical/veil';
import { makeItem } from '../src/sim/world/factory';
import { getRel } from '../src/sim/mind/relationships';
import { believesStilled, maintainProtectionRequests } from '../src/sim/social/protection';

/**
 * Separate hard checks for the boar / protection / veil loop (Living Alpha). Disclosed fixtures:
 * people are stood beside one another or beside an animal (placement only), and a blade is put
 * in a hand where the test is about butchering or armed hunting. Everything else runs through
 * ordinary stepping, the session intents a client sends, or the realtime command queue.
 */
type W = BridgeSession['world'];
const stepFor = (s: BridgeSession, seconds: number, each?: () => void) => { for (let i = 0; i < seconds * 60; i++) { each?.(); s.stepInteraction(); } };
function standBeside(w: W, body: Body, target: { x: number; y: number; z: number }, gap: number) {
  for (const [dx, dz] of [[gap, 0], [-gap, 0], [0, gap], [0, -gap], [gap, gap], [-gap, -gap]]) {
    const x = Math.floor(target.x + dx) + .5, z = Math.floor(target.z + dz) + .5, y = w.nav.floorY(Math.floor(x), Math.floor(z));
    if (y >= 0 && Math.abs(y - target.y) <= 0.6 && w.nav.walkCost(Math.floor(x), Math.floor(z)) < 3
      && w.grid.lineOfSight({ ...target, y: target.y + 0.8 }, { x, y: y + 1.5, z }, gap + 3)) {
      body.pos = { x, y, z }; body.yaw = Math.atan2(-(target.x - x), -(target.z - z)); return true;
    }
  }
  return false;
}
function world() {
  const s = new BridgeSession(918271, { playable: true });
  const w = s.world, player = w.person(w.playerId!)!, pb = w.primaryBody(player.id)!;
  const boars = w.creatures().filter(c => c.species === 'woodland_boar') as Creature[];
  const sow = boars.find(b => b.wildlife!.sex === 'female' && boars.some(y => y.wildlife!.parentIds.includes(b.id)))!;
  const boar = boars.find(b => b.wildlife!.sex === 'male' && !b.wildlife!.parentIds.length)!;
  return { s, w, player, pb, sow, sb: w.primaryBody(sow.id)!, boar, bb: w.primaryBody(boar.id)! };
}
let seq = 0;
const say = (s: BridgeSession, m: Record<string, unknown>) => s.intent({ version: 1, sequence: ++seq, ...m });
function talkAndChoose(s: BridgeSession, targetBodyId: string, pick: (labels: string[]) => number): string[] {
  expect(say(s, { type: 'talk', targetBodyId }).result).toBe('accepted');
  const menu = s.snapshot(false).dialogue!;
  const i = pick(menu.options.map(o => o.label));
  expect(i, menu.options.map(o => o.label).join(' | ')).toBeGreaterThanOrEqual(0);
  expect(say(s, { type: 'dialogue_option', optionId: menu.options[i].id }).result).toBe('accepted');
  return s.snapshot(false).dialogue?.lines ?? [];
}
const modeOf = (c: Creature, b: Body) => c.wildlife!.embodiments[b.id].defense?.mode;
/** A person near the sow with silver, not a veil keeper. */
function villagerNear(w: W, player: Person, at: Vec3) {
  return w.livingPersons().filter(p => p.id !== player.id && p.age > 20 && p.wealth >= 15 && !knowsVeil(p))
    .sort((a, b) => w.distance2d(w.positionOf(a.id)!, at) - w.distance2d(w.positionOf(b.id)!, at))[0];
}
/** Put a person in the sow's way until they hold a safety concern about her. */
function menaced(s: BridgeSession, w: W, victim: Person, sow: Creature, sb: Body) {
  const vb = w.primaryBody(victim.id)!;
  expect(standBeside(w, vb, sb.pos, 2.5)).toBe(true);
  for (let i = 0; i < 20 && !victim.mind.concerns?.some(c => c.kind === 'safety' && c.aboutId === sow.id); i++) stepFor(s, 1);
}

describe('boar encounter and protection loop — separate hard checks', () => {
  it('evasion: stepping out of a committed charge makes it miss and leaves the person unhurt', () => {
    const { s, w, player, pb, boar, bb } = world();
    expect(standBeside(w, pb, bb.pos, 3)).toBe(true);
    const health = pb.health;
    // Stand ground until the boar commits to a strike, then sprint perpendicular to its line.
    let side: { x: number; z: number } | null = null, strikes = 0;
    stepFor(s, 6, () => {
      if (!side && modeOf(boar, bb) === 'strike') {
        const d = { x: pb.pos.x - bb.pos.x, z: pb.pos.z - bb.pos.z }, l = Math.hypot(d.x, d.z) || 1;
        const a = { x: -d.z / l, z: d.x / l }, b = { x: -a.x, z: -a.z };
        const clear = (v: { x: number; z: number }) => w.nav.walkCost(Math.floor(pb.pos.x + v.x * 2), Math.floor(pb.pos.z + v.z * 2)) < 3;
        side = clear(a) ? a : b; strikes++;
      }
      if (side && strikes === 1) say(s, { type: 'move', x: side.x, z: side.z, sprint: true });
      if (side && modeOf(boar, bb) === 'recover') strikes++;
    });
    expect(side).not.toBeNull();
    expect(w.events.some(e => e.type === 'attack_missed' && e.actor === boar.id && e.data.targetBodyId === pb.id)).toBe(true);
    expect(w.events.some(e => e.type === 'attack' && e.actor === boar.id && e.target === player.id)).toBe(false);
    expect(pb.health).toBe(health);
  }, 120_000);

  it('contact and injury: a boar that is pressed charges, strikes the actual body and injures it', () => {
    const { s, w, player, pb, boar, bb } = world();
    expect(standBeside(w, pb, bb.pos, 5)).toBe(true);
    stepFor(s, 0.5);
    expect(modeOf(boar, bb)).toBe('warn');
    expect(w.events.some(e => e.type === 'animal_threat_display' && e.actor === boar.id && e.target === player.id)).toBe(true);
    const health = pb.health;
    stepFor(s, 8, () => { const d = { x: bb.pos.x - pb.pos.x, z: bb.pos.z - pb.pos.z }, l = Math.hypot(d.x, d.z) || 1; if (l > 1.6) say(s, { type: 'move', x: d.x / l, z: d.z / l, sprint: false }); });
    const gore = w.events.find(e => e.type === 'attack' && e.actor === boar.id && e.target === player.id);
    expect(gore?.data.targetBodyId).toBe(pb.id);
    expect(pb.health).toBeLessThan(health);
    expect(Object.keys(pb.injuries ?? {}).length).toBeGreaterThan(0);
    expect(player.alive).toBe(true);
  }, 120_000);

  it('kill: armed low strikes through the client command queue bring a boar down; its carcass remains and the kill is hunting practice', () => {
    const { s, w, player, pb } = world();
    // Boars keep company; one person with a knife picks the adult furthest from any other and
    // comes at it from the far side (a sounder of four is a different, much worse, proposition).
    const adults = w.creatures().filter(c => c.species === 'woodland_boar' && !c.wildlife!.parentIds.length) as Creature[];
    const isolation = (c: Creature) => Math.min(...adults.filter(o => o !== c).map(o => w.distance2d(w.primaryBody(o.id)!.pos, w.primaryBody(c.id)!.pos)));
    const boar = [...adults].sort((a, b) => isolation(b) - isolation(a))[0], bb = w.primaryBody(boar.id)!;
    const nearest = adults.filter(o => o !== boar).map(o => w.primaryBody(o.id)!.pos).sort((a, b) => w.distance2d(a, bb.pos) - w.distance2d(b, bb.pos))[0];
    const away = { x: bb.pos.x - nearest.x, y: bb.pos.y, z: bb.pos.z - nearest.z }, al = Math.hypot(away.x, away.z) || 1;
    const knife = makeItem(w, 'dagger', 'hunting knife', { owner: player.id, holder: player.id }); player.inventory.push(knife.id);
    const binding = s.bindInteraction('hunt-test'); let n = 0;
    const command = (c: Record<string, unknown>) => s.receiveCommand({ version: 2, type: 'command', ...binding, sequence: ++n, commandId: `hunt:${n}`, clientTimeMs: n * 16, command: c }, n * 16);
    expect(standBeside(w, pb, { x: bb.pos.x + away.x / al * 0.8, y: bb.pos.y, z: bb.pos.z + away.z / al * 0.8 }, 1.4)).toBe(true);
    const healthBefore = pb.health;
    const high = w.events.length;
    // A standing man's high blow passes over a boar's back.
    command({ type: 'attack', trajectory: 'high', targetBodyId: bb.id }); stepFor(s, 1.2);
    expect(w.events.slice(high).some(e => e.type === 'attack' && e.actor === player.id && e.target === boar.id)).toBe(false);
    // Trading blows loses. Tactics: sidestep its committed strike, cut low while it recovers,
    // and run it down when, badly hurt, it breaks off.
    let last = '', dodges = 0;
    for (let t = 0; t < 180 * 60 && !bb.dead; t++) {
      const m = modeOf(boar, bb) ?? 'none', d = { x: bb.pos.x - pb.pos.x, z: bb.pos.z - pb.pos.z }, l = Math.hypot(d.x, d.z) || 1, facing = Math.atan2(-d.x, -d.z);
      if (m !== last && m === 'strike') command({ type: 'defend', kind: 'sidestep', side: dodges++ % 2 ? 1 : -1 });
      last = m;
      const idle = !pb.combatAction || pb.combatAction.phase === 'complete';
      if (idle && m !== 'strike' && (m === 'recover' || m === 'retreat' || m === 'none')) {
        if (l > 1.4) command({ type: 'move', x: d.x / l, z: d.z / l, sprint: true, facing });
        else command({ type: 'attack', trajectory: 'low', targetBodyId: bb.id });
      } else if (idle && t % 6 === 0) command({ type: 'move', x: 0, z: 0, sprint: false, facing });
      s.stepInteraction(n * 16);
    }
    expect(dodges).toBeGreaterThan(0);
    expect(w.events.some(e => e.type === 'attack_missed' && e.actor === boar.id)).toBe(true);
    expect(bb.dead).toBe(true);
    expect(pb.health).toBeGreaterThan(healthBefore * 0.4); // timing, not trading blows, won it
    expect(bb.present).toBe(true); // a carcass, not a vanished entity
    expect(boar.wildlife!.embodiments[bb.id].deathCause).toBe('killed');
    const kill = w.events.find(e => e.type === 'kill' && e.actor === player.id && e.target === boar.id)!;
    expect(kill.data.capabilityCredits?.[player.id]).toBeGreaterThan(0);
    expect(player.capability?.bySkill.hunting?.effectiveSeconds ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it('butchering: needs a blade, yields species-tagged meat, removes the carcass and is hunting practice', () => {
    const { s, w, player, pb, boar, bb } = world();
    expect(standBeside(w, pb, bb.pos, 1.2)).toBe(true);
    // The kill itself is proven above; here it is a disclosed fixture blow through applyHit.
    for (let i = 0; i < 20 && !bb.dead; i++) s.sim.applyHit(player, pb, bb, 30, 'kill');
    expect(bb.dead && bb.present).toBe(true);
    standBeside(w, pb, bb.pos, 1.2); s.stepInteraction();
    expect(say(s, { type: 'interact', interactionId: `butcher:${bb.id}` }).result).toBe('missing_tool');
    const knife = makeItem(w, 'dagger', 'knife', { owner: player.id, holder: player.id }); player.inventory.push(knife.id);
    const hunting = player.capability?.bySkill.hunting?.effectiveSeconds ?? 0;
    expect(say(s, { type: 'interact', interactionId: `butcher:${bb.id}` }).result).toBe('accepted');
    const meat = player.inventory.map(id => w.item(id)!).find(i => i.type === 'meat')!;
    expect(meat.tags).toEqual(expect.arrayContaining(['species:woodland_boar', `from:${boar.id}`]));
    expect(meat.quantity).toBe(7); // 70 kg of boar
    expect(bb.present).toBe(false);
    expect(w.events.some(e => e.type === 'butchered' && e.actor === player.id && e.data.killedBySelf === true)).toBe(true);
    expect(player.capability!.bySkill.hunting!.effectiveSeconds).toBeGreaterThan(hunting);
    expect(say(s, { type: 'interact', interactionId: `butcher:${bb.id}` }).result).toBe('out_of_reach');
  }, 120_000);

  it('concern and request: a person the sow goes for forms a safety concern and, having silver, puts some up', () => {
    const { s, w, player, sow, sb } = world();
    const victim = villagerNear(w, player, sb.pos);
    menaced(s, w, victim, sow, sb);
    const concern = victim.mind.concerns!.find(c => c.kind === 'safety' && c.aboutId === sow.id)!;
    expect(concern.intensity).toBeGreaterThan(0);
    // The danger was perceived by the victim, not read from canonical state by anyone else.
    expect(w.livingPersons().filter(p => p.id !== victim.id && p.mind.concerns?.some(c => c.aboutId === sow.id)).every(p => w.events.some(e => e.actor === sow.id && e.perceivedBy.some(x => x.who === p.id)))).toBe(true);
    const wealth = victim.wealth;
    stepFor(s, 130);
    const r = w.requests.find(q => q.type === 'protection' && q.requesterId === victim.id)!;
    expect(r.status).toBe('open');
    expect(r.payload.creatureId).toBe(sow.id);
    expect(r.reward).toBe(Math.max(4, Math.min(30, Math.round(wealth * 0.3))));
    expect(victim.wealth).toBe(wealth); // offered, not yet paid
  }, 180_000);

  it('learning the hush: the keeper teaches through dialogue for a fee they actually receive, with provenance', () => {
    const { s, w, player, pb } = world();
    const keeper = w.livingPersons().find(knowsVeil)!, kb = w.primaryBody(keeper.id)!;
    if (kb.pose === 'sleep') kb.pose = 'stand';
    standBeside(w, pb, kb.pos, 1.5); stepFor(s, 0.5);
    const total = player.wealth + keeper.wealth;
    talkAndChoose(s, kb.id, l => l.findIndex(x => x.startsWith('Teach me the hush')));
    expect(knowsVeil(player)).toBe(true);
    expect(player.wealth + keeper.wealth).toBe(total);
    const k = player.knowledge['technique:veilcraft'];
    expect(k.source.from ?? w.event(k.source.viaEvent!)?.actor).toBe(keeper.id);
    expect(w.event(k.source.viaEvent!)).toBeTruthy();
    // Once learned, it is not offered again.
    expect(say(s, { type: 'dialogue_close' }).result).toBe('accepted');
    expect(say(s, { type: 'talk', targetBodyId: kb.id }).result).toBe('accepted');
    expect(s.snapshot(false).dialogue!.options.some(o => o.label.startsWith('Teach me the hush'))).toBe(false);
  }, 120_000);

  it('hush resolution: a requester who sees the sow stilled settles as knew_it_stilled; silver is conserved', () => {
    const { s, w, player, pb, sow, sb } = world();
    const victim = villagerNear(w, player, sb.pos), vb = w.primaryBody(victim.id)!;
    menaced(s, w, victim, sow, sb); stepFor(s, 130);
    const r = w.requests.find(q => q.type === 'protection' && q.requesterId === victim.id)!;
    expect(r.status).toBe('open');
    const keeper = w.livingPersons().find(knowsVeil)!, kb = w.primaryBody(keeper.id)!; if (kb.pose === 'sleep') kb.pose = 'stand';
    standBeside(w, pb, kb.pos, 1.5); stepFor(s, 0.5);
    talkAndChoose(s, kb.id, l => l.findIndex(x => x.startsWith('Teach me the hush'))); say(s, { type: 'dialogue_close' });
    standBeside(w, pb, vb.pos, 1.5); stepFor(s, 0.5);
    talkAndChoose(s, vb.id, l => l.indexOf('Any work going?'));
    const menu = s.snapshot(false).dialogue!;
    const deal = menu.options.findIndex(o => o.label.startsWith(`Deal with the ${w.nameOf(sow.id)}`));
    expect(say(s, { type: 'dialogue_option', optionId: menu.options[deal].id }).result).toBe('accepted');
    expect(r.acceptedBy).toBe(player.id); say(s, { type: 'dialogue_close' });
    // The requester watches from a little way off while the player reaches for the sow.
    expect(standBeside(w, pb, sb.pos, 6)).toBe(true);
    const watch = () => { standBeside(w, vb, pb.pos, 2); vb.yaw = Math.atan2(-(sb.pos.x - vb.pos.x), -(sb.pos.z - vb.pos.z)); };
    watch();
    let result = '';
    let attempts = 0;
    for (let i = 0; i < 30 && result !== 'calmed'; i++) {
      result = say(s, { type: 'hush', targetBodyId: sb.id }).result; if (result === 'calmed' || result === 'resisted') attempts++;
      // Strain recovers over lived time (0.35 per world hour): rest ten physical minutes when spent.
      stepFor(s, result === 'too_strained' ? 600 : result === 'calmed' ? 0.5 : 7); if (result !== 'calmed') { standBeside(w, pb, sb.pos, 6); watch(); }
    }
    expect(attempts).toBeGreaterThan(0);
    expect(result).toBe('calmed');
    stepFor(s, 1);
    expect(believesStilled(w, victim, sow.id)).toBe(true);
    const total = player.wealth + victim.wealth;
    standBeside(w, pb, vb.pos, 1.5); stepFor(s, 0.5);
    const lines = talkAndChoose(s, vb.id, l => l.findIndex(x => x.startsWith(`About the ${w.nameOf(sow.id)}`)));
    expect(lines.join(' ')).toMatch(/quiet/);
    expect(r.status).toBe('completed');
    expect(r.payload.settledBy).toBe('knew_it_stilled');
    expect(player.wealth + victim.wealth).toBe(total);
    expect(sw(sow, sb).avoid!.until).toBeGreaterThan(w.physicalTime); // alive, keeping away for now
  }, 300_000);

  it('trust: payment on a word that proves false is exposed when the same animal strikes again', () => {
    const { s, w, player, pb, sow, sb } = world();
    const victim = villagerNear(w, player, sb.pos), vb = w.primaryBody(victim.id)!;
    menaced(s, w, victim, sow, sb); stepFor(s, 130);
    const r = w.requests.find(q => q.type === 'protection' && q.requesterId === victim.id)!;
    // Disclosed fixture: a prior acquaintance trusting enough to take the player's word.
    getRel(victim, player.id).trust = 0.5;
    standBeside(w, pb, vb.pos, 1.5); stepFor(s, 0.5);
    talkAndChoose(s, vb.id, l => l.indexOf('Any work going?'));
    const menu = s.snapshot(false).dialogue!;
    say(s, { type: 'dialogue_option', optionId: menu.options[menu.options.findIndex(o => o.label.startsWith('Deal with'))].id }); say(s, { type: 'dialogue_close' });
    talkAndChoose(s, vb.id, l => l.findIndex(x => x.startsWith(`About the ${w.nameOf(sow.id)}`)));
    expect(r.payload.settledBy).toBe('took_word');
    const trust = getRel(victim, player.id).trust;
    say(s, { type: 'dialogue_close' });
    // The sow, alive and unhushed, goes for the requester again.
    stepFor(s, 30);
    menaced(s, w, victim, sow, sb); stepFor(s, 130);
    maintainProtectionRequests(w);
    expect(r.payload.exposed).toBe(true);
    expect(getRel(victim, player.id).trust).toBeLessThan(trust - 0.3);
  }, 300_000);

  it('save and reload keep the request, the concern, the learned technique, veil strain and the carcass', () => {
    const { s, w, player, pb, sow, sb, boar, bb } = world();
    const victim = villagerNear(w, player, sb.pos);
    menaced(s, w, victim, sow, sb); stepFor(s, 130);
    const r = w.requests.find(q => q.type === 'protection' && q.requesterId === victim.id)!;
    const keeper = w.livingPersons().find(knowsVeil)!, kb = w.primaryBody(keeper.id)!; if (kb.pose === 'sleep') kb.pose = 'stand';
    standBeside(w, pb, kb.pos, 1.5); stepFor(s, 0.5);
    talkAndChoose(s, kb.id, l => l.findIndex(x => x.startsWith('Teach me the hush'))); say(s, { type: 'dialogue_close' });
    standBeside(w, pb, sb.pos, 6); say(s, { type: 'hush', targetBodyId: sb.id }); s.stepInteraction();
    for (let i = 0; i < 20 && !bb.dead; i++) s.sim.applyHit(player, pb, bb, 30, 'kill');
    const s2 = new BridgeSession(918271, { playable: true, save: s.save() }), w2 = s2.world;
    const p2 = w2.person(player.id)!, v2 = w2.person(victim.id)!;
    expect(w2.requests.find(q => q.id === r.id)).toMatchObject({ status: r.status, reward: r.reward, requesterId: victim.id });
    expect(v2.mind.concerns?.some(c => c.kind === 'safety' && c.aboutId === sow.id)).toBe(true);
    expect(knowsVeil(p2)).toBe(true);
    expect(p2.veil).toEqual(player.veil);
    expect(veilStrain(w2, p2)).toBeCloseTo(veilStrain(w, player), 6);
    const carcass = w2.body(bb.id)!;
    expect(carcass.dead && carcass.present).toBe(true);
    expect(w2.creatures().find(c => c.id === boar.id)?.wildlife?.embodiments[bb.id].deathCause).toBe('killed');
    expect(p2.wealth).toBe(player.wealth);
  }, 300_000);
});
const sw = (c: Creature, b: Body) => c.wildlife!.embodiments[b.id];
