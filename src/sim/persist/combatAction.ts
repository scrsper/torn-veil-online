import type { CombatAction } from '../physical/combatActionTypes';

/** Additive save field: older saves have no live action. Malformed live actions must
 * not become executable state or silently disappear on reload. */
export function validSavedCombatAction(value: unknown, bodyId: string): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const a = value as CombatAction;
  const vector = (v: unknown): boolean => !!v && typeof v === 'object'
    && ['x', 'y', 'z'].every(k => Number.isFinite((v as Record<string, unknown>)[k]));
  if (typeof a.id !== 'string' || !a.id || a.actorBodyId !== bodyId
    || !['attack', 'sidestep', 'backstep', 'duck'].includes(a.kind)
    || !['high', 'mid', 'low'].includes(a.trajectory)
    || !['requested', 'accepted', 'preparation', 'active', 'recovery', 'complete', 'interrupted', 'cancelled', 'missed'].includes(a.phase)
    || !['pending', 'hit', 'miss', 'interrupted', 'cancelled'].includes(a.outcome)) return false;
  if (![a.startedAt, a.startTick, a.activeAt, a.recoveryAt, a.completeAt, a.facing,
    a.initialFacing, a.trackingUntil, a.turnRate, a.turnBudget, a.reach, a.radius,
    a.impact, a.exertionCost, a.distance, a.appliedDistance].every(Number.isFinite)) return false;
  if (!vector(a.direction) || a.activeAt < a.startedAt || a.recoveryAt < a.startedAt
    || a.completeAt < a.recoveryAt || a.completeAt - a.startedAt > 3
    || a.radius <= 0 || a.reach < 0 || a.impact < 0 || a.distance < 0 || a.appliedDistance < 0) return false;
  if (a.stoppedAt !== undefined) {
    if (!Number.isFinite(a.stoppedAt) || a.stoppedAt < a.startedAt) return false;
  } else if (a.recoveryAt < a.activeAt) return false;
  if (a.contact && (!Number.isFinite(a.contact.at) || a.contact.at < a.activeAt
    || !vector(a.contact.position) || typeof a.contact.bodyId !== 'string'
    || !['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(a.contact.region))) return false;
  return true;
}
