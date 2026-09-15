import { describe, expect, it } from 'vitest';
import { ControllerLease } from '../src/bridge/controllerLease';

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
});
