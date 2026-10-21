import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error The maintained browser harness is a native Node ES module.
import {createContactQA, summarizeContactTrace, groundRouteProgress, groundTurnPulse, groundWalkPulse, groundWalkDirection, holdGroundKeys, durableGroundStop, contactChartPosition, isNeutralGroundRequest} from '../../scripts/world/presentation-contact-qa.mjs';

afterEach(()=>vi.restoreAllMocks());

it('requires a newer durable neutral stream receipt, matching input, and an observed snapshot',()=>{
 const input={throttle:0,strafe:0,yaw:0,pitch:0,lift:0,brake:true};
 const view={lastSeq:5,inputTransport:{mode:'stream',lastReceived:5,lastDurable:5,lastDurableInput:{seq:5,input}}};
 expect(durableGroundStop(view,4)).toEqual({seq:5,input});
 expect(durableGroundStop(view,5)).toBeNull();
 for(const change of [{lastDurable:4},{lastReceived:4},{failure:'saving failed'},
  {lastDurableInput:{seq:5,input:{...input,throttle:1}}},{mode:'http'}])
  expect(durableGroundStop({...view,inputTransport:{...view.inputTransport,...change}},4)).toBeNull();
 expect(durableGroundStop({...view,lastSeq:4},4)).toBeNull();
});

it('waits through a provisional stream receipt and still measures stable distinct host ticks',async()=>{
 let now=0;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const neutral={throttle:0,strafe:0,yaw:0,pitch:0,lift:0,brake:true};
 const read=async()=>({lastSeq:now?5:4,revision:Math.floor(now/50),system:{planets:[{center:{x:0,y:0,z:0},radius:1600}]},
  state:{mode:'surface',tick:Math.floor(now/50),position:{x:0,y:500,z:1500}},
  inputTransport:{mode:'stream',generation:1,lastSent:now?5:4,lastReceived:now?5:4,
   lastDurable:now>=120?5:4,lastDurableInput:{seq:now>=120?5:4,input:neutral}}});
 const page={on:()=>{},keyboard:{down:async()=>{now=1;},up:async()=>{}},
  waitForTimeout:async(ms:number)=>{now+=ms;},waitForResponse:()=>{throw Error('Stream stop must not wait for HTTP');}};
 const report:any={},noop=async()=>{};
 const qa=createContactQA({page,report,read,save:noop,check:noop,orbit:noop,zoom:noop,recenter:noop});
 await qa.stopGround('stream-stop',await read());
 expect(report.contactQA.stops[0].ack).toMatchObject({seq:5,phase:'durable',ok:true});
 expect(now).toBeGreaterThanOrEqual(420);expect(report.contactQA.stops[0].settled.ticks).toBeGreaterThanOrEqual(3);
});

describe('ordinary ground stop evidence',()=>{
  function fixture(accepted=true,brake=true){
    let now=0, clicked=false;
    vi.spyOn(Date,'now').mockImplementation(()=>now);
    const response={url:()=> 'http://127.0.0.1:7533/realms/universe/command',ok:()=>accepted,status:()=>accepted?200:409,
      request:()=>({method:()=> 'POST',postDataJSON:()=>({seq:7,command:{type:'input',input:{throttle:0,yaw:0,pitch:0,strafe:0,lift:0,brake}}})}),
      json:async()=>({ok:accepted,snapshot:{lastSeq:7,revision:8}})};
    const page={on:()=>{},keyboard:{down:async(key:string)=>{expect(key).toBe('Escape');clicked=true;},up:async()=>{expect(clicked,'Ordinary Escape must clear game input before keyboard-up round trips').toBe(true);}},
      waitForResponse:async(predicate:(r:typeof response)=>boolean)=>{expect(predicate(response)).toBe(true);return response;},
      waitForTimeout:async(ms:number)=>{now+=ms;}};
    const read=async()=>({lastSeq:clicked&&now>=400?7:6,revision:Math.floor(now/100),
      system:{planets:[{center:{x:0,y:0,z:0},radius:1600}]},
      state:{mode:'surface',tick:Math.floor(now/100),position:{x:Math.min(now,400)/1000,y:500,z:1500}}});
    const report:any={};const noOp=async()=>{};
    return{qa:createContactQA({page,report,read,save:noOp,check:noOp,orbit:noOp,zoom:noOp,recenter:noOp}),report,time:()=>now};
  }
  it('ignores stale moving snapshots after key release until the neutral sequence and stable distinct ticks arrive',async()=>{
    const f=fixture();const stopped=await f.qa.stopGround('regression');
    expect(f.time()).toBeGreaterThanOrEqual(700);
    expect(stopped.lastSeq).toBe(7);
    expect(f.report.contactQA.stops[0].settled.position.x).toBe(.4);
    expect(f.report.contactQA.stops[0].observations.some((s:any)=>s.lastSeq===6)).toBe(true);
    expect(f.report.contactQA.stops[0].settled.ticks).toBeGreaterThanOrEqual(3);
  });
  it('rejects a refused neutral command instead of accepting an apparently still position',async()=>{
    const f=fixture(false);
    await expect(f.qa.stopGround('refused')).rejects.toThrow('Host did not accept');
    expect(f.report.contactQA.stops[0].settled).toBeUndefined();
  });
  it('accepts and records a newer coalesced brake-false neutral response with the same stop evidence',async()=>{
    const f=fixture(true,false);await f.qa.stopGround('coalesced');
    expect(f.time()).toBeGreaterThanOrEqual(700);
    expect(f.report.contactQA.stops[0].ack.brake).toBe(false);
  });
});

