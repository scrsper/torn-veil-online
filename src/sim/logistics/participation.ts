import type { EntityId, HaulTask, Item, Person, Place, Request, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { claimHaulTask, loadHaulCargo, depositHaulCargo, failHaulTask, canAcceptHaul } from './haul';
export { canAcceptHaul } from './haul';
import { stockAt } from '../world/stock';
import { isFood } from '../world/factory';
import { buyFoodPortion, eatFood, drinkAt, findAccessibleFood } from '../world/metabolism';

/**
 * Participation — the ordinary-life verbs of the Request market and metabolism, expressed for
 * ANY person rather than only for a mind running `think()`/`act()`.
 *
 * Constitution §9 / Invariant VI: the player is an entity, not an exception. An NPC hauler
 * reaches `claimHaulTask` → `loadHaulCargo` → `depositHaulCargo` → (`completeRequest` pays) by
 * planning a `haul` goal; the player reaches the SAME four functions by talking to the person
 * who raised the request and then physically walking the same route. Nothing here moves
 * cargo, money, or food by any path an NPC does not already use — this module only decides
 * *which* canonical step applies to where a person is standing right now and reports the
 * semantic result so a presentation layer can say it in words. It is renderer-agnostic and
 * never reads `controlled` to change an outcome.
 */

export interface HaulOffer { request: Request; task: HaulTask; source: Place; destination: Place; }

/** Open haul work `npc` would hand to someone who asks: requests they raised themselves, or
 * that were raised for the place they work at (the baker speaks for the bakery's flour need
 * even when the request's nominal payer is the bakery's owner). Only work whose source still
 * has something to fetch — the same "nothing to fetch yet" filter `pickHaulTask` applies. */
export function haulOffersFrom(world: World, npc: Person): HaulOffer[] {
  const offers: HaulOffer[] = [];
  for (const r of world.requests) {
    if (r.type !== 'haul' || r.status !== 'open' || !r.payload.haulTaskId) continue;
    if (r.requesterId !== npc.id && !(npc.workId && r.requesterPlaceId === npc.workId)) continue;
    const task = world.haulTasks.find(t => t.id === r.payload.haulTaskId);
    if (!task || task.status !== 'needed') continue;
    const source = world.place(task.sourcePlaceId), destination = world.place(task.destPlaceId);
    if (!source || !destination) continue;
    if (stockAt(world, task.resource, task.sourcePlaceId) <= 0) continue;
    offers.push({ request: r, task, source, destination });
  }
  return offers.sort((a, b) => b.task.priority - a.task.priority || a.task.id.localeCompare(b.task.id));
}

/** The haul `person` is currently committed to, if any. */
export function activeHaulFor(world: World, person: Person): HaulTask | undefined {
  return world.haulTasks.find(t => t.claimantId === person.id && (t.status === 'claimed' || t.status === 'in_transit'));
}

/** Take on an offered haul. One job at a time — the same constraint `pickHaulTask` enforces
 * for a mind (`mine` short-circuits everything else). Returns false if ineligible, already
 * busy, or the task is no longer open. */
export function acceptHaulOffer(world: World, task: HaulTask, person: Person): boolean {
  if (!canAcceptHaul(person) || activeHaulFor(world, person) || task.status !== 'needed') return false;
  claimHaulTask(world, task, person);
  return true;
}

/** Same proximity rule the NPC `haul_load`/`haul_unload` action handlers use: within 4 m of
 * the place's `inside` point, or within 3 m of its work anchor. */
export function atHaulPlace(world: World, place: Place, pos: Vec3): boolean {
  const d = (a: Vec3) => Math.hypot(a.x - pos.x, a.z - pos.z);
  if (d(place.inside) <= 4) return true;
  const spot = place.anchors.find(a => a.kind === 'work' || a.kind === 'inside');
  return !!spot && d(spot.pos) <= 3;
}

export type HaulProgress =
  | { kind: 'no_job' }
  | { kind: 'loaded'; task: HaulTask; units: number }
  | { kind: 'delivered'; task: HaulTask; units: number; complete: boolean; paid: number }
  | { kind: 'go_to'; task: HaulTask; leg: 'source' | 'destination'; place: Place; distance: number }
  | { kind: 'failed'; task: HaulTask; reason: string };

/**
 * Advance `person`'s current haul by whatever physical step their position allows — load at
 * the source, deposit at the destination, or nothing (with the place still to reach). Wage
 * payment happens inside `depositHaulCargo` → `completeRequest`, never here. Returns what
 * happened so the caller can present it; `paid` is measured from the person's real wealth
 * delta, not read from the request's nominal reward.
 */
export function progressHaul(world: World, person: Person, pos: Vec3): HaulProgress {
  const task = activeHaulFor(world, person);
  if (!task) return { kind: 'no_job' };
  const source = world.place(task.sourcePlaceId), destination = world.place(task.destPlaceId);
  if (!source || !destination) { failHaulTask(world, task, 'the route no longer exists'); return { kind: 'failed', task, reason: 'the route no longer exists' }; }
  const cargo = task.cargoItemId ? world.item(task.cargoItemId) : undefined;
  const carrying = task.carried > 0 && !!cargo && cargo.quantity > 0;
  if (carrying && cargo!.holderId !== person.id) {
    // The carrier set the cargo down somewhere. Physically the stack is wherever it was dropped
    // (dropItem already placed it); the job cannot be honestly completed from an empty-handed
    // deposit, so it fails the way an NPC's interrupted haul fails.
    failHaulTask(world, task, 'the carrier set the cargo down');
    return { kind: 'failed', task, reason: 'the carrier set the cargo down' };
  }
  if (!carrying) {
    if (!atHaulPlace(world, source, pos)) return { kind: 'go_to', task, leg: 'source', place: source, distance: Math.hypot(source.inside.x - pos.x, source.inside.z - pos.z) };
    const before = task.carried;
    const ok = loadHaulCargo(world, task, person);
    if (!ok) return { kind: 'failed', task, reason: 'nothing left at the source to carry' };
    return { kind: 'loaded', task, units: task.carried - before };
  }
  if (!atHaulPlace(world, destination, pos)) return { kind: 'go_to', task, leg: 'destination', place: destination, distance: Math.hypot(destination.inside.x - pos.x, destination.inside.z - pos.z) };
  const wealthBefore = person.wealth; const units = cargo!.quantity;
  const ok = depositHaulCargo(world, task, person);
  if (!ok) return { kind: 'failed', task, reason: 'the cargo was lost' };
  return { kind: 'delivered', task, units, complete: task.status === 'delivered', paid: person.wealth - wealthBefore };
}

/** Give up the current haul: cargo (if any) is dropped where the person stands, the request
 * fails unpaid — identical to an NPC hauler being interrupted. */
export function abandonHaul(world: World, person: Person): boolean {
  const task = activeHaulFor(world, person);
  if (!task) return false;
  failHaulTask(world, task, `${person.name} gave up the haul`);
  return true;
}

// ---------------------------------------------------------------- meals for any person

/** Food `seller` has out for sale at the place they are at or work at — what an NPC's `eat`
 * action finds with its own "for sale here" scan (mind/agent.ts). */
export function foodForSaleBy(world: World, seller: Person): Item[] {
  return world.items().filter(i => !i.holderId && i.pos && i.ownerId === seller.id && isFood(i.type) && i.quantity > 0);
}

/** Buy `n` units of food from `seller` through the ordinary scarcity-priced purchase path.
 * Returns the carried stack, or null if unaffordable / nothing offered. */
export function buyMealFrom(world: World, buyer: Person, seller: Person, n = 1): Item | null {
  const forSale = foodForSaleBy(world, seller).sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!forSale) return null;
  return buyFoodPortion(world, buyer, forSale, n);
}

/** Eat one unit of whatever food `person` has to hand — their own carried food first, then
 * (at home) the household larder, exactly the accessibility rule `findAccessibleFood` gives an
 * NPC. Returns the food type eaten, or null if there was nothing. */
export function eatAtHand(world: World, person: Person, atPlaceId: EntityId | null): Item['type'] | null {
  const food = findAccessibleFood(world, person, atPlaceId);
  if (!food || food.quantity <= 0) return null;
  const type = eatFood(world, person, food);
  world.emit('meal', { actor: person.id, pos: world.primaryBody(person.id)?.pos, significance: 0.05, summary: `${person.name} ate ${type}${atPlaceId ? ` at ${world.nameOf(atPlaceId)}` : ''}` });
  return type;
}

/** Drink from a water source the person is standing at (a `well`-type Place — the village well
 * or the river bank). Returns false if there is no water source here. */
export function drinkHere(world: World, person: Person, pos: Vec3): boolean {
  const place = world.placeAt(pos);
  const source = place?.type === 'well' ? place : world.places().find(p => p.type === 'well' && Math.hypot(p.inside.x - pos.x, p.inside.z - pos.z) <= 4);
  if (!source) return false;
  drinkAt(world, person, source.id);
  return true;
}
