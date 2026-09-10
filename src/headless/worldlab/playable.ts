/** Reproducible detailed journey. No teleport, coarse clock stepping, suspended NPCs or
 * prescribed settlement prosperity. All travel uses the same input adapter as Unreal. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { BridgeSession } from '../../bridge/session';
import type { Vec3 } from '../../sim/core/types';
import { RegionStream } from '../../bridge/regions';
import { handInteractions } from '../../sim/physical/hand';
import { knownName } from '../../sim/mind/people';

mkdirSync('.debug', { recursive: true });
const seed = Number(process.argv[2] ?? 918271), s = new BridgeSession(seed,{playable:true}), w = s.world, p = w.person(w.playerId)!, body = w.primaryBody(p.id)!;
const stream = new RegionStream(), report: Record<string,unknown> = { seed, specification:w.geography!.spec, population:w.livingPersons().length };
const road = w.geography!.roads.slice().sort((a,b)=>a.length-b.length)[0];
if (!road) throw new Error('No regional route exists for this seed');
const a = w.settlements().find(a=>a.siteId===road.from)!, b = w.settlements().find(b=>b.siteId===road.to)!;
let sequence=0, steps=0, transitions=0, projectionMs=0, snapshotMs=0, walked=0;
const started=performance.now(), poses=new Set<string>(); s.sim.profile={};
const distance = (v:Vec3,q:Vec3)=>Math.hypot(v.x-q.x,v.z-q.z);
function tick(x=0,z=0,sprint=false) {
  const old={...body.pos}; s.intent({version:1,type:'move',sequence:++sequence,x,z,sprint}); s.step(.1); steps++; walked+=distance(body.pos,old);
  if (!p.alive || body.dead || body.pose==='downed') throw new Error('Journey ended through canonical incapacity');
  if(steps%100===0) {
    const t=performance.now(), frame=stream.frame(w); projectionMs+=performance.now()-t; transitions+=frame?.unload.length??0;
    const t2=performance.now(); s.snapshot(); snapshotMs+=performance.now()-t2;
    for(const body of w.activeBodies()) poses.add(body.pose);
  }
  if(steps%2000===0) console.log(JSON.stringify({stage:'travel',physicalSeconds:w.physicalTime,metres:Math.round(walked),pos:body.pos,heapMB:Math.round(process.memoryUsage().heapUsed/1048576),elapsedSeconds:Math.round((performance.now()-started)/1000)}));
}
function follow(points:Vec3[]) {
  for(const point of points) {
    let stuck=0;
    for(let i=0;distance(body.pos,point)>.08;i++) {
      if(i>5000) throw new Error(`Route did not reach ${JSON.stringify(point)}`);
      const dx=point.x-body.pos.x,dz=point.z-body.pos.z,length=Math.hypot(dx,dz), old={...body.pos};
      const speed=body.speed*1.55; const throttle=Math.min(1,length/(speed*.1)); tick(dx/length*throttle,dz/length*throttle,true);
      if(distance(old,body.pos)<.001) { if(++stuck>15) throw new Error(`Canonical route blocked at ${JSON.stringify(body.pos)} toward ${JSON.stringify(point)} floor=${w.nav.floorY(Math.floor(body.pos.x), Math.floor(body.pos.z)+1)} path=${JSON.stringify(points.slice(Math.max(0,points.indexOf(point)-3),points.indexOf(point)+2))}`); } else stuck=0;
    }
  }
}
function go(target:Vec3) { const path=w.nav.findPath(body.pos,target); if(!path) throw new Error('No local route to '+JSON.stringify(target)); follow(path); }
function act(type:string, extra:Record<string,unknown>={}) { return s.intent({version:1,sequence:++sequence,type,...extra}).result; }
stream.frame(w);
go(a.location);
console.log(JSON.stringify({stage:'entered-a',settlement:a.id,pos:body.pos}));
// Meet an actual generated person. Replan toward their current physical location; no fixture
// assigns their name, their activity, or whether they cooperate.
const residents=a.formerInhabitantIds.map(id=>w.person(id)!).filter(q=>q.alive).sort((a,b)=>distance(w.positionOf(a.id)!,body.pos)-distance(w.positionOf(b.id)!,body.pos));
let met:string|null=null;
for(const resident of residents.slice(0,5)) {
  const before=knownName(p,resident.id);
  for(let attempt=0;attempt<3;attempt++) {
    const target=w.positionOf(resident.id)!; const path=w.nav.findPath(body.pos,target); if(!path) break; follow(path);
    act('person_action',{intent:{kind:'introduce',target:resident.id}}); tick();
    if(p.knowledge[`identity:${resident.id}`]) { met=resident.id; report.identity={subject:met,before,after:knownName(p,met),evidence:p.knowledge[`identity:${met}`].source}; break; }
  }
  if(met) break;
}
if(!met) throw new Error('Could not meet a generated resident');
const well=w.places().find(pl=>pl.settlementId===a.id && pl.type==='well')!;
go(well.inside); const water=handInteractions(s.sim,p).find(i=>i.kind==='drink');
if(!water || act('interact',{interactionId:water.id})!=='accepted') throw new Error('Could not use canonical water access');
report.survival={action:'drink',hydration:p.physiology.hydration};
// A physical extraction through the existing hand action, kept as a persistent witness.
const resource=w.resourceNodes.filter(n=>n.state==='available'&&n.kind==='tree').sort((a,b)=>distance(a.pos,body.pos)-distance(b.pos,body.pos))[0];
if(resource) {
  go(resource.pos);
  const trunk=resource.blocks[0]; body.yaw=Math.atan2(-(trunk.x+.5-body.pos.x),-(trunk.z+.5-body.pos.z));
  for(let i=0;i<20&&resource.remaining>0;i++) { const gather=handInteractions(s.sim,p).find(i=>i.id===`gather:${resource.id}`); if(!gather) break; act('interact',{interactionId:gather.id}); for(let n=0;n<20;n++) tick(); }
  report.resource={id:resource.id,state:resource.state,remaining:resource.remaining};
}
const before={time:w.now,physicalTime:w.physicalTime,physiology:{...p.physiology},pos:{...body.pos},events:w.events.length};
const route=road.points.map(q=>({...q,y:w.nav.floorY(Math.floor(q.x),Math.floor(q.z))}));
go(route[0]); follow(route.slice(1)); go(b.location);
const distant=w.person(b.formerInhabitantIds[0])!;
if(distant.knowledge[`identity:${p.id}`]) throw new Error('Identity leaked to an unintroduced distant resident');
if(p.physiology.fatigue <= before.physiology.fatigue || p.physiology.hydration >= before.physiology.hydration) throw new Error('Travel did not charge ordinary movement physiology');
report.journey={from:a.id,to:b.id,roadLength:road.length,walked,steps,before,after:{time:w.now,physicalTime:w.physicalTime,physiology:{...p.physiology},pos:{...body.pos},events:w.events.length},clockShared:s.sim.world===w,unknownAtB:knownName(distant,p.id)};
console.log(JSON.stringify({stage:'arrived-b',metres:walked,time:w.now,poses:[...poses]}));
const bWell=w.places().find(pl=>pl.settlementId===b.id&&pl.type==='well');
if(bWell) { go(bWell.inside); const drink=handInteractions(s.sim,p).find(i=>i.kind==='drink'); if(drink) report.survivalAtB=act('interact',{interactionId:drink.id}); }
// Return through the same canonical route. Presentation eviction did not pause A.
go(route.at(-1)!); follow(route.slice().reverse().slice(1)); go(a.location);
if(resource?.state!=='depleted') throw new Error('Extraction witness was not depleted');
const returnedFrame=stream.frame(w)!;
if(!returnedFrame.dynamic?.resources.some(n=>n.id===resource.id&&n.state==='depleted')) {
  stream.reset(); if(!stream.frame(w)!.dynamic!.resources.some(n=>n.id===resource.id&&n.state==='depleted')) throw new Error('Resource history lost after return');
}
report.returnJourney={metresTotal:walked,physicalTime:w.physicalTime,time:w.now,resource:resource.state,identityStillKnown:knownName(p,met),settlement:a.id};
const beforeSave=performance.now(), raw=s.save(); writeFileSync('.debug/playable-acceptance.save.json',raw);
const reload=new BridgeSession(0,{save:raw});
if(reload.world.now!==w.now || reload.world.playerId!==p.id || JSON.stringify(reload.world.resourceNodes.find(n=>n.id===resource?.id))!==JSON.stringify(resource)) throw new Error('Persistent world did not survive reconnect');
const newFrame=reload.regions.frame(reload.world)!;
report.persistence={bytes:raw.length,saveLoadMs:performance.now()-beforeSave,clock:reload.world.now,regionsAfterReconnect:newFrame.regions.length,resourcePreserved:true};
report.performance={elapsedSeconds:(performance.now()-started)/1000,steps,transitions,projectionMs,snapshotMs,heapMB:process.memoryUsage().heapUsed/1048576,profile:s.sim.profile}; report.visiblePoses=[...poses];
writeFileSync('docs/playable-world-acceptance.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stage:'complete',report:'docs/playable-world-acceptance.json'}));
