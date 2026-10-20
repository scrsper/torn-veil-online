import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { RealmRuntime, type RealmOperation } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';
import { RealmUniverseApi } from '../../src/server/realmUniverseApi';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const runtime = new RealmRuntime(new RealmSession(731));
  const control = {
    token: 'controller-one', ready: true, durable: '', applications: [] as RealmOperation[],
    persist: async () => { control.durable = runtime.session.save(); },
    arrived: null as (() => void) | null,
  };
  let api!: RealmUniverseApi;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    control.arrived?.();
    void api.handle(req, res, req.url!).then(handled => { if (!handled) res.writeHead(404).end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing test listener');
  const origin = `http://127.0.0.1:${address.port}`;
  api = new RealmUniverseApi({
    session: () => runtime.session, token: () => control.token, ready: () => control.ready,
    apply: operation => { control.applications.push(operation); return runtime.apply(operation); },
    persist: () => control.persist(),
  }, address.port);
  closers.push(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const headers = () => ({ origin, 'content-type': 'application/json', 'x-realms-controller': control.token });
  const post = (path: string, value: unknown) => fetch(`${origin}/realms/universe/${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(value),
  });
  const enter = () => post('transition', { type: 'enter', id: 'test-enter-001', revision: 0 });
  const command = (seq: number, value: unknown) => post('command', { sessionId: control.token, seq, command: value });
  return { runtime, control, api, origin, headers, post, enter, command };
}

describe('canonical universe HTTP controller and persistence boundaries', () => {
  it('serves settlement geometry read-only under the current controller', async () => {
    const f = await fixture();
    const response = await fetch(`${f.origin}/realms/universe/settlements`, { headers: f.headers() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe(1);
    expect(body.patches).toHaveLength(2);
    expect(body.chunks.length).toBeGreaterThan(0);
    expect((await f.post('settlements', { type: 'enter', id: 'readonly-route-001', revision: 0 })).status).toBe(403);
    expect(f.control.applications).toHaveLength(0);
    f.api.busy = true;
    const saving = await fetch(`${f.origin}/realms/universe/settlements`, { headers: f.headers() });
    expect(saving.status).toBe(503);
    expect(saving.headers.get('x-tv-universe-condition')).toBe('saving-crossing');
    f.api.busy = false;
    f.control.token = 'replacement-controller';
    expect((await fetch(`${f.origin}/realms/universe/settlements`, {
      headers: { 'x-realms-controller': 'controller-one' },
    })).status).toBe(409);
  });
  it('denies requests without a current controller', async () => {
    const f = await fixture();
    f.control.token = '';
    const response = await fetch(`${f.origin}/realms/universe`, { headers: { 'x-realms-controller': 'old-controller' } });
    expect(response.status).toBe(409);
    expect(response.headers.get('x-tv-universe-condition')).toBeNull();
    expect(f.control.applications).toHaveLength(0);
  });
  it('acknowledges a valid transition only after the actual canonical state is persisted', async () => {
    const f = await fixture(), response = await f.enter(), body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.campaign.active).toBe(true);
    const restored = new RealmSession(0, f.control.durable);
    expect(restored.world.universeExpedition?.active).toBe(true);
    expect(restored.person.id).toBe(f.runtime.session.person.id);
    expect(body.snapshot.state.explorerId).toBe(restored.person.id);
  });
  it('unwraps a rejected travel command and ignores duplicate command sequences', async () => {
    const f = await fixture();
    expect((await f.enter()).status).toBe(200);
    const invalidLand = await f.command(1, { type: 'land' });
    expect(invalidLand.status).toBe(409);
    expect((await invalidLand.json()).ok).toBe(false);
    const launched = await f.command(2, { type: 'launch' });
    expect(launched.status).toBe(200);
    const applied = f.control.applications.length;
    const duplicate = await f.command(2, { type: 'land' });
    expect(duplicate.status).toBe(409);
    expect(f.control.applications).toHaveLength(applied);
    expect(f.runtime.session.world.universeExpedition?.state.mode).toBe('flight');
  });
  it('rejects an oversized body before any canonical operation', async () => {
    const f = await fixture();
    const response = await fetch(`${f.origin}/realms/universe/transition`, {
      method: 'POST', headers: f.headers(), body: JSON.stringify({ padding: 'x'.repeat(8300) }),
    });
    expect(response.status).toBe(413);
    expect(f.control.applications).toHaveLength(0);
  });
  it('rechecks the owner after awaiting a partially received request body', async () => {
    const f = await fixture(), arrived = deferred();
    f.control.arrived = arrived.resolve;
    const body = JSON.stringify({ type: 'enter', id: 'slow-enter-001', revision: 0 });
    const result = new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(`${f.origin}/realms/universe/transition`, {
        method: 'POST', headers: { ...f.headers(), 'content-length': Buffer.byteLength(body) },
      }, res => {
        let raw = '';
        res.on('data', chunk => { raw += String(chunk); });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(raw) }));
      });
      req.once('error', reject);
      req.write(body.slice(0, 8));
      void arrived.promise.then(() => {
        f.control.token = 'controller-two';
        req.end(body.slice(8));
      });
    });
    const response = await result;
    expect(response.status).toBe(409);
    expect(response.body.snapshot).toBeUndefined();
    expect(f.control.applications).toHaveLength(0);
  });
  it('returns no success snapshot when durable persistence fails', async () => {
    const f = await fixture();
    f.control.persist = async () => { f.control.ready = false; throw Error('Injected journal failure'); };
    const response = await f.enter(), body = await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get('x-tv-universe-condition')).toBeNull();
    expect(body.ok).toBe(false);
    expect(body.snapshot).toBeUndefined();
  });
  it('blocks another POST and GET while the first operation is becoming durable', async () => {
    const f = await fixture(), enteredPersist = deferred(), commit = deferred();
    f.control.persist = async () => {
      const pending = f.runtime.session.save();
      enteredPersist.resolve(); await commit.promise; f.control.durable = pending;
    };
    const first = f.enter();
    await enteredPersist.promise;
    try {
      expect(f.api.busy).toBe(true);
      const blockedCommand = await f.command(1, { type: 'launch' });
      expect(blockedCommand.status).toBe(409);
      expect(blockedCommand.headers.get('x-tv-universe-condition')).toBeNull();
      const get = await fetch(`${f.origin}/realms/universe`, { headers: f.headers() });
      expect(get.status).toBe(503);
      // The condition is available before consuming a body that a page reload
      // can make unavailable to browser diagnostics. It is not a recovery claim.
      expect(get.headers.get('x-tv-universe-condition')).toBe('saving-crossing');
      expect(get.headers.get('cache-control')).toBe('no-store');
      expect(await get.json()).toEqual({ error: 'Saving the crossing. Try again shortly.' });
      expect(f.control.applications).toHaveLength(1);
    } finally { commit.resolve(); }
    expect((await first).status).toBe(200);
    expect(f.api.busy).toBe(false);
    const recovered = await fetch(`${f.origin}/realms/universe`, { headers: f.headers() });
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get('x-tv-universe-condition')).toBeNull();
    expect((await recovered.json()).campaign.active).toBe(true);
  });
  it('never marks a failed host as temporary saving even if its busy fence remains set', async () => {
    const f = await fixture();
    f.api.busy = true; f.control.ready = false;
    for (const path of ['/realms/universe', '/realms/universe/settlements']) {
      const response = await fetch(`${f.origin}${path}`, { headers: f.headers() });
      expect(response.status).toBe(503);
      expect(response.headers.get('x-tv-universe-condition')).toBeNull();
      expect(await response.json()).toEqual({ error: 'Saving or simulation failed. Restart the world to recover its durable journal.' });
    }
    expect(f.control.applications).toHaveLength(0);
  });
  it('does not acknowledge an old owner with a new-owner snapshot after async persistence', async () => {
    const f = await fixture(), enteredPersist = deferred(), commit = deferred();
    f.control.persist = async () => { enteredPersist.resolve(); await commit.promise; };
    const responsePromise = f.enter();
    await enteredPersist.promise;
    f.runtime.apply({ type: 'disconnect' });
    f.control.token = 'controller-two';
    commit.resolve();
    const response = await responsePromise, body = await response.json();
    expect(response.status).toBe(409);
    expect(body.snapshot).toBeUndefined();
    expect(body.campaign).toBeUndefined();
  });
  it('rejects an acknowledgement if a concurrent host fault occurs during persistence', async () => {
    const f = await fixture();
    f.control.persist = async () => { f.control.ready = false; };
    const response = await f.enter(), body = await response.json();
    expect(response.status).toBe(503);
    expect(body.snapshot).toBeUndefined();
  });
  it('fences a physical touchdown until its outcome is durable', async () => {
    const f = await fixture();
    expect((await f.enter()).status).toBe(200);
    expect((await f.command(1, { type: 'launch' })).status).toBe(200);
    expect((await f.command(2, { type: 'land' })).status).toBe(200);
    for (let i = 0; i < 3; i++) f.runtime.apply({ type: 'step', now: i * 17 });
    expect(f.runtime.session.world.universeExpedition!.state.mode).toBe('surface');
    const enteredPersist = deferred(), commit = deferred();
    f.control.persist = async () => {
      const pending = f.runtime.session.save();
      enteredPersist.resolve(); await commit.promise; f.control.durable = pending;
    };
    const outcome = f.api.persistOutcome();
    await enteredPersist.promise;
    try {
      const pending = await fetch(`${f.origin}/realms/universe`, { headers: f.headers() });
      expect(pending.status).toBe(503);
      expect((await pending.json()).snapshot).toBeUndefined();
    } finally { commit.resolve(); }
    await outcome;
    const response = await fetch(`${f.origin}/realms/universe`, { headers: f.headers() });
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.state.mode).toBe('surface');
    expect(new RealmSession(0, f.control.durable).world.universeExpedition!.state.events.at(-1)?.type).toBe('land');
  });
  it('keeps outcome snapshots unavailable after an outcome persistence failure', async () => {
    const f = await fixture();
    expect((await f.enter()).status).toBe(200);
    f.control.persist = async () => { f.control.ready = false; throw Error('Injected contact save failure'); };
    await f.api.persistOutcome();
    const response = await fetch(`${f.origin}/realms/universe`, { headers: f.headers() });
    expect(response.status).toBe(503);
    expect((await response.json()).snapshot).toBeUndefined();
    expect(f.api.busy).toBe(false);
  });
  it('returns a durable town manifestation with the same identity after docking', async () => {
    const f = await fixture(), personId = f.runtime.session.person.id, bodyId = f.runtime.session.body.id;
    expect((await f.enter()).status).toBe(200);
    const response = await f.post('transition', { type: 'return', id: 'test-return-001', revision: 1 });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.campaign.active).toBe(false);
    expect(body.campaign.personId).toBe(personId);
    expect(body.campaign.bodyId).toBe(bodyId);
    const restored = new RealmSession(0, f.control.durable);
    expect(restored.person.id).toBe(personId);
    expect(restored.body.id).toBe(bodyId);
    expect(restored.body.present).toBe(true);
    expect(restored.world.universeExpedition!.active).toBe(false);
  });
});
