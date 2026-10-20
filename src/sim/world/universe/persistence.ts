/** Pure validation for durable travel state, shared by isolated and canonical hosts. */
import { generateSystem, terrainHeight, terrainNormal, universeSpec, type StarSystem, type UniverseSpec } from './generation';
import { TRAVEL_LIMITS, type TravelState } from './travel';
import { dot, length, normalize, scale, sub, type V3 } from '../planet/planet';

export interface SavePayload { spec: UniverseSpec; state: TravelState; revision: number }
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const vector = (v: unknown): boolean => isRecord(v) && ['x', 'y', 'z'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && Math.abs(Number(v[k])) <= 1e9);
const identity = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(v);
/** Saves fail closed, including structurally valid JSON with invalid physics. */
export function validateUniversePayload(value: unknown): SavePayload {
  if (!isRecord(value) || !isRecord(value.spec) || value.spec.version !== 1 || !integer(value.spec.seed, 0, 0xffffffff)
    || !integer(value.revision) || !isRecord(value.state)) throw Error('Unsupported or corrupt universe save');
  const spec = universeSpec(value.spec.seed), s = value.state;
  if (!integer(s.tick) || !integer(s.systemIndex, 0, 65535) || !identity(s.explorerId) || !identity(s.vesselId)
    || s.explorerId === s.vesselId || typeof s.mode !== 'string' || !['surface', 'flight'].includes(s.mode)
    || !vector(s.position) || !vector(s.forward) || !vector(s.up) || !vector(s.velocity)
    || typeof s.cruise !== 'boolean' || typeof s.landing !== 'boolean'
    || !Array.isArray(s.discoveries) || s.discoveries.length > 393216
    || !Array.isArray(s.events) || s.events.length > 256) throw Error('Invalid universe state');
  const state = s as unknown as TravelState, system = generateSystem(spec, state.systemIndex);
  const validPlanet = (id: unknown) => id === null || system.planets.some(p => p.id === id);
  if (!validPlanet(state.targetPlanetId) || !validPlanet(state.landedPlanetId)
    || Math.abs(length(state.forward) - 1) > .001 || Math.abs(length(state.up) - 1) > .001
    || Math.abs(dot(state.forward, state.up)) > .001 || length(state.velocity) > 2700
    || (state.cruise && (state.mode !== 'flight' || !state.targetPlanetId || state.landing))
    || (state.landing && state.mode !== 'flight')) throw Error('Invalid navigation state');
  const clearance = (planet: StarSystem['planets'][number], point: V3) => {
    const local = sub(point, planet.center);
    return length(local) - planet.radius - Math.max(0, terrainHeight(planet, normalize(local)));
  };
  if (system.planets.some(p => clearance(p, state.position) < 2.9)) throw Error('Saved body intersects terrain');
  if (state.landing) {
    const planet = system.planets.reduce((best, p) => clearance(p, state.position) < clearance(best, state.position) ? p : best);
    const radial = normalize(sub(state.position, planet.center)), height = clearance(planet, state.position);
    const radialVelocity = dot(state.velocity, radial), tangentVelocity = sub(state.velocity, scale(radial, radialVelocity));
    if (height > TRAVEL_LIMITS.landingAltitude + 1e-5 || height < TRAVEL_LIMITS.clearance - 1e-5
      || terrainHeight(planet, radial) < 0 || dot(terrainNormal(planet, radial), radial) < .72
      || radialVelocity > 1e-5 || radialVelocity < -40.00001 || length(tangentVelocity) > .001)
      throw Error('Invalid in-progress landing state');
  }
  if (state.mode === 'surface') {
    if (!state.landedPlanetId || !vector(state.landedVesselPosition)) throw Error('Missing landed vessel');
    const planet = system.planets.find(p => p.id === state.landedPlanetId)!;
    const bodyDirection = normalize(sub(state.position, planet.center)), vesselDirection = normalize(sub(state.landedVesselPosition!, planet.center));
    if (Math.abs(clearance(planet, state.position) - 3) > .01
      || Math.abs(clearance(planet, state.landedVesselPosition!) - 3) > .01
      || terrainHeight(planet, bodyDirection) < 0 || terrainHeight(planet, vesselDirection) < 0
      || dot(terrainNormal(planet, bodyDirection), bodyDirection) < .6
      || dot(terrainNormal(planet, vesselDirection), vesselDirection) < .72
      || dot(state.up, bodyDirection) < .999) throw Error('Invalid surface location');
  } else if (state.landedPlanetId !== null || state.landedVesselPosition !== null) throw Error('Flight state retains landed body');
  const seen = new Set<string>();
  for (const item of state.discoveries) {
    if (!isRecord(item) || !identity(item.planetId) || !integer(item.systemIndex, 0, 65535)
      || !integer(item.tick, 0, state.tick) || item.explorerId !== state.explorerId || item.method !== 'landed'
      || !generateSystem(spec, item.systemIndex).planets.some(p => p.id === item.planetId)
      || seen.has(item.planetId)) throw Error('Invalid discovery provenance');
    seen.add(item.planetId);
  }
  if (state.mode === 'surface' && !seen.has(state.landedPlanetId!)) throw Error('Landed world lacks discovery provenance');
  let previousTick = -1;
  for (const item of state.events) {
    if (!isRecord(item) || !integer(item.tick, 0, state.tick) || !integer(item.systemIndex, 0, 65535)
      || item.actorId !== state.explorerId || typeof item.type !== 'string'
      || !['launch', 'land', 'warp', 'collision'].includes(item.type)
      || (item.type === 'warp' ? item.planetId !== null : item.planetId === null)
      || (item.planetId !== null && !generateSystem(spec, item.systemIndex).planets.some(p => p.id === item.planetId)))
      throw Error('Invalid travel event provenance');
    if (item.tick < previousTick) throw Error('Travel events are out of order');
    previousTick = item.tick;
  }
  return { spec, state: structuredClone(state), revision: value.revision };
}
