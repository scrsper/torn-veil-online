import {afterEach,describe,expect,it,vi} from 'vitest';
import {UniverseInputStream} from '../../src/web/universe/inputStream';
import {UniverseHeldInput,UniverseCommandQueue} from '../../src/web/universe/input';
import {neutralInput,type TravelInput} from '../../src/sim/world/universe/travel';
import {RealmSession} from '../../src/sim/world/realms/session';
import {RealmRuntime} from '../../src/server/realmRuntime';
import {RealmUniverseApi,type UniverseInputReceipt} from '../../src/server/realmUniverseApi';
import {length,sub} from '../../src/sim/world/planet/planet';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {RealmJournal} from '../../src/server/realmJournal';

afterEach(()=>vi.useRealTimers());
const move={...neutralInput(),throttle:1};
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function client(){
  let session='owner-a';const sent:any[]=[],failures:Error[]=[];
  const stream=new UniverseInputStream(()=>session,value=>sent.push(value),error=>failures.push(error));
  const receipt=(seq:number,phase:UniverseInputReceipt['phase'],input:TravelInput=move)=>({
    type:'universe_input_receipt' as const,sessionId:session,seq,phase,ok:true,input});
  return{stream,sent,failures,receipt,change:()=>{stream.reset();session='owner-b';}};
}

