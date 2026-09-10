import type { EntityId, ItemType } from '../core/types';
import type { World } from '../core/world';
import { ITEM_VALUE } from './factory';
import { effectivePrice } from './pricing';
import { stockAt } from './stock';

/** Wholesale procurement transfers existing money from a workplace operator to the actual
 * owner of the input goods. Haulers settle at pickup, before taking title; quantity is capped
 * by available funds. Posted bulk prices follow source scarcity and leave a handling margin.
 * No purchase, wage or inventory entry is an external source of currency. */

/** Destinations that procure real inputs or retail stock. The living operator pays, except
 * at a construction site where the project's owner is the buyer. */
export const WHOLESALE_DEST_TYPES = new Set<import('../core/types').Place['type']>(['mill', 'bakery', 'sawpit', 'construction', 'tavern', 'stall', 'store']);

/** Contracting party for ongoing business. Existing title and old stock are untouched.
 * A vacant trade's actual replacement can own new output and buy its next inputs, rather
 * than producing for a dead wallet. Work stints are evidence of work already performed. */
export function economicOperatorFor(world: World, placeId: EntityId): EntityId | null {
  const place = world.place(placeId); if (!place) return null;
  for (const id of [place.ownerId, ...place.workers]) if (world.person(id)?.alive) return id!;
  const stint = world.workStints.filter(s => s.placeId === placeId && !s.endedAt && s.batches > 0 && world.person(s.personId)?.alive)
    .sort((a,b)=>a.startedAt-b.startedAt || a.id.localeCompare(b.id))[0];
  return stint?.personId ?? null;
}

export function wholesaleUnitPrice(world: World, type: ItemType, sourcePlaceId?: EntityId): number {
  // Bulk procurement leaves room for retail handling and spoilage; scarcity still moves
  // both prices. This is a posted price, not a guarantee that a business makes a profit.
  return sourcePlaceId ? Math.max(1, Math.floor(effectivePrice(type, ITEM_VALUE[type], stockAt(world, type, sourcePlaceId)) * 0.8)) : Math.max(1, Math.round(ITEM_VALUE[type]));
}

/**
 * Pay for the wholesale purchase before taking title to its goods. The procurement caller
 * must cap quantity to affordability before transferring materials. This transfer defensively
 * caps payment to the buyer's wallet; a partial payment never authorizes taking unpaid units.
 * Missing/dead parties and self-transfers pay zero.
 */
export function settleWholesale(world: World, sellerId: EntityId | null | undefined, buyerId: EntityId | null | undefined, type: ItemType, qty: number, destPlaceId: EntityId, sourcePlaceId?: EntityId): number {
  if (!sellerId || !buyerId || sellerId === buyerId || qty <= 0) return 0;
  const seller = world.person(sellerId); const buyer = world.person(buyerId);
  if (!seller || !seller.alive || !buyer || !buyer.alive) return 0;
  const unit = wholesaleUnitPrice(world, type, sourcePlaceId);
  const nominal = unit * qty;
  const amount = Math.max(0, Math.min(nominal, buyer.wealth));
  if (amount <= 0) return 0;
  buyer.wealth -= amount; seller.wealth += amount;
  world.runTally.wholesale_amount = (world.runTally.wholesale_amount ?? 0) + amount;
  world.emit('purchase_made', {
    actor: buyer.id, target: seller.id, placeId: destPlaceId, significance: 0.05,
    data: { amount, qty, item: type, wholesale: true },
    summary: `${buyer.name} paid ${seller.name} ${amount} silver wholesale for ${qty} ${type}`,
  });
  return amount;
}

/** The real buyer for a wholesale-eligible delivery: the destination Place's own operator, or —
 * for a construction site, which has none of its own — the project's owner (the same person
 * `world/construction.ts`'s `performBuildLabor` already pays labour wages from). `undefined`
 * (not a wholesale-eligible destination) is distinct from `null` (eligible, but no resolvable
 * payer — an ownerless workplace, same honest-under-payment spirit as `payWage`'s own doc
 * comment: real work/goods that nobody could fund, not currency creation). */
export function wholesaleBuyerFor(world: World, destPlaceId: EntityId, projectId?: EntityId): EntityId | null | undefined {
  const dest = world.place(destPlaceId);
  if (!dest || !WHOLESALE_DEST_TYPES.has(dest.type)) return undefined;
  if (dest.type === 'construction') {
    const project = projectId ? world.constructionProjects.find(p => p.id === projectId) : undefined;
    return project ? project.ownerId : null;
  }
  return economicOperatorFor(world, dest.id);
}
