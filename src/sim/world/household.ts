import type { EntityId, Household, Person } from '../core/types';
import type { World } from '../core/world';

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

