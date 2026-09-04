import type { HaulTask, HaulStatus, ItemType, Person, Vec3, EntityId, Place } from '../core/types';
import type { World } from '../core/world';
import { makeItem, ITEM_LABEL, RESOURCE_MASS_KG } from '../world/factory';
import { addPlaceStock, takePlaceStock, retireStack, stockAt, stockItemsAt } from '../world/stock';
import { FARM_SEED_RESERVE } from '../world/metabolism';
import { getPhysicalCapability } from '../core/attributes';
import { createRequest, acceptRequest, completeRequest, failRequest } from '../core/requests';
import { skillOf, practiceSkill } from '../core/skills';
import { settleWholesale, wholesaleBuyerFor } from '../world/trade';

/**
 * Generalized canonical hauling (v0.3 Living World I, Priority 2 & 4).
 *
 * Material needs cause entities to physically move resources through the world. A `HaulTask`
 * says "move N units of R from Place A to Place B, and why". It is generated from world state
 * (a consumer's stock is below its desired level *and* a supplier has surplus), never from a
 * named-NPC schedule. A hauler learns of it (through work/place proximity), decides to take
 * it, walks to the source, physically picks up an available amount, carries it, walks to the
 * destination, and deposits it. No teleportation. If the resource is gone before pickup the
 * task fails cleanly; if the hauler is interrupted the cargo stays canonical (dropped where
 * they are), never vanishing.
 *
 * Deterministic throughout: need generation and task selection sort by numeric priority then
 * string id — never Map/Set iteration order or wall-clock.
 */

// ---- tuning
/** An averagely-attributed, unencumbered adult's safe carry mass (kg) — see
 * core/attributes.ts's `getPhysicalCapability` (strength 0.5, no fatigue/heat penalty: 16 +
 * 0.5*44). Used only to SIZE a not-yet-claimed task (`generateLogisticsNeeds`/`stepConstruction`
 * don't know who will take it yet); the claimant's OWN capacity (`personalCarryUnits`) is what
 * actually gates how much loads onto them per trip — see `loadHaulCargo`. */
const AVERAGE_ADULT_SAFE_CARRY_KG = 38;
/** Units one average person carries per trip, by resource mass (v0.4 §4 — physical mass, not
 * an arbitrary per-resource constant). Falls back to a flat trip size for anything without a
 * mass entry (nothing bulk-hauled lacks one; kept only so this never throws). */
export function carryCapFor(type: ItemType): number {
  const massKg = RESOURCE_MASS_KG[type];
  return massKg ? Math.max(1, Math.floor(AVERAGE_ADULT_SAFE_CARRY_KG / massKg)) : 20;
}
/** v0.4 §4: how many units of `type` THIS person can safely carry in one trip, given their
 * actual strength/fatigue/energy right now (core/attributes.ts). Never 0 — an ordinary human
 * can always drag at least one unit of even the heaviest hauled material, just at real cost
 * (Constitution v0.4 §2 "prefer gradients", §4 "the request can remain one request while
 * fulfillment occurs in partial deliveries"). This is what forces a weak worker to make more
 * trips for the same task instead of the task's `quantity` silently teleporting in one go. */
