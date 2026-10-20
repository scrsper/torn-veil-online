import {Quaternion,Vector3,type TransformNode} from '@babylonjs/core';
import type {CharacterInstance} from './assets';
import type {FootContactFrame,FootPoint,FootSupport} from './footPlant';
import {measureFootSoles,prepareSoles,soleScenePoints,type FootSole} from './footGeometry';
import {reach} from './ik';

const v=(p:FootPoint)=>new Vector3(p.x,p.y,p.z);
const copy=(p:Vector3)=>({x:p.x,y:p.y,z:p.z});
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const finite=(p:FootPoint)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
const tangent=(p:Vector3,up:Vector3)=>p.subtract(up.scale(Vector3.Dot(p,up)));
type Anchor={point:Vector3;normal:Vector3;forward:Vector3;source?:string;id:number};
type Contact={anchor:Anchor|null;weight:number;releasing:boolean;dwell:number;cooldown:number;previousHeight:number|null};
export interface RadialContactDiagnostic {
 active:boolean;reference:string|null;origin:FootPoint|null;up:FootPoint|null;resetReason:string|null;
 feet:{side:string;measurement:'skinned-distal-sole-hull-v1';soleVertices:{mesh:string;vertex:number}[];measuredVertices:number;lock:boolean;lockId:number|null;weight:number;releasing:boolean;
  contact:boolean;support:FootSupport|null;anchor:FootPoint|null;solePoints:FootPoint[];signedGaps:(number|null)[];reason:string|null}[];
}

/** Sample the complete small sole footprint in a tangent frame. A missing patch,
 * edge, steep surface or floor beyond bounded leg correction is not support. */
export function radialFootSurface(frame:FootContactFrame,point:Vector3,root:Vector3,forward:Vector3,scale:number):FootSupport|null{
 const up=v(frame.up).normalize(),r=.07*scale,max=.22*scale;
 let right=Vector3.Cross(up,forward).normalize();
 if(right.lengthSquared()<.5)right=Vector3.Cross(up,Math.abs(up.y)<.9?Vector3.Up():Vector3.Right()).normalize();
 const ahead=Vector3.Cross(right,up).normalize();
 const query=point.subtract(up.scale(Vector3.Dot(point.subtract(root),up)));
 const offsets=[Vector3.Zero(),right.scale(r),right.scale(-r),ahead.scale(r),ahead.scale(-r)];
 const samples=offsets.map(offset=>{
  const q=query.add(offset),sample=frame.sample(q,up,r,max);
  if(!sample||!finite(sample.point)||!finite(sample.normal))return null;
  const normal=v(sample.normal);if(normal.lengthSquared()<.5)return null;normal.normalize();
  if(Vector3.Dot(normal,up)<Math.cos(Math.PI/5)||Math.abs(Vector3.Dot(v(sample.point).subtract(root),up))>max||tangent(v(sample.point).subtract(q),up).length()>.025*scale)return null;
  return {point:v(sample.point),normal,source:sample.source};
 });
 if(samples.some(s=>s===null))return null;
 const [centre,xp,xm,zp,zm]=samples as {point:Vector3;normal:Vector3;source?:string}[];
 const h=(p:Vector3)=>Vector3.Dot(p.subtract(centre.point),up);
 if(Math.abs((h(xp.point)+h(xm.point))/2)>.025*scale||Math.abs((h(zp.point)+h(zm.point))/2)>.025*scale)return null;
 const dx=(h(xp.point)-h(xm.point))/(2*r),dz=(h(zp.point)-h(zm.point))/(2*r);
 if(Math.hypot(dx,dz)>Math.tan(Math.PI/5))return null;
 const normal=up.subtract(right.scale(dx)).subtract(ahead.scale(dz)).normalize();
 return {point:copy(centre.point),normal:copy(normal),source:centre.source};
}

/** Spherical presentation only. All anchors are stable absolute points; IK runs
 * in Babylon scene coordinates after subtracting the current floating origin.
 * The canonical body and the visual root never move as a consequence of IK. */
