import type { Body, BodyRegion, Person, Vec3, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import { resolveCombatAttack, type CombatAttackIntent, type CombatAttackResult } from './combat';
import { INTERACTION_SPEC as S, predictMovement } from './prediction';
import { collisionColumn, movementState } from './interactionMovement';
import { syncNeeds } from '../core/physiology';
import { hurtVolumes, lerpPoint, strikePoint, sweepSphereContact, type CombatTransform } from './combatGeometry';
import type { CombatAction, CombatPhase, DefenseKind } from './combatActionTypes';
import { combatActionFacts } from './combatFacts';

export const combatBusy=(b:Body,at:number)=>!!b.combatAction&&b.combatAction.completeAt>at;
export const combatPosture=(a:CombatAction|undefined,at:number):number=> !a||a.kind!=='duck'||a.outcome==='cancelled'||a.outcome==='interrupted'?0:
  Math.max(0,Math.min(1,(at-a.startedAt)/.06,(a.completeAt-at)/.12));
const angle=(x:number)=>Math.atan2(Math.sin(x),Math.cos(x));
function phase(w:World,a:CombatAction,p:CombatPhase,at:number):WorldEvent {
  a.phase=p;
  const b=w.body(a.actorBodyId)!;
  return w.emit('combat_action',{actor:b.ownerId,target:a.targetBodyId?w.body(a.targetBodyId)?.ownerId:undefined,
    pos:{...b.pos},visibility:p==='preparation'?26:0,loudness:p==='preparation'?4:0,causes:a.eventId?[a.eventId]:[],
    data:{actionId:a.id,actorBodyId:b.id,phase:p,physicalTime:at,kind:a.kind},summary:`${w.nameOf(b.ownerId)} ${a.kind}: ${p}`});
}
function base(w:World,b:Body,kind:CombatAction['kind'],commandId?:string):CombatAction {
  const t=w.physicalTime;
  return {id:w.nextId('action'),commandId,actorBodyId:b.id,kind,targetBodyId:null,weaponId:null,
    definition:kind,trajectory:'high',startedAt:t,startTick:Math.round(t/S.stepSeconds),activeAt:t,
    recoveryAt:t+S.defenseSeconds,completeAt:t+S.defenseSeconds+S.defenseRecoverySeconds,
    phase:'requested',outcome:'pending',facing:b.yaw,initialFacing:b.yaw,trackingUntil:t,turnRate:Math.PI/2,turnBudget:Math.PI/12,
    reach:0,radius:.12,impact:0,exertionCost:.018,intent:'defend',direction:{x:0,y:0,z:0},distance:0,appliedDistance:0,eventId:''};
}
function accept(w:World,p:Person,b:Body,a:CombatAction):void {
  b.combatAction=a;b.path=null;b.vel={x:0,y:0,z:0};
  a.eventId=phase(w,a,'requested',a.startedAt).id;a.eventId=phase(w,a,'accepted',a.startedAt).id;
  a.eventId=phase(w,a,'preparation',a.startedAt).id;
  p.physiology.fatigue=Math.min(1,p.physiology.fatigue+a.exertionCost);syncNeeds(p);
}
export function requestCombatAction(w:World,intent:CombatAttackIntent,commandId?:string):CombatAttackResult {
  const r=resolveCombatAttack(w,intent,w.rng);if(!r.attempted)return r;
  const b=w.body(intent.attackerBodyId)!,p=w.person(intent.attackerId)!,a=base(w,b,'attack',commandId);
  Object.assign(a,{targetBodyId:intent.targetBodyId||null,weaponId:r.weaponId,definition:`${r.weaponId?w.item(r.weaponId)?.type:'unarmed'}_${intent.trajectory??'high'}`,
    trajectory:intent.trajectory??'high',activeAt:a.startedAt+S.preparationSeconds,
    recoveryAt:a.startedAt+S.preparationSeconds+S.activeSeconds,completeAt:a.startedAt+S.preparationSeconds+S.activeSeconds+S.recoverySeconds,
    trackingUntil:a.startedAt+S.preparationSeconds-.1,reach:r.weaponId?r.reach-.3:S.unarmedPathReach,impact:r.impact,exertionCost:r.exertionCost,intent:intent.intent??'injure'});
  b.lastAttackAt=w.physicalTime;b.attackSeq++;b.pose='attack';b.poseUntil=a.completeAt;b.attackTarget=r.targetId;
  accept(w,p,b,a);r.actionId=a.id;return r;
}
export function requestDefense(w:World,bodyId:string,kind:DefenseKind,side=1,commandId?:string):string {
  const b=w.body(bodyId),p=b&&w.person(b.ownerId);
  if(!b||!p||!movementState(w,p,b).eligible)return 'incapacitated';
  if(combatBusy(b,w.physicalTime))return 'cooldown';
  if(!['sidestep','backstep','duck'].includes(kind)||![-1,1].includes(side))return 'invalid_command';
  const a=base(w,b,kind,commandId);
  a.distance=kind==='sidestep'?S.sidestepMetres:kind==='backstep'?S.backstepMetres:0;
  a.direction=kind==='sidestep'?{x:Math.cos(b.yaw)*side,y:0,z:-Math.sin(b.yaw)*side}:
    kind==='backstep'?{x:Math.sin(b.yaw),y:0,z:Math.cos(b.yaw)}:{x:0,y:0,z:0};
  accept(w,p,b,a);return 'accepted';
}
export function stopCombatAction(w:World,b:Body,reason:string,cancel=false,at=w.physicalTime):void {
  const a=b.combatAction;if(!a||a.completeAt<=at||a.outcome==='interrupted'||a.outcome==='cancelled')return;
  a.outcome=cancel?'cancelled':'interrupted';a.stoppedAt=at;a.stopReason=reason;
  a.completeAt=at+S.defenseRecoverySeconds;a.recoveryAt=at;
  phase(w,a,a.outcome,at);b.poseUntil=a.completeAt;
}
export function cancelCombatAction(w:World,bodyId:string):string {
  const b=w.body(bodyId),a=b?.combatAction;if(!b||!a||!combatBusy(b,w.physicalTime))return 'no_action';
  if(a.kind==='attack'&&w.physicalTime>=a.trackingUntil)return 'committed';
  stopCombatAction(w,b,'requested',true);return 'accepted';
}
export function captureCombatTransforms(w:World):Map<string,CombatTransform> {
  if(!w.bodies().some(b=>b.combatAction&&b.combatAction.phase!=='complete'))return new Map();
  return new Map(w.activeBodies().map(b=>[b.id,{pos:{...b.pos},yaw:b.yaw,duck:combatPosture(b.combatAction,w.physicalTime)}]));
}
type Hit=(p:Person,ab:Body,tb:Body,r:CombatAttackResult,a:CombatAction)=>WorldEvent|null;
/** Fast physical work only. Input/ordinary locomotion have already supplied their end poses.
 * Relative sweeps include both motions. Substeps bound turning/duck curves, not the world rate. */
export function advanceCombat(w:World,dt:number,before:Map<string,CombatTransform>,hit:Hit):void {
  const now=w.physicalTime,start=now-dt;
  const actions=w.bodies().filter(b=>b.combatAction&&b.combatAction.phase!=='complete');
  if(!actions.length)return;
  const bodies=w.activeBodies();
  for(const b of actions) {
    const a=b.combatAction!,p=w.person(b.ownerId);
    if(!p||!movementState(w,p,b).eligible)stopCombatAction(w,b,'incapacitated',false,Math.max(start,a.startedAt));
    if(a.weaponId&&a.outcome==='pending') {
      const weapon=w.item(a.weaponId);
      if(!weapon||weapon.holderId!==b.ownerId||!p?.inventory.includes(weapon.id)||weapon.quantity<=0||weapon.condition===0)stopCombatAction(w,b,'weapon_unavailable',false,Math.max(start,a.startedAt));
    }
    if(a.kind==='attack'&&a.outcome==='pending'&&start<a.trackingUntil) {
      const target=a.targetBodyId&&w.body(a.targetBodyId);
      if(target&&w.grid.lineOfSight({...b.pos,y:b.pos.y+1.5},{...target.pos,y:target.pos.y+1.2},a.reach+1)) {
        const desired=Math.atan2(-(target.pos.x-b.pos.x),-(target.pos.z-b.pos.z));
        const limit=a.turnRate*Math.max(0,Math.min(now,a.trackingUntil)-Math.max(start,a.startedAt));
        const turn=Math.max(-limit,Math.min(limit,angle(desired-a.facing)));
        a.facing=a.initialFacing+Math.max(-a.turnBudget,Math.min(a.turnBudget,angle(a.facing+turn-a.initialFacing)));
      }
      b.yaw=a.facing;
    } else if(a.kind==='attack'&&a.outcome==='pending') b.yaw=a.facing;
    if(a.kind!=='attack'&&a.outcome==='pending'&&p) {
      const elapsed=Math.max(0,Math.min(now,a.recoveryAt)-Math.max(start,a.startedAt));
      let remaining=elapsed;
      const origin={...b.pos};
      while(remaining>1e-9) {
        const slice=Math.min(S.stepSeconds,remaining);
        const result=predictMovement({...movementState(w,p,b),speed:a.distance/S.defenseSeconds},
          {x:a.direction.x,z:a.direction.z,sprint:false},slice,(x,z)=>collisionColumn(w,x,z));
        b.pos=result.pos;remaining-=slice;
      }
      a.appliedDistance+=Math.hypot(b.pos.x-origin.x,b.pos.z-origin.z);b.yaw=a.facing;
      b.vel={x:(b.pos.x-origin.x)/dt,y:(b.pos.y-origin.y)/dt,z:(b.pos.z-origin.z)/dt};
    }
  }
  const transform=(b:Body,t:number):CombatTransform=>{
    const old=before.get(b.id),f=Math.max(0,Math.min(1,(t-start)/dt));
    return {pos:old?lerpPoint(old.pos,b.pos,f):b.pos,yaw:b.combatAction?.kind==='attack'?b.combatAction.facing:b.yaw,duck:combatPosture(b.combatAction,t)};
  };
  // Gather before applying consequences: simultaneous contacts do not depend on body iteration.
  const contacts:Array<{ab:Body;tb:Body;a:CombatAction;at:number;region:import('./combatGeometry').ContactRegion;position:Vec3}>=[];
  for(const ab of actions) {
    const a=ab.combatAction!;
    if(a.outcome==='pending'&&now>=a.activeAt&&a.phase==='preparation')phase(w,a,'active',a.activeAt);
    if(a.kind!=='attack'||a.outcome!=='pending')continue;
    const from=Math.max(start,a.activeAt),to=Math.min(now,a.recoveryAt);if(to<=from)continue;
    let best:typeof contacts[number]|undefined;
    const n=Math.max(1,Math.ceil((to-from)*120));
    for(let i=0;i<n&&!best;i++) {
      const t0=from+(to-from)*i/n,t1=from+(to-from)*(i+1)/n;
      const aa0=transform(ab,t0),aa1=transform(ab,t1);
      const v0=strikePoint(aa0.pos,aa0.yaw,a.reach,(t0-a.activeAt)/(a.recoveryAt-a.activeAt),a.trajectory);
      const v1=strikePoint(aa1.pos,aa1.yaw,a.reach,(t1-a.activeAt)/(a.recoveryAt-a.activeAt),a.trajectory);
      for(const tb of bodies) {
        if(tb.ownerId===ab.ownerId||tb.dead||!tb.present)continue;
        const tp=w.person(tb.ownerId);if(tp&&a.intent!=='kill'&&(tp.surrender||tp.custody?.active||tb.subduedUntil>t0))continue;
        const tt0=transform(tb,t0),tt1=transform(tb,t1);
        const h0=hurtVolumes({shape:tb.shape,...tt0},tt0.duck),h1=hurtVolumes({shape:tb.shape,...tt1},tt1.duck);
        for(let j=0;j<h0.length;j++) {
          const fraction=sweepSphereContact(v0,v1,a.radius,h0[j].center,h1[j].center,h0[j].radius);
          if(fraction===null)continue;const at=t0+(t1-t0)*fraction,position=lerpPoint(v0,v1,fraction);
          const origin=lerpPoint(aa0.pos,aa1.pos,fraction);origin.y=position.y;
          if(!w.grid.lineOfPassage(origin,position,a.reach+1))continue;
          if(!best||at<best.at-1e-9||(Math.abs(at-best.at)<1e-9&&tb.id<best.tb.id))best={ab,tb,a,at,region:h0[j].region,position};
        }
      }
    }
    if(best)contacts.push(best);
  }
  contacts.sort((a,b)=>a.at-b.at||a.a.id.localeCompare(b.a.id));
  for(const c of contacts) {
    const {a,ab,tb,at,region,position}=c;
    if(a.stoppedAt!==undefined&&a.stoppedAt<at-1e-9)continue;
    a.outcome='hit';a.contact={bodyId:tb.id,region,position,at};
    const injuryRegion:BodyRegion=region.endsWith('Arm')?'arm':region.endsWith('Leg')?'leg':region as BodyRegion;
    const r:CombatAttackResult={attackerId:ab.ownerId,attackerBodyId:ab.id,targetBodyId:tb.id,targetId:tb.ownerId,attackMode:'strike',
      actionId:a.id,weaponId:a.weaponId,distance:Math.hypot(ab.pos.x-tb.pos.x,ab.pos.z-tb.pos.z),reach:a.reach,attempted:true,
      rejection:null,hit:true,impact:a.impact,exertionCost:a.exertionCost,contactRegion:region,
      injury:tb.shape==='humanoid'?{region:injuryRegion,severity:Math.min(1,a.impact/tb.maxHealth)}:null};
    const ev=hit(w.person(ab.ownerId)!,ab,tb,r,a);if(ev)a.contact.eventId=ev.id;
    stopCombatAction(w,tb,'contact',false,at);
  }
  for(const b of actions) {
    const a=b.combatAction!;
    if(now>=a.recoveryAt&&a.outcome==='pending') {
      if(a.kind==='attack') {
        a.outcome='miss';phase(w,a,'missed',a.recoveryAt);
        w.emit('attack_missed',{actor:b.ownerId,pos:{...b.pos},visibility:26,loudness:8,causes:[a.eventId],
          data:{actionId:a.id,combatFacts:{...combatActionFacts(w,w.person(b.ownerId)!,b,a.targetBodyId?w.body(a.targetBodyId)??null:null,'miss'),actionId:a.id}},summary:`${w.nameOf(b.ownerId)} swung without contact`});
      }
    }
    if(now>=a.recoveryAt&&now<a.completeAt&&a.phase!=='recovery')phase(w,a,'recovery',a.recoveryAt);
    if(now>=a.completeAt&&a.phase!=='complete') {phase(w,a,'complete',a.completeAt);b.attackTarget=null;if(b.pose==='attack')b.pose='stand';}
  }
}
