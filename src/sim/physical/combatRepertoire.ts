import repertoire from './combatRepertoire.json';
import type { CombatAction } from './combatActionTypes';
export type CombatMoveId=keyof typeof repertoire.moves;
export const COMBAT_REPERTOIRE=repertoire;
export function nextUnarmedMove(previous:CombatAction|undefined,at:number,heavy:boolean,arena:boolean):CombatMoveId {
 const chain=previous?.kind==='attack'&&at<=previous.completeAt+.3;
 if(heavy)return arena&&chain&&previous.moveId==='front_kick'?'round_kick':'front_kick';
 return chain&&(previous.moveId==='jab'||!previous.moveId&&previous.variant==='direct')?'cross':'jab';
}
export function repertoireTransition(a:CombatAction,next:string):number|undefined {
 if(!a.moveId)return undefined;
 const move=repertoire.moves[a.moveId];
 return a.startedAt+(next==='attack'?move.attackAt:next==='duck'?move.postureAt:next==='move'?move.moveAt:move.stepAt);
}
