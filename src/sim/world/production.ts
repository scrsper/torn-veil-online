import type { EntityId, ItemType, PlaceType, Request } from '../core/types';
import type { World } from '../core/world';
import { stockAt } from './stock';
import { createRequest, acceptRequest, completeRequest, openRequests } from '../core/requests';
import { BAKE_RATIO } from './metabolism';

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

interface ProductionSpec { placeType: PlaceType; resource: ItemType; target: number; trigger: number; batchOut: number; reason: string; }

/** Only bread/bakery in v0.5 — the milestone's own scope control (§XIV: "no dozens of crops/
 * tools"). The shape generalizes to more producers later without a redesign. */
const PRODUCTION_TARGETS: ProductionSpec[] = [
  { placeType: 'bakery', resource: 'bread', target: 60, trigger: 30, batchOut: BAKE_RATIO.out, reason: 'the bakery is low on bread' },
];

/** A modest, flat wage per accepted batch — deliberately simple (Constitution v0.5 §18: static
 * capability-based wage, no bidding loop), the same "real, conserved, but not a market-clearing
 * price" spirit as `HAUL_BASE_WAGE`/`CONSTRUCTION_WAGE_PER_SECOND`. */
const PRODUCTION_WAGE_PER_BATCH = 3;

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
    const place = world.places().find(p => p.type === spec.placeType);
    if (!place) continue;
    const have = stockAt(world, spec.resource, place.id);
    const pipeline = openProductionRequests(world)
      .filter(r => r.payload.placeId === place.id && r.payload.resource === spec.resource)
      .reduce((n, r) => n + (r.payload.quantity ?? 0), 0);
    if (have + pipeline >= spec.trigger) continue;
    createRequest(world, {
      type: 'production', requesterId: place.ownerId ?? place.workers[0] ?? null, requesterPlaceId: place.id,
      reward: PRODUCTION_WAGE_PER_BATCH, cause: spec.reason,
      payload: { resource: spec.resource, quantity: spec.batchOut, placeId: place.id },
    });
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
export function fulfillProductionRequest(world: World, req: Request, worker: import('../core/types').Person, produced: boolean): number {
  if (req.status === 'open') acceptRequest(world, req, worker);
  if (!produced) return 0;
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
    // Nominal reward is fixed (PRODUCTION_WAGE_PER_BATCH) and payment is only ever reduced by
    // payer insolvency (core/requests.ts's `payWage`) — summing nominal rewards is a close,
    // honest approximation without needing a separate per-request-type wage tally.
    wagesPaid: completed.reduce((n, r) => n + r.reward, 0),
  };
}
