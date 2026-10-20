/** Capability-driven locomotion in the same system frame as vessels. This module
 * consumes a host assessment; it cannot grant knowledge, mana, rank or equipment. */
import { add, sub, scale, dot, cross, normalize, length, tangentFrame, type V3 } from '../planet/planet';
import { generateSystem, terrainHeight, terrainNormal, type UniverseSpec, type StarSystem } from './generation';
import { atlasPlanetSupport, atlasPlanetWalkBlocked } from '../atlas/collision';
import { navigationGoal, recordTravel, sweepTravel, travelSurfaceRadius, TRAVEL_DT,
  type TravelState, type TravelInput, type UniverseCommand, type CommandResult, type TravelGeometry } from './travel';

export interface PersonalFlightCapacity {
  canHover: boolean; canFly: boolean; canCrossSpace: boolean;
  spaceEnvelope?: boolean;
  speed: number; acceleration: number; maxAltitude: number;
  estimatedEndurance: number; manaPerSecond: number; effortPerSecond: number;
  reasons: readonly string[];
}
const zero = (): V3 => ({ x: 0, y: 0, z: 0 });
const rotate = (v: V3, axis: V3, angle: number) =>
  add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))), scale(axis, dot(axis, v) * (1 - Math.cos(angle))));
export function flightEnvironment(spec: UniverseSpec, state: TravelState, geometry?: TravelGeometry) {
  const system = generateSystem(spec, state.systemIndex);
  const altitude = (p: StarSystem['planets'][number]) => {
    const local = sub(state.position, p.center);
    return length(local) - travelSurfaceRadius(p, normalize(local), geometry, state.position);
  };
  const planet = system.planets.reduce((a, b) => altitude(a) < altitude(b) ? a : b);
  return { planet, altitude: altitude(planet), gravity: planet.gravity, atmosphereHeight: planet.atmosphere };
}
/** Conservative route estimate includes climbing, a half-circumference detour,
 * braking and final descent. Admission is recalculated by the canonical host. */
export function personalRouteDistance(spec: UniverseSpec, state: TravelState, planetId: string): number {
  const system = generateSystem(spec, state.systemIndex), target = system.planets.find(p => p.id === planetId);
  if (!target) return Infinity;
  const near = flightEnvironment(spec, state).planet;
  return length(sub(target.center, state.position)) + Math.PI * Math.max(target.radius, near.radius) + 1200;
}
export function beginPersonalFlight(spec: UniverseSpec, state: TravelState, bodyId: string, capacity: PersonalFlightCapacity): CommandResult {
  if (state.mode !== 'surface' || state.personalFlight) return { ok: false, error: 'Lift off from standing ground.' };
  if (!capacity.canHover) return { ok: false, error: capacity.reasons[0] ?? 'This body cannot sustain magical lift.' };
  const planetId = state.landedPlanetId!;
  if (!state.parkedVessel && state.landedVesselPosition)
    state.parkedVessel = { systemIndex: state.systemIndex, planetId, position: { ...state.landedVesselPosition } };
  if (!state.parkedVessel) return { ok: false, error: 'The saved vessel location is unavailable.' };
  // No relocation to the vessel: lift starts at the body's actual current point.
  state.personalFlight = { version: 1, bodyId, phase: 'powered', manaSpent: 0, effortSpent: 0 };
  state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null;
  state.velocity = scale(normalize(sub(state.position, flightEnvironment(spec, state).planet.center)), 1);
  state.cruise = false; state.landing = false;
  recordTravel(state, 'soar', planetId);
  return { ok: true };
}
export function commandPersonalFlight(spec: UniverseSpec, state: TravelState, command: UniverseCommand, capacity: PersonalFlightCapacity): CommandResult {
  if (!state.personalFlight) return { ok: false, error: 'This body is not flying.' };
  const system = generateSystem(spec, state.systemIndex);
  switch (command.type) {
    case 'warp': return { ok: false, error: 'Gravity flight does not confer the ability to cross the veil between stars.' };
    case 'launch': case 'soar': return { ok: false, error: 'Already in personal flight.' };
    case 'input':
      if (Object.entries(command.input).some(([k, v]) => k === 'brake' ? v : Math.abs(Number(v)) > .01)) {
        state.cruise = false; state.landing = false;
        if (state.personalFlight.phase === 'descending' && capacity.estimatedEndurance > 15) state.personalFlight.phase = 'powered';
      }
      return { ok: true };
    case 'target': case 'navigate':
      if (!system.planets.some(p => p.id === command.planetId)) return { ok: false, error: 'Planet does not belong to this system.' };
      if (command.type === 'navigate' && !capacity.canCrossSpace)
        return { ok: false, error: capacity.reasons.find(r => !r.includes('no canonical mass')) ?? 'Insufficient protection or reserve for that flight.' };
      state.targetPlanetId = command.planetId;
      if (command.type === 'navigate') { state.cruise = true; state.landing = false; }
      return { ok: true };
    case 'cruise':
      if (command.enabled && (!state.targetPlanetId || !capacity.canCrossSpace))
        return { ok: false, error: capacity.reasons.find(r => !r.includes('no canonical mass')) ?? 'Insufficient protection or reserve for that flight.' };
      state.cruise = command.enabled; state.landing = false;
      return { ok: true };
    case 'land':
      state.cruise = false; state.personalFlight.phase = 'descending';
      return { ok: true };
  }
}
export interface PersonalFlightStep { powered: boolean; mana: number; effort: number; contactSpeed: number; landed: boolean }
/** No frame-rate clock, hard position clamp, teleport or mana recovery. If lift
 * becomes unavailable the body keeps its momentum and falls under local gravity. */
