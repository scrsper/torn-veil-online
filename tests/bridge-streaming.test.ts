import { beforeAll, expect, test } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { MAX_PRESENTATION_MESSAGE_BYTES, RegionalTransport } from '../src/bridge/streaming';
import { projectRegion, projectRegionSteps } from '../src/bridge/regions';
import { B } from '../src/sim/physical/blocks';
let session:BridgeSession;
beforeAll(()=>{session=new BridgeSession(918271,{playable:true});},30000);

test('center first; bounded chunks, strict acknowledgements and independently applicable data',()=>{
  const stream=new RegionalTransport(),w=session.world,state=stream.state(w)!;
  expect(state.resident[0]).toBe(state.center);
  expect(state.resident).toHaveLength(9);
  const chunks:Buffer[]=[];
  for(let index=0;;index++) {
    const message=stream.next(w)!;
    expect(message.regionId).toBe(state.center);
    expect(message.index).toBe(index);
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThanOrEqual(MAX_PRESENTATION_MESSAGE_BYTES);
    chunks.push(Buffer.from(message.data,'base64'));
    expect(stream.next(w)).toBeNull(); // no queue grows behind a stalled client
    expect(stream.acknowledge(message.transferId+1,index)).toBe(false);
    expect(stream.acknowledge(message.transferId,index+1)).toBe(false);
    expect(stream.acknowledge(message.transferId,index)).toBe(true);
    if(index===message.count-1) break;
  }
  const frame=JSON.parse(Buffer.concat(chunks).toString());
  expect(frame.regions).toHaveLength(1);
  expect(frame.regions[0].id).toBe(state.center);
  expect(frame.dynamicRegion).toBe(state.center);
  expect(frame.dynamic.resources).toBeDefined();
  expect(stream.next(w)!.regionId).not.toBe(state.center);
});

test('residency/origin can advance while a chunk is awaiting acknowledgement',()=>{
  const w=session.world,body=w.primaryBody(w.playerId!)!,start={...body.pos},stream=new RegionalTransport();
  const state=stream.state(w)!;stream.next(w);
  // Explicit residency-only fixture. Live smoke uses actual movement intentions.
  body.pos.x+=1024;
  const shifted=stream.state(w)!;
  expect(shifted.origin.x).toBe(state.origin.x+1024);
  expect(shifted.unload).toContain(state.center);
  expect(shifted.resident[0]).toBe(shifted.center);
  expect(stream.next(w)).toBeNull();
  body.pos=start;
});

test('resumable region projection drains to the exact synchronous projection',()=>{
  const w=session.world, expected=projectRegion(w,4,2), steps=projectRegionSteps(w,4,2);
  let result=steps.next();
  while(!result.done) result=steps.next();
  expect(result.value).toEqual(expected);
});

test('partial projection is invalidated by unload or canonical region change',()=>{
  const w=session.world, stream=new RegionalTransport();
  const state=stream.state(w)!;
  stream.prepare(w,0.001);
  w.primaryBody(w.playerId!)!.pos.x += 1024;
  const shifted=stream.state(w)!;
  expect(shifted.unload).toContain(state.center);
  expect(stream.next(w,performance.now(),0)).toBeNull();
  const x=Math.floor(w.primaryBody(w.playerId!)!.pos.x), z=Math.floor(w.primaryBody(w.playerId!)!.pos.z);
  w.grid.set(x,1,z,B.Dirt);
  stream.state(w); // revision change must discard any in-flight job rather than publish stale data
  let replacement=null;
  for(let i=0;i<20&&!replacement;i++){stream.prepare(w,3);replacement=stream.next(w);if(replacement)stream.acknowledge(replacement.transferId,replacement.index);}
  expect(replacement).not.toBeNull();
});

test('zero preparation budget performs no work while chunk bounds remain enforced',()=>{
  const w=session.world, stream=new RegionalTransport();
  stream.state(w);
  stream.prepare(w,0);
  expect(stream.next(w,performance.now(),0)).toBeNull();
});
