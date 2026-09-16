import type { Body } from '../sim/core/types';
import type { World } from '../sim/core/world';

/** Physical presentation residency, not a mind's identification/attention budget.
 * The third-person camera can show a nearby silhouette without teaching its observer
 * a name, occupation, intention or memory. Never feed this set into cognition or
 * interaction admission. Occlusion and range are checked against canonical geometry;
 * camera frustum culling remains the renderer's responsibility.
 */
export function humanoidPresence(world: World, viewer: Body | undefined): Body[] {
  if (!viewer?.present || viewer.dead || viewer.pose === 'sleep') return [];
  const range = world.weather.kind === 'fog' ? 32 : 96;
  const eye = { ...viewer.pos, y: viewer.pos.y + 1.5 };
  return world.nearbyPhysicalBodies(viewer.pos, range).filter(body =>
    body.id !== viewer.id && body.shape === 'humanoid' && body.present &&
    world.grid.lineOfSight(eye, { ...body.pos, y: body.pos.y + 1.2 }, range + 2));
}
