import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v, type TestWorld } from './helpers/world';
import { learn, eventClaim } from '../src/sim/mind/knowledge';
import { learnIdentity } from '../src/sim/mind/people';
import { makeCreature, makeItem } from '../src/sim/world/factory';
import { acceptProtection } from '../src/sim/social/protection';
import { completeRequest, createRequest } from '../src/sim/core/requests';
import { resolveConflict } from '../src/sim/social/conflict';
import { agreeCombatTrial } from '../src/sim/social/combatTrial';
import { performContainerTransfer } from '../src/sim/physical/hand';
import { serialize } from '../src/sim/persist/save';
import { observeJohnSmith, applyJohnSmithCommand, johnSmithView, ensureJohnSmith, restoreJohnSmith, parseJohnSmithCommand } from '../src/sim/orchestrator';
import { cacheContents, grantCache, nextCacheIndex } from '../src/sim/orchestrator/reserve';
import { holderRecord, mark, MAX_OPEN_QUESTS, MAX_QUESTS, reconcileReserve, reserveStatus } from '../src/sim/orchestrator/state';
import { RNG } from '../src/sim/core/rng';
import { RESERVE_STOCK, type Quest } from '../src/sim/orchestrator/types';
import { FEATS } from '../src/sim/orchestrator/feats';
import type { Person } from '../src/sim/core/types';

/** One watch pass a second of physical time, exactly as the host's controller step runs it. */
function pass(tw: TestWorld, seconds = 1.1): void { tw.world.physicalTime += seconds; tw.world.clock.advance(seconds); observeJohnSmith(tw.world); }
const quests = (tw: TestWorld, p: Person) => holderRecord(tw.world.johnSmith!, p.id).quests;
const quest = (tw: TestWorld, p: Person, kind: Quest['kind']) => quests(tw, p).find(q => q.kind === kind);
function witness(tw: TestWorld, p: Person, eventId: string, saw = true) {
  const e = tw.world.event(eventId)!;
  learn(tw.world, p, { key: `ev:${e.id}`, kind: 'event', claim: eventClaim(tw.world, e, saw), confidence: 1, source: { type: saw ? 'witnessed' : 'heard' } }, true);
}
function world(seed = 4401) {
  const tw = createTestWorld(seed, 40);
  const player = addPerson(tw, 'Traveller', 'traveler', v(10, 1, 10), { controlled: true });
  return { tw, player };
}

