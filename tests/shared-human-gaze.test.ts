import {describe,it,expect} from 'vitest';
import {NullEngine,Scene,TransformNode,Quaternion,Vector3} from '@babylonjs/core';
import {SharedGaze} from '../src/web/actors/sharedGaze';

function fixture(scale=1,yaw=0){
 const engine=new NullEngine(),scene=new Scene(engine),parent=new TransformNode('parent',scene),root=new TransformNode('imported',scene);
 parent.rotation.y=yaw;parent.position.set(3,2,-5);parent.scaling.setAll(1.3);
 root.parent=parent;root.rotation.y=Math.PI;root.scaling.setAll(scale);
 const neck=new TransformNode('neck_01',scene);neck.parent=root;neck.position.y=1.5;
 const head=new TransformNode('head',scene);head.parent=neck;head.position.y=.15;
 const foot=new TransformNode('foot_l',scene);foot.parent=root;foot.position.set(-.12,.11,0);
 const bones=new Map([[neck.name,neck],[head.name,head],[foot.name,foot]]),gaze=new SharedGaze({root,bones});
 const fresh=(turn=0)=>{gaze.restore();neck.rotationQuaternion=Quaternion.Identity();head.rotationQuaternion=Quaternion.RotationAxis(Vector3.Up(),turn);head.computeWorldMatrix(true);};
 const target=(x:number,y:number,z:number)=>{root.computeWorldMatrix(true);head.computeWorldMatrix(true);return head.getAbsolutePosition().add(new Vector3(x,y,z).applyRotationQuaternion(root.absoluteRotationQuaternion));};
 const direction=()=>{head.computeWorldMatrix(true);root.computeWorldMatrix(true);return new Vector3(0,0,1).applyRotationQuaternion(head.absoluteRotationQuaternion).applyRotationQuaternion(Quaternion.Inverse(root.absoluteRotationQuaternion));};
 const step=(point:Vector3|null,active=true,dt=1/60)=>{fresh();gaze.apply(dt,point,active);return direction();};
 return {engine,scene,root,neck,head,foot,gaze,fresh,target,direction,step,dispose(){scene.dispose();engine.dispose();}};
}
describe('imported human projected attention',()=>{
 it('turns toward canonical -Z targets through the imported half turn, parent yaw and scale',()=>{
  for(const scale of [.6,1.6])for(const yaw of [0,1.1]){
   const r=fixture(scale,yaw),point=r.target(2,1,4);
   for(let i=0;i<120;i++)r.step(point);
   const d=r.direction();expect(Math.atan2(d.x,d.z)).toBeCloseTo(Math.atan2(2,4),3);
   expect(Math.atan2(d.y,Math.hypot(d.x,d.z))).toBeCloseTo(Math.atan2(1,Math.hypot(2,4)),3);r.dispose();
  }
 });
 it('acquires smoothly, caps yaw/pitch and leaves roots and feet unchanged',()=>{
  const r=fixture(),point=r.target(4,10,1),root=r.root.position.clone();r.foot.computeWorldMatrix(true);const foot=r.foot.getAbsolutePosition().clone();
  const first=r.step(point);expect(Math.atan2(first.x,first.z)).toBeGreaterThan(0);expect(Math.atan2(first.x,first.z)).toBeLessThan(.12);
  let previous=first,maxAngle=0;
  for(let i=0;i<90;i++){const d=r.step(point);maxAngle=Math.max(maxAngle,Math.acos(Math.min(1,Vector3.Dot(previous,d))));previous=d;}
  expect(Math.atan2(previous.x,previous.z)).toBeCloseTo(.8,3);expect(Math.atan2(previous.y,Math.hypot(previous.x,previous.z))).toBeCloseTo(.35,3);
  expect(maxAngle).toBeLessThan(.12);expect(r.root.position.equals(root)).toBe(true);r.foot.computeWorldMatrix(true);expect(Vector3.Distance(r.foot.getAbsolutePosition(),foot)).toBeLessThan(1e-6);r.dispose();
 });
 it('fades when target disappears or attention is suppressed and ignores targets behind the body',()=>{
  for(const suppressed of [false,true]){
   const r=fixture(),point=r.target(3,0,4);for(let i=0;i<60;i++)r.step(point);const before=r.direction();
   const next=r.step(suppressed?point:null,!suppressed);expect(next.x).toBeGreaterThan(0);expect(next.x).toBeLessThan(before.x);
   for(let i=0;i<100;i++)r.step(suppressed?point:null,!suppressed);expect(Math.abs(r.direction().x)).toBeLessThan(.0001);r.dispose();
  }
  const r=fixture();for(let i=0;i<60;i++)r.step(r.target(1,0,-4));expect(r.direction().x).toBeCloseTo(0,6);r.dispose();
 });
 it('adds to fresh authored poses without accumulation even when a clip leaves the bones untracked',()=>{
  const r=fixture(),point=r.target(3,0,4);for(let i=0;i<90;i++){r.fresh(.12);r.gaze.apply(1/60,point);}
  const original=r.direction();for(let i=0;i<180;i++)r.gaze.apply(1/60,point);
  expect(Vector3.Distance(original,r.direction())).toBeLessThan(.0001);
  r.gaze.restore();r.head.computeWorldMatrix(true);expect(Math.atan2(r.direction().x,r.direction().z)).toBeCloseTo(.12,5);
  r.fresh(-.2);r.gaze.apply(1/60,null,false);expect(Math.atan2(r.direction().x,r.direction().z)).toBeLessThan(.45);r.dispose();
 });
 it('preserves imported bone axes and authored posture while distributing the world rotation once',()=>{
  const r=fixture(1.4,.7);
  const fresh=()=>{r.gaze.restore();r.neck.rotationQuaternion=Quaternion.RotationAxis(Vector3.Forward(),.2);r.head.rotationQuaternion=Quaternion.RotationAxis(Vector3.Right(),.15);r.head.computeWorldMatrix(true);};
  fresh();const frame=r.root.absoluteRotationQuaternion.clone(),base=r.head.absoluteRotationQuaternion.clone(),point=r.target(2,1,4);
  for(let i=0;i<120;i++){fresh();r.gaze.apply(1/60,point);}
  const yaw=Math.atan2(2,4),pitch=-Math.atan2(1,Math.hypot(2,4));
  const expected=frame.multiply(Quaternion.RotationYawPitchRoll(yaw,pitch,0)).multiply(Quaternion.Inverse(frame)).multiply(base);
  expect(Math.abs(Quaternion.Dot(expected,r.head.absoluteRotationQuaternion))).toBeGreaterThan(.999999);
  r.gaze.restore();r.head.computeWorldMatrix(true);expect(Math.abs(Quaternion.Dot(base,r.head.absoluteRotationQuaternion))).toBeGreaterThan(.999999);r.dispose();
 });
 it('drops stale correction after a suspended frame and handles missing bones or invalid targets',()=>{
  const r=fixture(),point=r.target(3,0,4);for(let i=0;i<60;i++)r.step(point);
  expect(r.step(point,true,.5).x).toBeCloseTo(0,6);for(let i=0;i<100;i++)r.step(new Vector3(NaN,0,0));expect(r.direction().x).toBeCloseTo(0,5);
  expect(()=>new SharedGaze({root:r.root,bones:new Map()}).apply(1/60,point)).not.toThrow();r.dispose();
 });
});
