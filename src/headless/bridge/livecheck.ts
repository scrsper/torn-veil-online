/**
 * Headless live-integration check for the Unreal bridge (Priority 1 verification).
 *
 * This drives the REAL bridge process over the REAL WebSocket protocol, speaking exactly what
 * `unreal/TornVeilOnline/Source/TornVeilOnline/TVBridgeSubsystem.cpp` speaks: a native (no
 * `Origin` header) connection, a `move` intent every 50 ms, and the same snapshot projection
 * math the C++ client applies. Everything the Unreal client can get wrong about the canonical
 * world EXCEPT the pixels is checked here — identity, cast size, canonical motion, movement
 * authority, reconciliation error, input expiry, replay rejection, and body-set stability
 * (runaway spawning/duplication).
 *
 * It is not a substitute for pressing Play; it is the part of "press Play and look" that can be
 * made reproducible and put in CI. Run with `npm run bridge:verify`.
 */
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.TORN_VEIL_PORT ?? 8799);
const URL = `ws://127.0.0.1:${PORT}`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

type Row = Record<string, any>;
type Snapshot = { type: 'snapshot'; tick: number; ack: number; playerId: string; bodies: Row[]; events: Row[] };
type Scene = { type: 'scene'; seed: number; origin: { x: number; y: number; z: number }; unitsPerMetre: number; places: Row[]; resources: Row[] };

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  —  ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The exact transform `ATVCharacter::Project` applies, driven by the scene message. */
function toUnreal(pos: { x: number; y: number; z: number }, scene: Scene): { X: number; Y: number; Z: number } {
  const u = scene.unitsPerMetre;
  return { X: (pos.x - scene.origin.x) * u, Y: (pos.z - scene.origin.z) * u, Z: (pos.y - scene.origin.y) * u + 90 };
}

