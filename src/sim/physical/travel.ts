import type { Body } from '../core/types';
import type { World } from '../core/world';

/** Body-only path traversal for coarse physical stepping. Navigator remains the route and
 * step-height authority. Bounded sweeps prevent tunnelling on smoothed routes or large dt.
 * Door operation, flight and combat displacement are deliberately not implicit capabilities. */
export function travelPath(world: World, body: Body, seconds: number, speed: number, radius: number, height: number): number {
  if (seconds <= 0 || speed <= 0 || body.dead || !body.present) return 0;
  let budget = seconds * speed, distance = 0;
  const start = { ...body.pos };
  while (body.path && body.pathIndex < body.path.length && budget > 1e-9) {
    const target = body.path[body.pathIndex], dx = target.x - body.pos.x, dz = target.z - body.pos.z, d = Math.hypot(dx, dz);
    if (d < 1e-6) { body.pathIndex++; continue; }
    const step = Math.min(d, budget, 0.35), x = body.pos.x + dx / d * step, z = body.pos.z + dz / d * step;
    const floor = world.nav.floorY(Math.floor(x), Math.floor(z));
    let fits = world.nav.canStepTo(body.pos, x, z) && world.nav.walkCost(Math.floor(x), Math.floor(z)) < 3;
    let clearance = floor;
    for (let ix = Math.floor(x - radius); ix <= Math.floor(x + radius); ix++) for (let iz = Math.floor(z - radius); iz <= Math.floor(z + radius); iz++) {
      const edge = world.nav.floorY(ix, iz);
      if (edge < 0 || Math.abs(edge - floor) > 1.05) fits = false;
      clearance = Math.max(clearance, edge);
    }
    for (let ix = Math.floor(x - radius); ix <= Math.floor(x + radius); ix++) for (let iz = Math.floor(z - radius); iz <= Math.floor(z + radius); iz++)
      for (let iy = Math.floor(clearance + 0.05); iy <= Math.floor(clearance + height); iy++) if (world.grid.isSolidAt(ix, iy, iz)) fits = false;
    if (!fits) { body.path = null; body.pathGoal = null; break; }
    body.pos = { x, y: floor, z }; budget -= step; distance += step;
    body.yaw = Math.atan2(-dx, -dz) || 0; // JSON preserves 0, not JavaScript's negative zero
  }
  if (body.path && body.pathIndex >= body.path.length) { body.path = null; body.pathGoal = null; }
  body.vel = { x: (body.pos.x - start.x) / seconds, y: 0, z: (body.pos.z - start.z) / seconds };
  body.onGround = true;
  return distance;
}
