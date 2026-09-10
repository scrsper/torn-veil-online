import { knownName } from '../mind/people';
import type { EntityId, Item, Person, Place } from './types';
import type { World } from './world';
import { RESOURCE_CATEGORY, isFood, ITEM_LABEL } from '../world/factory';
import { TOOL_KINDS } from './tools';
import { affordancesOf } from './affordance';
import { recognizedUses } from '../mind/knowledge';
import { willingnessFor, unitPriceFor, operatesPlace, sellerFor } from '../world/commerce';

/**
 * v0.10.1 Part IX — "what can I actually do with this thing or this person, right now?"
 *
 * One derivation, canonical, shared by every surface that has to answer it: the world target
 * panel, the inventory panel, and the tests that assert a player cannot be offered something the
 * simulation would refuse. There is no per-object menu table anywhere; an option exists because a
 * fact about the world makes it possible, and carries the reason with it.
 *
 * Two rules keep this honest rather than decorative:
 *
 *  - **Nothing appears here that has no canonical implementation.** Every `PlayerAction` maps to a
 *    real `Simulation` call. There is no "examine closely", no "equip" (the tool system chooses
 *    the best tool for an action and has no selected slot to set), no verbs invented for the UI.
 *  - **It is epistemically constrained.** What the player is shown about ownership is what the
 *    player has actually learned (`owner:<id>` knowledge, or the plain fact that goods on a shop's
 *    display counter are for sale), never `Item.ownerId` read omnisciently. The developer observer
 *    overlay is the one surface allowed to be omniscient, and it does not use this module.
 *
 * The distinction the milestone cares most about lives in `take` vs `buy` vs `steal`: they are
 * three different canonical transitions, and this module's job is to make sure the player is told
 * which one they are about to perform BEFORE they perform it, not to prevent any of them.
 */
export type PlayerActionKind =
  | 'talk' | 'trade' | 'give' | 'inspect' | 'attack'          // people
  | 'take' | 'buy' | 'steal' | 'recover'                      // things in the world
  | 'eat' | 'drink' | 'drop';                                 // things in hand

export interface PlayerAction {
  kind: PlayerActionKind;
  /** What to show the player. Names the consequence, never softens it. */
  label: string;
  /** Why this is possible, or what it will cost — shown as a secondary line. */
  detail?: string;
  /** For `buy`: what it will cost. */
  price?: number;
  /** For `buy`/`steal`/`recover`: whose it is, when the player actually knows. */
  ownerId?: EntityId;
  /** True when performing this has a canonical consequence the player should weigh: a theft
   * event, an attack. The client marks these; it does not hide them. */
  grave?: boolean;
}

/** Does the player have real, acquired knowledge of who owns this? (`mind/knowledge.ts`'s
 * `owner:<itemId>` fact — witnessed, told, or seeded prior knowledge.) */
export function knowsOwnerOf(viewer: Person, it: Item): boolean {
  return !!viewer.knowledge[`owner:${it.id}`];
}

/** Goods laid out on a shop's own display counter announce themselves: anyone can see that a
 * stall's wares are for sale without being told. The same inference `HUD.itemStatusFor` makes. */
export function onSaleDisplay(world: World, it: Item): { place: Place; seller: Person } | null {
  if (!it.placeId || !it.pos || it.holderId) return null;
  const place = world.place(it.placeId);
  if (!place) return null;
  const near = place.anchors.some(a => a.kind === 'display' && Math.hypot(a.pos.x - it.pos!.x, a.pos.z - it.pos!.z) < 1.5);
  if (!near) return null;
  const seller = sellerFor(world, it);
  return seller && operatesPlace(seller, place) ? { place, seller } : null;
}

/**
 * What `viewer` may do with an item lying in the world. Order matters: the first entry is what
 * the primary interact key does, so it must be the least surprising reading of the situation —
 * buying the baker's bread rather than stealing it.
 */
