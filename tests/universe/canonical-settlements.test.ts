import { describe, expect, it } from 'vitest';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';
import { canonicalUniverseView, type CanonicalUniverseCommand } from '../../src/server/canonicalUniverse';
import { bodyPointToUniverse, universePointToBody } from '../../src/server/universeSettlements';
import { planetDirectionToSettlement, settlementDirectionToPlanet } from '../../src/sim/world/universe/settlements';
import { applyTowerCommand } from '../../src/server/canonicalTower';
import { arcaneBody, learnArcaneSource } from '../../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../../src/sim/physical/equipment';
import { makeItem } from '../../src/sim/world/factory';
import { neutralInput, createTravelState } from '../../src/sim/world/universe/travel';
import { universeSpec } from '../../src/sim/world/universe/generation';
import { dot, length, planetSpec, sub } from '../../src/sim/world/planet/planet';
import { realmAt, spawnPoint } from '../../src/sim/world/realms/layout';
import { B } from '../../src/sim/physical/blocks';
import { deserialize } from '../../src/sim/persist/save';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';

function fixture(learned = false) {
  const s = new RealmSession(20261017);
  s.body.pos = spawnPoint('aether'); s.body.yaw = Math.PI;
  s.person.physiology.energy = s.person.physiology.hydration = 1;
  s.person.physiology.fatigue = s.person.physiology.sleepDebt = s.person.physiology.bodyHeat = 0;
  if (learned) {
    for (const id of ['book-well', 'book-ward']) {
      const source = makeItem(s.world, 'book', id, { holder: s.person.id, owner: s.person.id });
      source.arcaneSource = { version: 1, abilityId: id, kind: 'book' };
      expect(learnArcaneSource(s.world, s.person, s.body.id, source.id)).toBe('accepted');
    }
    const focus = makeItem(s.world, 'book', 'Settlement flight test focus', { holder: s.person.id, owner: s.person.id });
    focus.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
    expect(changeEquipment(s.world, s.person, focus.id, true, s.body.id)).toBe('accepted');
    s.world.physicalTime += 200; arcaneBody(s.world, s.body);
  }
  return new RealmRuntime(s);
}
function transition(r: RealmRuntime, type: CanonicalUniverseCommand['type'], id: string, revision: number) {
  return r.apply({ type: 'universe', command: { type, id, revision } });
}
function tick(r: RealmRuntime, count = 1) {
  for (let i = 0; i < count * 3; i++) r.apply({ type: 'step', now: i * 1000 / 60 });
}
function stable(r: RealmRuntime) { const saved = JSON.parse(r.session.save()); delete saved.savedAt; return saved; }
function near(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  expect(length(sub(actual, expected))).toBeLessThan(1e-6);
}
function doorwayFixture() {
  const r = fixture(), s = r.session;
  const buildings = [];
  for (let x = 31; x <= 33; x++) for (let z = 31; z <= 33; z++)
    buildings.push(...s.grid.chunk('aether', x, z).buildings);
  const building = buildings.find(b => b.use !== 'tower' && b.door.z === b.z)!;
  const door = building.door;
  s.grid.setDoorOpen(door.x, door.y, door.z, true);
  s.body.pos = { x: door.x + .5, y: door.y, z: door.z + .5 };
  s.body.yaw = 0; // This north-edge door opens toward negative Z.
  return { r, s, door };
}

