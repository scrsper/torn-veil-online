import {Quaternion,Vector3,type TransformNode} from '@babylonjs/core';
import type {CharacterInstance} from '../arena/assets';
import {setWorldRotation} from './twoBoneIK';

type Applied = {node:TransformNode;base:Quaternion;post:Quaternion};
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
/** Restrained additive attention for imported +Z rigs. Only uses projected targets.
 * Restore before the next animation evaluation so untracked bones and clip blends
 * cannot feed last frame's gaze back into their fresh animation pose. */
export class SharedGaze {
 private yaw=0;private pitch=0;private applied:Applied[]=[];
 constructor(private instance:Pick<CharacterInstance,'root'|'bones'>){}
 restore():void{
  for(const {node,base} of this.applied){node.rotationQuaternion=base.clone();node.computeWorldMatrix(true);}
  this.applied=[];
 }
 apply(dt:number,target:Vector3|null|undefined,active=true):void{
  // Also make repeated calls safe when no animation wrote a new bone pose.
  for(const {node,base,post} of this.applied){
   if(node.rotationQuaternion&&Math.abs(Quaternion.Dot(node.rotationQuaternion,post))>.999999){node.rotationQuaternion=base.clone();node.computeWorldMatrix(true);}
  }
  this.applied=[];
  const neck=this.instance.bones?.get('neck_01'),head=this.instance.bones?.get('head');
  if(!neck||!head)return;
  const root=this.instance.root;root.computeWorldMatrix(true);head.computeWorldMatrix(true);neck.computeWorldMatrix(true);
  const frame=root.absoluteRotationQuaternion.clone(),inverse=Quaternion.Inverse(frame);
  let wantedYaw=0,wantedPitch=0;
  if(active&&target&&[target.x,target.y,target.z].every(Number.isFinite)){
   const direction=target.subtract(head.getAbsolutePosition()).applyRotationQuaternion(inverse);
   const horizontal=Math.hypot(direction.x,direction.z),yaw=Math.atan2(direction.x,direction.z);
   if(direction.lengthSquared()>.01&&Math.abs(yaw)<2.1){wantedYaw=clamp(yaw,.8);wantedPitch=clamp(-Math.atan2(direction.y,horizontal),.35);}
  }
  if(!Number.isFinite(dt)||dt<=0||dt>.2){this.yaw=0;this.pitch=0;return;}
  const smoothing=1-Math.exp(-8*Math.min(.1,dt));
  this.yaw+=(wantedYaw-this.yaw)*smoothing;this.pitch+=(wantedPitch-this.pitch)*smoothing;
  if(Math.abs(this.yaw)+Math.abs(this.pitch)<1e-5)return;
  // Capture both fresh poses before rotating their chain. The head's world delta
  // is the total gaze, so its inherited neck share is not accidentally doubled.
  const poses=[neck,head].map(node=>({node,local:node.rotationQuaternion?.clone()??Quaternion.FromEulerVector(node.rotation),world:node.absoluteRotationQuaternion.clone()}));
  for(const [i,{node,local,world}] of poses.entries()){
   const share=i===0?.35:1;
   const delta=frame.multiply(Quaternion.RotationYawPitchRoll(this.yaw*share,this.pitch*share,0)).multiply(inverse);
   setWorldRotation(node,delta.multiply(world));
   this.applied.push({node,base:local,post:node.rotationQuaternion!.clone()});
  }
 }
}
