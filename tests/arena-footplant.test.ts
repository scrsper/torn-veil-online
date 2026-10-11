import {describe,it,expect} from 'vitest';
import {NullEngine,Scene,TransformNode,Quaternion,Vector3} from '@babylonjs/core';
import {FootPlant} from '../src/web/arena/footPlant';
import type {CharacterInstance} from '../src/web/arena/assets';

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