export class RadialFootPlant {
 private soles:[FootSole|null,FootSole|null];
 private feet:Contact[]=[0,1].map(()=>({anchor:null,weight:0,releasing:false,dwell:0,cooldown:0,previousHeight:null}));
 private previousRoot:Vector3|null=null;private reference:string|null=null;private nextLock=0;
 private saved=new Map<TransformNode,Quaternion>();
 private diagnostics:RadialContactDiagnostic={active:false,reference:null,origin:null,up:null,resetReason:'not-started',feet:[]};
 constructor(private inst:CharacterInstance,private actor:TransformNode,private stature=1){this.soles=measureFootSoles(inst);}
 restore(){for(const [node,rotation] of this.saved){node.rotationQuaternion=rotation;node.computeWorldMatrix(true);}this.saved.clear();}
 lockState():[boolean,boolean]{return [!!this.feet[0].anchor,!!this.feet[1].anchor];}
 inspect():RadialContactDiagnostic{return this.diagnostics;}
 private reset(reason:string){for(const f of this.feet){f.anchor=null;f.weight=0;f.releasing=false;f.dwell=0;f.cooldown=0;f.previousHeight=null;}this.diagnostics.resetReason=reason;}
 update(dt:number,active:boolean,contacts:readonly [boolean,boolean]|undefined,frame:FootContactFrame|null):[boolean,boolean]|undefined{
  this.diagnostics={active:false,reference:frame?.reference??null,origin:frame?copy(v(frame.origin)):null,up:frame?copy(v(frame.up)):null,resetReason:null,feet:[]};
  if(!frame||!finite(frame.origin)||!finite(frame.up)||v(frame.up).lengthSquared()<.5){this.reset('missing-frame');this.previousRoot=null;this.reference=null;return;}
  const origin=v(frame.origin),up=v(frame.up).normalize();
  this.actor.computeWorldMatrix(true);this.inst.root.computeWorldMatrix(true);
  // Import scale converts arbitrary source units. Contact distances instead use
  // canonical body stature and any actual presentation-parent scaling.
  const root=this.actor.getAbsolutePosition().add(origin),scale=Math.max(.01,this.stature*Math.abs(this.actor.absoluteScaling.y));
  const forward=Vector3.TransformNormal(new Vector3(0,0,-1),this.actor.getWorldMatrix()).normalize();
  const teleported=this.previousRoot!==null&&Vector3.Distance(root,this.previousRoot)>.65*scale;
  const changed=this.reference!==null&&this.reference!==frame.reference;this.previousRoot=root.clone();this.reference=frame.reference;
  if(!active||teleported||changed){this.reset(!active?'inactive':teleported?'teleport':'reference-changed');return;}
  this.diagnostics.active=true;
  const step=clamp(Number.isFinite(dt)?dt:0,0,.1),support:[boolean,boolean]=[false,false];
  prepareSoles(this.soles);
  for(const [k,side] of ['l','r'].entries()){
   const sole=this.soles[k],thigh=this.inst.bones?.get(`thigh_${side}`),calf=this.inst.bones?.get(`calf_${side}`),foot=this.inst.bones?.get(`foot_${side}`),f=this.feet[k];
   if(!sole||!thigh||!calf||!foot)continue;
   foot.computeWorldMatrix(true);const ankle=foot.getAbsolutePosition().add(origin),points=soleScenePoints(sole).map(p=>p.add(origin));
   const centre=points.reduce((a,p)=>a.addInPlace(p),Vector3.Zero()).scale(1/points.length);
   const height=Math.min(...points.map(p=>Vector3.Dot(p.subtract(root),up)));
   const vertical=f.previousHeight!==null&&step>0?(height-f.previousHeight)/step:0;f.previousHeight=height;f.cooldown=Math.max(0,f.cooldown-step);
   const sample=radialFootSurface(frame,f.anchor?.point??centre,root,forward,scale);
   // The measured toe/heel extent can exceed the cross sampler. Check its whole
   // bounded hull against the same local support plane so a long boot cannot
   // acquire an anchor while straddling an unsupported edge or stair riser.
   const footprint=sample&&points.every(point=>{
    const query=point.subtract(up.scale(Vector3.Dot(point.subtract(root),up)));
    const s=frame.sample(query,up,0,.22*scale);
    return s&&finite(s.point)&&finite(s.normal)&&Vector3.Dot(v(s.normal).normalize(),up)>Math.cos(Math.PI/5)
     &&Math.abs(Vector3.Dot(v(s.point).subtract(v(sample.point)),v(sample.normal)))<=.025*scale;
   });
   const contact=(contacts?contacts[k]:height<(f.anchor ? .11 : .07)*scale)&&!(vertical>.35*scale&&height>.025*scale)&&height<.22*scale&&!!footprint;
   support[k]=contact;
   if(f.anchor){
    const distance=tangent(f.anchor.point.subtract(centre),up).length();
    const turn=Math.acos(clamp(Vector3.Dot(tangent(forward,up).normalize(),tangent(f.anchor.forward,up).normalize()),-1,1));
    if(!contact||distance>.28*scale||turn>.3||(sample&&Math.abs(Vector3.Dot(v(sample.point).subtract(f.anchor.point),up))>.06*scale))f.releasing=true;
   }else{
    f.dwell=contact&&f.cooldown===0?f.dwell+step:0;
    if(sample&&contact&&f.cooldown===0&&(contacts?.[k]||f.dwell>=.04)){
     f.anchor={point:v(sample.point),normal:v(sample.normal),forward:forward.clone(),source:sample.source,id:++this.nextLock};f.releasing=false;f.dwell=0;
    }
   }
   let target:Vector3|null=null,desired=foot.absoluteRotationQuaternion.clone();
   if(f.anchor){
    const normal=f.anchor.normal,axis=Vector3.Cross(up,normal),angle=Math.acos(clamp(Vector3.Dot(up,normal),-1,1));
    const tilt=axis.lengthSquared()>1e-10?Quaternion.RotationAxis(axis.normalize(),Math.min(angle,Math.PI/7.2)):Quaternion.Identity();
    desired=tilt.multiply(desired);
    const offsets=points.map(p=>p.subtract(ankle).applyRotationQuaternion(tilt));
    const mean=offsets.reduce((a,p)=>a.addInPlace(p),Vector3.Zero()).scale(1/offsets.length);
    const min=Math.min(...offsets.map(p=>Vector3.Dot(p,normal)));
    const soleOffset=mean.add(normal.scale(min-Vector3.Dot(mean,normal)));
    target=f.anchor.point.subtract(soleOffset);
    // Reject a correction beyond the authored small-step envelope. No hidden
    // pelvis/root offset is used to force a distant floor into reach.
    if(Math.abs(Vector3.Dot(target.subtract(ankle),up))>.22*scale)f.releasing=true;
   }
   const displacement=target?Vector3.Distance(target,ankle):0;
   const rate=Math.min(f.releasing?10:12,2*scale/Math.max(.001,displacement));
   f.weight=clamp(f.weight+step*(f.anchor&&!f.releasing?rate:-rate),0,1);
   if(f.anchor&&f.weight===0){f.anchor=null;f.releasing=false;f.cooldown=.04;f.dwell=0;}
   if(!f.anchor||!target||f.weight<=0)continue;
   thigh.computeWorldMatrix(true);calf.computeWorldMatrix(true);
   const hip=thigh.getAbsolutePosition().add(origin),knee=calf.getAbsolutePosition().add(origin);
   const length=Vector3.Distance(hip,knee)+Vector3.Distance(knee,ankle),offset=target.subtract(hip),distance=offset.length();
   const maxReach=Math.max(Vector3.Distance(hip,ankle),length*.999);
   if(distance>maxReach){target=hip.add(offset.scale(maxReach/distance));f.releasing=true;}
   for(const node of [thigh,calf,foot])if(!this.saved.has(node))this.saved.set(node,(node.rotationQuaternion??Quaternion.FromEulerVector(node.rotation)).clone());
   const keep=foot.absoluteRotationQuaternion.clone();
   reach(thigh,calf,foot,target.subtract(origin),f.weight);
   const rotated=Quaternion.Slerp(keep,desired,f.weight);
   foot.rotationQuaternion=Quaternion.Inverse((foot.parent as TransformNode).absoluteRotationQuaternion).multiply(rotated).normalize();foot.computeWorldMatrix(true);
  }
  // Post-IK evidence uses the real skin matrix for the selected source vertices.
  prepareSoles(this.soles);
  this.diagnostics.feet=this.feet.map((f,k)=>{
   const sole=this.soles[k],points=sole?soleScenePoints(sole).map(p=>p.add(origin)):[];
   const gaps=points.map(point=>{const s=frame.sample(point,up,0,.3*scale);return s&&finite(s.point)&&finite(s.normal)?Vector3.Dot(point.subtract(v(s.point)),v(s.normal).normalize()):null;});
   return {side:k===0?'l':'r',measurement:'skinned-distal-sole-hull-v1' as const,soleVertices:sole?.points.map(p=>({mesh:p.mesh.name,vertex:p.vertexIndex}))??[],measuredVertices:points.length,lock:!!f.anchor,lockId:f.anchor?.id??null,weight:f.weight,releasing:f.releasing,contact:support[k],
    support:f.anchor?{point:copy(f.anchor.point),normal:copy(f.anchor.normal),source:f.anchor.source}:null,anchor:f.anchor?copy(f.anchor.point):null,
    solePoints:points.map(copy),signedGaps:gaps,reason:!sole?'unmeasured-sole':!support[k]?'no-stable-support':null};
  });
  return support;
 }
}
