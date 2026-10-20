/** Canonical host adapters for the pure realm/sphere mapping. The retained planar
 * Body remains the residency anchor; only the universe pose is advanced here. */
import type { RealmSession } from '../sim/world/realms/session';
import { REALMS, REALM_CHUNK, type RealmId } from '../sim/world/realms/layout';
import { generateSystem, universeSpec } from '../sim/world/universe/generation';
import {
  settlementAt, settlementPatches, settlementSaveValidator, settlementToPlanet, sweepSettlements,
  type SettlementSupport, type SettlementSweep,
} from '../sim/world/universe/settlements';
import { add, dot, length, normalize, planetSpec, scale, sub, tangentFrame, type V3 } from '../sim/world/planet/planet';
import { TRAVEL_DT, type PersonalFlight, type TravelState } from '../sim/world/universe/travel';

const homeSpec = (s: RealmSession) => planetSpec(s.world.seed, generateSystem(universeSpec(s.world.seed), 0).planets[0].radius);
type SettlementState = TravelState & { settlementRevision?: 1 };
export function canonicalSettlementProjection(s: RealmSession) {
  const patches = settlementPatches(s.grid);
  const chunks: { realm: RealmId; chunk: ReturnType<RealmSession['grid']['chunk']> }[] = [];
  const doors: { realm: RealmId; x: number; y: number; z: number; open: boolean }[] = [];
  for (const patch of patches) {
    const offset = REALMS[patch.realm].offset, b = patch.bounds;
    const x0 = Math.max(0, Math.min(31, Math.floor((b.x0 - offset) / REALM_CHUNK)));
    const x1 = Math.min(63, Math.max(33, Math.floor((b.x1 - offset - 1e-6) / REALM_CHUNK)));
    const z0 = Math.max(0, Math.min(31, Math.floor(b.z0 / REALM_CHUNK)));
    const z1 = Math.min(63, Math.max(33, Math.floor((b.z1 - 1e-6) / REALM_CHUNK)));
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 256) throw Error('Canonical settlement projection exceeds bounded patch budget');
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const chunk = s.grid.chunk(patch.realm, cx, cz);
      chunks.push({ realm: patch.realm, chunk });
      for (const building of chunk.buildings) {
        const p = building.door;
        doors.push({ realm: patch.realm, ...p, open: s.grid.isDoorOpen(p.x, p.y, p.z) });
      }
    }
  }
  // Projection callers cannot mutate the world's cached descriptors or source plans.
  return structuredClone({ version: 1 as const, seed: s.world.seed, patches, chunks, doors,
    focused: s.grid.focusedTown, terrain: s.grid.focusedTerrain });
}
/** Planar Body feet -> universe reference (three metres above those same feet). */
export function bodyPointToUniverse(s: RealmSession, realm: RealmId, planarFeet: V3): V3 {
  const feet = settlementToPlanet(homeSpec(s), realm, planarFeet);
  return add(feet, scale(normalize(feet), 3));
}
/** Returns null outside the two canonical patches; never projects a different
 * planet, opposite chart or deep-space position into an inhabited town. */
export function universePointToBody(s: RealmSession, position: V3, systemIndex = 0):
  { realm: RealmId; position: V3 } | null {
  if (systemIndex !== 0) return null;
  const spec = homeSpec(s), feet = sub(position, scale(normalize(position), 3));
  const address = settlementAt(spec, feet, settlementPatches(s.grid));
  // A planar Body handoff requires actual support and collision clearance,
  // rather than using angular alignment alone to hand off from orbit.
  if (!address || !settlementSaveValidator(spec, s.grid)('body', position, 0, 'surface')) return null;
  return { realm: address.patch.realm, position: address.planar };
}
export function validateUniverseSettlementPosition(s: RealmSession, state: TravelState): boolean {
  if ((state as SettlementState).settlementRevision !== 1) return true;
  const validate = settlementSaveValidator(homeSpec(s), s.grid);
  const kind = state.mode === 'flight' && !state.personalFlight ? 'vessel' : 'body';
  if (validate(kind, state.position, state.systemIndex, state.mode) === false) return false;
  if (state.landedVesselPosition && validate('vessel', state.landedVesselPosition, state.systemIndex, 'surface') === false) return false;
  const parked = state.parkedVessel;
  return !parked || validate('vessel', parked.position, parked.systemIndex, 'surface') !== false;
}
export interface ConstrainedSettlementMovement {
  collision: SettlementSweep['collision']; headroom: boolean; support: SettlementSupport | null;
  /** Parent owns the single land event/discovery/body transition. */
  landingCandidate: { position: V3; support: SettlementSupport } | null;
  contactSpeed: number; rejectedLanding: boolean;
}
/** Apply live geometry after the pure flight/terrain integrator. Pass the prior
 * PersonalFlight object, not merely true, when a step may complete touchdown;
 * that retained object allows a premature terrain-only touchdown to be undone. */
