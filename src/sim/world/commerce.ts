import type { EntityId, Item, ItemType, Person, Place, Vec3, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { effectivePrice } from './pricing';
import { stockAt, retireStack } from './stock';
import { makeItem, isFood, RESOURCE_CATEGORY } from './factory';
import { TOOL_KINDS } from '../core/tools';
import { hungerBand, severityAtLeast } from '../core/physiology';
import { getRel, disposition } from '../mind/relationships';

/**
 * v0.10.1 Parts VI/VII/X — what a person actually has for sale, why, at what price, and the one
 * function that moves it.
 *
 * Before this module the player's Trade menu offered `items().filter(i => i.ownerId === npc.id
 * && i.pos && !i.holderId)`: every object that person owned and had put down anywhere in the
 * world. The farmer would sell you the grain his mill delivery was waiting on; the woodcutter
 * would sell the axe he needed at dawn; a starving family would sell their last bread. Selling
 * was gated on a hardcoded list of "shopkeeper" occupations, and the price was `value × markup`,
 * ignoring the scarcity pricing every NPC purchase already went through.
 *
 * The rule here is meant to be small and general rather than a taxonomy of shop types. There is
 * no new "is merchandise" flag on Item, and no new inventory category. Three canonical facts
 * already in the world decide everything:
 *
 *   1. WHERE the thing is. A stack at a Place this person owns or works at, of a type that place
 *      commercially handles, is stock. The same object at their home is their own.
 *   2. WHAT ELSE it is already for. Cargo under a haul task, or stock a live request is waiting
 *      on, is spoken for; so is the tool they are carrying to do their job with.
 *   3. WHETHER THEY CAN SPARE IT. Food is not sold out from under someone who is hungry and has
 *      little else.
 *
 * Everything a shopkeeper "is" therefore falls out of the fact that shopkeepers stand in
 * buildings full of goods they own — and a farmer with a surplus sack of grain at the farm is
 * just as able to sell it, which is correct, because that is what a farmer does.
 */

/** Why a particular thing is not on offer. Reported, not silently filtered, so the client can
 * say what happened and a test can assert on the reason rather than on an absence. */
export type RefusalReason =
  | 'not_theirs'          // they neither own it nor speak for the place that holds it
  | 'personal'            // their own belongings, not stock they trade in
  | 'needed_for_work'     // the tool their own work depends on
  | 'committed'           // haul cargo, or stock a live request is waiting on
  | 'last_food'           // they are hungry and this is what they have
  | 'hostile';            // they will not deal with this buyer at all

export interface TradeOffer {
  item: Item;
  /** Price for ONE unit, scarcity-adjusted at the place it is being sold from, then marked up or
   * down by this seller's own greed and how they feel about this buyer. */
  unitPrice: number;
  /** Units they are willing to part with — never more than the stack holds, and less when part
   * of it is spoken for or is their own reserve. */
  available: number;
  /** In the seller's own terms, for the client to show. */
  note: string;
}

export interface Refusal { item: Item; reason: RefusalReason; note: string; }

/** Place types whose whole purpose is holding goods that move on: what is stored here is stock,
 * not somebody's belongings. Derived from the existing `PlaceType` vocabulary rather than from a
 * new flag, and deliberately excludes `house` — a home is where personal property lives. */
const COMMERCIAL_PLACE_TYPES = new Set<Place['type']>(['store', 'stall', 'bakery', 'tavern', 'smithy', 'mill', 'sawpit', 'farm', 'quarry']);

/** How many units of food someone keeps back for themselves once they are feeling it. Two meals:
 * enough to matter, small enough that a baker with a morning's baking still has a shop. */
export const PERSONAL_FOOD_RESERVE = 2;

/** Whether `p` speaks commercially for `place` — its owner, or one of the people who work it.
 * The same `ownerId ?? workers[0]` convention `logistics/haul.ts` and `world/trade.ts` already
 * use to decide who pays for a delivery, read from the other side: who may sell what arrives. */
export function operatesPlace(p: Person, place: Place | undefined): boolean {
  if (!place) return false;
  return place.ownerId === p.id || place.workers.includes(p.id);
}

/** The Place a stack is sitting in, if any. */
function placeOf(world: World, it: Item): Place | undefined {
  return it.placeId ? world.place(it.placeId) : it.pos ? world.placeAt(it.pos) : undefined;
}

/**
 * Units of this stack that are already spoken for by a live haul task — either physically
 * travelling as its cargo, or still sitting at the source Place waiting to be collected.
 *
 * This is Part X question 4 ("can a seller sell something already committed to a request?"), and
 * the answer has to be a reservation rather than a veto: a mill with 200 grain and a 20-grain
 * delivery pending should still sell you a sack.
 */
export function committedUnits(world: World, it: Item): number {
  if (it.haulTaskId) return it.quantity;
  let reserved = 0;
  for (const t of world.haulTasks) {
    if (t.status !== 'needed' && t.status !== 'claimed' && t.status !== 'in_transit') continue;
    if (t.resource !== it.type || t.sourcePlaceId !== it.placeId) continue;
    reserved += Math.max(0, t.quantity - t.delivered - t.carried);
  }
  return reserved;
}

/** Is this the tool they are carrying to work with? Carried, not shelved: a smith's rack of axes
 * is merchandise, the hammer in his belt is not. Deliberately type-level rather than a lookup of
 * "which occupation needs which tool" — someone carrying an axe around is carrying it for a
 * reason, whatever the roster says they are. */
function isWorkingTool(seller: Person, it: Item): boolean {
  return it.holderId === seller.id && (TOOL_KINDS as ItemType[]).includes(it.type);
}

/** All food this person can reach without buying it: what they carry plus what is theirs where
 * they are. Used only to decide whether selling would leave them short. */
function ownFoodUnits(world: World, p: Person): number {
  let n = 0;
  for (const it of world.items()) {
    if (it.quantity <= 0 || !isFood(it.type)) continue;
    if (it.holderId === p.id) { n += it.quantity; continue; }
    if (!it.holderId && it.ownerId === p.id) n += it.quantity;
  }
  return n;
}

/**
 * Whether `seller` would part with `it` for `buyer`, and how much of it. `available` is 0 exactly
 * when `reason` is set.
 */
export function willingnessFor(world: World, seller: Person, it: Item, buyer?: Person): { available: number; reason: RefusalReason | null; note: string } {
  const no = (reason: RefusalReason, note: string) => ({ available: 0, reason, note });
  if (it.quantity <= 0) return no('not_theirs', 'there is none left');

  if (buyer && refusesToDeal(seller, buyer)) return no('hostile', `${seller.name} will not deal with you`);

  // ---- 1. authority. Their own property, or stock at a place they speak for.
  const place = placeOf(world, it);
  const ownsIt = it.ownerId === seller.id;
  const speaksForPlace = operatesPlace(seller, place);
  if (!ownsIt && !(speaksForPlace && it.ownerId == null)) {
    return no('not_theirs', it.ownerId ? `that belongs to ${world.nameOf(it.ownerId)}` : 'that is not theirs to sell');
  }

  // ---- 2. already spoken for.
  if (it.haulTaskId) return no('committed', 'that is cargo, promised somewhere else');
  if (isWorkingTool(seller, it)) return no('needed_for_work', `${seller.name} needs that to work`);

  // ---- 3. is it stock at all, or is it their own life?
  const commercial = !!place && !it.holderId && (COMMERCIAL_PLACE_TYPES.has(place.type) || onDisplay(place, it));
  const atHome = !!place && place.id === seller.homeId;
  if (!commercial && (atHome || it.holderId === seller.id)) {
    // A person will still sell what they carry if it is plainly surplus — food is the honest
    // case, because a loaf is a loaf wherever it is. Belongings are not.
    const surplus = isFood(it.type) || RESOURCE_CATEGORY[it.type] === 'material' || RESOURCE_CATEGORY[it.type] === 'crop_yield';
    if (!surplus) return no('personal', `that is ${seller.name}'s own`);
  }
  if (!commercial && !atHome && it.holderId !== seller.id && !ownsIt) return no('not_theirs', 'that is not theirs to sell');

  // ---- 4. what is left after what is promised and what they need.
  let available = it.quantity - committedUnits(world, it);
  if (available <= 0) return no('committed', 'that is already promised to someone');

  if (isFood(it.type) && severityAtLeast(hungerBand(seller), 'noticeable')) {
    const spare = ownFoodUnits(world, seller) - PERSONAL_FOOD_RESERVE;
    if (spare <= 0) return no('last_food', `${seller.name} needs that ${it.type} themselves`);
    available = Math.min(available, spare);
  }
  if (available <= 0) return no('last_food', `${seller.name} has none to spare`);
  return { available, reason: null, note: commercial ? 'stock' : 'surplus' };
}

function onDisplay(place: Place, it: Item): boolean {
  if (!it.pos) return false;
  return place.anchors.some(a => a.kind === 'display' && Math.hypot(a.pos.x - it.pos!.x, a.pos.z - it.pos!.z) < 1.5);
}

/** A seller who will not deal at all — the same fear/grudge test the dialogue already applied,
 * hoisted here so the offer list and the transaction agree about it. */
export function refusesToDeal(seller: Person, buyer: Person): boolean {
  const r = getRel(seller, buyer.id);
  return r.fear > 0.45 || r.grudge > 0.5;
}

/** This seller's price for one unit, at the place they are selling it from: the same
 * scarcity-adjusted price `buyFoodPortion` charges an NPC, then bent by who is asking. A greedy
 * merchant charges more; someone who likes you charges less. Never below 1. */
export function unitPriceFor(world: World, seller: Person, it: Item, buyer?: Person): number {
  const stock = it.placeId ? stockAt(world, it.type, it.placeId) : it.quantity;
  const base = effectivePrice(it.type, it.value ?? 1, stock);
  const markup = 1 + seller.traits.greed * 0.5 - (buyer ? Math.max(0, disposition(seller, buyer.id)) * 0.3 : 0);
  return Math.max(1, Math.round(base * markup));
}

/**
 * Everything `seller` would sell `buyer` right now, cheapest-to-find first (their own stock at
 * the place they are standing in, then anything else of theirs). Deterministic: `world.items()`
 * is id-ordered and nothing here sorts by a Map/Set iteration.
 */
export function tradeOffersFrom(world: World, seller: Person, buyer?: Person): TradeOffer[] {
  const offers: TradeOffer[] = [];
  for (const it of world.items()) {
    if (it.holderId && it.holderId !== seller.id) continue;
    if (it.ownerId !== seller.id && !(it.ownerId == null && operatesPlace(seller, placeOf(world, it)))) continue;
    const w = willingnessFor(world, seller, it, buyer);
    if (!w.available) continue;
    offers.push({ item: it, unitPrice: unitPriceFor(world, seller, it, buyer), available: w.available, note: w.note });
  }
  return offers;
}

/** Why the things they own are NOT on offer — for the client to explain a refusal honestly, and
 * for tests to assert that a specific thing was withheld for a specific reason. */
export function refusalsFrom(world: World, seller: Person, buyer?: Person): Refusal[] {
  const out: Refusal[] = [];
  for (const it of world.items()) {
    if (it.quantity <= 0) continue;
    if (it.ownerId !== seller.id && !(it.ownerId == null && operatesPlace(seller, placeOf(world, it)))) continue;
    if (it.holderId && it.holderId !== seller.id) continue;
    const w = willingnessFor(world, seller, it, buyer);
    if (w.reason) out.push({ item: it, reason: w.reason, note: w.note });
  }
  return out;
}

export interface PurchaseResult { units: number; paid: number; stack: Item | null; event: WorldEvent | null; refused: RefusalReason | null; }

/**
 * THE purchase. Both the player's Trade menu and every NPC food purchase bottom out here, which
 * is what makes "does sale transfer ownership exactly once" a question with one place to look.
 *
 * Conservation by construction: the only writes are `buyer.wealth`/`seller.wealth` (equal and
 * opposite) and `source.quantity` against the units that appear in the buyer's stack. A drained
 * stack is emptied and detached rather than deleted, so its provenance and any event that names
 * it stay valid (Constitution VII).
 *
 * The seller is asked again here, not just when the menu was drawn: a willingness computed a
 * moment ago is not a promise, and a UI that has gone stale must not be able to complete a sale
 * the simulation would now refuse.
 */
export function purchaseUnits(world: World, buyer: Person, seller: Person, source: Item, want: number, opts: { pos?: Vec3; how?: string } = {}): PurchaseResult {
  const none: PurchaseResult = { units: 0, paid: 0, stack: null, event: null, refused: null };
  if (!buyer.alive || !seller.alive || buyer.id === seller.id || want <= 0) return none;
  const willing = willingnessFor(world, seller, source, buyer);
  if (willing.reason) return { ...none, refused: willing.reason };

  const unit = unitPriceFor(world, seller, source, buyer);
  const affordable = Math.floor(buyer.wealth / unit);
  if (affordable <= 0) return none;
  const take = Math.min(want, willing.available, source.quantity, affordable);
  if (take <= 0) return none;

  const cost = take * unit;
  const soldFromPlaceId = source.placeId ?? undefined;
  buyer.wealth -= cost; seller.wealth += cost;
  world.runTally.purchase_amount = (world.runTally.purchase_amount ?? 0) + cost;
  source.quantity -= take;
  const drained = source.quantity <= 0;
  if (drained) { source.pos = null; source.placeId = null; }

  const pos = opts.pos ?? world.primaryBody(buyer.id)?.pos;
  const ev = world.emit('trade', {
    actor: seller.id, target: buyer.id, item: source.id, pos, placeId: soldFromPlaceId,
    significance: 0.12, visibility: 10, data: { price: cost, qty: take, item: source.type, buyer: buyer.id, seller: seller.id },
    summary: `${seller.name} sold ${take} ${source.type} to ${buyer.name} for ${cost} silver`,
  });
  world.emit('purchase_made', {
    actor: buyer.id, target: seller.id, item: source.id, pos, placeId: soldFromPlaceId,
    significance: 0.02, data: { amount: cost, qty: take, item: source.type },
    summary: `${buyer.name} bought ${take} ${source.type} from ${seller.name} for ${cost} silver`,
  });

  // Merge into a stack the buyer already carries of the same type, or start one. Either way the
  // buyer both HOLDS and OWNS what they paid for — this is the transition that makes a purchase
  // different from a pickup.
  const how = opts.how ?? 'bought';
  const carried = buyer.inventory.map(id => world.item(id)).find(i => !!i && i.type === source.type && i.holderId === buyer.id && i.quantity > 0);
  let stack: Item;
  if (carried) { carried.quantity += take; stack = carried; }
  else stack = makeItem(world, source.type, source.name, { owner: buyer.id, holder: buyer.id, quantity: take, value: source.value });
  stack.ownerId = buyer.id;
  stack.provenance.push({ tick: world.now, eventId: ev.id, from: seller.id, to: buyer.id, how });
  if (drained) retireStack(source);
  return { units: take, paid: cost, stack, event: ev, refused: null };
}

/** The whole-object sale: a unique thing (a ring, a book, a named blade) changes hands entire
 * rather than by the unit. Kept distinct from `purchaseUnits` because a stack split makes no
 * sense here — and routed through the same willingness test, so a merchant's own lantern is as
 * unbuyable as their own bread. */
export function purchaseItem(world: World, buyer: Person, seller: Person, it: Item): PurchaseResult {
  if (it.quantity !== 1) return purchaseUnits(world, buyer, seller, it, 1);
  const willing = willingnessFor(world, seller, it, buyer);
  if (willing.reason) return { units: 0, paid: 0, stack: null, event: null, refused: willing.reason };
  const price = unitPriceFor(world, seller, it, buyer);
  if (buyer.wealth < price) return { units: 0, paid: 0, stack: null, event: null, refused: null };
  return { units: 1, paid: price, stack: it, event: null, refused: null, ...{} };
}

/** How much of `type` the seller could sell right now, across every stack they may sell from —
 * the quantity a client should offer, and the number an integrity check can compare against. */
export function sellableUnits(world: World, seller: Person, type: ItemType, buyer?: Person): number {
  let n = 0;
  for (const o of tradeOffersFrom(world, seller, buyer)) if (o.item.type === type) n += o.available;
  return n;
}

/** Who, if anyone, is standing here able to sell `buyer` something — used by the client to know
 * whether "buy" is even a meaningful option on a displayed good. */
export function sellerFor(world: World, it: Item, near?: EntityId): Person | null {
  if (!it.ownerId) {
    const place = placeOf(world, it);
    if (!place) return null;
    const operator = place.ownerId ?? place.workers[0] ?? null;
    return operator ? world.person(operator) ?? null : null;
  }
  void near;
  const owner = world.person(it.ownerId);
  return owner && owner.alive ? owner : null;
}
