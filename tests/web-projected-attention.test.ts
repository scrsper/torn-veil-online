import { describe, expect, it } from 'vitest';
import { facingBody } from '../src/web/actors/projectedAttention';

describe('projected attention identity', () => {
  const from = { id: 'speaker', pos: { x: 0, y: 0, z: 0 } };
  const body = (id: string, entityId: string, x: number) => ({ id, body: { entityId }, pos: { x, y: 0, z: 0 } });
  it('looks at the explicit NPC target instead of a nearer player', () => {
    expect(facingBody(from, 'npc', [body('player-body', 'player', 1), body('npc-body', 'npc', 3)])).toBe('npc-body');
  });
  it('does not substitute a player when the target has no projected body or is too far away', () => {
    expect(facingBody(from, 'missing', [body('player-body', 'player', 1)])).toBeNull();
    expect(facingBody(from, 'npc', [body('npc-body', 'npc', 9)])).toBeNull();
    expect(facingBody(from, null, [body('player-body', 'player', 1)])).toBeNull();
  });
  it('supports multiple bodies and deterministic ties without changing their source data', () => {
    const candidates = [body('c', 'npc', 4), body('b', 'npc', 2), body('a', 'npc', -2), body('speaker', 'npc', 0)];
    const before = JSON.stringify(candidates);
    expect(facingBody(from, 'npc', candidates)).toBe('a');
    expect(facingBody(from, 'npc', [...candidates].reverse())).toBe('a');
    expect(JSON.stringify(candidates)).toBe(before);
  });
});