it('requires neutral axes and a sequence newer than the latest actually sent active input',()=>{
  const command={type:'input',input:{throttle:0,yaw:0,pitch:0,strafe:0,lift:0,brake:false}};
  expect(isNeutralGroundRequest({seq:13,command},12)).toBe(true);
  expect(isNeutralGroundRequest({seq:12,command},12)).toBe(false);
  expect(isNeutralGroundRequest({seq:11,command},12)).toBe(false);
  for(const key of ['throttle','yaw','pitch','strafe','lift'])expect(isNeutralGroundRequest({seq:13,command:{...command,input:{...command.input,[key]:.01}}},12)).toBe(false);
  expect(isNeutralGroundRequest({seq:13,command:{...command,input:{...command.input,brake:undefined}}},12)).toBe(false);
});

it('releases a physical chord before a delayed full-axis request, then still requires the newer accepted neutral and stable ticks',async()=>{
  let now=0,seq=0,escapeAt=-1;
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  const held=new Set<string>(),listeners:((r:any)=>void)[]=[],sent:any[]=[];
  let responded:{predicate:(r:any)=>boolean;resolve:(r:any)=>void}|null=null;
  const emit=()=>{
    const input={throttle:Number(held.has('w')),strafe:held.has('a')?-1:0,yaw:0,pitch:0,lift:0,brake:!held.size};
    const data={seq:++seq,command:{type:'input',input}};
    const request={url:()=> 'http://127.0.0.1:7533/realms/universe/command',method:()=> 'POST',postDataJSON:()=>data};
    sent.push(data);listeners.forEach(f=>f(request));
    const response={url:request.url,request:()=>request,ok:()=>true,status:()=>200,json:async()=>({ok:true,snapshot:{lastSeq:seq,revision:2}})};
    if(responded?.predicate(response)){responded.resolve(response);responded=null;}
  };
  const page={on:(_name:string,f:(r:any)=>void)=>listeners.push(f),
    keyboard:{down:async(key:string)=>{
      if(key==='Escape'){
        escapeAt=now;held.clear();
        // First W response arrives at100ms. The pending WA chord has already
        // been coalesced into ordinary Escape's neutral input by then.
        now=100;emit();
      }else{held.add(key);if(!seq)emit();}
    },up:async(key:string)=>{held.delete(key);}},
    waitForRequest:()=>{throw Error('Diagnostic requests must not schedule physical release');},
    waitForResponse:(predicate:(r:any)=>boolean)=>new Promise(resolve=>{responded={predicate,resolve};}),
    waitForTimeout:async(ms:number)=>{now+=ms;}};
  const read=async()=>({lastSeq:seq,revision:Math.floor(now/50),system:{planets:[{center:{x:0,y:0,z:0},radius:1600}]},
    state:{mode:'surface',tick:Math.floor(now/50),position:{x:Math.min(now,100)*.007,y:500,z:1500}}});
  const report:any={},noop=async()=>{};
  const qa=createContactQA({page,report,read,save:noop,check:noop,orbit:noop,zoom:noop,recenter:noop});
  const before=await read(),physical=await holdGroundKeys(page,['w','a'],20);
  const stopped=await qa.stopGround('delayed-chord',before);
  expect(physical.physicalHoldMs).toBe(20);expect(escapeAt).toBe(20);
  expect(sent.map(p=>[p.command.input.throttle,p.command.input.strafe])).toEqual([[1,0],[0,0]]);
  expect(stopped.lastSeq).toBe(2);expect(stopped.state.position.x).toBeCloseTo(.7);
  expect(report.contactQA.stops[0].ack.lastActiveSeq).toBe(1);
  expect(report.contactQA.stops[0].settled.ticks).toBeGreaterThanOrEqual(3);
  expect(now).toBeGreaterThanOrEqual(400);
});

