import {describe,it,expect} from 'vitest';
import {NullEngine,Scene,TransformNode,Quaternion,Vector3} from '@babylonjs/core';
import {FootPlant,footSurface,type FootGround} from '../src/web/arena/footPlant';
import type {CharacterInstance} from '../src/web/arena/assets';
import {ContactFootfalls} from '../src/web/audio/footfalls';

function rig(scale=1){
 const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('root',scene);
 root.scaling.setAll(scale);const bones=new Map<string,TransformNode>();
 for(const side of ['l','r']){
  const thigh=new TransformNode('thigh_'+side,scene);thigh.parent=root;thigh.position.set(side==='l'?-.12:.12,.94,0);
  const calf=new TransformNode('calf_'+side,scene);calf.parent=thigh;calf.position.set(0,-.43,.12);
  const foot=new TransformNode('foot_'+side,scene);foot.parent=calf;foot.position.set(0,-.4,-.12);
  for(const n of [thigh,calf,foot])bones.set(n.name,n);
 }
 const inst={root,bones,bindAnkleHeights:[.11,.11]} as CharacterInstance;
 const plant=new FootPlant(inst);
 const pose=(lift=0,z=0)=>{for(const [name,n] of bones){n.rotationQuaternion=Quaternion.Identity();if(name.startsWith('foot_'))n.position.set(0,-.4+lift,-.12+z);n.computeWorldMatrix(true);}};
 const step=(lift=0,z=0,yaw=0,dt=1/60)=>{pose(lift,z);plant.update(dt,root.getAbsolutePosition().y,yaw);return bones.get('foot_l')!.getAbsolutePosition().clone();};
 return {root,bones,plant,pose,step,dispose:()=>{scene.dispose();engine.dispose();}};
}

