import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { captureState, CaptureRefused, pathsOverlap } from '../src/server/capture';
import { loadConfig, type AlphaConfig, type AlphaEnv } from '../src/server/config';
import { WorldStore, WriterLock, type WorldIdentity } from '../src/server/store';
import { startupOutcome } from '../src/server/readiness';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const r of roots.splice(0)) { expect(resolve(r).startsWith(tmpdir())).toBe(true); rmSync(r, { recursive: true, force: true }); } });

const identity = (worldId: string): WorldIdentity => ({ format: 1, worldId, env: 'live', createdAtIso: '2026-09-24T00:00:00Z', generator: { kind: 'playable', seed: 1, version: 'playable-2', fingerprint: 'f' }, createdByRelease: 't' });
function env(root: string, name: AlphaEnv, extra: Record<string, unknown> = {}): AlphaConfig {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'config.json'), JSON.stringify({ env: name, port: 1, ...extra }));
  return loadConfig(join(root, 'config.json'));
}
async function world(c: AlphaConfig, worldId: string, payload: string) {
  const s = new WorldStore(c.stateDir); s.createIdentity(identity(worldId));
  await s.commit(payload, { worldId, savedAtIso: new Date().toISOString(), reason: 't', physicalTime: payload.length, worldNow: 0, saveSchema: 1, generator: identity(worldId).generator, release: { version: 't', revision: 't' }, ownership: {} });
}
/** Every file under a directory with its bytes, to prove a refused capture changed nothing. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p)] = readFileSync(p, 'utf8'); } };
  if (existsSync(dir)) walk(dir); return out;
}
async function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'tvo-capture-')); roots.push(base);
  const live = env(join(base, 'live'), 'live'), staging = env(join(base, 'staging'), 'staging');
  await world(live, 'w-live', '{"live":"newest"}');
  await world(staging, 'w-live', '{"staging":"older rehearsal"}');
  return { base, live, staging };
}
const idle = async () => false;

it('refuses to write into live, into the source itself, or into overlapping state, leaving the destination untouched', async () => {
  const { base, live, staging } = await fixture();
  const liveBefore = tree(live.stateDir), stagingBefore = tree(staging.root);
  const liveAsStaging = { ...live, env: 'staging' as AlphaEnv };
  await expect(captureState(staging, live, { isServing: idle })).rejects.toThrow(/never writes to live/);
  await expect(captureState(live, liveAsStaging, { isServing: idle })).rejects.toThrow(/overlap/);
  const nested = env(join(live.root, 'nested-staging'), 'staging');
  await expect(captureState(live, nested, { isServing: idle })).rejects.toThrow(/overlap/);
  const pointing = env(join(base, 'pointing'), 'staging', { stateDir: live.stateDir });
  await expect(captureState(staging, pointing, { isServing: idle })).rejects.toThrow(/not inside its environment root/);
  const dev = env(join(base, 'dev'), 'dev');
  await expect(captureState(live, dev, { isServing: idle, protectedRoots: [dev.stateDir] })).rejects.toThrow(/protected/);
  const aliasCase = env(join(base, 'alias'), 'staging', { stateDir: process.platform === 'win32' ? live.stateDir.toUpperCase() : live.stateDir });
  await expect(captureState(staging, aliasCase, { isServing: idle, protectedRoots: [live.stateDir] })).rejects.toThrow(CaptureRefused);
  expect(tree(live.stateDir)).toEqual(liveBefore);
  expect(tree(staging.root)).toEqual(stagingBefore);
  expect(pathsOverlap(join(base, 'a'), join(base, 'ab'))).toBe(false);
});

it('acquires the destination writer fence before any destructive step and refuses a destination owned by a live writer', async () => {
  const { live, staging } = await fixture();
  const other = new WriterLock(staging.stateDir, { release: 'running-staging', env: 'staging' }); other.acquire();
  try {
    const before = tree(staging.root);
    await expect(captureState(live, staging, { isServing: idle })).rejects.toThrow(/owned by another writer/);
    expect(tree(staging.root)).toEqual(before);
    expect(() => other.verify()).not.toThrow();
  } finally { other.release(); }
});

it('refuses while the destination is served or supervised, releases its fence, and leaves state untouched', async () => {
  const { live, staging } = await fixture();
  const before = tree(staging.root);
  await expect(captureState(live, staging, { isServing: async () => true })).rejects.toThrow(/stop staging/);
  expect(tree(staging.root)).toEqual(before);
  writeFileSync(join(staging.root, 'supervisor.lock'), JSON.stringify({ pid: process.pid }));
  const withSupervisor = tree(staging.root);
  await expect(captureState(live, staging, { isServing: idle })).rejects.toThrow(/stop staging/);
  expect(tree(staging.root)).toEqual(withSupervisor);
  expect(existsSync(join(staging.stateDir, 'writer.lock'))).toBe(false);
});

it('captures the newest live checkpoint and keeps the replaced destination world recoverable', async () => {
  const { live, staging } = await fixture();
  const r = await captureState(live, staging, { isServing: idle });
  const installed = new WorldStore(staging.stateDir).candidates().next().value!;
  expect(installed.world).toBe('{"live":"newest"}');
  expect(r.replacedWorld && readdirSync(r.replacedWorld).some(n => n.startsWith('gen-'))).toBe(true);
  expect(existsSync(join(staging.stateDir, 'writer.lock'))).toBe(false);
  expect(new WorldStore(live.stateDir).candidates().next().value!.world).toBe('{"live":"newest"}');
});

it('puts the previous destination world back when installation fails', async () => {
  const { live, staging } = await fixture();
  const before = tree(staging.stateDir);
  vi.spyOn(WorldStore.prototype, 'installFrom').mockImplementation(() => { throw new Error('disk full'); });
  await expect(captureState(live, staging, { isServing: idle })).rejects.toThrow('disk full');
  expect(tree(staging.stateDir)).toEqual(before);
});

it('treats only HTTP 200 in the ready state as a successful start', () => {
  expect(startupOutcome({ status: 200, state: 'ready' })).toBe('ready');
  expect(startupOutcome({ status: 503, state: 'maintenance' })).toBe('wait');
  expect(startupOutcome({ status: 503, state: 'starting' })).toBe('wait');
  expect(startupOutcome({ status: 503, state: 'stopping' })).toBe('wait');
  expect(startupOutcome({ status: 503 })).toBe('wait');
  expect(startupOutcome({ status: 0, state: 'unreachable' })).toBe('wait');
  expect(startupOutcome({ status: 503, state: 'failed' })).toBe('failed');
});
