// Real-process recovery acceptance on a NEW disposable staging root. Never points at live.
// npx tsx scripts/alpha/recovery-drill.ts --home <new-dir> --release <bundle> --port 7452
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ProbeClient } from '../../src/server/probeClient';
import { WorldStore } from '../../src/server/store';

const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['home', 'release', 'port']) assert(process.argv.includes(`--${name}`), `--${name} required`);
const home = resolve(arg('home')), release = resolve(arg('release')), port = Number(arg('port'));
assert(Number.isInteger(port) && port > 1024 && port < 65536);
assert(!existsSync(home), 'Recovery drill requires a new disposable root');
assert(existsSync(join(release, 'ops.mjs')), 'Bundled release required');
mkdirSync(home, { recursive: true });
const root = join(home, 'staging'), reportFile = join(home, 'recovery-report.json');
const run = promisify(execFile), started = Date.now();
const evidence: Record<string, unknown> = { kind: 'isolated real-process operator/protocol drill; no UI acceptance', home, release, port, startedAt: new Date().toISOString(), checks: {} };
const checks = evidence.checks as Record<string, boolean>;
const record = () => writeFileSync(reportFile, JSON.stringify(evidence, null, 2));
let client: ProbeClient | undefined, running = false;
async function ops(...args: string[]): Promise<string> {
  const result = await run(process.execPath, [join(release, 'ops.mjs'), ...args, '--env', 'staging'], {
    env: { ...process.env, TORN_VEIL_ALPHA_HOME: home }, windowsHide: true, timeout: 240_000, maxBuffer: 2_000_000,
  });
  return result.stdout;
}
async function status() { return JSON.parse(await ops('status')); }
const check = (name: string, value: boolean) => { checks[name] = value; record(); assert(value, name); console.log(name); };
const connect = (token: string, create = false) => ProbeClient.connect({ port, account: 'recovery-player', token, realtime: true, ...(create ? { character: 'new', name: 'Recovery Wayfarer' } : {}) });
try {
  await ops('init', '--port', String(port), '--seed', '918271', '--checkpoint-seconds', '60');
  await ops('install', '--release', release);
  const account = JSON.parse(await ops('account', 'add', 'recovery-player', '--name', 'Recovery acceptance'));
  await ops('start'); running = true;
  client = await connect(account.token, true);
  check('ordinaryCharacterCreated', !client.closed && !!client.personId);
  const person = client.personId, worldId = (await status()).service.worldId;
  const positionBefore = { ...client.ownBody()!.pos };
  for (let i = 0; i < 60; ++i) await client.command({ type: 'move', x: 1, z: 0, sprint: false });
  await client.next(m => m.type === 'snapshot');
  const positionAfter = client.ownBody()!.pos;
  check('realMovement', Math.hypot(positionAfter.x - positionBefore.x, positionAfter.z - positionBefore.z) > .1);
  const save = await client.intent({ type: 'save' });
  check('playerSaveAcknowledged', save.result === 'saved' && Number.isInteger(save.generation));
  const beforeCrash = (await status()).service;
  const savedMeta = JSON.parse(readFileSync(join(root, 'state', 'world', `gen-${String(save.generation).padStart(8, '0')}`, 'meta.json'), 'utf8'));
  evidence.beforeCrash = beforeCrash;
  const owner = JSON.parse(readFileSync(join(root, 'supervisor.json'), 'utf8'));
  const fence = JSON.parse(readFileSync(join(root, 'state', 'writer.lock'), 'utf8'));
  check('crashTargetIsOwnedWriter', owner.childPid === fence.pid && owner.server === join(release, 'server.mjs'));
  const crashAt = Date.now();
  process.kill(owner.childPid, 'SIGKILL');
  await client.waitClosed(); client = undefined;
  let recovered: any;
  while (Date.now() - crashAt < 120_000) {
    try { const s = await status(); if (s.supervisor?.childPid !== owner.childPid && s.service?.ready) { recovered = s; break; } } catch { /* restart in progress */ }
    await new Promise(r => setTimeout(r, 500));
  }
  evidence.crashRecoveryMs = Date.now() - crashAt;
  check('supervisorRestarted', !!recovered && recovered.supervisor.restarts > 0);
  check('durableClockAndOwnershipSurvived', recovered.service.worldId === worldId && recovered.service.world.physicalTime >= savedMeta.physicalTime && JSON.stringify(recovered.service.characters) === JSON.stringify(savedMeta.ownership));
  client = await connect(account.token);
  check('reconnectsSamePersonAfterCrash', client.personId === person);
  await client.close(); client = undefined;
  await ops('checkpoint');
  const backupResult = JSON.parse(await ops('backup'));
  evidence.backup = backupResult;
  await ops('stop'); running = false;
  const store = new WorldStore(join(root, 'state'));
  const newest = store.current()!, previous = store.generations().find(g => g < newest)!;
  const previousMeta = JSON.parse(readFileSync(join(store.checkpointDir(previous), 'meta.json'), 'utf8'));
  const interrupted = join(store.worldDir, '.tmp-gen-99999999-recovery-drill');
  mkdirSync(interrupted); writeFileSync(join(interrupted, 'world.json'), '{"interrupted');
  // Explicit corruption fixture on this disposable staging root, after its service has stopped.
  writeFileSync(join(store.checkpointDir(newest), 'world.json'), '{"corrupt');
  await ops('start'); running = true;
  const fallback = (await status()).service;
  evidence.fallback = { rejected: fallback.metrics.recoveredFrom, generation: fallback.lastCheckpoint.generation, physicalTime: fallback.world.physicalTime };
  check('corruptNewestRejected', fallback.metrics.recoveredFrom.some((r: any) => r.generation === newest));
  check('previousCompleteGenerationLoaded', fallback.lastCheckpoint.generation === previous && fallback.world.physicalTime >= previousMeta.physicalTime && fallback.worldId === worldId);
  check('interruptedWriteDiscarded', !existsSync(interrupted));
  client = await connect(account.token);
  check('fallbackPreservesCharacter', client.personId === person);
  await client.close(); client = undefined;
  await ops('stop'); running = false;
  const beforeRestore = store.current()!;
  const backups = JSON.parse(await ops('backups'));
  const restored = JSON.parse(await ops('restore', backups[0].name));
  check('restoreCreatesNewGeneration', restored.newGeneration > beforeRestore && store.generations().includes(beforeRestore));
  await ops('start'); running = true;
  const restoredService = (await status()).service;
  check('restoredWorldAndOwnership', restoredService.worldId === worldId && restoredService.characters['recovery-player'].includes(person));
  client = await connect(account.token);
  check('backupReconnectsSamePerson', client.personId === person);
  evidence.passed = true;
} catch (error) {
  evidence.passed = false; evidence.error = String(error); process.exitCode = 1;
} finally {
  if (client) await client.close().catch(() => {});
  if (running) { try { await ops('stop'); evidence.stopped = true; } catch (error) { evidence.cleanupError = String(error); process.exitCode = 1; evidence.passed = false; } }
  evidence.elapsedSeconds = (Date.now() - started) / 1000; record();
  console.log(JSON.stringify({ passed: evidence.passed, report: reportFile, elapsedSeconds: evidence.elapsedSeconds }));
}
