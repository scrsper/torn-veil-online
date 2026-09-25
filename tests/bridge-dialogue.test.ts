import { describe, expect, it } from 'vitest';
import { BridgeSession, BRIDGE_VERSION } from '../src/bridge/session';
import { makeItem } from '../src/sim/world/factory';
import { getRel } from '../src/sim/mind/relationships';
import { DialogueSystem } from '../src/sim/mind/dialogue';

describe('native dialogue bridge projection', () => {
  it('keeps late grounded options reachable beyond the nine numeric shortcuts', () => {
    const s = new BridgeSession(918271), w = s.world, player = w.person(w.playerId)!;
    const npc = w.persons().find(p => p.id !== player.id && !p.hostile && p.age > 20)!;
    const pb = w.primaryBody(player.id)!, nb = w.primaryBody(npc.id)!;
    pb.pos = { ...nb.pos }; nb.pose = 'stand';
    player.mind.percepts = [{ entityId: npc.id, bodyId: nb.id, how: 'saw', pos: { ...nb.pos }, tick: w.now, distance: 0 }];
    // Disclosed menu preconditions: real surplus stock, a carried gift, a grudge
    // and a recoverable possession. All choices still come from DialogueSystem.
    makeItem(w, 'bread', 'loaves', { holder: npc.id, owner: npc.id, quantity: 20 });
    makeItem(w, 'flowers', 'flowers', { holder: player.id, owner: player.id });
    getRel(npc, player.id).grudge = .3;
    const missing = makeItem(w, 'hammer', 'lost hammer', { owner: npc.id, pos: { ...nb.pos } });
    npc.desires = [{ type: 'recover_item', targetId: missing.id, reward: 2, fulfilled: false, note: 'Please recover my hammer.' }];
    const expected = new DialogueSystem(w, s.sim).start(npc, player).options;
    expect(expected.length).toBeGreaterThan(9);
    expect(s.intent({ version: 1, sequence: 1, type: 'talk', targetBodyId: nb.id }).result).toBe('accepted');
    const menu = s.snapshot(false).dialogue!;
    expect(menu.options.map(o => o.label)).toEqual(expected.map(o => o.label));
    const index = menu.options.findIndex(o => o.label === 'Is there anything you need?');
    expect(index).toBeGreaterThanOrEqual(9);
    expect(s.intent({ version: 1, sequence: 2, type: 'dialogue_option', optionId: menu.options[index].id }).result).toBe('accepted');
    expect(player.knowledge[`wanted:${missing.id}`]?.claim.itemId).toBe(missing.id);
    expect(s.intent({ version: 1, sequence: 3, type: 'dialogue_option', optionId: menu.options[index].id }).result).toBe('invalid_dialogue_option');
  });
  it('opens a grounded canonical dialogue and advances only through opaque options', () => {
    const session = new BridgeSession(918271);
    const player = session.world.person(session.world.playerId)!;
    const playerBody = session.world.primaryBody(player.id)!;
    const npcBody = session.world.bodies().find(body => body.ownerId !== player.id && body.present && !body.dead && body.shape === 'humanoid')!;
    const npc = session.world.person(npcBody.ownerId)!;
    npc.occupation = 'farmer'; npc.traits.sociability = 1;
    // Placement is only test setup.  The actual endpoint must still derive range, passage and
    // whether talk is possible from the canonical world before it opens dialogue.
    playerBody.pos = { ...npcBody.pos };
    // The UI can address only an observed body. Establish that fixture observation;
    // endpoint validation still independently checks current reach and passage.
    player.mind.percepts=[{entityId:npcBody.ownerId,bodyId:npcBody.id,how:'saw',pos:{...npcBody.pos},tick:session.world.now,distance:0}];

    const target = session.snapshot().talkTargets.find(candidate => candidate.bodyId === npcBody.id)!;
    expect(target).toBeDefined();
    expect(session.intent({ version: BRIDGE_VERSION, sequence: 1, type: 'talk', targetBodyId: target.bodyId }).result).toBe('accepted');

    const opened = session.snapshot().dialogue;
    expect(opened).not.toBeNull();
    expect(opened!.speakerId).toBe(npcBody.ownerId);
    expect(opened!.lines.length).toBeGreaterThan(0);
    expect(opened!.lines[0]).toBe("Hello there. I don't think we've met.");
    expect(opened!.options.some(option => option.label === 'Who are you?')).toBe(true);

    const identity = opened!.options.find(option => option.label === 'Who are you?')!;
    expect(session.intent({ version: BRIDGE_VERSION, sequence: 2, type: 'dialogue_option', optionId: identity.id }).result).toBe('accepted');
    const advanced = session.snapshot().dialogue;
    expect(advanced).not.toBeNull();
    expect(advanced!.lines.join(' ')).toContain(advanced!.name);

    expect(session.intent({ version: BRIDGE_VERSION, sequence: 3, type: 'dialogue_close' }).result).toBe('accepted');
    expect(session.snapshot().dialogue).toBeNull();
  });

  it('refuses a fabricated or out-of-reach talk target without creating dialogue', () => {
    const session = new BridgeSession(918271);
    expect(session.intent({ version: BRIDGE_VERSION, sequence: 1, type: 'talk', targetBodyId: 'body_not_real' }).result).toBe('interaction_unavailable');
    expect(session.snapshot().dialogue).toBeNull();
  });
});
