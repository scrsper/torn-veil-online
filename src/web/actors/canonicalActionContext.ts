import type { CombatActionState } from '../net/messages';
import type { CombatContext } from './combatPose';

/** Presentation timing only; the shared host owns contact and recovery. */
export const contextFor = (a: CombatActionState | null, time: number, yaw: number): CombatContext | null => {
    if (!a || time > a.completeAt || ['complete', 'cancelled', 'interrupted'].includes(a.phase)) return null;
    const d = a.direction;
    return { moveId: a.kind === 'attack' ? a.moveId ?? (a.variant === 'kick' ? 'front_kick' : a.variant === 'round' ? 'round_kick' : a.variant === 'hook' ? 'cross' : 'jab') : a.kind,
      definition: a.definition, trajectory: a.trajectory,
      weight: a.definition.includes('heavy') ? 'heavy' : 'light', age: Math.max(0, time - a.startedAt), prep: a.activeAt - a.startedAt, active: a.recoveryAt - a.activeAt, recovery: a.completeAt - a.recoveryAt,
      dirLocal: { x: -Math.cos(yaw) * d.x + Math.sin(yaw) * d.z, z: -Math.sin(yaw) * d.x - Math.cos(yaw) * d.z } };
  };
