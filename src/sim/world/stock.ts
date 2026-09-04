import type { Item, ItemType, EntityId, EventId } from '../core/types';
import type { World } from '../core/world';
import { makeItem, ITEM_LABEL } from './factory';

/**
 * First-class material stock at Places (v0.3 Living World I, Priority 1).
 *
 * A "stockpile" is not a new database — it is exactly the existing `Item` entity model: an
 * `Item` with `placeId` set, no `holderId`, and `quantity > 0` is a stack physically present
 * at that Place. Ownership (`ownerId`) is tracked separately from physical location
 * (`placeId`), so "20 grain at the North Farm owned by Alwin" is a different stack from "20
 * grain at the Mill owned by the miller" even though both are `grain`.
 *
 * The world can answer "how much X is at Place P" (and its inverse) efficiently through these
 * helpers. Deterministic: `takePlaceStock` always drains the lowest-id stack first, never a
 * Map/Set iteration order.
 */

/** Every unheld stack of `type` physically at `placeId`. */
export function stockItemsAt(world: World, type: ItemType, placeId: EntityId): Item[] {
  return world.items().filter(i => i.type === type && !i.holderId && i.quantity > 0 && i.placeId === placeId);
}

/** How many units of `type` are physically at `placeId` (unheld stacks only). */
export function stockAt(world: World, type: ItemType, placeId: EntityId): number {
  let n = 0;
  for (const i of world.items()) if (i.type === type && !i.holderId && i.quantity > 0 && i.placeId === placeId) n += i.quantity;
  return n;
}

/** How many units of `type` are physically at any of `placeIds`. */
export function stockTotal(world: World, type: ItemType, placeIds: EntityId[]): number {
  const set = placeIds.length > 6 ? new Set(placeIds) : null;
  let n = 0;
  for (const i of world.items()) {
    if (i.type !== type || i.holderId || i.quantity <= 0 || !i.placeId) continue;
    if (set ? set.has(i.placeId) : placeIds.includes(i.placeId)) n += i.quantity;
  }
  return n;
}

/** How much of `type` exists anywhere in the world — at a Place, carried, or lying loose. */
export function worldStock(world: World, type: ItemType): number {
  let n = 0;
  for (const i of world.items()) if (i.type === type && i.quantity > 0) n += i.quantity;
  return n;
}

/**
 * Add `qty` units of `type` to a Place's stock, merging into the existing unheld stack there
 * when one exists (so a Place holds at most one stack of each resource type). Records
 * provenance. Returns the stack.
 */
export function addPlaceStock(world: World, type: ItemType, qty: number, placeId: EntityId, ownerId: EntityId | null, eventId: EventId | undefined, how: string): Item {
  const place = world.place(placeId);
  const existing = world.items().find(i => i.type === type && !i.holderId && i.placeId === placeId);
  if (existing) {
    existing.quantity += qty;
    if (existing.quantity > 0 && !existing.pos && place) existing.pos = { ...place.inside };
    existing.provenance.push({ tick: world.now, eventId, from: null, to: ownerId, how });
    return existing;
  }
  const it = makeItem(world, type, ITEM_LABEL[type], {
    owner: ownerId, pos: place ? { ...place.inside } : undefined, placeId, quantity: qty,
  });
  it.provenance.push({ tick: world.now, eventId, from: null, to: ownerId, how });
  return it;
}

/**
 * Remove up to `qty` units of `type` from the given Places, oldest stack first (deterministic
 * by id). Returns how many units were actually removed. A drained stack is emptied in place
 * (quantity 0, detached from the world) rather than deleted, so its provenance and any event
 * references stay valid (Constitution VII). It is inert once quantity 0.
 */
export function takePlaceStock(world: World, type: ItemType, qty: number, placeIds: EntityId[]): number {
  let need = qty;
  const set = placeIds.length > 6 ? new Set(placeIds) : null;
  const items = world.items()
    .filter(i => i.type === type && !i.holderId && i.quantity > 0 && i.placeId && (set ? set.has(i.placeId) : placeIds.includes(i.placeId)))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const it of items) {
    if (need <= 0) break;
    const take = Math.min(need, it.quantity);
    it.quantity -= take; need -= take;
    if (it.quantity <= 0) retireStack(it);
  }
  return qty - need;
}

/** Detach a fully-consumed/moved stack from the physical world without deleting the entity. */
export function retireStack(it: Item): void { it.pos = null; it.placeId = null; it.holderId = null; }