async function main(): Promise<void> {
  // Detached so the whole tsx process group can be torn down; a leftover bridge on the port
  // would silently make the next run check a stale world.
  const bridge = spawn(process.execPath, [resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'), 'src/bridge/server.ts'], {
    cwd: repoRoot, env: { ...process.env, TORN_VEIL_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let banner = '';
  bridge.stdout.on('data', d => { banner += String(d); });
  bridge.stderr.on('data', d => { banner += String(d); });
  const stop = () => { try { process.kill(-bridge.pid!, 'SIGKILL'); } catch { try { bridge.kill('SIGKILL'); } catch { /* already gone */ } } };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stop(); process.exit(1); });

  try {
    // ---------------------------------------------------------------- connect
    let hello: Row | null = null, scene: Scene | null = null;
    const snapshots: Snapshot[] = [];
    const results: Row[] = [];
    // The greeting (hello / scene / first snapshot) is written synchronously inside the server's
    // connection handler, so the listener has to be attached before 'open' can resolve.
    const listen = (s: WebSocket): void => {
      s.on('message', bytes => {
        const m = JSON.parse(bytes.toString());
        if (m.type === 'hello') hello = m;
        else if (m.type === 'scene') scene = m;
        else if (m.type === 'snapshot') snapshots.push(m);
        else if (m.type === 'result') results.push(m);
      });
    };
    let socket: WebSocket | null = null;
    for (let attempt = 0; attempt < 40 && !socket; attempt++) {
      await sleep(500);
      socket = await new Promise<WebSocket | null>(res => {
        const s = new WebSocket(URL);
        listen(s);
        s.once('open', () => res(s));
        s.once('error', () => res(null));
      });
    }
    if (!socket) { check('bridge accepts a native client connection', false, banner.slice(-400)); return finish(stop); }
    check('bridge accepts a native client connection', true, URL);
    await sleep(600);
    if (!hello || !scene || !snapshots.length) { check('bridge greets with hello + scene + snapshot', false, `hello=${!!hello} scene=${!!scene} snapshots=${snapshots.length}`); return finish(stop); }
    check('bridge greets with hello + scene + snapshot', true);
    check('first native connection is granted control', (hello as Row).controls === true && typeof (hello as Row).playerId === 'string');

    // ---------------------------------------------------------------- identity
    const first = snapshots[snapshots.length - 1];
    const playerId = first.playerId;
    const player = first.bodies.find(b => b.entityId === playerId);
    const npcs = first.bodies.filter(b => b.entityId !== playerId);
    check('canonical player body is projected', !!player, player ? `${player.name} (${player.entityId})` : 'missing');
    check('all 32 canonical NPCs are projected', npcs.length === 32, `${npcs.length} NPCs`);
    check('every projected body carries a canonical entity id, body id and name',
      first.bodies.every(b => typeof b.entityId === 'string' && b.entityId && typeof b.bodyId === 'string' && b.bodyId && typeof b.name === 'string' && b.name.trim().length > 0));
    check('body ids are unique (no duplicate manifestations)', new Set(first.bodies.map(b => b.bodyId)).size === first.bodies.length);
    check('entity ids are unique (one body per person in this cast)', new Set(first.bodies.map(b => b.entityId)).size === first.bodies.length);
    check('names correspond to Torn Veil entities, not placeholders',
      npcs.every(b => /[A-Za-z]/.test(b.name) && !/^body|^npc|^entity/i.test(b.name)),
      npcs.slice(0, 4).map(b => `${b.name} / ${b.occupation}`).join(', ') + ' …');
    check('scene carries the canonical seed and projection origin',
      (scene as Scene).seed > 0 && (scene as Scene).unitsPerMetre === 100 && typeof (scene as Scene).origin.x === 'number',
      `seed ${(scene as Scene).seed}, origin ${JSON.stringify((scene as Scene).origin)}, ${(scene as Scene).places.length} places`);

    // ---------------------------------------------------------------- canonical NPC motion
    const before = new Map(npcs.map(b => [b.bodyId, { ...b.pos }]));
    await sleep(6000);
    const mid = snapshots[snapshots.length - 1];
    const moved = mid.bodies.filter(b => {
      const was = before.get(b.bodyId); if (!was) return false;
      return Math.hypot(b.pos.x - was.x, b.pos.z - was.z) > 0.25;
    });
    check('NPCs move under canonical simulation state', moved.length > 0, `${moved.length} of ${npcs.length} moved in 6 s of world time`);
    check('NPC motion is accompanied by canonical activity/pose', mid.bodies.some(b => b.entityId !== playerId && b.pose !== 'stand'),
      Array.from(new Set(mid.bodies.map(b => b.pose))).join(', '));

    // ---------------------------------------------------------------- movement authority
    // Drive the client exactly like TVBridgeSubsystem::Tick does: 20 Hz `move` intents, and a
    // locally predicted position advanced at the canonical speed the snapshot reports.
    const startRow = mid.bodies.find(b => b.entityId === playerId)!;
    const speed = typeof startRow.speed === 'number' ? startRow.speed : 3.4;
    let predicted = toUnreal(startRow.pos, scene as Scene);
    let worstError = 0;
    let sequence = (hello as Row).sequence ?? 0;
    const dt = 0.05;
    for (let i = 0; i < 60; i++) {
      socket.send(JSON.stringify({ version: 1, sequence: ++sequence, type: 'move', x: 1, z: 0, sprint: false }));
      predicted = { X: predicted.X + speed * (scene as Scene).unitsPerMetre * dt, Y: predicted.Y, Z: predicted.Z };
      await sleep(50);
      const latest = snapshots[snapshots.length - 1].bodies.find(b => b.entityId === playerId);
      if (latest) {
        const canonical = toUnreal(latest.pos, scene as Scene);
        worstError = Math.max(worstError, Math.hypot(canonical.X - predicted.X, canonical.Y - predicted.Y));
        predicted = canonical; // the client reconciles onto canonical truth every snapshot
      }
    }
    const after = snapshots[snapshots.length - 1].bodies.find(b => b.entityId === playerId)!;
    const travelled = Math.hypot(after.pos.x - startRow.pos.x, after.pos.z - startRow.pos.z);
    check('player moves only because TypeScript moved him', travelled > 0.5, `${travelled.toFixed(2)} m of canonical travel from 3 s of intent`);
    check('canonical travel matches +x intent, not a client-authored transform',
      after.pos.x - startRow.pos.x > 0.4 && Math.abs(after.pos.z - startRow.pos.z) < 1.5,
      `dx ${(after.pos.x - startRow.pos.x).toFixed(2)}, dz ${(after.pos.z - startRow.pos.z).toFixed(2)}`);
    // 25 cm over one snapshot interval is well inside the client's 6/s smoothing and far below
    // its 250 cm teleport threshold — above it the client would visibly rubber-band.
    check('client-side prediction stays inside the smoothing budget', worstError < 25,
      `worst per-snapshot reconciliation error ${worstError.toFixed(1)} cm (teleport threshold 250 cm)`);
    check('the bridge acknowledges each accepted intent', results.length > 0 && results.every(r => r.result === 'accepted' || r.result === 'no_resource'),
      `${results.length} results, ${new Set(results.map(r => r.result)).size} distinct`);
    check('snapshot ack tracks the client sequence', snapshots[snapshots.length - 1].ack === sequence, `ack ${snapshots[snapshots.length - 1].ack} of ${sequence}`);

    // ---------------------------------------------------------------- input expiry
    // The documented contract is a 300 ms grace so one dropped packet does not stutter the walk,
    // and a full stop after it — not an indefinite coast.
    const atRelease = { ...snapshots[snapshots.length - 1].bodies.find(b => b.entityId === playerId)!.pos };
    await sleep(700);
    const afterGrace = { ...snapshots[snapshots.length - 1].bodies.find(b => b.entityId === playerId)!.pos };
    await sleep(1500);
    const held = snapshots[snapshots.length - 1].bodies.find(b => b.entityId === playerId)!.pos;
    const coasted = Math.hypot(afterGrace.x - atRelease.x, afterGrace.z - atRelease.z);
    const afterwards = Math.hypot(held.x - afterGrace.x, held.z - afterGrace.z);
    check('abandoned input expires after the documented 300 ms grace', coasted < speed * 0.45 && afterwards < 0.02,
      `coasted ${coasted.toFixed(2)} m through the grace window, then ${afterwards.toFixed(3)} m in the next 1.5 s`);

    // ---------------------------------------------------------------- protocol hardening
    const beforeReject = results.length;
    socket.send(JSON.stringify({ version: 1, sequence: 1, type: 'move', x: 1, z: 0 }));                    // replayed
    socket.send(JSON.stringify({ version: 2, sequence: ++sequence, type: 'move', x: 1, z: 0 }));           // wrong version
    socket.send(JSON.stringify({ version: 1, sequence: ++sequence, type: 'teleport', pos: { x: 0, y: 0, z: 0 } })); // not an intent
    await sleep(400);
    const rejects = results.slice(beforeReject).map(r => r.result);
    check('replayed, mis-versioned and non-intent packets are all rejected',
      rejects.length === 3 && rejects.filter(r => r === 'invalid_sequence_or_version').length === 2 && rejects.includes('invalid_intent'),
      rejects.join(', '));

    // ---------------------------------------------------------------- no runaway spawning
    const ids = snapshots.map(s => s.bodies.map(b => b.bodyId).sort().join('|'));
    const distinct = new Set(ids);
    check('the projected body set is stable across every snapshot (no runaway spawning)', distinct.size === 1,
      `${snapshots.length} snapshots, ${distinct.size} distinct body sets, ${snapshots[snapshots.length - 1].bodies.length} bodies`);
    const cadence = (snapshots[snapshots.length - 1].tick - snapshots[0].tick) / Math.max(1, snapshots.length - 1);
    check('snapshot cadence is the documented ~10 Hz of canonical time', cadence > 0.08 && cadence < 0.13, `${(1 / cadence).toFixed(1)} Hz of world time per snapshot`);

    // ---------------------------------------------------------------- a second client observes, never controls
    const observer = new WebSocket(URL);
    await new Promise(r => observer.once('open', r));
    const observerHello = await new Promise<Row>(r => observer.once('message', b => r(JSON.parse(b.toString()))));
    check('a second connection observes and is refused control', observerHello.controls === false);
    observer.close();

    socket.close();
  } finally {
    // handled by finish()
  }
  finish(stop);
}

function finish(stop: () => void): void {
  stop();
  const failed = checks.filter(c => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} live-integration checks passed.`);
  if (failed.length) { console.log('Failed:'); for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`); }
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
