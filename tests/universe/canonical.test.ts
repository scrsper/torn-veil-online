import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RealmSession } from '../../src/sim/world/realms/session';
import { RealmRuntime, type RealmOperation } from '../../src/server/realmRuntime';
import { RealmJournalStore } from '../../src/server/realmJournalStore';
import { applyCanonicalUniverseCommand, canonicalUniverseView } from '../../src/server/canonicalUniverse';
import { applyTowerCommand } from '../../src/server/canonicalTower';
import { neutralInput } from '../../src/sim/world/universe/travel';
import { validateUniversePayload } from '../../src/sim/world/universe/persistence';
import { deserialize, SAVE_VERSION } from '../../src/sim/persist/save';
import { makeBody } from '../../src/sim/world/factory';
import { B } from '../../src/sim/physical/blocks';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const create = () => new RealmRuntime(new RealmSession(731));
const enter: RealmOperation = { type: 'universe', command: { type: 'enter', id: 'universe-entry-1', revision: 0 } };
const back: RealmOperation = { type: 'universe', command: { type: 'return', id: 'universe-return-1', revision: 1 } };
function canonical(r: RealmRuntime) { const data = JSON.parse(r.session.save()); delete data.savedAt; return data; }
function step(r: RealmRuntime, count: number, from = 0) { for (let i = 0; i < count; i++) r.apply({ type: 'step', now: (from + i) * 1000 / 60 }); }

