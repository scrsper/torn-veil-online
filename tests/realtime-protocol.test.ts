import { describe, expect, it, vi } from 'vitest';
import { CommandQueue, type CommandEnvelope } from '../src/bridge/commands';
import { INTERACTION_SPEC, predictMovement, type CollisionColumn, type MovementState } from '../src/sim/physical/prediction';
import { requestDefense } from '../src/sim/physical/combatAction';
import { createTestWorld, addPerson, v } from './helpers/world';

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

  it('prioritizes combat while keeping one movement sample per step and a contiguous ack', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId), execute = vi.fn(() => 'accepted');
    expect(q.receive(command(1), 0, 0).status).toBe('received');
    expect(q.receive(command(2), 0, 1).status).toBe('received');
    expect(q.receive(command(3, { type: 'attack' }), 0, 2).status).toBe('received');
    const receipts=q.apply(1, 3, execute);
    expect(receipts.map(r=>r.sequence)).toEqual([1,3]);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(q.size).toBe(1);expect(q.ack).toBe(1);
    expect(q.apply(2, 20, execute).map(r=>r.sequence)).toEqual([2]);
    expect(q.ack).toBe(3);
  });

  it('cancels pending commands on binding release with no execution', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId), execute = vi.fn(() => 'accepted');
    q.receive(command(0), 0, 0);
    expect(q.cancel(1, 2)[0]).toMatchObject({ status: 'cancelled', result: 'binding_released' });
    expect(q.apply(2, 3, execute)).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not move combat ahead of an earlier pickup behind queued movement', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId);
    let holdingWeapon=false;
    const execute=(c:CommandEnvelope['command'])=>{
      if(c.type==='interact')holdingWeapon=true;
      if(c.type==='attack')expect(holdingWeapon).toBe(true);
      return 'accepted';
    };
    [command(1),command(2),command(3,{type:'interact',interactionId:'pickup-weapon'}),command(4,{type:'attack'})]
      .forEach(c=>q.receive(c,0,c.sequence));
    expect(q.apply(1,10,execute).map(r=>r.sequence)).toEqual([1]);
    expect(q.ack).toBe(1);
    expect(q.apply(2,20,execute).map(r=>r.sequence)).toEqual([2,3,4]);
    expect(q.ack).toBe(4);
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

  it('reconciles a wrong open-geometry prediction against canonical blocked movement', () => {
    const predicted = predictMovement(state, { x: 1, z: 0, sprint: false }, INTERACTION_SPEC.stepSeconds, () => open);
    const confirmed = predictMovement(state, { x: 1, z: 0, sprint: false }, INTERACTION_SPEC.stepSeconds, () => ({ floor: 0, walkable: true, solids: [0, 1] }));
    const correction = Math.hypot(predicted.pos.x - confirmed.pos.x, predicted.pos.y - confirmed.pos.y, predicted.pos.z - confirmed.pos.z);
    expect(predicted.pos.x).toBeGreaterThan(confirmed.pos.x);
    expect(correction).toBeGreaterThan(0);
    expect(correction).toBeLessThanOrEqual(INTERACTION_SPEC.sweepStep + 1e-9);
  });

  it('replays duplicate defense command identity without a second execution', () => {
    const q = new CommandQueue(binding.epoch, binding.controllerId, binding.bodyId);
    const defend = command(7, { type: 'defend', kind: 'sidestep', side: 1 });
    const execute = vi.fn(() => 'accepted');
    expect(q.receive(defend, 0, 0).status).toBe('received');
    expect(q.receive(defend, 0, 1).status).toBe('received');
    expect(q.apply(1, 2, execute)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(q.receive(defend, 0, 3).status).toBe('applied');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps duplicate defense from duplicating exertion or canonical action events', () => {
    const tw = createTestWorld(321), p = addPerson(tw, 'Defender', 'traveler', v(10, 1, 10), { controlled: true });
    const b = tw.world.primaryBody(p.id)!;
    const beforeFatigue = p.physiology.fatigue, beforeEvents = tw.world.events.filter(e => e.type === 'combat_action').length;
    expect(requestDefense(tw.world, b.id, 'sidestep', 1, 'defense-once')).toBe('accepted');
    expect(requestDefense(tw.world, b.id, 'backstep', 1, 'defense-duplicate')).toBe('cooldown');
    expect(p.physiology.fatigue - beforeFatigue).toBeCloseTo(0.018);
    expect(tw.world.events.filter(e => e.type === 'combat_action').length - beforeEvents).toBe(3);
  });
});
