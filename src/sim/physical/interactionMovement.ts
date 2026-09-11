import type { World } from '../core/world';
import type { Body, Person } from '../core/types';
import { movementMultiplier } from '../core/attributes';
import { noteHaulMovement } from '../logistics/haul';
import { predictMovement, type CollisionColumn, type CollisionWindow, type MovementInput, type MovementState } from './prediction';
import { B } from './blocks';

export function movementState(w: World,p: Person,b: Body): MovementState {
  return {pos:{...b.pos},yaw:b.yaw,speed:b.speed*movementMultiplier(b,p),eligible:p.alive&&b.present&&!b.dead&&b.health>0&&b.ownerId===p.id&&p.bodies.includes(b.id)&&!p.surrender&&!p.custody?.active&&b.pose!=='downed'&&b.pose!=='sleep'&&b.subduedUntil<=w.physicalTime};
}
export function collisionColumn(w: World,x: number,z: number): CollisionColumn | undefined {
  if(x<1||z<1||x>w.grid.W-1||z>w.grid.D-1) return undefined;
  const floor=w.nav.floorY(x,z),solids:number[]=[];
  if(floor>=0) for(let y=Math.floor(floor-1);y<=Math.ceil(floor+4);y++) if(w.grid.isSolidAt(x,y,z)) solids.push(y);
  return {floor,walkable:w.nav.isWalkable(x,z),solids};
}
/** Local physical collision only; no minds, targets or future plans are projected. */
export function collisionWindow(w: World,b: Body): CollisionWindow {
  const x=Math.floor(b.pos.x)-4,z=Math.floor(b.pos.z)-4,size=9,columns:CollisionColumn[]=[];
  for(let ix=x;ix<x+size;ix++) for(let iz=z;iz<z+size;iz++) columns.push(collisionColumn(w,ix,iz)??{floor:-1,walkable:false,solids:[]});
  let hash=2166136261; for(const ch of JSON.stringify([x,z,columns])) hash=Math.imul(hash^ch.charCodeAt(0),16777619);
  return {revision:(hash>>>0).toString(16),x,z,size,columns};
}
/** Canonical adapter for the same disposable predictor. Ordinary automatic door operation
 * matches moveByIntent/NPC path following. Clients stop at the closed door until confirmed. */
export function applyInteractionMovement(w: World,p: Person,b: Body,input: MovementInput,dt: number): void {
  const before={...b.pos};
  const next=predictMovement(movementState(w,p,b),input,dt,(x,z)=>{
    const floor=w.nav.floorY(x,z);
    if((input.x||input.z)&&floor>=0&&Math.hypot(x+.5-b.pos.x,z+.5-b.pos.z)<1.5&&w.grid.get(x,floor,z)===B.Door&&!w.grid.isDoorOpen(x,floor,z))
      w.setDoorOpen({x,y:floor,z},true,p.id);
    return collisionColumn(w,x,z);
  });
  b.pos=next.pos; b.yaw=next.yaw;
  b.vel={x:(b.pos.x-before.x)/dt,y:(b.pos.y-before.y)/dt,z:(b.pos.z-before.z)/dt};
  b.onGround=true; noteHaulMovement(w,p,before,b.pos);
  if(b.poseUntil<=w.physicalTime) b.pose=Math.hypot(b.vel.x,b.vel.z)>.05?(input.sprint?'run':'walk'):'stand';
}
