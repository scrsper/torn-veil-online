/** Ordinary-input contact route and read-only, bounded presentation evidence.
 * Imported by presentation-quality-journey.mjs; never writes canonical state. */
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mul=(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const len=a=>Math.hypot(a.x,a.y,a.z);
const norm=a=>mul(a,1/len(a));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
const anchor={x:0,y:Math.sin(Math.PI/10),z:Math.cos(Math.PI/10)};
const east={x:1,y:0,z:0},north={x:0,y:anchor.z,z:-anchor.y};

/** Turning toward a waypoint is real progress, but an oscillating or stalled
 * heading cannot indefinitely refresh the same bounded no-progress timer. */
export function groundRouteProgress(previous,remaining,headingError,now){
 const next={...previous},turning=Math.abs(headingError)>.14;
 if(remaining<next.bestDistance-.15){next.bestDistance=remaining;next.lastProgress=now;}
 if(turning){
  if(next.phase!=='turn')next.bestHeading=Infinity;
  if(Math.abs(headingError)<next.bestHeading-.06){next.bestHeading=Math.abs(headingError);next.lastProgress=now;}
 }
 next.phase=turning?'turn':'move';return next;
}
export function groundTurnPulse(error,tailMs){return clamp((Math.abs(error)-.03)/1.8*1000-tailMs,20,260);}
export function groundWalkPulse(remaining,tailMs){return clamp((remaining-.4)/7*1000-tailMs,20,550);}
/** Physical key duration must not wait for a serialized network request. A
 * short chord can be coalesced before transmission; its accepted neutral
 * response and settled position are checked separately by stopGround. */
export async function holdGroundKeys(page,keys,requestedMs){
 const startedAt=Date.now();
 await Promise.all(keys.map(key=>page.keyboard.down(key)));
 const keydownCompleteAt=Date.now();
 await page.waitForTimeout(requestedMs);
 const releaseRequestedAt=Date.now();
 return{requestedMs,startedAt,keydownCompleteAt,releaseRequestedAt,
  physicalHoldMs:releaseRequestedAt-startedAt,afterKeydownMs:releaseRequestedAt-keydownCompleteAt};
}
export function durableGroundStop(view,minimumSeq){
 const t=view.inputTransport,a=t?.lastDurableInput;
 return t?.mode==='stream'&&!t.failure&&a&&t.lastDurable>=a.seq&&t.lastReceived>=a.seq&&view.lastSeq>=a.seq
  &&isNeutralGroundRequest({seq:a.seq,command:{type:'input',input:a.input}},minimumSeq)?a:null;
}
/** Select ordinary body-relative WASD, matching the shared surface integrator's
 * normalized diagonals. Precise body yaw is not a precondition for walking. */
export function groundWalkDirection(forward,up,desired){
 const right=norm(cross(forward,up));let best=null;
 for(const throttle of [-1,0,1])for(const strafe of [-1,0,1]){
  if(!throttle&&!strafe)continue;
  const direction=norm(add(mul(forward,throttle),mul(right,strafe))),alignment=dot(direction,desired);
  if(!best||alignment>best.alignment)best={throttle,strafe,direction,alignment,
   keys:[...(throttle?[throttle>0?'w':'s']:[]),...(strafe?[strafe>0?'d':'a']:[])]};
 }
 return best;
}
export function isNeutralGroundRequest(value,lastActiveSeq){
 const input=value?.command?.input;
 return Number.isSafeInteger(value?.seq)&&value.seq>lastActiveSeq&&value.command?.type==='input'
  &&typeof input?.brake==='boolean'&&['throttle','yaw','pitch','strafe','lift'].every(k=>input[k]===0);
}

// Read-only independent chart math matches the documented home chart. It is
// used to aim ordinary keys, never to write a body position or request a move.
export function contactChartPosition(view){
 const p=view.system.planets[0],v=sub(view.state.position,p.center),d=norm(v),a=Math.acos(clamp(dot(d,anchor),-1,1));
 const k=a<1e-9?p.radius:p.radius*a/Math.sin(a);
 return{x:11312.5-dot(d,east)*k,y:len(v)-3-p.radius-5,z:3092.5+dot(d,north)*k};
}
function targetDirection(view,target){
 const p=view.system.planets[0],x=-(target.x-11312.5),z=target.z-3092.5,r=Math.hypot(x,z),a=r/p.radius;
 const targetRadial=r<1e-9?anchor:add(mul(anchor,Math.cos(a)),mul(add(mul(east,x),mul(north,z)),Math.sin(a)/r));
 const up=norm(sub(view.state.position,p.center));
 return{up,desired:norm(sub(targetRadial,mul(up,dot(targetRadial,up))))};
}

function floorGap(point,up,patch){
 if(!patch?.available)return null;
 const p=sub(point,patch.origin),horizontal=sub(p,mul(up,dot(p,up)));
 if(len(horizontal)>Math.min(2.45,patch.radius??1.45))return null;
 let best=null;
 for(const t of patch.triangles){
  const a={x:t[0],y:t[1],z:t[2]},b={x:t[3],y:t[4],z:t[5]},c={x:t[6],y:t[7],z:t[8]};
  const edge1=sub(b,a),edge2=sub(c,a),n=norm(cross(edge1,edge2)),slope=dot(n,up);
  if(slope<.65)continue;
  const ray=cross(up,edge2),det=dot(edge1,ray);
  if(Math.abs(det)<1e-12)continue;
  const offset=sub(p,a),u=dot(offset,ray)/det,q=cross(offset,edge1),v=dot(up,q)/det;
  if(u< -1e-7||v< -1e-7||u+v>1+1e-7)continue;
  const travel=dot(edge2,q)/det;
  if(Math.abs(travel)>.3||best&&travel<=best.travel)continue;
  best={travel,gap:-travel*slope};
 }
 return best?.gap??null;
}

export function summarizeContactTrace(trace){
 const feet={l:{eligible:[],windows:[],penetrationMs:0,gapMs:0,measuredVertices:[]},r:{eligible:[],windows:[],penetrationMs:0,gapMs:0,measuredVertices:[]}};
 const windows=new Map(),stageWindows=new Map(),stages={},bad=new Map(),independent=[];
 let active=0,airborneActive=0,airborneActiveMs=0,airborneSince=null,missing=0;
 for(let i=0;i<trace.frames.length;i++){
  const f=trace.frames[i],r=f.radial;
  if(!r){missing++;continue;}if(r.active)active++;
  if(f.mode==='flight'&&r.active){airborneActive++;airborneSince??=f.t;airborneActiveMs=Math.max(airborneActiveMs,f.t-airborneSince);}else airborneSince=null;
  for(const foot of r.feet??[]){
   const info=feet[foot.side];if(!info)continue;
   info.measuredVertices.push(foot.measuredVertices);
   const gaps=foot.signedGaps.filter(Number.isFinite),min=gaps.length?Math.min(...gaps):null;
   const eligible=r.active&&foot.contact&&foot.lock&&foot.weight>=.98&&!foot.releasing&&min!==null;
   const stage=stages[f.stage]??=( {l:{frames:0,eligibleFrames:0,maximumWindowMs:0,reasons:{}},r:{frames:0,eligibleFrames:0,maximumWindowMs:0,reasons:{}}} );
   const byStage=stage[foot.side];byStage.frames++;if(eligible)byStage.eligibleFrames++;
   const stageKey=f.stage+':'+foot.side,priorStage=stageWindows.get(foot.side);
   if(eligible){
    const next=priorStage&&priorStage.key===stageKey&&priorStage.lockId===foot.lockId&&priorStage.reference===r.reference?priorStage:{key:stageKey,lockId:foot.lockId,reference:r.reference,start:f.t};
    byStage.maximumWindowMs=Math.max(byStage.maximumWindowMs,f.t-next.start);stageWindows.set(foot.side,next);
   }else{stageWindows.delete(foot.side);const reason=foot.reason??(!foot.lock?'unlocked':foot.releasing?'releasing':foot.weight<.98?'weight-below-.98':'no-contact');byStage.reasons[reason]=(byStage.reasons[reason]??0)+1;}
   if(eligible)info.eligible.push({t:f.t,stage:f.stage,min,lockId:foot.lockId,source:foot.support?.source});
   for(const [label,condition] of [['penetration',r.active&&min!==null&&min<-.03],['gap',eligible&&min>.08]]){
    const key=foot.side+label,prior=bad.get(key);
    if(condition){const since=prior??f.t;bad.set(key,since);info[label+'Ms']=Math.max(info[label+'Ms'],f.t-since);}else bad.delete(key);
   }
   const key=foot.side+':'+foot.lockId,prior=windows.get(foot.side);
   if(eligible&&foot.solePoints.length){
    const centre=mul(foot.solePoints.reduce(add,{x:0,y:0,z:0}),1/foot.solePoints.length);
    if(!prior||prior.key!==key||prior.reference!==r.reference){
     const next={key,reference:r.reference,start:f.t,end:f.t,stage:f.stage,point:centre,maxDrift:0,frames:1};
     info.windows.push(next);windows.set(foot.side,next);
    }else{
     const delta=sub(centre,prior.point),drift=len(sub(delta,mul(r.up,dot(delta,r.up))));
     prior.maxDrift=Math.max(prior.maxDrift,drift);prior.end=f.t;prior.frames++;
    }
   }else windows.delete(foot.side);
   if(i%10===0&&r.active&&r.up){
    const patch=trace.patches[f.sampledPatchId];
    for(let k=0;k<foot.solePoints.length;k++){
     const actual=floorGap(foot.solePoints[k],r.up,patch),reported=foot.signedGaps[k];
     if(actual!==null&&Number.isFinite(reported))independent.push({t:f.t,side:foot.side,vertex:k,actual,reported,error:Math.abs(actual-reported),patchId:f.sampledPatchId});
    }
   }
  }
 }
 const summaries=Object.fromEntries(Object.entries(feet).map(([side,f])=>{
  const stationary=f.eligible.filter(s=>s.stage.includes('idle')),windows=f.windows.filter(w=>w.end-w.start>=100);
  return[side,{eligibleFrames:f.eligible.length,stationaryFrames:stationary.length,
   stationaryP95AbsMinGap:percentile(stationary.map(s=>Math.abs(s.min)),.95),
   minimumGap:f.eligible.length?Math.min(...f.eligible.map(s=>s.min)):null,
   maximumGap:f.eligible.length?Math.max(...f.eligible.map(s=>s.min)):null,
   longestPenetrationMs:f.penetrationMs,longestUnsupportedGapMs:f.gapMs,
   eligibleWindows:windows.map(({point,...w})=>({...w,duration:w.end-w.start})),
   maximumSettledDrift:windows.length?Math.max(...windows.map(w=>w.maxDrift)):null,
   measuredVertexCounts:[...new Set(f.measuredVertices)]}];
 }));
 const patchReasons=Object.values(trace.patches).reduce((counts,p)=>{counts[p.reason]=(counts[p.reason]??0)+1;return counts;},{});
 return{frames:trace.frames.length,duration:trace.frames.at(-1)?.t??0,activeFrames:active,airborneActiveFrames:airborneActive,
  patchReasons,patchCount:Object.keys(trace.patches).length,maximumPatchTriangles:Math.max(0,...Object.values(trace.patches).map(p=>p.triangles.length)),
  airborneActiveMs,missingFrames:missing,bounded:trace.bounded,feet:summaries,stages,
  independent:{samples:independent.length,maximumError:independent.length?Math.max(...independent.map(s=>s.error)):null,
   mismatches:independent.filter(s=>s.error>.002).slice(0,20)}};
}

export function createContactQA({page,report,output,read,capture,save,check,orbit,zoom,recenter}){
 report.contactQA={traces:[],route:[],stops:[],findings:[],limits:[],targets:{penetration:.03,sustainedMs:100,stationaryP95Gap:.04,unsupportedGap:.08,lockDrift:.03}};
 let lastActiveSeq=0;
 // Observe sent ordinary inputs only. Session/controller tokens are never
 // recorded. A coalesced zero-input sample may legitimately have brake=false.
 report.contactQA.inputRequests=[];
 page.on('request',request=>{
  if(new URL(request.url()).pathname!=='/realms/universe/command'||request.method()!=='POST')return;
  try{
   const value=request.postDataJSON(),input=value.command?.input;if(value.command?.type!=='input')return;
   if(['throttle','yaw','pitch','strafe','lift'].some(k=>input[k]!==0))lastActiveSeq=Math.max(lastActiveSeq,value.seq);
   if(report.contactQA.inputRequests.length<2048)report.contactQA.inputRequests.push({at:Date.now(),seq:value.seq,input:{throttle:input.throttle,yaw:input.yaw,pitch:input.pitch,strafe:input.strafe,lift:input.lift,brake:input.brake}});
  }catch{}
 });
 let tracing=false;
 const finding=message=>{report.contactQA.findings.push(message);report.presentationFailures??=[];report.presentationFailures.push(message);console.log('CONTACT FINDING '+message);};
 const start=async name=>{
  if(tracing)throw Error('Only one contact trace may run at once');
  tracing=true;
  await page.evaluate(name=>{
   const data={name,started:performance.now(),stage:name,frames:[],patches:{},bounded:false,running:true};
   window.__tvContactQA=data;
   const frame=now=>{
    if(!data.running)return;
    const d=window.__tvUniverse,c=d?.campaign,s=c?.active?d?.snapshot:d?.preview??d?.snapshot;
    if(!s){data.running=false;return;}
    const patch=c?.footSupport;if(patch&&!data.patches[patch.id]&&Object.keys(data.patches).length<256)data.patches[patch.id]=structuredClone(patch);
    const avatar=d.avatar;
    data.frames.push({t:now-data.started,stage:data.stage,revision:s.revision??s.state.tick,mode:s.state.mode,
     position:structuredClone(s.state.position),velocity:structuredClone(s.state.velocity),
     sampledPatchId:d.footSupport?.id??null,radial:structuredClone(avatar.motion?.radialContacts??null),
     flight:structuredClone(avatar.motion?.flight??null),visible:avatar.visible,cameraOccluded:avatar.cameraOccluded});
    if(data.frames.length>=12000||now-data.started>180000){data.bounded=true;data.running=false;return;}
    requestAnimationFrame(frame);
   };requestAnimationFrame(frame);
  },name);
 };
 const stage=async name=>page.evaluate(name=>{if(window.__tvContactQA)window.__tvContactQA.stage=name;},name);
 const stop=async({required=false}={})=>{
  if(!tracing)return null;tracing=false;
  const trace=await page.evaluate(()=>{const d=window.__tvContactQA;if(!d)return null;d.running=false;delete window.__tvContactQA;return d;});
  if(!trace)return null;
  delete trace.running;delete trace.started;
  const filename=`contact-${trace.name}.json`;await writeFile(resolve(output,filename),JSON.stringify(trace));
  const summary=summarizeContactTrace(trace);report.contactQA.traces.push({name:trace.name,file:filename,summary});
  if(summary.bounded)finding(trace.name+': contact trace reached its explicit bound.');
  if(summary.airborneActiveMs>100)finding(trace.name+': radial contacts remained active during flight for more than 100 ms.');
  if(summary.independent.mismatches.length)finding(trace.name+': actual sole gaps disagree with matched source triangles by more than 2 mm.');
  for(const [side,f]of Object.entries(summary.feet)){
   if(f.longestPenetrationMs>100)finding(`${trace.name}/${side}: >3 cm sole penetration persisted for ${Math.round(f.longestPenetrationMs)} ms.`);
   if(f.longestUnsupportedGapMs>100)finding(`${trace.name}/${side}: settled sole gap >8 cm persisted for ${Math.round(f.longestUnsupportedGapMs)} ms.`);
   if(f.stationaryP95AbsMinGap!==null&&f.stationaryP95AbsMinGap>.04)finding(`${trace.name}/${side}: settled stationary p95 minimum sole gap exceeded 4 cm (${f.stationaryP95AbsMinGap.toFixed(4)} m).`);
   if(f.maximumSettledDrift!==null&&f.maximumSettledDrift>.03)finding(`${trace.name}/${side}: same-lock corrected sole drift exceeded 3 cm (${f.maximumSettledDrift.toFixed(4)} m).`);
   if(required&&!f.eligibleWindows.length)report.contactQA.limits.push(`${trace.name}/${side}: no >=100 ms stable fully weighted contact window.`);
  }
  if(required&&!summary.independent.samples)report.contactQA.limits.push(trace.name+': no matched independent source-triangle sole samples.');
  for(const [label,feet] of Object.entries(summary.stages))if(label.endsWith('-idle'))for(const [side,f]of Object.entries(feet)){
   if(f.maximumWindowMs<100){
    const message=`${trace.name}/${label}/${side}: no >=100 ms stable fully weighted contact window (${f.eligibleFrames}/${f.frames} eligible frames).`;
    report.contactQA.limits.push(message);
   }
  }
  await save();return summary;
 };
 page.on('websocket',socket=>{
  if(new URL(socket.url()).pathname!=='/realms/universe/socket')return;
  socket.on('framereceived',event=>{try{if(JSON.parse(String(event.payload)).type==='controller')lastActiveSeq=0;}catch{}});
  socket.on('framesent',event=>{try{
   const v=JSON.parse(String(event.payload)),input=v.command?.input;if(v.type!=='universe_input'||!input)return;
   if(['throttle','yaw','pitch','strafe','lift'].some(k=>input[k]!==0))lastActiveSeq=Math.max(lastActiveSeq,v.seq);
   if(report.contactQA.inputRequests.length<2048)report.contactQA.inputRequests.push({at:Date.now(),seq:v.seq,transport:'owner-websocket',input:{throttle:input.throttle,yaw:input.yaw,pitch:input.pitch,strafe:input.strafe,lift:input.lift,brake:input.brake}});
  }catch{}});
 });
 const release=async()=>{await Promise.all(['w','s','a','d','q','e','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Escape'].map(key=>page.keyboard.up(key)));};
 // A keyup is local input, not a host acknowledgment. The host may still apply
 // its last movement sample for six ticks. Observe the ordinary Brake request,
 // then distinct authoritative snapshots, before judging a waypoint or posing.
 const stopGround=async(label,priorView)=>{
  const before=priorView??await read(),began=Date.now();
  const minimumSeq=Math.max(before.lastSeq??0,lastActiveSeq,before.inputTransport?.lastSent??0);
  const record={label,control:'Escape',before:{position:before.state.position,tick:before.state.tick,lastSeq:before.lastSeq},minimumSeq,observations:[]};report.contactQA.stops.push(record);
  if(before.state.mode!=='surface')throw Error('Ground stop requested outside the surface');
  const streamed=before.inputTransport?.mode==='stream';
  const generation=before.inputTransport?.generation;
  const responsePromise=streamed?null:page.waitForResponse(response=>{
   if(new URL(response.url()).pathname!=='/realms/universe/command'||response.request().method()!=='POST')return false;
   try{return isNeutralGroundRequest(response.request().postDataJSON(),Math.max(minimumSeq,lastActiveSeq));}catch{return false;}
  },{timeout:4500});
  // Attach rejection handling immediately; a failed click must not leave an
  // unhandled pending observer. This never submits a direct command itself.
  const pending=responsePromise?.then(response=>({response}),error=>({error}));
  // Documented Escape invokes the same Brake handler immediately, without a
  // mouse actionability wait while W/turn remains held. It clears game keys;
  // release Playwright's physical keys afterward, including Escape itself.
  await page.keyboard.down('Escape');await release();let seq;
  if(streamed){
   while(Date.now()-began<4500){
    const view=await read();if(view.inputTransport?.generation!==generation)throw Error('Ground stop owner changed');
    const ack=durableGroundStop(view,Math.max(minimumSeq,lastActiveSeq));
    if(ack){seq=ack.seq;record.ack={seq,brake:ack.input.brake,lastActiveSeq,ok:true,
     transport:'owner-websocket',phase:'durable',lastSeq:view.lastSeq,durableSeq:view.inputTransport.lastDurable};break;}
    await page.waitForTimeout(25);
   }
   if(!seq)throw Error('Ordinary ground stop received no newer durable owner-stream receipt');
  }else{
   const observed=await pending;
   if(observed.error)throw Error('Ordinary ground stop received no neutral-command response: '+observed.error);
   const response=observed.response,body=await response.json(),request=response.request().postDataJSON();seq=request.seq;
   record.ack={seq,brake:request.command.input.brake,lastActiveSeq,status:response.status(),ok:body.ok,revision:body.snapshot?.revision,lastSeq:body.snapshot?.lastSeq};
   if(!isNeutralGroundRequest(request,Math.max(minimumSeq,lastActiveSeq))||!response.ok()||body.ok!==true||!Number.isSafeInteger(body.snapshot?.lastSeq)||body.snapshot.lastSeq<seq)throw Error('Host did not accept the ordinary neutral ground command');
  }
  let anchor=null,since=0,lastTick=null,ticks=0;
  while(Date.now()-began<6500){
   const view=await read();if(view.state.mode!=='surface')throw Error('Ground stop changed travel mode');
   if(streamed&&view.inputTransport?.generation!==generation)throw Error('Ground stop owner changed');
   record.observations.push({elapsed:Date.now()-began,position:view.state.position,tick:view.state.tick,lastSeq:view.lastSeq,revision:view.revision});
   if(view.lastSeq>=seq){
    if(!anchor||len(sub(view.state.position,anchor))>.015){anchor={...view.state.position};since=Date.now();ticks=0;lastTick=null;}
    if(view.state.tick!==lastTick){ticks++;lastTick=view.state.tick;}
    if(ticks>=3&&Date.now()-since>=300){record.settled={position:view.state.position,chart:contactChartPosition(view),elapsed:Date.now()-began,ticks,lastSeq:view.lastSeq};return view;}
   }
   await page.waitForTimeout(100);
  }
  throw Error('Ground position did not settle after the acknowledged neutral command');
 };
 const drive=async(target,label)=>{
  await stage(label);const began=Date.now(),initial=await read(),start=contactChartPosition(initial),attempt={label,target,start,observations:[]};report.contactQA.route.push(attempt);
  let progress={bestDistance:Infinity,bestHeading:Infinity,lastProgress:Date.now(),phase:null},settled=false,walkTailMs=0;
  try{
   while(Date.now()-began<18000){
    const view=await read(),p=contactChartPosition(view),remaining=Math.hypot(p.x-target.x,p.z-target.z);
    const {up,desired}=targetDirection(view,target),forward=norm(sub(view.state.forward,mul(up,dot(view.state.forward,up))));
    const headingError=Math.atan2(dot(up,cross(forward,desired)),dot(forward,desired));
    const walk=groundWalkDirection(forward,up,desired);
    attempt.observations.push({elapsed:Date.now()-began,position:p,remaining,heading:view.state.forward,headingError,walk,mode:view.state.mode});
    if(view.state.mode!=='surface')throw Error('Ground route left the surface');
    if(remaining<.65){
     const stopped=settled?view:await stopGround(label+'-candidate'),final=contactChartPosition(stopped);
     settled=true;attempt.candidate={position:final,remaining:Math.hypot(final.x-target.x,final.z-target.z)};
     if(attempt.candidate.remaining<.65){attempt.reached=final;return;}
     continue;
    }
    // This driver never waits for exact yaw. Only real distance progress keeps
    // its stall timer alive; angular-only evidence remains separately tested.
    progress=groundRouteProgress(progress,remaining,0,Date.now());
    if(Date.now()-progress.lastProgress>4500)throw Error('Ground waypoint made no linear or angular progress for 4.5 seconds');
    const requestedWalkMs=groundWalkPulse(remaining*walk.alignment,walkTailMs);
    const physical=await holdGroundKeys(page,walk.keys,requestedWalkMs);
    const stopped=await stopGround(label+'-pulse',view);settled=true;
    const actual=len(sub(stopped.state.position,view.state.position)),measuredTail=clamp(actual/7*1000-requestedWalkMs,0,300);
    walkTailMs=walkTailMs*.4+measuredTail*.6;
    const requests=report.contactQA.inputRequests.filter(r=>r.seq>(view.lastSeq??0)&&r.at>=physical.startedAt);
    attempt.walks??=[];attempt.walks.push({requestedMs:requestedWalkMs,physical,metres:actual,keys:walk.keys,estimatedTailMs:walkTailMs,
     requestSeqs:requests.map(r=>r.seq),completeChordSent:requests.some(r=>r.input.throttle===walk.throttle&&r.input.strafe===walk.strafe&&r.input.yaw===0)});
   }
   throw Error('Ground waypoint exceeded the 18-second bound');
  }finally{await release();attempt.elapsed=Date.now()-began;await save();}
 };
 const soleClip=async name=>{
  const v=await read(),r=v.avatar.motion?.radialContacts,c=v.camera;
  const points=r?.feet?.flatMap(f=>f.solePoints)??[];if(!points.length)return;
  const forward=norm(sub(c.worldTarget,c.worldPosition)),right=norm(cross(forward,c.up)),up=cross(right,forward),focal=450/Math.tan(c.fov/2);
  const projected=points.map(p=>{const d=sub(p,c.worldPosition),z=dot(d,forward);return{x:720+dot(d,right)/z*focal,y:450-dot(d,up)/z*focal,z};});
  const fits=projected.every(p=>p.z>.05&&p.x>15&&p.x<1425&&p.y>15&&p.y<830);
  report.contactQA.framing??=[];report.contactQA.framing.push({name:name+'-sole-framing',sourceCapture:name,actualSkinVertices:points.length,projected,groundMarginPixels:40,fits});
  if(!fits){report.contactQA.limits.push(name+': sole footprint cannot be cropped with ground margin inside the playfield.');return;}
  const x=Math.floor(Math.max(0,Math.min(...projected.map(p=>p.x))-70)),y=Math.floor(Math.max(0,Math.min(...projected.map(p=>p.y))-70));
  const x1=Math.ceil(Math.min(1440,Math.max(...projected.map(p=>p.x))+70)),y1=Math.ceil(Math.min(840,Math.max(...projected.map(p=>p.y))+65));
  const detailName=name+'-soles',clip={x,y,width:x1-x,height:y1-y};
  await page.screenshot({path:resolve(output,detailName+'.png'),clip});report.details.push({name:detailName,sourceCapture:name,actualSkinVertices:points.length,clip});
 };
 const idleViews=async label=>{
  await stage(label+'-idle');await recenter();await page.waitForTimeout(500);
  await orbit(Math.PI/2);await capture('contact-'+label+'-side');await soleClip('contact-'+label+'-side');
  await orbit(Math.PI/2);await capture('contact-'+label+'-front');await soleClip('contact-'+label+'-front');
  await orbit(Math.PI);await recenter();
 };
 const groundRoute=async()=>{
  const initial=await read();check(initial.system.planets[0].radius===1600,'Contact route uses the documented 1600 m home chart');
  await start('ground-route');
  try{
   await zoom(-1500);await idleViews('flat');
   await drive({x:11312.5,z:3128},'flat-forward');
   await drive({x:11312.5,z:3133},'step-down');await idleViews('step');
   await drive({x:11312.5,z:3138},'slope-forward');await drive({x:11316.5,z:3138},'slope-side');await idleViews('slope');
   await drive({x:11312.5,z:3138},'slope-return');await drive({x:11312.5,z:3128},'step-up');
   await drive({x:11312.5,z:3113.7},'flat-return');await idleViews('returned-flat');
   await zoom(600);await drive({x:11312.5,z:3095},'clear-departure');await recenter();await stopGround('departure-final');
   const end=await read();report.contactQA.departure={chart:contactChartPosition(end),position:end.state.position,mana:end.campaign.flight.manaAvailable};
   check(Math.hypot(report.contactQA.departure.chart.x-11312.5,report.contactQA.departure.chart.z-3095)<1,'Ground contact route returns to the previously verified clear departure street');
  }catch(error){
   report.contactQA.routeFailure=String(error);await release();try{await stopGround('route-failure');}catch(stopError){report.contactQA.stopFailure=String(stopError);}await save();throw error;
  }finally{await stop({required:true});}
 };
 return{start,stage,stop,groundRoute,soleClip,release,stopGround,drive};
}
