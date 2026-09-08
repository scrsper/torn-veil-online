import type { Place, PlaceType, Vec3 } from '../core/types';
import type { World } from '../core/world';

/**
 * WHICH PLACE OF THIS KIND — asked from somewhere, never asked of the world at large.
 *
 * `world.places().find(p => p.type === X)` means "the first place of this type anywhere in the
 * world", and there are dozens of those call sites in `src/sim/`. In a one-village world they all
 * happen to be right; the moment a second settlement exists they all silently bind to the first
 * one, and four villages grind their grain at one mill. That is a real correctness problem, not a
 * cosmetic one, and it is the subject of its own pass.
 *
 * This is the shape the answer should take: the place of this kind NEAREST TO WHERE THE ASKER
 * ACTUALLY IS. Straight-line distance today, because that is what the world's own `nearest*`
 * helpers (`physical/nav.ts`, `world/resources.ts`, `mind/succession.ts`, `mind/pursuit.ts`) use
 * and it is honest about being an approximation; reachability over the navigator is the correct
 * long-run answer and this signature does not have to change to get it. Deliberately NOT a
 * settlement-id filter: a label deciding what an agent may reach is the same inversion Adaptive
 * Society deleted when it removed the `p.occupation === 'miller'` gate.
 *
 * Falls back to the first place of the type when the asker has no position, so a caller that had
 * no locality to speak of behaves exactly as it did before.
 */
export function nearestPlaceOfType(world: World, from: Vec3 | null | undefined, type: PlaceType): Place | undefined {
  let best: Place | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const place of world.places()) {
    if (place.type !== type) continue;
    if (!from) return place;
    const d = Math.hypot(place.inside.x - from.x, place.inside.z - from.z);
    // Ties broken by id so the answer is deterministic when two places are equidistant.
    if (d < bestD || (d === bestD && best && place.id < best.id)) { best = place; bestD = d; }
  }
  return best;
}

/** Where a person's day is anchored: their body if they have one, otherwise their home. */
export function whereaboutsOf(world: World, personId: string): Vec3 | undefined {
  const body = world.primaryBody(personId);
  if (body) return body.pos;
  const person = world.person(personId);
  return person?.homeId ? world.place(person.homeId)?.inside : undefined;
}
