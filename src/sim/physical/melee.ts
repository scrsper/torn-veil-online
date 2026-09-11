import { requestCombatAction } from './combatAction';
import { combatReach, ATTACK_COOLDOWN } from './combat';
import type { Body, Person } from '../core/types';
import type { Simulation } from '../mind/agent';

/** Legacy maximum presentation reach. Actual eligibility uses the actor's weapon reach.
 * Recovery and resolution remain canonical for every client. */
export const MELEE_REACH = 3.2;
export const MELEE_COOLDOWN = ATTACK_COOLDOWN;

/** How far off directly-ahead a body may be and still be struck by an untargeted swing. */
const SWING_ARC = 0.35;

export type MeleeResult = string;

/** Client target selection is a hint. Acceptance starts a committed action; the shared
 * canonical lifecycle establishes contact later, after a real response window. */
export function meleeStrike(sim: Simulation, actor: Person, body: Body, targetBodyId: string | null, trajectory: 'high'|'mid'|'low' = 'high', commandId?: string): MeleeResult {
  const w = sim.world;
  const reach = combatReach(w, actor);
  if (body.ownerId !== actor.id || !body.present || body.dead || !actor.alive) return 'incapacitated';
  if (actor.surrender || actor.custody?.active || body.pose === 'downed' || body.subduedUntil > w.physicalTime) return 'incapacitated';
  if (w.physicalTime - body.lastAttackAt < MELEE_COOLDOWN) return 'cooldown';

  const reachable = (b: Body): number | null => {
    if (b.id === body.id || !b.present || b.dead || b.shape !== 'humanoid') return null;
    const holder = w.get(b.ownerId);
    if (!holder || (holder.kind !== 'person' && holder.kind !== 'creature')) return null;
    const d = Math.hypot(b.pos.x - body.pos.x, b.pos.y - body.pos.y, b.pos.z - body.pos.z);
    if (d > reach) return null;
    // Being within 3.2 m of someone is not the same as being able to hit them: a wall, a shutter
    // or a closed door may be in the way. The browser player has never been able to strike through
    // one, because it picks its target by raycast and the wall stops the pick — this path picked by
    // distance alone, so an external client could stand outside the bakery and strike the baker
    // inside it. The check belongs here, on the canonical side, and not in any client.
    const chest = 1.2;
    if (!w.grid.lineOfPassage(
      { x: body.pos.x, y: body.pos.y + chest, z: body.pos.z },
      { x: b.pos.x, y: b.pos.y + chest, z: b.pos.z },
      reach + 1)) return null;
    return d;
  };

  let target: Body | null = null;
  if (targetBodyId) {
    // Named requests use the shared validator, preserving precise rejection reasons.
    const result=requestCombatAction(w,{attackerId:actor.id,attackerBodyId:body.id,targetBodyId,attackMode:'strike',trajectory},commandId);
    return result.attempted?'accepted':result.rejection??'invalid_target';
  } else {
    let best = Infinity;
    const fx = -Math.sin(body.yaw), fz = -Math.cos(body.yaw);
    for (const b of w.bodies()) {
      const d = reachable(b);
      if (d === null || d >= best) continue;
      const len = d || 1;
      if (((b.pos.x - body.pos.x) / len) * fx + ((b.pos.z - body.pos.z) / len) * fz < SWING_ARC) continue;
      best = d; target = b;
    }
  }

  const result=requestCombatAction(w,{attackerId:actor.id,attackerBodyId:body.id,targetBodyId:target?.id??'',attackMode:'strike',trajectory},commandId);
  return result.attempted?'accepted':result.rejection??'invalid_target';
}