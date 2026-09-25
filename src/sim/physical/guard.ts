import { INTERACTION_SPEC as S } from './prediction';
import type { Body, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { movementState } from './interactionMovement';
import { combatTransitionAt } from './combatTransitions';
import { syncNeeds } from '../core/physiology';

/** Per-manifestation stance; the short lease must be refreshed by ordinary input/intent.
 * Raising repeatedly cannot reopen the timing window before the recovery interval. */
export interface GuardState { startedAt: number; until: number; rearmAt: number; eventId: string; }
export const GUARD_LEASE_SECONDS = S.guardLeaseSeconds, PARRY_SECONDS = S.parrySeconds;
export function validSavedGuard(value: unknown, at: number): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const g = value as GuardState;
  return [g.startedAt, g.until, g.rearmAt].every(Number.isFinite) && g.startedAt >= -1 && g.startedAt <= at
    && (g.startedAt === -1 || g.startedAt >= 0) && g.until >= 0 && g.rearmAt >= 0 && g.rearmAt <= at + S.guardRearmSeconds + 1e-6
    && g.until <= at + GUARD_LEASE_SECONDS + 1e-6 && typeof g.eventId === 'string' && g.eventId.length > 0;
}
export function guardHeld(w: World, b: Body): boolean { return !!b.guard && b.guard.until > w.physicalTime; }
export function requestGuard(w: World, bodyId: string, held: boolean): string {
  const b = w.body(bodyId), p = b && w.person(b.ownerId), at = w.physicalTime;
  if (!b || !p) return 'incapacitated';
  if (!held) { if (b.guard) b.guard.until = at; return 'accepted'; }
  if (!movementState(w, p, b).eligible || !b.onGround) return 'incapacitated';
  if (at + 1e-9 < combatTransitionAt(b.combatAction, 'move')) return 'committed';
  if (p.physiology.fatigue >= 0.92) return 'exhausted';
  if (guardHeld(w, b)) { b.guard!.until = at + GUARD_LEASE_SECONDS; return 'accepted'; }
  const ready = !b.guard || at >= b.guard.rearmAt;
  const ev = w.emit('combat_action', { actor: p.id, pos: { ...b.pos }, visibility: 12, loudness: 0,
    data: { kind: 'guard', phase: 'accepted', actorBodyId: b.id, physicalTime: at }, summary: `${p.name} raised a guard` });
  b.guard = { startedAt: ready ? at : -1, until: at + GUARD_LEASE_SECONDS, rearmAt: Math.max(at + S.guardRearmSeconds, b.guard?.rearmAt ?? 0), eventId: ev.id };
  p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.012); syncNeeds(p);
  return 'accepted';
}

/** Only called after canonical contact. Facing, timing and remaining effort decide mitigation.
 * A boar's committed charge can be braced, but cannot be parried like a human weapon. */
export function guardContact(w: World, ab: Body, tb: Body, impact: number, at = w.physicalTime, cause?: string): { impact: number; event?: WorldEvent; parried: boolean } {
  const p = w.person(tb.ownerId), g = tb.guard;
  const unchanged = { impact, parried: false };
  if (!p || !g || g.until <= at || g.startedAt > at || !movementState(w, p, tb).eligible || p.physiology.fatigue >= 0.97) return unchanged;
  const dx = ab.pos.x - tb.pos.x, dz = ab.pos.z - tb.pos.z, distance = Math.hypot(dx, dz);
  if (distance < 0.001 || (-Math.sin(tb.yaw) * dx - Math.cos(tb.yaw) * dz) / distance < 0.35) return unchanged;
  const cost = 0.025 + impact / 180;
  const parried = g.startedAt >= 0 && at - g.startedAt <= PARRY_SECONDS && w.person(ab.ownerId) !== undefined;
  const broken = p.physiology.fatigue + cost > 0.97;
  p.physiology.fatigue = Math.min(1, p.physiology.fatigue + cost * (parried && !broken ? 0.5 : 1)); syncNeeds(p);
  if (broken) g.until = at;
  // A parry consumes its window, even against simultaneous attackers.
  if (parried) g.startedAt = -1;
  const result = broken ? impact : parried ? 0 : impact * (w.person(ab.ownerId) ? 0.3 : 0.65);
  const event = w.emit('combat_action', { actor: p.id, target: ab.ownerId, pos: { ...tb.pos }, visibility: 18, loudness: 6,
    causes: [g.eventId, ...(cause ? [cause] : [])], significance: 0.35,
    data: { kind: 'guard', phase: 'contact', outcome: broken ? 'broken' : parried ? 'parried' : 'blocked', actorBodyId: tb.id, targetBodyId: ab.id, physicalTime: at, incomingImpact: impact, impact: result },
    summary: `${p.name}'s guard ${broken ? 'broke' : parried ? 'turned the strike aside' : 'absorbed part of the blow'}` });
  return { impact: result, event, parried: parried && !broken };
}
