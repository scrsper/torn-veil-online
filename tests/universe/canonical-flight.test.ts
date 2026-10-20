import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealmSession } from '../../src/sim/world/realms/session';
import { RealmRuntime, type RealmOperation } from '../../src/server/realmRuntime';
import { RealmJournalStore } from '../../src/server/realmJournalStore';
import { canonicalUniverseView } from '../../src/server/canonicalUniverse';
import { makeItem } from '../../src/sim/world/factory';
import { arcaneBody, learnArcaneSource, ARCANE_RECOVERY_PER_SECOND } from '../../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../../src/sim/physical/equipment';
import { ACTIVITY_ENERGY_MULT, ENERGY_DRAIN_PER_HOUR } from '../../src/sim/core/physiology';
import { EXERTION_POLICY } from '../../src/sim/physical/exertion';
import { TRAVEL_DT, neutralInput, type UniverseCommand } from '../../src/sim/world/universe/travel';
import { generateSystem, landingSite } from '../../src/sim/world/universe/generation';
import { add, normalize, scale, tangentFrame } from '../../src/sim/world/planet/planet';
import { deserialize } from '../../src/sim/persist/save';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(learned = true, strong = true) {
  const s = new RealmSession(20261017);
  s.person.physiology.energy = s.person.physiology.hydration = 1;
  s.person.physiology.fatigue = s.person.physiology.bodyHeat = s.person.physiology.sleepDebt = 0;
  s.person.physiologyTraits.bodySizeFactor = s.person.physiologyTraits.conditioning = 1;
  s.person.skills.veilcraft = 0;
  if (learned) for (const id of ['book-well', 'book-ward']) {
    const source = makeItem(s.world, 'book', id, { owner: s.person.id, holder: s.person.id });
    source.arcaneSource = { version: 1, abilityId: id, kind: 'book' };
    expect(learnArcaneSource(s.world, s.person, s.body.id, source.id)).toBe('accepted');
  }
  if (strong && learned) {
    const focus = makeItem(s.world, 'book', 'Canonical flight test focus', { owner: s.person.id, holder: s.person.id });
    focus.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
    expect(changeEquipment(s.world, s.person, focus.id, true, s.body.id)).toBe('accepted');
    s.world.physicalTime += 200; arcaneBody(s.world, s.body);
  }
  const runtime = new RealmRuntime(s);
  expect(runtime.apply({ type: 'universe', command: { type: 'enter', id: 'canonical-flight-entry', revision: 0 } }))
    .toEqual({ value: { ok: true } });
  return runtime;
}
function command(r: RealmRuntime, value: UniverseCommand) { return r.apply({ type: 'universe_travel', command: value }); }
function tick(r: RealmRuntime, count = 1, wall = 0) {
  for (let i = 0; i < count * 3; i++) r.apply({ type: 'step', now: wall + i * 1000 / 60 });
}
function lift(r: RealmRuntime, count = 20) {
  for (let i = 0; i < count; i++) {
    command(r, { type: 'input', input: { ...neutralInput(), lift: 1 } }); tick(r);
  }
}
function land(r: RealmRuntime) {
  expect(command(r, { type: 'land' }).ok).toBe(true);
  for (let i = 0; i < 1500 && r.session.world.universeExpedition!.state.personalFlight; i++) tick(r);
  expect(r.session.world.universeExpedition!.state.mode).toBe('surface');
}
function canonical(r: RealmRuntime) { const saved = JSON.parse(r.session.save()); delete saved.savedAt; return saved; }