export function stepPersonalFlight(spec: UniverseSpec, state: TravelState, input: TravelInput, capacity: PersonalFlightCapacity, geometry?: TravelGeometry): PersonalFlightStep {
  if (!state.personalFlight) throw Error('Missing personal flight state');
  const system = generateSystem(spec, state.systemIndex), env = flightEnvironment(spec, state, geometry), p = env.planet, dt = TRAVEL_DT;
  const radial = normalize(sub(state.position, p.center)), flight = state.personalFlight;
  const result: PersonalFlightStep = { powered: capacity.canHover, mana: 0, effort: 0, contactSpeed: 0, landed: false };
  state.tick++;
  const descentSpeed = Math.max(2, Math.min(capacity.spaceEnvelope ? capacity.speed * .7 : 30, capacity.speed * .7));
  const descentSeconds = Math.max(0, env.altitude - 3) / descentSpeed + capacity.speed / Math.max(1, capacity.acceleration) + 4;
  // Preserve time to reach ground; the reserve is real and continues to be spent.
  if (capacity.canHover && capacity.estimatedEndurance <= descentSeconds) flight.phase = 'descending';
  if (!capacity.canHover) { flight.phase = 'unpowered'; state.cruise = false; }
  else if (flight.phase === 'unpowered') flight.phase = 'descending';
  if (flight.phase === 'descending') state.cruise = false;
  const acceleration = Math.max(.1, capacity.acceleration);
  let desired = zero();
  if (capacity.canHover) {
    result.mana = capacity.manaPerSecond * dt; result.effort = capacity.effortPerSecond * dt;
    if (flight.phase === 'descending') {
      desired = scale(radial, -Math.min(descentSpeed, Math.max(1, (env.altitude - 3) * 2), Math.sqrt(Math.max(1, env.altitude - 3) * acceleration)));
    } else if (state.cruise && state.targetPlanetId) {
      const goal = navigationGoal(system, state), offset = sub(goal.point, state.position), distance = length(offset);
      const direction = normalize(offset), safeSpeed = Math.sqrt(Math.max(0, env.altitude - 3) * 2 * acceleration);
      desired = scale(direction, Math.min(capacity.speed, Math.max(4, safeSpeed), Math.sqrt(distance * 2 * acceleration), goal.final ? distance * 1.3 : Infinity));
      if (distance > 1) {
        state.forward = direction;
        const projected = sub(radial, scale(direction, dot(radial, direction)));
        state.up = length(projected) < .001 ? tangentFrame(direction).north : normalize(projected);
      }
      if (goal.final && distance < 3 && length(state.velocity) < 4) { state.cruise = false; desired = zero(); }
    } else {
      state.forward = normalize(rotate(state.forward, state.up, input.yaw * dt * 1.4));
      const right = normalize(cross(state.forward, state.up));
      state.forward = normalize(rotate(state.forward, right, input.pitch * dt * 1.4));
      state.up = normalize(cross(right, state.forward));
      const direction = add(add(scale(state.forward, capacity.canFly ? input.throttle : 0), scale(right, capacity.canFly ? input.strafe : 0)), scale(radial, input.lift));
      desired = input.brake ? zero() : scale(direction, capacity.speed / Math.max(1, length(direction)));
    }
    // Atmospheric lift/protection has a physical envelope. Brake ascent before it
    // reaches that limit; reduced capacity can force a continuous descent.
    const ceiling = capacity.maxAltitude;
    const climb = dot(desired, radial), margin = ceiling - env.altitude;
    const allowedClimb = margin < 0 ? -Math.min(descentSpeed, -margin * 2) : Math.sqrt(Math.max(0, margin - 1) * acceleration);
    if (climb > allowedClimb) desired = add(desired, scale(radial, allowedClimb - climb));
    const delta = sub(desired, state.velocity), n = length(delta);
    state.velocity = n <= acceleration * dt ? desired : add(state.velocity, scale(delta, acceleration * dt / n));
  } else {
    // Gravity weakens with distance; atmospheric drag gives a finite fall speed.
    const gravity = p.gravity * (p.radius / Math.max(p.radius, length(sub(state.position, p.center)))) ** 2;
    state.velocity = sub(state.velocity, scale(radial, gravity * dt));
    if (env.altitude < p.atmosphere) state.velocity = scale(state.velocity, Math.exp(-.12 * dt));
  }
  const next = add(state.position, scale(state.velocity, dt)), impactSpeed = length(state.velocity);
  const motion = sweepTravel(system, state.position, next, 0, geometry);
  const atlasBlocked = system.planets.some(planet => {
    const from = sub(state.position, planet.center), to = sub(motion.position, planet.center);
    return length(from) < planet.radius + 610 && atlasPlanetWalkBlocked(planet, from, to, state.atlasRevision ?? 0);
  });
  if (!atlasBlocked) state.position = motion.position;
  if (atlasBlocked || motion.collided) {
    state.velocity = zero(); state.cruise = false; result.contactSpeed = impactSpeed;
    if (state.events.at(-1)?.type !== 'collision' || state.tick - state.events.at(-1)!.tick > 20)
      recordTravel(state, 'collision', p.id);
  }
  const at = flightEnvironment(spec, state, geometry), d = normalize(sub(state.position, at.planet.center));
  const support = atlasPlanetSupport(at.planet, d, state.atlasRevision ?? 0);
  const contact = at.altitude <= 3 + support + .06 && terrainHeight(at.planet, d) >= 0 && dot(terrainNormal(at.planet, d), d) >= .6;
  if (contact && (flight.phase !== 'powered' || dot(desired, d) < -.1)) {
    const point = add(at.planet.center, scale(d, travelSurfaceRadius(at.planet, d, geometry, state.position) + 3 + support));
    if (!atlasPlanetWalkBlocked(at.planet, sub(point, at.planet.center), sub(point, at.planet.center), state.atlasRevision ?? 0)) {
      state.position = point; state.velocity = zero(); state.up = d;
      const forward = sub(state.forward, scale(d, dot(state.forward, d)));
      state.forward = length(forward) > .001 ? normalize(forward) : tangentFrame(d).north;
      state.mode = 'surface'; state.landedPlanetId = at.planet.id; state.landing = false; state.cruise = false;
      const parked = state.parkedVessel!;
      state.landedVesselPosition = parked.systemIndex === state.systemIndex && parked.planetId === at.planet.id ? { ...parked.position } : null;
      delete state.personalFlight;
      if (!state.discoveries.some(x => x.planetId === at.planet.id))
        state.discoveries.push({ planetId: at.planet.id, systemIndex: state.systemIndex, tick: state.tick, explorerId: state.explorerId, method: 'landed' });
      recordTravel(state, 'land', at.planet.id); result.landed = true;
    }
  }
  return result;
}