export function personalCarryUnits(world: World, person: Person, type: ItemType): number {
  const massKg = RESOURCE_MASS_KG[type];
  if (!massKg) return carryCapFor(type);
  // v0.6 §V.8: hauling has no tool-governed ToolAction, so its skill is passed explicitly
  // rather than auto-resolved from an action (see core/attributes.ts).
  const cap = getPhysicalCapability(person, world, { skill: skillOf(person, 'hauling') });
  return Math.max(1, Math.floor(cap.safeCarryMassKg / massKg));
}
/** Desired on-hand stock at a consumer Place, and the level below which a haul is requested. */
interface Demand { destType: Place['type']; resource: ItemType; sourceType: Place['type']; target: number; trigger: number; reason: string; }
const CONSUMER_DEMANDS: Demand[] = [
  { destType: 'mill', resource: 'grain', sourceType: 'farm', target: 55, trigger: 36, reason: 'the mill is low on grain' },
  { destType: 'bakery', resource: 'flour', sourceType: 'mill', target: 34, trigger: 20, reason: 'the bakery is low on flour' },
  { destType: 'stall', resource: 'bread', sourceType: 'bakery', target: 16, trigger: 6, reason: 'the market stall is low on bread' },
  // v0.8 §D: the tavern never had ANY logistics path for meat at all — Kestrel only ever sold it
  // retail at her own stall, so world/cooking.ts's `cook()` (meat -> stew) had no real input to
  // work with regardless of the fire (found by direct headless inspection: `stewsCooked` stayed
  // 0 across an 8-day run even though the fire itself lit and burned correctly). A real physical
  // delivery, same as every other consumer demand here — `world/trade.ts`'s wholesale-trade
  // mechanism pays Kestrel for it automatically (WHOLESALE_DEST_TYPES includes 'tavern').
  { destType: 'tavern', resource: 'meat', sourceType: 'stall', target: 10, trigger: 4, reason: 'the tavern is low on meat for the cook' },
  // v0.8 §C/D: same gap, one resource earlier in the chain — the tavern never had ANY firewood
  // delivery either, so `tendTavernFire`'s own fuel search always found nothing (real headless
  // evidence: the hearth never once lit across an 8-day run despite the fire mechanism itself
  // working correctly in isolation — tests/materials-fire-crafting.test.ts already proves that).
  // `stick` (not `log`) deliberately: it's a free byproduct of felling (world/resources.ts's
  // `extractFromNode`), never consumed by the sawpit/construction chain, so this demand cannot
  // compete with construction's own log needs for the same clearing stock — a real regression
  // found directly (the 12-world-day full-chain construction test blew its time budget when this
  // was `log`, because the tavern's own demand started draining the clearing before the sawpit
  // got enough). `sourceType: 'wilderness'` resolves to the clearing specifically because it's
  // the only wilderness Place that ever holds `stick` stock.
  { destType: 'tavern', resource: 'stick', sourceType: 'wilderness', target: 12, trigger: 4, reason: 'the tavern needs kindling for the hearth' },
];
/** How long (world seconds) a claimed-but-not-progressing task waits before its claim is released. */
const STALE_CLAIM_SECONDS = 40 * 60;
/** How long a resolved (delivered/failed/cancelled) task is kept for observability before pruning. */
const RESOLVED_KEEP_SECONDS = 90 * 60;

const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

export function openHaulTasks(world: World): HaulTask[] {
  return world.haulTasks.filter(t => t.status === 'needed' || t.status === 'claimed' || t.status === 'in_transit');
}
function existingTask(world: World, resource: ItemType, sourceId: EntityId, destId: EntityId): HaulTask | undefined {
  return world.haulTasks.find(t => (t.status === 'needed' || t.status === 'claimed' || t.status === 'in_transit')
    && t.resource === resource && t.sourcePlaceId === sourceId && t.destPlaceId === destId);
}

export interface HaulTaskSpec {
  resource: ItemType; quantity: number; sourcePlaceId: EntityId; destPlaceId: EntityId;
  reason: string; requesterId: EntityId | null; projectId?: EntityId; priority: number;
}
/** v0.4 §11: base wage plus a small per-(kg·metre) rate — a longer haul of heavier cargo pays
 * more, a token amount for a short light one. Deliberately modest (Constitution v0.4 §25 "no
 * full market pricing yet"): this is a real, conserved wage, not a market-clearing price. */
const HAUL_BASE_WAGE = 2;
const HAUL_WAGE_PER_KG_METER = 0.0045;
function haulWage(world: World, s: HaulTaskSpec): number {
  const src = world.place(s.sourcePlaceId), dst = world.place(s.destPlaceId);
  const distance = src && dst ? world.distance2d(src.inside, dst.inside) : 40;
  const massKg = (RESOURCE_MASS_KG[s.resource] ?? 1) * s.quantity;
  return Math.round(HAUL_BASE_WAGE + distance * massKg * HAUL_WAGE_PER_KG_METER);
}