describe('canonical universe residency', () => {
  it('keeps one Person, Body, inventory and quest ledger through boarding and return', () => {
    const r = create(), s = r.session, p = s.person, b = s.body, pos = { ...b.pos }, yaw = b.yaw;
    const people = s.world.persons().length, bodies = s.world.bodies().length, inventory = structuredClone(p.inventory);
    const items = structuredClone(s.world.items()), quests = structuredClone(s.world.questLedgers);
    expect(canonicalUniverseView(s)).toMatchObject({ snapshot: null, campaign: { active: false, canEnter: true, revision: 0 } });
    expect(r.apply(enter)).toEqual({ value: { ok: true } });
    expect(s.person).toBe(p); expect(s.body).toBe(b); expect(b.present).toBe(false);
    expect(s.world.primaryBody(p.id)).toBeUndefined();
    expect(s.world.activeBodies().some(x => x.id === b.id)).toBe(false);
    expect(s.world.nearbyPhysicalBodies(pos, 10).some(x => x.id === b.id)).toBe(false);
    expect(s.world.universeExpedition!.state.explorerId).toBe(p.id);
    expect(s.world.universeExpedition!.state.discoveries.every(d => d.explorerId === p.id)).toBe(true);
    expect(canonicalUniverseView(s).campaign.canReturn).toBe(true);
    expect(r.apply(back)).toEqual({ value: { ok: true } });
    expect(s.world.primaryBody(p.id)).toBe(b); expect(b.present).toBe(true);
    expect(b.pos).toEqual(pos); expect(b.yaw).toBe(yaw);
    expect(p.inventory).toEqual(inventory); expect(s.world.items()).toEqual(items);
    expect(s.world.questLedgers).toEqual(quests);
    expect(s.world.persons()).toHaveLength(people); expect(s.world.bodies()).toHaveLength(bodies);
    expect(s.world.livingIndexErrors()).toEqual([]);
    const returned = s.world.events.find(e => e.type === 'universe_returned')!;
    expect(returned.causes).toContain(s.world.universeExpedition!.enteredEventId);
  });
  it('deduplicates transition retries and refuses stale or reused identities without resetting travel', () => {
    const r = create(); r.apply(enter); step(r, 7);
    const before = canonical(r), continuation = r.checkpoint();
    expect(r.apply(enter)).toEqual({ value: { ok: true } });
    expect(canonical(r)).toEqual(before);
    expect(r.checkpoint()).toEqual(continuation);
    // Reattaching a disposable controller must not alter canonical travel or its partial cadence.
    expect(r.session.world.universeExpedition!.control.substeps).toBe(1);
    expect(r.apply({ type: 'universe', command: { type: 'return', id: 'universe-entry-1', revision: 0 } }).error).toMatch(/identity reused/);
    expect(canonical(r)).toEqual(before);
    expect(r.apply({ type: 'universe', command: { type: 'return', id: 'another-return-1', revision: 0 } }).error).toMatch(/changed/);
    expect(canonical(r)).toEqual(before);
    expect(r.apply(back).value.ok).toBe(true);
    const returned = canonical(r); expect(r.apply(back).value.ok).toBe(true); expect(canonical(r)).toEqual(returned);
    expect(continuation.realm).toBeDefined();
  });
  it.each([false, true])('returns the same body to reachable nearby ground when an NPC occupies its exact anchor (focused=%s)', focused => {
    const r = create(), s = r.session;
    if (focused) { loadFocusedGeometry(); s.adoptFocusedWorld(); }
    const p = s.person, b = s.body, anchor = { ...b.pos };
    r.apply(enter);
    const npc = s.world.persons().find(other => other.id !== p.id)!;
    s.world.primaryBody(npc.id)!.pos = { ...anchor };
    expect(canonicalUniverseView(s).campaign.canReturn).toBe(true);
    expect(r.apply(back)).toEqual({ value: { ok: true } });
    expect(s.body).toBe(b); expect(s.person).toBe(p); expect(b.present).toBe(true);
    expect(b.pos).not.toEqual(anchor); expect(b.pos.y).toBe(anchor.y);
    expect(Math.hypot(b.pos.x - anchor.x, b.pos.z - anchor.z)).toBeGreaterThanOrEqual(.8);
    expect(Math.hypot(b.pos.x - anchor.x, b.pos.z - anchor.z)).toBeLessThanOrEqual(3);
    expect(s.world.universeExpedition!.returnPos).toEqual(anchor);
    const event = s.world.event(s.world.universeExpedition!.returnedEventId)!;
    expect(event.pos).toEqual(b.pos); expect(event.data).toMatchObject({ requestedAnchor: anchor, arrival: b.pos });
    expect(new RealmSession(0, s.save()).body.pos).toEqual(b.pos);
  });
  it('refuses a fully occupied arrival neighbourhood without changing the binding or character', () => {
    const r = create(), s = r.session, anchor = { ...s.body.pos };
    r.apply(enter);
    const npc = s.world.persons().find(other => other.id !== s.person.id)!;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++)
      npc.bodies.push(makeBody(s.world, npc.id, { x: anchor.x + x, y: anchor.y, z: anchor.z + z }).id);
    const before = canonical(r), continuation = r.checkpoint();
    expect(canonicalUniverseView(s).campaign.canReturn).toBe(false);
    expect(r.apply(back).error).toMatch(/nearby safe ground are obstructed/);
    expect(canonical(r)).toEqual(before); expect(r.checkpoint()).toEqual(continuation);
  });
  it('does not resolve an occupied arrival through a wall to otherwise clear nearby ground', () => {
    const r = create(), s = r.session, anchor = { ...s.body.pos };
    r.apply(enter);
    const npc = s.world.persons().find(other => other.id !== s.person.id)!;
    for (let x = -3; x <= 0; x++) for (let z = -3; z <= 3; z++)
      npc.bodies.push(makeBody(s.world, npc.id, { x: anchor.x + x, y: anchor.y, z: anchor.z + z }).id);
    for (let z = -4; z <= 4; z++) for (let y = 1; y <= 5; y++)
      s.world.grid.set(Math.floor(anchor.x) + 1, y, Math.floor(anchor.z) + z, B.Stone);
    s.world.nav.rebuildAll();
    expect(s.world.nearbyPhysicalBodies({ x: anchor.x + 3, y: anchor.y, z: anchor.z }, .8)).toHaveLength(0);
    const before = canonical(r);
    expect(canonicalUniverseView(s).campaign.canReturn).toBe(false);
    expect(r.apply(back).error).toMatch(/nearby safe ground are obstructed/);
    expect(canonical(r)).toEqual(before);
  });
  it('advances the existing realm and NPC clock once while travel advances at 20 Hz', () => {
    const r = create(); r.apply(enter);
    const s = r.session, before = s.world.physicalTime, clock = s.world.clock.state();
    const npc = s.world.persons().find(p => p.id !== s.person.id)!;
    const think = npc.mind.thinkBudget, anchored = { ...s.body.pos }, npcStart = { ...s.world.primaryBody(npc.id)!.pos };
    step(r, 60);
    expect(s.world.physicalTime - before).toBeCloseTo(1, 10);
    expect(s.world.clock.state()).not.toEqual(clock);
    expect(npc.mind.thinkBudget).not.toBe(think);
    expect(s.world.universeExpedition!.state.tick).toBe(20);
    expect(s.body.pos).toEqual(anchored);
    step(r, 540, 60);
    expect(s.world.primaryBody(npc.id)!.pos).not.toEqual(npcStart);
    expect(s.world.events.some(e => e.actor === npc.id && e.type === 'goal_changed')).toBe(true);
    expect(s.world.universeExpedition!.state.tick).toBe(200);
    expect(s.world.livingIndexErrors()).toEqual([]);
  });
  it('blocks planar commands and Tower entry while absent, and requires home docking for return', () => {
    const r = create(); r.apply(enter); const before = canonical(r);
    for (const op of [{ type: 'move', input: { x: 1, z: 0, sprint: false } }, { type: 'interact' },
      { type: 'objectives' }, { type: 'adopt_wildlife' }, { type: 'bind', id: 'other', epoch: 'other' }] as RealmOperation[])
      expect(r.apply(op).error).toMatch(/Return from the universe/);
    expect(canonical(r)).toEqual(before);
    expect(() => applyTowerCommand(r.session, { type: 'enter', id: 'tower-enter-1', revision: 0 })).toThrow(/Return from the universe/);
    expect(r.apply({ type: 'universe_travel', command: { type: 'launch' } }).ok).toBe(true);
    const flying = canonical(r);
    expect(r.apply(back).error).toMatch(/Land on Cinderveil/);
    expect(canonical(r)).toEqual(flying);
    expect(r.session.world.events.some(e => e.type === 'universe_travel' && e.data.type === 'launch' && !e.pos)).toBe(true);
  });
  it('persists active residency and rejects malformed or contradictory absent bodies', () => {
    const r = create(); r.apply(enter); step(r, 5);
    const raw = r.session.save(), restored = new RealmRuntime(new RealmSession(0, raw), r.checkpoint());
    expect(canonical(restored)).toEqual(canonical(r)); expect(restored.session.body.present).toBe(false);
    const change = (edit: (data: any) => void) => { const data = JSON.parse(raw); edit(data); return deserialize(JSON.stringify(data)); };
    expect(change(d => { delete d.universeExpedition; })).toBeNull();
    expect(change(d => { d.universeExpedition.bodyId = 'missing-body'; })).toBeNull();
    expect(change(d => { d.universeExpedition.state.explorerId = 'fake-person'; })).toBeNull();
    expect(change(d => { d.universeExpedition.state.position = { x: 0, y: 0, z: 0 }; })).toBeNull();
    expect(change(d => { d.universeExpedition.revision++; })).toBeNull();
    expect(change(d => { d.universeExpedition.commands[0].digest = [d.universeExpedition.commands[0].digest]; })).toBeNull();
    expect(change(d => { d.version = 31; })).toBeNull();
    r.apply(back);
    const impossible = JSON.parse(r.session.save()), state = impossible.universeExpedition.state;
    state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null;
    expect(deserialize(JSON.stringify(impossible))).toBeNull();
    const old = JSON.parse(new RealmSession(732).save()); old.version = 31;
    expect(deserialize(JSON.stringify(old))?.world.playerId).toBe(old.playerId);
    expect(SAVE_VERSION).toBe(33);
  });
  it('retains inactive canonical Tower progress when boarding and reloading', () => {
    const s = new RealmSession(731), tower = s.grid.chunk('aether', 32, 32).buildings[0];
    s.body.pos = { x: tower.x + 5, y: 1, z: tower.z + 5 };
    applyTowerCommand(s, { type: 'enter', id: 'tower-fixture-entry', revision: 0 });
    // A cleared entrance may be used to return. The canonical entrance is unoccupied;
    // guardians remain distant and no Tower progress or reward is manufactured here.
    applyTowerCommand(s, { type: 'return', id: 'tower-fixture-return', revision: 1, runId: s.world.canonicalTower!.id });
    s.body.pos = { x: tower.door.x + .5, y: 1, z: tower.door.z - 5 };
    const retained = structuredClone(s.world.canonicalTower);
    applyCanonicalUniverseCommand(s, enter.command as any);
    const restored = new RealmSession(0, s.save());
    expect(restored.world.canonicalTower).toEqual(retained);
    expect(restored.body.id).toBe(s.body.id); expect(restored.body.present).toBe(false);
  });
  it('expires held input and stops motion on disconnect without teleporting or clearing progress', () => {
    const r = create(); r.apply(enter);
    r.apply({ type: 'universe_travel', command: { type: 'launch' } });
    r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } });
    step(r, 24);
    const binding = r.session.world.universeExpedition!, position = { ...binding.state.position }, discoveries = structuredClone(binding.state.discoveries);
    expect(binding.control.inputUntilTick).toBeLessThan(binding.state.tick);
    const revision = binding.snapshotRevision; r.apply({ type: 'disconnect' });
    expect(binding.state.position).toEqual(position); expect(binding.state.discoveries).toEqual(discoveries);
    expect(binding.state.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(binding.snapshotRevision).toBeGreaterThan(revision); expect(binding.revision).toBe(1);
    expect(() => validateUniversePayload({ spec: binding.spec, state: binding.state, revision: binding.snapshotRevision })).not.toThrow();
  });
  it('replays boarding, flight, partial cadence and stopping through one journal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'veil-canonical-universe-')); dirs.push(dir);
    const store = new RealmJournalStore(join(dir, 'realm.json'), 'canonical-universe-test'), r = create();
    r.apply(enter); step(r, 2); await store.checkpoint(r, 0);
    const ops: RealmOperation[] = [
      { type: 'universe_travel', command: { type: 'launch' } },
      { type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: .5 } } },
      ...Array.from({ length: 11 }, (_, i): RealmOperation => ({ type: 'step', now: 100 + i * 1000 / 60 })),
      { type: 'disconnect' },
    ];
    for (const op of ops) r.apply(op);
    await store.append(ops.map((op, i) => ({ sequence: i + 1, op })));
    const restored = store.load(731).runtime;
    expect(canonical(restored)).toEqual(canonical(r)); expect(restored.checkpoint()).toEqual(r.checkpoint());
    step(r, 5, 20); step(restored, 5, 20);
    expect(canonical(restored)).toEqual(canonical(r));
  });
});