describe('canonical settlement and universe handoff', () => {
  it.each([false, true])('previews the current mapped feet and facing, then enters the same pose (focused=%s)', focused => {
    const r = fixture(), s = r.session, body = s.body, person = s.person;
    if (focused) { loadFocusedGeometry(); s.adoptFocusedWorld(); }
    const pos = { ...body.pos }, realm = realmAt(pos.x, pos.z)!, before = stable(r);
    const view = canonicalUniverseView(s), preview = view.campaign.preview!;
    expect(view.snapshot).toBeNull(); expect(view.campaign.canExplore).toBe(true);
    near(preview.state.position, bodyPointToUniverse(s, realm, pos));
    expect(length(sub(preview.state.landedVesselPosition!, preview.state.position))).toBeGreaterThan(7.9);
    const facing = settlementDirectionToPlanet(planetSpec(s.world.seed), realm, pos,
      { x: -Math.sin(body.yaw), y: 0, z: -Math.cos(body.yaw) });
    expect(dot(preview.state.forward, facing)).toBeCloseTo(1, 8);
    expect(stable(r)).toEqual(before);
    expect(transition(r, 'explore', 'surface-explore-1', 0)).toEqual({ value: { ok: true } });
    const binding = s.world.universeExpedition!;
    near(binding.state.position, preview.state.position);
    near(binding.state.forward, preview.state.forward);
    expect(binding.state.settlementRevision).toBe(1);
    expect(binding.state.mode).toBe('surface'); expect(binding.state.personalFlight).toBeUndefined();
    expect(s.person).toBe(person); expect(s.body).toBe(body); expect(body.present).toBe(false);
    expect(body.pos).toEqual(pos); expect(person.arcana).toBeUndefined(); expect(body.arcana).toBeUndefined();
    expect(s.world.primaryBody(person.id)).toBeUndefined();
    expect(s.world.event(binding.enteredEventId)!.data.gateway).toBe('continuous-surface');
    expect(new RealmSession(0, s.save()).world.universeExpedition!.state).toEqual(binding.state);
  });
  it('keeps a retained vessel berth when reentering beside it instead of silently relocating it', () => {
    const r = fixture(), s = r.session;
    expect(transition(r, 'explore', 'berth-first-entry', 0)).toEqual({ value: { ok: true } });
    const berth = structuredClone(s.world.universeExpedition!.state.landedVesselPosition!);
    expect(transition(r, 'return', 'berth-first-return', 1)).toEqual({ value: { ok: true } });
    s.body.pos = universePointToBody(s, berth)!.position;
    const restored = new RealmSession(0, s.save());
    const preview = canonicalUniverseView(restored).campaign.preview!;
    expect(preview.state.landedVesselPosition).toEqual(berth);
    near(preview.state.position, berth);
  });
  it('ascends directly from the same town pose and rejects unlearned ascent without a partial transition', () => {
    const ordinary = fixture(), saved = stable(ordinary), continuation = ordinary.checkpoint();
    expect(transition(ordinary, 'ascend', 'unlearned-ascent-1', 0).error).toBeTruthy();
    expect(stable(ordinary)).toEqual(saved); expect(ordinary.checkpoint()).toEqual(continuation);
    const r = fixture(true), s = r.session, preview = canonicalUniverseView(s).campaign.preview!, b = s.body, p = s.person;
    const mana = b.arcana!.mana;
    expect(transition(r, 'ascend', 'direct-ascent-1', 0)).toEqual({ value: { ok: true } });
    const state = s.world.universeExpedition!.state;
    near(state.position, preview.state.position);
    expect(state.personalFlight?.bodyId).toBe(b.id);
    expect(s.person).toBe(p); expect(s.body).toBe(b); expect(b.arcana!.mana).toBe(mana);
    r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), lift: 1 } } });
    tick(r);
    expect(length(sub(state.position, preview.state.position))).toBeGreaterThan(0);
    expect(length(sub(state.position, preview.state.position))).toBeLessThan(1);
    expect(b.arcana!.mana).toBeLessThan(mana);
    expect(b.present).toBe(false);
    const before = stable(r), control = r.checkpoint();
    expect(transition(r, 'ascend', 'direct-ascent-1', 0)).toEqual({ value: { ok: true } });
    expect(stable(r)).toEqual(before); expect(r.checkpoint()).toEqual(control);
    expect(new RealmSession(0, s.save()).world.universeExpedition!.state.personalFlight).toEqual(state.personalFlight);
  });
  it('preserves existing Tower history, inventory and quest state through ordinary save, mapped entry and return', () => {
    const r = fixture(true), s = r.session, tower = s.grid.chunk('aether', 32, 32).buildings.find(b => b.use === 'tower')!;
    s.body.pos = { x: tower.x + 5, y: 1, z: tower.z + 5 };
    applyTowerCommand(s, { type: 'enter', id: 'mapped-tower-entry', revision: 0 });
    applyTowerCommand(s, { type: 'return', id: 'mapped-tower-return', revision: 1, runId: s.world.canonicalTower!.id });
    s.body.pos = spawnPoint('aether'); s.body.yaw = Math.PI;
    const persisted = new RealmRuntime(new RealmSession(0, s.save()));
    const bodyId = persisted.session.body.id, personId = persisted.session.person.id;
    const progress = structuredClone(persisted.session.world.canonicalTower);
    const quests = structuredClone(persisted.session.world.questLedgers);
    const inventory = structuredClone(persisted.session.person.inventory);
    const items = structuredClone(persisted.session.world.items());
    expect(transition(persisted, 'explore', 'tower-surface-entry', 0)).toEqual({ value: { ok: true } });
    const restored = new RealmRuntime(new RealmSession(0, persisted.session.save()), persisted.checkpoint());
    expect(transition(restored, 'return', 'tower-surface-return', 1)).toEqual({ value: { ok: true } });
    expect(restored.session.body.id).toBe(bodyId); expect(restored.session.person.id).toBe(personId);
    expect(restored.session.world.canonicalTower).toEqual(progress);
    expect(restored.session.world.questLedgers).toEqual(quests);
    expect(restored.session.person.inventory).toEqual(inventory);
    expect(restored.session.world.items()).toEqual(items);
  });
  it('returns to the actual mapped town location after walking instead of the original entry anchor', () => {
    const r = fixture(), s = r.session, start = { ...s.body.pos }, body = s.body;
    expect(transition(r, 'explore', 'walking-explore-1', 0)).toEqual({ value: { ok: true } });
    for (let i = 0; i < 12; i++) {
      r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } }); tick(r);
    }
    for (let i = 0; i < 8; i++) {
      r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), yaw: .8 } } }); tick(r);
    }
    const state = s.world.universeExpedition!.state, mapped = universePointToBody(s, state.position)!;
    const direction = planetDirectionToSettlement(planetSpec(s.world.seed), mapped.realm, state.position, state.forward);
    expect(mapped).not.toBeNull();
    expect(length(sub(mapped.position, start))).toBeGreaterThan(2);
    expect(s.world.nearbyPhysicalBodies(mapped.position, .8).some(b => b.id !== body.id)).toBe(false);
    expect(canonicalUniverseView(s).campaign.canReturn).toBe(true);
    expect(transition(r, 'return', 'walking-return-1', 1)).toEqual({ value: { ok: true } });
    near(body.pos, mapped.position);
    expect((-Math.sin(body.yaw) * direction.x - Math.cos(body.yaw) * direction.z)
      / Math.hypot(direction.x, direction.z)).toBeCloseTo(1, 8);
    expect(length(sub(body.pos, start))).toBeGreaterThan(2);
    expect(s.world.primaryBody(s.person.id)).toBe(body);
    const returned = s.world.event(s.world.universeExpedition!.returnedEventId!)!;
    near(returned.pos!, mapped.position);
    near(returned.data.requestedAnchor, mapped.position);
    expect(new RealmSession(0, s.save()).body.pos).toEqual(body.pos);
  });
  it('uses live canonical walls during mapped walking and refuses a save that places the body inside them', () => {
    const r = fixture(), s = r.session, start = { ...s.body.pos };
    expect(transition(r, 'explore', 'wall-explore-1', 0)).toEqual({ value: { ok: true } });
    const wallZ = Math.floor(start.z) + 3;
    for (let x = Math.floor(start.x) - 4; x <= Math.floor(start.x) + 4; x++)
      for (let y = 1; y <= 5; y++) s.grid.set(x, y, wallZ, B.Stone);
    for (let i = 0; i < 24; i++) {
      r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } }); tick(r);
    }
    const state = s.world.universeExpedition!.state, mapped = universePointToBody(s, state.position)!;
    expect(mapped.position.z).toBeLessThan(wallZ);
    expect(mapped.position.z).toBeGreaterThan(start.z);
    const raw = JSON.parse(s.save());
    raw.universeExpedition.state.position = bodyPointToUniverse(s, 'aether', { x: start.x, y: 1, z: wallZ + .5 });
    expect(deserialize(JSON.stringify(raw)) === null).toBe(true);
  });
  it('loads inactive expedition history after its old doorway closes, then reenters at the current live body', () => {
    const { r, s, door } = doorwayFixture(), bodyId = s.body.id, personId = s.person.id;
    expect(transition(r, 'explore', 'door-history-entry', 0)).toEqual({ value: { ok: true } });
    expect(transition(r, 'return', 'door-history-return', 1)).toEqual({ value: { ok: true } });
    expect(deserialize(s.save()) === null).toBe(false);
    const historical = structuredClone(s.world.universeExpedition!);
    s.body.pos = spawnPoint('aether');
    s.grid.setDoorOpen(door.x, door.y, door.z, false);
    const saved = s.save();
    expect(deserialize(saved) === null).toBe(false);
    const unsupported = JSON.parse(saved);
    unsupported.universeExpedition.state.position = bodyPointToUniverse(s, 'aether',
      { x: door.x + .5, y: door.y + .2, z: door.z + .5 });
    expect(deserialize(JSON.stringify(unsupported))).toBeNull();
    const resumed = new RealmRuntime(new RealmSession(0, saved));
    expect(resumed.session.world.universeExpedition!.state).toEqual(historical.state);
    expect(resumed.session.body.id).toBe(bodyId); expect(resumed.session.person.id).toBe(personId);
    const preview = canonicalUniverseView(resumed.session).campaign.preview!;
    near(preview.state.position, bodyPointToUniverse(resumed.session, 'aether', resumed.session.body.pos));
    expect(transition(resumed, 'explore', 'door-history-reentry', 2)).toEqual({ value: { ok: true } });
    near(resumed.session.world.universeExpedition!.state.position, preview.state.position);
  });
  it('reloads a returned traveler supported by raised source paving around a lower mortar seam', () => {
    const r = fixture(), s = r.session;
    loadFocusedGeometry(); s.adoptFocusedWorld();
    // Exact source-paving contact reached by the normal browser flight/return
    // journey. The center is over mortar, while the capsule rests on stones.
    const feet = { x: 11312.488024842572, y: 1.0625, z: 3093.1147530743033 };
    s.body.pos = { ...feet };
    const geometry = s.grid.movementGeometryAt(feet.x, feet.z)!;
    expect(geometry.supportAt(feet.x, feet.z, feet.y, .015)).toBeNull();
    expect(geometry.supportAt(feet.x, feet.z, feet.y, .55)).toBe(feet.y);
    expect(transition(r, 'explore', 'paving-history-entry', 0)).toEqual({ value: { ok: true } });
    expect(deserialize(s.save()) === null).toBe(false);
    expect(transition(r, 'return', 'paving-history-return', 1)).toEqual({ value: { ok: true } });
    const saved = s.save();
    expect(deserialize(saved) === null).toBe(false);
    const restored = new RealmSession(0, saved);
    expect(restored.body.pos).toEqual(s.body.pos);
    expect(restored.world.universeExpedition!.state).toEqual(s.world.universeExpedition!.state);
    const unsupported = JSON.parse(saved);
    unsupported.universeExpedition.state.position = bodyPointToUniverse(s, 'brass', { ...feet, y: feet.y + .2 });
    expect(deserialize(JSON.stringify(unsupported))).toBeNull();
  });
  it('refuses focused geometry adoption after mapped travel without changing history, vessel or live world', () => {
    const r = fixture(), s = r.session;
    loadFocusedGeometry(); s.body.pos = spawnPoint('brass');
    expect(transition(r, 'explore', 'migration-mapped-entry', 0)).toEqual({ value: { ok: true } });
    expect(transition(r, 'return', 'migration-mapped-return', 1)).toEqual({ value: { ok: true } });
    const before = stable(r), control = r.checkpoint(), grid = s.grid;
    expect(() => r.apply({ type: 'adopt_focused' })).toThrow(/parked vessel require coordinated geometry migration/);
    expect(stable(r)).toEqual(before); expect(r.checkpoint()).toEqual(control); expect(s.grid).toBe(grid);
    expect(new RealmSession(0, s.save()).world.universeExpedition).toEqual(s.world.universeExpedition);
  });
  it('preserves legacy gateway adoption and makes already-focused adoption a no-op after mapped travel', () => {
    loadFocusedGeometry();
    const legacy = fixture();
    legacy.session.body.pos = spawnPoint('brass');
    expect(transition(legacy, 'enter', 'migration-gateway-entry', 0)).toEqual({ value: { ok: true } });
    expect(transition(legacy, 'return', 'migration-gateway-return', 1)).toEqual({ value: { ok: true } });
    expect(() => legacy.apply({ type: 'adopt_focused' })).not.toThrow();
    expect(new RealmSession(0, legacy.session.save()).world.realmSpec!.focusedKit).toBe(1);
    const mapped = fixture();
    mapped.apply({ type: 'adopt_focused' });
    expect(transition(mapped, 'explore', 'migration-focused-entry', 0)).toEqual({ value: { ok: true } });
    expect(transition(mapped, 'return', 'migration-focused-return', 1)).toEqual({ value: { ok: true } });
    const before = stable(mapped);
    expect(() => mapped.apply({ type: 'adopt_focused' })).not.toThrow();
    expect(stable(mapped)).toEqual(before);
  });
  it('loads an active traveler clear of a subsequently closed historical entry doorway', () => {
    const { r, s, door } = doorwayFixture();
    expect(transition(r, 'explore', 'door-away-entry', 0)).toEqual({ value: { ok: true } });
    for (let i = 0; i < 12; i++) {
      r.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } }); tick(r);
    }
    const current = universePointToBody(s, s.world.universeExpedition!.state.position)!;
    expect(current.position.z).toBeLessThan(door.z - 1);
    expect(deserialize(s.save()) === null).toBe(false);
    s.grid.setDoorOpen(door.x, door.y, door.z, false);
    const saved = s.save();
    expect(deserialize(saved) === null).toBe(false);
    const restored = new RealmSession(0, saved);
    near(restored.world.universeExpedition!.state.position, s.world.universeExpedition!.state.position);
    expect(restored.body.present).toBe(false);
    expect(restored.world.universeExpedition!.returnPos).toEqual({ x: door.x + .5, y: door.y, z: door.z + .5 });
  });
  it('still refuses an active actual traveler intersecting a newly closed doorway', () => {
    const { r, s, door } = doorwayFixture();
    expect(transition(r, 'explore', 'door-live-entry', 0)).toEqual({ value: { ok: true } });
    expect(deserialize(s.save()) === null).toBe(false);
    s.grid.setDoorOpen(door.x, door.y, door.z, false);
    expect(deserialize(s.save())).toBeNull();
  });
  it.each([false, true])('still refuses obstructed parked vessel geometry when the expedition is active=%s', active => {
    const r = fixture(), s = r.session;
    expect(transition(r, 'explore', 'parked-obstruction-entry', 0)).toEqual({ value: { ok: true } });
    if (!active) expect(transition(r, 'return', 'parked-obstruction-return', 1)).toEqual({ value: { ok: true } });
    expect(deserialize(s.save()) === null).toBe(false);
    const state = s.world.universeExpedition!.state;
    const vessel = universePointToBody(s, state.parkedVessel?.position ?? state.landedVesselPosition!)!;
    expect(vessel).not.toBeNull();
    s.grid.set(Math.floor(vessel.position.x), Math.floor(vessel.position.y), Math.floor(vessel.position.z), B.Stone);
    expect(deserialize(s.save())).toBeNull();
  });
  it.each(['enter', 'explore'] as const)('binds the historical anchor to its retained entry receipt (%s)', type => {
    for (const active of [false, true]) {
      const r = fixture(), s = r.session;
      expect(transition(r, type, 'anchor-receipt-entry', 0)).toEqual({ value: { ok: true } });
      if (!active) expect(transition(r, 'return', 'anchor-receipt-return', 1)).toEqual({ value: { ok: true } });
      const saved = s.save();
      expect(deserialize(saved) === null).toBe(false);
      const changed = JSON.parse(saved), binding = changed.universeExpedition;
      binding.returnPos.x += .125;
      // Keep the active Body/anchor invariant intact: only the retained entry
      // event proves that this otherwise plausible historical point is false.
      if (active) changed.bodies.find((b: { id: string }) => b.id === binding.bodyId).pos = { ...binding.returnPos };
      expect(deserialize(JSON.stringify(changed))).toBeNull();
    }
  });
  it('keeps legacy boarding geography pinned and refuses implicit conversion on explore', () => {
    const r = fixture(), s = r.session, legacy = createTravelState(universeSpec(s.world.seed));
    expect(transition(r, 'enter', 'legacy-entry-1', 0)).toEqual({ value: { ok: true } });
    expect(s.world.universeExpedition!.state.settlementRevision).toBeUndefined();
    near(s.world.universeExpedition!.state.position, legacy.position);
    expect(transition(r, 'return', 'legacy-return-1', 1)).toEqual({ value: { ok: true } });
    const before = stable(r);
    expect(canonicalUniverseView(r.session).campaign.preview).toBeNull();
    expect(transition(r, 'explore', 'legacy-explore-1', 2).error).toMatch(/gateway geography/);
    expect(stable(r)).toEqual(before);
    expect(transition(r, 'enter', 'legacy-entry-2', 2)).toEqual({ value: { ok: true } });
    expect(r.session.world.universeExpedition!.state.settlementRevision).toBeUndefined();
    near(r.session.world.universeExpedition!.state.position, legacy.position);
  });
});
