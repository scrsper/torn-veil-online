import { requestCombatAction } from './combatAction';
import { ATTACK_COOLDOWN } from './combat';
import type { Body, Person } from '../core/types';
import type { Simulation } from '../mind/agent';

/** Legacy maximum presentation reach. Actual eligibility uses the actor's weapon reach.
 * Recovery and resolution remain canonical for every client. */
export const MELEE_REACH = 3.2;
export const MELEE_COOLDOWN = ATTACK_COOLDOWN;

export type MeleeResult = string;

/** Client target selection is a hint. Acceptance starts a committed action; the shared
 * canonical lifecycle establishes contact later, after a real response window. */
export function meleeStrike(sim: Simulation, actor: Person, body: Body, targetBodyId: string | null, trajectory: 'high'|'mid'|'low' = 'high', commandId?: string): MeleeResult {
  const result=requestCombatAction(sim.world,{attackerId:actor.id,attackerBodyId:body.id,
    targetBodyId:targetBodyId??'',attackMode:'strike',trajectory},commandId);
  return result.attempted?'accepted':result.rejection??'invalid_target';
}
