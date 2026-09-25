// Rehearse a real bundle change, then preserve later live progress through the operator update.
// All three environments are created under a NEW disposable root; existing services are untouched.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ProbeClient } from '../../src/server/probeClient';

const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1];
for (const name of ['home', 'before', 'after', 'port']) assert(process.argv.includes(`--${name}`), `--${name} required`);
const home = resolve(arg('home')), before = resolve(arg('before')), after = resolve(arg('after')), port = Number(arg('port'));
assert(!existsSync(home), 'New disposable root required');
assert(Number.isInteger(port) && port > 1024 && port < 65533);
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
assert(hash(join(before, 'server.mjs')) !== hash(join(after, 'server.mjs')), 'Must change executable code, not just a version label');
const oldRelease = JSON.parse(readFileSync(join(before, 'release.json'), 'utf8'));
const newRelease = JSON.parse(readFileSync(join(after, 'release.json'), 'utf8'));
assert(oldRelease.version !== newRelease.version, 'Distinct release identities required');
mkdirSync(home, { recursive: true });
const evidence: Record<string, any> = { kind: 'disposable real-process update acceptance; no UI acceptance', before: oldRelease, after: newRelease, checks: {}, executableHashes: [hash(join(before, 'server.mjs')), hash(join(after, 'server.mjs'))] };
const record = () => writeFileSync(join(home, 'update-report.json'), JSON.stringify(evidence, null, 2));
const check = (name: string, value: boolean) => { evidence.checks[name] = value; record(); assert(value, name); console.log(name); };
const run = promisify(execFile), started = Date.now();
let client: ProbeClient | undefined;
const running = new Set<string>();
async function bundleOps(bundle: string, ...args: string[]) {
  const { stdout } = await run(process.execPath, [join(bundle, 'ops.mjs'), ...args], { env: { ...process.env, TORN_VEIL_ALPHA_HOME: home }, windowsHide: true, timeout: 360_000, maxBuffer: 2_000_000 });
  return stdout;
}
const ops = (...args: string[]) => bundleOps(after, ...args);
const status = async () => JSON.parse(await ops('status', '--env', 'live'));
function checkpoint(env: string, bodyId?: string) {
  const worldDir = join(home, env, 'state', 'world');
  const name = readFileSync(join(worldDir, 'CURRENT'), 'utf8').trim();
  const file = join(worldDir, name, 'world.json');
  return { meta: JSON.parse(readFileSync(join(worldDir, name, 'meta.json'), 'utf8')), hash: hash(file),
    bodyPosition: bodyId ? JSON.parse(readFileSync(file, 'utf8')).bodies.find((b: any) => b.id === bodyId)?.pos : undefined };
}
try {
  for (const [i, env] of ['live', 'staging', 'dev'].entries()) {
    // The old release must create the old world. New generator defaults must never
    // be mistaken for the baseline that an already-running old service produced.
    await bundleOps(env === 'live' ? before : after, 'init', '--env', env, '--port', String(port + i), '--seed', '918271', ...(env === 'live' ? [] : ['--no-world']));
  }
  const devConfigBefore = hash(join(home, 'dev', 'config.json'));
  await ops('install', '--env', 'live', '--release', before);
  const account = JSON.parse(await ops('account', 'add', 'update-player', '--name', 'Update acceptance', '--env', 'live'));
  running.add('live'); await ops('start', '--env', 'live');
  const connect = () => ProbeClient.connect({ port, account: 'update-player', token: account.token, realtime: true });
  client = await ProbeClient.connect({ port, account: 'update-player', token: account.token, realtime: true, character: 'new', name: 'Continuity Wayfarer' });
  check('ordinaryPersonCreated', !!client.personId && !client.closed);
  const person = client.personId, bodyId = client.bodyId;
  await client.intent({ type: 'save' }); await client.close(); client = undefined;
  // The rehearsal creates its own probe character, which must never leak back into live.
  running.add('staging');
  await ops('rehearse', '--release', after);
  running.delete('staging');
  const rehearsal = JSON.parse(readFileSync(join(home, 'staging', 'rehearsals', `${newRelease.version}.json`), 'utf8'));
  evidence.rehearsal = rehearsal;
  check('rehearsalPassed', rehearsal.passed === true);
  const staged = checkpoint('staging');
  client = await connect();
  const startPosition = { ...client.ownBody()!.pos };
  for (let i = 0; i < 180; ++i) await client.command({ type: 'move', x: 1, z: 0, sprint: false });
  await client.command({ type: 'move', x: 0, z: 0, sprint: false });
  await client.next(m => m.type === 'snapshot');
  const changedPosition = { ...client.ownBody()!.pos };
  check('liveChangedAfterRehearsal', Math.hypot(changedPosition.x - startPosition.x, changedPosition.z - startPosition.z) > .1);
  const saved = await client.intent({ type: 'save' });
  check('laterLiveSaveAcknowledged', saved.result === 'saved');
  await client.close(); client = undefined;
  const latest = checkpoint('live', bodyId); evidence.liveBeforeUpdate = latest;
  check('laterProgressIsNewerThanCapture', latest.meta.physicalTime > rehearsal.capturedPhysicalTime && latest.meta.generation > rehearsal.capturedGeneration);
  const updateOutput = await ops('update', '--release', after, '--seconds', '0', '--message', 'Isolated update acceptance');
  writeFileSync(join(home, 'update.log'), updateOutput);
  const updated = (await status()).service; evidence.updated = updated;
  const updateBackupMatch = /"preUpdateBackup":\s*("(?:\\.|[^"\\])*")/.exec(updateOutput);
  assert(updateBackupMatch, 'Update must name its final-live backup');
  const finalBackup = JSON.parse(updateBackupMatch[1]);
  const afterCheckpoint = checkpoint('live', bodyId);
  check('loadedFinalLivePayloadNotStaging', afterCheckpoint.hash === hash(join(finalBackup, 'world.json')));
  check('laterPlayerPositionPreservedInSave', Math.hypot(afterCheckpoint.bodyPosition.x - latest.bodyPosition.x, afterCheckpoint.bodyPosition.z - latest.bodyPosition.z) < .05);
  check('newExecutableRunning', updated.release.version === newRelease.version);
  check('currentLiveClockAndOwnershipPreserved', updated.worldId === latest.meta.worldId && updated.world.physicalTime >= latest.meta.physicalTime && JSON.stringify(updated.characters) === JSON.stringify(latest.meta.ownership));
  check('stagingCharacterDidNotReplaceLive', !('rehearsal' in updated.characters) && checkpoint('staging').hash === staged.hash);
  check('devRemainsIsolated', hash(join(home, 'dev', 'config.json')) === devConfigBefore && !existsSync(join(home, 'dev', 'state', 'world', 'WORLD.json')));
  client = await connect();
  check('reconnectedOriginalPerson', client.personId === person);
  const afterPosition = client.ownBody()!.pos;
  evidence.playerPositions = { beforeMovement: startPosition, beforeUpdate: changedPosition, afterUpdate: afterPosition };
  // Restart deliberately releases external control until reconnect. Ordinary autonomous motion
  // during startup is allowed; the immutable final-live payload above is the continuity proof.
  evidence.postRestartAutonomyMovementMetres = Math.hypot(afterPosition.x - afterCheckpoint.bodyPosition.x, afterPosition.z - afterCheckpoint.bodyPosition.z);
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = String(error); process.exitCode = 1; }
finally {
  await client?.close().catch(() => {});
  for (const env of running) { try { await ops('stop', '--env', env); } catch (error) { evidence.cleanupError = String(error); process.exitCode = 1; evidence.passed = false; } }
  evidence.elapsedSeconds = (Date.now() - started) / 1000; record();
  console.log(JSON.stringify({ passed: evidence.passed, report: join(home, 'update-report.json'), elapsedSeconds: evidence.elapsedSeconds }));
}
