import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveServer } from '../src/server/live';
import { loadConfig, type ReleaseIdentity } from '../src/server/config';
import { AccountRegistry } from '../src/server/accounts';
import { WorldStore, WriterFenceError, RefuseToStartError, BackupSet, WriterLock } from '../src/server/store';
import { ProbeClient } from '../src/server/probeClient';
import { CLOSE } from '../src/server/protocol';
import { makeItem } from '../src/sim/world/factory';
import { isExternallyControlled } from '../src/sim/runtime/controllers';
import { SAVE_VERSION } from '../src/sim/persist/save';

const release: ReleaseIdentity = { version: 'test-1', revision: 'test', dirty: false, builtAtIso: '', protocol: 1, saveSchema: SAVE_VERSION, generatorVersion: 'playable-1', node: process.version };
const quiet = () => {};
const port = 7600 + Math.floor(Math.random() * 300);
let root = '', server: LiveServer, tokens: Record<string, string> = {};
const configPath = () => join(root, 'config.json');
const boot = async () => { const s = new LiveServer(loadConfig(configPath()), release, quiet); await s.open(); await s.listen(); return s; };
const join_ = (account: string, extra: Partial<Parameters<typeof ProbeClient.connect>[0]> = {}) => ProbeClient.connect({ port, account, token: tokens[account], ...extra });
const until = async (test: () => boolean, ms = 15_000) => { const t = Date.now(); while (!test()) { if (Date.now() - t > ms) throw new Error('until timeout'); await new Promise(r => setTimeout(r, 20)); } };

