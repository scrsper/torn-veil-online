import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AccountRegistry } from './accounts';
import { loadConfig, loadRelease, type AlphaConfig, type AlphaEnv, type ReleaseIdentity } from './config';
import { LiveServer } from './live';
import { BackupSet, WorldStore, WriterLock, sha256, type CheckpointMeta, type LoadedCheckpoint } from './store';
import { migrationPath } from './migrations';
import { captureState, CaptureRefused } from './capture';
import { startupOutcome } from './readiness';
import { releaseStoppedWriter } from './stoppedWriter';

/**
 * Operator tool for Living Alpha environments. Every command names an environment root
 * (`--root`, default %USERPROFILE%\TornVeilAlpha\<env> or $TORN_VEIL_ALPHA_HOME). Run `ops.mjs help` for usage.
 */
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (name: string) => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--developer', '--force', '--no-start'].includes(argv[i - 1])));
// Not %LOCALAPPDATA%: Windows silently redirects AppData writes made by processes launched from a
// packaged (MSIX) app into that app's private store, invisible to scheduled tasks and other sessions.
const base = process.env.TORN_VEIL_ALPHA_HOME ?? join(homedir(), 'TornVeilAlpha');
const rootOf = (env: string) => resolve(flag('root') ?? join(base, env));
const envArg = () => (flag('env') ?? 'live') as AlphaEnv;
const out = (value: unknown) => process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n');
const fail = (message: string): never => { process.stderr.write(`error: ${message}\n`); process.exit(1); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function config(env = envArg()): AlphaConfig { const path = join(rootOf(env), 'config.json'); if (!existsSync(path)) fail(`${path} not found; run init first`); return loadConfig(path); }
function adminToken(c: AlphaConfig): string { return readFileSync(join(c.credentialsDir, 'admin.token'), 'utf8').trim(); }
async function admin(c: AlphaConfig, method: 'GET' | 'POST', op: string, timeoutMs = 120_000): Promise<any> {
  const r = await fetch(`http://127.0.0.1:${c.port}/admin/${op}`, { method, headers: { 'x-torn-veil-admin': adminToken(c) }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await r.json(); if (!r.ok) throw new Error(`${op}: HTTP ${r.status} ${JSON.stringify(body)}`); return body;
}
async function readiness(c: AlphaConfig): Promise<{ status: number; state: string }> {
  try { const r = await fetch(`http://127.0.0.1:${c.port}/ready`, { signal: AbortSignal.timeout(3000) }); const body = await r.json().catch(() => ({})) as { state?: string }; return { status: r.status, state: body.state ?? 'unknown' }; }
  catch { return { status: 0, state: 'unreachable' }; }
}
async function running(c: AlphaConfig): Promise<boolean> { try { return (await fetch(`http://127.0.0.1:${c.port}/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } }
function supervisorState(c: AlphaConfig): { pid: number; state: string } | null { try { return JSON.parse(readFileSync(join(c.root, 'supervisor.json'), 'utf8')); } catch { return null; } }
function currentRelease(c: AlphaConfig): { version: string; dir: string } | null { try { return JSON.parse(readFileSync(join(c.root, 'current-release.json'), 'utf8')); } catch { return null; } }
function releaseAt(dir: string): ReleaseIdentity { const p = join(dir, 'release.json'); if (!existsSync(p)) fail(`${dir} is not a release (no release.json)`); return JSON.parse(readFileSync(p, 'utf8')); }

async function waitFor(check: () => Promise<boolean> | boolean, what: string, timeoutMs: number): Promise<void> {
  const start = Date.now(); while (!(await check())) { if (Date.now() - start > timeoutMs) fail(`timed out waiting for ${what}`); await sleep(500); }
}
/** Start the environment's supervisor from its current release, detached from this process. */
async function start(c: AlphaConfig): Promise<void> {
  if (await running(c)) { out(`${c.env} already running`); return; }
  const rel = currentRelease(c); if (!rel) fail(`no current-release.json in ${c.root}; use 'install' or 'update'`);
  const node = process.execPath, sup = join(rel!.dir, 'supervisor.mjs');
  const child = spawn(node, [sup, '--config', join(c.root, 'config.json')], { detached: true, stdio: 'ignore', windowsHide: true, cwd: rel!.dir });
  child.unref();
  // Ready means the world is loaded and players can be admitted (HTTP 200). A 503 from a failed,
  // stopping or still-loading writer is not success; a failed writer or halted supervisor fails fast.
  await waitFor(async () => {
    const s = supervisorState(c); if (s?.state === 'halted') fail(`service halted: ${JSON.stringify(s)} — see ${join(c.logDir, 'server.log')}`);
    const outcome = startupOutcome(await readiness(c));
    if (outcome === 'failed') fail(`service failed during startup — see ${join(c.logDir, 'server.log')}`);
    return outcome === 'ready';
  }, `${c.env} to become ready`, 180_000);
  out(`${c.env} running release ${rel!.version} on port ${c.port}`);
}
/** Orderly stop: drain (optional), final checkpoint, supervisor exit, writer fence released. */
async function stop(c: AlphaConfig): Promise<void> {
  if (!(await running(c)) && !supervisorState(c)) { out(`${c.env} not running`); return; }
  const requestedAt = Date.now();
  let recoveredStaleWriter = false;
  writeFileSync(join(c.root, 'supervisor.stop'), new Date().toISOString());
  await waitFor(() => {
    if (existsSync(join(c.root, 'supervisor.lock'))) return false;
    const supervisor = supervisorState(c);
    if (supervisor && WriterLock.alive(supervisor.pid)) return false;
    const fence = releaseStoppedWriter(c.stateDir, c.env);
    recoveredStaleWriter ||= fence === 'released';
    return fence !== 'alive';
  }, `${c.env} to stop`, 150_000);
  const lastPath = join(c.stateDir, 'last-shutdown.json');
  const last = existsSync(lastPath) ? JSON.parse(readFileSync(lastPath, 'utf8')) : null;
  const cleanShutdown = !!last && Date.parse(last.atIso) >= requestedAt && last.ok === true;
  if (last && Date.parse(last.atIso) >= requestedAt && !last.ok) fail(`final checkpoint failed during stop: ${JSON.stringify(last)}`);
  // After a crash there is no new final checkpoint. Report the latest verified durable generation.
  const durable = new WorldStore(c.stateDir).candidates().next().value as LoadedCheckpoint | undefined;
  out({ stopped: c.env, finalGeneration: durable?.meta.generation ?? null, cleanShutdown, recoveredStaleWriter });
}

function writeConfig(root: string, env: AlphaEnv, extra: Record<string, unknown>): void {
  mkdirSync(root, { recursive: true });
  const path = join(root, 'config.json');
  if (existsSync(path)) fail(`${path} already exists; refusing to overwrite an environment`);
  writeFileSync(path, JSON.stringify({ env, ...extra }, null, 2));
}

const commands: Record<string, () => Promise<void>> = {
  async help() {
    out(`Torn Veil Living Alpha ops
  init --env <live|staging|dev> [--bind 127.0.0.1,100.x.y.z] [--port N] [--seed N] [--backup-dir D] [--catalogue F]
       creates the environment, its credentials and (unless --no-world) its world
  install --env E --release <dir>          set the release an environment runs (first install only)
  start|stop|status --env E                supervisor lifecycle / live status
  checkpoint|backup --env E                force a durable checkpoint / a backup copy now
  drain --env E [--seconds 60] [--message M]   stop admissions, warn players, disconnect, checkpoint
  open --env E                             re-open admissions after a drain
  account add <id> --name N [--developer] --env E | account rotate|disable|enable <id> | account list
  verify --env E                           verify every checkpoint and backup offline
  backups --env E                          list backups
  restore <backup-name> --env E            (service stopped) install a backup as the newest generation
  capture --from live --to staging         copy the CURRENT live state into staging (never the reverse)
  rehearse --release <dir>                 capture live→staging, run the candidate on staging, probe, stop
  update --release <dir> [--seconds 60] [--message M]   rehearsed release cutover for live
`);
  },
  async init() {
    const env = envArg(), root = rootOf(env);
    const port = Number(flag('port') ?? (env === 'live' ? 7400 : env === 'staging' ? 7410 : 7420));
    const bind = (flag('bind') ?? '127.0.0.1').split(',').map(s => s.trim()).filter(Boolean);
    const backupDir = flag('backup-dir') ?? join(root, 'backups');
    const extra: Record<string, unknown> = { port, bind, seed: Number(flag('seed') ?? 918271), backupDir, checkpointSeconds: Number(flag('checkpoint-seconds') ?? 60), backupMinutes: Number(flag('backup-minutes') ?? 60), disconnectGraceSeconds: Number(flag('grace-seconds') ?? 120), createWorldIfMissing: false };
    const catalogue = flag('catalogue');
    if (catalogue) { mkdirSync(join(root, 'content'), { recursive: true }); copyFileSync(catalogue, join(root, 'content', 'character-catalogue.json')); extra.characterCatalogue = 'content/character-catalogue.json'; }
    writeConfig(root, env, extra);
    const c = config(env);
    for (const d of [c.stateDir, c.logDir, c.credentialsDir, c.backupDir]) mkdirSync(d, { recursive: true });
    writeFileSync(join(c.credentialsDir, 'admin.token'), randomBytes(32).toString('base64url'));
    new AccountRegistry(join(c.credentialsDir, 'accounts.json'));
    if (!has('no-world')) {
      // Create the world once, offline, then leave createWorldIfMissing false: a missing state
      // directory later is an error to investigate, never a reason to make a new world.
      const server = new LiveServer({ ...c, createWorldIfMissing: true }, loadRelease(process.argv[1]), (level, event, data) => out({ level, event, ...data }));
      await server.open(); await server.stopInProcess('init');
      out(`world created: ${server.store.identity()!.worldId}`);
    }
    out(`initialised ${env} at ${root}`);
  },
  async install() {
    const c = config(), dir = resolve(flag('release') ?? fail('--release required'));
    const rel = releaseAt(dir);
    if (currentRelease(c)) fail('environment already has a release; use update (live) or rehearse (staging)');
    writeFileSync(join(c.root, 'current-release.json'), JSON.stringify({ version: rel.version, dir, installedAtIso: new Date().toISOString() }, null, 2));
    out(`installed ${rel.version} for ${c.env}`);
  },
  async start() { await start(config()); },
  async stop() { await stop(config()); },
  async status() {
    const c = config();
    out({ env: c.env, root: c.root, release: currentRelease(c), supervisor: supervisorState(c), service: await running(c) ? await admin(c, 'GET', 'status') : 'not running' });
  },
  async checkpoint() { out(await admin(config(), 'POST', 'checkpoint?reason=operator')); },
  async backup() { const c = config(); if (await running(c)) out(await admin(c, 'POST', 'backup')); else { const store = new WorldStore(c.stateDir); const g = store.current(); if (!g) fail('no checkpoint'); out({ dir: await new BackupSet(c.backupDir).take(store, g!) }); } },
  async drain() { const c = config(); out(await admin(c, 'POST', `drain?seconds=${Number(flag('seconds') ?? 60)}&message=${encodeURIComponent(flag('message') ?? 'Server maintenance')}`, 3_700_000)); },
  async open() { out(await admin(config(), 'POST', 'open')); },
  async account() {
    const c = config(), registry = new AccountRegistry(join(c.credentialsDir, 'accounts.json')), [, sub, id] = positional;
    if (sub === 'list') { out(registry.list().map(a => ({ id: a.id, name: a.displayName, enabled: a.enabled, roles: a.roles, maxCharacters: a.maxCharacters }))); return; }
    if (!id) fail('account id required');
    if (sub === 'add') { const token = registry.add(id, flag('name') ?? id, has('developer') ? ['player', 'developer'] : ['player']); out({ account: id, env: c.env, token, note: 'Shown once. Give it to the player privately; store it in their client config.' }); return; }
    if (sub === 'rotate') { out({ account: id, token: registry.rotate(id) }); return; }
    if (sub === 'disable' || sub === 'enable') { registry.setEnabled(id, sub === 'enable'); out(`${id} ${sub}d`); return; }
    fail(`unknown account command ${sub}`);
  },
  async verify() {
    const c = config(), store = new WorldStore(c.stateDir), rejects: unknown[] = [], ok: number[] = [];
    for (const cp of store.candidates((g, why) => rejects.push({ generation: g, why }))) ok.push(cp.meta.generation);
    const backups = new BackupSet(c.backupDir).list().map(b => { try { const w = readFileSync(join(b.dir, 'world.json')); return { name: b.name, ok: sha256(w) === b.meta.worldSha256 }; } catch (e) { return { name: b.name, ok: false, error: String(e) }; } });
    out({ identity: store.identity(), current: store.current(), verifiedGenerations: ok, rejected: rejects, backups });
    if (rejects.length || backups.some(b => !b.ok)) process.exitCode = 2;
  },
  async backups() { out(new BackupSet(config().backupDir).list().map(b => ({ name: b.name, generation: b.meta.generation, savedAtIso: b.meta.savedAtIso, physicalTime: b.meta.physicalTime, bytes: b.meta.worldBytes }))); },
  async restore() {
    const c = config(), name = positional[1] ?? fail('backup name required');
    if (await running(c)) fail('stop the service before restoring');
    const backup = new BackupSet(c.backupDir).list().find(b => b.name === name) ?? fail(`no backup ${name}`);
    const lock = new WriterLock(c.stateDir, { release: 'ops-restore', env: c.env }); lock.acquire();
    try { const meta = new WorldStore(c.stateDir).installFrom(backup.dir, lock, `restored from backup ${name}`); out({ restored: name, newGeneration: meta.generation, physicalTime: meta.physicalTime }); }
    finally { lock.release(); }
  },
  async capture() {
    const fromEnv = (flag('from') ?? 'live') as AlphaEnv, toEnv = (flag('to') ?? 'staging') as AlphaEnv;
    if (toEnv === 'live') fail('capture never writes to live (a stale copy must never replace newer live progress)');
    if (fromEnv === toEnv) fail('capture source and destination are the same environment');
    const from = config(fromEnv), to = config(toEnv);
    // Every other environment's state is protected from this write, live above all.
    const protectedRoots = (['live', 'staging', 'dev'] as AlphaEnv[]).filter(e => e !== toEnv && existsSync(join(rootOf(e), 'config.json'))).map(e => config(e).stateDir);
    if (await running(from)) await admin(from, 'POST', 'checkpoint?reason=captured-for-staging');
    try {
      const r = await captureState(from, to, { isServing: running, protectedRoots });
      out({ captured: from.env, into: to.env, sourceGeneration: r.sourceGeneration, savedAtIso: r.savedAtIso, physicalTime: r.physicalTime, replacedWorld: r.replacedWorld });
    } catch (e) { if (e instanceof CaptureRefused) fail(e.message); throw e; }
  },
  async rehearse() {
    const dir = resolve(flag('release') ?? fail('--release required')), rel = releaseAt(dir), live = config('live'), staging = config('staging');
    await commands.capture();
    const captured = new WorldStore(staging.stateDir).candidates().next().value as { meta: CheckpointMeta };
    writeFileSync(join(staging.root, 'current-release.json'), JSON.stringify({ version: rel.version, dir, installedAtIso: new Date().toISOString() }, null, 2));
    const t0 = Date.now(); await start(staging); const startMs = Date.now() - t0;
    const status = await admin(staging, 'GET', 'status');
    const checks = {
      sameWorld: status.worldId === captured.meta.worldId,
      clockContinues: status.world.physicalTime >= captured.meta.physicalTime,
      charactersPreserved: JSON.stringify(status.characters) === JSON.stringify(captured.meta.ownership),
      releaseRunning: status.release.version === rel.version,
    };
    let probe: unknown = 'not run';
    const probeScript = join(dir, 'probe.mjs');
    if (existsSync(probeScript)) {
      const registry = new AccountRegistry(join(staging.credentialsDir, 'accounts.json'));
      const token = registry.get('rehearsal') ? registry.rotate('rehearsal') : registry.add('rehearsal', 'Rehearsal probe');
      try { probe = JSON.parse(execFileSync(process.execPath, [probeScript, '--port', String(staging.port), '--account', 'rehearsal', '--token', token], { encoding: 'utf8', timeout: 240_000 })); }
      catch (e) { probe = { passed: false, error: String((e as { stdout?: string }).stdout ?? e) }; }
    }
    const cp = await admin(staging, 'POST', 'checkpoint?reason=rehearsal-persistence');
    await stop(staging);
    const reloaded = new WorldStore(staging.stateDir).candidates().next().value as { meta: CheckpointMeta } | undefined;
    const persisted = !!reloaded && reloaded.meta.generation >= cp.generation;
    const passed = Object.values(checks).every(Boolean) && persisted && (probe === 'not run' || (probe as { passed?: boolean }).passed === true);
    const record = { release: rel.version, dir, atIso: new Date().toISOString(), liveReleaseAtCapture: currentRelease(live)?.version ?? null, capturedGeneration: captured.meta.generation, capturedPhysicalTime: captured.meta.physicalTime, startMs, checks, persisted, probe, passed };
    mkdirSync(join(staging.root, 'rehearsals'), { recursive: true });
    writeFileSync(join(staging.root, 'rehearsals', `${rel.version}.json`), JSON.stringify(record, null, 2));
    out(record); if (!passed) process.exitCode = 3;
  },
  async update() {
    const c = config('live'), staging = config('staging'), dir = resolve(flag('release') ?? fail('--release required')), rel = releaseAt(dir);
    const previous = currentRelease(c) ?? fail('live has no installed release; use install for the first release');
    if (previous!.version === rel.version) fail(`live already runs ${rel.version}`);
    const rehearsalPath = join(staging.root, 'rehearsals', `${rel.version}.json`);
    const rehearsal = existsSync(rehearsalPath) ? JSON.parse(readFileSync(rehearsalPath, 'utf8')) : null;
    if (!rehearsal?.passed) fail(`no passing rehearsal for ${rel.version}; run rehearse first`);
    if (Date.now() - Date.parse(rehearsal.atIso) > 24 * 3600_000 && !has('force')) fail('rehearsal is older than 24 h; rehearse again (or --force)');
    const store = new WorldStore(c.stateDir), before = store.candidates().next().value as { meta: CheckpointMeta } | undefined;
    const steps = before ? migrationPath(before.meta.saveSchema, rel.saveSchema) : [];
    if (steps === null) fail(`no migration from save schema ${before!.meta.saveSchema} to ${rel.saveSchema}`);
    // 1–2: drain and stop live, capturing the CURRENT live state (not the staging copy).
    if (await running(c)) { out(`draining live for ${flag('seconds') ?? 60}s`); await admin(c, 'POST', `drain?seconds=${Number(flag('seconds') ?? 60)}&message=${encodeURIComponent(flag('message') ?? `Updating to ${rel.version}`)}`, 3_700_000); }
    await stop(c);
    const final = store.candidates().next().value as LoadedCheckpoint;
    const preBackup = await new BackupSet(c.backupDir).take(store, final.meta.generation);
    out({ preUpdateBackup: preBackup, generation: final.meta.generation, physicalTime: final.meta.physicalTime });
    // 3: migrate under the writer fence (nothing to do when schemas match).
    if (steps!.length) {
      const lock = new WriterLock(c.stateDir, { release: `migrate-${rel.version}`, env: 'live' }); lock.acquire();
      try { let world = final.world; for (const step of steps!) world = step.apply(world); await store.commit(world, { ...final.meta, savedAtIso: new Date().toISOString(), reason: `migration ${steps!.map(s => s.id).join('+')}`, saveSchema: rel.saveSchema, release: { version: rel.version, revision: rel.revision } }, lock); }
      finally { lock.release(); }
    }
    // 4: switch exclusive write authority to the new release and verify continuity.
    writeFileSync(join(c.root, 'current-release.json'), JSON.stringify({ version: rel.version, dir, installedAtIso: new Date().toISOString(), previous }, null, 2));
    try {
      await start(c);
      const status = await admin(c, 'GET', 'status');
      const ok = status.worldId === final.meta.worldId && status.world.physicalTime >= final.meta.physicalTime && status.release.version === rel.version && JSON.stringify(status.characters) === JSON.stringify(final.meta.ownership);
      if (!ok) throw new Error(`continuity check failed: ${JSON.stringify({ worldId: status.worldId, physicalTime: status.world.physicalTime, release: status.release.version })}`);
      out({ updated: `${previous!.version} → ${rel.version}`, worldId: status.worldId, physicalTime: status.world.physicalTime, generation: status.lastCheckpoint?.generation, preUpdateBackup: preBackup });
    } catch (e) {
      out({ updateFailed: String(e), action: `reverting to ${previous!.version}` });
      if (await running(c)) await stop(c);
      writeFileSync(join(c.root, 'current-release.json'), JSON.stringify(previous, null, 2));
      if (steps!.length) out(`A migration was applied; the previous release will refuse the migrated schema. Restore ${preBackup} with 'restore' before starting it.`);
      else await start(c);
      process.exitCode = 4;
    }
  },
};

const name = positional[0] ?? 'help';
const command = commands[name] ?? (() => fail(`unknown command ${name}; see help`));
await command();
