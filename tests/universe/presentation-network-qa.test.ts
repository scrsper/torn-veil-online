import {describe,expect,it} from 'vitest';
// @ts-expect-error Maintained browser QA helpers are native Node ES modules.
import {httpFailureEvidence,recoveredCrossingBackpressure} from '../../scripts/world/presentation-network-qa.mjs';

describe('strict crossing backpressure evidence',()=>{
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
