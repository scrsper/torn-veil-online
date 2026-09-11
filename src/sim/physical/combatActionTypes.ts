import type { ConflictIntent, Vec3 } from '../core/types';
import type { ContactRegion } from './combatGeometry';
export type CombatPhase = 'requested'|'accepted'|'preparation'|'active'|'recovery'|'complete'|'interrupted'|'cancelled'|'missed';
export type DefenseKind = 'sidestep'|'backstep'|'duck';
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
  contact?:{bodyId:string;region:ContactRegion;position:Vec3;at:number;eventId?:string};
  stoppedAt?:number; stopReason?:string;
}
export interface DefenseCue {
  actionId:string; actorBodyId:string; defenderBodyId:string; observedAt:number; reactAt:number; evidenceId:string;
  position:Vec3; facing:number; trajectory:'high'|'mid'|'low'; responded:boolean;
}
