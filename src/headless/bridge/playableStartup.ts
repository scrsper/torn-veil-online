/** Real loopback startup acceptance. Native headers, bounded receive/assembly, chunk acks,
 * controller lifecycle and input/snapshots; no developer relocation or local physics. */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { MAX_PRESENTATION_MESSAGE_BYTES, MAX_PRESENTATION_TRANSFER_BYTES } from '../../bridge/streaming';
type Message=Record<string,any>;
const port=Number(process.env.TORN_VEIL_SMOKE_PORT??8798),root=process.cwd();
mkdirSync('.debug',{recursive:true});
const temp=mkdtempSync(resolve('.debug/startup-smoke-'));
const bridge=spawn(process.execPath,['--import','tsx','src/bridge/playableServer.ts'],{cwd:root,env:{...process.env,TORN_VEIL_PORT:String(port),TORN_VEIL_SAVE:resolve(temp,'world.json')},stdio:['ignore','pipe','pipe']});
let log='';bridge.stdout.on('data',d=>{log+=d;});bridge.stderr.on('data',d=>{log+=d;});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(predicate:()=>boolean,why:string,timeout=20000) {const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw new Error(why);await sleep(20);}}
const headers={'X-Torn-Veil-Client':'unreal','X-Torn-Veil-Region-Protocol':'2',Origin:'http://127.0.0.1'};
const checks:string[]=[];
function check(ok:unknown,name:string) {if(!ok)throw new Error(name);checks.push(name);}
let socket:WebSocket|undefined,input:ReturnType<typeof setInterval>|undefined;
try {
  await until(()=>log.includes('Torn Veil canonical bridge'),'server startup',60000);
  const start=performance.now(),messages:Message[]=[],snapshots:Message[]=[],regions:string[]=[],gaps:number[]=[];
  let center='',bytesMax=0,firstSnapshotMs=0,firstRegionMs=0,previousSnapshot=0,heldAck:(()=>void)|undefined,received=Buffer.alloc(0),failure='',sequence=0;
  socket=new WebSocket(`ws://127.0.0.1:${port}`,{headers,maxPayload:256*1024});
  socket.on('error',e=>{failure=e.message;});
  socket.on('message',raw=>{
    try {
      const bytes=Buffer.byteLength(raw as Buffer),m=JSON.parse(raw.toString()),now=performance.now();bytesMax=Math.max(bytesMax,bytes);
      if(messages.length<3)messages.push({type:m.type,bytes,ms:now-start,controls:m.controls});
      if(m.type==='hello') check(m.controls===true,'native controller assigned');
      if(m.type==='snapshot') {m.receivedMs=now-start;snapshots.push(m);if(!firstSnapshotMs)firstSnapshotMs=now-start;if(previousSnapshot)gaps.push(now-previousSnapshot);previousSnapshot=now;}
      if(m.type==='regions_state')center=m.center;
      if(m.type==='presentation_chunk') {
        check(bytes<=MAX_PRESENTATION_MESSAGE_BYTES,`wire bound ${m.transferId}:${m.index}`);
        received=Buffer.concat([received,Buffer.from(m.data,'base64')]);
        if(received.length>MAX_PRESENTATION_TRANSFER_BYTES)throw new Error('assembly exceeded native bound');
        if(m.index===m.count-1){const frame=JSON.parse(received.toString());for(const r of frame.regions){regions.push(r.id);if(!firstRegionMs)firstRegionMs=now-start;}received=Buffer.alloc(0);}
        const ack=()=>socket?.send(JSON.stringify({version:1,type:'presentation_ack',transferId:m.transferId,index:m.index}));
        if(!heldAck)heldAck=ack;else ack();
      }
    }catch(e){failure=String(e);}
  });
  await until(()=>!!failure||!!heldAck,'first chunk');if(failure)throw new Error(failure);
  check(messages.map(m=>m.type).join(',')==='hello,scene,snapshot','hello → scene → snapshot before presentation');
  check(firstSnapshotMs<1000,'first snapshot within 1s');
  const first=snapshots[0],body=first.bodies.find((b:Message)=>b.bodyId===first.controlledBodyId);
  check(body && body.entityId===first.playerId,'controlled Person/body binding');
  const position={...body.pos},snapshotsBeforeHold=snapshots.length;
  input=setInterval(()=>socket?.send(JSON.stringify({version:1,type:'move',sequence:++sequence,x:-1,z:0,sprint:false})),50);
  await sleep(850);
  check(snapshots.length>=snapshotsBeforeHold+4,'snapshots continue while renderer withholds acknowledgement');
  heldAck!();
  await until(()=>!!failure||(regions.length>=9 && snapshots.at(-1)!.bodies.find((b:Message)=>b.bodyId===first.controlledBodyId).pos.x<position.x-2),'progressive regions and canonical movement');
  if(failure)throw new Error(failure);
  clearInterval(input);input=undefined;socket.send(JSON.stringify({version:1,type:'move',sequence:++sequence,x:0,z:0}));
  check(regions[0]===center,'center region applied first');
  check(socket.readyState===WebSocket.OPEN,'connection remains open during streaming');
  check(Math.max(...gaps)<1500,'snapshot gaps stay inside native 1.5s freshness bound');
  const final=snapshots.at(-1)!,end=final.bodies.find((b:Message)=>b.bodyId===first.controlledBodyId).pos;
  check(final.tick>first.tick && final.ack>first.ack && end.x<position.x-2,'accepted movement advances canonical clock and snapshot position');
  const observer=new WebSocket(`ws://127.0.0.1:${port}`,{headers});let observerHello:Message|undefined;
  observer.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='hello')observerHello=m;});
  await until(()=>!!observerHello,'observer hello');check(observerHello!.controls===false,'second native client is observer');observer.close();
  const health=()=>fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json()) as Promise<Message>;
  socket.close(1000,'smoke controller end');await until(()=>socket!.readyState===WebSocket.CLOSED,'controller close');
  await sleep(100);check(!(await health()).controllerConnected,'controller ownership released');
  socket=new WebSocket(`ws://127.0.0.1:${port}`,{headers});let hello:Message|undefined,reconnect:Message|undefined;
  socket.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='hello')hello=m;if(m.type==='snapshot')reconnect=m;});
  await until(()=>!!reconnect,'reconnect snapshot');check(hello?.controls===true && reconnect!.controlledBodyId===first.controlledBodyId,'restart reconnect controls same canonical body');
  const report={passed:true,checks,initialMessages:messages,firstSnapshotMs,firstCenterRegionMs:firstRegionMs,regionOrder:regions,maxWireBytes:bytesMax,maxSnapshotGapMs:Math.max(...gaps),snapshotCount:snapshots.length,before:position,after:end,playerId:first.playerId,controlledBodyId:first.controlledBodyId,clockBefore:first.tick,clockAfter:final.tick};
  mkdirSync('docs/evidence/startup',{recursive:true});writeFileSync('docs/evidence/startup/live-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,checks:checks.length},null,2));
} finally {if(input)clearInterval(input);socket?.close();bridge.kill();writeFileSync(resolve(temp,'server.log'),log);}
