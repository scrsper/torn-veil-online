/** Deterministic, headless universe locomotion. All distances are metres and speeds m/s.
 * This explorer/vessel slice is separate from the existing Person/body save schema. */
import { add, sub, scale, dot, cross, length, normalize, tangentFrame, type V3 } from '../planet/planet';
import { generateSystem, landingSite, terrainHeight, terrainNormal, type PlanetDescriptor, type StarSystem, type UniverseSpec } from './generation';
import { ATLAS_REVISION } from '../atlas';
import { atlasPlanetLandingClear, atlasPlanetSweep, atlasPlanetWalkStep } from '../atlas/collision';

export const TRAVEL_DT = .05;
export const TRAVEL_LIMITS = Object.freeze({
  walkSpeed: 7, flightSpeed: 190, cruiseSpeed: 2600, acceleration: 700,
  clearance: 3, landingAltitude: 180, landingSpeed: 65, launchDistance: 60,
});
export interface TravelInput {
  throttle: number; yaw: number; pitch: number; strafe: number; lift: number; brake: boolean;
}
export const neutralInput = (): TravelInput => ({ throttle: 0, yaw: 0, pitch: 0, strafe: 0, lift: 0, brake: false });
export type UniverseCommand =
  | { type: 'input'; input: TravelInput }
  | { type: 'launch' }
  | { type: 'soar' }
  | { type: 'land' }
  | { type: 'target'; planetId: string }
  | { type: 'navigate'; planetId: string }
  | { type: 'cruise'; enabled: boolean }
  | { type: 'warp'; systemIndex: number };
export interface Discovery { planetId: string; systemIndex: number; tick: number; explorerId: string; method: 'landed' }
export interface TravelEvent { tick: number; type: 'launch' | 'soar' | 'land' | 'warp' | 'collision'; actorId: string; systemIndex: number; planetId: string | null }
export interface ParkedVessel { systemIndex: number; planetId: string; position: V3 }
export interface PersonalFlight {
  version: 1; bodyId: string; phase: 'powered' | 'descending' | 'unpowered'; startedEventId?: string;
  manaSpent: number; effortSpent: number;
}
export interface TravelState {
  /** Absent on existing saves: legacy terrain-only physics remains unchanged. */
  atlasRevision?: 1; atlasCatalog?: string;
  /** Explicit canonical source-geometry adapter; absent on legacy expeditions. */
  settlementRevision?: 1;
  /** Only the canonical body host may advance personal flight. The vessel stays
   * where it was left, including when its owner lands on a different world. */
  personalFlight?: PersonalFlight;
  parkedVessel?: ParkedVessel;
  tick: number; explorerId: string; vesselId: string; systemIndex: number;
  mode: 'surface' | 'flight'; position: V3; forward: V3; up: V3; velocity: V3;
  landedPlanetId: string | null; landedVesselPosition: V3 | null;
  targetPlanetId: string | null; cruise: boolean; landing: boolean; discoveries: Discovery[]; events: TravelEvent[];
}
export interface TravelStatus {
  speed: number; altitude: number; nearestPlanetId: string; canLand: boolean; canLaunch: boolean; message: string;
}
export interface CommandResult { ok: boolean; error?: string }
export interface TravelGeometry {
  /** Optional canonical source floor. Undefined retains generated terrain. */
  surfaceRadius?: (planet: PlanetDescriptor, direction: V3, reference: V3) => number | undefined;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const ZERO: V3 = { x: 0, y: 0, z: 0 };
const rotate = (v: V3, axis: V3, angle: number): V3 =>
  add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))), scale(axis, dot(axis, v) * (1 - Math.cos(angle))));
export const travelSurfaceRadius = (p: PlanetDescriptor, d: V3, geometry?: TravelGeometry, reference: V3 = scale(d, p.radius + 3)) =>
  geometry?.surfaceRadius?.(p, d, reference) ?? p.radius + Math.max(0, terrainHeight(p, d));
