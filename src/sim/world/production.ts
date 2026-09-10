import type { EntityId, ItemType, Place, PlaceType, Request } from '../core/types';
import type { World } from '../core/world';
import { unreservedStockAt } from './stock';
import { economicOperatorFor } from './trade';
import { createRequest, acceptRequest, completeRequest, openRequests } from '../core/requests';
import { BAKE_RATIO, MILL_RATIO, PLANK_BASE_BUFFER, SAW_RATIO, plankCapFor } from './metabolism';
import { MEAT_TO_STEW_RATIO } from './cooking';

/**
 * Autonomous production demand (v0.5 §IV) — the first request-driven producer beyond hauling/
 * construction. A bakery whose bread stock has fallen below its desired reserve raises a
 * `production` Request (core/requests.ts), exactly like a consumer Place raising a haul need
 * (logistics/haul.ts's `generateLogisticsNeeds`) — world demand → a shared Request → a worker
 * with the right capability/workplace decides to accept it → the real transform (world/
 * metabolism.ts's `bake`) happens → the request completes and pays a wage. This is deliberately
 * NOT "every morning bake 10 bread" — no production happens without an accepted request, and no
 * request exists unless the bakery is genuinely short (Constitution v0.5 §14: prefer "bakery
 * raises production demand because bread stock is below desired reserve" over a schedule).
 */

export interface ProductionSpec {
  placeType: PlaceType; resource: ItemType; target: number; trigger: number; batchOut: number; reason: string;
  /**
   * A reserve that is not a fixed larder but the size of what has actually been asked for.
   *
   * A bakery wants roughly the same amount of bread on the shelf whatever else is happening; a
   * sawpit wants exactly as many planks as the village currently has projects for, and no more —
   * `world/metabolism.ts`'s `plankCapFor` is already the canonical answer to that, and it exists
   * because an oversized standing plank buffer was measured wasting two-thirds of the world's
   * lifetime timber on stock nobody had asked for. Optional, so the ordinary case stays two plain
   * numbers; when present it overrides both, and every reader resolves it through
   * `reserveFor` rather than reading `target`/`trigger` directly.
   */
  reserve?: (world: World, place: Place) => { target: number; trigger: number };
}

/** The reserve this place wants of this resource right now — the one place both the demand pass
 * and `world/labor.ts`'s under-served derivation ask, so the two can never disagree. */
export function reserveFor(world: World, spec: ProductionSpec, place: Place): { target: number; trigger: number } {
  return spec.reserve ? spec.reserve(world, place) : { target: spec.target, trigger: spec.trigger };
}

/** Bread/bakery (v0.5) plus flour/mill (v0.6 §VIII — the second production/work domain the
 * milestone asks be converted from unconditional cadence to demand-aware). The shape
 * generalizes to more producers later without a redesign (Constitution's own scope control:
 * "no dozens of crops/tools" — two is the deliberate stopping point for this milestone).
 * Bread's own target/trigger are unchanged from v0.5 — real evidence (see docs/
 * V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md §II) showed the tavern's permanently-unrestocked ale
 * (fixed below, `restockTavern`) and the 30-minute food-search give-up window were the dominant
 * causes of elevated hunger, not this trigger, so it was left as-is rather than widened blindly. */
/** v0.8 §P0-E: exported so `mind/agent.ts`'s harvest gate can reuse the SAME "is bread actually
 * short" threshold this file already uses to decide when to raise a baking request, instead of
 * inventing a second magic number that could drift out of sync with it. */
export const BREAD_SHORTAGE_TRIGGER = 30;
const PRODUCTION_TARGETS: ProductionSpec[] = [
  { placeType: 'bakery', resource: 'bread', target: 60, trigger: BREAD_SHORTAGE_TRIGGER, batchOut: BAKE_RATIO.out, reason: 'the bakery is low on bread' },
  { placeType: 'mill', resource: 'flour', target: 45, trigger: 24, batchOut: MILL_RATIO.out, reason: 'the mill is low on flour' },
  // v0.8 §D: the tavern's stew — the first production process demand-gated on both a stock
  // deficit AND real fire/heat (world/cooking.ts's `cook`, which returns `produced: 0` and
  // therefore never pays a wage if the hearth isn't genuinely burning hot enough).
  { placeType: 'tavern', resource: 'stew', target: 18, trigger: 8, batchOut: MEAT_TO_STEW_RATIO.out, reason: 'the tavern is low on stew' },
  // The sawpit's planks. Converted from an unconditional per-cadence `saw()` call to the same
  // demand-driven Request shape every other producer uses, which is what lets the sawpit become a
  // real `TradeProcess` (world/labor.ts): under-servedness is defined by demand a place has
  // genuinely raised and cannot fill, and a place that never raises one can never be found short
  // of hands. The reserve is `plankCapFor` — the open plank deficit across live construction
  // projects plus a small base buffer — so the sawpit is asked for exactly the timber the village
  // has projects for, which is the same bound the transform itself already respected.
  {
    placeType: 'sawpit', resource: 'plank', target: PLANK_BASE_BUFFER, trigger: PLANK_BASE_BUFFER, batchOut: SAW_RATIO.out,
    reason: 'the sawpit is short of planks for the work in hand',
    reserve: (world) => { const cap = plankCapFor(world); return { target: cap, trigger: cap }; },
  },
];