describe('sequenced input received and durable boundaries',()=>{
  it('puts a key release on the ordered wire before a delayed first receipt',async()=>{
    const c=client();
    const queue=new UniverseCommandQueue(()=>true,async command=>command.type==='input'&&c.stream.admit(c.sent.length+1,command.input));
    queue.enqueue({type:'input',input:move});await settle();
    queue.enqueue({type:'input',input:neutralInput()});await settle();
    expect(c.sent.map(m=>m.command.input.throttle)).toEqual([1,0]);
    expect(c.stream.stats).toMatchObject({lastSent:2,lastReceived:0,lastDurable:0,pending:2});
    let saved=false;const barrier=c.stream.durable().then(()=>{saved=true;});
    c.stream.receive(c.receipt(1,'received'));await settle();expect(saved).toBe(false);
    c.stream.receive(c.receipt(2,'durable',neutralInput()));await barrier;expect(saved).toBe(true);
    expect(c.stream.admit(2,neutralInput())).toBe(false);expect(c.failures).toHaveLength(1);
  });
  it('replays received input, intervening host ticks and release exactly through the real journal worker',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'veil-input-stream-')),path=join(directory,'world.json');
    writeFileSync(path,new RealmSession(731).save());
    let journal=new RealmJournal(path,731,'input-stream-replay');
    let release!:()=>void;const disk=new Promise<void>(resolve=>{release=resolve;});
    try{
      await journal.ready;
      expect(journal.apply({type:'universe',command:{type:'explore',id:'stream-worker-enter',revision:0}}).value.ok).toBe(true);
      await journal.flush();const append=journal.store.append.bind(journal.store);
      journal.store.append=async entries=>{await disk;return append(entries);};
      const receipts:UniverseInputReceipt[]=[];
      const api=new RealmUniverseApi({session:()=>journal.runtime.session,token:()=> 'owner',ready:()=>true,
        apply:op=>journal.apply(op),persist:()=>journal.flush()},7534);
      const state=journal.runtime.session.world.universeExpedition!.state,start={...state.position};
      api.receiveInput('owner',{sessionId:'owner',seq:1,command:{type:'input',input:move}},r=>receipts.push(r));
      for(const now of [0,17,34])journal.apply({type:'step',now});
      api.receiveInput('owner',{sessionId:'owner',seq:2,command:{type:'input',input:neutralInput()}},r=>receipts.push(r));
      for(const now of [51,68,85])journal.apply({type:'step',now});
      expect(api.busy).toBe(false);expect(length(sub(state.position,start))).toBeGreaterThan(.1);
      expect(length(sub(state.position,start))).toBeLessThan(.75);
      expect(receipts.map(r=>r.phase)).toEqual(['received','received']);
      release();await journal.flush();await settle();
      expect(receipts.filter(r=>r.phase==='durable').map(r=>r.seq)).toEqual([1,2]);
      const canonical=()=>{const saved=JSON.parse(journal.runtime.session.save());delete saved.savedAt;return saved;};
      const expected=canonical(),control=journal.runtime.checkpoint();
      await journal.abort();journal=new RealmJournal(path,731,'input-stream-replay');await journal.ready;
      expect(canonical()).toEqual(expected);expect(journal.runtime.checkpoint()).toEqual(control);
      journal.apply({type:'disconnect'});
      expect(journal.runtime.session.world.universeExpedition!.control.input).toEqual(neutralInput());
      await journal.close();
    }finally{
      release();await journal.abort();assertTemp(directory);rmSync(directory,{recursive:true,force:true});
    }
  },30000);
  it('releases movement on receipt but keeps structural intent behind durability',async()=>{
    const c=client();const sent=c.stream.send(1,move);
    c.stream.receive(c.receipt(1,'received'));expect(await sent).toBe(true);
    let durable=false;const barrier=c.stream.durable().then(()=>{durable=true;});await settle();
    expect(durable).toBe(false);expect(c.stream.saving).toBe(true);
    const stop=c.stream.send(2,neutralInput());c.stream.receive(c.receipt(2,'received',neutralInput()));await stop;
    c.stream.receive(c.receipt(1,'durable'));await barrier;
    expect(c.stream.stats.lastDurable).toBe(1);expect(c.stream.saving).toBe(true);
    c.stream.receive(c.receipt(2,'durable',neutralInput()));await c.stream.durable();
    expect(c.stream.stats.lastDurableInput).toEqual({seq:2,input:neutralInput()});expect(c.stream.saving).toBe(false);
  });
  it('ignores stale ownership and unsolicited receipts and rejects mismatched input',async()=>{
    const c=client(),first=c.stream.send(1,move);
    expect(c.stream.receive({...c.receipt(1,'durable'),sessionId:'stale'})).toBe(false);
    expect(c.stream.receive(c.receipt(99,'durable'))).toBe(false);
    const rejected=expect(first).rejects.toThrow('does not match');
    c.stream.receive(c.receipt(1,'received',neutralInput()));await rejected;
    expect(c.failures).toHaveLength(1);expect(c.stream.stats.lastDurable).toBe(0);
  });
  it('does not promote a received input after failure, timeout or owner replacement',async()=>{
    vi.useFakeTimers();const c=client();
    let pending=c.stream.send(1,move);c.stream.receive(c.receipt(1,'received'));await pending;
    const barrier=expect(c.stream.durable()).rejects.toThrow('Saving failed');
    c.stream.receive({...c.receipt(1,'failed'),ok:false,error:'Saving failed'});await barrier;
    expect(c.stream.stats.lastDurable).toBe(0);
    c.change();pending=c.stream.send(1,move);c.stream.receive(c.receipt(1,'received'));await pending;
    const timed=expect(c.stream.durable()).rejects.toThrow('saving timed out');
    await vi.advanceTimersByTimeAsync(2501);await timed;expect(c.stream.stats.lastDurable).toBe(0);
    c.change();pending=c.stream.send(1,move);const reset=expect(pending).rejects.toThrow('connection changed');
    c.change();await reset;expect(c.stream.stats.pending).toBe(0);
  });

  it.each([14,29,64,94])('keeps a43ms physical tap within0.75m with120ms durability, phase%d',async phase=>{
    vi.useFakeTimers();vi.setSystemTime(0);
    const runtime=new RealmRuntime(new RealmSession(731));
    expect(runtime.apply({type:'universe',command:{type:'explore',id:'stream-tap-enter',revision:0}}).value.ok).toBe(true);
    const state=runtime.session.world.universeExpedition!.state,start={...state.position};
    const receipts:UniverseInputReceipt[]=[];let sequence=0;
    const api=new RealmUniverseApi({session:()=>runtime.session,token:()=> 'owner',ready:()=>true,
      apply:op=>runtime.apply(op),persist:()=>new Promise(resolve=>setTimeout(resolve,120))},7534);
    const stream=new UniverseInputStream(()=> 'owner',value=>{
      setTimeout(()=>api.receiveInput('owner',value,receipt=>{
        receipts.push(receipt);setTimeout(()=>stream.receive(receipt),7);
      }),7);
    },error=>{throw error;});
    const queue=new UniverseCommandQueue(()=>true,async command=>command.type==='input'
      ? stream.send(++sequence,command.input) : false);
    const held=new UniverseHeldInput(input=>queue.enqueue({type:'input',input}));
    const clock=setInterval(()=>runtime.apply({type:'step',now:Date.now()}),1000/60);
    try{
      await vi.advanceTimersByTimeAsync(phase);held.press('KeyW',false);
      await vi.advanceTimersByTimeAsync(43);held.release('KeyW',false);
      await vi.advanceTimersByTimeAsync(300);
      expect(length(sub(state.position,start))).toBeLessThanOrEqual(.75);
      expect(state.tick).toBeGreaterThan(3);expect(api.busy).toBe(false);
      const after={...state.position};await vi.advanceTimersByTimeAsync(300);
      expect(length(sub(state.position,after))).toBeLessThan(1e-8);
      expect(stream.stats.lastDurableInput?.input).toEqual(neutralInput());
      expect(receipts.filter(r=>r.phase==='received')).toHaveLength(2);
      expect(receipts.filter(r=>r.phase==='durable')).toHaveLength(2);
      if(phase===14)expect(length(sub(state.position,start))).toBeGreaterThan(.1);
    }finally{clearInterval(clock);stream.reset();}
  });
});

function assertTemp(directory:string){expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));}
