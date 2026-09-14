import { describe, expect, it } from 'vitest';
import { makeContainer, takeItemFromContainer, transferItemToContainer } from '../src/sim/core/container';
import { deserialize, serialize } from '../src/sim/persist/save';
import { makeItem } from '../src/sim/world/factory';
import { addPerson, createTestWorld, v } from './helpers/world';

describe('canonical physical containers', () => {
  it('moves an item stack between a person and an open container without changing ownership', () => {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10));
    const container = makeContainer(tw.world, { name: 'Storage chest', open: true, capacity: 10, pos: v(10, 1, 11) });
    const item = makeItem(tw.world, 'bread', 'bread', { owner: person.id, holder: person.id, quantity: 2 });

    const stored = transferItemToContainer(tw.world, person, item, container);
    expect(stored.ok).toBe(true);
    expect(person.inventory).not.toContain(item.id);
    expect(container.itemIds).toEqual([item.id]);
    expect(item.containerId).toBe(container.id);
    expect(item.ownerId).toBe(person.id);

    const retrieved = takeItemFromContainer(tw.world, person, container, item);
    expect(retrieved.ok).toBe(true);
    expect(person.inventory).toContain(item.id);
    expect(container.itemIds).toHaveLength(0);
    expect(item.containerId).toBeNull();
    expect(item.holderId).toBe(person.id);
  });

  it('rejects closed, over-capacity, and non-carried transfers without partial mutation', () => {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10));
    const closed = makeContainer(tw.world, { name: 'Closed chest', capacity: 1 });
    const item = makeItem(tw.world, 'bread', 'bread', { owner: person.id, holder: person.id, quantity: 2 });
    expect(transferItemToContainer(tw.world, person, item, closed)).toMatchObject({ ok: false, reason: 'container_closed' });
    closed.open = true;
    expect(transferItemToContainer(tw.world, person, item, closed)).toMatchObject({ ok: false, reason: 'capacity_exceeded' });
    expect(person.inventory).toContain(item.id);
    expect(closed.itemIds).toHaveLength(0);
  });

  it('round-trips container identity, contents, and item location through save/load', () => {
    const tw = createTestWorld();
    const person = addPerson(tw, 'Traveler', 'traveler', v(10, 1, 10));
    const container = makeContainer(tw.world, { name: 'Persistent chest', open: true, capacity: 20, placeId: tw.places.tavern, pos: v(12, 1, 12) });
    const item = makeItem(tw.world, 'ring', 'ring', { owner: person.id, holder: person.id });
    expect(transferItemToContainer(tw.world, person, item, container).ok).toBe(true);
    const restored = deserialize(serialize(tw.world))!.world;
    const restoredContainer = restored.container(container.id)!;
    const restoredItem = restored.item(item.id)!;
    expect(restoredContainer.itemIds).toEqual([item.id]);
    expect(restoredContainer.open).toBe(true);
    expect(restoredItem.containerId).toBe(container.id);
    expect(restoredItem.holderId).toBeNull();
    expect(restored.person(person.id)!.inventory).not.toContain(item.id);
  });
});
