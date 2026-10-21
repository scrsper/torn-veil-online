import { describe, expect, it } from 'vitest';
import { add, dot, length, normalize, scale, sub } from '../../src/sim/world/planet/planet';
import { generateSystem, landingSite, terrainHeight, universeSpec, type UniverseSpec } from '../../src/sim/world/universe/generation';
import {
  applyTravelCommand, createTravelState, neutralInput, parseUniverseCommand, stepTravel, travelStatus,
  type TravelState,
} from '../../src/sim/world/universe/travel';

const spec = universeSpec(20261017);
function land(state: TravelState, inSpec: UniverseSpec = spec): void {
  const position = { ...state.position }, before = state.discoveries.length;
  expect(applyTravelCommand(inSpec, state, { type: 'land' }).ok).toBe(true);
  expect(state.mode).toBe('flight');
  expect(state.position).toEqual(position);
  expect(state.discoveries).toHaveLength(before);
  for (let i = 0; i < 110 && state.mode === 'flight'; i++) {
    const previous = { ...state.position };
    stepTravel(inSpec, state);
    expect(length(sub(previous, state.position))).toBeLessThanOrEqual(2.001);
  }
  expect(state.mode).toBe('surface');
}
function flyTo(state: TravelState, planetId: string, limit = 6000): number {
  expect(applyTravelCommand(spec, state, { type: 'navigate', planetId }).ok).toBe(true);
  for (let i = 0; i < limit; i++) {
    stepTravel(spec, state);
    if (!state.cruise && travelStatus(spec, state).canLand) return i;
  }
  throw Error(`Did not arrive: ${JSON.stringify({ position: state.position, status: travelStatus(spec, state), cruise: state.cruise, events: state.events.slice(-3) })}`);
}
describe('deterministic universe travel', () => {
  it('replays fixed input identically and walks tangent to the planet', () => {
    const a = createTravelState(spec), b = createTravelState(spec), start = { ...a.position };
    const input = { ...neutralInput(), throttle: .8, yaw: .15, strafe: .1 };
    for (let i = 0; i < 80; i++) { stepTravel(spec, a, input); stepTravel(spec, b, input); }
    expect(a).toEqual(b);
    expect(length(sub(a.position, start))).toBeGreaterThan(10);
    expect(Math.abs(dot(a.up, a.forward))).toBeLessThan(.00001);
    expect(travelStatus(spec, a).altitude).toBeCloseTo(3, 5);
    expect(a.landedVesselPosition).toEqual(start);
  });
  it('launches, continuously cruises to another world, lands, and returns with identity and discovery continuity', () => {
    const state = createTravelState(spec), system = generateSystem(spec, 0), identities = [state.explorerId, state.vesselId];
    expect(applyTravelCommand(spec, state, { type: 'launch' }).ok).toBe(true);
    const steps = flyTo(state, system.planets[1].id);
    expect(steps).toBeGreaterThan(100);
    land(state);
    expect(state.landedPlanetId).toBe(system.planets[1].id);
    expect(state.discoveries.map(d => d.planetId)).toEqual([system.planets[0].id, system.planets[1].id]);
    expect(applyTravelCommand(spec, state, { type: 'launch' }).ok).toBe(true);
    flyTo(state, system.planets[0].id);
    land(state);
    expect([state.explorerId, state.vesselId]).toEqual(identities);
    expect(state.discoveries).toHaveLength(2);
    expect(state.events.filter(e => e.type === 'collision')).toHaveLength(0);
    expect(state.events.map(e => e.type)).toEqual(['launch', 'land', 'launch', 'land']);
  });
  it('sweeps high-speed terrain crossing and refuses landing while fast or in deep space', () => {
    const state = createTravelState(spec), p = generateSystem(spec, 0).planets[0], local = landingSite(p), radial = normalize(local);
    applyTravelCommand(spec, state, { type: 'launch' });
    state.position = add(p.center, scale(radial, length(local) + 40));
    state.velocity = scale(radial, -2600); state.forward = scale(radial, -1);
    expect(applyTravelCommand(spec, state, { type: 'land' }).ok).toBe(false);
    stepTravel(spec, state, { ...neutralInput(), throttle: 1 });
    expect(travelStatus(spec, state).altitude).toBeGreaterThanOrEqual(2.99);
    expect(length(state.velocity)).toBe(0);
    expect(state.events.at(-1)?.type).toBe('collision');
    state.position = add(p.center, scale(radial, p.radius + 5000));
    expect(applyTravelCommand(spec, state, { type: 'land' }).ok).toBe(false);
  });
  it('validates bounded inputs and cancels assistance when manual input is applied', () => {
    expect(() => parseUniverseCommand({ type: 'input', input: { ...neutralInput(), yaw: NaN } })).toThrow();
    expect(() => parseUniverseCommand({ type: 'warp', systemIndex: -1 })).toThrow();
    expect(() => parseUniverseCommand({ type: 'teleport', position: { x: 1, y: 2, z: 3 } })).toThrow();
    expect(parseUniverseCommand({ type: 'input', input: { ...neutralInput(), throttle: 5 } }))
      .toEqual({ type: 'input', input: { ...neutralInput(), throttle: 1 } });
    const state = createTravelState(spec);
    applyTravelCommand(spec, state, { type: 'launch' });
    applyTravelCommand(spec, state, { type: 'cruise', enabled: true });
    applyTravelCommand(spec, state, { type: 'input', input: { ...neutralInput(), yaw: .4 } });
    expect(state.cruise).toBe(false);
  });
  it('requires a vessel nearby to launch and atmosphere clearance to warp', () => {
    const state = createTravelState(spec), p = generateSystem(spec, 0).planets[0];
    state.landedVesselPosition = add(state.position, { x: 100, y: 100, z: 100 });
    expect(applyTravelCommand(spec, state, { type: 'launch' }).ok).toBe(false);
    state.landedVesselPosition = { ...state.position };
    applyTravelCommand(spec, state, { type: 'launch' });
    expect(applyTravelCommand(spec, state, { type: 'warp', systemIndex: 1 }).ok).toBe(false);
    for (let i = 0; i < 100; i++) stepTravel(spec, state, { ...neutralInput(), throttle: 1 });
    const ids = [state.explorerId, state.vesselId];
    expect(travelStatus(spec, state).altitude).toBeGreaterThan(p.atmosphere + 120);
    expect(applyTravelCommand(spec, state, { type: 'warp', systemIndex: 1 }).ok).toBe(true);
    expect(state.systemIndex).toBe(1);
    expect([state.explorerId, state.vesselId]).toEqual(ids);
    expect(state.discoveries).toHaveLength(1);
    expect(state.events.at(-1)?.type).toBe('warp');
  });
  it('keeps walking at a dry surface and cannot invent remote discoveries', () => {
    const state = createTravelState(spec), p = generateSystem(spec, 0).planets[0];
    expect(terrainHeight(p, normalize(sub(state.position, p.center)))).toBeGreaterThanOrEqual(0);
    expect(applyTravelCommand(spec, state, { type: 'navigate', planetId: generateSystem(spec, 1).planets[0].id }).ok).toBe(false);
    expect(state.discoveries).toHaveLength(1);
  });
  it('assisted approach reaches every world across multiple seeded systems without terrain strikes', () => {
    for (const seed of [1, 42, 20261017, 0xffffffff]) {
      const varied = universeSpec(seed), state = createTravelState(varied), system = generateSystem(varied, 0);
      for (const p of [...system.planets.slice(1), system.planets[0]]) {
        expect(applyTravelCommand(varied, state, { type: 'launch' }).ok).toBe(true);
        expect(applyTravelCommand(varied, state, { type: 'navigate', planetId: p.id }).ok).toBe(true);
        for (let tick = 0; tick < 8000 && state.cruise; tick++) stepTravel(varied, state);
        expect(travelStatus(varied, state).canLand, `seed ${seed} planet ${p.id}`).toBe(true);
        expect(state.events.filter(e => e.type === 'collision'), `seed ${seed} planet ${p.id}`).toHaveLength(0);
        land(state, varied);
        expect(state.landedPlanetId).toBe(p.id);
      }
      expect(state.discoveries).toHaveLength(system.planets.length);
    }
  });
});