export function createHaulTask(world: World, s: HaulTaskSpec): HaulTask {
  const t: HaulTask = {
    id: world.nextId('haul'), resource: s.resource, quantity: Math.max(1, Math.round(s.quantity)), carried: 0, delivered: 0,
    sourcePlaceId: s.sourcePlaceId, destPlaceId: s.destPlaceId, reason: s.reason, requesterId: s.requesterId,
    projectId: s.projectId, claimantId: null, status: 'needed', priority: Math.max(0, Math.min(1, s.priority)),
    createdAt: world.now, updatedAt: world.now,
  };
  world.haulTasks.push(t);
  // v0.4 §9-10: every haul is also a shared Request — the acceptance/completion/wage envelope
  // (core/requests.ts). The HaulTask keeps owning physical fulfillment (load/carry/deposit).
  const req = createRequest(world, {
    type: 'haul', requesterId: s.requesterId, requesterPlaceId: s.destPlaceId, reward: haulWage(world, s),
    cause: s.reason, payload: { haulTaskId: t.id, resource: t.resource, quantity: t.quantity },
  });
  t.requestId = req.id;
  world.emit('haul_requested', {
    placeId: s.destPlaceId, pos: world.place(s.destPlaceId)?.inside, significance: s.projectId ? 0.3 : 0.15,
    data: { haulId: t.id, resource: t.resource, quantity: t.quantity, from: s.sourcePlaceId, to: s.destPlaceId, reason: s.reason },
    summary: `Someone should carry ${t.quantity} ${t.resource} to ${world.nameOf(s.destPlaceId)} — ${s.reason}`,
  });
  return t;
}

/**
 * Deterministically raise haul needs from current world state (Priority 4). Runs on the ~10
 * world-minute upkeep cadence. Same mechanism serves food logistics, the wood/stone chain, and
 * construction sites — no per-need special-casing beyond the source/destination lookup.
 */
export function generateLogisticsNeeds(world: World): void {
  // 1. Food chain: consumer Place below trigger + a supplier Place with surplus → one task.
  for (const d of CONSUMER_DEMANDS) {
    const dest = world.places().find(p => p.type === d.destType);
    if (!dest) continue;
    const have = stockAt(world, d.resource, dest.id);
    const inbound = openHaulTasks(world).filter(t => t.destPlaceId === dest.id && t.resource === d.resource)
      .reduce((n, t) => n + (t.quantity - t.delivered), 0);
    if (have + inbound >= d.trigger) continue;
    // pick the supplier with the most spare stock (deterministic tiebreak by id)
    const spareAt = (pl: Place) => {
      const s = stockAt(world, d.resource, pl.id);
      return d.sourceType === 'farm' && d.resource === 'grain' ? s - FARM_SEED_RESERVE : s;
    };
    const suppliers = world.places()
      .filter(p => p.type === d.sourceType && spareAt(p) > 0)
      .sort((a, b) => spareAt(b) - spareAt(a) || a.id.localeCompare(b.id));
    const src = suppliers[0];
    if (!src) continue;
    if (existingTask(world, d.resource, src.id, dest.id)) continue;
    const want = Math.min(carryCapFor(d.resource), d.target - have - inbound, Math.floor(spareAt(src)));
    if (want <= 0) continue;
    const priority = Math.min(1, 1 - (have + inbound) / Math.max(1, d.target));
    createHaulTask(world, {
      resource: d.resource, quantity: want, sourcePlaceId: src.id, destPlaceId: dest.id,
      reason: d.reason, requesterId: dest.ownerId ?? dest.workers[0] ?? null, priority,
    });
  }
}

/** A hauler commits to a task. */
export function claimHaulTask(world: World, task: HaulTask, person: Person): void {
  if (task.status !== 'needed') return;
  task.claimantId = person.id; task.status = 'claimed'; task.updatedAt = world.now;
  const req = task.requestId ? world.requests.find(r => r.id === task.requestId) : undefined;
  if (req && req.status === 'open') acceptRequest(world, req, person);
  world.emit('haul_started', {
    actor: person.id, placeId: task.sourcePlaceId, pos: world.primaryBody(person.id)?.pos, significance: 0.12,
    data: { haulId: task.id, resource: task.resource, quantity: task.quantity, from: task.sourcePlaceId, to: task.destPlaceId },
    summary: `${person.name} set out to carry ${task.resource} to ${world.nameOf(task.destPlaceId)}`,
  });
}

/**
 * At the source: physically load up to the available amount into a carried stack — capped at
 * what THIS person can safely carry right now (v0.4 §4), never the full remaining task size.
 * If the task still needs more than fits in one trip, it stays open for another load/deposit
 * cycle by the same claimant (see `depositHaulCargo`) instead of the whole quantity teleporting
 * in on the first load.
 */