export function actionsForWorldItem(world: World, viewer: Person, it: Item): PlayerAction[] {
  const out: PlayerAction[] = [];
  const label = it.name || ITEM_LABEL[it.type];
  const qty = it.quantity > 1 ? ` ×${it.quantity}` : '';

  const unowned = !it.ownerId || it.ownerId === viewer.id;
  if (unowned) {
    out.push({ kind: 'take', label: `Take ${label}${qty}`, detail: it.ownerId === viewer.id ? 'yours' : 'nobody claims it' });
    out.push(...inspectAction(viewer, it));
    return out;
  }

  // Someone else's. Is there a sale to be made here?
  //
  // A sale needs somebody to pay. Goods on an unattended counter are still someone's goods, and
  // helping yourself to them while the keeper is asleep upstairs is a theft, not a transaction —
  // so `buy` is offered only when the seller is actually present to take the money.
  const display = onSaleDisplay(world, it);
  const candidate = display?.seller ?? (knowsOwnerOf(viewer, it) ? world.person(it.ownerId) ?? null : null);
  const seller = candidate && sellerIsAtHand(world, viewer, candidate) ? candidate : null;
  if (seller && seller.alive && seller.id !== viewer.id) {
    const willing = willingnessFor(world, seller, it, viewer);
    if (!willing.reason) {
      const price = unitPriceFor(world, seller, it, viewer);
      const affordable = viewer.wealth >= price;
      out.push({
        kind: 'buy', price, ownerId: seller.id,
        label: it.quantity > 1 ? `Buy one ${it.type} — ${price}s` : `Buy ${label} — ${price}s`,
        detail: affordable ? `from ${seller.name}` : `from ${seller.name} · you have ${viewer.wealth} silver`,
      });
    } else {
      out.push({ kind: 'inspect', label: `Not for sale`, detail: willing.note });
    }
  }

  // Recovery: the narrow, evidence-gated case where picking up someone else's property is not
  // theft — they asked for it back, and this person actually heard them ask (v0.8 §1A).
  const wanted = viewer.knowledge[`wanted:${it.id}`];
  if (wanted && wanted.claim.requesterId === it.ownerId) {
    out.push({ kind: 'recover', label: `Pick up ${label} for ${world.nameOf(it.ownerId)}`, detail: 'they asked you to find it', ownerId: it.ownerId ?? undefined });
  } else if (knowsOwnerOf(viewer, it) || display) {
    const owner = world.nameOf(display ? display.seller.id : it.ownerId!);
    out.push({ kind: 'steal', label: `Take ${label}${qty} anyway`, detail: `it belongs to ${owner} — this is theft`, ownerId: it.ownerId ?? undefined, grave: true });
  } else {
    // They genuinely do not know whose it is. The action is still available and still canonically
    // a theft; what they are told is only that they are unsure, which is the truth.
    out.push({ kind: 'steal', label: `Take ${label}${qty}`, detail: `you are not sure whose this is`, grave: true });
  }
  out.push(...inspectAction(viewer, it));
  return out;
}

/** What `holder` may do with something they are carrying. */
export function actionsForCarriedItem(world: World, holder: Person, it: Item, nearby?: Person | null): PlayerAction[] {
  const out: PlayerAction[] = [];
  const label = it.name || ITEM_LABEL[it.type];
  if (isFood(it.type)) {
    const drinkable = it.type === 'ale';
    out.push({
      kind: drinkable ? 'drink' : 'eat',
      label: `${drinkable ? 'Drink' : 'Eat'} ${label}`,
      // Said plainly rather than implied: `eatFood` restores caloric energy, and nothing in the
      // simulation makes ale quench thirst, so the panel must not suggest that it does.
      detail: drinkable ? 'sates hunger, not thirst' : 'sates hunger',
    });
  }
  if (nearby && nearby.alive && nearby.id !== holder.id) {
    out.push({ kind: 'give', label: `Give to ${nearby.name}`, detail: it.ownerId && it.ownerId !== holder.id ? `note: this is ${world.nameOf(it.ownerId)}'s` : undefined });
  }
  out.push({ kind: 'drop', label: it.haulTaskId ? `Set down — gives up the haul` : `Drop ${label}`, detail: it.haulTaskId ? 'this is cargo you took on' : undefined, grave: !!it.haulTaskId });
  out.push(...inspectAction(holder, it));
  return out;
}