describe('John Smith watches history without changing it', () => {
  it('starts at the end of history: earlier deeds are never rewarded retroactively', () => {
    const { tw, player } = world();
    const npc = addPerson(tw, 'Wren', 'farmer', v(12, 1, 10));
    for (let i = 0; i < 3; i++) tw.world.emit('gift', { actor: player.id, target: npc.id, significance: .5, summary: 'old gift' });
    pass(tw);
    expect(tw.world.johnSmith!.ledgers[player.id]?.counts.gifts).toBeUndefined();
    expect(Object.keys(tw.world.johnSmith!.ledgers[player.id]?.feats ?? {})).toEqual([]);
    tw.world.emit('gift', { actor: player.id, target: npc.id, significance: .5, summary: 'new gift' });
    pass(tw);
    expect(tw.world.johnSmith!.ledgers[player.id].counts.gifts).toBe(1);
    expect(tw.world.johnSmith!.ledgers[player.id].feats.generous).toBeDefined();
  });

  it('applies the same feats to every person, but delivers caches and notices only through the interface', () => {
    const { tw, player } = world();
    const giver = addPerson(tw, 'Bran', 'farmer', v(12, 1, 10)), friend = addPerson(tw, 'Ilse', 'farmer', v(13, 1, 10));
    pass(tw);
    tw.world.emit('gift', { actor: giver.id, target: friend.id, significance: .5 });
    tw.world.emit('gift', { actor: player.id, target: friend.id, significance: .5 });
    pass(tw);
    const s = tw.world.johnSmith!;
    expect(s.ledgers[giver.id].feats.generous).toBeDefined();
    expect(s.ledgers[player.id].feats.generous).toBeDefined();
    expect(s.caches.filter(c => c.recipientId === giver.id)).toEqual([]);
    expect(s.caches.filter(c => c.recipientId === player.id && c.reason === 'feat:generous')).toHaveLength(1);
    expect(s.holders[giver.id]).toBeUndefined();
    expect(holderRecord(s, player.id).notices.some(n => n.kind === 'feat' && n.title === 'Generosity Detected')).toBe(true);
  });

  it('credits a creature\'s knockdown to the creature and files it as the holder\'s own hard experience', () => {
    const { tw, player } = world();
    const boar = makeCreature(tw.world, 'boar', 'woodland boar', null, null);
    pass(tw);
    const gore = tw.world.emit('attack', { actor: boar.id, target: player.id, significance: .6, data: { creature: true, impact: 30, intent: 'drive_off' } });
    tw.world.emit('downed', { actor: player.id, target: boar.id, causes: [gore.id], significance: .5, data: { by: boar.id, species: 'boar' } });
    pass(tw);
    const s = tw.world.johnSmith!;
    expect(s.ledgers[boar.id].counts).toEqual(expect.objectContaining({ blows: 1, downs: 1 }));
    expect(s.ledgers[player.id].counts.downs).toBeUndefined();
    expect(s.ledgers[player.id].counts.blowsTaken).toBe(1);
    expect(holderRecord(s, player.id).archive.at(-1)!.text).toBe('Knocked down by the woodland boar.');
  });

  it('never draws from the world random stream and adds nothing to anyone\'s significance', () => {
    const { tw, player } = world();
    const npc = addPerson(tw, 'Wren', 'farmer', v(12, 1, 10));
    pass(tw);
    const rng = tw.world.rng.state(), significance = new Map(tw.world.historicalSignificance);
    const s = ensureJohnSmith(tw.world);
    for (let i = 0; i < 5; i++) grantCache(tw.world, s, player, i % 3, `test:${i}`);
    pass(tw); pass(tw);
    expect(tw.world.rng.state()).toBe(rng);
    expect(new Map(tw.world.historicalSignificance)).toEqual(significance);
    const acts = tw.world.events.filter(e => e.type === 'orchestrator');
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every(e => !e.actor && !e.target && !e.pos && !e.visibility && !e.loudness)).toBe(true);
    void npc;
  });

  it('keeps holders at least Noted, raises attention by thresholds and names only people the holder knows', () => {
    const { tw, player } = world();
    const known = addPerson(tw, 'Mara Wren', 'smith', v(14, 1, 10)), stranger = addPerson(tw, 'Hidden Name', 'farmer', v(15, 1, 10));
    pass(tw); pass(tw, 2.1);
    expect(tw.world.johnSmith!.attention[player.id].tier).toBe(1);
    const intro = tw.world.emit('introduction', { actor: known.id, target: player.id, data: { claimedName: 'Mara Wren' } });
    learnIdentity(tw.world, player, known.id, 'Mara Wren', { type: 'told', from: known.id, viaEvent: intro.id }, 1);
    for (const p of [known, stranger]) for (let i = 0; i < 12; i++) tw.world.emit('heal', { actor: p.id, target: player.id, significance: 1 });
    pass(tw, 2.1);
    const s = tw.world.johnSmith!;
    expect(s.attention[known.id].tier).toBeGreaterThanOrEqual(2);
    expect(s.attention[stranger.id].tier).toBeGreaterThanOrEqual(2);
    const view = johnSmithView(tw.world, player.id)!;
    expect(view.watch.known.map(k => k.name)).toContain('Mara Wren');
    expect(JSON.stringify(view)).not.toContain('Hidden Name');
    expect(view.watch.beyond).toBeGreaterThanOrEqual(1);
  });
});

