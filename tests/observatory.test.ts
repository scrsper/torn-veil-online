import { describe, it, expect } from 'vitest';
import { createScenario, SCENARIOS } from '../src/observatory/scenarios';
import { inspectPerson, causalGraph, inspectEvent, settlementMetrics, worldOverview, resourceState } from '../src/observatory/readers';
import { makeItem } from '../src/sim/world/factory';
import { canonicalDigest } from '../src/observatory/fingerprint';
import { Observatory } from '../src/observatory/runtime';
import { createObservatoryServer } from '../src/observatory/server';
import { createTestWorld } from './helpers/world';

describe('Observatory isolated world and readers', () => {
  it('views are detached and read-only; no single-body inspector assumption', () => {
    const f = createScenario('ordinary', 10), p = f.world.persons().find(p => p.alive)!;
    const before = canonicalDigest(f.world), inspector = inspectPerson(f.world, p.id)!;
    worldOverview(f.world); settlementMetrics(f.world); inspectEvent(f.world, f.world.events[0].id);
    expect(canonicalDigest(f.world)).toBe(before);
    inspector.truth.overview.name = 'tampered'; expect(p.name).not.toBe('tampered'); expect(inspector.truth.overview.bodyManifestations).toHaveLength(p.bodies.length);
  }, 30000);
  it('causal graph keeps sibling causes separate, finds forward effects, and discloses missing ancestry', () => {
    const { world } = createTestWorld(); const a = world.emit('greeting'), b = world.emit('greeting'), c = world.emit('conversation', { causes: [a.id, b.id] }), d = world.emit('told', { causes: [c.id] });
    const graph = causalGraph(world, c.id); expect(graph.edges.map(e => `${e.from}/${e.to}`)).toEqual(expect.arrayContaining([`${a.id}/${c.id}`, `${b.id}/${c.id}`, `${c.id}/${d.id}`]));
    expect(graph.edges.some(e => e.from === a.id && e.to === b.id)).toBe(false);
    expect(causalGraph(world, a.id).unknown).not.toHaveLength(0); expect(causalGraph(world, c.id, 2).truncated).toBe(true);
  });
  it('resource reports include physical coin items as well as spendable wealth', () => {
    const { world } = createTestWorld(), before = resourceState(world).currency;
    makeItem(world, 'coins', 'loose silver', { quantity: 17, pos: { x: 2, y: 1, z: 2 } });
    expect(resourceState(world).currency).toBe(before + 17);
  });
  it.each(SCENARIOS.map(s => s.id))('builds repeatable initial conditions for %s', id => {
    const a = createScenario(id, 123), b = createScenario(id, 123); expect(canonicalDigest(a.world)).toBe(canonicalDigest(b.world));
    if (id === 'witnessed-theft') expect(a.world.event(a.initialEvents[0])!.perceivedBy.length).toBeGreaterThan(0);
    if (id === 'unwitnessed-theft') expect(a.world.event(a.initialEvents[0])!.perceivedBy).toEqual([]);
  }, 30000);
  it('replay and save continuation checks pass and do not advance the inspected world', () => {
    const r = new Observatory(), before = canonicalDigest(r.world);
    try { expect(r.verify().map(c => c.status)).toEqual(['PASS', 'PASS']); expect(canonicalDigest(r.world)).toBe(before); expect(r.health.status).not.toBe('GREEN'); }
    finally { r.close(); }
  }, 30000);
  it('checkpoint is in-memory; cancellation of a bounded advance leaves an inspectable partial report', async () => {
    const r = new Observatory();
    try { r.saveCheckpoint(); const raw = canonicalDigest(r.world); const pending = r.advance(3600, true); r.cancel(); await pending; expect(r.report).toMatchObject({ completed: false }); r.loadCheckpoint(); expect(canonicalDigest(r.world)).toBe(raw); expect(() => r.reset('live', 1)).toThrow(); }
    finally { r.close(); }
  }, 30000);
  it('loopback API rejects foreign origins, missing session tokens, arbitrary paths and malformed intents', async () => {
    const { server, runtime } = createObservatoryServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
    try {
      const html = await (await fetch(base)).text(), token = html.match(/name="observatory-token" content="([^"]+)"/)![1];
      expect((await fetch(base + '/api/state')).status).toBe(403);
      expect((await fetch(base + '/api/state', { headers: { 'X-Observatory-Token': token, Origin: 'https://evil.example' } })).status).toBe(403);
      expect((await fetch(base + '/api/state', { headers: { 'X-Observatory-Token': token } })).status).toBe(200);
      expect((await fetch(base + '/api/reset', { method: 'POST', headers: { 'X-Observatory-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: '../../live', seed: 10 }) })).status).toBe(400);
      expect((await fetch(base + '/AGENTS.md', { headers: { 'X-Observatory-Token': token } })).status).toBe(404);
      expect((await fetch(base + '/api/validation?run=../../live', { headers: { 'X-Observatory-Token': token } })).status).toBe(400);
      expect((await fetch(base + '/api/validation-load', { method: 'POST', headers: { 'X-Observatory-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ run: '../../live' }) })).status).toBe(400);
      expect((await (await fetch(base + '/health')).json()).diagnosticVersion).toBe(3);
    } finally { runtime.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30000);
});
