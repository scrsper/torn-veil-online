import type { World } from '../core/world';
import type { Person, Place, PlaceType, Vec3 } from '../core/types';

/** Ordinary daily errands, not a geopolitical border. Long journeys need a future logistics
 * planner. These queries never compare settlement IDs. */
export const DAILY_LOCAL_RANGE = 256;
export function near(a: Vec3 | undefined | null, b: Vec3 | undefined | null, range = DAILY_LOCAL_RANGE): boolean {
  return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= range;
}
export function localPlaces(world: World, pos: Vec3 | undefined): Place[] {
  return pos ? world.nearbyPlaces(pos, DAILY_LOCAL_RANGE).filter(p => near(pos, p.inside)) : [];
}
export function placeForPerson(world: World, person: Person, type: PlaceType): Place | undefined {
  const pos = world.positionOf(person.id) ?? world.place(person.homeId)?.inside;
  return localPlaces(world, pos).find(p => p.type === type);
}
export function knownPlaceForPerson(world: World, person: Person, type: PlaceType): Place | undefined {
  return localPlaces(world, world.positionOf(person.id)).find(p => p.type === type &&
    (p.id === person.homeId || p.id === person.workId || person.schedule.some(e => e.placeId === p.id) || Object.values(person.knowledge).some(k => k.claim.placeId === p.id)));
}
export function peopleTogether(world: World, a: Person, b: Person, range = 18): boolean {
  return a.bodies.some(id => { const body = world.body(id); return body?.present && !body.dead &&
    b.bodies.some(other => { const q = world.body(other); return q?.present && !q.dead && near(body.pos, q.pos, range); }); });
}
