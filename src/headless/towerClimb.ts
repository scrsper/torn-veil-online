/** Accelerated input-strategy calibration, not observed human completion time.
 * Only the initial atrium placement is a fixture. No health, reward, rank, enemy,
 * clock-history or progression writes occur after entry. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { RealmSession } from '../sim/world/realms/session';
import { applyTowerCommand } from '../server/canonicalTower';
import { TowerController } from '../server/towerController';
import { currentTowerFloor } from '../sim/world/interiors/tower';
import { ARCANE_DEFINITIONS, KERNEL_GEOMETRY } from '../sim/physical/arcana/definitions';
import { arcaneCapacity, assessArcaneTransformation } from '../sim/physical/arcana/growth';
import { towerResidency } from '../sim/world/interiors/residency';
import type { InteractionCommand } from '../bridge/commands';
import type { Vec3 } from '../sim/core/types';

const seed=Number(process.env.TV_TOWER_SEED??918271),limit=Number(process.env.TV_TOWER_FLOORS??10);
const strategy=process.env.TV_TOWER_STRATEGY??'hybrid', seconds=Number(process.env.TV_FLOOR_SECONDS??600);
const out=process.env.TV_TOWER_OUT??'.debug/tower-growth/climb';mkdirSync(out,{recursive:true});
const resume=process.env.TV_TOWER_RESUME;
const s=new RealmSession(seed,resume?readFileSync(resume,'utf8'):undefined),w=s.world,p=s.person,b=s.body;
if(!resume){const gate=s.grid.chunk('aether',32,32).buildings[0];b.pos={x:gate.door.x+.5,y:1,z:gate.z+4.5};w.setDoorOpen(gate.door,true,p.id);
  applyTowerCommand(s,{type:'enter',id:'climb-start',revision:0});}
const h=new TowerController(s),binding=h.bind('climb-calibration');let sequence=0;
const send=(command:InteractionCommand)=>h.bridge.receiveCommand({version:2,type:'command',...binding,sequence,
  commandId:`climb-${sequence++}`,clientTimeMs:performance.now(),command});
let tickCount=0,samples:number[]=[],peakRss=0;
const tick=()=>{if(tickCount++%60){h.step();return;}const start=performance.now();h.step();samples.push(performance.now()-start);peakRss=Math.max(peakRss,process.memoryUsage().rss);};
const drain=(n=30)=>{for(let i=0;i<n;i++)tick();};
const stop=()=>{send({type:'move',x:0,z:0,sprint:false});send({type:'guard',held:false});drain();};
function walk(target:Vec3,timeout=120){
  for(let t=0;t<timeout*60&&w.distance2d(b.pos,target)>.65;t++){
    if(t%6===0){const path=w.nav.findPath(b.pos,target)??[],to=path.find(q=>w.distance2d(q,b.pos)>.45)??target;
      const dx=to.x-b.pos.x,dz=to.z-b.pos.z,d=Math.max(.01,Math.hypot(dx,dz));
      for(let n=0;n<6;n++)send({type:'move',x:dx/d,z:dz/d,sprint:false});}
    tick();
  }
  stop();return w.distance2d(b.pos,target)<2;
}
const first=currentTowerFloor(w)!;
if(!resume){for(const id of first.sourceItemIds){send({type:'interact',interactionId:`take:${id}`});drain();}
  send({type:'learn_arcana',itemId:first.sourceItemIds[0]});drain();send({type:'interact',interactionId:`equip:${first.sourceItemIds[1]}`});drain();}
const records:unknown[]=[],start=performance.now();let failed='';
for(let floor=first.floor;floor<=limit;floor++){
  samples=[];peakRss=0;
  const f=currentTowerFloor(w)!,geometry=h.geometry()!,began=w.physicalTime,initialHp=b.health;
  const patrol=[geometry.exit,...geometry.rooms.flatMap(r=>[ {x:r.x+r.w/2,y:1,z:r.z+r.d/2},
    ...[[2,2],[r.w-2,2],[r.w-2,r.d-2],[2,r.d-2]].map(([dx,dz])=>({x:r.x+dx,y:1,z:r.z+dz}))])
    .filter(q=>w.nav.isWalkable(Math.floor(q.x),Math.floor(q.z))),geometry.start];
  let patrolIndex=0,catching=false,route:Vec3[]=[],routeIndex=0,lastSeen:Vec3|null=null;
  let downings=0,wasDown=false,casts=0;
  for(let t=0;t<seconds*60&&!f.clearEventId;t++){
    if(b.pose==='downed'&&!wasDown)downings++;wasDown=b.pose==='downed';
    if(t%6===0){
      const frame=h.frame()!,visible=frame.snapshot.bodies.filter(q=>q.bodyId!==b.id&&!q.dead&&!q.incapacitated&&!f.defeats.some(d=>d.bodyId===q.bodyId))
        .sort((a,z)=>w.distance2d(a.pos,b.pos)-w.distance2d(z.pos,b.pos));
      const enemy=visible[0],distance=enemy?w.distance2d(enemy.pos,b.pos):Infinity;
      if(enemy)lastSeen={...enemy.pos};if(lastSeen&&w.distance2d(b.pos,lastSeen)<1)lastSeen=null;
      if((b.exertion?.load??0)>.65)catching=true;if((b.exertion?.load??0)<.2)catching=false;
      const busy=!!(b.combatAction&&b.combatAction.completeAt>w.physicalTime||b.arcana?.cast&&!b.arcana.cast.cancelled&&b.arcana.cast.completeAt>w.physicalTime);
      const known=Object.keys(p.arcana?.learned??{}),mana=b.arcana?.mana??100;
      const usable=(id:string)=>{const d=ARCANE_DEFINITIONS.get(id)!;return (b.arcana?.cooldowns[id]??0)<=w.physicalTime&&mana>=d.cost;};
      const heal=known.find(id=>ARCANE_DEFINITIONS.get(id)?.kernel==='heal'&&usable(id));
      const ward=known.find(id=>ARCANE_DEFINITIONS.get(id)?.kernel==='ward'&&usable(id));
      const growth=assessArcaneTransformation(w,p,b),next=growth.next;
      const seeking=!!next&&growth.victories>=next.victories&&growth.forms>=next.forms&&growth.essences>=next.essences
        &&growth.materials.reduce((n,i)=>n+i.quantity,0)>=next.materials&&(next.stage!=='Gold'||growth.quality>=.97);
      let castNow=false;
      if(seeking&&growth.eligible&&!busy){writeFileSync(`${out}/before-integration-${floor}.json`,s.save());send({type:'integrate_arcana'});castNow=true;}
      if(seeking&&!castNow&&!busy){const supply=frame.snapshot.interactions.find(i=>p.physiology.energy<.35&&i.kind==='eat'||p.physiology.hydration<.35&&i.kind==='drink');
        if(supply){send({type:'interact',interactionId:supply.id});castNow=true;}}
      const enemyCast=frame.casts.find(c=>c.bodyId===enemy?.bodyId&&!c.resolved&&!c.cancelled&&c.activeAt>w.physicalTime);
      if(!castNow&&strategy==='ranged'&&enemyCast&&!busy&&!catching&&enemy){
        send({type:'defend',kind:'sidestep',direction:{x:(enemy.pos.z-b.pos.z)/Math.max(.01,distance),z:(b.pos.x-enemy.pos.x)/Math.max(.01,distance)}});castNow=true;
      }
      if(!castNow&&!busy&&!catching&&heal&&b.health<b.maxHealth*.75){send({type:'cast',abilityId:heal,target:{...b.pos}});castNow=true;}
      else if(!castNow&&!busy&&!catching&&enemy&&ward&&!b.arcana?.effects.some(e=>e.kind==='ward'&&e.until>w.physicalTime&&e.strength>10)&&mana>55){send({type:'cast',abilityId:ward,target:{...b.pos}});castNow=true;}
      else if(!seeking&&!castNow&&strategy!=='melee'&&!busy&&!catching&&enemy&&distance>1.5){
        const capacity=arcaneCapacity(p,w,b);
        const spells=known.filter(id=>{const d=ARCANE_DEFINITIONS.get(id)!,g=KERNEL_GEOMETRY[d.kernel];return g.damage>0&&!['dash','blink'].includes(d.kernel)&&usable(id)&&distance<g.range*capacity.aperture-.3;})
          .sort((a,z)=>Object.keys(p.arcana?.growth?.demonstrations[a]??{}).length-Object.keys(p.arcana?.growth?.demonstrations[z]??{}).length);
        if(spells[0]){send({type:'cast',abilityId:spells[0],target:{...enemy.pos}});castNow=true;}
      }
      if(castNow)casts++;
      const incoming=enemy?.combatAction&&enemy.combatAction.kind==='attack'&&enemy.combatAction.recoveryAt>w.physicalTime;
      const aim=enemy?Math.atan2(b.pos.x-enemy.pos.x,b.pos.z-enemy.pos.z):b.yaw;
      const aligned=Math.abs(Math.atan2(Math.sin(aim-b.yaw),Math.cos(aim-b.yaw)))<.12;
      if(!seeking&&!busy&&!castNow&&!catching&&aligned&&enemy&&distance<2.1&&!incoming&&t%18===0)send({type:'attack',targetBodyId:enemy.bodyId,weight:'light'});
      send({type:'guard',held:!catching&&!!incoming&&distance<2.5});
      if(!enemy&&!lastSeen&&w.distance2d(b.pos,patrol[patrolIndex])<1)patrolIndex=(patrolIndex+1)%patrol.length;
      const preferred=strategy==='ranged'&&mana>=18?4.5:1.4;
      const away=enemy?{x:(b.pos.x-enemy.pos.x)/Math.max(.01,distance),z:(b.pos.z-enemy.pos.z)/Math.max(.01,distance)}:null;
      const retreat=enemy&&away&&distance<(catching?4:preferred)?[
        {x:away.x,z:away.z},{x:-away.z,z:away.x},{x:away.z,z:-away.x}]
        .map(q=>({x:b.pos.x+q.x*2,y:b.pos.y,z:b.pos.z+q.z*2}))
        .find(q=>w.nav.isWalkable(Math.floor(q.x),Math.floor(q.z))&&Math.abs(w.nav.floorY(Math.floor(q.x),Math.floor(q.z))-b.pos.y)<.5
          &&w.grid.lineOfPassage({...b.pos,y:b.pos.y+.9},{...q,y:q.y+.9},3))??null:null;
      const target=seeking?geometry.start:retreat??enemy?.pos??lastSeen??patrol[patrolIndex];
      if(t%30===0||enemy&&distance<7){route=w.nav.findPath(b.pos,target)??[];routeIndex=0;}
      while(routeIndex<route.length&&w.distance2d(route[routeIndex],b.pos)<.55)routeIndex++;
      const to=route[routeIndex]??target,dx=to.x-b.pos.x,dz=to.z-b.pos.z,d=Math.max(.01,Math.hypot(dx,dz));
      const stay=busy||castNow||!seeking&&(catching&&!retreat||!retreat&&enemy&&distance<=preferred+.4);
      for(let i=0;i<6;i++)send({type:'move',x:stay||d<.2?0:dx/d,z:stay||d<.2?0:dz/d,sprint:seeking,facing:aim});
    }
    tick();
  }
  const result={floor,cleared:!!f.clearEventId,physicalSeconds:w.physicalTime-began,initialHp,hp:b.health,injuries:{...b.injuries},fatigue:p.physiology.fatigue,
    downings,castRequests:casts,acceptedCasts:w.events.filter(e=>e.type==='arcane_cast'&&e.actor===p.id&&e.data.activeAt>=began).length,
    defeated:f.defeats.length,opponents:f.enemyBodyIds.length,stage:p.ontology.stage,growth:h.frame()!.own.growth,residency:towerResidency(w)};
  const ordered=samples.sort((a,b)=>a-b);Object.assign(result,{sampledTickMs:{count:ordered.length,p50:ordered[Math.floor(ordered.length*.5)],p95:ordered[Math.floor(ordered.length*.95)],max:ordered.at(-1)},peakRss});
  records.push(result);console.log(JSON.stringify(result));
  if(!f.clearEventId){failed=`floor ${floor} did not clear within ${seconds} simulated seconds`;break;}
  stop();const chest=w.container(f.rewardContainerId)!;
  if(!walk(chest.pos!)){failed=`could not reach award on ${floor}`;break;}
  send({type:'interact',interactionId:`open:${chest.id}`});drain();
  for(const id of f.rewardItemIds){send({type:'container_transfer',containerId:chest.id,itemId:id,direction:'out'});drain();const item=w.item(id)!;
    if(item.arcaneSource&&!p.arcana?.learned[item.arcaneSource.abilityId]){send({type:'learn_arcana',itemId:id});drain();}}
  if(p.physiology.energy<.65){const meal=h.frame()!.snapshot.interactions.find(i=>i.kind==='eat');if(meal){send({type:'interact',interactionId:meal.id});drain(120);}}
  if(p.physiology.hydration<.65){
    if(!walk(geometry.start)){failed=`could not return to water on ${floor}`;break;}
    const water=h.frame()!.snapshot.interactions.find(i=>i.kind==='drink');if(water){send({type:'interact',interactionId:water.id});drain(120);}
  }
  // Paid recovery and real rest after a trial. The driver advances ordinary ticks;
  // it never rewrites fatigue, injuries, health, mana or historical days.
  for(let t=0;t<180*60&&b.health<b.maxHealth*.8;t++){
    if(t%60===0&&p.arcana?.learned['book-mend'])send({type:'cast',abilityId:'book-mend',target:{...b.pos}});tick();
  }
  if(p.physiology.fatigue>.42){send({type:'rest'});drain();for(let t=0;t<1800*60&&p.physiology.fatigue>.25;t++)tick();send({type:'wake'});drain();}
  if(assessArcaneTransformation(w,p,b).eligible){writeFileSync(`${out}/before-integration-${floor}.json`,s.save());send({type:'integrate_arcana'});drain();}
  const saved=s.save(),reload=new RealmSession(0,saved);
  if(JSON.stringify(reload.person.arcana)!==JSON.stringify(p.arcana)||reload.body.health!==b.health){failed='reload changed earned state';break;}
  writeFileSync(`${out}/floor-${floor}.json`,saved);
  if(floor<limit){if(!walk(geometry.exit)){failed=`could not reach stair on ${floor}`;break;}
    let error='';
    for(let attempt=0;attempt<30;attempt++){
      drain(60);
      try{applyTowerCommand(s,{type:'ascend',id:`climb-next-${floor}`,revision:w.canonicalTower!.revision,runId:w.canonicalTower!.id});error='';break;}
      catch(e){error=String(e);}
    }
    if(error){failed=`stair remained unavailable on ${floor}: ${error}`;break;}
  }
}
const result={kind:'accelerated body-command strategy; initial atrium fixture only',seed:w.seed,strategy,resumedFrom:resume,requestedFloors:limit,
  elapsedExecutionMs:performance.now()-start,simulatedSeconds:w.physicalTime,failed,records,rank:p.ontology.stage,capacity:arcaneCapacity(p,w,b),residency:towerResidency(w)};
writeFileSync(`${out}/result.json`,JSON.stringify(result,null,2));writeFileSync(`${out}/world.json`,s.save());
if(failed)process.exitCode=1;
