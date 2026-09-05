import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { addPlaceStock } from '../src/sim/world/stock';
import { createHaulTask, claimHaulTask, loadHaulCargo } from '../src/sim/logistics/haul';
import { makeItem } from '../src/sim/world/factory';
import type { RNG } from '../src/sim/core/rng';

/** Always-triggers stand-in for World.rng — guarantees the `item_missing` inference's `0.3 *
 * minutes` roll fires on every strategic tick, so these tests prove the STRUCTURAL fix (haul
 * cargo is excluded), not merely that the roll got unlucky. */
class AlwaysRNG {
  next(): number { return 0; }
  range(a: number): number { return a; }
  int(a: number): number { return a; }
  pick<T>(arr: readonly T[]): T { return arr[0]; }
  chance(): boolean { return true; }
  shuffle<T>(arr: T[]): T[] { return arr; }
  fork(): RNG { return this as unknown as RNG; }
}

describe('P0-F: legitimate haul cargo does not generate phantom theft/missing-item consequences', () => {
  it('an item owned by the requester and carried by the authorized haul claimant does not trigger item_missing', () => {
    const tw = createTestWorld(700);
    tw.world.rng = new AlwaysRNG() as unknown as RNG;
    const owner = addPerson(tw, 'Owner', 'baker', tw.world.place(tw.places.chapel)!.inside, { workId: tw.places.chapel });
    const hauler = addPerson(tw, 'Hauler', 'apprentice', tw.world.place(tw.places.tavern)!.inside);
    addPlaceStock(tw.world, 'plank', 10, tw.places.tavern, null, undefined, 'test stock');
    const task = createHaulTask(tw.world, {
      resource: 'plank', quantity: 5, sourcePlaceId: tw.places.tavern, destPlaceId: tw.places.chapel,
      reason: 'test haul', requesterId: owner.id, priority: 0.5,
    });
    claimHaulTask(tw.world, task, hauler);
    const loaded = loadHaulCargo(tw.world, task, hauler);
    expect(loaded).toBe(true);
    const cargo = tw.world.item(task.cargoItemId!)!;
    expect(cargo.ownerId).toBe(owner.id);
    expect(cargo.holderId).toBe(hauler.id);
    expect(cargo.haulTaskId).toBe(task.id);

    step(tw, 3600); // an hour of world time, several strategic ticks, owner standing at their own workplace throughout

    const missingEvents = tw.world.events.filter(e => e.type === 'item_missing' && e.item === cargo.id);
    expect(missingEvents).toHaveLength(0);
    expect(owner.knowledge[`missing:${cargo.id}`]).toBeUndefined();
    expect(owner.desires.some(d => d.type === 'recover_item' && d.targetId === cargo.id)).toBe(false);
  });

  it('a genuinely missing item (no haul task) still triggers item_missing and a recover_item desire', () => {
    const tw = createTestWorld(701);
    tw.world.rng = new AlwaysRNG() as unknown as RNG;
    const owner = addPerson(tw, 'Owner', 'baker', tw.world.place(tw.places.chapel)!.inside, { workId: tw.places.chapel });
    addPerson(tw, 'Taker', 'apprentice', tw.world.place(tw.places.tavern)!.inside);
    const taker = tw.world.persons().find(p => p.name === 'Taker')!;
    // Directly construct an item owned by `owner` but held by someone else, with NO haul task —
    // the same shape a real theft (or a bug) would leave behind.
    const it = makeItem(tw.world, 'hammer', 'a hammer', { owner: owner.id, holder: taker.id });
    expect(it.haulTaskId).toBeUndefined();

    step(tw, 3600);

    const missingEvents = tw.world.events.filter(e => e.type === 'item_missing' && e.item === it.id);
    expect(missingEvents.length).toBeGreaterThan(0);
    expect(owner.knowledge[`missing:${it.id}`]).toBeTruthy();
    expect(owner.desires.some(d => d.type === 'recover_item' && d.targetId === it.id)).toBe(true);
  });
});
