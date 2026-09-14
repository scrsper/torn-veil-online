import { configureCombatPractice } from '../sim/physical/combatPracticeProfile';
import { setCrouchHeld } from '../sim/physical/posture';
import type { BridgeSession } from './session';
import { defaultPhysiology, syncNeeds } from '../sim/core/physiology';
import { B } from '../sim/physical/blocks';
import { setExternalControl } from '../sim/runtime/controllers';
import { requestCombatAction } from '../sim/physical/combatAction';
import { applyInteractionMovement } from '../sim/physical/interactionMovement';

type Practice={mode:'passive'|'repeat';nextAt:number;countdownUntil:number;recovery:boolean;lastRejection:string};
const practice=new WeakMap<BridgeSession,Practice>();
function settings(s:BridgeSession):Practice {
 let state=practice.get(s);if(!state){state={mode:'passive',nextAt:s.world.physicalTime+1,countdownUntil:0,recovery:true,lastRejection:''};practice.set(s,state);}
 return state;
}
function profile(s:BridgeSession,state:Practice){configureCombatPractice(s.world,s.world.persons().slice(0,2).flatMap(p=>p.bodies),state.recovery);}
export function initializePractice(s:BridgeSession):void {if(s.arena)profile(s,settings(s));}
export function setPracticeMode(s:BridgeSession,mode:'passive'|'repeat'|'reset'|'recovery'|'normal'):string {
 if(!s.arena)return 'arena_only';
 const state=settings(s);
 if(mode==='reset'){arrangeCombatArena(s,'idle');state.countdownUntil=s.world.physicalTime+2;}
 else if(mode==='recovery'||mode==='normal')state.recovery=mode==='recovery';
 else state.mode=mode;
 state.nextAt=Math.max(s.world.physicalTime+1,state.countdownUntil);state.lastRejection='';profile(s,state);return 'accepted';
}
function readiness(s:BridgeSession,state:Practice):string {
 const [p,n]=s.world.persons(),b=s.world.primaryBody(n.id)!,pb=s.world.primaryBody(p.id)!,at=s.world.physicalTime;
 if(pb.dead||b.dead||!p.alive||!n.alive||b.health<=0||pb.health<=0||b.pose==='downed'||pb.pose==='downed')return 'downed';
 if(state.countdownUntil>at)return `reset in ${(state.countdownUntil-at).toFixed(1)}s`;
 if(n.physiology.fatigue>=.90||p.physiology.fatigue>=.94)return 'exhausted';
 if(b.combatAction&&b.combatAction.completeAt>at)return 'recovering';
 if(state.lastRejection)return 'rejected: '+state.lastRejection;
 if(state.mode==='repeat'&&Math.hypot(b.pos.x-pb.pos.x,b.pos.z-pb.pos.z)>1.05)return 'approaching';
 return 'ready';
}
export function practiceStatus(s:BridgeSession) {
 if(!s.arena)return null;
 const state=settings(s),[p,npc]=s.world.persons(),b=s.world.primaryBody(npc.id)!,status=readiness(s,state);
 const last=[...s.world.events].reverse().find(e=>e.type==='attack'||e.type==='attack_missed');
 const result=last?.data.combat as {contactRegion?:string}|undefined;
 return {scripted:true,mode:state.mode,ready:status==='ready',status,profile:state.recovery?'Practice Recovery':'Normal Physiology',arenaRepertoire:true,
  fatigue:p.physiology.fatigue,opponentFatigue:npc.physiology.fatigue,recoveryPerSecond:state.recovery?.035:0,
  opponentPhase:b.combatAction&&b.combatAction.completeAt>s.world.physicalTime?b.combatAction.phase:'ready',lastContact:result?.contactRegion??null,
  lastOutcome:last?.type==='attack'?`hit: ${result?.contactRegion??'body'}`:last?.type==='attack_missed'?'miss':'none'};
}
/** Explicit, labeled test controller. All displacement, commitment and contact stay canonical. */
export function tickPractice(s:BridgeSession,dt:number):void {
 if(!s.arena)return;
 const state=settings(s),w=s.world,[p,npc]=w.persons(),pb=w.primaryBody(p.id)!,b=w.primaryBody(npc.id)!;
 // The scripted controller supplies fresh displacement each tick, including rest.
 if(!b.combatAction||b.combatAction.completeAt<=w.physicalTime)b.vel={x:0,y:0,z:0};
 for(const person of [p,npc]){
  const body=w.primaryBody(person.id)!;
  const quiet=!body.dead&&body.health>0&&Math.hypot(body.vel.x,body.vel.z)<.05&&(!body.combatAction||body.combatAction.completeAt<=w.physicalTime)
   &&w.physicalTime-Math.max(body.lastHitAt,body.combatAction?.startedAt??-99)>1.5;
  if(state.recovery&&quiet){person.physiology.fatigue=Math.max(0,person.physiology.fatigue-.035*dt);syncNeeds(person);}
 }
 if(state.mode!=='repeat'||state.countdownUntil>w.physicalTime)return;
 if(pb.dead||b.dead||!p.alive||!npc.alive||b.health<=0||pb.health<=0||b.pose==='downed'||pb.pose==='downed')return;
 if(b.combatAction&&b.combatAction.completeAt>w.physicalTime)return;
 if(npc.physiology.fatigue>=.90||p.physiology.fatigue>=.94)return;
 const dx=pb.pos.x-b.pos.x,dz=pb.pos.z-b.pos.z,d=Math.hypot(dx,dz);
 if(d>1.05){applyInteractionMovement(w,npc,b,{x:dx/d,z:dz/d,sprint:false},dt);return;}
 if(w.physicalTime<state.nextAt)return;
 const result=requestCombatAction(w,{attackerId:npc.id,attackerBodyId:b.id,targetBodyId:pb.id,attackMode:'strike',trajectory:'high'});
 state.lastRejection=result.rejection??'';state.nextAt=w.physicalTime+1.3;
}