export function loadHaulCargo(world: World, task: HaulTask, person: Person): boolean {
  if (task.status !== 'claimed' && task.status !== 'in_transit') return false;
  const avail = stockAt(world, task.resource, task.sourcePlaceId);
  const stillNeeded = task.quantity - task.delivered - task.carried;
  const tripCapacity = Math.max(0, personalCarryUnits(world, person, task.resource) - task.carried);
  const want = Math.min(stillNeeded, tripCapacity);
  const n = Math.min(want, avail);
  if (n <= 0) {
    if (task.carried > 0) { finishInTransit(world, task); return true; } // partial load already aboard — go deliver it
    failHaulTask(world, task, 'nothing left at the source to carry');
    return false;
  }
  // v0.7 §A: capture who actually owned this stock BEFORE `takePlaceStock`/the cargo's own
  // `owner` (below) overwrite it with the requester — the first pickup leg is the only moment
  // this is still recoverable (see world/trade.ts's `settleWholesale` doc comment). Read
  // directly off the oldest matching stack (the one `takePlaceStock` is about to drain first),
  // not the place, so it correctly follows the actual producer even where the Place itself has
  // no fixed owner (the quarry: stone there is owned by whoever quarried it, not a place role).
  if (task.materialSellerId === undefined) {
    const stack = stockItemsAt(world, task.resource, task.sourcePlaceId).sort((a, b) => a.id.localeCompare(b.id))[0];
    task.materialSellerId = stack?.ownerId ?? world.place(task.sourcePlaceId)?.ownerId ?? world.place(task.sourcePlaceId)?.workers[0] ?? null;
  }
  takePlaceStock(world, task.resource, n, [task.sourcePlaceId]);
  let cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  const owner = task.requesterId ?? world.place(task.sourcePlaceId)?.ownerId ?? null;
  if (!cargo) {
    cargo = makeItem(world, task.resource, ITEM_LABEL[task.resource], { owner, holder: person.id, quantity: n });
    cargo.haulTaskId = task.id;
    task.cargoItemId = cargo.id;
  } else {
    cargo.quantity += n;
  }
  task.carried += n; task.status = 'in_transit'; task.updatedAt = world.now;
  world.emit('resource_picked_up', {
    actor: person.id, item: cargo.id, placeId: task.sourcePlaceId, pos: world.primaryBody(person.id)?.pos, significance: 0.12,
    data: { haulId: task.id, resource: task.resource, quantity: n },
    summary: `${person.name} picked up ${n} ${task.resource} at ${world.nameOf(task.sourcePlaceId)}`,
  });
  return true;
}
function finishInTransit(world: World, task: HaulTask): void { task.status = 'in_transit'; task.updatedAt = world.now; }

/**
 * At the destination: deposit the carried stack into the destination Place's stock. v0.4 §4:
 * this may be a PARTIAL delivery — if the task still needs more than this trip carried, it
 * goes back to `claimed` (cargo cleared, same claimant) rather than terminating, so the next
 * `haul` goal cycle for the same task loads and delivers another trip. The Request (and its
 * wage) is only completed once the task is genuinely done — one payment for the whole job, not
 * per trip (Constitution v0.4 §10-11).
 */
export function depositHaulCargo(world: World, task: HaulTask, person: Person): boolean {
  const cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  if (!cargo || cargo.quantity <= 0) { failHaulTask(world, task, 'the cargo was lost'); return false; }
  const n = cargo.quantity;
  person.inventory = person.inventory.filter(id => id !== cargo.id);
  cargo.quantity = 0; cargo.haulTaskId = undefined; retireStack(cargo);
  const owner = task.requesterId ?? world.place(task.destPlaceId)?.ownerId ?? null;
  const ev = world.emit('resource_delivered', {
    actor: person.id, item: cargo.id, placeId: task.destPlaceId, pos: world.place(task.destPlaceId)?.inside, significance: task.projectId ? 0.4 : 0.18,
    data: { haulId: task.id, resource: task.resource, quantity: n, to: task.destPlaceId, projectId: task.projectId },
    summary: `${person.name} delivered ${n} ${task.resource} to ${world.nameOf(task.destPlaceId)}`,
  });
  addPlaceStock(world, task.resource, n, task.destPlaceId, owner, ev.id, 'delivered');
  // v0.7 §A: a real wholesale sale, not just a physical move — the receiving side's operator
  // pays the producer for what just arrived (world/trade.ts). A no-op for destinations that
  // aren't wholesale-eligible (food-chain retail deliveries like bread->stall_bread stay exactly
  // as before) and for a self-delivery (the same person on both sides of the trade).
  const buyer = wholesaleBuyerFor(world, task.destPlaceId, task.projectId);
  if (buyer !== undefined) settleWholesale(world, task.materialSellerId, buyer, task.resource, n, task.destPlaceId);
  task.delivered += n; task.carried = 0; task.updatedAt = world.now;
  task.cargoItemId = undefined;
  // v0.6 §V.9: a real, physically-completed delivery leg is meaningful work — practice once per
  // leg (not per unit, so a heavy single-trip delivery doesn't train faster than a light one).
  practiceSkill(person, 'hauling', 1);
  world.runTally[`hauled:${task.resource}`] = (world.runTally[`hauled:${task.resource}`] ?? 0) + n; // survives task pruning
  const moreToFetch = task.delivered < task.quantity && stockAt(world, task.resource, task.sourcePlaceId) > 0;
  if (moreToFetch) { task.status = 'claimed'; return true; } // another trip needed — stay claimed by the same hauler
  task.status = 'delivered';
  const req = task.requestId ? world.requests.find(r => r.id === task.requestId) : undefined;
  if (req && req.status !== 'completed') completeRequest(world, req);
  return true;
}

