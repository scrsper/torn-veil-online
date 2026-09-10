import { movementMultiplier } from '../core/attributes';
import type { Body, Person } from '../core/types';
import type { Simulation } from '../mind/agent';
import { noteHaulMovement } from '../logistics/haul';
import { B } from './blocks';

/** How much faster a sprint is than a walk. Canonical, and reported to external clients in the
 * bridge snapshot so a presentation layer predicts with this number rather than one of its own. */
export const SPRINT_MULTIPLIER = 1.55;

/** External control is intent, never a client-authored transform. Uses the canonical grid. */
export function moveByIntent(sim: Simulation, actor: Person, body: Body, x: number, z: number, sprint: boolean, dt: number): void {
  const w = sim.world;
  if (body.ownerId !== actor.id || !body.present || body.dead || !actor.alive) return;
  if (actor.surrender || actor.custody?.active || body.pose === 'downed' || body.subduedUntil > w.physicalTime) {
    body.vel.x = body.vel.z = 0;
    return;
  }
  if (![x, z, dt].every(Number.isFinite) || dt <= 0 || dt > 0.1) return;
  const length = Math.max(1, Math.hypot(x, z));
  const speed = body.speed * movementMultiplier(body) * (sprint ? SPRINT_MULTIPLIER : 1);
  const old = { ...body.pos };
  const g = w.grid;
  const fits = (px: number, pz: number): boolean => {
    if (px < 1 || pz < 1 || px > g.W - 1 || pz > g.D - 1) return false;
    const floor = w.nav.floorY(Math.floor(px), Math.floor(pz));
    if (!w.nav.canStepTo(body.pos, px, pz)) return false;
    // A footprint can straddle a one-metre stair while its centre descends. Checking the
    // entire footprint from only the lower centre floor made the old ground a new wall.
    let clearance = floor;
    for (let ix = Math.floor(px - 0.3); ix <= Math.floor(px + 0.3); ix++) for (let iz = Math.floor(pz - 0.3); iz <= Math.floor(pz + 0.3); iz++) {
      const edge = w.nav.floorY(ix, iz);
      if (edge < 0 || Math.abs(edge - floor) > 1.05) return false;
      clearance = Math.max(clearance, edge);
      // Same ordinary door operation as NPC path following; World emits its causal event.
      if ((x || z) && g.get(ix, edge, iz) === B.Door && !g.isDoorOpen(ix, edge, iz)) w.setDoorOpen({ x: ix, y: edge, z: iz }, true, actor.id);
    }
    for (let ix = Math.floor(px - 0.3); ix <= Math.floor(px + 0.3); ix++)
      for (let iz = Math.floor(pz - 0.3); iz <= Math.floor(pz + 0.3); iz++)
        for (let iy = Math.floor(clearance + 0.05); iy <= Math.floor(clearance + 1.75); iy++)
          if (g.isSolidAt(ix, iy, iz)) return false;
    return true;
  };
  const nx = body.pos.x + x / length * speed * dt;
  if (fits(nx, body.pos.z)) body.pos.x = nx;
  const nz = body.pos.z + z / length * speed * dt;
  if (fits(body.pos.x, nz)) body.pos.z = nz;
  const floor = w.nav.floorY(Math.floor(body.pos.x), Math.floor(body.pos.z));
  if (floor >= 0) body.pos.y = floor;
  body.vel = { x: (body.pos.x - old.x) / dt, y: (body.pos.y - old.y) / dt, z: (body.pos.z - old.z) / dt };
  noteHaulMovement(w,actor,old,body.pos);
  body.onGround = true;
  const moving = Math.hypot(body.vel.x, body.vel.z) > 0.05;
  if (moving) body.yaw = Math.atan2(-body.vel.x, -body.vel.z);
  if (body.poseUntil <= w.physicalTime) body.pose = moving ? (sprint ? 'run' : 'walk') : 'stand';
}