describe('human foot contact correction',()=>{
 it('supplies observed support for audible mixed gaits without a dominant baked clip',()=>{
  const r=rig(),audio=new ContactFootfalls();
  const sample=(lift:number,ground:FootGround=()=>0)=>{
   r.pose(lift);const contacts=r.plant.update(1/60,0,0,true,undefined,ground);
   return {contacts,events:audio.update({dt:1/60,contacts,speed:2,active:true,position:r.root.position})};
  };
  expect(sample(.3).contacts).toEqual([false,false]);
  const landed=sample(0);expect(landed.contacts).toEqual([true,true]);expect(landed.events).toEqual([0]);
  expect(sample(0).events).toEqual([]);
  // Missing terrain IK does not erase the body's posed support on an upper floor.
  // The audio material query independently rejects non-resident world regions.
  expect(sample(0,()=>null).contacts).toEqual([true,true]);r.dispose();
 });
 it('samples incline normals but rejects discontinuities, cliffs and incomplete terrain',()=>{
  const slope=footSurface((x,z)=>.3*x-.2*z,{x:0,z:0},0,1)!;
  expect(slope.normal.x).toBeLessThan(0);expect(slope.normal.z).toBeGreaterThan(0);
  expect(Vector3.Distance(slope.normal,new Vector3(-.3,1,.2).normalize())).toBeLessThan(1e-8);
  expect(footSurface(x=>x<0?0:.15,{x:0,z:0},0,1)).toBeNull();
  expect(footSurface(()=>1,{x:0,z:0},0,1)).toBeNull();
  expect(footSurface(x=>x>0?null:0,{x:0,z:0},0,1)).toBeNull();
  expect(footSurface(()=>NaN,{x:0,z:0},0,1)).toBeNull();
  expect(footSurface(x=>x,{x:0,z:0},0,1)).toBeNull();
 });
 it('preserves flat-floor stance and turn output when a terrain callback is supplied',()=>{
  const flat=rig(),sampled=rig();
  for(let frame=0;frame<90;frame++){
   const yaw=frame<30?0:Math.min(Math.PI/2,(frame-30)*Math.PI/24);
   for(const r of [flat,sampled]){r.root.position.z+=.003;r.root.rotation.y=yaw;r.pose();}
   flat.plant.update(1/60,0,yaw,true);
   sampled.plant.update(1/60,0,yaw,true,undefined,()=>0);
   expect(sampled.plant.lockState()).toEqual(flat.plant.lockState());
   for(const side of ['l','r'])expect(Vector3.Distance(flat.bones.get('foot_'+side)!.getAbsolutePosition(),sampled.bones.get('foot_'+side)!.getAbsolutePosition())).toBeLessThan(1e-6);
  }
  flat.dispose();sampled.dispose();
 });
 it('raises each ankle independently and tilts soles on a supported incline without moving the root',()=>{
  const r=rig(),ground:FootGround=x=>.15*x;
  for(let i=0;i<15;i++){r.pose();r.plant.update(1/60,0,0,true,[true,true],ground);}
  const left=r.bones.get('foot_l')!,right=r.bones.get('foot_r')!;
  expect(left.getAbsolutePosition().y).toBeCloseTo(.11-.018,3);
  expect(right.getAbsolutePosition().y).toBeCloseTo(.11+.018,3);
  const up=Vector3.Up().applyRotationQuaternion(left.absoluteRotationQuaternion);
  expect(Vector3.Distance(up,new Vector3(-.15,1,0).normalize())).toBeLessThan(.001);
  expect(r.root.position.equals(Vector3.Zero())).toBe(true);r.dispose();
 });
 it('plants fully supported step treads at body and parent scales and preserves flat inputs',()=>{
  for(const scale of [.6,1.6]){
   const r=rig(scale),parent=new TransformNode('parent',r.root.getScene());parent.scaling.setAll(1.3);r.root.parent=parent;
   const absolute=scale*1.3,ground:FootGround=x=>x<0?0:.12*absolute;
   for(let i=0;i<18;i++){r.pose();r.plant.update(1/60,0,0,true,[true,true],ground);}
   expect(r.bones.get('foot_l')!.getAbsolutePosition().y).toBeCloseTo(.11*absolute,3);
   expect(r.bones.get('foot_r')!.getAbsolutePosition().y).toBeCloseTo(.23*absolute,3);
   expect(r.plant.lockCount()).toBe(2);r.dispose();
  }
 });
 it('bounds terrain acquisition and missing-support release, then clears teleport correction',()=>{
  const r=rig();let ground:FootGround=()=>.18,prior=new Vector3(-.12,.11,0),maxStep=0;
  for(let i=0;i<15;i++){r.pose();r.plant.update(1/60,0,0,true,[true,true],ground);const p=r.bones.get('foot_l')!.getAbsolutePosition().clone();maxStep=Math.max(maxStep,Vector3.Distance(p,prior));prior=p;}
  expect(prior.y).toBeCloseTo(.29,3);
  ground=()=>null;
  for(let i=0;i<30;i++){r.pose();r.plant.update(1/60,0,0,true,[true,true],ground);const p=r.bones.get('foot_l')!.getAbsolutePosition().clone();maxStep=Math.max(maxStep,Vector3.Distance(p,prior));prior=p;}
  expect(maxStep).toBeLessThanOrEqual(2/60+.001);expect(r.plant.lockCount()).toBe(0);expect(prior.y).toBeCloseTo(.11,3);
  for(let i=0;i<15;i++){r.pose();r.plant.update(1/60,0,0,true,[true,true],()=>.18);}
  r.root.position.x+=3;r.pose();r.plant.update(1/60,0,0,true,[true,true],()=>.18);
  expect(r.plant.lockCount()).toBe(0);expect(r.bones.get('foot_l')!.getAbsolutePosition().y).toBeCloseTo(.11,3);r.dispose();
 });
 it('does not learn a swing apex as ground, and acquires only after landing dwell',()=>{
  const r=rig();for(let i=0;i<15;i++)r.step(.22);
  expect(r.plant.lockCount()).toBe(0);
  r.step();expect(r.plant.lockCount()).toBe(0);
  for(let i=0;i<10;i++)r.step();expect(r.plant.lockCount()).toBe(2);r.dispose();
 });
 it('uses bind heights after body and parent rescaling rather than the first pose',()=>{
  for(const scale of [.6,1.6]){const r=rig(scale);const parent=new TransformNode('parent',r.root.getScene());parent.scaling.setAll(1.3);r.root.parent=parent;
   for(let i=0;i<10;i++)r.step(.2);expect(r.plant.lockCount()).toBe(0);
   for(let i=0;i<10;i++)r.step();expect(r.plant.lockCount()).toBe(2);r.dispose();}
 });
 it('steadies stance, fades turns without replacing the weighted anchor, then replants',()=>{
  const r=rig();for(let i=0;i<10;i++)r.step();const start=r.step();let corrected=0,raw=0;
  for(let i=0;i<10;i++){r.root.position.z+=.004;const p=r.step();corrected+=Math.abs(p.z-start.z);raw+=r.root.position.z;}
  expect(corrected).toBeLessThan(raw*.1);
  let prior=r.step(),maxStep=0,unlocked=false;
  for(let i=0;i<30;i++){const yaw=Math.min(Math.PI/2,(i+1)*Math.PI/24);r.root.rotation.y=yaw;const p=r.step(0,0,yaw);maxStep=Math.max(maxStep,Vector3.Distance(p,prior));prior=p;unlocked ||= r.plant.lockCount()===0;}
  expect(unlocked).toBe(true);expect(maxStep).toBeLessThan(.05);expect(r.plant.lockCount()).toBe(2);r.dispose();
  if(process.env.FOOT_PLANT_DIAGNOSTIC)console.info(JSON.stringify({stanceAccumulatedSlip:corrected,uncorrected:raw,sharpTurnMaxFrameStep:maxStep,turnDuration:.2}));
 });
 it('releases lifted feet during gait changes and clears teleport anchors',()=>{
  const r=rig();for(let i=0;i<12;i++)r.step();for(let i=1;i<=12;i++)r.step(i*.015);
  expect(r.plant.lockCount()).toBe(0);
  for(let i=0;i<12;i++)r.step();expect(r.plant.lockCount()).toBe(2);
  r.root.position.x+=3;r.step();expect(r.plant.lockCount()).toBe(0);
  for(let i=0;i<12;i++)r.step();expect(r.plant.lockCount()).toBe(2);r.dispose();
 });
 it('lets sustained translation release instead of freezing and extending the leg',()=>{
  const r=rig();for(let i=0;i<12;i++)r.step();let released=false;
  for(let i=0;i<40;i++){r.root.position.z+=.025;r.step();released ||= r.plant.lockCount()===0;
   const hip=r.bones.get('thigh_l')!.getAbsolutePosition(),knee=r.bones.get('calf_l')!.getAbsolutePosition(),foot=r.bones.get('foot_l')!.getAbsolutePosition();
   expect(Vector3.Distance(hip,foot)).toBeLessThan(Vector3.Distance(hip,knee)+Vector3.Distance(knee,foot));}
  expect(released).toBe(true);expect(r.bones.get('foot_l')!.getAbsolutePosition().z).toBeGreaterThan(.8);r.dispose();
 });
 it('keeps a settled stop stable and releases when presentation becomes inactive',()=>{
  const r=rig();for(let i=0;i<12;i++)r.step();const start=r.step();
  for(let i=0;i<60;i++)expect(Vector3.Distance(r.step(),start)).toBeLessThan(.001);
  r.pose();r.plant.update(1/60,0,0,false);expect(r.plant.lockCount()).toBe(0);r.dispose();
 });
 it('uses explicit support phases for retargeted ankle offsets without locking a swing',()=>{
  const r=rig();r.pose(.09);r.plant.update(1/60,0,0,true,[true,true]);
  expect(r.plant.lockCount()).toBe(2);
  for(let i=0;i<11;i++){r.pose(.09);r.plant.update(1/60,0,0,true,[true,true]);}
  expect(r.plant.lockCount()).toBe(2);
  for(let i=0;i<12;i++){r.pose(.09);r.plant.update(1/60,0,0,true,[false,false]);}
  expect(r.plant.lockCount()).toBe(0);r.dispose();
 });
 it('keeps correction continuous as the animated knee approaches full extension',()=>{
  const r=rig();for(let i=0;i<12;i++)r.step();let previous=r.step(),maxStep=0;
  for(let i=0;i<30;i++){
   r.root.position.z+=.004;r.pose();
   r.bones.get('calf_l')!.position.z=.12*(1-i/30);
   r.bones.get('foot_l')!.position.z=-.12*(1-i/30);
   r.plant.update(1/60,0,0);const foot=r.bones.get('foot_l')!.getAbsolutePosition().clone();
   maxStep=Math.max(maxStep,Vector3.Distance(foot,previous));previous=foot;
  }
  expect(maxStep).toBeLessThan(.02);r.dispose();
 });
 it('bounds release motion when a large stance correction loses support',()=>{
  const r=rig();for(let i=0;i<12;i++)r.step();
  r.root.position.z=.25;let previous=r.step(),maxStep=0;
  for(let i=0;i<24;i++){
   r.pose();r.plant.update(1/60,0,0,true,[false,false]);
   const foot=r.bones.get('foot_l')!.getAbsolutePosition().clone();
   maxStep=Math.max(maxStep,Math.hypot(foot.x-previous.x,foot.z-previous.z));previous=foot;
  }
  expect(maxStep).toBeLessThanOrEqual(2/60+.001);
  expect(r.plant.lockCount()).toBe(0);expect(Math.abs(previous.z-.25)).toBeLessThan(.001);r.dispose();
 });
});
