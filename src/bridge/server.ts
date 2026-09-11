import { arrangeCombatArena } from './combatArena';
import { timedSend, transportTimings } from './transportTiming';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeSession } from './session';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRegion } from './regions';
import { RegionalTransport, REGION_PROTOCOL, MAX_PRESENTATION_MESSAGE_BYTES } from './streaming';
import { FixedScheduler } from './scheduler';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const loopDelay=monitorEventLoopDelay({resolution:10});loopDelay.enable();

const port = Number(process.env.TORN_VEIL_PORT ?? 8787);
const playable = process.env.TORN_VEIL_WORLD === 'playable';
const savePath = process.env.TORN_VEIL_SAVE ? resolve(process.env.TORN_VEIL_SAVE) : null;
const session = new BridgeSession(Number(process.env.TORN_VEIL_SEED ?? 918271), { playable, arena:process.env.TORN_VEIL_WORLD==='arena', ...(savePath && existsSync(savePath) ? { save: readFileSync(savePath, 'utf8') } : {}) });
function saveWorld(): void {
  if (!savePath) return;
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath + '.tmp', session.save()); renameSync(savePath + '.tmp', savePath);
}
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ ok: true, version: 1, regionProtocol:REGION_PROTOCOL, tick: session.world.physicalTime, settlements:session.world.settlements().length, residents:session.world.persons().filter(p=>p.id!==session.world.playerId).length, visibleNPCs:session.snapshot().bodies.filter(b=>b.entityId!==session.world.playerId).length, playerId:session.world.playerId, controlledBodyId:session.world.primaryBody(session.world.playerId!)?.id, controllerConnected:!!controller, projectRoot:process.cwd() }));
  else if (req.url === '/metrics') res.end(JSON.stringify({scheduler:{steps:scheduler.steps,overruns:scheduler.overruns,maxDebtMs:scheduler.maxDebtMs},eventLoopMs:{p50:loopDelay.percentile(50)/1e6,p95:loopDelay.percentile(95)/1e6,p99:loopDelay.percentile(99)/1e6},transportTimings,memory:process.memoryUsage()}));
  else if (process.env.TORN_VEIL_WORLD==='arena'&&req.method==='POST'&&req.url?.startsWith('/arena/')) {try {res.end(JSON.stringify(arrangeCombatArena(session,req.url.slice(7))));}catch(error){res.statusCode=400;res.end(JSON.stringify({error:String(error)}));}}
  else if (req.url === '/scene') res.end(JSON.stringify(session.scene()));
  else if (req.url?.startsWith('/region?')) {
    const q = new URL(req.url, 'http://127.0.0.1').searchParams;
    try { res.end(JSON.stringify(projectRegion(session.world, Number(q.get('x')), Number(q.get('z'))))); }
    catch { res.statusCode = 400; res.end('{"error":"invalid_region"}'); }
  }
  else if (req.url === '/debug/snapshot') res.end(JSON.stringify(session.developerSnapshot()));
  else if (req.url === '/snapshot') res.end(JSON.stringify(session.snapshot()));
  else { res.statusCode = 404; res.end('{}'); }
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });
const streams = new Map<WebSocket, RegionalTransport>();
let controller: WebSocket | null = null;
let connectionSerial=0;
// Loopback developer bridge. What must not happen is a web page driving the Traveler.
//
// The test used to be "the handshake carries no Origin header", on the reasoning that browsers
// always send one. Browsers do — but so does Unreal: its libwebsockets client sends
// `Origin: http://127.0.0.1`, so the real client was refused on every retry and Play showed an
// empty village. The livecheck could not see this, because the `ws` client it uses sends no
// Origin, so 33/33 passed against a bridge the actual client could never connect to.
//
// A browser cannot set a custom header on a WebSocket handshake — the WebSocket API gives a page
// no way to do it, unlike Origin which it sets automatically. So requiring one is a strictly
// stronger control than requiring Origin's absence, and it is one a native client can satisfy.
const NATIVE_CLIENT_HEADER = 'x-torn-veil-client';
wss.on('connection', (socket, request) => {
  if (request.headers[NATIVE_CLIENT_HEADER] !== 'unreal') {
    console.warn(`bridge: refused a client without the native-client header (origin: ${request.headers.origin ?? 'none'})`);
    socket.close(1008, 'Native local client only'); return;
  }
  if(session.world.geography && request.headers['x-torn-veil-region-protocol']!==String(REGION_PROTOCOL)) {
    console.warn('bridge: incompatible native regional client; rebuild with ./unreal/scripts/Launch.ps1');
    socket.close(1002,'Regional protocol 2 required; rebuild native client'); return;
  }
  const connection=++connectionSerial;
  const log=(event:Record<string,unknown>)=>console.log(JSON.stringify({bridge:connection,...event}));
  const controls = !controller;
  log({event:'connected',role:controls?'controller':'observer',origin:request.headers.origin??'none'});
  if (controls) { controller = socket; session.resetInput(); }
  const greeting=(message:object)=>{const payload=JSON.stringify(message);socket.send(payload);log({event:'startup_send',type:(message as {type:string}).type,bytes:Buffer.byteLength(payload),bufferedAmount:socket.bufferedAmount});};
  const realtime=controls&&request.headers['x-torn-veil-interaction-protocol']==='2';
  const interaction=realtime?session.bindInteraction(`local:${connection}`):undefined;
  greeting({ version: 1, type: 'hello', regionProtocol:REGION_PROTOCOL, controls, playerId: session.world.playerId,interaction });
  greeting(session.scene());
  const snapshot=session.snapshot();
  greeting(snapshot);
  log({event:'binding',playerId:snapshot.playerId,controlledBodyId:snapshot.controlledBodyId,bodyPresent:snapshot.bodies.some(b=>b.bodyId===snapshot.controlledBodyId)});
  const stream = new RegionalTransport(log); streams.set(socket, stream);
  let messages = 0, presentationMessages=0;
  let moving=false;
  const limit = setInterval(() => { messages = 0;presentationMessages=0; }, 1000);
  socket.on('message', bytes => {
    try {
      const message = JSON.parse(bytes.toString());
      if(message.type==='presentation_ack') {if(++presentationMessages>80){socket.close(1008,'Presentation rate limit');return;}stream.acknowledge(message.transferId,message.index);return;}
      if (++messages > (realtime?160:80)) { socket.close(1008, 'Rate limit'); return; }
      if (controller !== socket) return;
      if(message.type==='clock_probe') {socket.send(JSON.stringify({version:1,type:'clock_probe',clientTimeMs:message.clientTimeMs,serverTimeMs:performance.now()}));return;}
      if(message.type==='command') {const receipt=session.receiveCommand(message);if(receipt)timedSend(socket,receipt);wakeInteraction();return;}
      if(message.type==='move') {const active=!!(message.x||message.z);if(active!==moving){moving=active;log({event:active?'movement_started':'movement_stopped',sequence:message.sequence,playerId:session.world.playerId,pos:session.world.positionOf(session.world.playerId!)});}}
      if (message.type === 'save' && savePath) { saveWorld(); socket.send('{"version":1,"type":"result","result":"saved"}'); }
      else if (message.type === 'debug_inspect' && typeof message.personId === 'string') socket.send(JSON.stringify({ version: 1, type: 'debug_inspection', truth: session.game.debugTruth(message.personId), beliefs: session.game.beliefs('local', message.personId) }));
      else socket.send(JSON.stringify({ version: 1, type: 'result', ...session.intent(message) }));
    }
    catch { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: -1, result: 'invalid_json' })); }
  });
  socket.on('error', error => {log({event:'error',message:error.message});socket.close();});
  socket.on('close', (code,reason) => { clearInterval(limit); streams.delete(socket); if (controller === socket) { controller = null; session.resetInput(); } log({event:'closed',code,reason:reason.toString(),controllerReleased:controls}); });
});
let ticks = 0;
const scheduler=new FixedScheduler(1000/60,performance.now());
const update = () => {
  const receipts=session.stepInteraction();
  if(controller?.readyState===WebSocket.OPEN) {
    if(controller.bufferedAmount>256_000) {controller.close(1013,'Action backpressure');session.resetInput();}
    else {for(const receipt of receipts)timedSend(controller,receipt);const state=session.localState();if(state)controller.send(JSON.stringify(state));}
  }
  const combatFrame=session.combatFrame();
  if(combatFrame)for(const socket of wss.clients)if(socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<256_000)timedSend(socket,combatFrame);
  // Cooperative geometry batches follow urgent action traffic. A whole dense region can
  // cost hundreds of milliseconds; never spend that response window in one projection call.
  if(session.world.geography){const deadline=performance.now()+3;for(const [socket,stream]of streams){
    const budget=deadline-performance.now();if(budget<=0)break;
    if(socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<MAX_PRESENTATION_MESSAGE_BYTES)try{stream.prepare(session.world,budget);}
    catch(error){console.error('bridge presentation error',error);socket.close(1011,'Presentation bounds/generation failed; see bridge log');}
  }}
  if (++ticks % 6) return;
  const payload = JSON.stringify(session.snapshot());
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512_000) socket.send(payload);
  // Snapshots have already been sent. At most one acknowledged chunk per client per turn;
  // generation is lazy (one region), never a synchronous nine-region startup sweep.
  for (const [socket, stream] of streams) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_PRESENTATION_MESSAGE_BYTES) {
    try {
      const state=stream.state(session.world);if(state) socket.send(JSON.stringify(state));
      if(session.world.geography) {const chunk=stream.next(session.world,performance.now(),0);if(chunk) socket.send(JSON.stringify(chunk));}
    } catch(error) {console.error('bridge presentation error',error);socket.close(1011,'Presentation bounds/generation failed; see bridge log');}
  }
  if (ticks % 3600 === 0) saveWorld();
};
let timer:ReturnType<typeof setTimeout>;
let stopped=false;
const pump=()=>{if(stopped)return;scheduler.run(performance.now(),update);timer=setTimeout(pump,Math.max(1,Math.min(16,scheduler.remaining(performance.now()))));};
// An arriving urgent command can wake an already-due step instead of waiting for a
// quantized host timer. This never advances the canonical deadline or backdates input.
function wakeInteraction():void {if(scheduler.remaining(performance.now())<=0){clearTimeout(timer);pump();}}
timer=setTimeout(pump,1);
http.listen(port, '127.0.0.1', () => console.log(`Torn Veil canonical bridge ws://127.0.0.1:${port} | seed ${session.world.seed} | ${session.world.settlements().length} settlements | ${session.world.persons().filter(p=>p.id!==session.world.playerId).length} world residents | ${session.snapshot().bodies.filter(b=>b.entityId!==session.world.playerId).length} avatar-visible NPCs | player ${session.world.playerId} / ${session.world.primaryBody(session.world.playerId!)?.id} | regional protocol ${REGION_PROTOCOL} | ${process.cwd()}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  stopped=true;clearTimeout(timer);loopDelay.disable(); saveWorld(); for (const socket of wss.clients) socket.close(); wss.close(); http.close();
});
