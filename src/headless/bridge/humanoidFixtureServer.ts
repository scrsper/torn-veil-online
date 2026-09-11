/** Acceptance-only disposable canonical world. Never imported by a production server.
 * Explicit test arrangements do not edit an Ashford save or any Unreal production map.
 * Movement, NPC path following, attacks, hits and downing use normal canonical mechanics. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { BridgeSession } from '../../bridge/session';
import { B } from '../../sim/physical/blocks';
import { makeBody } from '../../sim/world/factory';
import { ATTACK_COOLDOWN } from '../../sim/physical/combat';

export class HumanoidFixture {
  readonly session = new BridgeSession();
  readonly player = this.session.world.person(this.session.world.playerId)!;
  readonly body = this.session.world.primaryBody(this.player.id)!;
  readonly npc = this.session.world.persons().find(p => p.id !== this.player.id)!;
  readonly npcBody = this.session.world.primaryBody(this.npc.id)!;
  readonly twin = makeBody(this.session.world, this.npc.id, { x: 22, y: 1, z: 18 });
  stageName = 'idle';
  readonly actions: Record<string, unknown>[] = [];
  constructor() {
    const w = this.session.world;
    this.npc.bodies.push(this.twin.id);
    // Flat empty test patch, preserving ordinary people and manifestation types.
    for (let x = 8; x <= 36; x++) for (let z = 8; z <= 36; z++)
      for (let y = 0; y < w.grid.H; y++) w.grid.set(x, y, z, y === 0 ? B.Stone : B.Air);
    w.nav.rebuildArea(8, 8, 36, 36);
    for (const p of w.persons()) {
      p.mind.thinkInterval = Infinity;
      p.mind.plan = p === this.player ? [] : [{ type: 'wait', duration: 100000, status: 'pending' }];
      for (const id of p.bodies) { const b = w.body(id)!; b.path = null; b.vel = { x: 0, y: 0, z: 0 }; }
    }
    this.body.pos = { x: 18, y: 1, z: 18 }; this.npcBody.pos = { x: 20, y: 1, z: 18 };
    this.body.yaw = -Math.PI / 2;
    for (let i = 0; i < 8; i++) this.session.step(.05);
  }
  scene() {
    const w = this.session.world, columns: number[][] = [];
    for (let x = 8; x <= 36; x++) for (let z = 8; z <= 36; z++) columns.push([x, z, 0, w.grid.get(x, 0, z)]);
    return { version: 1, type: 'scene', seed: w.seed, origin: { x: 18, y: 0, z: 18 }, unitsPerMetre: 100,
      places: [], resources: [], terrain: { width: w.grid.W, depth: w.grid.D, columns, openings: [], fences: [] } };
  }
  snapshot() { return this.session.snapshot(); }
  state() { return { fixture: true, stage: this.stageName, playerId: this.player.id, controlledBodyId: this.body.id,
    npcId: this.npc.id, npcBodyId: this.npcBody.id, twinBodyId: this.twin.id, actions: this.actions, snapshot: this.snapshot() }; }
  stage(name: string) {
    const s = this.session, w = s.world;
    if (name === 'arrange_combat') {
      // Explicit test arrangement, not a production teleport capability.
      this.body.pos = { x: 18, y: 1, z: 18 }; this.npcBody.pos = { x: 19.4, y: 1, z: 18 };
      this.npc.mind.plan = [{ type: 'wait', duration: 100000, status: 'pending' }];
      this.npcBody.path = null; this.npcBody.vel = { x: 0, y: 0, z: 0 };
      this.body.yaw = -Math.PI / 2; this.npcBody.yaw = Math.PI / 2;
    } else if (name === 'npc_walk') {
      this.npc.mind.plan = [{ type: 'goto', pos: { x: 25, y: 1, z: 22 }, status: 'pending' }];
    } else if (name === 'burst' || name === 'npc_attack') {
      const attacker = name === 'burst' ? this.player : this.npc;
      const ab = name === 'burst' ? this.body : this.npcBody;
      const tb = name === 'burst' ? this.npcBody : this.body;
      const before = { attackSeq: ab.attackSeq, hitSeq: tb.hitSeq }, count = name === 'burst' ? 3 : 1;
      // Batch legal canonical attacks between publications; recovery advances normally.
      for (let i = 0; i < count; i++) {
        w.physicalTime += ATTACK_COOLDOWN + .01;
        const result = s.sim.attack(attacker, ab, tb);
        if (!result.attempted || !result.hit) throw new Error(`Fixture attack rejected: ${result.rejection}`);
      }
      this.actions.push({ name, attackerBodyId: ab.id, targetBodyId: tb.id, before,
        after: { attackSeq: ab.attackSeq, hitSeq: tb.hitSeq }, count });
    } else if (name === 'down' || name === 'death') {
      const event = s.sim.applyHit(this.player, this.body, this.npcBody, this.npcBody.health + 1, name === 'death' ? 'kill' : 'injure');
      if (!event) throw new Error(`Fixture ${name} hit rejected`);
      this.actions.push({ name, eventId: event.id, bodyId: this.npcBody.id, pose: this.npcBody.pose, present: this.npcBody.present });
    } else if (name === 'remove_twin') {
      this.twin.present = false;
      this.actions.push({ name, removedBodyId: this.twin.id, survivingBodyId: this.npcBody.id, sameEntityId: this.npc.id });
    } else if (name !== 'idle') throw new Error(`Unknown fixture stage: ${name}`);
    this.stageName = name; return this.state();
  }
}

export function startHumanoidFixture(port = 8787) {
  const fixture = new HumanoidFixture();
  const http = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.url === '/snapshot') res.end(JSON.stringify(fixture.snapshot()));
      else if (req.url === '/fixture') res.end(JSON.stringify(fixture.state()));
      else if (req.method === 'POST' && req.url?.startsWith('/fixture/stage/')) res.end(JSON.stringify(fixture.stage(req.url.slice('/fixture/stage/'.length))));
      else { res.statusCode = 404; res.end('{}'); }
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: String(error) })); }
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: 8192 });
  let controller: WebSocket | null = null;
  sockets.on('connection', socket => {
    const controls = controller === null;
    if (controls) { controller = socket; fixture.session.resetInput(); }
    socket.send(JSON.stringify({ version: 1, type: 'hello', controls, playerId: fixture.player.id }));
    socket.send(JSON.stringify(fixture.scene())); socket.send(JSON.stringify(fixture.snapshot()));
    socket.on('message', raw => {
      if (socket !== controller) return;
      try { socket.send(JSON.stringify({ version: 1, type: 'result', ...fixture.session.intent(JSON.parse(raw.toString())) })); }
      catch { socket.close(1007, 'Invalid fixture input'); }
    });
    socket.on('close', () => { if (controller === socket) { controller = null; fixture.session.resetInput(); } });
  });
  let tick = 0;
  const timer = setInterval(() => {
    fixture.session.step(.05);
    if (++tick % 2) return;
    const payload = JSON.stringify(fixture.snapshot());
    for (const socket of sockets.clients) if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }, 50);
  http.listen(port, '127.0.0.1', () => console.log(`HUMANOID_FIXTURE http://127.0.0.1:${port} ${JSON.stringify({ player: fixture.body.id, npc: fixture.npcBody.id, twin: fixture.twin.id })}`));
  const close = () => { clearInterval(timer); for (const socket of sockets.clients) socket.terminate(); sockets.close(); http.close(); };
  return { fixture, http, close };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = startHumanoidFixture(Number(process.env.TORN_VEIL_ACCEPTANCE_PORT ?? 8787));
  process.on('SIGINT', () => running.close()); process.on('SIGTERM', () => running.close());
}
