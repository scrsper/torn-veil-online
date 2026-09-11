/** Canonical socket acceptance; native possession/animation require separate PIE evidence. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { startHumanoidFixture } from './humanoidFixtureServer';
const running = startHumanoidFixture(8799), snapshots: ReturnType<typeof running.fixture.snapshot>[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 8000;
  while (!check()) { if (Date.now() > end) throw new Error(`Timed out: ${label}`); await sleep(50); }
}
let socket: WebSocket | undefined, sequence = 0;
const stages: Record<string, unknown>[] = [];
try {
  await until(() => running.http.listening, 'listen');
  socket = new WebSocket('ws://127.0.0.1:8799');
  socket.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'snapshot') snapshots.push(m); });
  await until(() => snapshots.length > 0, 'initial snapshot');
  const f = running.fixture;
  const player = () => snapshots.at(-1)!.bodies.find(b => b.bodyId === f.body.id)!;
  const npc = () => snapshots.at(-1)!.bodies.find(b => b.bodyId === f.npcBody.id)!;
  const capture = (stage: string) => stages.push({ stage, snapshot: snapshots.at(-1) });
  assert.equal(player().entityId, f.player.id); assert.ok(npc());
  assert.ok(snapshots.at(-1)!.bodies.some(b => b.bodyId === f.twin.id)); capture('idle');
  async function move(sprint: boolean) {
    for (let i = 0; i < 12; i++) {
      socket!.send(JSON.stringify({ version: 1, sequence: ++sequence, type: 'move', x: 0, z: 1, sprint }));
      await sleep(50);
    }
  }
  const start = { ...player().pos };
  await move(false); assert.equal(player().pose, 'walk'); const walkSpeed = player().speed; assert.ok(walkSpeed > 0); capture('walk');
  await move(true); assert.equal(player().pose, 'run'); assert.ok(player().speed > walkSpeed); capture('run');
  socket.send(JSON.stringify({ version: 1, sequence: ++sequence, type: 'move', x: 0, z: 0 }));
  await until(() => player().speed === 0 && player().pose === 'stand', 'stop');
  assert.ok(player().pos.z > start.z + 1); capture('stop');
  f.stage('arrange_combat'); await until(() => !!npc(), 'NPC visible after test arrangement');
  const npcStart = { ...npc().pos }; f.stage('npc_walk');
  await until(() => Math.hypot(npc().pos.x - npcStart.x, npc().pos.z - npcStart.z) > .3, 'NPC path following'); capture('npc_walk');
  f.stage('arrange_combat'); await sleep(200);
  const a0 = player().attackSeq, h0 = npc().hitSeq;
  f.stage('burst'); await until(() => player().attackSeq === a0 + 3 && npc().hitSeq === h0 + 3, 'three canonical attacks/hits'); capture('burst');
  const na0 = npc().attackSeq, ph0 = player().hitSeq;
  f.stage('npc_attack'); await until(() => npc().attackSeq === na0 + 1 && player().hitSeq === ph0 + 1, 'NPC attack'); capture('npc_attack');
  f.stage('remove_twin'); await until(() => !snapshots.at(-1)!.bodies.some(b => b.bodyId === f.twin.id), 'withdrawal');
  assert.ok(npc()); capture('remove_twin');
  f.stage('down'); await until(() => npc()?.incapacitated === true, 'downed'); capture('down');
  f.stage('death'); await until(() => !snapshots.at(-1)!.bodies.some(b => b.entityId === f.npc.id), 'death withdrawal'); capture('death');
  mkdirSync('docs/evidence/humanoid', { recursive: true });
  writeFileSync('docs/evidence/humanoid/canonical-acceptance.json', JSON.stringify({ passed: true,
    scope: 'canonical socket; native possession and animation verified separately',
    fixture: 'disposable flat patch; seeded NPC goto plan; batched legal attacks', stages, actions: f.actions }, null, 2));
  console.log(JSON.stringify({ passed: true, stages: stages.map(s => s.stage), snapshots: snapshots.length }));
} finally { socket?.terminate(); running.close(); }
