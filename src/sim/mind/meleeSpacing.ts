import type { Body, Person } from '../core/types';
import type { World } from '../core/world';
import { applyInteractionMovement } from '../physical/interactionMovement';
import { requestGuard } from '../physical/guard';

export interface MeleeSpacing { hold: boolean; x: number; z: number; reason?: 'occupied_lane' | 'observed_commitment' | 'recovering_effort'; }
/** An ordinary attack-plan decision using fresh sight and current visible posture. No
 * target reservations, global attacker cap, hidden enemy plans, or player-specific rule.
 * An unseen flanker can still attack; a visible committed fighter temporarily has space. */
export function meleeSpacing(w: World, actor: Person, body: Body, target: Body): MeleeSpacing {
  const clear = { hold: false, x: 0, z: 0 };
  const dx = target.pos.x - body.pos.x, dz = target.pos.z - body.pos.z, distance = Math.hypot(dx, dz);
  if (distance < .001 || distance > 5) return clear;
  const forward = { x: dx / distance, z: dz / distance };
  let side = 0, reason: MeleeSpacing['reason'];
  const seen = actor.mind.percepts.filter(p => p.how === 'saw' && w.now - p.tick <= 2 && p.tick <= w.now)
    .sort((a, b) => a.bodyId.localeCompare(b.bodyId));
  if ((body.exertion?.load ?? 0) > .7 && seen.some(p => p.bodyId === target.id)
    && w.grid.lineOfSight({ ...body.pos, y: body.pos.y + 1.5 }, { ...target.pos, y: target.pos.y + 1.1 }, 8))
    return { hold: true, x: distance < 2.5 ? -forward.x * .7 : 0, z: distance < 2.5 ? -forward.z * .7 : 0, reason: 'recovering_effort' };
  for (const percept of seen) {
    if (percept.bodyId === body.id || percept.bodyId === target.id) continue;
    const other = w.body(percept.bodyId);
    if (!other?.present || other.dead || other.pose === 'downed' || other.ownerId !== percept.entityId) continue;
    if (!w.grid.lineOfSight({ ...body.pos, y: body.pos.y + 1.5 }, { ...other.pos, y: other.pos.y + 1.1 }, 8)) continue;
    const ox = other.pos.x - body.pos.x, oz = other.pos.z - body.pos.z;
    const along = ox * forward.x + oz * forward.z, cross = ox * forward.z - oz * forward.x;
    const occupied = along > .1 && along < distance - .3 && Math.abs(cross) < .65;
    const a = other.combatAction;
    const committed = a?.kind === 'attack' && a.targetBodyId === target.id && a.outcome === 'pending'
      && a.startedAt <= w.physicalTime && a.recoveryAt > w.physicalTime
      && Math.hypot(other.pos.x - target.pos.x, other.pos.z - target.pos.z) < 3.5;
    if (!occupied && !committed) continue;
    reason = occupied ? 'occupied_lane' : 'observed_commitment';
    // Move away from a occupied lane. At exact collinearity use stable body identity,
    // not random draws or a player designation, to avoid two partners choosing the same side.
    side += Math.abs(cross) > .05 ? -Math.sign(cross) : body.id < other.id ? -1 : 1;
  }
  if (!reason) return clear;
  side = Math.sign(side) || 1;
  const retreat = distance < 1.55 ? .6 : distance > 2.3 ? -.15 : 0;
  return { hold: true, x: forward.z * side * .22 - forward.x * retreat,
    z: -forward.x * side * .22 - forward.z * retreat, reason };
}

export function applyMeleeSpacing(w: World, actor: Person, body: Body, target: Body, dt: number): boolean {
  const s = meleeSpacing(w, actor, body, target); if (!s.hold) return false;
  applyInteractionMovement(w, actor, body, { x: s.x, z: s.z, sprint: false,
    facing: Math.atan2(body.pos.x - target.pos.x, body.pos.z - target.pos.z) }, Math.min(.1, dt));
  requestGuard(w, body.id, s.reason !== 'recovering_effort'); return true;
}
