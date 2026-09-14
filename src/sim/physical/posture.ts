import type { World } from '../core/world';
import type { Body } from '../core/types';
import { INTERACTION_SPEC as S,predictPosture } from './prediction';
import { collisionColumn,movementState } from './interactionMovement';

const leases=new WeakMap<World,Map<string,{until:number;started:boolean}>>();
export function crouchHeld(w:World,b:Body):boolean {return (leases.get(w)?.get(b.id)?.until??-Infinity)>w.physicalTime;}
export function setCrouchHeld(w:World,b:Body,held:boolean):void {
 let map=leases.get(w);if(!map){map=new Map();leases.set(w,map);}
 if(held)map.set(b.id,{until:w.physicalTime+S.heldInputSeconds,started:crouchHeld(w,b)&&(map.get(b.id)?.started??false)});else {map.delete(b.id);if(b.combatAction?.queuedInput?.held)b.combatAction.queuedInput=undefined;}
}
export function refreshCrouchHeld(w:World,b:Body,held:boolean):void {
 if(held&&crouchHeld(w,b))setCrouchHeld(w,b,true);
}
export function advancePostures(w:World,dt:number):void {
 for(const b of w.activeBodies()){
  const held=crouchHeld(w,b);if(!held&&!b.crouch)continue;
  const p=w.person(b.ownerId);if(!p)continue;
  const state=movementState(w,p,b);if(!state.eligible)setCrouchHeld(w,b,false);
  const waiting=!!b.combatAction?.queuedInput?.held;
  b.crouch=predictPosture(state,held&&!waiting,dt,(x,z)=>collisionColumn(w,x,z)).crouch;
 }
}

export function beginCrouch(w:World,b:Body):boolean {const lease=leases.get(w)?.get(b.id);if(!lease||lease.started)return false;lease.started=true;return true;}
