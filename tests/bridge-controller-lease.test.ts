import { describe, expect, it } from 'vitest';
import { ControllerLease } from '../src/bridge/controllerLease';
import { BridgeSession } from '../src/bridge/session';
import { makeItem } from '../src/sim/world/factory';

describe('native controller closing-handshake race',()=>{
  it('admits a fresh binding while the old socket is closing and ignores its late close',()=>{
    let releases=0;const lease=new ControllerLease<{readyState:number}>(()=>releases++);
    const old={readyState:1},replacement={readyState:1};
    expect(lease.claim(old)).toBe(true);
    old.readyState=2;
    expect(lease.claim(replacement)).toBe(true);
    expect(releases).toBe(1);
    expect(lease.release(old)).toBe(false);
    expect(lease.current).toBe(replacement);
    expect(releases).toBe(1);
    expect(lease.release(replacement)).toBe(true);
    expect(releases).toBe(2);
  });
  it('never steals a live controller and a rejected observer cannot release it',()=>{
    let releases=0;const lease=new ControllerLease<{readyState:number}>(()=>releases++);
    const first={readyState:1},observer={readyState:1};
    expect(lease.claim(first)).toBe(true);
    expect(lease.claim(observer)).toBe(false);
    expect(lease.release(observer)).toBe(false);
    expect(lease.current).toBe(first);
    expect(releases).toBe(0);
  });
  it('replacement rejects old movement and hand commands rather than replaying them',()=>{
    const session=new BridgeSession(123),lease=new ControllerLease<{readyState:number}>(()=>session.resetInput());
    const first={readyState:1},second={readyState:1};
    lease.claim(first);const old=session.bindInteraction('old');
    const body=session.world.primaryBody(session.world.playerId!)!,before={...body.pos};
    const item=makeItem(session.world,'bread','reconnect test',{pos:{...body.pos,x:body.pos.x+.5},quantity:1});
    const messages=[{type:'move',x:1,z:0,sprint:true},{type:'interact',interactionId:`take:${item.id}`}].map((command,i)=>({version:2,type:'command',...old,sequence:i+1,commandId:`old:${i+1}`,clientTimeMs:i,command}));
    for(const message of messages)expect(session.receiveCommand(message,0)?.status).toBe('received');
    first.readyState=2;expect(lease.claim(second)).toBe(true);
    const next=session.bindInteraction('new');expect(next.epoch).not.toBe(old.epoch);
    expect(lease.release(first)).toBe(false);
    for(const message of messages)expect(session.receiveCommand(message,1)?.result).toBe('binding_mismatch');
    session.stepInteraction(2);
    expect(body.pos).toEqual(before);expect(item.holderId).toBeNull();expect(item.pos).toBeDefined();
    expect(session.world.person(session.world.playerId!)!.inventory).not.toContain(item.id);
  });
});
