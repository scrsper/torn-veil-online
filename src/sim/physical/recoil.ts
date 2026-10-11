import { physicalResidents } from '../world/interiors/residency';
import type { Body, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { collisionColumn } from './interactionMovement';
import { INTERACTION_SPEC, predictMovement } from './prediction';

/** A short, source-backed displacement, separate from desired walking velocity. The
 * absolute physical clock and consumed fraction prevent replay after a save or coarse tick. */
export interface Recoil {
  version: 1; eventIds: string[]; startedAt: number; until: number; consumed: number;
  offset: { x: number; z: number };
}
const DURATION = .24, MAX_DISTANCE = .8;
export function receiveRecoil(w: World, body: Body, attacker: Body, damage: number, event: WorldEvent): void {
  if (damage <= 0 || !Number.isFinite(damage) || !body.present) return;
  const dx = body.pos.x - attacker.pos.x, dz = body.pos.z - attacker.pos.z, length = Math.hypot(dx, dz);
  if (length < .001) return;
  const action = attacker.combatAction;
  // The last action remains on the body after completion. Only this physical contact
  // may use its kick impulse; a later cast or unrelated hit cannot inherit that label.
  const kick = !event.data.arcaneEventId && action?.kind === 'attack'
    && event.data.combat?.actionId === action.id && ['front_kick', 'round_kick'].includes(action.moveId ?? '');
  // Actual transmitted damage (after guard / armor / ward), not a renderer impact flag.
  const distance = Math.min(.6, (kick ? .30 : .13) * Math.min(2, damage / 7));
  const old = body.recoil, remaining = old ? 1 - old.consumed : 0;
  let x = (old?.offset.x ?? 0) * remaining + dx / length * distance;
  let z = (old?.offset.z ?? 0) * remaining + dz / length * distance;
  const size = Math.hypot(x, z); if (size > MAX_DISTANCE) { x *= MAX_DISTANCE / size; z *= MAX_DISTANCE / size; }
  body.recoil = { version: 1, eventIds: [...(old?.eventIds ?? []), event.id].slice(-8),
    startedAt: w.physicalTime, until: w.physicalTime + DURATION, consumed: 0, offset: { x, z } };
}

/** Contact response applies even to a downed body; incapacity cannot make a wall porous.
 * Never opens a door, changes facing, grants invulnerability, or owns health / injuries. */
export function advanceRecoil(w: World, dt: number): void {
  for (const b of physicalResidents(w)) {
    const r = b.recoil; if (!r) continue;
    if (!b.present) { delete b.recoil; continue; }
    const t = Math.max(0, Math.min(1, (w.physicalTime - r.startedAt) / (r.until - r.startedAt)));
    const fraction = 1 - (1 - t) ** 2, delta = Math.max(0, fraction - r.consumed);
    const distance = Math.hypot(r.offset.x, r.offset.z), from = { ...b.pos };
    if (delta > 0 && distance > 0) {
      // Geometry kernel sweeps the whole displacement in bounded increments. Using its
      // fixed interval avoids changing friction or consuming the response twice with dt.
      // Keep posture clearance, but cancel the voluntary crouched-walking multiplier:
      // the source-backed external displacement is not a walking-speed request.
      const walkMultiplier = (b.crouch ?? 0) > .01 ? INTERACTION_SPEC.crouchSpeedMultiplier : 1;
      const next = predictMovement({ pos: b.pos, yaw: b.yaw, speed: distance * delta / (.05 * walkMultiplier),
        eligible: true, crouch: b.crouch }, { x: r.offset.x / distance, z: r.offset.z / distance, sprint: false },
      .05, (x, z) => collisionColumn(w, x, z));
      b.pos = next.pos;
      if (dt > 0) { b.vel.x += (b.pos.x - from.x) / dt; b.vel.z += (b.pos.z - from.z) / dt; }
    }
    r.consumed = fraction;
    if (t >= 1) delete b.recoil;
  }
}

export function validSavedRecoil(value: unknown, at: number, bodyId: string, events: WorldEvent[]): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const r = value as Recoil;
  return r.version === 1 && [r.startedAt, r.until, r.consumed, r.offset?.x, r.offset?.z].every(Number.isFinite)
    && r.startedAt >= 0 && r.startedAt <= at && r.until > r.startedAt && r.until <= r.startedAt + DURATION + 1e-8
    && r.consumed >= 0 && r.consumed <= 1 && Math.hypot(r.offset.x, r.offset.z) <= MAX_DISTANCE + 1e-8
    && Array.isArray(r.eventIds) && r.eventIds.length > 0 && r.eventIds.length <= 8
    && r.eventIds.every(id => events.some(e => e.id === id && e.type === 'attack' && e.data.targetBodyId === bodyId));
}
