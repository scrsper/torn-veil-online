import {FootPlant} from '../arena/footPlant';
import {SHARED_MOTION_NAMES} from '../arena/sharedMotionNames';
import type {Scene} from '@babylonjs/core';
import {ArenaAssets,HUMAN_SCALE,type CharacterInstance} from '../arena/assets';
import {Animator} from '../arena/anim';
import {MOVESETS,WEAPONS} from '../arena/combat';
import {kaykitFallback} from '../arena/assets';
import type {LookId} from '../arena/looks';
import type {BodyState} from '../net/messages';
import type {ActorState,BodyVisual} from './actorManager';
import type {Atmosphere} from '../world/atmosphere';
import {EquipmentVisual} from '../items/equipmentVisual';
export const SHARED_HUMAN_LOOKS:LookId[]=['ranger','brann','wren','raider','raider_f','soldier','knight','archer','mystic'];
const hash=(s:string)=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);n^=n>>>16;n=Math.imul(n,0x85ebca6b);n^=n>>>13;return(n^(n>>>16))>>>0;};
/** Stable presentation choice, never a replacement for person/body identity. */
export function sharedLook(body:Pick<BodyState,'bodyId'|'appearance'|'presentationSex'>):LookId {
 const d=body.appearance?.description;
 const female=body.presentationSex==='f'||(!body.presentationSex&&d?.presentation==='feminine');
 const list:LookId[]=female?['wren','raider_f']:['ranger','brann','soldier','archer','mystic'];
 return list[hash(body.bodyId)%list.length];
}
export class SharedCharacters {
 readonly assets:ArenaAssets;
 ready=false;
 constructor(scene:Scene){this.assets=new ArenaAssets(scene,{detailedHumans:true});this.assets.used=SHARED_MOTION_NAMES;}
 async load(progress:(text:string)=>void){await this.assets.load(['skeleton_warrior'],progress);await this.assets.loadHumans(SHARED_HUMAN_LOOKS,progress);this.ready=true;}
 create(body:BodyState,atmosphere:Atmosphere):BodyVisual|null {
  if(!this.ready||body.appearance?.description?.agePresentation==='child')return null;
  const instance=this.assets.human(sharedLook(body),body.bodyId);
  // Canonical world metres, rather than the arena's enlarged layout scale.
  instance.root.metadata={sharedLook:sharedLook(body),bodyId:body.bodyId,sex:body.presentationSex};
  instance.root.scaling.scaleInPlace((body.appearance?.height??1)/HUMAN_SCALE);
  return new SharedVisual(instance,body,atmosphere,this.assets.mocap);
 }
}
class SharedVisual implements BodyVisual {
 readonly root;headHeight=1.9;private animator:Animator;private equipment:EquipmentVisual;private attack=-1;private dead=false;private plant:FootPlant;private afterAnimation;private dt=0;private yaw=0;private active=true;
 constructor(private instance:CharacterInstance,body:BodyState,private atmosphere:Atmosphere,private mocap:boolean){
  this.root=instance.root;this.plant=new FootPlant(instance);this.afterAnimation=this.root.getScene().onAfterAnimationsObservable.add(()=>{this.plant.update(this.dt,this.root.position.y,this.yaw,this.active);instance.springs?.update(this.dt);});this.animator=new Animator(instance.anims);this.equipment=new EquipmentVisual(instance,body.presentationSex==='f'?'female':'male');
  for(const m of instance.meshes){m.receiveShadows=true;atmosphere.addCaster(m);}
 }
 update(dt:number,s:ActorState){
  const b=s.body;if(!b)return;this.dt=dt;this.yaw=s.yaw;this.active=!b.dead&&b.pose!=='downed'&&b.pose!=='sleep';
  this.equipment.update(b.equipment??[]);
  const set=b.equipment?.some(i=>i.slot==='right-hand'&&['sword','dagger','axe','hammer'].includes(i.type))?MOVESETS.sword:MOVESETS.fists;
  const clip=(n:string)=>this.animator.has(n)?n:kaykitFallback(n);
  if(b.dead){if(!this.dead)this.animator.play(clip(set.death[0]),{fade:.15});this.dead=true;}
  else if(b.combatAction?.kind==='attack'&&b.attackSeq!==this.attack){this.attack=b.attackSeq;this.animator.play(clip((set===MOVESETS.sword?WEAPONS.axe:WEAPONS.fists).combo[0].clip),{speed:(set===MOVESETS.sword?WEAPONS.axe:WEAPONS.fists).combo[0].speed});}
  else if(!b.combatAction){
   if(b.guarding)this.animator.play(clip(set.guard),{loop:true});
   else if(s.speed>.08)this.animator.loco(clip(set.walk),clip(set.run),Math.min(1,Math.max(0,(s.speed-1.8)/3)),s.speed/1.6);
   else this.animator.play(clip(set.idle),{loop:true});
  }
  this.animator.update(dt);
 }
 dispose(){this.root.getScene().onAfterAnimationsObservable.remove(this.afterAnimation);this.equipment.dispose();for(const m of this.instance.meshes)this.atmosphere.removeCaster(m);this.instance.dispose();}
}
