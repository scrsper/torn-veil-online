import specification from './interactionSpec.json';
import type { Vec3 } from '../core/types';

export const INTERACTION_SPEC = Object.freeze(specification);
export interface CollisionColumn { floor: number; walkable: boolean; solids: number[] }
export interface CollisionWindow { revision: string; x: number; z: number; size: number; columns: CollisionColumn[] }
export interface MovementState { pos: Vec3; yaw: number; speed: number; eligible: boolean }
export interface MovementInput { x: number; z: number; sprint: boolean }
export type ColumnQuery = (x: number, z: number) => CollisionColumn | undefined;
export function windowQuery(window: CollisionWindow): ColumnQuery {
  return (x,z) => x < window.x || z < window.z || x >= window.x+window.size || z >= window.z+window.size
    ? undefined : window.columns[(x-window.x)*window.size+z-window.z];
}
/** Metres, Y up, forward=(-sin(yaw),0,-cos(yaw)), radians, seconds. X then Z
 * is the collision tie-break. Unknown columns are solid. No costs/events in this kernel. */
export function predictMovement(state: MovementState, input: MovementInput, dt: number, column: ColumnQuery): MovementState {
  const next = { ...state, pos: { ...state.pos } }, s = INTERACTION_SPEC;
  if (!state.eligible || ![input.x,input.z,dt,state.speed].every(Number.isFinite) || dt <= 0 || dt > .1) return next;
  const length = Math.max(1,Math.hypot(input.x,input.z));
  const speed = Math.max(0,state.speed)*(input.sprint?s.sprintMultiplier:1);
  const dx=input.x/length*speed*dt, dz=input.z/length*speed*dt;
  const count=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dz))/s.sweepStep));
  const fits=(px:number,pz:number) => {
    const center=column(Math.floor(px),Math.floor(pz));
    if (!center?.walkable || center.floor<0 || Math.abs(center.floor-next.pos.y)>s.stepHeight) return false;
    let clearance=center.floor;
    const footprint: CollisionColumn[]=[];
    for(let x=Math.floor(px-s.radius);x<=Math.floor(px+s.radius);x++) for(let z=Math.floor(pz-s.radius);z<=Math.floor(pz+s.radius);z++) {
      const edge=column(x,z);
      if(!edge || edge.floor<0 || Math.abs(edge.floor-center.floor)>s.stepHeight) return false;
      clearance=Math.max(clearance,edge.floor); footprint.push(edge);
    }
    return footprint.every(c=>!c.solids.some(y=>y>=Math.floor(clearance+.05)&&y<=Math.floor(clearance+s.height)));
  };
  for(let i=0;i<count;i++) {
    if(fits(next.pos.x+dx/count,next.pos.z)) next.pos.x+=dx/count;
    if(fits(next.pos.x,next.pos.z+dz/count)) next.pos.z+=dz/count;
    const floor=column(Math.floor(next.pos.x),Math.floor(next.pos.z))?.floor;
    if(floor!==undefined&&floor>=0) next.pos.y=floor;
  }
  if(Math.hypot(next.pos.x-state.pos.x,next.pos.z-state.pos.z)>1e-9) next.yaw=Math.atan2(-(next.pos.x-state.pos.x),-(next.pos.z-state.pos.z));
  return next;
}
