import {Quaternion,Vector3,type TransformNode} from '@babylonjs/core';
import type {CharacterInstance} from './assets';
import {reach} from './ik';
/** Shared version of Claude's existing two-bone stance solver. Presentation only. */
export class FootPlant {
 private ankleY=-1;private feet=[{lock:null as Vector3|null,w:0,yaw:0},{lock:null as Vector3|null,w:0,yaw:0}];
 constructor(private inst:CharacterInstance){}
 update(dt:number,y:number,yaw:number,active=true){
  const b=this.inst.bones;if(!b)return;
  if(!active){for(const l of this.feet){l.lock=null;l.w=0;}return;}
  const scale=this.inst.root.scaling.x;
  if(this.ankleY<0){const f=b.get('foot_l');if(!f)return;f.computeWorldMatrix(true);this.ankleY=Math.max(.02,f.getAbsolutePosition().y-y);}
  for(const [k,side] of ['l','r'].entries()){
   const thigh=b.get('thigh_'+side),calf=b.get('calf_'+side),foot=b.get('foot_'+side);if(!thigh||!calf||!foot)continue;
   foot.computeWorldMatrix(true);const animPos=foot.getAbsolutePosition().clone(),planted=animPos.y-y<this.ankleY+.035*scale,L=this.feet[k];
   if(planted){if(!L.lock||Vector3.Distance(L.lock,animPos)>.6*scale||Math.abs(Math.atan2(Math.sin(yaw-L.yaw),Math.cos(yaw-L.yaw)))>.6){L.lock=animPos.clone();L.yaw=yaw;}L.w=1;}
   else{L.w=Math.max(0,L.w-dt*16);if(L.w===0)L.lock=null;}
   if(!L.lock||L.w<=0)continue;
   const target=new Vector3(L.lock.x,animPos.y,L.lock.z),keep=foot.absoluteRotationQuaternion.clone();
   reach(thigh,calf,foot,target,L.w);
   foot.rotationQuaternion=Quaternion.Inverse((foot.parent as TransformNode).absoluteRotationQuaternion).multiply(keep).normalize();foot.computeWorldMatrix(true);
  }
 }
}
