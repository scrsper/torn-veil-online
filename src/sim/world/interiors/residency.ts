import type { Body, Person } from '../../core/types';
import type { World } from '../../core/world';

/** Cleared folded rooms have no open encounter. Retain every person/body and all
 * history, but run detailed cognition/physics only for the current room. This is
 * resolution, never death, withdrawal, healing, or a new version of a character. */
const cache = new WeakMap<World, { key: string; sourcePeople: readonly Person[]; sourceBodies: readonly Body[];
  people: Person[]; bodies: Body[]; physical: Body[]; remote: Person[]; remoteIds: Set<string> }>();
function residents(w: World) {
  const r = w.canonicalTower, people = w.livingPersons(), bodies = w.activeBodies();
  const key = `${r?.id}:${r?.active}:${r?.floor}:${r?.floors.length}:${people.length}:${bodies.length}:${w.bodies().length}`;
  const previous = cache.get(w);
  if (previous?.key === key && previous.sourcePeople === people && previous.sourceBodies === bodies) return previous;
  const dormantBodies = new Set(r?.floors.filter(f => !r.active || f.floor < r.floor && f.clearEventId).flatMap(f => f.enemyBodyIds) ?? []);
  const remote = people.filter(p => p.bodies.length > 0 && p.bodies.every(id => dormantBodies.has(id)));
  const remoteIds = new Set(remote.map(p => p.id));
  const value = { key, sourcePeople: people, sourceBodies: bodies, people: people.filter(p => !remoteIds.has(p.id)),
    bodies: bodies.filter(b => !dormantBodies.has(b.id)), physical: w.bodies().filter(b => !dormantBodies.has(b.id)), remote, remoteIds };
  cache.set(w, value); return value;
}
export function detailedPeople(w: World): readonly Person[] { return residents(w).people; }
export function detailedBodies(w: World): readonly Body[] { return residents(w).bodies; }
export function physicalResidents(w: World): readonly Body[] { return residents(w).physical; }
/** One completed floor per world minute, at most 32 bodies. Per-person timestamps
 * are saved; coarse needs account for real elapsed time without offscreen practice,
 * attacks, inventory changes or invented encounters. */
export function coarseTowerPeople(w: World): Person[] {
  const r = w.canonicalTower, count = r ? r.floor - (r.active ? 1 : 0) : 0; if (!r || !count) return [];
  const floor = r.floors[Math.floor(w.now / 60) % count];
  const remote = residents(w).remoteIds;
  return floor.enemyBodyIds.flatMap(id => { const p = w.person(w.body(id)?.ownerId); return p?.alive && remote.has(p.id) ? [p] : []; });
}
export function towerResidency(w: World) {
  const r = residents(w); return { detailedPeople: r.people.length, detailedBodies: r.bodies.length,
    coarsePeople: r.remote.length, maximumCoarsePeoplePerMinute: 32 };
}
