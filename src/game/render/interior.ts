import type { World } from '../../sim/core/world';
import type { Vec3 } from '../../sim/core/types';
import type { RevealBox } from '../voxel/mesher';

/**
 * v0.10.1 Part III — which building, if any, should currently be drawn without its roof.
 *
 * Membership comes from the canonical world (`World.placeAt`, which resolves a position to the
 * smallest Place whose `bounds` contain it) rather than from a radius around the camera or a
 * height test against the terrain. That matters: a coordinate rule cannot tell "inside the
 * bakery" from "standing in the alley beside it", and gets steadily worse as the village grows.
 * A Place knows its own footprint, so the answer is exact and stays exact.
 *
 * The box is the building's footprint widened by one on each side, because that is exactly how
 * far the gable overhangs it (`world/structures.ts` fills its roof courses from `x0 - 1` to
 * `x1 + 1`) — without the eave the roof comes off but its rim stays behind as a floating frame.
 */

/** How far above the occupant's feet the roof comes off. Three blocks clears a standing person
 * and the doorway they walked through, and leaves the room's own walls standing to about eye
 * height, which is what makes the shot read as "inside a room" rather than as a floor plan. */
export const REVEAL_HEADROOM = 3;

export function revealFor(world: World, focus: Vec3): RevealBox | null {
  const place = world.placeAt(focus);
  if (!place || !place.indoor) return null;
  const b = place.bounds;
  // Clamped to the building's own recorded top: a person standing on an upper floor should have
  // the roof above THEM taken off, but the cut can never sit above the structure it belongs to.
  const y = Math.min(b.y1 + 1, Math.floor(focus.y) + REVEAL_HEADROOM);
  return { x0: b.x0 - 1, x1: b.x1 + 1, z0: b.z0 - 1, z1: b.z1 + 1, y };
}
