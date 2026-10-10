import {FootPlant} from '../arena/footPlant';
import {SHARED_MOTION_NAMES} from '../arena/sharedMotionNames';
import {TransformNode,type Scene} from '@babylonjs/core';
import {ArenaAssets,HUMAN_SCALE,type CharacterInstance} from '../arena/assets';
import {Animator} from '../arena/anim';
import {MOVESETS,RELAXED} from '../arena/combat';
import {kaykitFallback} from '../arena/assets';
import type {LookId} from '../arena/looks';
import type {BodyState} from '../net/messages';
import type {ActorState,BodyVisual} from './actorManager';
import type {Atmosphere} from '../world/atmosphere';
import {EquipmentVisual} from '../items/equipmentVisual';
import {sharedActionClip,sharedActionProgress,sharedMotionMode,sharedTravelClip} from './sharedMotion';
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
  return new SharedVisual(instance,body,atmosphere,this.assets);
 }
}
export class SharedVisual implements BodyVisual {
 readonly root: TransformNode;
 readonly headHeight: number;
 private animator: Animator;
 private equipment: EquipmentVisual;
 private plant: FootPlant;
 private afterAnimation;
 private dt = 0; private yaw = 0; private active = true;
 private previousMode = ''; private hitSeq: number; private reaction = 0;
 constructor(private instance: CharacterInstance, body: BodyState, private atmosphere: Atmosphere, private assets: ArenaAssets) {
  // The shared arena meshes face +Z. The canonical body faces -Z at yaw zero.
  // Keep the half turn on a child so ActorManager can position/rotate its own root normally.
  this.root = new TransformNode(`${body.bodyId}.body`, instance.root.getScene());
  this.root.metadata = instance.root.metadata;
  instance.root.parent = this.root; instance.root.rotation.y = Math.PI;
  this.headHeight = 1.9 * instance.root.scaling.y;
  this.hitSeq = body.hitSeq;
  this.plant = new FootPlant(instance);
  this.afterAnimation = this.root.getScene().onAfterAnimationsObservable.add(() => {
   this.plant.update(this.dt, this.root.position.y, this.yaw, this.active); instance.springs?.update(this.dt);
  });
  this.animator = new Animator(instance.anims);
  this.equipment = new EquipmentVisual(instance, body.presentationSex === 'f' ? 'female' : 'male');
  for (const mesh of instance.meshes) { mesh.receiveShadows = true; atmosphere.addCaster(mesh); }
 }
 update(dt: number, s: ActorState): void {
  const body = s.body; if (!body) return;
  this.dt = Math.max(0, Math.min(.1, dt)); this.yaw = s.yaw;
  this.equipment.update(body.equipment ?? []);
  const armed = body.equipment?.some(i => i.slot === 'right-hand' && ['sword', 'dagger', 'axe', 'hammer'].includes(i.type)) ?? false;
  const set = armed ? MOVESETS.sword : MOVESETS.fists;
  const clip = (name: string) => this.animator.has(name) ? name : kaykitFallback(name);
  const mode = sharedMotionMode(s);
  this.active = mode !== 'down' && mode !== 'action';
  if (body.hitSeq > this.hitSeq) this.reaction = .24;
  this.hitSeq = body.hitSeq; this.reaction = Math.max(0, this.reaction - this.dt);
  this.animator.legLayer(null);
  if (mode === 'down') {
   this.animator.play(clip(set.death[0]), { fade: .12, restart: this.previousMode !== mode });
  } else if (mode === 'action' && s.combat) {
   this.animator.sample(clip(sharedActionClip(s.combat, armed)), sharedActionProgress(s.combat));
  } else if (this.reaction > 0) {
   this.animator.sample(clip(set.hit[0]), 1 - this.reaction / .24, .04);
  } else if (mode === 'guard') {
   this.animator.play(clip(set.guard), { loop: true });
   if (s.speed > .08) {
    const name = sharedTravelClip(s), pace = this.pace(name, 1.5);
    this.animator.legLayer(name, Math.max(.1, s.speed / pace));
   }
  } else if (mode === 'move') {
   const direction = sharedTravelClip(s);
   if (direction !== 'unarmed/walk_forward') {
    this.animator.play(clip(direction), { loop: true, speed: s.speed / this.pace(direction, 1.5), fade: .18 });
   } else {
    const walk = clip(RELAXED.walk), run = clip(RELAXED.run);
    const wp = this.pace(walk, 1.5), rp = this.pace(run, 4.8);
    const t = Math.max(0, Math.min(1, (s.speed - wp * 1.15) / Math.max(.5, rp * .7 - wp * 1.15))), blend = t * t * (3 - 2 * t);
    const rate = (1 - blend) * s.speed / (wp * Math.max(.1, this.animator.length(walk))) + blend * s.speed / (rp * Math.max(.1, this.animator.length(run)));
    this.animator.loco(walk, run, blend, rate, .2);
   }
  } else {
   this.animator.play(clip(RELAXED.idle), { loop: true, fade: .2 });
  }
  this.previousMode = mode; this.animator.update(this.dt);
 }
 private pace(name: string, fallback: number): number {
  const stance = this.assets.clips.get(name)?.stance ?? 0;
  return Math.max(.1, (stance > .1 ? stance : fallback) * this.instance.root.scaling.x);
 }
 dispose(): void {
  this.root.getScene().onAfterAnimationsObservable.remove(this.afterAnimation);
  this.animator.stopAll(); this.equipment.dispose();
  for (const mesh of this.instance.meshes) this.atmosphere.removeCaster(mesh);
  this.instance.dispose(); this.root.dispose();
 }
}