it('starts the requested hold after physical keydown completion without adding a request wait',async()=>{
  let now=0;vi.spyOn(Date,'now').mockImplementation(()=>now);
  const page={keyboard:{down:async()=>{now+=6;}},waitForTimeout:async(ms:number)=>{now+=ms;},
    waitForRequest:()=>{throw Error('No network wait is permitted during the pulse');}};
  const physical=await holdGroundKeys(page,['s','d'],20);
  expect(physical).toEqual({requestedMs:20,startedAt:0,keydownCompleteAt:12,releaseRequestedAt:32,physicalHoldMs:32,afterKeydownMs:20});
});

it('recognizes the recorded180-to30degree turn progress without relaxing linear stall or route bounds',()=>{
  let progress={bestDistance:Infinity,bestHeading:Infinity,lastProgress:0,phase:null};
  for(const [now,angle]of [[0,180],[1289,134],[2534,82],[3763,30],[5048,-21]]){
    progress=groundRouteProgress(progress,14.3,angle*Math.PI/180,now);
    expect(now-progress.lastProgress).toBeLessThan(4500);
  }
  const lastProgress=progress.lastProgress;
  for(const [now,angle]of [[6500,21],[8000,-21],[10000,21]])progress=groundRouteProgress(progress,14.3,angle*Math.PI/180,now);
  expect(progress.lastProgress).toBe(lastProgress);
  expect(10000-progress.lastProgress).toBeGreaterThan(4500);
  expect(groundTurnPulse(30*Math.PI/180,180)).toBeLessThan(100);
  expect(groundTurnPulse(Math.PI,180)).toBe(260);
});

it('accounts for observed walking tail before the recorded3.86m approach rather than overshooting the waypoint',()=>{
  let tail=0;
  for(const metres of [5.57,4.87])tail=tail*.4+Math.min(300,Math.max(0,metres/7*1000-550))*.6;
  const requested=groundWalkPulse(3.86,tail);
  expect(requested).toBeLessThan(350);
  // Replay the observed second pulse's latency using the new conservative
  // duration. The target tolerance remains the same0.65m, not enlarged.
  const observedTail=4.87/7*1000-550;
  expect(Math.abs(3.86-(requested+observedTail)/1000*7)).toBeLessThan(.65);
  expect(groundWalkPulse(1.02,tail)).toBe(20);
});

it('selects a positive-progress ordinary WASD direction for every target heading, including both recorded oscillation angles',()=>{
  for(const angle of [...Array.from({length:360},(_,i)=>i*Math.PI/180),.2136,-.14636]){
    const direction=groundWalkDirection({x:0,y:0,z:1},{x:0,y:1,z:0},{x:Math.sin(angle),y:0,z:Math.cos(angle)});
    expect(direction.alignment).toBeGreaterThanOrEqual(Math.cos(Math.PI/8)-1e-12);
    expect(direction.keys.length).toBeGreaterThanOrEqual(1);
    expect(direction.keys.every((k:string)=>['w','a','s','d'].includes(k))).toBe(true);
  }
});

/** Tiny deterministic surface host mock. The driver still operates only its
 * keyboard/response API; no live browser, save or canonical fixture is changed. */