export function arrangeCombatArena(s:BridgeSession,scenario:string) {
  if(!['idle','incoming','incoming_low','blocked','npc_defense'].includes(scenario))throw new Error('Unknown arena scenario');
  const w=s.world;if(!w.places().some(p=>p.name==='Contact arena'))throw new Error('Arena only');
  const [player,npc,other]=w.persons(),pb=w.primaryBody(player.id)!,nb=w.primaryBody(npc.id)!;
  for(let x=18;x<=24;x++)for(let z=18;z<=22;z++)for(let y=1;y<=3;y++)w.grid.set(x,y,z,B.Air);
  for(const p of [player,npc,other]) {setExternalControl(p,true);p.alive=true;p.surrender=null;p.mind.combatCue=undefined;p.mind.plan=[{type:'wait',duration:1e12,status:'pending'}];p.physiology=defaultPhysiology(w.now);syncNeeds(p);
    for(const id of p.bodies){const b=w.body(id)!;setCrouchHeld(w,b,false);b.crouch=0;b.combatAction=undefined;b.injuries=undefined;b.health=b.maxHealth;b.dead=false;b.present=true;b.pose='stand';b.poseUntil=0;b.subduedUntil=0;b.lastAttackAt=-99;b.path=null;b.vel={x:0,y:0,z:0};}}
  pb.pos={x:20.35,y:1,z:20};pb.yaw=-Math.PI/2;nb.pos={x:21.40,y:1,z:20};nb.yaw=Math.PI/2;
  if(scenario==='blocked')for(let z=18;z<=22;z++)for(let y=1;y<=3;y++)w.grid.set(19,y,z,B.Stone);
  w.nav.rebuildArea(18,18,24,22);
  if(scenario==='npc_defense')setExternalControl(npc,false);
  if(scenario==='incoming'||scenario==='incoming_low'||scenario==='blocked') {
    // The endpoint requests an ordinary canonical action, then returns while preparation is live.
    requestCombatAction(w,{attackerId:npc.id,attackerBodyId:nb.id,targetBodyId:pb.id,attackMode:'strike',trajectory:scenario==='incoming_low'?'low':'high'});
  }
  return {scenario,tick:w.physicalTime,playerBodyId:pb.id,npcBodyId:nb.id};
}