describe.sequential('Living Alpha authoritative service', () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'tvo-alpha-'));
    writeFileSync(configPath(), JSON.stringify({ env: 'dev', port, bind: ['127.0.0.1'], seed: 918271, createWorldIfMissing: true, checkpointSeconds: 3600, backupMinutes: 600, disconnectGraceSeconds: 1, maxConnections: 4 }));
    mkdirSync(join(root, 'credentials'), { recursive: true });
    writeFileSync(join(root, 'credentials', 'admin.token'), 'test-admin-token-0123456789abcdef');
    const accounts = new AccountRegistry(join(root, 'credentials', 'accounts.json'));
    for (const id of ['alice', 'bob', 'carol']) tokens[id] = accounts.add(id, id[0].toUpperCase() + id.slice(1));
    accounts.setEnabled('carol', false);
    server = await boot();
  }, 120_000);
  afterAll(async () => { await server?.stopInProcess('test end').catch(() => {}); rmSync(root, { recursive: true, force: true }); });

  it('distinguishes a live process, a ready world and maintenance; only ready answers 200', async () => {
    const get = async (path: string) => { const r = await fetch(`http://127.0.0.1:${port}${path}`); return { status: r.status, body: await r.json() as any }; };
    expect(await get('/ready')).toMatchObject({ status: 200, body: { state: 'ready' } });
    await server.drain(0, 'readiness test');
    const drained = await get('/ready');
    expect(drained).toMatchObject({ status: 503, body: { state: 'maintenance', admissions: false } });
    expect(await get('/health')).toMatchObject({ status: 200, body: { ok: true, state: 'maintenance' } });
    const refused = await join_('alice');
    expect(refused.closed?.code).toBe(CLOSE.maintenance);
    const reopened = await fetch(`http://127.0.0.1:${port}/admin/open`, { method: 'POST', headers: { 'x-torn-veil-admin': 'test-admin-token-0123456789abcdef' } });
    expect(reopened.status).toBe(200);
    expect(await get('/ready')).toMatchObject({ status: 200, body: { state: 'ready' } });
  }, 60_000);

  it('refuses wrong tokens, disabled accounts, old protocols and missing characters with explicit reasons', async () => {
    const bad = await ProbeClient.connect({ port, account: 'alice', token: 'x'.repeat(43) });
    expect(bad.closed?.code).toBe(CLOSE.authFailed);
    const disabled = await join_('carol');
    expect(disabled.closed?.code).toBe(CLOSE.authFailed);
    const old = await join_('alice', { protocol: 0 });
    expect(old.closed).toMatchObject({ code: CLOSE.incompatible });
    expect(old.closed!.reason).toMatch(/Update your client/);
    const none = await join_('alice');
    expect(none.closed).toMatchObject({ code: CLOSE.noCharacter });
  }, 60_000);

  it('gives each account its own new ordinary person with a per-person view', async () => {
    const a = await join_('alice', { character: 'new', name: 'Ada Vell', realtime: true });
    const b = await join_('bob', { character: 'new', name: 'Brin Oak', sex: 'm', realtime: true });
    expect(a.closed).toBeNull(); expect(b.closed).toBeNull();
    expect(a.personId).not.toBe(b.personId);
    expect(a.lastSnapshot!.playerId).toBe(a.personId);
    expect(b.lastSnapshot!.playerId).toBe(b.personId);
    const w = server.session.world;
    expect(w.person(a.personId)!.name).toBe('Ada Vell');
    expect(w.person(b.personId)!.gender).toBe('m');
    // Account/controller metadata stays out of the person.
    expect(JSON.stringify(w.person(a.personId))).not.toMatch(/alice/);
    // A snapshot carries inventory/needs only for its own person.
    const withPrivate = (s: any) => s.bodies.filter((body: any) => 'inventory' in body).map((body: any) => body.entityId);
    await until(() => !!a.lastSnapshot && !!b.lastSnapshot);
    expect(withPrivate(a.lastSnapshot)).toEqual([a.personId]);
    expect(withPrivate(b.lastSnapshot)).toEqual([b.personId]);
    // Bob met Alice's person only by sight: a stranger, not her name.
    const seen = b.lastSnapshot!.bodies.find((x: any) => x.entityId === a.personId);
    if (seen) expect(seen.name).not.toBe('Ada Vell');
    // Developer inspection is not available to ordinary players.
    expect((await a.intent({ type: 'debug_inspect', personId: b.personId })).result).toBe('forbidden');
    await a.close(); await b.close();
  }, 60_000);

  it('never lets one account take another account\'s character', async () => {
    const aliceId = server['ownership'].alice[0];
    const b = await join_('bob', { character: aliceId });
    expect(b.closed?.code).toBe(CLOSE.forbidden);
  }, 30_000);

  it('resolves two people reaching for one item on the same tick in favour of exactly one', async () => {
    const a = await join_('alice', { realtime: true }), b = await join_('bob', { realtime: true });
    const w = server.session.world, pa = w.primaryBody(a.personId)!, pb = w.primaryBody(b.personId)!;
    const mid = { x: (pa.pos.x + pb.pos.x) / 2, y: pa.pos.y, z: (pa.pos.z + pb.pos.z) / 2 };
    const loaf = makeItem(w, 'bread', 'bread', { pos: mid });
    const [ra, rb] = await Promise.all([a.command({ type: 'interact', interactionId: `take:${loaf.id}` }), b.command({ type: 'interact', interactionId: `take:${loaf.id}` })]);
    const winners = [ra, rb].filter(r => r.result === 'accepted');
    expect(winners).toHaveLength(1);
    expect(loaf.holderId === a.personId || loaf.holderId === b.personId).toBe(true);
    expect(w.items().filter(i => i.id === loaf.id)).toHaveLength(1);
    await a.close(); await b.close();
  }, 60_000);

  it('supersedes an older connection of the same account; its command epoch cannot be replayed', async () => {
    const first = await join_('alice', { realtime: true });
    const staleBinding = first.hello!.interaction;
    const second = await join_('alice', { realtime: true });
    expect((await first.waitClosed()).code).toBe(CLOSE.superseded);
    expect(second.personId).toBe(first.personId);
    // Re-sending an envelope from the dead epoch is rejected, not applied.
    second.sendRaw({ version: 2, type: 'command', epoch: staleBinding.epoch, controllerId: staleBinding.controllerId, bodyId: staleBinding.bodyId, sequence: 1, commandId: 'stale-1', specRevision: staleBinding.specRevision, clientTimeMs: 0, command: { type: 'attack' } });
    const receipt = await second.next(m => m.type === 'command_receipt' && m.commandId === 'stale-1');
    expect(receipt).toMatchObject({ status: 'rejected', result: 'binding_mismatch' });
    // Legacy unbound attacks are refused on realtime connections.
    expect((await second.intent({ type: 'attack' })).result).toBe('use_command_protocol');
    await second.close();
  }, 60_000);

  it('returns a disconnected person to ordinary autonomous life after the grace period and back on reconnect', async () => {
    const a = await join_('alice'); const id = a.personId, p = server.session.world.person(id)!;
    expect(isExternallyControlled(p)).toBe(true);
    await a.close();
    await until(() => !isExternallyControlled(p), 10_000);
    const again = await join_('alice');
    expect(again.personId).toBe(id);
    expect(isExternallyControlled(p)).toBe(true);
    await again.close();
  }, 60_000);

  it('makes progress durable on request and restores people, possessions and ownership after restart', async () => {
    const a = await join_('alice');
    const saved = await a.intent({ type: 'save' });
    expect(saved.result).toBe('saved');
    const w = server.session.world, alice = w.person(a.personId)!, held = alice.inventory.slice();
    const before = { clock: w.physicalTime, ownership: structuredClone(server['ownership']), held };
    await a.close();
    await server.stopInProcess('restart test');
    expect(JSON.parse(readFileSync(join(root, 'state', 'last-shutdown.json'), 'utf8')).ok).toBe(true);
    server = await boot();
    const w2 = server.session.world;
    expect(server['ownership']).toEqual(before.ownership);
    expect(w2.physicalTime).toBeGreaterThanOrEqual(before.clock);
    expect(w2.person(alice.id)!.inventory).toEqual(before.held);
    // Nobody is under control after a restart until they reconnect.
    for (const ids of Object.values(before.ownership)) for (const id of ids) expect(isExternallyControlled(w2.person(id)!)).toBe(false);
  }, 180_000);

  it('refuses a second writer while the first holds the fence', async () => {
    const second = new LiveServer(loadConfig(configPath()), release, quiet);
    await expect(second.open()).rejects.toBeInstanceOf(WriterFenceError);
  }, 60_000);

  it('recovers from an interrupted write and a corrupted newest checkpoint using the previous generation', async () => {
    await server.checkpoint('gen A');
    await server.stopInProcess('corruption test');
    const store = new WorldStore(join(root, 'state')), newest = store.current()!;
    mkdirSync(join(store.worldDir, `.tmp-gen-99999999-1234`)); writeFileSync(join(store.worldDir, `.tmp-gen-99999999-1234`, 'world.json'), '{"trunc');
    writeFileSync(join(store.checkpointDir(newest), 'world.json'), '{"corrupted": true}');
    server = await boot();
    expect(server.metrics.recoveredFrom.some(r => r.generation === newest)).toBe(true);
    expect(existsSync(join(store.worldDir, `.tmp-gen-99999999-1234`))).toBe(false);
    expect(server['lastCheckpoint']!.generation).toBe(newest - 1);
  }, 180_000);

  it('refuses to start when the generator would rebuild a different seeded base', async () => {
    await server.stopInProcess('fingerprint test');
    const identityPath = join(root, 'state', 'world', 'WORLD.json');
    const identity = JSON.parse(readFileSync(identityPath, 'utf8')), original = identity.generator.fingerprint;
    identity.generator.fingerprint = '0'.repeat(64); writeFileSync(identityPath, JSON.stringify(identity));
    await expect(new LiveServer(loadConfig(configPath()), release, quiet).open()).rejects.toBeInstanceOf(RefuseToStartError);
    identity.generator.fingerprint = original; writeFileSync(identityPath, JSON.stringify(identity));
    rmSync(join(root, 'state', 'writer.lock'), { force: true });
    server = await boot();
  }, 180_000);

  it('restores a verified backup as the newest generation without deleting later history', async () => {
    const backed = await server.checkpoint('before backup'); const dir = await server.backup();
    expect(dir).toBeTruthy();
    const clockAtBackup = backed.physicalTime;
    await server.checkpoint('after backup');
    await server.stopInProcess('restore test');
    const state = join(root, 'state'), store = new WorldStore(state), newestBefore = store.current()!;
    const backup = new BackupSet(join(root, 'backups')).list()[0];
    expect(backup.meta.generation).toBe(backed.generation);
    const lock = new WriterLock(state, { release: 'test-restore', env: 'dev' }); lock.acquire();
    const restored = store.installFrom(backup.dir, lock, 'test restore'); lock.release();
    expect(restored.generation).toBe(newestBefore + 1);
    expect(store.generations()).toContain(newestBefore);
    server = await boot();
    expect(server.session.world.physicalTime).toBeCloseTo(clockAtBackup, 5);
  }, 180_000);
});