const surfaceRadius = travelSurfaceRadius;
const altitude = (p: PlanetDescriptor, pos: V3, geometry?: TravelGeometry, reference = pos) => {
  const local = sub(pos, p.center);
  return length(local) - surfaceRadius(p, normalize(local), geometry, reference);
};
function nearest(system: StarSystem, pos: V3): PlanetDescriptor {
  return system.planets.reduce((best, p) => altitude(p, pos) < altitude(best, pos) ? p : best);
}
export function recordTravel(state: TravelState, type: TravelEvent['type'], planetId: string | null): void {
  state.events.push({ tick: state.tick, type, actorId: state.explorerId, systemIndex: state.systemIndex, planetId });
  if (state.events.length > 256) state.events.shift();
}
const record = recordTravel;
function discover(state: TravelState, planet: PlanetDescriptor): void {
  if (!state.discoveries.some(d => d.planetId === planet.id))
    state.discoveries.push({ planetId: planet.id, systemIndex: state.systemIndex, tick: state.tick, explorerId: state.explorerId, method: 'landed' });
}
export function createTravelState(spec: UniverseSpec): TravelState {
  const p = generateSystem(spec, 0).planets[0], local = landingSite(p), up = normalize(local);
  const position = add(p.center, add(local, scale(up, TRAVEL_LIMITS.clearance)));
  const state: TravelState = {
    atlasRevision: 1, atlasCatalog: ATLAS_REVISION,
    tick: 0, explorerId: `u1:${spec.seed}:explorer:1`, vesselId: `u1:${spec.seed}:vessel:1`, systemIndex: 0,
    mode: 'surface', position, forward: tangentFrame(up).north, up, velocity: { ...ZERO },
    landedPlanetId: p.id, landedVesselPosition: { ...position }, targetPlanetId: p.id,
    cruise: false, landing: false, discoveries: [], events: [],
  };
  discover(state, p);
  return state;
}
export function travelStatus(spec: UniverseSpec, state: TravelState, geometry?: TravelGeometry): TravelStatus {
  const p = nearest(generateSystem(spec, state.systemIndex), state.position);
  const alt = altitude(p, state.position, geometry), speed = length(state.velocity), dir = normalize(sub(state.position, p.center));
  const dry = terrainHeight(p, dir) >= 0, slope = dot(terrainNormal(p, dir), dir);
  const candidateLanding = state.mode === 'flight' && !state.landing && alt <= TRAVEL_LIMITS.landingAltitude && alt >= 0
    && speed <= TRAVEL_LIMITS.landingSpeed && dry && slope >= .72;
  const clear = !candidateLanding || atlasPlanetLandingClear(p, sub(state.position, p.center), state.atlasRevision ?? 0);
  const canLand = !!state.personalFlight || candidateLanding && clear;
  const canLaunch = state.mode === 'surface' && !!state.landedVesselPosition
    && length(sub(state.position, state.landedVesselPosition)) <= TRAVEL_LIMITS.launchDistance;
  let message = state.mode === 'surface' ? (canLaunch ? 'Surface exploration · vessel ready' : 'Return within 60 m of your vessel to launch')
    : state.landing ? 'Landing · controlled descent'
    : state.cruise ? 'Assisted cruise · navigating around planetary terrain'
    : canLand ? 'Landing available' : 'Manual flight';
  if (state.mode === 'flight' && !state.landing && alt <= TRAVEL_LIMITS.landingAltitude && !canLand)
    message = !dry ? 'Water below · select assisted arrival for a dry landing site'
      : slope < .72 ? 'Terrain too steep to land' : !clear ? 'Landing area obstructed · find open ground' : 'Brake below 65 m/s to land';
  if (state.personalFlight) message = state.personalFlight.phase === 'descending' ? 'Personal flight · descending'
    : state.personalFlight.phase === 'unpowered' ? 'Lift exhausted · falling or coasting'
    : state.cruise ? 'Personal flight · following the selected world' : 'Personal flight · mana and breath in use';
  return { speed, altitude: alt, nearestPlanetId: p.id, canLand, canLaunch, message };
}
/** Parse unknown network input before it reaches the deterministic simulation. */
export function parseUniverseCommand(value: unknown): UniverseCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Command must be an object');
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'launch': case 'land': case 'soar': return { type: v.type };
    case 'target': case 'navigate':
      if (typeof v.planetId !== 'string' || v.planetId.length > 100) throw Error('Invalid planet id');
      return { type: v.type, planetId: v.planetId };
    case 'cruise':
      if (typeof v.enabled !== 'boolean') throw Error('Cruise enabled must be boolean');
      return { type: 'cruise', enabled: v.enabled };
    case 'warp':
      if (!Number.isInteger(v.systemIndex) || Number(v.systemIndex) < 0 || Number(v.systemIndex) > 65535) throw Error('Invalid system index');
      return { type: 'warp', systemIndex: Number(v.systemIndex) };
    case 'input': {
      if (!v.input || typeof v.input !== 'object' || Array.isArray(v.input)) throw Error('Input must be an object');
      const raw = v.input as Record<string, unknown>, input = neutralInput();
      for (const key of ['throttle', 'yaw', 'pitch', 'strafe', 'lift'] as const) {
        if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) throw Error(`Invalid input ${key}`);
        input[key] = clamp(raw[key], -1, 1);
      }
      if (typeof raw.brake !== 'boolean') throw Error('Invalid brake');
      input.brake = raw.brake;
      return { type: 'input', input };
    }
    default: throw Error('Unknown universe command');
  }
}
export function applyTravelCommand(spec: UniverseSpec, state: TravelState, command: UniverseCommand, geometry?: TravelGeometry): CommandResult {
  const system = generateSystem(spec, state.systemIndex);
  if (command.type === 'soar' || state.personalFlight)
    return { ok: false, error: 'Personal flight requires the canonical body and its current abilities.' };
  switch (command.type) {
    case 'input':
      if (Object.entries(command.input).some(([k, v]) => k === 'brake' ? v === true : Math.abs(Number(v)) > .01)) {
        state.cruise = false; state.landing = false;
      }
      return { ok: true };
    case 'target': case 'navigate':
      if (!system.planets.some(p => p.id === command.planetId)) return { ok: false, error: 'Planet does not belong to this system' };
      if (command.type === 'navigate' && state.mode !== 'flight') return { ok: false, error: 'Launch before navigating' };
      state.targetPlanetId = command.planetId;
      if (command.type === 'navigate') { state.cruise = true; state.landing = false; }
      return { ok: true };
    case 'cruise':
      if (state.mode !== 'flight') return { ok: false, error: 'Launch before engaging cruise' };
      if (command.enabled && !state.targetPlanetId) return { ok: false, error: 'Select a planet first' };
      state.cruise = command.enabled;
      if (command.enabled) state.landing = false;
      return { ok: true };
    case 'launch': {
      if (!travelStatus(spec, state, geometry).canLaunch) return { ok: false, error: 'Launch requires being within 60 m of your landed vessel' };
      const p = system.planets.find(p => p.id === state.landedPlanetId)!;
      const radial = normalize(sub(state.landedVesselPosition!, p.center)), frame = tangentFrame(radial);
      state.position = { ...state.landedVesselPosition! };
      state.forward = radial; state.up = frame.north; state.velocity = scale(radial, 28);
      state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null; state.cruise = false;
      delete state.parkedVessel;
      record(state, 'launch', p.id);
      return { ok: true };
    }
    case 'land': {
      if (!travelStatus(spec, state, geometry).canLand) return { ok: false, error: 'Landing requires dry gentle terrain, altitude ≤180 m, and speed ≤65 m/s' };
      state.landing = true; state.cruise = false; state.velocity = { ...ZERO };
      return { ok: true };
    }
    case 'warp': {
      if (state.mode !== 'flight') return { ok: false, error: 'Warp requires flight' };
      const p = nearest(system, state.position);
      if (altitude(p, state.position) < p.atmosphere + 120) return { ok: false, error: 'Leave the atmosphere before warping' };
      if (command.systemIndex === state.systemIndex) return { ok: false, error: 'Already in that system' };
      const destination = generateSystem(spec, command.systemIndex).planets[0], local = landingSite(destination), radial = normalize(local);
      state.systemIndex = command.systemIndex;
      state.position = add(destination.center, scale(radial, destination.radius + 1800));
      state.forward = scale(radial, -1); state.up = tangentFrame(radial).north; state.velocity = { ...ZERO };
      state.targetPlanetId = destination.id; state.cruise = false;
      state.landing = false;
      record(state, 'warp', null);
      return { ok: true };
    }
  }
}
function approachVelocity(velocity: V3, desired: V3, maxDelta: number): V3 {
  const delta = sub(desired, velocity), len = length(delta);
  return len <= maxDelta ? desired : add(velocity, scale(delta, maxDelta / len));
}
/** Orbital waypoints route around any intervening world. Final descent follows a known dry site. */
export function navigationGoal(system: StarSystem, state: TravelState): { point: V3; final: boolean } {
  const target = system.planets.find(p => p.id === state.targetPlanetId)!;
  const localSite = landingSite(target), siteDir = normalize(localSite);
  const targetLocal = sub(state.position, target.center), aligned = dot(normalize(targetLocal), siteDir) > .993;
  let point = add(target.center, scale(siteDir, aligned ? length(localSite) + 85 : target.radius + 650));
  let final = aligned;
  // Starting below the obstacle envelope: climb before lateral navigation.
  for (const p of system.planets) {
    const local = sub(state.position, p.center);
    if (length(local) < p.radius + 380 && !(p.id === target.id && aligned)) {
      return { point: add(p.center, scale(normalize(local), p.radius + 600)), final: false };
    }
  }
  const travel = sub(point, state.position), dist = length(travel), dir = normalize(travel);
  let blocker: { p: PlanetDescriptor; t: number } | undefined;
  for (const p of system.planets) {
    if (p.id === target.id && aligned) continue;
    const offset = sub(p.center, state.position), t = dot(offset, dir);
    if (t <= 0 || t >= dist) continue;
    if (length(sub(offset, scale(dir, t))) < p.radius + 420 && (!blocker || t < blocker.t)) blocker = { p, t };
  }
  if (blocker) {
    const p = blocker.p, radial = normalize(sub(state.position, p.center)), goalDir = normalize(sub(point, p.center));
    let tangent = sub(goalDir, scale(radial, dot(goalDir, radial)));
    if (length(tangent) < 1e-5) tangent = tangentFrame(radial).north;
    tangent = normalize(tangent);
    const orbitDir = add(scale(radial, Math.cos(.4)), scale(tangent, Math.sin(.4)));
    point = add(p.center, scale(orbitDir, p.radius + 620)); final = false;
  }
  return { point, final };
}
/** Swept segment subdivision + terrain samples prevents tunnelling at cruise speed.
 * Step length is ≤2 m within each world's bounding terrain envelope. Outside it,
 * analytic sphere intersections restrict the expensive sample interval. */
