import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error The maintained browser harness is a native Node ES module.
import {createContactQA, summarizeContactTrace, groundRouteProgress, groundTurnPulse, isNeutralGroundRequest} from '../../scripts/world/presentation-contact-qa.mjs';

afterEach(()=>vi.restoreAllMocks());

describe('ordinary ground stop evidence',()=>{
  function fixture(accepted=true,brake=true){
    let now=0, clicked=false;
    vi.spyOn(Date,'now').mockImplementation(()=>now);
    const response={url:()=> 'http://127.0.0.1:7533/realms/universe/command',ok:()=>accepted,status:()=>accepted?200:409,
      request:()=>({method:()=> 'POST',postDataJSON:()=>({seq:7,command:{type:'input',input:{throttle:0,yaw:0,pitch:0,strafe:0,lift:0,brake}}})}),
      json:async()=>({ok:accepted,snapshot:{lastSeq:7,revision:8}})};
    const page={on:()=>{},keyboard:{up:async()=>{expect(clicked,'UI Brake must clear game input before keyboard-up round trips').toBe(true);}},locator:()=>({click:async()=>{clicked=true;}}),
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