describe('emergent quests come only from what the holder knows', () => {
  it('recognizes a wanted item only after being told, points only where the holder believes, and settles on the real return', () => {
    const { tw, player } = world();
    const owner = addPerson(tw, 'Cedric', 'farmer', v(12, 1, 10));
    const ring = makeItem(tw.world, 'ring', "Cedric's ring", { owner: owner.id, pos: v(30, 1, 30) });
    owner.desires.push({ type: 'recover_item', targetId: ring.id, note: 'lost', reward: 12, fulfilled: false }); owner.wealth = 50;
    pass(tw);
    expect(quest(tw, player, 'recover')).toBeUndefined();
    learn(tw.world, player, { key: `wanted:${ring.id}`, kind: 'fact', claim: { wantedItem: true, itemId: ring.id, requesterId: owner.id, reward: 12 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    pass(tw);
    let q = quest(tw, player, 'recover')!;
    expect(q.title).toBe(`Recover Cedric's ring for an unfamiliar person`);
    expect(q.target).toBeUndefined();
    expect(q.objectives.map(o => o.done)).toEqual([false, false, false]);
    learn(tw.world, player, { key: `loc:${ring.id}`, kind: 'location', claim: { entityId: ring.id, pos: { x: 30, y: 1, z: 30 } }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    pass(tw);
    q = quest(tw, player, 'recover')!;
    expect(q.target?.pos).toEqual({ x: 30, y: 1, z: 30 });
    expect(q.objectives[0].done).toBe(true);
    tw.sim.takeItem(player, ring, 'pickup');
    pass(tw);
    expect(quest(tw, player, 'recover')!.objectives[1].done).toBe(true);
    const wealth = owner.wealth;
    tw.sim.giveItem(player, owner, ring);
    pass(tw);
    q = quest(tw, player, 'recover')!;
    expect(q.status).toBe('completed');
    expect(q.cacheId).toMatch(/^veil-cache:silver:/);
    expect(owner.wealth).toBeLessThan(wealth);
  });

  it('withdraws a recovery the holder knows is moot, without consulting canonical life', () => {
    const { tw, player } = world();
    const owner = addPerson(tw, 'Cedric', 'farmer', v(12, 1, 10)), killer = addPerson(tw, 'Brann', 'bandit', v(13, 1, 10));
    const ring = makeItem(tw.world, 'ring', 'old ring', { owner: owner.id, pos: v(30, 1, 30) });
    learn(tw.world, player, { key: `wanted:${ring.id}`, kind: 'fact', claim: { itemId: ring.id, requesterId: owner.id, reward: 5 }, confidence: 1, source: { type: 'told', from: owner.id } }, true);
    pass(tw);
    tw.world.markPersonDead(owner);
    pass(tw);
    expect(quest(tw, player, 'recover')!.status).toBe('open');
    const death = tw.world.emit('kill', { actor: killer.id, target: owner.id, significance: 1 });
    witness(tw, player, death.id);
    pass(tw);
    expect(quest(tw, player, 'recover')!.status).toBe('moot');
  });

  it('tracks the holder\'s own stolen property until it is back in their hands', () => {
    const { tw, player } = world();
    const thief = addPerson(tw, 'Ash', 'bandit', v(12, 1, 10));
    const knife = makeItem(tw.world, 'dagger', 'grandmother\'s knife', { owner: player.id, holder: player.id });
    pass(tw);
    const theft = tw.sim.takeItem(thief, knife, 'theft', player.id);
    witness(tw, player, theft.id);
    pass(tw);
    const q = quest(tw, player, 'reclaim')!;
    expect(q.title).toBe(`Recover your grandmother's knife`);
    expect(q.summary).toContain('an unfamiliar person');
    tw.sim.giveItem(thief, player, knife);
    pass(tw);
    expect(quest(tw, player, 'reclaim')!.status).toBe('completed');
  });

  it('settles a welfare worry only by the holder\'s own sight of the person, well', () => {
    const { tw, player } = world();
    const friend = addPerson(tw, 'Ilse', 'farmer', v(25, 1, 25));
    player.mind.concerns = [{ id: 'cn_test', kind: 'welfare', subjectId: friend.id, basisKeys: [], intensity: .8, createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'active', reasons: ['I saw her struck down.'] }];
    pass(tw);
    expect(quest(tw, player, 'tend')!.status).toBe('open');
    const body = tw.world.primaryBody(friend.id)!; body.health = body.maxHealth;
    pass(tw);
    expect(quest(tw, player, 'tend')!.status).toBe('open');
    player.mind.percepts = [{ entityId: friend.id, bodyId: body.id, how: 'saw', tick: tw.world.now, pos: { ...body.pos }, distance: 4 }];
    pass(tw);
    expect(quest(tw, player, 'tend')!.status).toBe('completed');
    expect(quest(tw, player, 'tend')!.cacheId).toMatch(/^veil-cache:bronze:/);
    expect(quests(tw, player).filter(q => q.kind === 'tend')).toHaveLength(1);
  });

  it('closes a worry about harm the holder caused without counting or paying for it', () => {
    const { tw, player } = world();
    const friend = addPerson(tw, 'Ilse', 'farmer', v(12, 1, 10));
    pass(tw);
    const blow = tw.sim.applyHit(player, tw.world.primaryBody(player.id)!, tw.world.primaryBody(friend.id)!, 2, 'injure')!;
    learn(tw.world, player, { key: `ev:${blow.id}`, kind: 'event', claim: eventClaim(tw.world, blow, true), confidence: 1, source: { type: 'witnessed' } }, true);
    player.mind.concerns = [{ id: 'cn_own', kind: 'welfare', subjectId: friend.id, basisKeys: [`ev:${blow.id}`], intensity: .8, createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'active', reasons: ['I hit her.'] }];
    pass(tw);
    const body = tw.world.primaryBody(friend.id)!; body.health = body.maxHealth;
    player.mind.percepts = [{ entityId: friend.id, bodyId: body.id, how: 'saw', tick: tw.world.now, pos: { ...body.pos }, distance: 2 }];
    const settled = tw.world.johnSmith!.ledgers[player.id]?.counts.questsCompleted ?? 0;
    pass(tw);
    const q = quest(tw, player, 'tend')!;
    expect(q.status).toBe('completed');
    expect(q.cacheId).toBeUndefined();
    expect(q.outcome?.text).toContain('Not by your hand');
    expect(tw.world.johnSmith!.ledgers[player.id]?.counts.questsCompleted ?? 0).toBe(settled);
  });

  it('asks for justice only after a witnessed wrong, and closes it only when the holder learns it was answered for', () => {
    const { tw, player } = world();
    const thief = addPerson(tw, 'Ash', 'bandit', v(12, 1, 10)), victim = addPerson(tw, 'Wren', 'farmer', v(13, 1, 10)), guard = addPerson(tw, 'Captain', 'guard', v(14, 1, 10));
    const purse = makeItem(tw.world, 'ring', 'purse ring', { owner: victim.id, holder: victim.id });
    pass(tw);
    const theft = tw.sim.takeItem(thief, purse, 'theft', victim.id);
    pass(tw);
    expect(quest(tw, player, 'justice')).toBeUndefined();
    witness(tw, player, theft.id);
    pass(tw);
    expect(quest(tw, player, 'justice')!.title).toBe('Justice for an unfamiliar person');
    const arrest = tw.world.emit('entity_arrested', { actor: guard.id, target: thief.id, significance: .75, category: 'history' });
    pass(tw);
    expect(quest(tw, player, 'justice')!.status).toBe('open');
    witness(tw, player, arrest.id, false);
    pass(tw);
    const answered = quest(tw, player, 'justice')!;
    expect(answered.status).toBe('completed');
    // Somebody else made the arrest: closed, but not the holder's deed and not paid for.
    expect(answered.cacheId).toBeUndefined();
    expect(answered.outcome?.text).toContain('Not by your hand');
    expect(tw.world.johnSmith!.ledgers[player.id]?.counts.questsCompleted ?? 0).toBe(0);
    // A second wrong, answered by the holder themselves: they know their own act without hearing of it.
    const cutpurse = addPerson(tw, 'Rook', 'bandit', v(15, 1, 10)), coin = makeItem(tw.world, 'ring', 'coin ring', { owner: victim.id, holder: victim.id });
    const second = tw.sim.takeItem(cutpurse, coin, 'theft', victim.id);
    witness(tw, player, second.id);
    pass(tw);
    const own = quests(tw, player).find(q => q.kind === 'justice' && q.status === 'open')!;
    expect(own).toBeDefined();
    tw.world.emit('entity_arrested', { actor: player.id, target: cutpurse.id, significance: .75, category: 'history' });
    pass(tw);
    expect(own.status).toBe('completed');
    expect(own.cacheId).toMatch(/^veil-cache:silver:/);
  });

  it('treats blows inside one agreed combat trial as consent, not a grievance', () => {
    const { tw, player } = world();
    const rival = addPerson(tw, 'Warden', 'traveler', v(11, 1, 10));
    const source = tw.world.emit('tower_entered', { actor: player.id });
    agreeCombatTrial(tw.world, 'trial:test', [[player], [rival]], 'injure', source.id);
    pass(tw);
    const blow = tw.sim.applyHit(rival, tw.world.primaryBody(rival.id)!, tw.world.primaryBody(player.id)!, 5, 'injure')!;
    witness(tw, player, blow.id);
    pass(tw);
    expect(quest(tw, player, 'justice')).toBeUndefined();
    expect(quest(tw, player, 'fight')).toBeUndefined();
  });

  it('reads obligations and protection commitments the holder actually holds', () => {
    const { tw, player } = world();
    const helper = addPerson(tw, 'Oswin', 'farmer', v(12, 1, 10)), requester = addPerson(tw, 'Hale', 'farmer', v(13, 1, 10));
    requester.wealth = 40;
    player.mind.obligations = [{ id: 'ob_test', kind: 'was_helped', towardId: helper.id, magnitude: .5, createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'live', reasons: [] }];
    const r = createRequest(tw.world, { type: 'protection', requesterId: requester.id, reward: 9, cause: 'a boar went for me', payload: { creatureId: 'cr_none', species: 'boar', seenAt: { x: 30, y: 1, z: 5 } } });
    pass(tw);
    expect(quest(tw, player, 'protect')).toBeUndefined();
    expect(acceptProtection(tw.world, r, player)).toBe(true);
    pass(tw);
    const protect = quest(tw, player, 'protect')!;
    expect(protect.title).toBe('Deal with the boar for an unfamiliar person');
    expect(protect.target?.pos).toEqual({ x: 30, y: 1, z: 5 });
    expect(quest(tw, player, 'repay')!.status).toBe('open');
    player.mind.obligations[0].status = 'fulfilled';
    completeRequest(tw.world, r);
    pass(tw);
    expect(quest(tw, player, 'repay')!.status).toBe('completed');
    expect(quest(tw, player, 'protect')!.status).toBe('completed');
  });

  it('follows an unagreed fight to its end and rewards only the one who did not start it', () => {
    const { tw, player } = world();
    const brute = addPerson(tw, 'Brute', 'bandit', v(11, 1, 10));
    pass(tw);
    for (let i = 0; i < 2; i++) tw.sim.applyHit(brute, tw.world.primaryBody(brute.id)!, tw.world.primaryBody(player.id)!, 3, 'injure');
    pass(tw);
    const q = quest(tw, player, 'fight')!;
    expect(q.rewardTier).toBe(0);
    resolveConflict(tw.world, tw.world.conflicts.find(c => c.id === q.source.id)!, 'aggressor_fled');
    pass(tw);
    expect(quest(tw, player, 'fight')!.status).toBe('completed');
    expect(quest(tw, player, 'fight')!.outcome?.text).toBe('Your attacker fled.');
    expect(q.cacheId).toMatch(/^veil-cache:bronze:/);
    // The reserve pays for one matter of a kind per world day; the next fight that day settles unpaid.
    const fightOn = (name: string) => {
      const foe = addPerson(tw, name, 'bandit', v(11, 1, 11));
      for (let i = 0; i < 2; i++) { tw.sim.applyHit(foe, tw.world.primaryBody(foe.id)!, tw.world.primaryBody(player.id)!, 1, 'injure'); delete tw.world.primaryBody(foe.id)!.recoil; }
      pass(tw);
      const next = quests(tw, player).find(x => x.kind === 'fight' && x.status === 'open')!;
      expect(johnSmithView(tw.world, player.id)!.quests.find(x => x.id === next.id)!.rewardTierName).toBe(paid ? null : 'Bronze');
      resolveConflict(tw.world, tw.world.conflicts.find(c => c.id === next.source.id)!, 'aggressor_fled');
      pass(tw);
      return next;
    };
    let paid = true;
    const again = fightOn('Lout');
    expect(again.status).toBe('completed');
    expect(again.cacheId).toBeUndefined();
    expect(again.outcome?.text).toContain('already paid');
    pass(tw, 86400);
    paid = false;
    expect(fightOn('Thug').cacheId).toMatch(/^veil-cache:bronze:/);
  });

  it('never reopens a closed matter, lets stale ones fade and bounds the watch list', () => {
    const { tw, player } = world();
    const helper = addPerson(tw, 'Oswin', 'farmer', v(12, 1, 10));
    player.mind.obligations = [{ id: 'ob_a', kind: 'was_given', towardId: helper.id, magnitude: .5, createdAt: 0, lastReinforcedAt: 0, status: 'live', reasons: [] }];
    pass(tw);
    const q = quest(tw, player, 'repay')!;
    player.mind.obligations = [];
    pass(tw);
    expect(q.status).toBe('moot');
    player.mind.obligations = [{ id: 'ob_a', kind: 'was_given', towardId: helper.id, magnitude: .5, createdAt: 0, lastReinforcedAt: 0, status: 'live', reasons: [] }];
    pass(tw);
    expect(quests(tw, player).filter(x => x.key === 'repay:ob_a')).toHaveLength(1);
    expect(q.status).toBe('moot');
    // A worry with no fresh evidence fades after its kind's window.
    const friend = addPerson(tw, 'Ilse', 'farmer', v(30, 1, 30));
    player.mind.concerns = [{ id: 'cn_fade', kind: 'welfare', subjectId: friend.id, basisKeys: [], intensity: .8, createdAt: tw.world.now, lastReinforcedAt: tw.world.now, status: 'active', reasons: [] }];
    pass(tw);
    player.mind.concerns = [];
    tw.world.clock.worldSeconds += 3 * 86400;
    pass(tw);
    expect(quest(tw, player, 'tend')!.status).toBe('faded');
    expect(quests(tw, player).filter(x => (x.kind === 'tend' || x.kind === 'repay') && x.status === 'open')).toHaveLength(0);
  });

  it('honours watch and dismiss preferences without touching the matter itself', () => {
    const { tw, player } = world();
    for (let i = 0; i < 6; i++) { const o = addPerson(tw, `Helper ${i}`, 'farmer', v(12 + i, 1, 12)); (player.mind.obligations ??= []).push({ id: `ob_${i}`, kind: 'was_helped', towardId: o.id, magnitude: .4, createdAt: 0, lastReinforcedAt: 0, status: 'live', reasons: [] }); }
    pass(tw);
    const open = quests(tw, player).filter(q => q.kind === 'repay' && q.status === 'open');
    expect(open).toHaveLength(6);
    expect(open.filter(q => q.watched)).toHaveLength(0);
    const results = open.map(q => applyJohnSmithCommand(tw.world, player.id, { type: 'watch_quest', questId: q.id, watch: true }).result);
    expect(results).toEqual(['accepted', 'accepted', 'accepted', 'accepted', 'watch_limit', 'watch_limit']);
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'dismiss_quest', questId: open[0].id, dismiss: true }).result).toBe('accepted');
    expect(open[0].watched).toBe(false);
    expect(player.mind.obligations![0].status).toBe('live');
    const view = johnSmithView(tw.world, player.id)!;
    expect(view.quests.some(q => q.id === open[0].id)).toBe(false);
    expect(view.dismissed).toBe(1);
    expect(view.tracker).toHaveLength(3);
  });
});

describe('the finite reserve', () => {
  it('seals contents as a pure function of seed and cache id, with sources only in the top tiers', () => {
    expect(cacheContents(918271, 'veil-cache:gold:3', 2)).toEqual(cacheContents(918271, 'veil-cache:gold:3', 2));
    expect(cacheContents(918271, 'veil-cache:gold:3', 2)).not.toEqual(cacheContents(918271, 'veil-cache:gold:4', 2));
    for (let tier = 0; tier < 6; tier++) for (let n = 1; n <= Math.min(30, RESERVE_STOCK[tier]); n++) {
      const specs = cacheContents(7, `veil-cache:t${tier}:${n}`, tier);
      expect(specs.length).toBeGreaterThanOrEqual(2);
      if (tier < 4) expect(specs.some(s => s.source?.kind === 'essence')).toBe(false);
      if (tier < 3) expect(specs.some(s => s.source?.kind === 'book')).toBe(false);
      if (tier < 2) expect(specs.some(s => s.source)).toBe(false);
      for (const s of specs) {
        if (s.damage !== undefined) expect(s.damage).toBeLessThanOrEqual(Math.round(26 * 1.2));
        if (s.armor) expect(s.armor.absorption).toBeLessThanOrEqual(10);
        expect(s.type).not.toBe('coins');
      }
    }
    const celestial = cacheContents(7, 'veil-cache:celestial:1', 5);
    expect(celestial.filter(s => s.catalogId).length).toBeGreaterThanOrEqual(3);
    expect(celestial.some(s => s.source?.kind === 'essence')).toBe(true);
  });

  it('substitutes a spent tier downward and logs exhaustion instead of printing more', () => {
    const { tw, player } = world();
    pass(tw);
    const s = ensureJohnSmith(tw.world);
    const celestial = grantCache(tw.world, s, player, 5, 'test')!;
    expect(celestial.id).toBe('veil-cache:celestial:1');
    const next = grantCache(tw.world, s, player, 5, 'test')!;
    expect(next.tier).toBe(4); expect(next.requested).toBe(5);
    for (let tier = 0; tier < 6; tier++) while (nextCacheIndex(s, tier) !== null) grantCache(tw.world, s, player, tier, 'drain');
    expect(s.caches).toHaveLength(RESERVE_STOCK.reduce((a, b) => a + b, 0));
    expect(new Set(s.caches.map(c => c.id)).size).toBe(s.caches.length);
    expect(grantCache(tw.world, s, player, 3, 'too late')).toBeNull();
    expect(holderRecord(s, player.id).notices.at(-1)!.title).toBe('Reserve exhausted');
  });

  it('opens only at a safe moment, materializes canonical owned items with provenance, and folds the emptied coffer away', () => {
    const { tw, player } = world();
    pass(tw);
    const s = ensureJohnSmith(tw.world), cache = grantCache(tw.world, s, player, 2, 'test')!;
    const rival = addPerson(tw, 'Rival', 'bandit', v(11, 1, 10));
    tw.sim.applyHit(rival, tw.world.primaryBody(rival.id)!, tw.world.primaryBody(player.id)!, 2, 'injure');
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: cache.id }).result).toBe('unsafe:busy');
    delete tw.world.primaryBody(player.id)!.recoil;
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: cache.id }).result).toBe('unsafe:in_combat');
    expect(cache.openedAt).toBeUndefined();
    for (const c of tw.world.conflicts) resolveConflict(tw.world, c, 'withdrawal');
    tw.world.primaryBody(rival.id)!.pos = v(35, 1, 35);
    const before = tw.world.items().length, granted = s.caches.length;
    const opened = applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: cache.id });
    expect(opened.result).toBe('opened');
    expect(s.caches.length).toBe(granted); // the Unsealed recognition asks the reserve for nothing
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: cache.id }).result).toBe('already_opened');
    const items = opened.itemIds!.map(id => tw.world.item(id)!);
    expect(tw.world.items().length).toBe(before + items.length);
    expect(items).toEqual(cacheContents(tw.world.seed, cache.id, 2).map(spec => expect.objectContaining({ name: spec.name, type: spec.type, quantity: spec.quantity, ownerId: player.id })));
    for (const item of items) {
      expect(item.provenance[0]).toEqual(expect.objectContaining({ how: 'finite orchestrator reserve', to: player.id, eventId: cache.openEventId }));
      expect(item.tags).toContain(cache.id);
      expect(item.containerId).toBe(opened.cofferId);
    }
    const coffer = tw.world.container(opened.cofferId)!;
    pass(tw);
    const chore = holderRecord(s, player.id).quests.find(q => q.kind === 'coffer')!;
    expect(chore.status).toBe('open');
    const settled = s.ledgers[player.id].counts.questsCompleted ?? 0;
    const stranger = addPerson(tw, 'Pick', 'bandit', { ...coffer.pos! });
    expect(performContainerTransfer(tw.sim, stranger, coffer.id, items[0].id, 'out')).not.toBe('accepted');
    for (const item of items) expect(performContainerTransfer(tw.sim, player, coffer.id, item.id, 'out')).toBe('accepted');
    pass(tw);
    expect(coffer.pos).toBeNull();
    expect(cache.withdrawnAt).toBeDefined();
    // Emptying one's own coffer closes the chore without counting as a settled matter.
    expect(chore.status).toBe('completed');
    expect(s.ledgers[player.id].counts.questsCompleted ?? 0).toBe(settled);
    expect(tw.world.johnSmith!.ledgers[player.id].feats.unboxing).toBeDefined();
  });

  it('rebuilds a lost record from canonical reserve items, so no cache id is ever issued twice', () => {
    const { tw, player } = world();
    pass(tw);
    const s = ensureJohnSmith(tw.world), cache = grantCache(tw.world, s, player, 0, 'test')!;
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: cache.id }).result).toBe('opened');
    delete tw.world.johnSmith;
    const fresh = ensureJohnSmith(tw.world);
    expect(fresh.caches.map(c => c.id)).toEqual([cache.id]);
    const again = grantCache(tw.world, fresh, player, 0, 'after loss')!;
    expect(again.id).not.toBe(cache.id);
    reconcileReserve(tw.world, fresh);
    expect(fresh.caches.filter(c => c.id === cache.id)).toHaveLength(1);
  });
});