/** A modest, flat wage per accepted batch — deliberately simple (Constitution v0.5 §18: static
 * capability-based wage, no bidding loop), the same "real, conserved, but not a market-clearing
 * price" spirit as `HAUL_BASE_WAGE`/`CONSTRUCTION_WAGE_PER_SECOND`. */
const PRODUCTION_WAGE_PER_BATCH = 3;

/**
 * The canonical "which place puts out what" record, read-only. Exposed so the trades table in
 * `world/supply.ts` — which is a DESCRIPTION of these processes for minds to reason with, never a
 * second authority over them — can be checked against them and fail loudly when the two drift
 * apart. Nothing in the simulation reads it through this accessor.
 */
export function productionSpecs(): readonly ProductionSpec[] { return PRODUCTION_TARGETS; }

export function openProductionRequests(world: World): Request[] {
  return world.requests.filter(r => r.type === 'production' && (r.status === 'open' || r.status === 'accepted'));
}

/**
 * Deterministic per-upkeep raise of production demand (Priority: same ~10 world-minute cadence
 * as `generateLogisticsNeeds`). Pipeline-aware (Constitution v0.5 §16): current stock PLUS
 * whatever is already open/accepted counts toward the target, so a bakery that is already
 * waiting on one accepted batch does not raise a second, redundant one just because bread is
 * still below target this exact tick — the same principle `generateLogisticsNeeds`/
 * `projectDeficits` already use for hauling.
 */
export function generateProductionNeeds(world: World): void {
  for (const spec of PRODUCTION_TARGETS) {
    for (const place of world.places().filter(p => p.type === spec.placeType)) {
      const { trigger } = reserveFor(world, spec, place);
      const have = unreservedStockAt(world, spec.resource, place.id);
      const pipeline = openProductionRequests(world)
        .filter(r => r.payload.placeId === place.id && r.payload.resource === spec.resource)
        .reduce((n, r) => n + Math.max(0, (r.payload.quantity ?? 0) - (r.fulfilledQuantity ?? 0)), 0);
      if (have + pipeline >= trigger) continue;
      createRequest(world, {
        type: 'production', requesterId: economicOperatorFor(world, place.id), requesterPlaceId: place.id,
        reward: PRODUCTION_WAGE_PER_BATCH, cause: spec.reason,
        payload: { resource: spec.resource, quantity: spec.batchOut, placeId: place.id },
      });
    }
  }
}

/**
 * The cognition-facing query a worker's batch cadence (mind/agent.ts's 'work' action) reads: is
 * there real, current demand for THIS resource at THIS place they could fulfill right now? An
 * already-accepted-by-me request takes priority (finish what I started); otherwise the oldest
 * open one. Returns undefined when there is no real demand — the caller must then NOT produce
 * (Constitution v0.5 §14: "do not simply call bake() because stock is low").
 */
export function claimedProductionRequest(world: World, placeId: EntityId, resource: ItemType, workerId: EntityId): Request | undefined {
  const mine = world.requests.find(r => r.type === 'production' && r.status === 'accepted' && r.acceptedBy === workerId && r.payload.placeId === placeId && r.payload.resource === resource);
  if (mine) return mine;
  return openRequests(world).find(r => r.type === 'production' && r.payload.placeId === placeId && r.payload.resource === resource);
}

/** Accept (if needed) and, once the physical batch actually produced something, complete and
 * pay the request. A batch that produced nothing (still short of flour) leaves the request
 * accepted/open for the next batch attempt — never paid for work that didn't happen. */
export function fulfillProductionRequest(world: World, req: Request, worker: import('../core/types').Person, produced: boolean | number): number {
  if (req.status !== 'open' && !(req.status === 'accepted' && req.acceptedBy === worker.id)) return 0;
  if (req.status === 'open') acceptRequest(world, req, worker);
  if (!produced) return 0;
  if (typeof produced === 'number') {
    if (!Number.isFinite(produced) || produced <= 0) return 0;
    req.fulfilledQuantity = Math.min(req.payload.quantity ?? produced, (req.fulfilledQuantity ?? 0) + produced);
    if (req.fulfilledQuantity < (req.payload.quantity ?? produced) - 1e-9) return 0;
  }
  return completeRequest(world, req);
}

// ---------------------------------------------------------------- observability
export interface ProductionSummary { open: number; accepted: number; completed: number; failed: number; wagesPaid: number; }
export function productionSummary(world: World): ProductionSummary {
  const rs = world.requests.filter(r => r.type === 'production');
  const completed = rs.filter(r => r.status === 'completed');
  return {
    open: rs.filter(r => r.status === 'open').length,
    accepted: rs.filter(r => r.status === 'accepted').length,
    completed: completed.length,
    failed: rs.filter(r => r.status === 'failed').length,
    // Actual transfers, including insolvency and self-work, survive request persistence.
    wagesPaid: completed.reduce((n, r) => n + (r.paid ?? 0), 0),
  };
}