/**
 * Fail a task. The carried cargo (if any) is dropped as a loose stack exactly where the hauler
 * is — it stays canonical and can be picked up by a later task. Nothing is destroyed.
 */
export function failHaulTask(world: World, task: HaulTask, reason: string): void {
  if (task.status === 'delivered' || task.status === 'failed' || task.status === 'cancelled') return;
  const claimant = task.claimantId ? world.person(task.claimantId) : undefined;
  const cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  let droppedAt: string | undefined;
  if (cargo && cargo.quantity > 0) {
    const body = claimant ? world.primaryBody(claimant.id) : undefined;
    const pos = body?.pos ?? world.place(task.sourcePlaceId)?.inside ?? { x: 0, y: 0, z: 0 };
    const place = world.placeAt(pos);
    if (claimant) claimant.inventory = claimant.inventory.filter(id => id !== cargo.id);
    cargo.holderId = null; cargo.haulTaskId = undefined;
    cargo.pos = { x: pos.x, y: pos.y, z: pos.z };
    cargo.placeId = place?.id ?? null;
    droppedAt = place ? place.name : `(${Math.round(pos.x)}, ${Math.round(pos.z)})`;
  }
  task.status = 'failed'; task.claimantId = null; task.updatedAt = world.now;
  const req = task.requestId ? world.requests.find(r => r.id === task.requestId) : undefined;
  if (req) failRequest(world, req, reason);
  world.emit('haul_failed', {
    actor: claimant?.id, placeId: task.destPlaceId, pos: world.place(task.destPlaceId)?.inside, significance: 0.2,
    data: { haulId: task.id, resource: task.resource, reason, carried: cargo?.quantity ?? 0, droppedAt },
    summary: `The haul of ${task.resource} to ${world.nameOf(task.destPlaceId)} failed: ${reason}${droppedAt ? ` (${cargo?.quantity} ${task.resource} left at ${droppedAt})` : ''}`,
  });
}

/** Deterministic per-upkeep maintenance of the haul queue. */
export function maintainHauls(world: World): void {
  const now = world.now;
  for (const t of world.haulTasks) {
    if (t.status === 'delivered' || t.status === 'failed' || t.status === 'cancelled') continue;
    const claimant = t.claimantId ? world.person(t.claimantId) : undefined;
    const lost = t.claimantId && (!claimant || !claimant.alive || claimant.custody?.active || !!claimant.surrender);
    if (lost) {
      if ((t.cargoItemId && (world.item(t.cargoItemId)?.quantity ?? 0) > 0)) {
        failHaulTask(world, t, 'the carrier could not finish');
      } else {
        t.claimantId = null; t.status = 'needed'; t.updatedAt = now;
      }
      continue;
    }
    // A source with nothing left and no cargo aboard: this need can't be met from here.
    if (t.status !== 'in_transit' && t.carried === 0 && stockAt(world, t.resource, t.sourcePlaceId) <= 0) {
      // only fail once it has actually been claimed and stale — a freshly-created task waits.
      if (now - t.createdAt > STALE_CLAIM_SECONDS) failHaulTask(world, t, 'the source ran dry');
      continue;
    }
    if (t.status === 'claimed' && now - t.updatedAt > STALE_CLAIM_SECONDS) {
      t.claimantId = null; t.status = 'needed'; t.updatedAt = now;
    }
  }
  // prune old resolved tasks so the array stays bounded by live activity, not calendar time.
  if (world.haulTasks.length > 40) {
    world.haulTasks = world.haulTasks.filter(t =>
      !((t.status === 'delivered' || t.status === 'failed' || t.status === 'cancelled') && now - t.updatedAt > RESOLVED_KEEP_SECONDS));
  }
}

