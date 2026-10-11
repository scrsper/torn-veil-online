/** Development acceptance driver. The initial atrium placement is a declared fixture.
 * After entry it submits ordinary body-bound input; it cannot award damage or loot. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { RealmSession } from '../sim/world/realms/session';
import { applyTowerCommand } from '../server/canonicalTower';
import { TowerController } from '../server/towerController';
import { currentTowerFloor } from '../sim/world/interiors/tower';
import type { InteractionCommand } from '../bridge/commands';
import type { Vec3 } from '../sim/core/types';

const s = new RealmSession(Number(process.env.TV_TOWER_SEED ?? 918271));
const gate = s.grid.chunk('aether', 32, 32).buildings[0];
s.body.pos = { x: gate.door.x + .5, y: 1, z: gate.z + 4.5 }; s.world.setDoorOpen(gate.door, true, s.person.id);
applyTowerCommand(s, { type: 'enter', id: 'acceptance-enter', revision: 0 });
const host = new TowerController(s), binding = host.bind('acceptance'), w = s.world, b = s.body;
let seq = 0;
const command = (command: InteractionCommand) => host.bridge.receiveCommand({ version: 2, type: 'command', ...binding,
  sequence: seq, commandId: `acceptance-${seq++}`, clientTimeMs: performance.now(), command });
const f = currentTowerFloor(w)!;
for (const id of f.sourceItemIds) { command({ type: 'interact', interactionId: `take:${id}` }); host.step(); }
command({ type: 'learn_arcana', itemId: f.sourceItemIds[0] }); host.step();
command({ type: 'interact', interactionId: `equip:${f.sourceItemIds[1]}` }); host.step();
const start = performance.now(), trace: unknown[] = [], samples: number[] = [];
const geometry = host.geometry()!;
let target: Vec3 = geometry.exit, route: Vec3[] = [], routeIndex = 0, routeAt = -1;
const patrol = [geometry.exit, ...geometry.rooms.map(r => ({ x: r.x + r.w / 2, y: 1, z: r.z + r.d / 2 })), geometry.start];
let patrolIndex = 0, lastSeen: Vec3 | null = null, recovering = false, catchingBreath = false;
for (let tick = 0; tick < 60 * Number(process.env.TV_TOWER_SECONDS ?? 300); tick++) {
  if (tick % 6 === 0) {
    if (s.person.physiology.fatigue > .7) recovering = true;
    if (s.person.physiology.fatigue < .3) recovering = false;
    if ((b.exertion?.load ?? 0) > .65) catchingBreath = true;
    if ((b.exertion?.load ?? 0) < .25) catchingBreath = false;
    const visible = host.frame()!.snapshot.bodies.filter(q => q.bodyId !== b.id && !q.dead && !q.incapacitated && !f.defeats.some(d => d.bodyId === q.bodyId))
      .sort((a, c) => w.distance2d(a.pos, b.pos) - w.distance2d(c.pos, b.pos));
    const enemy = visible[0], distance = enemy ? w.distance2d(enemy.pos, b.pos) : Infinity;
    if (recovering && distance > 10 && w.distance2d(b.pos, geometry.start) < 2) {
      if (!s.person.mind.plan.some(a => a.type === 'sleep' && ['active', 'pending'].includes(a.status))) command({ type: 'rest' });
      // Let the ordinary sleep intention settle the body at a clear resting point.
      // Walking back to the exact entrance each sample would fight that placement.
      command({ type: 'move', x: 0, z: 0, sprint: false }); host.step(); continue;
    }
    if (b.pose === 'sleep') { if (!recovering || distance < 5) command({ type: 'wake' }); else { host.step(); continue; } }
    if (enemy) lastSeen = { ...enemy.pos };
    if (lastSeen && w.distance2d(b.pos, lastSeen) < 1) lastSeen = null;
    if (!enemy && !lastSeen && w.distance2d(b.pos, patrol[patrolIndex]) < 1) patrolIndex = (patrolIndex + 1) % patrol.length;
    const retreat = enemy && distance < (catchingBreath ? 4 : 1.4) ? { x: b.pos.x + (b.pos.x - enemy.pos.x) / Math.max(.01, distance) * 2,
      y: b.pos.y, z: b.pos.z + (b.pos.z - enemy.pos.z) / Math.max(.01, distance) * 2 } : null;
    target = recovering ? geometry.start : retreat ?? enemy?.pos ?? lastSeen ?? patrol[patrolIndex];
    if (tick - routeAt >= 30 || enemy && distance < 7) { route = w.nav.findPath(b.pos, target) ?? []; routeIndex = 0; routeAt = tick; }
    while (routeIndex < route.length && w.distance2d(route[routeIndex], b.pos) < .55) routeIndex++;
    const to = route[routeIndex] ?? target, dx = to.x - b.pos.x, dz = to.z - b.pos.z, d = Math.hypot(dx, dz);
    const casting = !!b.arcana?.cast && !b.arcana.cast.cancelled && b.arcana.cast.completeAt > w.physicalTime;
    const busy = b.combatAction && b.combatAction.completeAt > w.physicalTime;
    const castNow = !recovering && !catchingBreath && enemy && distance > 2.5 && distance <= 6.5 && !busy && tick % 30 === 0 && (b.arcana?.mana ?? 100) >= 22 && (b.arcana?.cooldowns['book-ember'] ?? 0) <= w.physicalTime;
    if (castNow) command({ type: 'cast', abilityId: 'book-ember', target: { ...enemy.pos, y: enemy.pos.y + 1 } });
    const incoming = enemy?.combatAction && enemy.combatAction.kind === 'attack' && enemy.combatAction.recoveryAt > w.physicalTime;
    const aim = enemy ? Math.atan2(b.pos.x - enemy.pos.x, b.pos.z - enemy.pos.z) : b.yaw;
    const aligned = Math.abs(Math.atan2(Math.sin(aim - b.yaw), Math.cos(aim - b.yaw))) < .12;
    if (!casting && !castNow && !busy && !catchingBreath && aligned && enemy && distance < 2.1 && !incoming && tick % 18 === 0 && s.person.physiology.fatigue < .7) command({ type: 'attack', targetBodyId: enemy.bodyId, weight: 'light' });
    if (s.person.physiology.fatigue < .7) command({ type: 'guard', held: !catchingBreath && !!incoming && distance < 2.5 });
    const close = casting || castNow || catchingBreath && !retreat || !recovering && !retreat && enemy && distance <= 1.5;
    for (let i = 0; i < 6; i++) command({ type: 'move', x: close || d < .2 ? 0 : dx / d, z: close || d < .2 ? 0 : dz / d, sprint: false, facing: enemy ? Math.atan2(b.pos.x - enemy.pos.x, b.pos.z - enemy.pos.z) : undefined });
  }
  const before = performance.now(); host.step(); samples.push(performance.now() - before);
  if (tick % 600 === 0) trace.push({ seconds: w.physicalTime, hp: b.health, fatigue: s.person.physiology.fatigue, exertion: b.exertion?.load ?? 0, pose: b.pose, pos: { ...b.pos }, defeated: f.defeats.length,
    wardens: f.enemyBodyIds.map(id => { const q = w.body(id)!, p = w.person(q.ownerId)!; return { id, hp: q.health, pos: { ...q.pos }, pose: q.pose, goal: p.mind.goal?.type, action: p.mind.plan.find(a => a.status === 'active')?.type }; }) });
  if (f.clearEventId) break;
}
const clearanceSeconds = w.physicalTime, journey: { step: string; ok: boolean }[] = [];
const handTrace: unknown[] = [];
if (f.clearEventId) {
  command({ type: 'guard', held: false });
  // Continue with the same body-bound movement and hand operations to the actual
  // award chest. The initial atrium placement remains this driver's only fixture.
  const awardPoint = w.container(f.rewardContainerId)!.pos!;
  for (let tick = 0; tick < 60 * 90 && w.distance2d(b.pos, awardPoint) > .5; tick++) {
    if (tick % 6 === 0) {
      const path = w.nav.findPath(b.pos, awardPoint) ?? [], to = path.find(p => w.distance2d(p, b.pos) > .4) ?? awardPoint;
      const dx = to.x - b.pos.x, dz = to.z - b.pos.z, d = Math.max(.01, Math.hypot(dx, dz));
      for (let i = 0; i < 6; i++) command({ type: 'move', x: dx / d, z: dz / d, sprint: false });
    }
    host.step();
  }
  for (let n = 0; n < 6; n++) { command({ type: 'move', x: 0, z: 0, sprint: false }); host.step(); }
  handTrace.push({ pos: { ...b.pos }, chest: { ...awardPoint }, interactions: host.frame()!.snapshot.interactions });
  const drain = () => { for (let n = 0; n < 24; n++) handTrace.push(...host.step()); };
  drain(); command({ type: 'interact', interactionId: `open:${f.rewardContainerId}` }); drain();
  for (const itemId of f.rewardItemIds) { command({ type: 'container_transfer', containerId: f.rewardContainerId, itemId, direction: 'out' }); drain(); }
  journey.push({ step: 'walked to and collected the earned chest through ordinary hand transfers', ok: f.rewardItemIds.every(id => s.person.inventory.includes(id)) });
  command({ type: 'learn_arcana', itemId: f.rewardItemIds[0] }); drain();
  journey.push({ step: 'learned the earned Ward source', ok: !!s.person.arcana?.learned['book-ward'] });
  const restored = new RealmSession(0, s.save());
  journey.push({ step: 'reward, body and learning reload', ok: restored.body.id === b.id && restored.body.health === b.health && !!restored.person.arcana?.learned['book-ward'] });
  applyTowerCommand(s, { type: 'ascend', id: 'acceptance-ascend', revision: w.canonicalTower!.revision, runId: w.canonicalTower!.id });
  journey.push({ step: 'ascended from the physical stair to floor two', ok: w.canonicalTower!.floor === 2 });
  applyTowerCommand(s, { type: 'return', id: 'acceptance-return', revision: w.canonicalTower!.revision, runId: w.canonicalTower!.id });
  journey.push({ step: 'returned to the real atrium with canonical rewards', ok: s.inTower() && f.rewardItemIds.every(id => s.person.inventory.includes(id)) });
}
samples.sort((a,b)=>a-b);
const out = process.env.TV_TOWER_OUT ?? '.debug/canonical-tower-oct9/headless'; mkdirSync(out, { recursive: true });
const result = { kind: 'simulated-time acceptance; initial atrium fixture', seed: w.seed, cleared: !!f.clearEventId,
  seconds: clearanceSeconds, journey, handTrace, elapsedMs: performance.now() - start, hp: b.health, defeats: f.defeats,
  attacks: w.events.filter(e => e.type === 'attack').map(e => ({ actor: e.actor, target: e.target, damage: e.data.damage, health: e.data.health, arcane: !!e.data.arcaneEventId })),
  tickMs: { p50: samples[Math.floor(samples.length*.5)], p95: samples[Math.floor(samples.length*.95)], p99: samples[Math.floor(samples.length*.99)] }, trace };
writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2)); writeFileSync(`${out}/world.json`, s.save());
console.log(JSON.stringify({ cleared: result.cleared, seconds: result.seconds, journey, hp: result.hp, defeats: f.defeats.length, attacks: result.attacks.length, elapsedMs: result.elapsedMs, tickMs: result.tickMs }));
if (!result.cleared || journey.length !== 5 || journey.some(check => !check.ok)) process.exitCode = 1;
