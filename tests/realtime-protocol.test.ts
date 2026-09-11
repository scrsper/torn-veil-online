import { describe, expect, it, vi } from 'vitest';
import { CommandQueue, type CommandEnvelope } from '../src/bridge/commands';
import { INTERACTION_SPEC, predictMovement, type CollisionColumn, type MovementState } from '../src/sim/physical/prediction';

const binding = { epoch: 'e1', controllerId: 'c1', bodyId: 'b1' };
function command(sequence: number, body: CommandEnvelope['command'] = { type: 'move', x: 1, z: 0, sprint: false }, extra: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return { version: 2, type: 'command', ...binding, sequence, commandId: `cmd-${sequence}`, specRevision: INTERACTION_SPEC.revision, clientTimeMs: sequence * 10, command: body, ...extra };
}

describe('realtime command protocol', () => {
  it('separates received acknowledgement from applied acknowledgement', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId);
    expect(q.receive(command(0), 1, 100)).toMatchObject({ status: 'received', sequence: 0 });
    expect(q.ack).toBe(-1);
    expect(q.apply(2, 110, () => 'accepted')[0]).toMatchObject({ status: 'applied', sequence: 0 });
    expect(q.ack).toBe(0);
  });

  it('replays a duplicate command without applying it twice and rejects identity conflicts', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId), execute = vi.fn(() => 'accepted');
    const first = q.receive(command(1), 0, 0), duplicate = q.receive(command(1), 0, 20);
    expect(duplicate).toMatchObject({ status: 'received', commandId: first.commandId, sequence: 1 });
    expect(q.apply(1, 30, execute)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(q.receive(command(2, { type: 'cancel' }, { commandId: 'cmd-1' }), 0, 21).result).toBe('identity_conflict');
  });

  it('rejects stale sequences, invalid versions, bindings, epochs, spec revisions, and expired queue entries', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId);
    expect(q.receive(command(1), 0, 0).status).toBe('received');
    expect(q.receive(command(1, undefined, { commandId: 'cmd-other' }), 0, 1).result).toBe('stale_sequence');
    expect(q.receive(command(2, undefined, { version: 1 } as any), 0, 2).result).toBe('invalid_envelope');
    expect(q.receive(command(3, undefined, { bodyId: 'other' }), 0, 3).result).toBe('binding_mismatch');
    expect(q.receive(command(4, undefined, { epoch: 'old' }), 0, 4).result).toBe('binding_mismatch');
    expect(q.receive(command(5, undefined, { specRevision: 'old' }), 0, 5).result).toBe('spec_mismatch');
    const applied = q.apply(1, INTERACTION_SPEC.inputHorizonSeconds * 1000 + 1, () => 'accepted');
    expect(applied[0]).toMatchObject({ status: 'rejected', result: 'expired' });
  });

  it('keeps one movement sample per server application step and bounds the queue', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId), execute = vi.fn(() => 'accepted');
    expect(q.receive(command(1), 0, 0).status).toBe('received');
    expect(q.receive(command(2), 0, 1).status).toBe('received');
    expect(q.receive(command(3, { type: 'attack' }), 0, 2).status).toBe('received');
    expect(q.apply(1, 3, execute)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(2);
  });

  it('cancels pending commands on binding release with no execution', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId), execute = vi.fn(() => 'accepted');
    q.receive(command(0), 0, 0);
    expect(q.cancel(1, 2)[0]).toMatchObject({ status: 'cancelled', result: 'binding_released' });
    expect(q.apply(2, 3, execute)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

const open: CollisionColumn = { floor: 0, walkable: true, solids: [] };
const unknown = (): CollisionColumn | undefined => undefined;
const state: MovementState = { pos: { x: 1.5, y: 0, z: 1.5 }, yaw: 0, speed: 3, eligible: true };
describe('deterministic interaction movement prediction', () => {
  it('does not pass through closed-door solids or unknown columns', () => {
    const door: CollisionColumn = { floor: 0, walkable: true, solids: [0, 1] };
    const columns = (x: number, z: number) => x >= 2 ? door : open;
    let blocked = state;
    for (let i = 0; i < 12; i++) blocked = predictMovement(blocked, { x: 1, z: 0, sprint: false }, INTERACTION_SPEC.stepSeconds, columns);
    expect(blocked.pos.x).toBeLessThan(2);
    let openResult = state;
    for (let i = 0; i < 12; i++) openResult = predictMovement(openResult, { x: 1, z: 0, sprint: false }, INTERACTION_SPEC.stepSeconds, () => open);
    expect(openResult.pos.x).toBeGreaterThan(state.pos.x);
    let unknownResult = state;
    for (let i = 0; i < 12; i++) unknownResult = predictMovement(unknownResult, { x: 1, z: 0, sprint: false }, INTERACTION_SPEC.stepSeconds, unknown);
    expect(unknownResult.pos).toEqual(state.pos);
  });

  it('is stateless and replayable for identical inputs', () => {
    const before = structuredClone(state);
    const a = predictMovement(state, { x: .5, z: 1, sprint: true }, INTERACTION_SPEC.stepSeconds, () => open);
    const b = predictMovement(state, { x: .5, z: 1, sprint: true }, INTERACTION_SPEC.stepSeconds, () => open);
    expect(a).toEqual(b);
    expect(state).toEqual(before);
  });
});
