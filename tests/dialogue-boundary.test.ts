import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { makeItem } from '../src/sim/world/factory';
import { getRel } from '../src/sim/mind/relationships';
import { learnIdentity } from '../src/sim/mind/people';

function fixture() {
  const s = new BridgeSession(918271), w = s.world, player = w.person(w.playerId!)!;
  const npc = w.persons().find(p => p.id !== player.id && !p.hostile && p.age > 20)!;
  const pb = w.primaryBody(player.id)!, nb = w.primaryBody(npc.id)!;
  // Disclosed conversation fixture: co-location and a direct observation.
  pb.pos = { ...nb.pos }; nb.pose = 'stand';
  player.mind.percepts = [{ entityId: npc.id, bodyId: nb.id, how: 'saw', pos: { ...nb.pos }, tick: w.now, distance: 0 }];
  let sequence = 0;
  const intent = (message: Record<string, unknown>) => s.intent({ version: 1, sequence: ++sequence, ...message });
  return { s, w, player, npc, pb, nb, intent };
}

describe('embodied dialogue choices and named contacts', () => {
  it.each(['departed', 'sleeping'] as const)('rejects a previously offered choice when the speaker is %s', reason => {
    const { s, w, player, npc, pb, nb, intent } = fixture();
    const missing = makeItem(w, 'hammer', 'missing hammer', { owner: npc.id, pos: { ...nb.pos } });
    npc.desires = [{ type: 'recover_item', targetId: missing.id, reward: 2, fulfilled: false, note: 'Please recover my hammer.' }];
    expect(intent({ type: 'talk', targetBodyId: nb.id }).result).toBe('accepted');
    const option = s.snapshot(false).dialogue!.options.find(o => o.label === 'Is there anything you need?')!;
    if (reason === 'departed') pb.pos.x += 30; else nb.pose = 'sleep';
    const eventCount = w.events.length;
    expect(intent({ type: 'dialogue_option', optionId: option.id }).result).toBe('interaction_unavailable');
    expect(player.knowledge[`wanted:${missing.id}`]).toBeUndefined();
    expect(w.events.length).toBe(eventCount);
    expect(s.snapshot(false).dialogue).toBeNull();
    pb.pos = { ...nb.pos }; nb.pose = 'stand';
    expect(intent({ type: 'dialogue_option', optionId: option.id }).result).toBe('no_dialogue');
  });

  it('names only contacts the speaker can identify and preserves their claimed name and source', () => {
    const { s, w, player, npc, nb, intent } = fixture();
    const [named, unnamed] = w.persons().filter(p => p.id !== player.id && p.id !== npc.id);
    // Disclosed evidence fixture: this speaker knows an alias for one acquaintance;
    // familiarity alone supplies no name for the other.
    npc.relationships = {};
    getRel(npc, named.id).familiarity = .4; getRel(npc, unnamed.id).familiarity = .3;
    const key = `identity:${named.id}`;
    delete npc.knowledge[`identity:${unnamed.id}`];
    delete player.knowledge[key]; delete player.knowledge[`identity:${unnamed.id}`];
    const source = w.emit('introduction', { actor: named.id, target: npc.id, data: { claimedName: 'Reed Walker' }, significance: .25 });
    const claimed = learnIdentity(w, npc, named.id, 'Reed Walker', { type: 'told', from: named.id, viaEvent: source.id }, .6)!;
    claimed.hops = 2;
    expect(intent({ type: 'talk', targetBodyId: nb.id }).result).toBe('accepted');
    expect(player.knowledge[key]).toBeUndefined();
    const ask = s.snapshot(false).dialogue!.options.find(o => o.label === 'Ask about someone…')!;
    expect(intent({ type: 'dialogue_option', optionId: ask.id }).result).toBe('accepted');
    const menu = s.snapshot(false).dialogue!;
    expect(menu.options.map(o => o.label)).toEqual(['Reed Walker', 'Never mind']);
    expect(menu.lines.join(' ')).toContain('Reed Walker');
    const learned = player.knowledge[key];
    expect(learned.claim.identity.name).toBe('Reed Walker');
    expect(learned.claim.identity.name).not.toBe(named.name);
    expect(learned.source).toMatchObject({ type: 'told', from: npc.id });
    expect(learned.hops).toBe(3); expect(learned.confidence).toBeCloseTo(.48);
    const told = w.event(learned.source.viaEvent!)!;
    expect(told.type).toBe('told'); expect(told.actor).toBe(npc.id); expect(told.target).toBe(player.id);
    expect(told.causes).toContain(source.id);
    expect(player.knowledge[`identity:${unnamed.id}`]).toBeUndefined();
    expect(learned.claim).not.toBe(claimed.claim);
  });
});
