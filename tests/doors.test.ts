import { describe, expect, it } from 'vitest';
import type { EntityId, Vec3, WorldEvent } from '../src/sim/core/types';
import type { World } from '../src/sim/core/world';
import { B } from '../src/sim/physical/blocks';
import { addPerson, createTestWorld, step, v } from './helpers/world';

interface DoorWorld extends World {
  isDoorOpen(pos: Vec3): boolean;
  setDoorOpen(pos: Vec3, open: boolean, actor?: EntityId): WorldEvent | null;
}

describe('physical doors', () => {
  it('has canonical open state that controls collision and emits an event', () => {
    const tw = createTestWorld(91, 14);
    const actor = addPerson(tw, 'Door User', 'farmer', v(4.5, 1, 6.5));
    const pos = v(6, 1, 6);
    tw.world.grid.set(pos.x, pos.y, pos.z, B.Door);
    tw.world.nav.rebuildArea(5, 5, 7, 7);
    const world = tw.world as DoorWorld;

    expect(world.isDoorOpen(pos)).toBe(false);
    expect(world.grid.isSolidAt(pos.x, pos.y, pos.z)).toBe(true);
    const opened = world.setDoorOpen(pos, true, actor.id);
    expect(opened?.type).toBe('block_changed');
    expect(opened?.data).toMatchObject({ block: 'door', open: true });
    expect(world.isDoorOpen(pos)).toBe(true);
    expect(world.grid.isSolidAt(pos.x, pos.y, pos.z)).toBe(false);
  });

  it('lets an NPC open a closed door while following a valid path', () => {
    const tw = createTestWorld(92, 14);
    for (let z = 0; z < 14; z++) for (let y = 1; y <= 3; y++) tw.world.grid.set(6, y, z, B.Stone);
    tw.world.grid.set(6, 1, 6, B.Door);
    tw.world.grid.set(6, 2, 6, B.Air);
    tw.world.grid.set(6, 3, 6, B.Air);
    tw.world.nav.rebuildAll();
    const npc = addPerson(tw, 'Walker', 'farmer', v(4.5, 1, 6.5));
    npc.mind.thinkInterval = Number.POSITIVE_INFINITY;
    npc.mind.plan = [{ type: 'goto', pos: v(8.5, 1, 6.5), status: 'pending' }];

    expect(tw.world.nav.findPath(v(4.5, 1, 6.5), v(8.5, 1, 6.5))).not.toBeNull();
    step(tw, 2);

    expect((tw.world as DoorWorld).isDoorOpen(v(6, 1, 6))).toBe(true);
    expect(tw.world.primaryBody(npc.id)!.pos.x).toBeGreaterThan(7);
  });
});