export function constrainUniverseSettlementMovement(s: RealmSession, from: V3, wasFlight: boolean,
  personal: boolean | PersonalFlight = false): ConstrainedSettlementMovement {
  const binding = s.world.universeExpedition, state = binding?.state as SettlementState | undefined;
  const empty: ConstrainedSettlementMovement = { collision: null, headroom: true, support: null,
    landingCandidate: null, contactSpeed: 0, rejectedLanding: false };
  if (!binding || !state || state.settlementRevision !== 1 || state.systemIndex !== 0) return empty;
  const home = generateSystem(binding.spec, 0).planets[0];
  if (state.mode === 'surface' && state.landedPlanetId !== home.id) return empty;
  const spec = homeSpec(s), patches = settlementPatches(s.grid), target = { ...state.position };
  const body = !!personal || !wasFlight, completed = wasFlight && state.mode === 'surface';
  const shape = { radius: body ? .3 : 3, height: body ? 1.8 : 6, footOffset: 3, mode: wasFlight ? 'flight' as const : 'walk' as const };
  const localFrom = sub(from, home.center), localTarget = sub(target, home.center);
  const atTarget = settlementAt(spec, sub(localTarget, scale(normalize(localTarget), 3)), patches);
  const wanted = !wasFlight && atTarget ? scale(normalize(localTarget), length(localFrom)) : localTarget;
  const result = sweepSettlements(spec, s.grid, localFrom, wanted, shape, patches);
  state.position = add(home.center, result.position);
  const impact = Math.max(length(state.velocity), length(sub(wanted, localFrom)) / TRAVEL_DT);
  if (result.collision) {
    state.velocity = { x: 0, y: 0, z: 0 }; state.cruise = false; state.landing = false;
  } else if (!wasFlight) state.velocity = scale(sub(state.position, from), 1 / TRAVEL_DT);
  let landingCandidate: ConstrainedSettlementMovement['landingCandidate'] = null;
  const radial = normalize(result.position), downward = dot(sub(target, from), radial) < -.0001;
  if (wasFlight && (completed || downward && !!result.collision)) {
    const supported = sweepSettlements(spec, s.grid, result.position, result.position, { ...shape, mode: 'walk', stepHeight: .55 }, patches);
    if (!supported.collision && supported.support && length(sub(supported.position, result.position)) <= .55)
      landingCandidate = { position: add(home.center, supported.position), support: supported.support };
  }
  if (completed && (atTarget || result.collision || landingCandidate)) {
    // The terrain integrator can reach its own floor before source geometry is
    // applied. Withdraw only this tick's tentative outcome; the host records the
    // accepted landingCandidate once, after canonical source clearance.
    if (personal === true && !state.personalFlight) throw Error('Completed personal touchdown requires its prior flight record');
    state.mode = 'flight'; state.landedPlanetId = null; state.landedVesselPosition = null;
    if (typeof personal === 'object') state.personalFlight = personal;
    state.events = state.events.filter(e => !(e.tick === state.tick && e.type === 'land'));
    state.discoveries = state.discoveries.filter(d => !(d.tick === state.tick && d.planetId === home.id && d.tick > 0));
  }
  if (state.mode === 'surface') {
    state.up = normalize(sub(state.position, home.center));
    const tangent = sub(state.forward, scale(state.up, dot(state.forward, state.up)));
    state.forward = length(tangent) > 1e-6 ? normalize(tangent) : tangentFrame(state.up).north;
  }
  return { collision: result.collision, headroom: result.headroom, support: result.support, landingCandidate,
    contactSpeed: result.collision ? impact : 0, rejectedLanding: completed && !!atTarget && !landingCandidate };
}
