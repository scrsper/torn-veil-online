import type { BridgeSession } from './session';
import { defaultPhysiology, syncNeeds } from '../sim/core/physiology';
import { B } from '../sim/physical/blocks';
import { setExternalControl } from '../sim/runtime/controllers';
import { requestCombatAction } from '../sim/physical/combatAction';

export function arrangeCombatArena(s:BridgeSession,scenario:string) {
  if(!['idle','incoming','incoming_low','blocked','npc_defense'].includes(scenario))throw new Error('Unknown arena scenario');
  const w=s.world;if(!w.places().some(p=>p.name==='Contact arena'))throw new Error('Arena only');
  const [player,npc,other]=w.persons(),pb=w.primaryBody(player.id)!,nb=w.primaryBody(npc.id)!;
  for(let x=18;x<=24;x++)for(let z=18;z<=22;z++)for(let y=1;y<=3;y++)w.grid.set(x,y,z,B.Air);
  for(const p of [player,npc,other]) {setExternalControl(p,true);p.alive=true;p.surrender=null;p.mind.combatCue=undefined;p.mind.plan=[{type:'wait',duration:1e12,status:'pending'}];p.physiology=defaultPhysiology(w.now);syncNeeds(p);
    for(const id of p.bodies){const b=w.body(id)!;b.combatAction=undefined;b.injuries=undefined;b.health=b.maxHealth;b.dead=false;b.present=true;b.pose='stand';b.poseUntil=0;b.subduedUntil=0;b.lastAttackAt=-99;b.path=null;b.vel={x:0,y:0,z:0};}}
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
