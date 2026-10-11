import { describe, expect, it } from 'vitest';
import { Animation, AnimationGroup, FreeCamera, NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { armSwing, bodySway, legPose } from '../src/web/actors/gait';
import { Animator } from '../src/web/arena/anim';

const angle = (a: Quaternion, b: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(a, b)) / (a.length() * b.length())));
function rig() {
 const scene = new Scene(new NullEngine()); scene.useConstantAnimationDeltaTime = true;
 new FreeCamera('camera', new Vector3(0, 2, -5), scene);
 const root = new TransformNode('actor', scene); root.position.set(12, 1, 30); root.rotation.y = .7;
 const bones = new Map<string, TransformNode>();
 const add = (name: string, parent: TransformNode, pos: Vector3) => {
  const n = new TransformNode(name, scene); n.parent = parent; n.position.copyFrom(pos); n.rotationQuaternion = Quaternion.Identity(); bones.set(name, n); return n;
 };
 const pelvis = add('pelvis', root, new Vector3(0,.95,0)); let p = pelvis;
 for (const name of ['spine_01','spine_02','spine_03','neck_01','head']) p = add(name,p,new Vector3(0,.12,0));
 for (const [side,x] of [['l',.12],['r',-.12]] as const) {
  const thigh = add('thigh_'+side,pelvis,new Vector3(x,0,0));
  const calf = add('calf_'+side,thigh,new Vector3(0,-.44,.02));
  const foot = add('foot_'+side,calf,new Vector3(0,-.42,-.02)); add('ball_'+side,foot,new Vector3(0,-.03,.12));
  const upper = add('upperarm_'+side,bones.get('spine_03')!,new Vector3(x*2,.05,0));
  const lower = add('lowerarm_'+side,upper,new Vector3(x>0?.30:-.30,0,0)); add('hand_'+side,lower,new Vector3(x>0?.25:-.25,0,0));
 }
 const clip = (name: string, q=Quaternion.Identity()) => {
  const group = new AnimationGroup(name,scene);
  for (const node of bones.values()) {
   const a = new Animation(name+node.name,'rotationQuaternion',60,Animation.ANIMATIONTYPE_QUATERNION,Animation.ANIMATIONLOOPMODE_CYCLE);
   const value = node.name==='thigh_l'?q:Quaternion.Identity(); a.setKeys([{frame:0,value:value.clone()},{frame:60,value:value.clone()}]); group.addTargetedAnimation(a,node);
  }
  const a = new Animation(name+'pelvis','position',60,Animation.ANIMATIONTYPE_VECTOR3,Animation.ANIMATIONLOOPMODE_CYCLE);
  a.setKeys([{frame:0,value:pelvis.position.clone()},{frame:60,value:pelvis.position.clone()}]); group.addTargetedAnimation(a,pelvis); group.normalize(0,60); return group;
 };
 const attack = Quaternion.RotationAxis(Vector3.Right(),.8), backward=Quaternion.RotationAxis(Vector3.Right(),-.6);
 const groups = new Map([['walk',clip('walk')],['run',clip('run')],['idle',clip('idle')],['block_idle',clip('block_idle',attack)],['attack',clip('attack',attack)],['dodge',clip('dodge',attack)],['legs:back',clip('back',backward)]]);
 const anim = new Animator(groups,{root,bones});
 const tick = () => { anim.update(1/60); scene.render(); anim.applyLegs(); };
 return {scene,root,bones,anim,groups,tick,attack,backward};
}

describe('PR65 curves',()=>{
 it('keep finite continuous cycles across walking, running and slow amplitudes',()=>{
  for (const run of [0,.5,1]) for (const amp of [.15,.5,1]) {
   const end=legPose(.9999,run,amp),start=legPose(0,run,amp);
   for(const key of ['hip','knee','foot','ball'] as const) expect(Math.abs(end[key]-start[key])).toBeLessThan(.02);
   for(let i=0;i<100;i++) for(const n of [...Object.values(legPose(i/100,run,amp)),...Object.values(bodySway(i/100,run,amp)),...Object.values(armSwing(i/100,run,amp))]) expect(Number.isFinite(n)).toBe(true);
  }
 });
 it('retains loading/swing separation, run clearance and opposite arm swing',()=>{
  expect(legPose(.73,0,1).knee).toBeGreaterThan(50*Math.PI/180);
  expect(legPose(.4,0,1).knee).toBeLessThan(10*Math.PI/180);
  expect(legPose(.68,1,1).knee).toBeGreaterThan(legPose(.73,0,1).knee);
  expect(bodySway(0,0,1).y).toBeLessThan(bodySway(.25,0,1).y);
  expect(armSwing(.5,0,1).shoulder).toBeGreaterThan(armSwing(0,0,1).shoulder);
 });
});

