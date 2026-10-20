import { describe, expect, it } from 'vitest';
import { RealmSession } from '../../src/sim/world/realms/session';
import { makeItem } from '../../src/sim/world/factory';
import { learnArcaneSource, arcaneBody } from '../../src/sim/physical/arcana/runtime';
import { assessMagicalFlight } from '../../src/sim/physical/arcana/flight';
import { changeEquipment } from '../../src/sim/physical/equipment';
import { spendExertion } from '../../src/sim/physical/exertion';
import { add, dot, length, normalize, scale, sub } from '../../src/sim/world/planet/planet';
import { generateSystem, universeSpec } from '../../src/sim/world/universe/generation';
import { applyTravelCommand, createTravelState, neutralInput, TRAVEL_DT } from '../../src/sim/world/universe/travel';
import {
  beginPersonalFlight, commandPersonalFlight, flightEnvironment, personalRouteDistance, stepPersonalFlight,
} from '../../src/sim/world/universe/personalFlight';

function fixture(strong = false, ward = false) {
  const s = new RealmSession(20261017), spec = universeSpec(s.world.seed), state = createTravelState(spec);
  // These tests isolate the locomotion law; Atlas collision has its own tests.
  delete state.atlasRevision; delete state.atlasCatalog;
  s.person.physiology.energy = s.person.physiology.hydration = 1;
  s.person.physiology.fatigue = s.person.physiology.sleepDebt = s.person.physiology.bodyHeat = 0;
  s.person.physiologyTraits.bodySizeFactor = s.person.physiologyTraits.conditioning = 1;
  s.person.skills.veilcraft = 0;
  for (const id of ['book-well', ...(ward ? ['book-ward'] : [])]) {
    const item = makeItem(s.world, 'book', id, { holder: s.person.id, owner: s.person.id });
    item.arcaneSource = { version: 1, abilityId: id, kind: 'book' };
    expect(learnArcaneSource(s.world, s.person, s.body.id, item.id)).toBe('accepted');
  }
  if (strong) {
    const focus = makeItem(s.world, 'book', 'Flight test focus', { holder: s.person.id, owner: s.person.id });
    focus.arcaneFocus = { version: 1, amplitude: 20, aperture: 12, reserve: 320 };
    expect(changeEquipment(s.world, s.person, focus.id, true, s.body.id)).toBe('accepted');
    s.world.physicalTime += 200; arcaneBody(s.world, s.body);
  }
  function capacity(routeDistance?: number) {
    return assessMagicalFlight(s.world, s.person, s.body, { ...flightEnvironment(spec, state), routeDistance });
  }
  function step(input = neutralInput()) {
    const profile = capacity(), before = { ...state.position };
    const result = stepPersonalFlight(spec, state, input, profile);
    s.world.physicalTime += TRAVEL_DT;
    s.body.arcana!.mana = Math.max(0, s.body.arcana!.mana - result.mana);
    s.body.arcana!.sampledAt = s.world.physicalTime;
    if (result.effort) spendExertion(s.world, s.person, s.body, result.effort);
    return { result, profile, distance: length(sub(state.position, before)) };
  }
  return { s, spec, state, capacity, step };
}

