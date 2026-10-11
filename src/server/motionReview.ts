import { applyMeleeSpacing } from '../sim/mind/meleeSpacing';
/** Isolated local acceptance lab. Uses the same BridgeSession/World and shared character
 * adapter as the game. Its explicit fixtures never open or modify a player's save. */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createServer as createVite } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { BridgeSession } from '../bridge/session';
import { FixedScheduler } from '../bridge/scheduler';
import { arrangeCombatArena, setPracticeMode } from '../bridge/combatArena';
import { makeBody, makePerson } from '../sim/world/factory';
import { setExternalControl } from '../sim/runtime/controllers';
import { applyInteractionMovement } from '../sim/physical/interactionMovement';
import { requestCombatAction } from '../sim/physical/combatAction';

const port = Number(process.env.TV_MOTION_PORT ?? 7518), origin = `http://127.0.0.1:${port}`;
const assetRoot = process.env.TV_REALMS_ASSETS ? resolve(process.env.TV_REALMS_ASSETS) : null;
let s = new BridgeSession(918271, { arena: true }), owner: WebSocket | null = null, mode = 'single';
function fixture(name: string) {
  s = new BridgeSession(918271, { arena: true }); arrangeCombatArena(s, 'idle'); setPracticeMode(s, 'normal');
  mode = name;
  const w = s.world, player = w.primaryBody(w.playerId!)!;
  player.pos = { x: 20, y: 1, z: 24 }; player.yaw = 0;
  const enemies = w.persons().filter(p => p.id !== w.playerId);
  if (name === 'crowd') for (let n = 0; n < 3; n++) {
    const p = makePerson(w, { name: `Review partner ${n + 3}`, gender: 'm', age: 28, occupation: 'traveler', traits: {}, appearance: {}, bio: 'Explicit isolated motion-review fixture.' });
    p.bodies.push(makeBody(w, p.id, { x: 20, y: 1, z: 20 }).id); setExternalControl(p, true); enemies.push(p);
  }
  enemies.forEach((p, n) => {
    const b = w.primaryBody(p.id)!; b.present = name === 'crowd' || n === 0;
    const a = n * Math.PI * 2 / 5; b.pos = { x: 20 + Math.sin(a) * (name === 'crowd' ? 3 : 0), y: 1, z: 24 - Math.cos(a) * (name === 'crowd' ? 3 : 1.08) }; b.yaw = Math.atan2(b.pos.x - player.pos.x, b.pos.z - player.pos.z);
    p.mind.plan = [{ type: 'wait', duration: 1e12, status: 'pending' }];
  });
  const interaction = s.bindInteraction('motion-review');
  owner?.send(JSON.stringify({ type: 'binding', interaction, fixture: mode }));
}
fixture('single');
const vite = await createVite({ configFile: resolve('vite.web.config.ts'), server: { middlewareMode: true, hmr: false } });
const server = createServer((req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
  const url = new URL(req.url ?? '/', origin);
  if (url.pathname === '/motion/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ kind: 'isolated-motion-review', root: resolve('.'), fixture: mode, memory: process.memoryUsage() })); return; }
  if (assetRoot && /^\/(models|textures|arena)\//.test(url.pathname) && !existsSync(resolve('web/public', '.' + url.pathname))) {
    const path = resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
    if (path.startsWith(assetRoot + sep) && existsSync(path) && statSync(path).isFile()) {
      res.setHeader('content-type', ({ '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream'); createReadStream(path).pipe(res); return;
    }
  }
  vite.middlewares(req, res);
});
const ws = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/motion/socket' || req.headers.origin !== origin) { socket.destroy(); return; }
  ws.handleUpgrade(req, socket, head, c => ws.emit('connection', c));
});
ws.on('connection', client => {
  if (owner) { client.close(4001, 'Review already controlled'); return; }
  owner = client; fixture('single'); let count = 0, at = performance.now();
  client.on('message', data => {
    const now = performance.now(); if (now - at > 1000) { at = now; count = 0; } if (++count > 180) return;
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'fixture' && ['single', 'incoming', 'crowd'].includes(m.name)) fixture(m.name);
      else if (m.type === 'command') { const r = s.receiveCommand(m); if (r) client.send(JSON.stringify(r)); }
    } catch { client.send(JSON.stringify({ type: 'notice', message: 'Invalid review command' })); }
  });
  client.on('close', () => { if (owner === client) { s.resetInput(); owner = null; } });
});
let scheduler = new FixedScheduler(1000 / 60, performance.now()), tick = 0;
const samples: number[] = [];
const timer = setInterval(() => {
  const now = performance.now(); if (!owner || owner.readyState !== WebSocket.OPEN) { scheduler = new FixedScheduler(1000 / 60, now); return; }
  scheduler.run(now, () => {
    const start = performance.now(), w = s.world, pb = w.primaryBody(w.playerId!)!;
    if (mode !== 'single') for (const p of w.persons().filter(p => p.id !== w.playerId)) {
      const b = w.primaryBody(p.id); if (!b || !pb || !b.present || b.dead || b.pose === 'downed' || pb.pose === 'downed' || pb.dead) continue;
      if (b.combatAction && b.combatAction.completeAt > w.physicalTime) continue;
      // Explicit review partners supply fresh line-of-sight observations to the same
      // ordinary NPC spacing policy. This is an acceptance fixture, not autonomous AI.
      p.mind.percepts = w.activeBodies().filter(o => o.id !== b.id && w.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1.5 }, { ...o.pos, y: o.pos.y + 1.1 }, 8))
        .map(o => ({ entityId: o.ownerId, bodyId: o.id, how: 'saw' as const, tick: w.now, pos: { ...o.pos }, distance: Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) }));
      if (applyMeleeSpacing(w, p, b, pb, 1 / 60)) continue;
      const dx = pb.pos.x - b.pos.x, dz = pb.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.06) applyInteractionMovement(w, p, b, { x: dx / d, z: dz / d, sprint: false }, 1 / 60);
      else if (w.physicalTime - b.lastAttackAt > 1.3) requestCombatAction(w, { attackerId: p.id, attackerBodyId: b.id, targetBodyId: pb.id, attackMode: 'strike', trajectory: 'high', intent: 'injure' });
    }
    for (const receipt of s.stepInteraction()) owner!.send(JSON.stringify(receipt));
    samples.push(performance.now() - start); if (samples.length > 600) samples.shift();
    if (++tick % 3 === 0) owner!.send(JSON.stringify({ type: 'frame', fixture: mode, snapshot: s.snapshot(), local: s.localState(), serverMs: samples.at(-1) }));
  });
}, 4);
server.listen(port, '127.0.0.1', () => console.log(`Canonical motion review: ${origin}/?motion-review`));
async function close() { clearInterval(timer); ws.close(); server.close(); await vite.close(); process.exit(0); }
process.on('SIGINT', close); process.on('SIGTERM', close);
