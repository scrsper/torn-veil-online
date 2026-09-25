import type { ConflictIntent, Vec3 } from '../core/types';
import type { ContactRegion } from './combatGeometry';
export type CombatPhase = 'requested'|'accepted'|'preparation'|'active'|'recovery'|'complete'|'interrupted'|'cancelled'|'missed';
export type DefenseKind = 'sidestep'|'backstep'|'duck';
export interface CombatInput {
  kind:'attack'|DefenseKind; trajectory?:'high'|'mid'|'low'; targetBodyId?:string;
  held?:boolean; side?:number; direction?:{x:number;z:number}; commandId?:string;
  weight?:'light'|'heavy';
}
/** One latest action per manifestation; terminal state is replaced on the next request.
 * Timing/definition are frozen at acceptance, so saves never reinterpret a live strike. */
export interface CombatAction {
  id:string; commandId?:string; actorBodyId:string; kind:'attack'|DefenseKind;
  targetBodyId:string|null; weaponId:string|null; definition:string; trajectory:'high'|'mid'|'low';
  startedAt:number; startTick:number; activeAt:number; recoveryAt:number; completeAt:number;
  phase:CombatPhase; outcome:'pending'|'hit'|'miss'|'interrupted'|'cancelled';
  facing:number; initialFacing:number; trackingUntil:number; turnRate:number; turnBudget:number;
  reach:number; radius:number; impact:number; exertionCost:number; intent:ConflictIntent;
  direction:Vec3; distance:number; appliedDistance:number; eventId:string;
  variant?:'direct'|'hook'|'kick'|'round';
  moveId?:import('./combatRepertoire').CombatMoveId; repertoireRevision?:1|2;
  /** Last executed unarmed strike carried through one step for deterministic follow-up selection. */
  priorStrike?:import('./combatRepertoire').CombatMoveId;
  /** Mechanical technique identity labeling the moveId/kind the existing repertoire/defense
   * system already chose, preferring an actually learned technique over the shared innate
   * motor primitive. Never influences which moveId/variant/timing/geometry executes. */
  techniqueId?:string; transitionTechniqueId?:string; previousTechniqueId?:string;
  martialDemonstration?:Record<string,unknown>; learningEventId?:string;
  queuedInput?: CombatInput & { expiresAt:number };
  contact?:{bodyId:string;region:ContactRegion;position:Vec3;at:number;eventId?:string};
  stoppedAt?:number; stopReason?:string;
}
export interface DefenseCue {
  actionId:string; actorBodyId:string; defenderBodyId:string; observedAt:number; reactAt:number; evidenceId:string;
  position:Vec3; facing:number; trajectory:'high'|'mid'|'low'; responded:boolean;
}