/**
 * The cognition-facing query: the best open haul task for `person` to take right now, or null.
 * A task is a candidate if it is unclaimed (or already this person's) and physically reachable.
 * Score folds urgency, proximity, and role affinity; deterministic tiebreak by task id.
 */
export function pickHaulTask(world: World, person: Person, pos: Vec3): { task: HaulTask; score: number } | null {
  const mine = world.haulTasks.find(t => t.claimantId === person.id && (t.status === 'claimed' || t.status === 'in_transit'));
  if (mine) return { task: mine, score: 1 };
  if (!canHaul(person)) return null;
  let best: { task: HaulTask; score: number } | null = null;
  for (const t of world.haulTasks) {
    if (t.status !== 'needed') continue;
    const src = world.place(t.sourcePlaceId); const dst = world.place(t.destPlaceId);
    if (!src || !dst) continue;
    if (stockAt(world, t.resource, t.sourcePlaceId) <= 0) continue; // nothing to fetch yet
    const legDist = dist2(pos, src.inside) + dist2(src.inside, dst.inside);
    if (dist2(pos, src.inside) > 90) continue; // not my problem — too far to have heard of it
    const affinity = haulerAffinity(world, person, t);
    if (affinity <= 0) continue;
    const proximity = Math.max(0.15, 1 - legDist / 260);
    const score = t.priority * 0.5 + affinity * 0.35 + proximity * 0.15;
    if (!best || score > best.score || (score === best.score && t.id < best.task.id)) best = { task: t, score };
  }
  return best;
}

/** Who can do manual haulage at all (Constitution VI — the player can too, this just filters NPCs). */
export function canHaul(p: Person): boolean {
  if (!p.alive || p.controlled || p.custody?.active || p.surrender) return false;
  if (p.hostile) return false;
  const b = p.occupation;
  return b !== 'child' && b !== 'guard' && b !== 'captain' && b !== 'priest' && b !== 'acolyte' && b !== 'elder';
}

/** How well-suited a person is to a given haul (0 = won't consider it). */
function haulerAffinity(world: World, p: Person, t: HaulTask): number {
  // The consumer's own workers strongly want their inputs delivered.
  const dst = world.place(t.destPlaceId);
  if (dst && dst.workers.includes(p.id)) return 1;
  // A farmer hauling grain out of their own field.
  if (p.occupation === 'farmer' && t.resource === 'grain' && world.place(t.sourcePlaceId)?.workers.includes(p.id)) return 0.95;
  // Bulk-material work suits labouring trades.
  if ((t.resource === 'log' || t.resource === 'plank' || t.resource === 'stone')) {
    return (p.occupation === 'woodcutter' || p.occupation === 'apprentice' || p.occupation === 'farmer' || p.occupation === 'vagrant') ? 0.7 : 0.4;
  }
  // Anyone otherwise idle can lend a hand with food logistics.
  return 0.45;
}

// ---------------------------------------------------------------- observability
export interface HaulSummary {
  open: number; needed: number; inTransit: number;
  requested: number; started: number; delivered: number; failed: number;
  unitsMovedByResource: Record<string, number>;
}
export function haulSummary(world: World): HaulSummary {
  const byRes: Record<string, number> = {};
  for (const [k, v] of Object.entries(world.runTally)) if (k.startsWith('hauled:')) byRes[k.slice('hauled:'.length)] = v;
  return {
    open: openHaulTasks(world).length,
    needed: world.haulTasks.filter(t => t.status === 'needed').length,
    inTransit: world.haulTasks.filter(t => t.status === 'in_transit').length,
    requested: world.runTally.haul_requested ?? 0,
    started: world.runTally.haul_started ?? 0,
    delivered: world.runTally.resource_delivered ?? 0,
    failed: world.runTally.haul_failed ?? 0,
    unitsMovedByResource: byRes,
  };
}
