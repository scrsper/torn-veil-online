import {FootPlant,type FootGround} from '../arena/footPlant';
import {ContactFootfalls} from '../audio/footfalls';
import {SharedGaze} from './sharedGaze';
import {contactHints,gaitPhases} from '../arena/gaitPhase';
import {sharedTravelClip, authoredTravelBlend} from './sharedMotion';
import {SHARED_MOTION_NAMES} from '../arena/sharedMotionNames';
import { TransformNode, type Scene, type Vector3 } from '@babylonjs/core';
import {ArenaAssets,HUMAN_SCALE,type CharacterInstance} from '../arena/assets';
import {Animator} from '../arena/anim';
import {MOVESETS, RELAXED, dodgeClip} from '../arena/combat';
import {kaykitFallback} from '../arena/assets';
import type {LookId} from '../arena/looks';
import type {BodyState} from '../net/messages';
import type {ActorState,BodyVisual} from './actorManager';
import type {Atmosphere} from '../world/atmosphere';
import {EquipmentVisual} from '../items/equipmentVisual';
import { HUMAN_LOOKS, PRESENTATION_REVISION, UNARMED_MOTION, motionSampleSeconds, weaponMotionBinding, humanAssetPath } from '../presentation/library';
import type { ClipTemplate } from '../arena/retarget';
export const SHARED_HUMAN_LOOKS:LookId[]=HUMAN_LOOKS;
export interface SharedCharacterEnvironment {
 ground?:FootGround;
 onFootfall?:(point:{x:number;y:number;z:number},speed:number)=>void;
}
const hash=(s:string)=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);n^=n>>>16;n=Math.imul(n,0x85ebca6b);n^=n>>>13;return(n^(n>>>16))>>>0;};
/** Stable presentation choice, never a replacement for person/body identity. */
export function sharedLook(body:Pick<BodyState,'bodyId'|'appearance'|'presentationSex'>):LookId {
 const d=body.appearance?.description;
 const female=body.presentationSex==='f'||(!body.presentationSex&&d?.presentation==='feminine');
 const list:LookId[]=female?['wren','raider_f']:['ranger','brann','soldier','archer','mystic'];
 return list[hash(body.bodyId)%list.length];
}
/** Deliberate existing, credited hero kits. Creator prototypes are audition candidates,
 * not an unverified automatic replacement; canonical identity/sex stays unchanged. */
