import type { EntityId, Person, Place, PlaceType, Vec3 } from '../core/types';
import type { World } from '../core/world';

/**
 * WHICH PLACE OF THIS KIND — asked from somewhere, never asked of the world at large.
 *
 * `world.places().find(p => p.type === X)` means "the first place of this type anywhere in the
 * world". In a one-village world every such call happens to be right; the moment a second
 * settlement exists they all silently bind to whichever village generation happened to register
 * first, and four villages grind their grain at one mill. That is a correctness problem, not a
 * cosmetic one, and this module is where it is answered.
 *
 * THE ANSWER IS ALWAYS RELATIVE TO SOMEWHERE. Every function here takes the position the question
 * is being asked from, and the callers pass the asker's own whereabouts — a miller's body, a
 * construction site, the household a newborn was born into. Straight-line distance is what
 * decides today, which is what the world's own `nearest*` helpers already use
 * (`physical/nav.ts`, `world/resources.ts`, `mind/succession.ts`, `mind/pursuit.ts`) and is
 * honest about being an approximation. Reachability over the navigator is the correct long-run
 * answer and no signature here has to change to get it: `physical/nav.ts`'s `findPath` is already
 * the authority, and `headless/worldlab/invariants.ts` uses it to CHECK these answers at probe
 * cadence, where a real path query is affordable and a per-tick one is not.
 *
 * DELIBERATELY NOT A SETTLEMENT TAG. A `settlementId` filter would be a label doing a mechanism's
 * job — the same inversion Adaptive Society deleted when it removed the `p.occupation ===
 * 'miller'` gate on whether flour could be ground. Distance and reachability are derived, are
 * automatically right for N settlements, and let contact between settlements eventually emerge
 * from geography rather than from a flag being flipped.
 */

/** Every place of this kind, in a deterministic order. Used by the demand-raising passes, which
 * must consider EVERY mill rather than the first one: a bakery in one village going short is not
 * answered by a mill in another. */
export function placesOfType(world: World, type: PlaceType): Place[] {
  return world.places().filter(p => p.type === type).sort((a, b) => a.id.localeCompare(b.id));
}

const planarDistance = (a: Vec3, b: { x: number; z: number }): number => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * The place of this kind nearest to `from`. Falls back to the first place of the type when the
 * asker has no position at all, so a caller with no locality to speak of behaves exactly as it
 * did before. Ties break by id, so the answer is deterministic when two places are equidistant.
 */
export function nearestPlaceOfType(world: World, from: Vec3 | null | undefined, type: PlaceType): Place | undefined {
  return nearestPlaceWhere(world, from, p => p.type === type);
}

/** The same question for places identified by something other than their type — a slug, a name,
 * a tag. Same rule: nearest to the asker, deterministic tiebreak, first-match fallback when the
 * asker has no position. */
export function nearestPlaceWhere(world: World, from: Vec3 | null | undefined, match: (place: Place) => boolean): Place | undefined {
  let best: Place | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const place of world.places()) {
    if (!match(place)) continue;
    if (!from) return best ?? place;
    const d = planarDistance(from, place.inside);
    if (d < bestD || (d === bestD && best && place.id < best.id)) { best = place; bestD = d; }
  }
  return best;
}

/**
 * Where a person's life is anchored, for the purpose of asking a "which one of these" question.
 *
 * Their body first — that is where they actually are, and a miller standing at the stones should
 * resolve the mill they are standing in. Then their workplace, then their home: a question asked
 * about somebody with no manifest body (a historical figure, an entity between bodies) still has
 * a locality, because where they work and live is canonical state that outlives any body.
 */
export function whereaboutsOf(world: World, personOrId: Person | EntityId): Vec3 | undefined {
  const person = typeof personOrId === 'string' ? world.person(personOrId) : personOrId;
  if (!person) return undefined;
  const body = world.primaryBody(person.id);
  if (body) return body.pos;
  return world.place(person.workId ?? '')?.inside ?? world.place(person.homeId ?? '')?.inside;
}

/** The place of this kind nearest to where this person's life is — the ordinary form of the
 * question, and the one almost every caller wants. */
export function placeNear(world: World, person: Person, type: PlaceType): Place | undefined {
  return nearestPlaceOfType(world, whereaboutsOf(world, person), type);
}

/**
 * How far a person's ordinary life reaches, in metres.
 *
 * Not a settlement boundary and not a fence: it is the distance the village's own goals already
 * treat as "somewhere I might go about my business", taken from the widest of them rather than
 * invented — `mind/agent.ts` searches for a tree to fell for a construction project out to this
 * radius, which is the longest errand anybody in Ashford undertakes for work. Anything beyond it
 * is a journey, not an errand.
 *
 * The physical backstop for a multi-settlement world is distance and terrain, never this number:
 * settlements are meant to be far enough apart that ordinary people cannot reach one another, and
 * this constant is what a locality CHECK measures against, not what enforces it.
 */
export const ERRAND_RADIUS_METRES = 220;

/** Are these two points part of one locality — near enough that going from one to the other is an
 * errand rather than a journey? Planar distance today; `headless/worldlab/invariants.ts` proves
 * the same claim against real navigator paths at probe cadence. */
export function withinErrandRange(a: Vec3 | undefined, b: Vec3 | undefined): boolean {
  if (!a || !b) return true; // nothing to place: not a locality violation, just an unknown
  return planarDistance(a, b) <= ERRAND_RADIUS_METRES;
}
