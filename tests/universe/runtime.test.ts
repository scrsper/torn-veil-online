import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { UniverseRuntime, validateUniversePayload } from '../../src/server/universeRuntime';
import { createUniverseServer } from '../../src/server/universe';
import { neutralInput } from '../../src/sim/world/universe/travel';
import { add, normalize, scale, sub } from '../../src/sim/world/planet/planet';

const dirs: string[] = [], runtimes: UniverseRuntime[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'torn-veil-universe-test-')); dirs.push(path); return path; };
const open = (path = directory()) => { const r = new UniverseRuntime({ directory: path }); runtimes.push(r); return r; };
afterEach(() => { for (const r of runtimes.splice(0)) r.close(); for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('universe host persistence and command authority', () => {
  it('expires held controls, rejects stale sequences, and fences old host sessions', () => {
    const r = open();
    const command = (seq: number, value: unknown) => r.command({ seq, sessionId: r.sessionId, command: value });
    expect(command(1, { type: 'launch' }).ok).toBe(true);
    expect(command(2, { type: 'input', input: { ...neutralInput(), throttle: 1 } }).ok).toBe(true);
    r.step(8);
    const before = r.snapshot();
    expect(before.status.speed).toBeGreaterThan(100);
    expect(command(2, { type: 'land' }).error).toContain('Stale');
    expect(r.command({ seq: 3, sessionId: 'old-session', command: { type: 'land' } }).error).toContain('session');
    r.step(12);
    expect(r.snapshot().status.speed).toBe(0);
    expect(r.lastSeq).toBe(2);
  });
  it('persists identity, discovery and position while neutralizing restart controls', () => {
    const dir = directory(), r = open(dir);
    r.command({ sessionId: r.sessionId, seq: 1, command: { type: 'launch' } });
    r.command({ sessionId: r.sessionId, seq: 2, command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } });
    r.step(5);
    const before = r.snapshot();
    r.close();
    const restored = open(dir), after = restored.snapshot();
    expect(after.state.position).toEqual(before.state.position);
    expect(after.state.explorerId).toBe(before.state.explorerId);
    expect(after.state.vesselId).toBe(before.state.vesselId);
    expect(after.state.discoveries).toEqual(before.state.discoveries);
    expect(after.status.speed).toBe(0);
    expect(after.state.cruise).toBe(false);
    expect(after.sessionId).not.toBe(before.sessionId);
    expect(after.lastSeq).toBe(0);
    restored.step(5);
    expect(restored.state.position).toEqual(after.state.position);
  });
  it('fails closed after a command save error and recovers only the last committed state', async () => {
    const dir = directory(), r = open(dir), savePath = join(dir, 'universe-v1.json'), retainedPath = join(dir, 'retained-save.json');
    const committed = readFileSync(savePath, 'utf8'), sessionId = r.sessionId;
    const server = createUniverseServer(r);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    // Preserve the exact good save, then obstruct replacement using an empty
    // directory owned by this test. No production save or unrelated path is used.
    renameSync(savePath, retainedPath); mkdirSync(savePath);
    try {
      const response = await fetch(`${url}/api/universe/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, seq: 1, command: { type: 'launch' } }),
      });
      expect(response.status).toBe(503);
      const rejection = await response.json();
      expect(rejection.error).toContain('persistence failed');
      expect(rejection.snapshot).toBeUndefined();
      expect(r.failureReason).toContain('persistence failed');
      expect((await fetch(`${url}/api/universe`)).status).toBe(503);
      expect((await fetch(`${url}/health`)).status).toBe(503);
      const tick = r.state.tick;
      expect(() => r.step()).toThrow('persistence failed');
      expect(() => r.snapshot()).toThrow('persistence failed');
      expect(() => r.command({ sessionId, seq: 2, command: { type: 'land' } })).toThrow('persistence failed');
      expect(r.state.tick).toBe(tick);
      r.close();
      expect(readFileSync(retainedPath, 'utf8')).toBe(committed);
      rmdirSync(savePath); renameSync(retainedPath, savePath);
      const recovered = open(dir);
      expect(recovered.state.mode).toBe('surface');
      expect(recovered.state.events).toHaveLength(0);
      expect(recovered.state.tick).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('restarts safely during physical landing and preserves completed touchdown', () => {
    const dir = directory(), r = open(dir);
    const command = (runtime: UniverseRuntime, value: unknown) =>
      runtime.command({ sessionId: runtime.sessionId, seq: runtime.lastSeq + 1, command: value });
    expect(command(r, { type: 'launch' }).ok).toBe(true);
    expect(command(r, { type: 'navigate', planetId: r.state.targetPlanetId }).ok).toBe(true);
    for (let i = 0; i < 2000 && r.state.cruise; i++) r.step();
    expect(r.snapshot().status.canLand).toBe(true);
    expect(command(r, { type: 'land' }).ok).toBe(true);
    r.step(5);
    expect(r.state.landing).toBe(true);
    const position = structuredClone(r.state.position), identities = [r.state.explorerId, r.state.vesselId];
    r.close();
    const airborne = open(dir);
    expect(airborne.state.mode).toBe('flight');
    expect(airborne.state.landing).toBe(false);
    expect(airborne.state.position).toEqual(position);
    expect(airborne.snapshot().status.speed).toBe(0);
    expect(airborne.state.events.filter(e => e.type === 'land')).toHaveLength(0);
    expect(command(airborne, { type: 'land' }).ok).toBe(true);
    for (let i = 0; i < 110 && airborne.state.mode === 'flight'; i++) airborne.step();
    expect(airborne.state.mode).toBe('surface');
    const landed = airborne.snapshot();
    const durableTouchdown = JSON.parse(readFileSync(join(dir, 'universe-v1.json'), 'utf8')).payload;
    expect(durableTouchdown.state.mode).toBe('surface');
    expect(durableTouchdown.state.tick).toBe(landed.state.tick);
    expect(durableTouchdown.state.events).toEqual(landed.state.events);
    airborne.close();
    const restored = open(dir);
    expect(restored.state.mode).toBe('surface');
    expect(restored.state.landing).toBe(false);
    expect(restored.state.position).toEqual(landed.state.position);
    expect(restored.state.landedVesselPosition).toEqual(landed.state.landedVesselPosition);
    expect([restored.state.explorerId, restored.state.vesselId]).toEqual(identities);
    expect(restored.state.discoveries).toEqual(landed.state.discoveries);
    expect(restored.state.events.filter(e => e.type === 'land')).toHaveLength(1);
  });
  it('refuses a second writer and corrupt saves without replacing evidence', () => {
    const dir = directory(), r = open(dir), path = join(dir, 'universe-v1.json');
    expect(() => open(dir)).toThrow('locked');
    r.close();
    const corrupt = '{"version":1,"payload":"damaged"}';
    writeFileSync(path, corrupt);
    expect(() => open(dir)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(corrupt);
  });
  it('fences a superseded writer before it can mutate or overwrite the replacement host', () => {
    const dir = directory(), oldHost = open(dir), lockPath = join(dir, 'writer.lock');
    // Simulate an external recovery replacing only this test's lock while the
    // previous writer is still alive. The stale writer must notice ownership loss.
    renameSync(lockPath, join(dir, 'previous-writer.lock'));
    const replacement = open(dir);
    replacement.step(2); replacement.save();
    const committed = readFileSync(join(dir, 'universe-v1.json'), 'utf8');
    expect(() => oldHost.command({
      sessionId: oldHost.sessionId, seq: 1, command: { type: 'launch' },
    })).toThrow('ownership');
    expect(oldHost.state.mode).toBe('surface');
    expect(() => oldHost.step()).toThrow('ownership');
    expect(() => oldHost.snapshot()).toThrow('ownership');
    oldHost.close();
    expect(readFileSync(join(dir, 'universe-v1.json'), 'utf8')).toBe(committed);
    expect(replacement.snapshot().state.tick).toBe(2);
  });
  it('rejects invalid physics/provenance even in a structurally valid payload', () => {
    const r = open(), snapshot = r.snapshot();
    const payload = { spec: snapshot.spec, state: snapshot.state, revision: snapshot.revision };
    expect(validateUniversePayload(payload).state.explorerId).toBe(snapshot.state.explorerId);
    payload.state.position.x = NaN;
    expect(() => validateUniversePayload(payload)).toThrow();
    payload.state.position.x = 0;
    payload.state.discoveries[0].explorerId = 'another-explorer';
    expect(() => validateUniversePayload(payload)).toThrow();
    const embedded = { spec: r.spec, state: structuredClone(r.state), revision: 0 };
    embedded.state.position = { x: 0, y: 0, z: 0 };
    embedded.state.landedVesselPosition = { x: 0, y: 0, z: 0 };
    expect(() => validateUniversePayload(embedded)).toThrow('intersects terrain');
    embedded.state.mode = 'flight'; embedded.state.landedPlanetId = null; embedded.state.landedVesselPosition = null;
    expect(() => validateUniversePayload(embedded)).toThrow('intersects terrain');
  });
  it('rejects JSON enum coercion and impossible in-progress landing states', () => {
    const r = open();
    r.command({ sessionId: r.sessionId, seq: 1, command: { type: 'launch' } });
    const payload = { spec: r.spec, state: structuredClone(r.state), revision: r.revision };
    expect(() => validateUniversePayload({ ...payload, state: { ...payload.state, mode: ['flight'] } })).toThrow();
    expect(() => validateUniversePayload({
      ...payload, state: { ...payload.state, events: payload.state.events.map(event => ({ ...event, type: ['launch'] })) },
    })).toThrow();
    const p = r.snapshot().system.planets[0], radial = normalize(sub(payload.state.position, p.center));
    payload.state.position = add(p.center, scale(radial, p.radius + 1000));
    payload.state.velocity = { x: 0, y: 0, z: 0 }; payload.state.landing = true;
    expect(() => validateUniversePayload(payload)).toThrow('landing');
  });
  it('serves snapshots and intent commands while rejecting untrusted origins and oversized bodies', async () => {
    const r = open(), server = createUniverseServer(r);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing server address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const snapshot = await (await fetch(`${url}/api/universe`)).json();
      expect(snapshot.state.mode).toBe('surface');
      const badOrigin = await fetch(`${url}/api/universe/command`, {
        method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
        body: JSON.stringify({ sessionId: r.sessionId, seq: 1, command: { type: 'launch' } }),
      });
      expect(badOrigin.status).toBe(403);
      const launch = await fetch(`${url}/api/universe/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: r.sessionId, seq: 1, command: { type: 'launch' } }),
      });
      expect(launch.status).toBe(200);
      expect((await launch.json()).snapshot.state.mode).toBe('flight');
      const oversized = await fetch(`${url}/api/universe/command`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extra: 'x'.repeat(9000) }),
      });
      expect(oversized.status).toBe(400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
  it('exits a managed host after bind failure without waiting for launcher stdin to close', async () => {
    const occupied = createServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw Error('Missing reserved port');
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/universe.ts'], {
      cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, TORN_VEIL_UNIVERSE_HOME: directory(), TORN_VEIL_UNIVERSE_PORT: String(address.port),
        TORN_VEIL_UNIVERSE_MANAGED: '1',
      },
    });
    let stderr = '', forced = false;
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        let timeout = setTimeout(() => { forced = true; child.kill(); }, 3500);
        child.stderr.on('data', chunk => {
          stderr += String(chunk);
          if (stderr.includes('EADDRINUSE')) {
            clearTimeout(timeout);
            timeout = setTimeout(() => { forced = true; child.kill(); }, 700);
          }
        });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', value => { clearTimeout(timeout); resolve(value); });
      });
      expect(stderr).toContain('EADDRINUSE');
      expect(forced, 'managed host remained alive after reporting its fatal bind error').toBe(false);
      expect(code).toBe(1);
    } finally {
      child.stdin.destroy();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve()));
    }
  });
});