describe('continuous personal flight', () => {
  it('lifts from the actual body point, accelerates continuously and spends embodied reserves', () => {
    const f = fixture(), start = { ...f.state.position }, mana = f.s.body.arcana!.mana;
    const identities = [f.state.explorerId, f.state.vesselId];
    expect(beginPersonalFlight(f.spec, f.state, f.s.body.id, f.capacity()).ok).toBe(true);
    expect(f.state.position).toEqual(start);
    expect(f.state.parkedVessel!.position).toEqual(start);
    for (let i = 0; i < 20; i++) {
      const previousVelocity = { ...f.state.velocity };
      const { result, profile, distance } = f.step({ ...neutralInput(), lift: 1 });
      expect(result.powered).toBe(true); expect(result.mana).toBeGreaterThan(0);
      expect(distance).toBeLessThanOrEqual(profile.speed * TRAVEL_DT + .001);
      expect(length(sub(f.state.velocity, previousVelocity))).toBeLessThanOrEqual(profile.acceleration * TRAVEL_DT + 1e-8);
    }
    expect(flightEnvironment(f.spec, f.state).altitude).toBeGreaterThan(3.5);
    expect(f.s.body.arcana!.mana).toBeLessThan(mana);
    expect(f.s.body.exertion!.load).toBeGreaterThan(0);
    expect([f.state.explorerId, f.state.vesselId]).toEqual(identities);
  });
  it('brakes a local ascent below its atmospheric ceiling without clamping position', () => {
    const f = fixture(); beginPersonalFlight(f.spec, f.state, f.s.body.id, f.capacity());
    let maximum = 0;
    for (let i = 0; i < 500 && f.state.personalFlight; i++) {
      const { distance, profile } = f.step({ ...neutralInput(), lift: 1 });
      const altitude = flightEnvironment(f.spec, f.state).altitude;
      maximum = Math.max(maximum, altitude);
      expect(distance).toBeLessThanOrEqual(profile.speed * TRAVEL_DT + .02);
      expect(altitude).toBeLessThan(profile.maxAltitude + .25);
    }
    expect(maximum).toBeGreaterThan(10);
    expect(maximum).toBeLessThan(generateSystem(f.spec, 0).planets[0].atmosphere);
  });
  it('retains momentum and falls continuously after mana depletion, then contacts the real ground', () => {
    const f = fixture(); beginPersonalFlight(f.spec, f.state, f.s.body.id, f.capacity());
    for (let i = 0; i < 50; i++) f.step({ ...neutralInput(), lift: 1 });
    f.s.body.arcana!.mana = 0;
    const env = flightEnvironment(f.spec, f.state), radial = normalize(sub(f.state.position, env.planet.center));
    const before = { ...f.state.velocity }, position = { ...f.state.position };
    const first = f.step();
    expect(first.result).toMatchObject({ powered: false, mana: 0, effort: 0 });
    expect(f.state.personalFlight!.phase).toBe('unpowered');
    expect(dot(f.state.velocity, radial)).toBeLessThan(dot(before, radial));
    expect(length(sub(f.state.position, position))).toBeLessThan(1);
    for (let i = 0; i < 500 && f.state.personalFlight; i++) f.step();
    expect(f.state.mode).toBe('surface');
    expect(f.state.personalFlight).toBeUndefined();
    expect(flightEnvironment(f.spec, f.state).altitude).toBeCloseTo(3, 4);
    expect(f.state.parkedVessel!.position).toEqual(f.state.landedVesselPosition);
  });
  it('refuses insufficient ward/reserve routes, manual input cancels assistance, and no flight grants warp', () => {
    const weak = fixture(true, false), target = generateSystem(weak.spec, 0).planets[1].id;
    beginPersonalFlight(weak.spec, weak.state, weak.s.body.id, weak.capacity());
    const before = structuredClone(weak.state);
    expect(commandPersonalFlight(weak.spec, weak.state, { type: 'navigate', planetId: target },
      weak.capacity(personalRouteDistance(weak.spec, weak.state, target))).ok).toBe(false);
    expect(weak.state).toEqual(before);
    expect(commandPersonalFlight(weak.spec, weak.state, { type: 'warp', systemIndex: 1 }, weak.capacity()).ok).toBe(false);
    expect(weak.state.systemIndex).toBe(0);
    expect(applyTravelCommand(weak.spec, weak.state, { type: 'warp', systemIndex: 1 }).ok).toBe(false);
    const strong = fixture(true, true);
    beginPersonalFlight(strong.spec, strong.state, strong.s.body.id, strong.capacity());
    expect(commandPersonalFlight(strong.spec, strong.state, { type: 'navigate', planetId: target },
      strong.capacity(personalRouteDistance(strong.spec, strong.state, target))).ok).toBe(true);
    expect(strong.state.cruise).toBe(true);
    commandPersonalFlight(strong.spec, strong.state, { type: 'input', input: { ...neutralInput(), yaw: .4 } }, strong.capacity());
    expect(strong.state.cruise).toBe(false);
    strong.s.body.arcana!.mana = 8;
    expect(commandPersonalFlight(strong.spec, strong.state, { type: 'navigate', planetId: target },
      strong.capacity(personalRouteDistance(strong.spec, strong.state, target))).ok).toBe(false);
  });
  it('keeps physically available descent control when remaining mana cannot admit a new space route', () => {
    const f = fixture(true, true);
    beginPersonalFlight(f.spec, f.state, f.s.body.id, f.capacity());
    for (let i = 0; i < 200 && flightEnvironment(f.spec, f.state).altitude < 500; i++)
      f.step({ ...neutralInput(), lift: 1 });
    for (let i = 0; i < 100 && length(f.state.velocity) > .1; i++)
      f.step({ ...neutralInput(), brake: true });
    // Simulate a reserve loss after ascent. There remains enough mana for this
    // body's fast controlled descent, but not the allowance for a new route.
    f.s.body.arcana!.mana = 20;
    const profile = f.capacity();
    expect(profile.canHover).toBe(true); expect(profile.canCrossSpace).toBe(false);
    expect(profile.protectionStrength).toBeGreaterThan(8);
    expect(commandPersonalFlight(f.spec, f.state, { type: 'land' }, profile).ok).toBe(true);
    for (let i = 0; i < 180 && f.state.personalFlight && f.s.body.arcana!.mana > 0; i++) f.step();
    expect(f.state.mode).toBe('surface');
    expect(f.s.body.arcana!.mana).toBeGreaterThan(0);
  });
  it('crosses to another world and lands while its vessel remains on the original planet', () => {
    const f = fixture(true, true), system = generateSystem(f.spec, 0), target = system.planets[1];
    const parkedPosition = { ...f.state.position };
    beginPersonalFlight(f.spec, f.state, f.s.body.id, f.capacity());
    expect(commandPersonalFlight(f.spec, f.state, { type: 'navigate', planetId: target.id },
      f.capacity(personalRouteDistance(f.spec, f.state, target.id))).ok).toBe(true);
    let steps = 0, maxDistance = 0;
    for (; steps < 4500 && f.state.personalFlight && f.state.cruise; steps++) {
      const { distance } = f.step(); maxDistance = Math.max(maxDistance, distance);
    }
    expect(flightEnvironment(f.spec, f.state).planet.id, JSON.stringify({
      steps, env: flightEnvironment(f.spec, f.state), flight: f.state.personalFlight, mana: f.s.body.arcana!.mana,
    })).toBe(target.id);
    expect(steps).toBeGreaterThan(100); expect(maxDistance).toBeLessThan(60);
    if (f.state.personalFlight) {
      expect(commandPersonalFlight(f.spec, f.state, { type: 'land' }, f.capacity()).ok).toBe(true);
      for (let i = 0; i < 1200 && f.state.personalFlight; i++) f.step();
    }
    expect(f.state.landedPlanetId).toBe(target.id);
    expect(f.state.parkedVessel).toEqual({ systemIndex: 0, planetId: system.planets[0].id, position: parkedPosition });
    expect(f.state.landedVesselPosition).toBeNull();
    expect(applyTravelCommand(f.spec, f.state, { type: 'launch' }).ok).toBe(false);
    expect(f.state.discoveries.map(d => d.planetId)).toEqual([system.planets[0].id, target.id]);
    expect(f.state.events.some(e => e.type === 'warp')).toBe(false);
  });
});