export function sharedHeroLook(body: Pick<BodyState, 'presentationSex' | 'appearance'>): LookId {
 return body.presentationSex === 'f' || body.appearance?.description?.presentation === 'feminine' ? 'wren' : 'ranger';
}
export class SharedCharacters {
 readonly assets:ArenaAssets;
 ready=false;
 constructor(scene:Scene){this.assets=new ArenaAssets(scene,{detailedHumans:true});this.assets.used=SHARED_MOTION_NAMES;}
 async load(progress:(text:string)=>void){await this.assets.load(['skeleton_warrior'],progress);await this.assets.loadHumans(SHARED_HUMAN_LOOKS,progress);this.ready=true;}
 create(body:BodyState,atmosphere:Atmosphere,environment?:SharedCharacterEnvironment,role:'resident'|'player'='resident'):BodyVisual|null {
  if(!this.ready||body.appearance?.description?.agePresentation==='child')return null;
  const look=role==='player'?sharedHeroLook(body):sharedLook(body),instance=this.assets.human(look,body.bodyId);
  // Canonical world metres, rather than the arena's enlarged layout scale.
  instance.root.metadata={...instance.root.metadata,sharedLook:look,assetPath:humanAssetPath(look),bodyId:body.bodyId,sex:body.presentationSex,presentationRevision:PRESENTATION_REVISION};
  instance.root.scaling.scaleInPlace((body.appearance?.height??1)/HUMAN_SCALE);
  return new SharedVisual(instance,body,atmosphere,this.assets.clipsFor(look),environment);
 }
}
export class SharedVisual implements BodyVisual {
 readonly contactFootfalls=true;
 readonly root: TransformNode; headHeight = 1.9;
 private animator: Animator; private equipment: EquipmentVisual; private plant: FootPlant; private afterAnimation;
 private dt = 0; private yaw = 0; private plantActive = true; private clock = 0; private combatUntil = 0;
 private fallen = false; private hitSeq: number; private hitUntil = 0;
 private gaze:SharedGaze;private lookAt:Vector3|null=null;private gazeActive=true;private rawDt=0;
 private footfalls=new ContactFootfalls();private speed=0;private footfallActive=false;
 private travel='unarmed/walk_forward';
 constructor(private instance: CharacterInstance, body: BodyState, private atmosphere: Atmosphere, private clips: Map<string, ClipTemplate>,private environment?:SharedCharacterEnvironment) {
  // Arena assets face +Z, while canonical bodies face -Z. Keep that coordinate adapter
  // below the actor root; never rotate the canonical body or its physical contact geometry.
  this.root = new TransformNode(`canonical-${body.bodyId}`, instance.root.getScene());
  this.root.metadata = { ...instance.root.metadata };
  instance.root.parent = this.root; instance.root.rotation.y = Math.PI;
  this.headHeight=1.9*instance.root.scaling.y;
  // Preserve authored joints: passing phase data without the procedural rig means
  // Animator does not construct HumanGait. Foot IK remains a bounded contact correction.
  this.hitSeq = body.hitSeq; this.animator = new Animator(instance.anims,gaitPhases(clips)); this.plant = new FootPlant(instance);
  this.gaze=new SharedGaze(instance);
  this.equipment = new EquipmentVisual(instance, body.presentationSex === 'f' ? 'female' : 'male');
  this.afterAnimation = this.root.getScene().onAfterAnimationsObservable.add(() => {
   this.animator.applyLegs();
   const contacts=this.animator.gaitContacts??contactHints(this.animator.contactSource(),clips);
   const support=this.plant.update(this.dt,this.root.position.y,this.yaw+Math.PI,this.plantActive,contacts,this.environment?.ground);
   this.gaze.apply(this.rawDt,this.lookAt,this.gazeActive);instance.springs?.update(this.dt);
   this.root.computeWorldMatrix(true);
   this.root.metadata.equipment=this.equipment.inspect();
   if(this.root.metadata.motion&&instance.bones){
    const point=(name:string)=>{const n=instance.bones!.get(name);n?.computeWorldMatrix(true);return n?.getAbsolutePosition().asArray()??null;};
    const hip=point('pelvis'),chest=point('spine_03');
    Object.assign(this.root.metadata.motion,{feet:[point('foot_l'),point('foot_r')],contacts:contacts??support??null,locks:this.plant.lockState(),
     spineTiltDeg:hip&&chest?Math.atan2(Math.hypot(chest[0]-hip[0],chest[2]-hip[2]),chest[1]-hip[1])*180/Math.PI:null});
   }
   for(const side of this.footfalls.update({dt:this.rawDt,contacts:contacts??support,speed:this.speed,active:this.footfallActive,position:this.root.getAbsolutePosition()})){
    const foot=instance.bones?.get(side===0?'foot_l':'foot_r');foot?.computeWorldMatrix(true);
    this.environment?.onFootfall?.(foot?.getAbsolutePosition()??this.root.getAbsolutePosition(),this.speed);
   }
  });
  for (const mesh of instance.meshes) { mesh.receiveShadows = true; atmosphere.addCaster(mesh); }
 }
 private clip(name: string) { return this.animator.has(name) ? name : kaykitFallback(name); }
 private pace(name: string, fallback: number) { return (this.clips.get(name)?.stance ?? 0) * this.instance.root.scaling.x || fallback; }
 update(dt: number, s: ActorState) {
  const b = s.body; if (!b) return;
  this.gaze.restore();this.lookAt=s.lookAt?.clone()??null;
  this.rawDt=dt;this.dt = Math.max(0,Math.min(.1,dt)); this.clock += dt; this.yaw = s.yaw; this.equipment.update(b.equipment ?? []);
  const forwardMotion = s.speed > .001 ? (-Math.sin(s.yaw) * s.velocity.x - Math.cos(s.yaw) * s.velocity.z) / s.speed : 1;
  this.animator.motion(s.speed, forwardMotion, s.crouch, s.yaw);
  const weapon = b.equipment?.find(i => i.slot === 'right-hand' && ['sword', 'dagger', 'axe', 'hammer'].includes(i.type)), armed=!!weapon;
  const set = armed ? MOVESETS.sword : MOVESETS.fists, falling = b.dead || b.incapacitated || ['downed','sleep','dead'].includes(b.pose);
  const action = s.combat && !['guard', 'stance'].includes(s.combat.moveId) ? s.combat : null;
  if (action || s.guard || b.guarding || s.hit) this.combatUntil = this.clock + 2;
  this.plantActive = !falling && !action && s.crouch < .05;
  this.speed=s.speed;this.footfallActive=!falling&&!action&&s.speed>.08;
  if(s.speed>.08)this.travel=sharedTravelClip(s,this.travel);
  this.gazeActive=!falling&&!action&&this.clock>=this.hitUntil;
  this.animator.legLayer(null);
  if (b.hitSeq > this.hitSeq) {
   this.hitSeq = b.hitSeq; this.hitUntil = this.clock + .32;
   if (!falling) this.animator.play(this.clip(set.hit[b.hitSeq % set.hit.length]), { fade: .035, restart: true });
  }
  if (falling) {
   if (!this.fallen) this.animator.play(this.clip(set.death[b.hitSeq % set.death.length]), { fade: .08, restart: true });
   this.fallen = true;
  } else if (action) {
   this.fallen = false;
   if (['sidestep', 'backstep', 'duck'].includes(action.moveId)) {
    const d = action.dirLocal, kind = action.moveId === 'backstep' ? 'back' : d && Math.abs(d.z) > Math.abs(d.x) ? (d.z > 0 ? 'forward' : 'back') : (d?.x ?? action.side ?? 1) > 0 ? 'left' : 'right';
    const name = this.clip(action.moveId === 'duck' ? 'unarmed/slip_left' : dodgeClip(armed ? 'sword' : 'fists', kind));
    const total = Math.max(.001, action.prep + action.active + action.recovery);
    this.animator.sample(name, this.animator.length(name) * Math.min(1, action.age / total), .045);
   } else {
    const motion = armed ? weaponMotionBinding(action,weapon!.type)
     : action.weight === 'heavy' && ['jab', 'cross'].includes(action.moveId) ? UNARMED_MOTION.heavy : UNARMED_MOTION[action.moveId] ?? UNARMED_MOTION.jab;
    this.animator.sample(this.clip(motion.clip), motionSampleSeconds(action, motion), .045);
   }
  } else if (this.clock >= this.hitUntil) {
   this.fallen = false;
   const engaged = this.clock < this.combatUntil, readyWeapon = armed && engaged,
    idle = readyWeapon ? 'ready/sword and shield idle' : engaged ? set.idle : RELAXED.idle;
   if(s.crouch>.1&&!(s.guard||b.guarding)){
    const name=this.clip(s.speed>.08?'sword_and_shield/sword and shield crouching (3)':'sword_and_shield/sword and shield crouch idle');
    this.animator.play(name,{loop:true,speed:s.speed>.08?Math.max(.3,s.speed/this.pace(name,1)):1,fade:.16});
   } else if (s.guard || b.guarding) {
    this.animator.play(this.clip(set.guard), { loop: true, fade: .08 });
    if (s.speed > .1) {
     const name=this.travel;
     this.animator.legLayer(name, Math.max(.25, s.speed / this.pace(name, 1.6)));
    }
   } else if (s.speed > .08 && this.travel !== 'unarmed/walk_forward') {
    const direction = this.clip(this.travel);
    this.animator.play(direction, { loop: true, speed: Math.max(.25, s.speed / this.pace(direction, 1.6)), fade: .14 });
   } else if (s.speed > .08) {
    const plan = authoredTravelBlend(s.speed,b.pose==='run'&&forwardMotion>.7,(n,f)=>this.pace(n,f),n=>this.animator.length(n),readyWeapon);
    this.animator.loco(this.clip(plan.walk),this.clip(plan.run),plan.blend,plan.rate,.18);
   } else this.animator.play(this.clip(idle), { loop: true, fade: .12 });
  }
  this.root.metadata.motion = { policy:'authored-in-place',clip: this.animator.current, dominantClip:this.animator.dominant()?.name??null, stance: this.clock < this.combatUntil ? 'combat' : 'travel', armed, action: action?.moveId ?? null, age: action?.age ?? null, hit: this.clock < this.hitUntil, planted: this.plantActive, locks:this.plant.lockState(),canonicalFacing: s.yaw, canonicalCrouch:s.crouch, gait: this.animator.gaitState };
  this.animator.update(dt);
 }
 dispose() {
  this.root.getScene().onAfterAnimationsObservable.remove(this.afterAnimation); this.equipment.dispose(); this.animator.stopAll();
  for (const mesh of this.instance.meshes) this.atmosphere.removeCaster(mesh);
  this.instance.dispose(); this.root.dispose();
 }
}