describe('shared imported rig gait ownership',()=>{
 it('poses locomotion on the active rig while preserving the canonical actor root',()=>{
  const x=rig(), position=x.root.position.clone(), rotation=x.root.rotation.clone(); let moved=false;
  for(let i=0;i<180;i++) { x.anim.motion(1.8,1,0,.7);x.anim.loco('walk','run',0,1);x.tick();moved ||= angle(x.bones.get('thigh_l')!.rotationQuaternion!,Quaternion.Identity())>.1;
   for(const bone of x.bones.values()) expect(Math.abs(bone.rotationQuaternion!.length()-1)).toBeLessThan(1e-5);
  }
  expect(moved).toBe(true);expect(x.anim.gaitState?.weight).toBeGreaterThan(.99);expect(x.root.position.asArray()).toEqual(position.asArray());expect(x.root.rotation.asArray()).toEqual(rotation.asArray());
  // The post-animation pass is idempotent in one rendered frame; it never adds the pose twice.
  const pelvis=x.bones.get('pelvis')!,pos=pelvis.position.clone(),q=x.bones.get('thigh_l')!.rotationQuaternion!.clone();x.anim.applyLegs();
  expect(pelvis.position.asArray()).toEqual(pos.asArray());expect(angle(q,x.bones.get('thigh_l')!.rotationQuaternion!)).toBeLessThan(1e-6);x.scene.dispose();
 });
 it('gives attack and dodge sampling sole pose ownership and smoothly resumes locomotion',()=>{
  const x=rig();for(let i=0;i<60;i++){x.anim.motion(2,1,0,0);x.anim.loco('walk','run',0,1);x.tick();}
  for(const name of ['attack','dodge','block_idle']) {
   for(let i=0;i<30;i++){x.anim.sample(name,.3,0);x.tick();}
   expect(x.anim.gaitState?.weight).toBe(0);expect(angle(x.attack,x.bones.get('thigh_l')!.rotationQuaternion!)).toBeLessThan(.001);
   x.anim.loco('walk','run',0,1);x.tick();expect(x.anim.gaitState!.weight).toBeLessThan(.3);
   for(let i=0;i<60;i++){x.anim.loco('walk','run',0,1);x.tick();}expect(x.anim.gaitState!.weight).toBeGreaterThan(.99);
  }x.scene.dispose();
 });
 it('releases the curve for reverse and directional guard layers, with no gait or root drift at rest',()=>{
  const x=rig();for(let i=0;i<60;i++){x.anim.motion(2,1,0,0);x.anim.loco('walk','run',0,1);x.tick();}
  for(let i=0;i<60;i++){x.anim.motion(2,-1,0,0);x.anim.loco('walk','run',0,1);x.tick();}expect(x.anim.gaitState!.weight).toBeLessThan(.001);
  for(let i=0;i<60;i++){x.anim.play('idle',{loop:true,fade:0});x.anim.legLayer('back');x.tick();}
  expect(x.anim.gaitState!.weight).toBe(0);expect(angle(x.backward,x.bones.get('thigh_l')!.rotationQuaternion!)).toBeLessThan(.001);
  for(let i=0;i<90;i++){x.anim.motion(0,1,0,0);x.anim.legLayer(null);x.anim.play('idle',{loop:true});x.tick();}
  expect(x.anim.gaitState!.weight).toBe(0);expect(x.bones.get('pelvis')!.position.asArray()).toEqual([0,.95,0]);expect(x.root.position.asArray()).toEqual([12,1,30]);x.scene.dispose();
 });
 it('uses the authored clip cycle and retains armed upper-body tracks',()=>{
  const x=rig();x.groups.set('ready/sword walk',x.groups.get('walk')!);x.groups.set('ready/sword run',x.groups.get('run')!);
  for(let i=0;i<90;i++) {
   x.anim.motion(3,1,0,.7);x.anim.loco('ready/sword walk','ready/sword run',.6,1.4);x.tick();
   const g=x.groups.get('run')!,phase=(g.animatables[0].masterFrame-g.from)/(g.to-g.from);
   expect(x.anim.gaitState!.phase).toBeCloseTo(phase,6);
   expect(angle(x.bones.get('upperarm_l')!.rotationQuaternion!,Quaternion.Identity())).toBeLessThan(.001);
  }
  expect(x.anim.gaitState!.arms).toBe(false);expect(x.anim.gaitContacts).toHaveLength(2);
  x.anim.timeScale=0;const phase=x.anim.gaitState!.phase;for(let i=0;i<20;i++){x.anim.loco('ready/sword walk','ready/sword run',.6,1.4);x.tick();}
  expect(x.anim.gaitState!.phase).toBeCloseTo(phase,6);x.scene.dispose();
 });
});
