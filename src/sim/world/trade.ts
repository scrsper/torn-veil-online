import type { EntityId, ItemType } from '../core/types';
import type { World } from '../core/world';
import { ITEM_VALUE } from './factory';

/**
 * Wholesale trade (v0.7 §A) — the missing link v0.6 disclosed (docs/
 * V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md §3.4): a haul delivery already moves goods physically
 * from a producer to a consumer, but ownership of the delivered stock silently transferred to
 * the consumer's side for free (`logistics/haul.ts`'s `loadHaulCargo` reassigns the cargo's
 * `ownerId` to the requester at pickup). Farmers, millers, sawyers and quarriers therefore had
 * no real income from the resources they actually produced — only from hauling/building labour
 * itself, which is a real but separate wage. This module closes that gap with one small,
 * general mechanism: when a wholesale-eligible delivery lands, the RECEIVING side's operator
 * pays the ORIGINAL PRODUCER for the goods, in real conserved currency, capped by what the
 * payer actually has (Constitution: "a payer never pays more than they have" — the same rule
 * `core/requests.ts`'s `payWage` and `world/metabolism.ts`'s `buyFoodPortion` already follow).
 *
 * Deliberately NOT a market: flat per-unit prices (`ITEM_VALUE`, the same base values retail
 * pricing already starts from), no bidding, no scarcity curve — Constitution's own "no full
 * market pricing yet" applies as much to this internal wholesale leg as it does to haul/
 * production wages. The result is a real, causal, self-funding chain: the bakery's retail bread
 * revenue (from consumers) pays the miller for flour, which pays the farmer for grain — money
 * flows down the production chain because each stage genuinely buys its input from the stage
 * before it, not because currency was invented to plug a poverty hole.
 */

/** Which (resource, destination Place type) deliveries constitute a real sale, and who pays —
 * resolved from the DESTINATION place's operator (its `ownerId`, falling back to its first
 * worker, exactly like `logistics/haul.ts`'s existing `dest.ownerId ?? dest.workers[0]`
 * convention) except for construction, where the site Place has no operator of its own and the
 * real buyer is the project's owner (the one paying `performBuildLabor`'s wages too). */
export const WHOLESALE_DEST_TYPES = new Set<import('../core/types').Place['type']>(['mill', 'bakery', 'sawpit', 'construction']);

/**
 * Execute (or attempt) the wholesale sale for `qty` units of `type` just delivered to
 * `destPlaceId`, paid by `buyerId` to `sellerId`. Returns the amount actually paid (0 if either
 * party is missing/dead, the parties are the same person — a self-delivery nets nothing and
 * costs nothing, deliberately left as a no-op rather than a pointless self-transfer — or the
 * buyer cannot afford any of it). Never pays more than the buyer currently has (honest
 * under-payment, never manufactured currency, matching `core/requests.ts`'s `payWage`).
 */
export function settleWholesale(world: World, sellerId: EntityId | null | undefined, buyerId: EntityId | null | undefined, type: ItemType, qty: number, destPlaceId: EntityId): number {
  if (!sellerId || !buyerId || sellerId === buyerId || qty <= 0) return 0;
  const seller = world.person(sellerId); const buyer = world.person(buyerId);
  if (!seller || !seller.alive || !buyer || !buyer.alive) return 0;
  const unit = Math.max(1, Math.round(ITEM_VALUE[type] ?? 1));
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
  return dest.ownerId ?? dest.workers[0] ?? null;
}