describe('canonical personal flight and body resources', () => {
  it('does not grant unknown gravity flight or initialize mana when requested', () => {
    const r = fixture(false), before = canonical(r);
    expect(command(r, { type: 'soar' }).ok).toBe(false);
    expect(canonical(r)).toEqual(before);
    expect(r.session.person.arcana).toBeUndefined();
    expect(r.session.body.arcana).toBeUndefined();
    expect(r.session.world.universeExpedition!.state.personalFlight).toBeUndefined();
  });
  it('leaves canonical state untouched when rejecting malformed, duplicate or unavailable flight commands', () => {
    const r = fixture(); expect(command(r, { type: 'soar' }).ok).toBe(true);
    const before = canonical(r);
    const commands: UniverseCommand[] = [
      { type: 'soar' }, { type: 'launch' }, { type: 'warp', systemIndex: 1 },
      { type: 'navigate', planetId: 'another-system-planet' },
      { type: 'target', planetId: 'unknown-planet' },
      { type: 'input', input: { ...neutralInput(), lift: NaN } },
    ];
    for (const input of commands) {
      expect(command(r, input).ok).toBe(false);
      expect(canonical(r)).toEqual(before);
    }
  });
  it('spends once per travel step, advances physiology and retains one canonical body and inventory', () => {
    const r = fixture(), s = r.session, p = s.person, b = s.body;
    const pos = { ...b.pos }, inventory = [...p.inventory], people = s.world.persons().length, bodies = s.world.bodies().length;
    const quests = structuredClone(s.world.questLedgers);
    expect(command(r, { type: 'soar' }).ok).toBe(true);
    const profile = canonicalUniverseView(s).campaign.flight, energy = p.physiology.energy, mana = b.arcana!.mana;
    const physicalTime = s.world.physicalTime, worldTime = s.world.now;
    r.apply({ type: 'step', now: 0 }); r.apply({ type: 'step', now: 1000 / 60 });
    expect(b.arcana!.mana).toBe(mana);
    r.apply({ type: 'step', now: 2000 / 60 });
    const flight = s.world.universeExpedition!.state.personalFlight!;
    expect(flight.manaSpent).toBeCloseTo(profile.manaPerSecond * TRAVEL_DT, 12);
    expect(b.arcana!.mana).toBeCloseTo(mana - flight.manaSpent, 12);
    expect(flight.effortSpent).toBeGreaterThan(0);
    expect(b.exertion!.load).toBeCloseTo(flight.effortSpent * EXERTION_POLICY.burstScale, 12);
    const baseline = ENERGY_DRAIN_PER_HOUR * ACTIVITY_ENERGY_MULT.craft * TRAVEL_DT * s.world.clock.timeScale / 3600;
    const work = flight.effortSpent * EXERTION_POLICY.effortSecondsPerUnit / 3600
      * ENERGY_DRAIN_PER_HOUR * (ACTIVITY_ENERGY_MULT.quarry - 1);
    expect(energy - p.physiology.energy).toBeCloseTo(baseline + work, 11);
    expect(p.physiology.hydration).toBeLessThan(1);
    expect(s.world.physicalTime - physicalTime).toBeCloseTo(TRAVEL_DT, 10);
    expect(s.world.now).toBeGreaterThan(worldTime);
    expect(s.person).toBe(p); expect(s.body).toBe(b); expect(b.present).toBe(false);
    expect(b.pos).toEqual(pos); expect(p.inventory).toEqual(inventory);
    expect(s.world.primaryBody(p.id)).toBeUndefined();
    expect(s.world.nearbyPhysicalBodies(pos, 10).some(other => other.id === b.id)).toBe(false);
    expect(s.world.persons()).toHaveLength(people); expect(s.world.bodies()).toHaveLength(bodies);
    expect(s.world.questLedgers).toEqual(quests);
  });
  it('retains soar provenance through event compaction and exact midflight reload', () => {
    const r = fixture(); command(r, { type: 'soar' }); lift(r);
    const s = r.session, binding = s.world.universeExpedition!, flight = binding.state.personalFlight!;
    const event = s.world.event(flight.startedEventId!)!;
    expect(event.type).toBe('universe_travel'); expect(event.data.type).toBe('soar');
    expect(event.causes).toContain(binding.enteredEventId);
    expect(event.causes).toContain(s.person.arcana!.learned['book-well'].eventId);
    expect(event.causes).toContain(s.person.arcana!.learned['book-ward'].eventId);
    for (let i = 0; i < 100; i++) s.world.emit('arcane_resolved', { significance: 0, category: 'world', summary: 'Disposable flight compaction fixture' });
    s.world.compactEvents(10);
    expect(s.world.event(flight.startedEventId!)).toBe(event);
    const restored = new RealmRuntime(new RealmSession(0, s.save()), r.checkpoint());
    expect(canonical(restored)).toEqual(canonical(r));
    lift(r, 8); lift(restored, 8);
    expect(canonical(restored)).toEqual(canonical(r));
    expect(restored.session.body.arcana).toEqual(s.body.arcana);
    expect(restored.session.body.exertion).toEqual(s.body.exertion);
    expect(restored.session.person.physiology).toEqual(s.person.physiology);
    const invalid = JSON.parse(s.save()); invalid.universeExpedition.state.personalFlight.startedEventId = binding.enteredEventId;
    expect(deserialize(JSON.stringify(invalid))).toBeNull();
  });
  it('replays flight costs and partial cadence through the canonical journal', async () => {
    const r = fixture(), dir = mkdtempSync(join(tmpdir(), 'veil-canonical-flight-')); dirs.push(dir);
    command(r, { type: 'soar' });
    r.apply({ type: 'step', now: 0 });
    const store = new RealmJournalStore(join(dir, 'realm.json'), 'canonical-flight-test');
    await store.checkpoint(r, 0);
    const ops: RealmOperation[] = [
      { type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), lift: .8 } } },
      ...Array.from({ length: 13 }, (_, i): RealmOperation => ({ type: 'step', now: 100 + i * 1000 / 60 })),
      { type: 'disconnect' },
    ];
    for (const op of ops) r.apply(op);
    await store.append(ops.map((op, i) => ({ sequence: i + 1, op })));
    const restored = store.load(20261017).runtime;
    expect(canonical(restored)).toEqual(canonical(r));
    expect(restored.checkpoint()).toEqual(r.checkpoint());
  });
  it('rejects a cross-system personal-flight forgery and replenished or erased flight costs', () => {
    const r = fixture(); command(r, { type: 'soar' }); lift(r, 10);
    const raw = r.session.save();
    const reject = (edit: (saved: any) => void) => {
      const saved = JSON.parse(raw); edit(saved);
      expect(deserialize(JSON.stringify(saved)) === null).toBe(true);
    };
    reject(saved => {
      const binding = saved.universeExpedition, state = binding.state;
      const planet = generateSystem(binding.spec, 1).planets[0], local = landingSite(planet), up = normalize(local);
      state.systemIndex = 1; state.position = add(planet.center, add(local, scale(up, 3)));
      state.up = up; state.forward = tangentFrame(up).north; state.velocity = { x: 0, y: 0, z: 0 };
      state.targetPlanetId = planet.id;
    });
    reject(saved => { saved.universeExpedition.state.personalFlight.manaSpent = 0; });
    reject(saved => { saved.bodies.find((body: any) => body.id === r.session.body.id).arcana.mana += 1; });
  });
  it('recovers only elapsed grounded ticks and never grants offline catch-up or airborne replenishment', () => {
    const r = fixture(false, false);
    // A character without learning remains without mana even after grounded time.
    tick(r, 20); expect(r.session.body.arcana).toBeUndefined();
    const flying = fixture(true, false); command(flying, { type: 'soar' }); lift(flying, 25);
    const airborneMana = flying.session.body.arcana!.mana;
    tick(flying, 5);
    expect(flying.session.body.arcana!.mana).toBeLessThan(airborneMana);
    land(flying);
    const s = flying.session, landedMana = s.body.arcana!.mana, spentBreath = s.body.exertion!.load;
    const loaded = new RealmRuntime(new RealmSession(0, s.save()), flying.checkpoint());
    expect(loaded.session.body.arcana!.mana).toBe(landedMana);
    tick(loaded, 1, 86400000);
    expect(loaded.session.body.arcana!.mana - landedMana).toBeCloseTo(TRAVEL_DT * ARCANE_RECOVERY_PER_SECOND, 12);
    tick(loaded, 25, 86401000);
    expect(loaded.session.body.exertion!.load).toBeLessThan(spentBreath);
    const landing = loaded.session.world.events.filter(e => e.type === 'universe_travel' && e.data.type === 'land').at(-1)!;
    expect(landing.causes.some(id => loaded.session.world.event(id)?.data.type === 'soar')).toBe(true);
    expect(landing.data.manaSpent).toBeGreaterThan(0);
  });
  it('keeps the parked vessel and identity after a canonical crossing, landing and save/reload', () => {
    const r = fixture(), s = r.session, binding = s.world.universeExpedition!, home = { ...binding.state.position };
    const planets = generateSystem(binding.spec, 0).planets, target = planets[1];
    command(r, { type: 'soar' });
    expect(command(r, { type: 'navigate', planetId: target.id }).ok).toBe(true);
    for (let i = 0; i < 4500 && binding.state.personalFlight && binding.state.cruise; i++) tick(r);
    if (binding.state.personalFlight) land(r);
    expect(binding.state.landedPlanetId).toBe(target.id);
    expect(binding.state.parkedVessel).toEqual({ systemIndex: 0, planetId: planets[0].id, position: home });
    expect(binding.state.landedVesselPosition).toBeNull();
    expect(command(r, { type: 'launch' }).ok).toBe(false);
    const restored = new RealmSession(0, s.save()), other = restored.world.universeExpedition!;
    expect(other.state.parkedVessel).toEqual(binding.state.parkedVessel);
    expect(other.state.landedPlanetId).toBe(target.id);
    expect(restored.person.id).toBe(s.person.id); expect(restored.body.id).toBe(s.body.id);
    expect(restored.person.inventory).toEqual(s.person.inventory);
    expect(restored.body.arcana).toEqual(s.body.arcana);
    expect(canonicalUniverseView(restored).campaign.canReturn).toBe(false);
  }, 20000);
});
