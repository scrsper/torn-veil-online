import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { deserialize, newWorld, serialize } from '../src/sim/persist/save';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
    const dt = Math.min(0.05, seconds - elapsed);
    const worldDt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, worldDt); sim.flushSpeech();
  }
}

describe('save round trips', () => {
  it('preserves witnessed consequences, dynamic trade items, events, and door state', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const player = world.person(world.playerId)!;
    const tomas = gen.people.tomas;
    const mara = gen.people.mara;
    const merchant = gen.people.wendel;
    const playerBody = world.primaryBody(player.id)!;
    const tomasBody = world.primaryBody(tomas.id)!;
    const maraBody = world.primaryBody(mara.id)!;
    playerBody.pos = { x: 101.5, y: 14, z: 96.5 };
    tomasBody.pos = { x: 100.5, y: 14, z: 96.5 };
    maraBody.pos = { x: 100.5, y: 14, z: 100.5 };
    maraBody.yaw = 0;
    const attack = sim.applyHit(player, playerBody, tomasBody, 8)!;
    advance(world, sim, 0.3);
    expect(mara.knowledge[`ev:${attack.id}`]?.source.type).toBe('witnessed');

    const doorIndex = world.grid.doorStates.keys().next().value as number;
    const doorY = doorIndex % world.grid.H;
    const doorXZ = (doorIndex - doorY) / world.grid.H;
    const doorZ = doorXZ % world.grid.D;
    const doorX = (doorXZ - doorZ) / world.grid.D;
    world.setDoorOpen({ x: doorX, y: doorY, z: doorZ }, true, player.id);

    const oldCoins = player.inventory.map(id => world.item(id)).find(item => item?.type === 'coins')!;
    player.inventory = player.inventory.filter(id => id !== oldCoins.id);
    world.entities.delete(oldCoins.id);
    const sold = player.inventory.map(id => world.item(id)).find(item => item?.type === 'bread')!;
    const trade = sim.sellItem(player, merchant, sold, 4, { x: 75.5, y: 14, z: 106.5 }, merchant.workId ?? undefined)!;

    const loaded = deserialize(serialize(world));
    expect(loaded).not.toBeNull();
    const restored = loaded!.world;
    const restoredMara = restored.person(mara.id)!;
    expect(restoredMara.knowledge[`ev:${attack.id}`]).toMatchObject({ source: { type: 'witnessed' }, claim: { actor: player.id } });
    expect(restoredMara.memories.some(memory => memory.eventId === attack.id)).toBe(true);
    expect(restoredMara.relationships[player.id].trust).toBeLessThan(0);
    expect(restored.isDoorOpen({ x: doorX, y: doorY, z: doorZ })).toBe(true);
    expect(restored.item(sold.id)).toMatchObject({ ownerId: merchant.id, holderId: null, provenance: expect.arrayContaining([expect.objectContaining({ eventId: trade.id, how: 'sold' })]) });
    const restoredPlayer = restored.person(player.id)!;
    expect(restoredPlayer.inventory.map(id => restored.item(id)).find(item => item?.type === 'coins')).toMatchObject({ holderId: player.id, quantity: 4 });
    for (const event of restored.events) {
      expect(event.causes.every(id => restored.event(id))).toBe(true);
      expect(event.effects.every(id => restored.event(id))).toBe(true);
    }
  });
});