export function sweepTravel(system: StarSystem, from: V3, to: V3, atlasRevision = 0, geometry?: TravelGeometry): { position: V3; collided: string | null } {
  const delta = sub(to, from), distance = length(delta);
  if (distance < 1e-9) return { position: to, collided: null };
  let earliest = 1, planetId: string | null = null;
  for (const p of system.planets) {
    if (atlasRevision) {
      const obstacle = atlasPlanetSweep(p, sub(from, p.center), sub(to, p.center), 3, atlasRevision);
      if (obstacle && obstacle.t <= earliest) {
        earliest = Math.max(0, obstacle.t - .01 / distance); planetId = p.id;
      }
    }
    const rel = sub(from, p.center), bound = p.radius + 500, a = dot(delta, delta), b = 2 * dot(rel, delta), c = dot(rel, rel) - bound * bound;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const root = Math.sqrt(disc), start = Math.max(0, (-b - root) / (2 * a)), end = Math.min(earliest, (-b + root) / (2 * a));
    if (end < start) continue;
    const steps = Math.max(1, Math.ceil((end - start) * distance / 2));
    let lastSafe = start;
    for (let i = 0; i <= steps; i++) {
      const t = start + (end - start) * i / steps, pos = add(from, scale(delta, t));
      if (altitude(p, pos, geometry, from) < TRAVEL_LIMITS.clearance - 1e-6) {
        let lo = lastSafe, hi = t;
        for (let j = 0; j < 12; j++) {
          const mid = (lo + hi) / 2;
          if (altitude(p, add(from, scale(delta, mid)), geometry, from) < TRAVEL_LIMITS.clearance - 1e-6) hi = mid; else lo = mid;
        }
        if (lo < earliest) { earliest = lo; planetId = p.id; }
        break;
      }
      lastSafe = t;
    }
  }
  return { position: add(from, scale(delta, earliest)), collided: planetId };
}
export function stepTravel(spec: UniverseSpec, state: TravelState, input: TravelInput = neutralInput(), geometry?: TravelGeometry): void {
  if (state.personalFlight) throw Error('Personal flight must use canonical body capabilities');
  const system = generateSystem(spec, state.systemIndex), dt = TRAVEL_DT;
  state.tick++;
  if (state.mode === 'surface') {
    const p = system.planets.find(p => p.id === state.landedPlanetId)!;
    const radial = normalize(sub(state.position, p.center));
    state.forward = normalize(rotate(state.forward, radial, input.yaw * dt * 1.8));
    const right = normalize(cross(state.forward, radial));
    const move = add(scale(state.forward, input.throttle), scale(right, input.strafe));
    const candidate = add(state.position, scale(move, TRAVEL_LIMITS.walkSpeed * dt / Math.max(1, length(move))));
    const nextDir = normalize(sub(candidate, p.center));
    if (terrainHeight(p, nextDir) >= 0 && dot(terrainNormal(p, nextDir), nextDir) >= .6) {
      const ground = scale(nextDir, surfaceRadius(p, nextDir, geometry, state.position));
      const step = atlasPlanetWalkStep(p, sub(state.position, p.center), ground, state.atlasRevision ?? 0);
      if (step.blocked) {
        state.velocity = { ...ZERO }; return;
      }
      const next = add(p.center, step.position);
      state.velocity = scale(sub(next, state.position), 1 / dt); state.position = next; state.up = nextDir;
      state.forward = normalize(sub(state.forward, scale(nextDir, dot(state.forward, nextDir))));
    } else state.velocity = { ...ZERO };
    return;
  }
  if (state.landing) {
    const p = nearest(system, state.position), radial = normalize(sub(state.position, p.center));
    if (!atlasPlanetLandingClear(p, sub(state.position, p.center), state.atlasRevision ?? 0)) {
      state.landing = false; state.velocity = { ...ZERO }; record(state, 'collision', p.id); return;
    }
    const remaining = Math.max(0, altitude(p, state.position, geometry) - TRAVEL_LIMITS.clearance);
    const downwardSpeed = Math.min(40, Math.max(4, remaining * 5));
    const distance = Math.min(remaining, downwardSpeed * dt);
    state.position = sub(state.position, scale(radial, distance));
    state.velocity = scale(radial, -distance / dt);
    if (remaining <= .05) {
      state.position = add(p.center, scale(radial, surfaceRadius(p, radial, geometry, state.position) + TRAVEL_LIMITS.clearance));
      state.forward = tangentFrame(radial).north; state.up = radial; state.velocity = { ...ZERO };
      state.mode = 'surface'; state.landedPlanetId = p.id; state.landedVesselPosition = { ...state.position };
      state.landing = false;
      discover(state, p); record(state, 'land', p.id);
    }
    return;
  }
  let desired: V3;
  if (state.cruise && state.targetPlanetId) {
    const goal = navigationGoal(system, state), offset = sub(goal.point, state.position), distance = length(offset);
    const direction = normalize(offset), near = nearest(system, state.position), alt = altitude(near, state.position, geometry);
    // Terrain proximity and stopping distance independently cap cruise speed.
    const cap = Math.min(TRAVEL_LIMITS.cruiseSpeed, Math.max(40, Math.sqrt(Math.max(0, alt - 12) * TRAVEL_LIMITS.acceleration)), Math.sqrt(distance * 2 * TRAVEL_LIMITS.acceleration));
    const speed = goal.final ? Math.min(cap, distance * 1.3) : Math.min(cap, Math.max(45, distance * 2));
    desired = scale(direction, speed);
    if (distance > 1) {
      state.forward = direction;
      const radial = normalize(sub(state.position, near.center));
      state.up = normalize(sub(radial, scale(direction, dot(radial, direction))));
      if (Math.abs(dot(state.up, state.forward)) > .01) state.up = tangentFrame(direction).north;
    }
    if (goal.final && distance < 3 && length(state.velocity) < 6) { state.cruise = false; desired = { ...ZERO }; }
  } else {
    state.forward = normalize(rotate(state.forward, state.up, input.yaw * dt * 1.25));
    const right = normalize(cross(state.forward, state.up));
    state.forward = normalize(rotate(state.forward, right, input.pitch * dt * 1.25));
    state.up = normalize(cross(right, state.forward));
    const direction = add(add(scale(state.forward, input.throttle), scale(right, input.strafe)), scale(state.up, input.lift));
    desired = input.brake ? { ...ZERO } : scale(direction, TRAVEL_LIMITS.flightSpeed / Math.max(1, length(direction)));
  }
  state.velocity = approachVelocity(state.velocity, desired, TRAVEL_LIMITS.acceleration * dt);
  const motion = sweepTravel(system, state.position, add(state.position, scale(state.velocity, dt)), state.atlasRevision ?? 0, geometry);
  state.position = motion.position;
  if (motion.collided) {
    state.velocity = { ...ZERO }; state.cruise = false;
    if (state.events.at(-1)?.type !== 'collision' || state.tick - state.events.at(-1)!.tick > 20) record(state, 'collision', motion.collided);
  }
}