/** How far away a seller may be and still be someone you can hand money to. Generous enough to
 * cover a keeper standing anywhere behind their own counter, short enough that an empty shop is
 * an empty shop. */
export const SELLER_REACH = 7;
function sellerIsAtHand(world: World, viewer: Person, seller: Person): boolean {
  const a = world.primaryBody(viewer.id), b = world.primaryBody(seller.id);
  if (!a || !b || !b.present || b.dead || b.pose === 'sleep') return false;
  return Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z) <= SELLER_REACH;
}

/** Inspect is always available and is the one action that is purely epistemic — it reports what
 * this person knows, which for an unfamiliar object is very little. */
function inspectAction(viewer: Person, it: Item): PlayerAction[] {
  const uses = recognizedUses(viewer, it.type);
  const def = affordancesOf(it.type);
  return [{
    kind: 'inspect', label: 'Look closer',
    detail: uses.length ? uses.join(', ') : def ? 'you do not know what this is good for' : undefined,
  }];
}

/** What `viewer` may do with another person. */
export function actionsForPerson(world: World, viewer: Person, other: Person, carrying: Item[]): PlayerAction[] {
  const out: PlayerAction[] = [];
  const body = world.primaryBody(other.id);
  if (!other.alive || body?.dead) {
    out.push({ kind: 'take', label: `Search ${knownName(viewer, other.id)}`, detail: 'they are dead' });
    out.push({ kind: 'inspect', label: 'Look closer' });
    return out;
  }
  if (body?.pose === 'sleep') {
    out.push({ kind: 'inspect', label: `${knownName(viewer, other.id)} is asleep` });
    return out;
  }
  out.push({ kind: 'talk', label: `Talk to ${knownName(viewer, other.id)}`, detail: 'speak with this person' });
  // Trade appears only when they would actually sell this person something — the same offer list
  // the dialogue renders, so the prompt cannot promise a menu that turns out to be empty.
  if (hasAnythingToSell(world, other, viewer)) out.push({ kind: 'trade', label: 'Trade', detail: 'see what they have' });
  if (carrying.length) out.push({ kind: 'give', label: 'Give something', detail: `${carrying.length} thing${carrying.length === 1 ? '' : 's'} to hand` });
  out.push({ kind: 'inspect', label: 'Look closer' });
  out.push({ kind: 'attack', label: `Attack ${knownName(viewer, other.id)}`, grave: true });
  return out;
}

function hasAnythingToSell(world: World, seller: Person, buyer: Person): boolean {
  for (const it of world.items()) {
    if (it.quantity <= 0) continue;
    if (it.ownerId !== seller.id && !(it.ownerId == null && operatesPlace(seller, it.placeId ? world.place(it.placeId) : undefined))) continue;
    if (it.holderId && it.holderId !== seller.id) continue;
    if (!willingnessFor(world, seller, it, buyer).reason) return true;
  }
  return false;
}

/** A short, honest description of a carried object for the inventory panel: what it is, how much
 * of it, whose it is as far as this person knows, and its condition where the canonical `Item`
 * actually records one (tools do; a loaf of bread does not, and inventing a durability bar for
 * one would be exactly the decorative detail the milestone rules out). */
export function describeCarried(world: World, holder: Person, it: Item): string[] {
  const lines: string[] = [];
  lines.push(RESOURCE_CATEGORY[it.type]);
  if (it.quantity > 1) lines.push(`${it.quantity} of them`);
  if (it.ownerId && it.ownerId !== holder.id) lines.push(knowsOwnerOf(holder, it) ? `belongs to ${world.nameOf(it.ownerId)}` : 'not yours');
  if ((TOOL_KINDS as string[]).includes(it.type) && it.condition !== undefined) {
    const c = it.condition;
    lines.push(`condition ${Math.round(c * 100)}%${c < 0.35 ? ' — worn' : ''}`);
  }
  if (it.haulTaskId) lines.push('cargo for a job you took on');
  return lines;
}
