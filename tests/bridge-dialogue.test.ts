import { describe, expect, it } from 'vitest';
import { BridgeSession, BRIDGE_VERSION } from '../src/bridge/session';

describe('native dialogue bridge projection', () => {
  it('opens a grounded canonical dialogue and advances only through opaque options', () => {
    const session = new BridgeSession(918271);
    const player = session.world.person(session.world.playerId)!;
    const playerBody = session.world.primaryBody(player.id)!;
    const npcBody = session.world.bodies().find(body => body.ownerId !== player.id && body.present && !body.dead && body.shape === 'humanoid')!;
    // Placement is only test setup.  The actual endpoint must still derive range, passage and
    // whether talk is possible from the canonical world before it opens dialogue.
    playerBody.pos = { ...npcBody.pos };

    const target = session.snapshot().talkTargets.find(candidate => candidate.bodyId === npcBody.id)!;
    expect(target).toBeDefined();
    expect(session.intent({ version: BRIDGE_VERSION, sequence: 1, type: 'talk', targetBodyId: target.bodyId }).result).toBe('accepted');

    const opened = session.snapshot().dialogue;
    expect(opened).not.toBeNull();
    expect(opened!.speakerId).toBe(npcBody.ownerId);
    expect(opened!.lines.length).toBeGreaterThan(0);
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
