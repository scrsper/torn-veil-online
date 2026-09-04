import type { EntityId, Person, Request, RequestPayload, RequestType } from './types';
import type { World } from './world';

/**
 * The shared Request lifecycle (v0.4 §9-10). See the `Request` doc comment in types.ts for why
 * this exists alongside `HaulTask`/`ConstructionProject` rather than instead of them. Payment
 * is real, conserved currency (Constitution v0.4 §10) — `completeRequest` is the ONLY place a
 * worker is paid for accepted work, so haul wages and construction wages go through one audited
 * path instead of each inventing its own money-moving code.
 */

export interface RequestSpec {
  type: RequestType;
  requesterId: EntityId | null;
  requesterPlaceId?: EntityId;
  reward: number;
  cause: string;
  payload: RequestPayload;
}

/** Human-readable label for a request type, used only in event summaries. */
export function requestTypeLabel(type: RequestType): string {
  return type === 'haul' ? 'hauling' : type === 'production' ? 'production' : 'construction labour';
}

export function createRequest(world: World, s: RequestSpec): Request {
  const r: Request = {
    id: world.nextId('req'), type: s.type, status: 'open', requesterId: s.requesterId, requesterPlaceId: s.requesterPlaceId,
    createdAt: world.now, reward: Math.max(0, s.reward), cause: s.cause, payload: s.payload,
  };
  world.requests.push(r);
  world.emit('request_created', {
    placeId: s.requesterPlaceId, significance: 0.05,
    data: { requestId: r.id, type: r.type, reward: r.reward, cause: r.cause },
    summary: `A request for ${requestTypeLabel(r.type)} was raised — ${r.cause}`,
  });
  return r;
}

export function acceptRequest(world: World, r: Request, worker: Person): void {
  if (r.status !== 'open') return;
  r.status = 'accepted'; r.acceptedBy = worker.id; r.acceptedAt = world.now;
  world.emit('request_accepted', {
    actor: worker.id, placeId: r.requesterPlaceId, significance: 0.05,
    data: { requestId: r.id, type: r.type },
    summary: `${worker.name} took on a ${requestTypeLabel(r.type)} request`,
  });
}

/**
 * A payer never pays more than they actually have (Constitution v0.4 §10 — no negative wealth
 * unless debt is deliberately implemented, which it isn't). A request with no resolvable payer
 * (an ownerless workplace) pays nothing — real physical work still happened, it just wasn't
 * commissioned by anyone able to fund it; this is honest under-payment, not currency creation.
 * Returns the amount actually transferred (0..nominal).
 */
export function payWage(world: World, payerId: EntityId | null, worker: Person, nominal: number): number {
  if (nominal <= 0) return 0;
  const payer = payerId ? world.person(payerId) : undefined;
  if (!payer || !payer.alive) return 0;
  const amount = Math.max(0, Math.min(nominal, payer.wealth));
  if (amount <= 0) return 0;
  payer.wealth -= amount; worker.wealth += amount;
  world.runTally.wage_paid_amount = (world.runTally.wage_paid_amount ?? 0) + amount;
  world.emit('wage_paid', {
    actor: payer.id, target: worker.id, significance: 0.08,
    data: { amount, nominal }, summary: `${payer.name} paid ${worker.name} ${amount} silver for their work`,
  });
  return amount;
}

/** Completing a request pays the accepted worker (Constitution v0.4 §10-11) and closes it.
 * Never called for work that didn't actually happen — callers (haul.ts's deliver step,
 * construction.ts's labour credit) only call this once the physical result is real. */
export function completeRequest(world: World, r: Request): number {
  if (r.status !== 'accepted' && r.status !== 'open') return 0;
  const worker = r.acceptedBy ? world.person(r.acceptedBy) : undefined;
  const paid = worker ? payWage(world, r.requesterId, worker, r.reward) : 0;
  r.status = 'completed'; r.completedAt = world.now;
  world.emit('request_completed', {
    actor: r.acceptedBy, placeId: r.requesterPlaceId, significance: 0.08,
    data: { requestId: r.id, type: r.type, paid },
    summary: `${r.acceptedBy ? world.nameOf(r.acceptedBy) : 'Someone'} completed a ${r.type === 'haul' ? 'haul' : requestTypeLabel(r.type)} request${paid ? ` and was paid ${paid} silver` : ''}`,
  });
  return paid;
}

/** Failed work is never paid (Constitution v0.4 §22 "failed work does not pay"). */
export function failRequest(world: World, r: Request, reason: string): void {
  if (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled') return;
  r.status = 'failed';
  world.emit('request_failed', {
    actor: r.acceptedBy, placeId: r.requesterPlaceId, significance: 0.08,
    data: { requestId: r.id, type: r.type, reason }, summary: `A ${r.type} request failed: ${reason}`,
  });
}

export function cancelRequest(world: World, r: Request): void {
  if (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled') return;
  r.status = 'cancelled';
}

export function openRequests(world: World): Request[] { return world.requests.filter(r => r.status === 'open'); }
export function requestFor(world: World, predicate: (r: Request) => boolean): Request | undefined { return world.requests.find(predicate); }

// ---------------------------------------------------------------- observability
export interface RequestSummary { open: number; accepted: number; completed: number; failed: number; totalWagesPaid: number; }
export function requestSummary(world: World): RequestSummary {
  return {
    open: world.requests.filter(r => r.status === 'open').length,
    accepted: world.requests.filter(r => r.status === 'accepted').length,
    completed: world.requests.filter(r => r.status === 'completed').length,
    failed: world.requests.filter(r => r.status === 'failed').length,
    totalWagesPaid: world.runTally.wage_paid_amount ?? 0,
  };
}