function driveFixture(heading:number,blocked=false){
  let now=0,seq=0,tick=0;
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  type V={x:number;y:number;z:number};
  const dot=(a:V,b:V)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const norm=(a:V)=>{const d=Math.hypot(a.x,a.y,a.z);return{x:a.x/d,y:a.y/d,z:a.z/d};};
  const cross=(a:V,b:V)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
  const a=Math.PI/10+(3113.7-3092.5)/1600,radius=1609.0625;
  let position:V={x:0,y:Math.sin(a)*radius,z:Math.cos(a)*radius};
  let forward=norm({x:Math.sin(heading),y:Math.cos(a)*Math.cos(heading),z:-Math.sin(a)*Math.cos(heading)});
  const held=new Set<string>(),listeners:((r:any)=>void)[]=[],sent:any[]=[];
  let requested:{predicate:(r:any)=>boolean;resolve:(r:any)=>void}|null=null;
  let responded:{predicate:(r:any)=>boolean;resolve:(r:any)=>void}|null=null;
  const input=()=>({throttle:Number(held.has('w'))-Number(held.has('s')),strafe:Number(held.has('d'))-Number(held.has('a')),yaw:0,pitch:0,lift:0,brake:false});
  const advance=(ms:number)=>{
    now+=ms;tick+=Math.max(1,Math.ceil(ms/50));const i=input(),up=norm(position),right=cross(forward,up),scale=7*ms/1000/Math.max(1,Math.hypot(i.throttle,i.strafe));
    if(!blocked){const next=norm({x:position.x+(forward.x*i.throttle+right.x*i.strafe)*scale,y:position.y+(forward.y*i.throttle+right.y*i.strafe)*scale,z:position.z+(forward.z*i.throttle+right.z*i.strafe)*scale});position={x:next.x*radius,y:next.y*radius,z:next.z*radius};const d=dot(forward,next);forward=norm({x:forward.x-next.x*d,y:forward.y-next.y*d,z:forward.z-next.z*d});}
  };
  const emit=()=>{
    const data={seq:++seq,command:{type:'input',input:input()}},request={url:()=> 'http://127.0.0.1:7533/realms/universe/command',method:()=> 'POST',postDataJSON:()=>data};
    sent.push(data);listeners.forEach(f=>f(request));if(requested?.predicate(request)){requested.resolve(request);requested=null;}
    const response={url:request.url,request:()=>request,ok:()=>true,status:()=>200,json:async()=>({ok:true,snapshot:{lastSeq:data.seq,revision:tick}})};
    if(responded?.predicate(response)){responded.resolve(response);responded=null;}
  };
  const page={on:(_name:string,f:(r:any)=>void)=>listeners.push(f),evaluate:async()=>{},
    keyboard:{down:async(key:string)=>{if(key==='Escape'){advance(130);held.clear();emit();}else{held.add(key);emit();}},up:async(key:string)=>{held.delete(key);}},
    waitForRequest:(predicate:(r:any)=>boolean)=>new Promise(resolve=>{requested={predicate,resolve};}),
    waitForResponse:(predicate:(r:any)=>boolean)=>new Promise(resolve=>{responded={predicate,resolve};}),waitForTimeout:async(ms:number)=>advance(ms)};
  const read=async()=>({lastSeq:seq,revision:tick,system:{planets:[{center:{x:0,y:0,z:0},radius:1600}]},
    state:{mode:'surface',tick,position:{...position},forward:{...forward}}});
  const report:any={},noop=async()=>{};
  const qa=createContactQA({page,report,read,save:noop,check:noop,orbit:noop,zoom:noop,recenter:noop});
  return{qa,read,report,sent,time:()=>now};
}

it.each([0,Math.PI/2,Math.PI,.2136,-.14636])('reaches and acknowledges the strict waypoint from body heading%f despite130ms input tail',async heading=>{
  const f=driveFixture(heading);await f.qa.drive({x:11312.5,z:3128},'mock-waypoint');
  const end=contactChartPosition(await f.read());
  expect(Math.hypot(end.x-11312.5,end.z-3128)).toBeLessThan(.65);
  expect(f.time()).toBeLessThan(18000);
  expect(f.sent.every(p=>p.command.input.yaw===0)).toBe(true);
  expect(f.report.contactQA.stops.every((s:any)=>s.ack.ok&&s.settled.ticks>=3)).toBe(true);
});

it('fails a physically blocked mock route within the existing stall bound instead of claiming arrival',async()=>{
  const f=driveFixture(Math.PI,true);
  await expect(f.qa.drive({x:11312.5,z:3128},'blocked')).rejects.toThrow('no linear or angular progress');
  expect(f.time()).toBeGreaterThan(4500);expect(f.time()).toBeLessThan(6500);
  expect(f.report.contactQA.route[0].reached).toBeUndefined();
});

it('splits contact eligibility by actual stage even when a lock began during the prior stage',()=>{
  const foot=(side:string,lock:boolean)=>({side,contact:true,lock,lockId:1,weight:lock?1:0,releasing:false,
    signedGaps:[0],solePoints:[{x:0,y:0,z:0}],measuredVertices:12,support:{source:'source-triangles'},reason:null});
  const frames=[0,100,300,600].map(t=>({t,stage:t?'slope-idle':'slope-side',mode:'surface',
    radial:{active:true,reference:'home',up:{x:0,y:1,z:0},feet:[foot('l',false),foot('r',true)]}}));
  const result=summarizeContactTrace({frames,patches:{},bounded:false});
  expect(result.stages['slope-idle'].l.eligibleFrames).toBe(0);
  expect(result.stages['slope-idle'].l.maximumWindowMs).toBe(0);
  expect(result.stages['slope-idle'].r.eligibleFrames).toBe(3);
  expect(result.stages['slope-idle'].r.maximumWindowMs).toBe(500);
});
