import type { Item, ItemType, EntityId, EventId } from '../core/types';
import type { World } from '../core/world';
import { makeItem, ITEM_LABEL, isPerishable } from './factory';

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
  return world.itemsAtPlaces([placeId]).filter(i => i.type === type && !i.holderId && i.quantity > 0 && i.placeId === placeId);
}

/** How many units of `type` are physically at `placeId` (unheld stacks only). */
export function stockAt(world: World, type: ItemType, placeId: EntityId): number {
  let n = 0;
  for (const i of world.itemsAtPlaces([placeId])) if (i.type === type && !i.holderId && i.quantity > 0 && i.placeId === placeId) n += i.quantity;
  return n;
}

/** Stock already promised outwards must be replaced by production, even before a carrier
 * collects it. A promise never increases physical stock and remains derived from live hauls. */
export function outboundStock(world: World, type: ItemType, placeId: EntityId, claimedOnly = false): number {
  return world.haulTasks.filter(t => t.sourcePlaceId === placeId && t.resource === type
    && ((!claimedOnly && t.status === 'needed') || t.status === 'claimed' || t.status === 'in_transit'))
    .reduce((n, t) => n + Math.max(0, t.quantity - t.delivered - t.carried), 0);
}

export function unreservedStockAt(world: World, type: ItemType, placeId: EntityId): number {
  // Estate stock remains physical property, but cannot currently reach buyers. It must
  // not suppress a replacement operator's production demand as though it were for sale.
  const available = stockItemsAt(world, type, placeId).filter(i => {
    const owner = world.person(i.ownerId); return !owner || owner.alive;
  }).reduce((n,i)=>n+i.quantity,0);
  return Math.max(0, available - outboundStock(world, type, placeId));
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
 * when one exists (so a Place holds at most one stack of each resource type) — EXCEPT for
 * perishables (v0.4 §14), which always start a fresh stack. `Item.createdAt` is that stack's
 * batch age (see world/metabolism.ts's `stepSpoilage`); merging a fresh delivery into an older
 * stack would apply the older stack's spoilage-accumulator pressure to units that just arrived
 * (the v0.3 "replenishment resets/skews spoilage" limitation this fixes) — `takePlaceStock`
 * already drains oldest-stack-first, so multiple perishable stacks per Place FIFO correctly
 * with no other change needed anywhere that reads stock. Non-perishables keep single-stack
 * merging (no aging to get wrong, and it keeps the item count down). Records provenance.
 * Returns the stack.
 */
export function addPlaceStock(world: World, type: ItemType, qty: number, placeId: EntityId, ownerId: EntityId | null, eventId: EventId | undefined, how: string): Item {
  const place = world.place(placeId);
  const existing = isPerishable(type) ? undefined : world.itemsAtPlaces([placeId]).find(i => i.type === type && !i.holderId && i.placeId === placeId && i.ownerId === ownerId);
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
    if (it.quantity <= 0) retireStack(world, it);
  }
  return qty - need;
}

/** Detach a fully-consumed/moved stack from the physical world without deleting the entity. */
/**
 * A stack that has left the world: nothing holds it, it is nowhere, and it has no quantity. The
 * entity itself STAYS, inert, because its provenance and the events naming it must remain valid
 * (Constitution VII).
 *
 * v0.10.1: this also drops the id from whoever was carrying it. It could not before — it had no
 * `world` to resolve the holder — so every caller had to remember to do it, against the person
 * they happened to have in hand. `depositHaulCargo` removed it from the DEPOSITOR, which is the
 * same person only while one hauler both loads and delivers; when a cargo changed hands the
 * original carrier kept an id pointing at a retired stack for the rest of the run. Found by the
 * player-trade spec's ghost-inventory audit, on a guard who had picked up a log that somebody
 * else went on to deliver.
 *
 * Doing it here rather than at each call site is what makes `Person.inventory`, `holderId`,
 * `placeId` and `pos` go inconsistent-free together, once, on the one transition that ends a
 * stack's physical life.
 */
export function retireStack(world: World, it: Item): void {
  if (it.holderId) {
    const holder = world.person(it.holderId);
    if (holder) holder.inventory = holder.inventory.filter(id => id !== it.id);
  }
  it.pos = null; it.placeId = null; it.holderId = null;
}
