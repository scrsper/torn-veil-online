import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeSession } from './session';

const port = Number(process.env.TORN_VEIL_PORT ?? 8787);
const session = new BridgeSession(Number(process.env.TORN_VEIL_SEED ?? 918271));
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ ok: true, version: 1, tick: session.world.physicalTime, npcs: session.snapshot().bodies.length - 1 }));
  else if (req.url === '/scene') res.end(JSON.stringify(session.scene()));
  else if (req.url === '/snapshot') res.end(JSON.stringify(session.snapshot()));
  else { res.statusCode = 404; res.end('{}'); }
});
const wss = new WebSocketServer({ server: http, maxPayload: 4096 });
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
  socket.send(JSON.stringify(session.snapshot()));
  let messages = 0;
  const limit = setInterval(() => { messages = 0; }, 1000);
  socket.on('message', bytes => {
    if (++messages > 80) { socket.close(1008, 'Rate limit'); return; }
    if (controller !== socket) return;
    try { socket.send(JSON.stringify({ version: 1, type: 'result', ...session.intent(JSON.parse(bytes.toString())) })); }
    catch { socket.send(JSON.stringify({ version: 1, type: 'result', sequence: -1, result: 'invalid_json' })); }
  });
  socket.on('error', () => { socket.close(); });
  socket.on('close', () => { clearInterval(limit); if (controller === socket) { controller = null; session.resetInput(); } });
});
let ticks = 0;
const timer = setInterval(() => {
  session.step();
  if (++ticks % 2) return;
  const payload = JSON.stringify(session.snapshot());
  for (const socket of wss.clients) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512_000) socket.send(payload);
}, 50);
http.listen(port, '127.0.0.1', () => console.log(`Torn Veil canonical bridge ws://127.0.0.1:${port} | seed ${session.world.seed} | ${session.snapshot().bodies.length - 1} NPCs`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  clearInterval(timer); for (const socket of wss.clients) socket.close(); wss.close(); http.close();
});
