import type { CombatAction, CombatInput } from './combatActionTypes';
import { INTERACTION_SPEC as S } from './prediction';

/** Shared physical transition policy; the native predictor mirrors these generated constants.
 * Contact commitment is never shortened. Only the recovery tail can be replaced. */
export function combatTransitionAt(a: CombatAction | undefined, next: CombatInput['kind']): number {
  if (!a) return -Infinity;
  if (a.outcome === 'interrupted' || a.outcome === 'cancelled') return a.completeAt;
  if (a.kind === 'attack') return Math.min(a.completeAt, a.recoveryAt + (next === 'attack' ? S.attackChainSeconds : S.attackEvadeSeconds));
  if (a.kind === 'duck') return a.completeAt;
  return a.recoveryAt;
}

export const stepProgress = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x*x*(3-2*x);
};
