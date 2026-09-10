import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeSession } from './session';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RegionStream, projectRegion } from './regions';

const port = Number(process.env.TORN_VEIL_PORT ?? 8787);
const playable = process.env.TORN_VEIL_WORLD === 'playable';
const savePath = process.env.TORN_VEIL_SAVE ? resolve(process.env.TORN_VEIL_SAVE) : null;
const session = new BridgeSession(Number(process.env.TORN_VEIL_SEED ?? 918271), { playable, ...(savePath && existsSync(savePath) ? { save: readFileSync(savePath, 'utf8') } : {}) });
function saveWorld(): void {
  if (!savePath) return;
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath + '.tmp', session.save()); renameSync(savePath + '.tmp', savePath);
}
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ ok: true, version: 1, tick: session.world.physicalTime, npcs: session.snapshot().bodies.length - 1 }));
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
const streams = new Map<WebSocket, RegionStream>();
let controller: WebSocket | null = null;
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
  const controls = !controller;
  console.log(`bridge: ${controls ? 'controller' : 'observer'} connected`);
  if (controls) { controller = socket; session.resetInput(); }
  socket.send(JSON.stringify({ version: 1, type: 'hello', controls, playerId: session.world.playerId }));
  socket.send(JSON.stringify(session.scene()));
  const stream = new RegionStream(); streams.set(socket, stream);
  const initial = stream.frame(session.world); if (initial) socket.send(JSON.stringify(initial));
  socket.send(JSON.stringify(session.snapshot()));
  let messages = 0;
  const limit = setInterval(() => { messages = 0; }, 1000);
  socket.on('message', bytes => {
    if (++messages > 80) { socket.close(1008, 'Rate limit'); return; }
    if (controller !== socket) return;
    try {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'save' && savePath) { saveWorld(); socket.send('{"version":1,"type":"result","result":"saved"}'); }
      else if (message.type === 'debug_inspect' && typeof message.personId === 'string') socket.send(JSON.stringify({ version: 1, type: 'debug_inspection', truth: session.game.debugTruth(message.personId), beliefs: session.game.beliefs('local', message.personId) }));
      else socket.send(JSON.stringify({ version: 1, type: 'result', ...session.intent(message) }));
    }
    catch { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: -1, result: 'invalid_json' })); }
  });
  socket.on('error', () => { socket.close(); });
  socket.on('close', () => { clearInterval(limit); streams.delete(socket); if (controller === socket) { controller = null; session.resetInput(); } });
});
let ticks = 0;
const timer = setInterval(() => {
  session.step();
  if (++ticks % 2) return;
  const payload = JSON.stringify(session.snapshot());
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512_000) socket.send(payload);
  if (ticks % 20 === 0) for (const [socket, stream] of streams) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512_000) {
    const frame = stream.frame(session.world); if (frame) socket.send(JSON.stringify(frame));
  }
  if (ticks % 1200 === 0) saveWorld();
}, 50);
http.listen(port, '127.0.0.1', () => console.log(`Torn Veil canonical bridge ws://127.0.0.1:${port} | seed ${session.world.seed} | ${session.snapshot().bodies.length - 1} NPCs`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  clearInterval(timer); saveWorld(); for (const socket of wss.clients) socket.close(); wss.close(); http.close();
});
