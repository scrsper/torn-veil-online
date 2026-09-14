import legacy from './combatRepertoire.json';
import repertoire from './combatRepertoireV2.json';
import type { CombatAction } from './combatActionTypes';
export type CombatMoveId=keyof typeof repertoire.moves;
export const COMBAT_REPERTOIRE=repertoire;
export function nextUnarmedMove(previous:CombatAction|undefined,at:number,heavy:boolean,arena:boolean):CombatMoveId {
 const prior=precedingStrike(previous,at);
 if(heavy)return arena&&prior==='front_kick'?'round_kick':'front_kick';
 return prior==='jab'?'cross':'jab';
}
// A single intervening step can carry the previous strike; another step ends that lineage.
// This is executed history, not a queued combo or an automatic action.
export function precedingStrike(a:CombatAction|undefined,at:number):CombatMoveId|undefined {
 if(!a||at>a.completeAt+.3||a.outcome==='interrupted'||a.outcome==='cancelled')return undefined;
 return a.kind==='attack'?(a.moveId??(a.variant==='direct'?'jab':undefined)):a.priorStrike;
}
export function repertoireTransition(a:CombatAction,next:string):number|undefined {
 if(!a.moveId)return undefined;
 const move=(a.repertoireRevision===2?repertoire:legacy).moves[a.moveId];
 return a.startedAt+(next==='attack'?move.attackAt:next==='duck'?move.postureAt:next==='move'?move.moveAt:move.stepAt);
}
