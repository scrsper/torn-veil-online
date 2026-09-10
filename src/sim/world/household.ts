import type { EntityId, Household, Item, Person } from '../core/types';
import type { World } from '../core/world';
import { isFood, makeItem } from './factory';
import { retireStack } from './stock';
import { learn } from '../mind/knowledge';

export function householdOf(world: World, person: Person): Household | undefined {
  const h = world.get<Household>(person.householdId);
  return h?.kind === 'household' && h.memberIds.includes(person.id) ? h : undefined;
}

export function householdMembers(world: World, h: Household): Person[] {
  return h.memberIds.map(id => world.person(id)).filter((p): p is Person => !!p?.alive && p.householdId === h.id);
}

/** Ownership grants sharing; sharing a building alone does not. */
export function householdOwns(world: World, p: Person, item: Item): boolean {
  if (item.ownerId === p.id) return true;
  const h = householdOf(world, p);
  return !!h && (item.ownerId === h.id || householdMembers(world, h).some(q => q.id === item.ownerId));
}

export function homeFood(world: World, p: Person): Item[] {
  if (!p.homeId) return [];
  return world.itemsAtPlaces([p.homeId]).filter(i => !i.holderId && i.quantity > 0 && isFood(i.type)
    && (i.ownerId === null || householdOwns(world, p, i)));
}

export function atHome(world: World, p: Person): boolean {
  const pos = world.positionOf(p.id);
  const home = world.place(p.homeId);
  return !!home && !!pos && (world.placeAt(pos)?.id === home.id || world.distance2d(pos, home.inside) <= 3);
}

/** This is a witnessed pantry count, not a remotely refreshed household inventory. */
export function observeHome(world: World, p: Person): void {
  if (!world.positionOf(p.id) || !atHome(world, p)) return;
  const h = householdOf(world, p); if (!h) return;
  const key = `pantry:${h.id}`, claim = { placeId: p.homeId!, quantity: homeFood(world, p).reduce((n, i) => n + i.quantity, 0), resource: 'food' };
  const existing = p.knowledge[key];
  if (existing) {
    if (existing.claim.quantity !== claim.quantity) existing.sharedWith = [];
    existing.claim = claim; existing.learnedAt = world.now; existing.confidence = 1; existing.source = { type: 'self' }; existing.hops = 0;
  } else learn(world, p, { key, kind: 'state', confidence: 1, source: { type: 'self' }, claim }, true);
}

/** A member at home leaves surplus meals and contributes to a finite common purse. Members
 * collect shopping money here, physically, instead of spending a relative's remote wallet.
 * Kept as one canonical action for NPC plans and player commands. No periodic redistribution. */
export function provisionHousehold(world: World, p: Person): boolean {
  const h = householdOf(world, p);
  if (!p.alive || !h || !world.positionOf(p.id) || !atHome(world, p)) return false;
  const home = world.place(p.homeId)!;
  let keep = 1, deposited = 0;
  for (const id of [...p.inventory]) {
    const it = world.item(id);
    if (!it || it.holderId !== p.id || it.ownerId !== p.id || !isFood(it.type) || it.haulTaskId || it.quantity <= 0) continue;
    const retained = Math.min(keep, it.quantity); keep -= retained;
    const qty = it.quantity - retained; if (qty <= 0) continue;
    const ev = world.emit('household_provisioned', { actor: p.id, target: h.id, item: it.id, placeId: home.id,
      pos: { ...home.inside }, visibility: 8, significance: 0.12, data: { resource: it.type, quantity: qty },
      summary: `${p.name} left ${qty} ${it.type} for their household` });
    // Keep batch age and accumulated spoilage pressure when splitting a perishable stack.
    const share = makeItem(world, it.type, it.name, { owner: h.id, placeId: home.id, pos: { ...home.inside }, quantity: qty, value: it.value });
    share.createdAt = it.createdAt; share.spoilAccum = (it.spoilAccum ?? 0) * qty / it.quantity;
    it.spoilAccum = (it.spoilAccum ?? 0) - share.spoilAccum;
    share.provenance = [...it.provenance, { tick: world.now, eventId: ev.id, from: p.id, to: h.id, how: 'household provision' }];
    it.quantity -= qty; if (it.quantity <= 0) retireStack(world, it);
    deposited += qty;
  }
  const members = householdMembers(world, h).length;
  const contribution = members > 1 ? Math.max(0, Math.min((p.wealth - 6) / 2, members * 6 - h.wealth)) : 0;
  const withdrawal = Math.max(0, Math.min(6 - p.wealth, h.wealth));
  const net = contribution - withdrawal;
  if (net !== 0) {
    p.wealth -= net; h.wealth += net;
    world.emit('household_provisioned', { actor: p.id, target: h.id, placeId: home.id, pos: { ...home.inside },
      visibility: 8, significance: 0.1, data: { contributed: contribution, withdrawn: withdrawal },
      summary: net > 0 ? `${p.name} put ${net.toFixed(2)} silver into the household purse` : `${p.name} took ${(-net).toFixed(2)} silver for provisions` });
  }
  if (deposited) world.runTally.household_food_deposited = (world.runTally.household_food_deposited ?? 0) + deposited;
  observeHome(world, p);
  return true;
}

export function makeHousehold(world: World, name: string, homeId: EntityId | null): Household {
  return world.add({
    id: world.nextId('hh'), kind: 'household', name, createdAt: world.now,
    tags: [], memberIds: [], homeId, wealth: 0,
  });
}

export function joinHousehold(world: World, person: Person, household: Household): void {
  if (person.householdId === household.id && household.memberIds.includes(person.id)) return;
  const former = world.get<Household>(person.householdId);
  if (former?.kind === 'household') former.memberIds = former.memberIds.filter(id => id !== person.id);
  person.householdId = household.id;
  person.homeId = household.homeId ?? person.homeId;
  if (!household.memberIds.includes(person.id) && person.alive) household.memberIds.push(person.id);
  world.recordSettlementPopulations();
}

export function leaveHousehold(world: World, person: Person): void {
  const household = world.get<Household>(person.householdId);
  if (household?.kind === 'household') household.memberIds = household.memberIds.filter(id => id !== person.id);
  person.householdId = null;
}

/** Activate the existing home/resident topology as real household entities. */
export function establishHouseholds(world: World): Household[] {
  const byHome = new Map<EntityId, Household>();
  for (const p of world.persons()) {
    if (!p.alive || !p.homeId) continue;
    let household = byHome.get(p.homeId);
    if (!household) {
      household = makeHousehold(world, `${world.nameOf(p.homeId)} household`, p.homeId);
      byHome.set(p.homeId, household);
    }
    joinHousehold(world, p, household);
  }
  return [...byHome.values()];
}

export function householdConsistencyErrors(world: World): string[] {
  const errors: string[] = [];
  for (const household of world.households()) {
    const seen = new Set<EntityId>();
    for (const id of household.memberIds) {
      if (seen.has(id)) errors.push(`${household.id} contains duplicate member ${id}`);
      seen.add(id);
      const p = world.person(id);
      if (!p || !p.alive) errors.push(`${household.id} contains non-living/non-person member ${id}`);
      else if (p.householdId !== household.id) errors.push(`${id} points to ${p.householdId}, not ${household.id}`);
    }
  }
  for (const p of world.livingPersons()) {
    if (!p.householdId) continue;
    const h = world.get<Household>(p.householdId);
    if (!h || h.kind !== 'household' || !h.memberIds.includes(p.id)) errors.push(`${p.id} has inconsistent household ${p.householdId}`);
  }
  return errors;
}

