import type { ActorState } from './actorManager';
import type { CombatContext } from './combatPose';
import { localTravel } from './locomotion';

/** Maps the observed action, not attack counters or retained historical actions, to the shared rig. */
export function sharedActionClip(action: CombatContext, armed: boolean): string {
  switch (action.moveId) {
    case 'jab': return armed ? 'sword_and_shield/sword and shield slash' : 'unarmed/jab_left';
    case 'cross': return armed ? 'sword_and_shield/sword and shield slash (2)' : 'unarmed/cross_right';
    case 'front_kick': return 'unarmed/side_kick';
    case 'round_kick': return 'unarmed/roundhouse_right';
    case 'duck': return 'unarmed/slip_left';
    case 'backstep': return 'pro_longbow/standing dodge backward';
    case 'sidestep': return `pro_longbow/standing dodge ${(action.dirLocal?.x ?? action.side ?? 1) >= 0 ? 'left' : 'right'}`;
    default: return armed ? 'sword_and_shield/sword and shield slash' : 'unarmed/jab_left';
  }
}

/** Presentation phase warp: wind-up, visible strike, recovery share the canonical action clock. */
export function sharedActionProgress(action: CombatContext): number {
  const { age, prep, active, recovery } = action;
  if (age <= 0) return 0;
  if (age < prep) return .4 * age / Math.max(prep, 1e-6);
  if (age < prep + active) return .4 + .28 * (age - prep) / Math.max(active, 1e-6);
  return Math.min(1, .68 + .32 * (age - prep - active) / Math.max(recovery, 1e-6));
}

export function sharedMotionMode(s: ActorState): 'down' | 'action' | 'guard' | 'move' | 'idle' {
  if (s.body?.dead || s.body?.incapacitated || ['downed', 'sleep', 'dead'].includes(s.body?.pose ?? '')) return 'down';
  if (s.combat && s.combat.moveId !== 'guard') return 'action';
  if (s.guard || s.body?.guarding || s.combat?.moveId === 'guard') return 'guard';
  return s.speed > .08 ? 'move' : 'idle';
}

export function sharedTravelClip(s: Pick<ActorState, 'velocity' | 'yaw'>): string {
  const direction = localTravel(s.velocity, s.yaw);
  return Math.abs(direction.x) > Math.abs(direction.z) ? `unarmed/walk_strafe_${direction.x >= 0 ? 'left' : 'right'}`
    : direction.z < 0 ? 'unarmed/walk_backward' : 'unarmed/walk_forward';
}
