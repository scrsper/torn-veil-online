import { describe, expect, it } from 'vitest';
import { RealmSession } from '../../src/sim/world/realms/session';
import { applyCanonicalUniverseCommand, canonicalUniverseView } from '../../src/server/canonicalUniverse';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { makeItem } from '../../src/sim/world/factory';
import { arcaneBody, learnArcaneSource } from '../../src/sim/physical/arcana/runtime';
import { changeEquipment } from '../../src/sim/physical/equipment';
import {
  bodyPointToUniverse, canonicalSettlementProjection, constrainUniverseSettlementMovement,
  universePointToBody, validateUniverseSettlementPosition,
} from '../../src/server/universeSettlements';
import { add, length, normalize, scale, sub } from '../../src/sim/world/planet/planet';
import { generateSystem } from '../../src/sim/world/universe/generation';
import { neutralInput, type PersonalFlight, type TravelState } from '../../src/sim/world/universe/travel';
import { StaticGeometry } from '../../src/sim/physical/staticGeometry';
import { settlementGroundAt, settlementDirectionToPlanet, planetToSettlement } from '../../src/sim/world/universe/settlements';
import { planetSpec } from '../../src/sim/world/planet/planet';

const enter = (prepare?: (s: RealmSession) => void) => {
  const s = new RealmSession(20261017);
  prepare?.(s);
  applyCanonicalUniverseCommand(s, { type: 'enter', id: 'settlement-host-entry', revision: 0 });
  const state = s.world.universeExpedition!.state as TravelState & { settlementRevision?: 1 };
  state.settlementRevision = 1;
  return { s, state };
};
describe('canonical settlement host adapter', () => {
  function installFloor(s: RealmSession, y: number) {
    const x = 3120, z = 3120;
    const geometry = new StaticGeometry([
      { p: [x - 10, y, z - 10, x - 10, y, z + 10, x + 10, y, z + 10], support: true },
      { p: [x - 10, y, z - 10, x + 10, y, z + 10, x + 10, y, z - 10], support: true },
    ], { x0: x - 10, x1: x + 10, z0: z - 10, z1: z + 10 });
    const previous = s.grid.movementGeometryAt.bind(s.grid);
    s.grid.movementGeometryAt = (xx, zz) => geometry.contains(xx, zz) ? geometry : previous(xx, zz);
    return { x, y, z };
  }
  it('projects the actual live source chunks/doors without exposing mutable cached geography', () => {
    const { s } = enter(), projection = canonicalSettlementProjection(s);
    expect(projection.version).toBe(1);
    expect(projection.chunks).toHaveLength(18);
    const source = s.grid.chunk('aether', 32, 32);
    expect(projection.chunks.find(c => c.realm === 'aether' && c.chunk.cx === 32 && c.chunk.cz === 32)?.chunk).toEqual(source);
    const count = source.buildings.length;
    projection.chunks.find(c => c.realm === 'aether' && c.chunk.cx === 32 && c.chunk.cz === 32)!.chunk.buildings.pop();
    expect(source.buildings).toHaveLength(count);
    const door = source.buildings[0].door;
    s.grid.setDoorOpen(door.x, door.y, door.z, true);
    expect(canonicalSettlementProjection(s).doors.find(d => d.realm === 'aether' && d.x === door.x && d.z === door.z)?.open).toBe(true);
  });
  it('maps the same retained Body feet exactly and refuses handing off from orbit', () => {
    const { s } = enter(), body = s.body, original = { ...body.pos }, id = body.id;
    const reference = bodyPointToUniverse(s, 'aether', original);
    const result = universePointToBody(s, reference)!;
    expect(result.realm).toBe('aether');
    expect(length(sub(result.position, original))).toBeLessThan(1e-6);
    expect(universePointToBody(s, add(reference, scale(normalize(reference), 100)))).toBeNull();
    expect(universePointToBody(s, reference, 2)).toBeNull();
    expect(s.body.id).toBe(id); expect(s.body.pos).toEqual(original); expect(s.body.present).toBe(false);
  });
  it('constrains real door crossing without moving or duplicating the canonical Body', () => {
    const { s, state } = enter(), b = s.body, anchor = { ...b.pos }, bodies = s.world.bodies().length;
    const door = s.grid.chunk('aether', 32, 32).buildings.find(b => b.use === 'tower')!.door;
    const from = bodyPointToUniverse(s, 'aether', { x: door.x + .5, y: 1.2, z: door.z - 3 });
    const target = bodyPointToUniverse(s, 'aether', { x: door.x + .5, y: 1.2, z: door.z + 3 });
    state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null;
    state.position = target; state.velocity = scale(sub(target, from), 20);
    const constrained = constrainUniverseSettlementMovement(s, from, true, true);
    expect(constrained.collision?.reason).toBe('solid');
    expect(constrained.contactSpeed).toBeGreaterThan(50);
    expect(length(state.velocity)).toBe(0);
    expect(length(sub(state.position, target))).toBeGreaterThan(1);
    expect(s.body.id).toBe(b.id); expect(s.body.pos).toEqual(anchor); expect(s.world.bodies()).toHaveLength(bodies);
    s.grid.setDoorOpen(door.x, door.y, door.z, true);
    state.position = target;
    expect(constrainUniverseSettlementMovement(s, from, true, true).collision).toBeNull();
    // Live save checks use the human hull in actual personal flight.
    state.personalFlight = { version: 1, bodyId: b.id, phase: 'powered', manaSpent: 0, effortSpent: 0 };
    expect(validateUniverseSettlementPosition(s, state)).toBe(true);
  });
  it('withdraws a tentative terrain landing and returns one source-validated landing candidate', () => {
    const { s, state } = enter(), home = generateSystem(s.world.universeExpedition!.spec, 0).planets[0];
    const target = bodyPointToUniverse(s, 'aether', s.body.pos), from = add(target, scale(normalize(target), .1));
    const flight: PersonalFlight = { version: 1, bodyId: s.body.id, phase: 'descending', manaSpent: 8.5, effortSpent: 2 };
    state.tick = 42; state.mode = 'surface'; state.position = target; state.landedPlanetId = home.id;
    state.landedVesselPosition = { ...target };
    state.events.push({ tick: 42, type: 'land', actorId: state.explorerId, systemIndex: 0, planetId: home.id });
    const events = s.world.events.length;
    const result = constrainUniverseSettlementMovement(s, from, true, flight);
    expect(result.landingCandidate).not.toBeNull();
    expect(state.mode).toBe('flight');
    expect(state.personalFlight).toBe(flight);
    expect(state.events.some(e => e.tick === 42 && e.type === 'land')).toBe(false);
    expect(state.discoveries.some(d => d.planetId === home.id)).toBe(true);
    expect(s.world.events).toHaveLength(events);
    expect(result.landingCandidate!.support.realm).toBe('aether');
  });
  it('retains legacy terrain-only motion unless the binding explicitly opts into settlement revision1', () => {
    const { s, state } = enter();
    delete state.settlementRevision;
    const target = { ...state.position }, from = sub(target, { x: 20, y: 0, z: 0 });
    expect(constrainUniverseSettlementMovement(s, from, false, false).collision).toBeNull();
    expect(state.position).toEqual(target);
  });
  it('finds a source floor below terrain instead of keeping an unsupported completed landing', () => {
    const { s, state } = enter(), floor = installFloor(s, .6), home = generateSystem(s.world.universeExpedition!.spec, 0).planets[0];
    const target = bodyPointToUniverse(s, 'aether', { ...floor, y: 1 }), from = add(target, scale(normalize(target), .1));
    const flight: PersonalFlight = { version: 1, bodyId: s.body.id, phase: 'descending', manaSpent: 2, effortSpent: 1 };
    state.position = target; state.mode = 'surface'; state.landedPlanetId = home.id; state.tick = 5;
    const result = constrainUniverseSettlementMovement(s, from, true, flight);
    expect(state.mode).toBe('flight');
    expect(result.landingCandidate?.support.planar.y).toBeCloseTo(.6, 8);
    expect(length(sub(result.landingCandidate!.position, target))).toBeCloseTo(.4, 6);
    const actual = bodyPointToUniverse(s, 'aether', floor);
    expect(length(sub(result.landingCandidate!.position, actual))).toBeLessThan(1e-6);
    expect(settlementGroundAt(planetSpec(s.world.seed), s.grid, from)?.height).toBeCloseTo(5.6, 8);
  });
  it('keeps walking on an actual upper floor when the terrain integrator supplies ground level', () => {
    const { s, state } = enter(), floor = installFloor(s, 8), home = generateSystem(s.world.universeExpedition!.spec, 0).planets[0];
    const from = bodyPointToUniverse(s, 'aether', floor);
    const target = bodyPointToUniverse(s, 'aether', { ...floor, x: floor.x + .3, y: 1 });
    state.position = target; state.mode = 'surface'; state.landedPlanetId = home.id;
    const result = constrainUniverseSettlementMovement(s, from, false, false);
    expect(result.collision).toBeNull();
    expect(result.support?.planar.y).toBeCloseTo(8, 8);
    const body = universePointToBody(s, state.position)!;
    expect(body.position.y).toBeCloseTo(8, 8);
    expect(body.position.x).toBeCloseTo(floor.x + .3, 5);
    expect(length(state.velocity)).toBeLessThan(7);
  });
  function hostFloor(y: number, learned = false) {
    const { s, state } = enter(learned ? teachFlight : undefined), floor = installFloor(s, y), p = planetSpec(s.world.seed);
    state.position = bodyPointToUniverse(s, 'aether', floor);
    state.up = normalize(state.position);
    state.forward = settlementDirectionToPlanet(p, 'aether', floor, { x: 1, y: 0, z: 0 });
    state.landedVesselPosition = { ...state.position };
    return { s, state, floor, runtime: new RealmRuntime(s), p };
  }
  function tick(runtime: RealmRuntime, count = 1) {
    for (let i = 0; i < count * 3; i++) runtime.apply({ type: 'step', now: i * 1000 / 60 });
  }
  function teachFlight(s: RealmSession) {
    s.person.physiology.energy = s.person.physiology.hydration = 1;
    s.person.physiology.fatigue = s.person.physiology.bodyHeat = s.person.physiology.sleepDebt = 0;
    s.person.physiologyTraits.bodySizeFactor = s.person.physiologyTraits.conditioning = 1;
    for (const id of ['book-well', 'book-ward']) {
      const source = makeItem(s.world, 'book', id, { owner: s.person.id, holder: s.person.id });
      source.arcaneSource = { version: 1, abilityId: id, kind: 'book' };
      expect(learnArcaneSource(s.world, s.person, s.body.id, source.id)).toBe('accepted');
    }
    const focus = makeItem(s.world, 'book', 'Settlement flight fixture focus', { owner: s.person.id, holder: s.person.id });
    focus.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
    expect(changeEquipment(s.world, s.person, focus.id, true, s.body.id)).toBe('accepted');
    s.world.physicalTime += 200; arcaneBody(s.world, s.body);
  }
  for (const y of [.6, 8]) {
    it(`advances the actual realm host walker on source Y=${y} without terrain relocation`, () => {
      const { s, state, floor, runtime } = hostFloor(y), body = s.body, anchor = { ...body.pos };
      expect(runtime.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), throttle: 1 } } }).ok).toBe(true);
      tick(runtime, 5);
      const landed = universePointToBody(s, state.position)!;
      expect(landed.position.y).toBeCloseTo(y, 7);
      expect(landed.position.x - floor.x).toBeGreaterThan(1);
      expect(canonicalUniverseView(s).snapshot!.status.altitude).toBeCloseTo(3, 6);
      expect(validateUniverseSettlementPosition(s, state)).toBe(true);
      expect(s.body).toBe(body); expect(body.pos).toEqual(anchor); expect(body.present).toBe(false);
    });
    it(`lands the actual realm host vessel on source Y=${y} exactly once`, () => {
      const { s, state, runtime } = hostFloor(y), ground = { ...state.position };
      state.position = add(ground, scale(state.up, 4));
      state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null;
      expect(runtime.apply({ type: 'universe_travel', command: { type: 'land' } }).ok).toBe(true);
      for (let n = 0; n < 80 && state.mode === 'flight'; n++) tick(runtime);
      expect(state.mode).toBe('surface');
      expect(length(sub(state.position, ground))).toBeLessThan(.005);
      expect(validateUniverseSettlementPosition(s, state)).toBe(true);
      expect(s.world.events.filter(e => e.type === 'universe_travel' && e.data.type === 'land')).toHaveLength(1);
      expect(state.events.filter(e => e.type === 'land')).toHaveLength(1);
    });
    it(`lands ability-backed personal flight on source Y=${y} with one body and real resource costs`, () => {
      const { s, state, runtime } = hostFloor(y, true), ground = { ...state.position }, body = s.body, bodies = s.world.bodies().length;
      expect(runtime.apply({ type: 'universe_travel', command: { type: 'soar' } }).ok).toBe(true);
      const flight = state.personalFlight!, mana = body.arcana!.mana;
      for (let n = 0; n < 5; n++) {
        runtime.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), lift: 1 } } }); tick(runtime);
      }
      expect(length(state.position) - length(ground)).toBeGreaterThan(.1);
      expect(runtime.apply({ type: 'universe_travel', command: { type: 'land' } }).ok).toBe(true);
      for (let n = 0; n < 200 && state.personalFlight; n++) tick(runtime);
      expect(state.mode).toBe('surface'); expect(state.personalFlight).toBeUndefined();
      expect(length(sub(state.position, ground))).toBeLessThan(.005);
      expect(body.arcana!.mana).toBeLessThan(mana); expect(flight.manaSpent).toBeGreaterThan(0);
      expect(validateUniverseSettlementPosition(s, state)).toBe(true);
      const landed = s.world.events.filter(e => e.type === 'universe_travel' && e.data.type === 'land');
      expect(landed).toHaveLength(1); expect(landed[0].data.locomotion).toBe('personal');
      expect(s.body).toBe(body); expect(s.world.bodies()).toHaveLength(bodies); expect(body.present).toBe(false);
    });
  }
  it('stops powered personal ascent at the actual roof underside without moving to its top', () => {
    const { s, state, runtime, floor, p } = hostFloor(.6, true);
    const original = s.grid.movementGeometryAt(floor.x, floor.z) as StaticGeometry;
    const roofY = 4, x = floor.x, z = floor.z;
    const geometry = new StaticGeometry([...original.triangles,
      { p: [x - 2, roofY, z - 2, x - 2, roofY, z + 2, x + 2, roofY, z + 2], support: true },
      { p: [x - 2, roofY, z - 2, x + 2, roofY, z + 2, x + 2, roofY, z - 2], support: true },
    ], original.bounds);
    const previous = s.grid.movementGeometryAt.bind(s.grid);
    s.grid.movementGeometryAt = (xx, zz) => geometry.contains(xx, zz) ? geometry : previous(xx, zz);
    // The human may stand under this roof; the six-metre vessel must remain in
    // the nearby open yard, with its own independently validated hull clearance.
    state.landedVesselPosition = bodyPointToUniverse(s, 'aether', { ...floor, x: x + 6 });
    expect(runtime.apply({ type: 'universe_travel', command: { type: 'soar' } }).ok).toBe(true);
    for (let n = 0; n < 20; n++) {
      runtime.apply({ type: 'universe_travel', command: { type: 'input', input: { ...neutralInput(), lift: 1 } } }); tick(runtime);
    }
    const feet = planetToSettlement(p, 'aether', sub(state.position, scale(normalize(state.position), 3)));
    expect(feet.y).toBeGreaterThan(.7); expect(feet.y + 1.8).toBeLessThanOrEqual(roofY + .002);
    expect(state.mode).toBe('flight'); expect(state.personalFlight).toBeDefined();
    expect(validateUniverseSettlementPosition(s, state)).toBe(true);
    expect(state.events.some(e => e.type === 'collision')).toBe(true);
    expect(state.events.some(e => e.type === 'land')).toBe(false);
  });
});