describe('persistence and commands', () => {
  it('bounds per-subject marks without ever forgetting a once-in-a-life deed', () => {
    const { tw, player } = world();
    pass(tw);
    const record = holderRecord(tw.world.johnSmith!, player.id);
    mark(record, 'realm_crossed', 'e_1');
    for (let i = 0; i < 450; i++) mark(record, `kill:cr_${i}`, `e_${i + 2}`);
    expect(Object.keys(record.marks)).toHaveLength(400);
    expect(record.marks.realm_crossed).toBe('e_1');
    expect(record.marks['kill:cr_449']).toBeDefined();
    expect(record.marks['kill:cr_0']).toBeUndefined();
  });

  it('round-trips the record exactly and refuses a malformed one', () => {
    const { tw, player } = world();
    pass(tw);
    grantCache(tw.world, ensureJohnSmith(tw.world), player, 1, 'test');
    tw.world.emit('gift', { actor: player.id, target: player.id, significance: .5 });
    pass(tw);
    const raw = JSON.parse(serialize(tw.world));
    expect(restoreJohnSmith(raw.johnSmith)).toEqual(tw.world.johnSmith);
    expect(restoreJohnSmith({ ...raw.johnSmith, caches: [...raw.johnSmith.caches, { ...raw.johnSmith.caches[0] }] })).toBeNull();
    expect(restoreJohnSmith({ ...raw.johnSmith, origin: raw.johnSmith.cursor + 1 })).toBeNull();
    expect(restoreJohnSmith({ ...raw.johnSmith, version: 2 })).toBeNull();
  });

  it('accepts only exact command shapes and never throws on bad input', () => {
    const { tw, player } = world();
    for (const bad of [null, 7, 'open', [], { type: 'open_cache' }, { type: 'open_cache', cacheId: 'x', extra: 1 }, { type: 'watch_quest', questId: 'q-1', watch: 'yes' }, { type: 'open_cache', cacheId: '../../etc' }, { type: 'grant_cache', tier: 5 }])
      expect(applyJohnSmithCommand(tw.world, player.id, bad).result).toBe('invalid_command');
    expect(parseJohnSmithCommand({ type: 'dismiss_quest', questId: 'q-2', dismiss: true })).toEqual({ type: 'dismiss_quest', questId: 'q-2', dismiss: true });
    const npc = addPerson(tw, 'Wren', 'farmer', v(12, 1, 10));
    expect(applyJohnSmithCommand(tw.world, npc.id, { type: 'open_cache', cacheId: 'veil-cache:bronze:1' }).result).toBe('no_interface');
    expect(applyJohnSmithCommand(tw.world, player.id, { type: 'open_cache', cacheId: 'veil-cache:bronze:1' }).result).toBe('unknown_cache');
  });
});

