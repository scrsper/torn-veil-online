import {describe,expect,it} from 'vitest';
// @ts-expect-error Maintained browser QA helpers are native Node ES modules.
import {httpFailureEvidence,recoveredCrossingBackpressure,recordInputReceipts} from '../../scripts/world/presentation-network-qa.mjs';

describe('strict crossing backpressure evidence',()=>{
 it('counts streamed gameplay for camera-only checks without recording owner tokens',()=>{
  const sockets:Record<string,Function>={},frames:Record<string,Function>={};
  const report:any={commands:{}};
  recordInputReceipts({on:(event:string,callback:Function)=>{sockets[event]=callback;}},report);
  sockets.websocket({url:()=> 'ws://127.0.0.1:7534/realms/universe/socket',on:(event:string,callback:Function)=>{frames[event]=callback;}});
  const send=(value:unknown)=>frames.framesent({payload:JSON.stringify(value)});
  send({type:'save'});send({type:'universe_input',sessionId:'private-owner',command:{type:'input'},seq:1});
  expect(report.commands).toEqual({input:1});
  frames.framereceived({payload:JSON.stringify({type:'universe_input_receipt',sessionId:'private-owner',seq:1,phase:'durable',ok:true})});
  expect(report.inputReceipts[0]).toMatchObject({seq:1,phase:'durable',ok:true});
  expect(JSON.stringify(report)).not.toContain('private-owner');
  frames.framereceived({payload:JSON.stringify({type:'universe_input_receipt',seq:2,phase:'failed',ok:false,error:'Saving failed'})});
  expect(report.controlFailures).toHaveLength(1);
 });
 it('captures the exact header synchronously even when reload prevents body retrieval',()=>{
  const response={url:()=> 'http://127.0.0.1:7533/realms/universe',status:()=>503,
   request:()=>({method:()=> 'GET'}),headers:()=>({'x-tv-universe-condition':'saving-crossing'}),
   json:()=>{throw Error('Response body no longer available after reload');}};
  const entry=httpFailureEvidence(response,100);
  expect(entry.condition).toBe('saving-crossing');
  expect(()=>response.json()).toThrow('after reload');
  entry.bodyReadFailure={kind:'Error',reason:'response-body-unavailable'};
  expect(recoveredCrossingBackpressure(entry,200)).toBe(true);
 });
 it('retains compatibility with the exact body reason and a later successful GET',()=>{
  expect(recoveredCrossingBackpressure({status:503,path:'/realms/universe',method:'GET',at:100,
   reason:'Saving the crossing. Try again shortly.'},200)).toBe(true);
 });
 it('rejects unmarked, unrecovered, wrong-status, owner, command, and asset failures',()=>{
  const base={status:503,path:'/realms/universe',method:'GET',at:100,condition:'saving-crossing'};
  for(const override of [
   {condition:null},{condition:'Saving-crossing'},{condition:'saving-crossing ',reason:'Server busy'},
   {condition:null,reason:'Saving the crossing'},
   {status:409},{status:403},{path:'/realms/universe/command',method:'POST'},
   {path:'/realms/universe',method:'POST'},{path:'/atlas/models/a.glb'},
  ])expect(recoveredCrossingBackpressure({...base,...override},200)).toBe(false);
  for(const lastSuccess of [undefined,null,NaN,99,100])expect(recoveredCrossingBackpressure(base,lastSuccess)).toBe(false);
 });
});
