import type { Body, Vec3 } from '../core/types';
import { sampledStrike } from './combatMotion';

export type ContactRegion = 'head' | 'torso' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export interface HurtVolume { region: ContactRegion; center: Vec3; radius: number }
export interface CombatTransform { pos: Vec3; yaw: number; duck: number; cover?: number }
export const lerpPoint = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t });
/** Shape dispatch is the extension point for creature anatomy. Metres, feet origin, Y up.
 * Limb sides remain physical contact facts; existing coarse injury effects group arm/leg. */
export function hurtVolumes(body: Pick<Body,'shape'|'pos'|'yaw'>, duck = 0, cover = 0): HurtVolume[] {
  const d=Math.max(0,Math.min(1,duck));
  const sphere=(region:ContactRegion,side:number,height:number,radius:number):HurtVolume=>({region,radius,
    center:{x:body.pos.x+Math.cos(body.yaw)*side,y:body.pos.y+height,z:body.pos.z-Math.sin(body.yaw)*side}});
  if(body.shape==='chicken') return [sphere('torso',0,.28,.25)];
  if(body.shape!=='humanoid') return [];
  const guard=Math.max(0,Math.min(1,cover));
  const arm=(region:'leftArm'|'rightArm',side:number)=>{const h=sphere(region,side*(1-guard*.65),1.18-.52*d+.4*guard,.14);h.center.x-=Math.sin(body.yaw)*.22*guard;h.center.z-=Math.cos(body.yaw)*.22*guard;return h;};
  return [sphere('head',0,1.65-.50*d,.18),sphere('torso',0,1.12-.50*d,.28),
    arm('leftArm',-.38),arm('rightArm',.38),
    sphere('leftLeg',-.16,.43-.08*d,.17),sphere('rightLeg',.16,.43-.08*d,.17)];
}
/** Exact first contact of linearly moving spheres. Relative motion prevents tunnelling
 * even when both endpoints miss. Curved paths are split into <=1/120 s segments upstream. */
export function sweepSphereContact(a0:Vec3,a1:Vec3,ar:number,b0:Vec3,b1:Vec3,br:number):number|null {
  const x=a0.x-b0.x,y=a0.y-b0.y,z=a0.z-b0.z;
  const dx=a1.x-a0.x-b1.x+b0.x,dy=a1.y-a0.y-b1.y+b0.y,dz=a1.z-a0.z-b1.z+b0.z;
  const c=x*x+y*y+z*z-(ar+br)**2;if(c<=0)return 0;
  const aa=dx*dx+dy*dy+dz*dz;if(aa<1e-16)return null;
  const bb=2*(x*dx+y*dy+z*dz),disc=bb*bb-4*aa*c;if(disc<0)return null;
  const t=(-bb-Math.sqrt(disc))/(2*aa);return t>=0&&t<=1?t:null;
}
export function strikePoint(pos:Vec3,yaw:number,reach:number,progress:number,trajectory:'high'|'mid'|'low',variant?:'direct'|'hook'|'kick'):Vec3 {
  if(variant){
    const [side,height,forward]=sampledStrike(variant,progress);
    return {x:pos.x-Math.sin(yaw)*forward+Math.cos(yaw)*side,y:pos.y+height,z:pos.z-Math.cos(yaw)*forward-Math.sin(yaw)*side};
  }
  const extension=.35+(reach-.35)*Math.max(0,Math.min(1,progress));
  const side=.06*Math.sin(Math.PI*progress);
  return {x:pos.x-Math.sin(yaw)*extension+Math.cos(yaw)*side,
    y:pos.y+(trajectory==='high'?1.65:trajectory==='low'?.43:1.12),
    z:pos.z-Math.cos(yaw)*extension-Math.sin(yaw)*side};
}