describe('feat table', () => {
  it('has unique ids, valid tiers and counters the watch actually moves', () => {
    expect(new Set(FEATS.map(f => f.id)).size).toBe(FEATS.length);
    for (const f of FEATS) { expect(f.tier).toBeGreaterThanOrEqual(0); expect(f.tier).toBeLessThanOrEqual(5); expect(f.at).toBeGreaterThan(0); expect(f.line.length).toBeGreaterThan(20); }
    const moved = new Set(['blows', 'downs', 'kills', 'beastKills', 'blowsTaken', 'arcaneHits', 'surrenders', 'towerEntries', 'floorsCleared', 'highestFloor', 'flawlessFloors', 'nearDeathClears', 'falls', 'awardsClaimed',
      'crossings', 'wardsBest', 'realmsWalked', 'landmarks', 'sourcesLearned', 'casts', 'stage', 'returned', 'gifts', 'heals', 'thefts', 'arrested', 'crafted', 'debtsPaid', 'questsCompleted', 'cachesOpened', 'attention', 'renown']);
    for (const f of FEATS) expect(moved.has(f.counter), f.counter).toBe(true);
  });
});

describe('under arbitrary history', () => {
  it('keeps every invariant through random deeds, commands, time jumps and save round-trips', () => {
    const { tw, player } = world(9917);
    const npcs = Array.from({ length: 8 }, (_, i) => addPerson(tw, `Unmet${i} Quarrytooth`, i % 2 ? 'bandit' : 'farmer', v(12 + i, 1, 12)));
    const boar = makeCreature(tw.world, 'boar', 'woodland boar', null, null);
    const everyone = [player.id, ...npcs.map(n => n.id), boar.id];
    const rng = new RNG(4242), s = ensureJohnSmith(tw.world);
    const results = new Set(['invalid_command', 'unknown_cache', 'already_opened', 'opened', 'accepted', 'watch_limit', 'closed', 'unknown_quest']);
    let opened = 0;
    const coffers: { id: string; items: string[] }[] = [], people = [player, ...npcs];
    for (let step = 0; step < 400; step++) {
      const actor = rng.pick(everyone), target = rng.pick(everyone), roll = rng.next();
      if (roll < .1) {
        // Real blows through the simulation, so conflicts, situations and fights exist to be read.
        const a = rng.pick(people), b = rng.chance(.5) ? player : rng.pick(npcs);
        if (a !== b) { tw.sim.applyHit(a, tw.world.primaryBody(a.id)!, tw.world.primaryBody(b.id)!, rng.int(1, 4), 'injure'); delete tw.world.primaryBody(a.id)!.recoil; }
      } else if (roll < .3) tw.world.emit('attack', { actor, target, significance: .4, data: { damage: rng.int(0, 30), health: rng.int(-5, 80) } });
      else if (roll < .35) tw.world.emit('kill', { actor, target, significance: .9 });
      else if (roll < .4) tw.world.emit('downed', { actor: target, target: actor, significance: .5, data: { by: actor } });
      else if (roll < .5) tw.world.emit(rng.pick(['gift', 'heal', 'theft', 'returned_item', 'debt_paid', 'item_crafted', 'entity_surrendered'] as const), { actor, target, significance: .5 });
      else if (roll < .55) tw.world.emit(rng.pick(['tower_floor_opened', 'tower_floor_cleared', 'tower_entered', 'tower_fallen'] as const), { actor, significance: .5, data: { runId: 'run-x', floor: rng.int(1, 120), seconds: rng.int(1, 900) } });
      else if (roll < .58) tw.world.emit('ontological_advancement', { actor, significance: 1, data: { from: 'Normal', to: rng.pick(['Iron', 'Bronze', 'Silver', 'Gold', 'Nonsense']) } });
      else if (roll < .75) {
        const mine = s.caches.filter(c => c.recipientId === player.id), quest = rng.pick([...holderRecord(s, player.id).quests, undefined]);
        const command = rng.pick([
          { type: 'open_cache', cacheId: rng.chance(.8) && mine.length ? rng.pick(mine).id : 'veil-cache:gold:36' },
          { type: 'watch_quest', questId: quest?.id ?? 'q-999', watch: rng.chance(.6) },
          { type: 'dismiss_quest', questId: quest?.id ?? 'q-999', dismiss: rng.chance(.3) },
          { type: 'open_cache', cacheId: 7 }, { type: 'grant_cache', tier: 5 },
        ]);
        const result = applyJohnSmithCommand(tw.world, player.id, command);
        expect(results.has(result.result) || result.result.startsWith('unsafe:'), result.result).toBe(true);
        if (result.result === 'opened') { opened++; coffers.push({ id: result.cofferId!, items: result.itemIds! }); }
      }
      if (coffers.length && rng.chance(.1)) { const c = coffers.shift()!; for (const id of c.items) performContainerTransfer(tw.sim, player, c.id, id, 'out'); }
      if (rng.chance(.08)) for (const c of tw.world.conflicts) if (c.status !== 'resolved') resolveConflict(tw.world, c, rng.pick(['withdrawal', 'aggressor_fled', 'surrender'] as const));
      delete tw.world.primaryBody(player.id)!.recoil;
      pass(tw, rng.chance(.03) ? 86400 : rng.range(.1, 2.5));

      const status = reserveStatus(s);
      expect(status.every(r => r.granted <= r.total)).toBe(true);
      expect(new Set(s.caches.map(c => c.id)).size).toBe(s.caches.length);
      expect(s.caches.every(c => c.recipientId === player.id)).toBe(true);
      expect(Object.keys(s.holders)).toEqual([player.id]);
      const record = holderRecord(s, player.id), open = record.quests.filter(q => q.status === 'open');
      expect(open.length).toBeLessThanOrEqual(MAX_OPEN_QUESTS);
      expect(record.quests.length).toBeLessThanOrEqual(MAX_QUESTS);
      expect(open.filter(q => q.watched).length).toBeLessThanOrEqual(4);
      expect(record.quests.filter(q => q.status !== 'open').every(q => !q.watched)).toBe(true);
      if (step % 25 === 0 || step === 399) {
        const copy = restoreJohnSmith(JSON.parse(JSON.stringify(s)));
        expect(copy).not.toBeNull();
        expect(copy).toEqual(s);
        expect(JSON.stringify(johnSmithView(tw.world, player.id))).not.toContain('Unmet');
      }
    }
    // The run must actually have exercised the interesting paths.
    expect(Object.keys(s.ledgers[player.id].feats).length).toBeGreaterThan(5);
    expect(s.caches.length).toBeGreaterThan(5);
    expect(opened).toBeGreaterThan(0);
    expect(holderRecord(s, player.id).quests.some(q => q.status !== 'open')).toBe(true);
  });
});
