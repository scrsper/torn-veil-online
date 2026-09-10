import { near } from '../world/locality';
import type { HaulTask, HaulStatus, ItemType, Person, Vec3, EntityId, Place } from '../core/types';
import type { World } from '../core/world';
import { makeItem, ITEM_LABEL, RESOURCE_MASS_KG } from '../world/factory';
import { addPlaceStock, takePlaceStock, retireStack, stockAt, stockItemsAt } from '../world/stock';
import { FARM_SEED_RESERVE } from '../world/metabolism';
import { getPhysicalCapability } from '../core/attributes';
import { createRequest, acceptRequest, completeRequest, failRequest, payWage } from '../core/requests';
import { skillOf, practiceSkill } from '../core/skills';
import { tradeMakes, tradeNeeds } from '../world/supply';
import { isFuel } from '../world/fire';
import { settleWholesale, wholesaleBuyerFor, wholesaleUnitPrice, economicOperatorFor } from '../world/trade';
import { adjustRel } from '../mind/relationships';
import { clearShortfall } from '../world/shortfall';

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
  { destType: 'store', resource: 'bread', sourceType: 'bakery', target: 18, trigger: 8, reason: 'the general store needs bread to sell' },
  { destType: 'tavern', resource: 'grain', sourceType: 'farm', target: 18, trigger: 9, reason: 'the tavern needs grain for brewing' },
  { destType: 'stall', resource: 'meat', sourceType: 'wilderness', target: 8, trigger: 4, reason: 'the game stall needs the hunters catch' },
  { destType: 'mill', resource: 'grain', sourceType: 'farm', target: 55, trigger: 36, reason: 'the mill is low on grain' },
  { destType: 'bakery', resource: 'flour', sourceType: 'mill', target: 34, trigger: 20, reason: 'the bakery is low on flour' },
  { destType: 'stall', resource: 'bread', sourceType: 'bakery', target: 16, trigger: 6, reason: 'the market stall is low on bread' },
  // v0.8 §D: the tavern never had ANY logistics path for meat at all — Kestrel only ever sold it
  // retail at her own stall, so world/cooking.ts's `cook()` (meat -> stew) had no real input to
  // work with regardless of the fire (found by direct headless inspection: `stewsCooked` stayed
  // 0 across an 8-day run even though the fire itself lit and burned correctly). A real physical
  // delivery, same as every other consumer demand here — `world/trade.ts`'s wholesale-trade
  // mechanism pays Kestrel for it automatically (WHOLESALE_DEST_TYPES includes 'tavern').
  // v0.8: `meat` is real, generic food stock the same as anywhere else — any hungry villager at
  // the tavern can (and does) buy/eat it raw via the existing generic food-purchase path before
  // the cook ever gets to it (real, measured competition, not a bug: raw meat genuinely can be
  // eaten OR cooked). A wider target/trigger than the other consumer demands gives the cook a
  // real chance at some of what arrives rather than every delivery being eaten raw first.
  { destType: 'tavern', resource: 'meat', sourceType: 'stall', target: 20, trigger: 10, reason: 'the tavern is low on meat for the cook' },
  // v0.8 §C/D: same gap, one resource earlier in the chain — the tavern never had ANY firewood
  // delivery either, so `tendTavernFire`'s own fuel search always found nothing (real headless
  // evidence: the hearth never once lit across an 8-day run despite the fire mechanism itself
  // working correctly in isolation — tests/materials-fire-crafting.test.ts already proves that).
  // Kindling and sustained fuel have distinct uses in the existing fire simulation. Logs
  // compete with sawyers and construction for real timber; that competition is intentional.
  { destType: 'tavern', resource: 'stick', sourceType: 'wilderness', target: 12, trigger: 4, reason: 'the tavern needs kindling for the hearth' },
  { destType: 'tavern', resource: 'log', sourceType: 'wilderness', target: 3, trigger: 1, reason: 'the tavern needs sustained fuel for cooking and brewing' },
  // The sawpit's own logs. This used to be a bespoke block inside `world/construction.ts`'s
  // `stepConstruction` — the one consumer in the village whose input arrived by a hand-rolled
  // haul rather than through this table — and it is here now because the sawpit became a real
  // `TradeProcess` (world/labor.ts): a trade whose input supply is invisible to the canonical
  // logistics record is a trade whose stoppages cannot be reasoned about, and
  // `tests/causal-society.test.ts`'s drift alarm said so out loud the moment the process was
  // added. Ten logs is the same standing buffer the deleted block used, and the same figure
  // `PLANK_BASE_BUFFER` uses for the planks that come out of them.
  { destType: 'sawpit', resource: 'log', sourceType: 'wilderness', target: 10, trigger: 10, reason: 'the sawpit is short of logs' },
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

