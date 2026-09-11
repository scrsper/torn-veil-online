import {describe,it,expect} from 'vitest';
import {BridgeSession} from '../src/bridge/session';
import {INTERACTION_SPEC,predictMovement,windowQuery} from '../src/sim/physical/prediction';
import {movementState,collisionWindow} from '../src/sim/physical/interactionMovement';
import {makeItem} from '../src/sim/world/factory';
import {handInteractions} from '../src/sim/physical/hand';
import {FixedScheduler} from '../src/bridge/scheduler';
import type {InteractionCommand} from '../src/bridge/commands';

function fixture(){return new BridgeSession(123);}
function commands(s:BridgeSession){const binding=s.bindInteraction('test');let sequence=0;return {binding,send:(command:InteractionCommand,at=0)=>{const seq=++sequence;const envelope={version:2,type:'command',...binding,sequence:seq,commandId:`test:${seq}`,clientTimeMs:seq,command};return {envelope,receipt:s.receiveCommand(envelope,at)!};}};}
describe('real-time session integration',()=>{
  it('applies one confirmed movement interval with the same collision evaluator before any snapshot',()=>{
    const s=fixture(),c=commands(s),p=s.world.person(s.world.playerId)!,b=s.world.primaryBody(p.id)!;
    const state=movementState(s.world,p,b),input={type:'move' as const,x:1,z:.5,sprint:true};
    const expected=predictMovement(state,input,INTERACTION_SPEC.stepSeconds,windowQuery(collisionWindow(s.world,b)));
    expect(c.send(input).receipt.status).toBe('received');expect(b.pos).toEqual(state.pos);
    const receipts=s.stepInteraction(10);expect(receipts[0].status).toBe('applied');expect(b.pos).toEqual(expected.pos);
    expect(s.localState()?.ack).toBe(1);expect(s.world.physicalTime).toBeCloseTo(1/60);
  });
  it('commits a hand pickup once and resolves duplicate and contested attempts without extra items',()=>{
    const s=fixture(),c=commands(s),p=s.world.person(s.world.playerId)!,b=s.world.primaryBody(p.id)!;
    const item=makeItem(s.world,'bread','test bread',{pos:{...b.pos,x:b.pos.x+.6},quantity:2});
    const offer=handInteractions(s.sim,p).find(x=>x.id===`take:${item.id}`)!;expect(offer).toBeDefined();
    const sent=c.send({type:'interact',interactionId:offer.id});expect(p.inventory).not.toContain(item.id);
    expect(s.stepInteraction(10)[0].status).toBe('applied');expect(p.inventory.filter(x=>x===item.id)).toHaveLength(1);
    const events=s.world.events.length;expect(s.receiveCommand(sent.envelope,20)?.status).toBe('applied');s.stepInteraction(30);
    expect(s.world.events.length).toBe(events);expect(item.quantity).toBe(2);
    c.send({type:'interact',interactionId:offer.id},40);expect(s.stepInteraction(50)[0].status).toBe('rejected');expect(p.inventory.filter(x=>x===item.id)).toHaveLength(1);
  });
  it('rejects stale epochs and withdrawn manifestations; reconnect discards pending displacement',()=>{
    const s=fixture(),c=commands(s),b=s.world.primaryBody(s.world.playerId!)!,before={...b.pos};
    const sent=c.send({type:'move',x:1,z:0,sprint:false});s.resetInput();const next=commands(s);
    expect(next.binding.epoch).not.toBe(c.binding.epoch);expect(s.receiveCommand(sent.envelope,1)?.result).toBe('binding_mismatch');
    s.stepInteraction(2);expect(b.pos).toEqual(before);
    next.send({type:'move',x:1,z:0,sprint:false},3);b.present=false;
    expect(s.stepInteraction(4)[0].result).toBe('binding_mismatch');expect(b.pos).toEqual(before);
  });
  it('preserves fractional slow-system elapsed time across save/load without replaying pending commands',()=>{
    const s=fixture(),c=commands(s);s.stepInteraction(1);
    c.send({type:'move',x:1,z:0,sprint:false},2);
    const saved=s.save(),resumed=new BridgeSession(123,{save:saved});
    s.resetInput();commands(s);commands(resumed);
    for(let i=0;i<5;i++){s.stepInteraction(10+i);resumed.stepInteraction(10+i);}
    expect(resumed.world.physicalTime).toBeCloseTo(s.world.physicalTime);
    expect(resumed.sim.perceptionAccum).toBeCloseTo(s.sim.perceptionAccum);
    expect(resumed.world.primaryBody(resumed.world.playerId!)!.pos).toEqual(s.world.primaryBody(s.world.playerId!)!.pos);
  });
  it('retains scheduler debt with bounded catch-up instead of skipping world updates',()=>{
    const scheduler=new FixedScheduler(10,0,4);let steps=0;
    expect(scheduler.run(100,()=>steps++)).toBe(0);expect(steps).toBe(4);
    scheduler.run(100,()=>steps++);scheduler.run(100,()=>steps++);expect(steps).toBe(10);expect(scheduler.maxDebtMs).toBe(90);
  });
});