/** The issuer budgets a new order from their own wallet and the supplier's posted price.
 * This is order availability, never permission for a worker to inspect somebody's savings. */
export function affordableHaulQuantity(world: World, s: HaulTaskSpec): number {
  const operator = wholesaleBuyerFor(world, s.destPlaceId, s.projectId);
  if (operator === undefined) return s.quantity;
  const buyerId = operator ?? s.requesterId;
  const stacks = stockItemsAt(world, s.resource, s.sourcePlaceId).filter(i => !i.ownerId || world.person(i.ownerId)?.alive).sort((a,b)=>a.id.localeCompare(b.id));
  if (!stacks.length) return 0;
  const seller = stacks[0]?.ownerId;
  if (!seller || seller === buyerId) return s.quantity;
  const buyer = world.person(buyerId);
  if (!buyer?.alive || !world.person(seller)?.alive) return 0;
  const unit = wholesaleUnitPrice(world, s.resource, s.sourcePlaceId);
  let quantity = Math.min(s.quantity, Math.floor(buyer.wealth / unit));
  while (quantity > 0 && quantity * unit + haulWage(world, { ...s, quantity }) > buyer.wealth) quantity--;
  return quantity;
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
/**
 * The canonical "which place has what carried into it" record, read-only. Exposed for the same
 * reason `world/production.ts`'s `productionSpecs` is: it is the second half of what
 * `world/supply.ts`'s trades table claims to describe, and the drift alarm needs to be able to
 * disagree with it out loud. Nothing in the simulation reads it through this accessor.
 */
export function consumerDemands(): readonly Demand[] { return CONSUMER_DEMANDS; }

/**
 * Does this place deal in this resource at all?
 *
 * A demand is keyed by PLACE TYPE, and a type is not always one place: Ashford has four stalls,
 * and only one of them is the bread stall. Taking "the first place of this type" hid that — it
 * happened to return the bread stall because village generation registers it first, which is not
 * a reason for anything. Asking every stall instead would have the vegetable stall, the grain
 * stall and the hunter's stall all demanding bread.
 *
 * So the question is answered from canonical facts rather than from a slug or a name: the place
 * already holds some of the resource, somebody who works it plies a trade that makes or needs it
 * (`world/supply.ts`, the village's own public account of which trade makes what), or the place
 * has a hearth and the resource is something that burns (`world/fire.ts`). A stall that has sold
 * out is still the bread stall, because the baker still keeps it; and the tavern has business
 * receiving kindling because it has a fire in it, which no trade table says and no slug needed
 * to — that third clause exists because leaving it out silently stopped the tavern's hearth ever
 * being supplied, and with it the cook's stew.
 */
function dealsIn(world: World, place: Place, resource: ItemType): boolean {
  if (place.type === 'store' && resource === 'bread') return true;
  if (stockAt(world, resource, place.id) > 0) return true;
  if (place.fires.length && isFuel(resource)) return true;
  const keepers = new Set<EntityId>(place.workers);
  if (place.ownerId) keepers.add(place.ownerId);
  for (const id of keepers) {
    const person = world.person(id);
    if (person && (tradeMakes(person.occupation, resource) || tradeNeeds(person.occupation, resource))) return true;
  }
  return false;
}

export function generateLogisticsNeeds(world: World): void {
  // 1. Food chain: consumer Place below trigger + a supplier Place with surplus → one task.
  for (const d of CONSUMER_DEMANDS) {
    // EVERY consumer of the type, not the first: a tavern going short of ale is a fact about that
    // tavern, and with a second settlement the first one registered is not an answer at all. The
    // supplier is then chosen from the ones near IT (`world/locality.ts`'s `near`), so a haul never
    // proposes carrying grain between two settlements because one of them happened to have spare.
    for (const dest of world.places().filter(p => p.type === d.destType && dealsIn(world, p, d.resource))) {
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
        .filter(p => p.type === d.sourceType && near(p.inside, dest.inside) && spareAt(p) > 0)
        .sort((a, b) => spareAt(b) - spareAt(a) || a.id.localeCompare(b.id));
      const src = suppliers[0];
      if (!src) continue;
      if (existingTask(world, d.resource, src.id, dest.id)) continue;
      const want = Math.min(carryCapFor(d.resource), d.target - have - inbound, Math.floor(spareAt(src)));
      if (want <= 0) continue;
      const priority = Math.min(1, 1 - (have + inbound) / Math.max(1, d.target));
      const order: HaulTaskSpec = {
        resource: d.resource, quantity: want, sourcePlaceId: src.id, destPlaceId: dest.id,
        reason: d.reason, requesterId: economicOperatorFor(world, dest.id), priority,
      };
      order.quantity = affordableHaulQuantity(world, order);
      if (order.quantity > 0) createHaulTask(world, order);
    }
  }
}

/** A hauler commits to a task. */
export function claimHaulTask(world: World, task: HaulTask, person: Person): void {
  if (task.status !== 'needed') return;
  task.claimantId = person.id; task.status = 'claimed'; task.updatedAt = world.now;
  const req = task.requestId ? world.requests.find(r => r.id === task.requestId) : undefined;
  if (req) acceptRequest(world, req, person, req.acceptedBy);
  world.emit('haul_started', {
    actor: person.id, placeId: task.sourcePlaceId, pos: world.primaryBody(person.id)?.pos, significance: 0.12,
    data: { haulId: task.id, resource: task.resource, quantity: task.quantity, from: task.sourcePlaceId, to: task.destPlaceId },
    summary: `${person.name} set out to carry ${task.resource} to ${world.nameOf(task.destPlaceId)}`,
  });
}

/** Actual progress toward a haul endpoint keeps the claim alive for either controller. */
export function noteHaulMovement(world: World, person: Person, from: Vec3, to: Vec3): void {
  for (const task of world.haulTasks) {
    if (task.claimantId !== person.id || (task.status !== 'claimed' && task.status !== 'in_transit')) continue;
    const dest=world.place(task.status==='in_transit' ? task.destPlaceId : task.sourcePlaceId);
    if (dest && dist2(to,dest.inside) < dist2(from,dest.inside)) task.updatedAt=world.now;
  }
}

/**
 * At the source: physically load up to the available amount into a carried stack — capped at
 * what THIS person can safely carry right now (v0.4 §4), never the full remaining task size.
 * If the task still needs more than fits in one trip, it stays open for another load/deposit
 * cycle by the same claimant (see `depositHaulCargo`) instead of the whole quantity teleporting
 * in on the first load.
 */
export function loadHaulCargo(world: World, task: HaulTask, person: Person): boolean {
  if (task.claimantId !== person.id) return false;
  if (task.status !== 'claimed' && task.status !== 'in_transit') return false;
  const avail = stockAt(world, task.resource, task.sourcePlaceId);
  const stillNeeded = task.quantity - task.delivered - task.carried;
  const tripCapacity = Math.max(0, personalCarryUnits(world, person, task.resource) - task.carried);
  const want = Math.min(stillNeeded, tripCapacity);
  let n = Math.min(want, avail);
  const sourceStacks = stockItemsAt(world, task.resource, task.sourcePlaceId).filter(i => !i.ownerId || world.person(i.ownerId)?.alive).sort((a, b) => a.id.localeCompare(b.id));
  const stack = sourceStacks[0];
  if (!stack) n = 0;
  const operator = wholesaleBuyerFor(world, task.destPlaceId, task.projectId);
  const sellerId = stack?.ownerId;
  // Moving one's own stock into an unoperated place is storage, not a sale to a phantom buyer.
  const buyerId = operator === undefined ? undefined : operator ?? task.requesterId ?? (sellerId === person.id ? person.id : null);
  // Pay for the particular producer's goods before taking title. An insolvent buyer can
  // buy fewer units; they cannot drain a supplier's stock in exchange for a partial payment.
  // Fill a real load across batches of this producer. Limiting a trip to one five-loaf
  // baking batch would quietly reduce throughput regardless of the carrier's capacity.
  const ownedStacks = sourceStacks.filter(s => s.ownerId === sellerId);
  if (stack) n = Math.min(n, ownedStacks.reduce((sum, s) => sum + s.quantity, 0));
  if (stack && sellerId && buyerId !== undefined && sellerId !== buyerId) {
    const buyer = world.person(buyerId), seller = world.person(sellerId);
    const unit = wholesaleUnitPrice(world, task.resource, task.sourcePlaceId);
    n = buyer?.alive && seller?.alive ? Math.min(n, Math.floor(buyer.wealth / unit)) : 0;
    if (n > 0) settleWholesale(world, sellerId, buyerId, task.resource, n, task.destPlaceId, task.sourcePlaceId);
  }
  if (n <= 0) {
    if (task.carried > 0) { finishInTransit(world, task); return true; } // partial load already aboard — go deliver it
    failHaulTask(world, task, avail > 0 ? 'the buyer cannot fund this delivery' : 'nothing left at the source to carry');
    return false;
  }
  // v0.7 §A: capture who actually owned this stock BEFORE `takePlaceStock`/the cargo's own
  // `owner` (below) overwrite it with the requester — the first pickup leg is the only moment
  // this is still recoverable (see world/trade.ts's `settleWholesale` doc comment). Read
  // directly off the oldest matching stack (the one `takePlaceStock` is about to drain first),
  // not the place, so it correctly follows the actual producer even where the Place itself has
  // no fixed owner (the quarry: stone there is owned by whoever quarried it, not a place role).
  task.materialSellerId = sellerId ?? null;
  if (!stack) return false;
  let remaining = n, spoilage = 0, oldest = world.now;
  for (const source of ownedStacks) {
    const take = Math.min(remaining, source.quantity);
    const pressure = (source.spoilAccum ?? 0) * take / source.quantity;
    spoilage += pressure; source.spoilAccum = (source.spoilAccum ?? 0) - pressure;
    oldest = Math.min(oldest, source.createdAt);
    source.quantity -= take; remaining -= take;
    if (source.quantity <= 0) retireStack(world, source);
    if (remaining <= 0) break;
  }
  let cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  const owner = buyerId ?? task.requesterId ?? sellerId ?? world.place(task.sourcePlaceId)?.ownerId ?? null;
  if (!cargo) {
    cargo = makeItem(world, task.resource, ITEM_LABEL[task.resource], { owner, holder: person.id, quantity: n });
    cargo.haulTaskId = task.id;
    task.cargoItemId = cargo.id;
  } else {
    cargo.quantity += n;
  }
  cargo.createdAt = Math.min(cargo.createdAt, oldest);
  cargo.spoilAccum = (cargo.spoilAccum ?? 0) + spoilage;
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
 * completion) is settled once the task is done; each delivered leg earns its share of freight.
 */
export function depositHaulCargo(world: World, task: HaulTask, person: Person): boolean {
  if (task.claimantId !== person.id || task.status !== 'in_transit') return false;
  const cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  if (cargo && cargo.holderId !== person.id) return false;
  if (!cargo || cargo.quantity <= 0) { failHaulTask(world, task, 'the cargo was lost'); return false; }
  const n = cargo.quantity;
  // Whoever is actually carrying it lets go — `retireStack` resolves that from `holderId`,
  // which is not always the person making the delivery.
  cargo.quantity = 0; cargo.haulTaskId = undefined; retireStack(world, cargo);
  const owner = cargo.ownerId;
  const ev = world.emit('resource_delivered', {
    actor: person.id, item: cargo.id, placeId: task.destPlaceId, pos: world.place(task.destPlaceId)?.inside, significance: task.projectId ? 0.4 : 0.18,
    data: { haulId: task.id, resource: task.resource, quantity: n, to: task.destPlaceId, projectId: task.projectId },
    summary: `${person.name} delivered ${n} ${task.resource} to ${world.nameOf(task.destPlaceId)}`,
  });
  const delivered = addPlaceStock(world, task.resource, n, task.destPlaceId, owner, ev.id, 'delivered');
  delivered.createdAt = Math.min(delivered.createdAt, cargo.createdAt);
  delivered.spoilAccum = (delivered.spoilAccum ?? 0) + (cargo.spoilAccum ?? 0);
  cargo.spoilAccum = 0;
  clearShortfall(world, person, task.destPlaceId, task.resource);
  // Causal Society (relationships must follow from what people actually do for each other).
  // Repeated cooperation was the one ordinary, everyday relationship input the simulation had no
  // path for at all: two people could spend a month carrying each other's grain and end it as
  // exact strangers, because nothing but violence, gifts and conversation could move a
  // relationship. A delivery is a real service rendered to a real person, and the person it was
  // rendered TO is the one whose regard should move.
  //
  // Gated on the requester actually BEING there to see it land — the same epistemic discipline as
  // everywhere else; a delivery made to an empty mill is still a delivery, and the miller who
  // was not there to see it owes the hauler nothing they know about. Small and quiet on purpose:
  // one trip is a small thing, and it is the accumulation over many that is meant to add up to
  // a person you have come to rely on.
  const requester = task.requesterId ? world.person(task.requesterId) : undefined;
  if (requester && requester.alive && !requester.controlled && requester.id !== person.id) {
    const rb = world.primaryBody(requester.id);
    const here = rb ? world.placeAt(rb.pos)?.id : undefined;
    if (here === task.destPlaceId) {
      adjustRel(world, requester, person.id, { trust: 0.03, affection: 0.02, familiarity: 0.04, respect: 0.015 },
        `carried ${task.resource} to ${world.nameOf(task.destPlaceId)} for me`, ev.id, true);
    }
  }
  // Material ownership and payment were settled at pickup. Delivery earns the freight wage.
  task.delivered += n; task.carried = 0; task.updatedAt = world.now;
  task.cargoItemId = undefined;
  // v0.6 §V.9: a real, physically-completed delivery leg is meaningful work — practice once per
  // leg (not per unit, so a heavy single-trip delivery doesn't train faster than a light one).
  practiceSkill(person, 'hauling', 1);
  world.runTally[`hauled:${task.resource}`] = (world.runTally[`hauled:${task.resource}`] ?? 0) + n; // survives task pruning
  // Pay for the leg actually delivered, even if later legs become impossible or another
  // carrier takes over. Neither a failed pickup nor completion can pay this same leg twice.
  const req = task.requestId ? world.requests.find(r => r.id === task.requestId) : undefined;
  if (req) req.paid = (req.paid ?? 0) + payWage(world, req.requesterId, person, req.reward * n / task.quantity);
  const moreToFetch = task.delivered < task.quantity && stockAt(world, task.resource, task.sourcePlaceId) > 0;
  if (moreToFetch) { task.status = 'claimed'; return true; } // another trip needed — stay claimed by the same hauler
  task.status = 'delivered';
  if (req && req.status !== 'completed') completeRequest(world, req, 0);
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

/** The eligibility every manual hauler shares, mind-driven or player-driven (Constitution
 * Invariant VI). 'child' is excluded (too young for heavy manual labour); 'elder' is excluded
 * (already comfortably wealthy, and retirement-age labour is a bigger thematic shift than an
 * off-duty guard or acolyte picking up occasional work). Hostiles/detainees/the surrendered
 * are not offered honest work. */
export function canAcceptHaul(p: Person): boolean {
  if (!p.alive || p.custody?.active || p.surrender) return false;
  if (p.hostile) return false;
  return p.occupation !== 'child' && p.occupation !== 'elder';
}

/** Who NPC cognition may PLAN a haul goal for. Identical rules to `canAcceptHaul`; the only
 * extra exclusion is `controlled`, because `think()` must not adopt a goal for a body it does
 * not drive — the player reaches the same claim/load/deposit/pay functions through
 * logistics/participation.ts instead.
 * v0.8 §P0-D fix (independent audit §3.2/§8): 'guard'/'captain'/'priest'/'acolyte' used to be
 * excluded here on the assumption that institutional occupations have some other income — they
 * do not; NOTHING in the game pays a wage for scheduled guard duty or worship the way baking/
 * sawing/milling are paid for their scheduled work. The exclusion was the actual defect, not a
 * deliberate design choice with an alternative already in place: measured directly (seed
 * 918271), a guard's one-time starting wealth (20-90 silver) drains to 0 by roughly day 7-8
 * with zero income, after which their `eat` goal keeps correctly finding and targeting a real
 * seller but can never complete the purchase — permanent hunger, not a scheduling/access bug.
 * `laborIncentive`/`getPhysicalCapability` already weight this so an on-duty guard still
 * strongly prefers patrolling and only competes for a haul job when genuinely poor and hungry. */
export function canHaul(p: Person): boolean {
  return !p.controlled && canAcceptHaul(p);
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
