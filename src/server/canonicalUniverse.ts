import { createHash } from 'node:crypto';
import type { RealmSession } from '../sim/world/realms/session';
import { realmAt, type Point } from '../sim/world/realms/layout';
import { collisionColumn, movementState } from '../sim/physical/interactionMovement';
import { INTERACTION_SPEC, postureFits, predictMovement, type ColumnQuery } from '../sim/physical/prediction';
import { combatBusy } from '../sim/physical/combatAction';
import { generateSystem, universeSpec, type StarSystem, type UniverseSpec } from '../sim/world/universe/generation';
import { applyTravelCommand, createTravelState, neutralInput, parseUniverseCommand, stepTravel, travelStatus,
  TRAVEL_LIMITS, type CommandResult, type TravelState, type TravelStatus, type UniverseCommand } from '../sim/world/universe/travel';
import { length, sub, normalize, scale, dot, tangentFrame, planetSpec } from '../sim/world/planet/planet';
import { assessMagicalFlight, type MagicalFlightAssessment } from '../sim/physical/arcana/flight';
import { beginPersonalFlight, commandPersonalFlight, flightEnvironment, personalRouteDistance, stepPersonalFlight } from '../sim/world/universe/personalFlight';
import { stepUniverseBody } from './universeBody';
import { humanoidVisualState, projectAppearance } from '../bridge/visualState';
import { equipmentProjection } from '../sim/physical/equipment';
import type { PersonalFlight } from '../sim/world/universe/travel';
import { surfaceEntryState } from './universeEntry';
import { constrainUniverseSettlementMovement, universePointToBody } from './universeSettlements';
import { recordTravel } from '../sim/world/universe/travel';
import { settlementGroundAt, planetDirectionToSettlement } from '../sim/world/universe/settlements';
import type { TravelGeometry } from '../sim/world/universe/travel';
import { universeContactPatch, type UniverseContactPatch } from './universeContacts';

export interface CanonicalUniverseCommand { type: 'enter' | 'explore' | 'ascend' | 'return'; id: string; revision: number }
export interface CanonicalUniverseView {
  snapshot: { spec: UniverseSpec; system: StarSystem; state: TravelState; revision: number; status: TravelStatus } | null;
  campaign: {
    active: boolean; revision: number; personId: string; bodyId: string; name: string; rank: string;
    health: number; maxHealth: number; inventory: { id: string; name: string; quantity: number }[];
    canEnter: boolean; canReturn: boolean; message: string;
    flight: MagicalFlightAssessment;
    body: ReturnType<typeof projectTraveler>;
    canExplore: boolean;
    preview: CanonicalUniverseView['snapshot'];
    doors: { index: number; open: boolean }[];
    footSupport: UniverseContactPatch | null;
  };
}
function projectTraveler(s: RealmSession) {
  const p = s.person, b = s.body;
  return { ...humanoidVisualState(b, p.name, s.world.universeExpedition?.state.personalFlight ? 'magical flight' : b.pose, projectAppearance(p)),
    combatAction: null, guarding: false, speech: '', presentationSex: p.gender,
    equipment: equipmentProjection(s.world, b), health: b.health, maxHealth: b.maxHealth, needs: { ...p.needs } };
}
function flightAssessment(s: RealmSession, routePlanetId?: string) {
  const r = s.world.universeExpedition;
  const env = r ? flightEnvironment(r.spec, r.state, canonicalTravelGeometry(s)) : {
    gravity: 9.81, atmosphereHeight: generateSystem(universeSpec(s.world.seed), 0).planets[0].atmosphere, altitude: 3 };
  return assessMagicalFlight(s.world, s.person, s.body, { gravity: env.gravity, atmosphereHeight: env.atmosphereHeight,
    altitude: env.altitude, ...(r && routePlanetId ? { routeDistance: personalRouteDistance(r.spec, r.state, routePlanetId) } : {}) });
}
function canonicalTravelGeometry(s: RealmSession, state = s.world.universeExpedition?.state): TravelGeometry | undefined {
  if (state?.settlementRevision !== 1) return undefined;
  const sphere = planetSpec(s.world.seed);
  return { surfaceRadius: (planet, direction, reference) => state.systemIndex === 0 && planet.index === 0
    ? settlementGroundAt(sphere, s.grid, reference, direction)?.radius : undefined };
}

function entryBlock(s: RealmSession): string | null {
  const w = s.world, p = s.person, b = s.body;
  if (w.universeExpedition?.active) return 'Already aboard the Veil vessel.';
  if (w.realmExpedition?.active || w.canonicalTower?.active || s.inTower()) return 'Return to town before boarding.';
  if (!b || !movementState(w, p, b).eligible || combatBusy(b, w.physicalTime) || b.recoil || b.traversal
    || b.arcana?.cast && b.arcana.cast.completeAt > w.physicalTime) return 'This body cannot board now.';
  if (p.bodies.some(id => id !== b.id && w.body(id)?.present)) return 'Resolve the other manifestation before boarding.';
  if (s.checkpointControl().pending || b.path || length(b.vel) > .1) return 'Stand still and cancel any pending crossing before boarding.';
  if (!realmAt(b.pos.x, b.pos.z)) return 'Board from an inhabited realm.';
  const geometry = w.grid.movementGeometryAt(b.pos.x, b.pos.z);
  if (geometry ? !geometry.fits(b.pos.x, b.pos.y, b.pos.z, .3, 1.8)
    : b.pos.y !== 1 || !w.nav.isWalkable(Math.floor(b.pos.x), Math.floor(b.pos.z))) return 'The return landing is obstructed.';
  return null;
}
/** An occupied gateway can resolve to nearby ground, but never through static
 * obstacles. The ordinary movement predictor checks every 10 cm of the route.
 * Candidate ordering and its three-metre budget are deterministic on replay. */
function returnArrival(s: RealmSession, anchor = s.world.universeExpedition!.returnPos, realm = s.world.universeExpedition!.realm): Point | null {
  const w = s.world, r = w.universeExpedition!;
  const columns = new Map<string, ReturnType<typeof collisionColumn>>();
  const query: ColumnQuery = (x, z) => {
    const key = `${x}:${z}`;
    if (!columns.has(key)) columns.set(key, collisionColumn(w, x, z));
    return columns.get(key);
  };
  query.geometryAt = (x, z) => w.grid.movementGeometryAt(x, z);
  const initial = { pos: { ...anchor }, yaw: r.returnYaw, speed: 0, eligible: true, crouch: 0 };
  const floorAt = (pos: Point) => {
    const geometry = query.geometryAt!(pos.x, pos.z);
    return geometry ? geometry.supportAt(pos.x, pos.z, pos.y, INTERACTION_SPEC.stepHeight)
      : query(Math.floor(pos.x), Math.floor(pos.z))?.floor;
  };
  const anchorFloor = floorAt(anchor);
  if (anchorFloor === undefined || anchorFloor === null || Math.abs(anchorFloor - anchor.y) > .05 || !postureFits(initial, 0, query)) return null;
  const offsets: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (const radius of [1, 1.5, 2, 2.5, 3]) for (let i = 0; i < 16; i++)
    offsets.push({ x: radius * Math.cos(i * Math.PI / 8), z: radius * Math.sin(i * Math.PI / 8) });
  for (const offset of offsets) {
    const distance = Math.hypot(offset.x, offset.z), target = { x: anchor.x + offset.x, y: anchor.y, z: anchor.z + offset.z };
    if (realmAt(target.x, target.z) !== realm) continue;
    const next = distance ? predictMovement({ ...initial, speed: distance / .1 },
      { x: offset.x / distance, z: offset.z / distance, sprint: false }, .1, query) : initial;
    if (Math.hypot(next.pos.x - target.x, next.pos.z - target.z) > 1e-5
      || length(sub(next.pos, anchor)) > 3 + 1e-5 || !postureFits(next, 0, query)) continue;
    const geometry = query.geometryAt!(next.pos.x, next.pos.z), support = floorAt(next.pos);
    if (support === undefined || support === null || support < 0 || Math.abs(support - next.pos.y) > .05
      || geometry && !geometry.fits(next.pos.x, next.pos.y, next.pos.z, .3, 1.8)) continue;
    if (w.nearbyPhysicalBodies(next.pos, .8).some(other => other.id !== r.bodyId
      && Math.hypot(other.pos.x - next.pos.x, other.pos.z - next.pos.z) < .8 && Math.abs(other.pos.y - next.pos.y) < 1.8)) continue;
    return { ...next.pos };
  }
  return null;
}
function returnAccess(s: RealmSession): { message: string | null; arrival: Point | null } {
  const r = s.world.universeExpedition;
  const blocked = (message: string) => ({ message, arrival: null });
  if (!r?.active) return blocked('Board the vessel to begin.');
  const state = r.state, home = generateSystem(r.spec, 0).planets[0];
  if (!s.person.alive || s.body.dead || s.body.health <= 0) return blocked('This body cannot return.');
  if (state.settlementRevision === 1) {
    if (state.mode !== 'surface' || state.systemIndex !== 0 || state.landedPlanetId !== home.id)
      return blocked('Land in either home town to resume its ordinary interactions.');
    const mapped = universePointToBody(s, state.position, state.systemIndex);
    if (!mapped) return blocked('Walk into a home town to resume its ordinary interactions.');
    const arrival = returnArrival(s, mapped.position, mapped.realm);
    return arrival ? { message: null, arrival } : blocked('The nearby town ground is occupied or obstructed.');
  }
  if (state.mode !== 'surface' || state.systemIndex !== 0 || state.landedPlanetId !== home.id
    || !state.landedVesselPosition || length(sub(state.position, state.landedVesselPosition)) > TRAVEL_LIMITS.launchDistance)
    return blocked('Land on Cinderveil and approach your vessel to return to town.');
  const b = s.body;
  if (!s.person.alive || b.dead || b.health <= 0) return blocked('This body cannot return.');
  const arrival = returnArrival(s);
  return arrival ? { message: null, arrival } : blocked('The town arrival and nearby safe ground are obstructed. Wait until they clear.');
}

export function canonicalUniverseView(s: RealmSession): CanonicalUniverseView {
  const r = s.world.universeExpedition, p = s.person, b = s.body;
  const enter = entryBlock(s), back = returnAccess(s);
  let preview: CanonicalUniverseView['snapshot'] = null;
  if (!enter) try {
    const state = surfaceEntryState(s), spec = universeSpec(s.world.seed);
    preview = { spec, system: generateSystem(spec, 0), state, revision: r?.snapshotRevision ?? 0, status: travelStatus(spec, state, canonicalTravelGeometry(s, state)) };
  } catch { /* Existing gateway saves retain their pinned geographic contract. */ }
  return {
    snapshot: r ? { spec: { ...r.spec }, system: generateSystem(r.spec, r.state.systemIndex), state: structuredClone(r.state),
      revision: r.snapshotRevision, status: travelStatus(r.spec, r.state, canonicalTravelGeometry(s)) } : null,
    campaign: { active: r?.active ?? false, revision: r?.revision ?? 0, personId: p.id, bodyId: b.id, name: p.name,
      rank: p.ontology.stage, health: b.health, maxHealth: b.maxHealth,
      flight: flightAssessment(s), body: projectTraveler(s),
      canExplore: !!preview, preview, doors: [...s.world.grid.doorStates].map(([index, open]) => ({ index, open })),
      footSupport: universeContactPatch(s, r?.active ? r.state : preview?.state, generateSystem(universeSpec(s.world.seed), 0).planets[0]),
      inventory: p.inventory.flatMap(id => { const item = s.world.item(id); return item ? [{ id, name: item.name, quantity: item.quantity }] : []; }),
      canEnter: enter === null, canReturn: back.message === null, message: r?.active ? back.message ?? 'Cinderveil docking link ready.' : enter ?? 'Veil boarding link ready.' },
  };
}
export const canonicalUniverseSnapshot = (s: RealmSession) => canonicalUniverseView(s).snapshot;

/** Structural command. The realm journal owns commit/rollback and acknowledgement. */
export function applyCanonicalUniverseCommand(s: RealmSession, c: CanonicalUniverseCommand): CommandResult {
  if (!c || !['enter', 'explore', 'ascend', 'return'].includes(c.type) || typeof c.id !== 'string' || !/^[\w:-]{8,100}$/.test(c.id)
    || !Number.isSafeInteger(c.revision) || c.revision < 0 || Object.keys(c).some(k => !['type', 'id', 'revision'].includes(k)))
    throw Error('Invalid universe transition');
  const digest = createHash('sha256').update(JSON.stringify({ type: c.type, id: c.id, revision: c.revision })).digest('hex');
  const previous = s.world.universeExpedition, receipt = previous?.commands.find(x => x.id === c.id);
  if (receipt) {
    if (receipt.digest !== digest) throw Error('Command identity reused with different data');
    return { ok: true };
  }
  if (c.revision !== (previous?.revision ?? 0)) throw Error('Universe binding changed; reload its current state');
  const returning = c.type === 'return' ? returnAccess(s) : null;
  const blocked = c.type !== 'return' ? entryBlock(s) : returning!.message;
  if (blocked) throw Error(blocked);
  const mapped = c.type === 'explore' || c.type === 'ascend' || c.type === 'enter' && previous?.state.settlementRevision === 1;
  const enteringState = mapped ? surfaceEntryState(s) : undefined;
  if (c.type === 'ascend') {
    const profile = flightAssessment(s);
    if (!profile.canHover) throw Error(profile.reasons[0] ?? 'This body cannot sustain magical lift.');
  }
  const w = s.world, p = s.person, b = s.body;
  s.stop();
  if (c.type !== 'return') {
    const id = previous?.id ?? w.nextId('universe'), spec = previous?.spec ?? universeSpec(w.seed);
    const state = enteringState ?? previous?.state ?? createTravelState(spec);
    if (!previous) {
      state.explorerId = p.id; state.vesselId = `${id}:vessel`;
      for (const discovery of state.discoveries) discovery.explorerId = p.id;
    }
    const event = w.emit('universe_entered', { actor: p.id, pos: { ...b.pos }, causes: previous?.returnedEventId ? [previous.returnedEventId] : [],
      data: { bindingId: id, bodyId: b.id, universeVersion: spec.version, seed: spec.seed, vesselId: state.vesselId, gateway: mapped ? 'continuous-surface' : 'veil-boarding' },
      significance: .4, summary: mapped ? `${p.name} continued from town into the whole world` : `${p.name} boarded the Veil vessel with the same body and belongings` });
    w.universeExpedition = {
      version: 1, authority: 'canonical', id, personId: p.id, bodyId: b.id, active: true,
      realm: realmAt(b.pos.x, b.pos.z)!, returnPos: { ...b.pos }, returnYaw: b.yaw, spec, state,
      revision: previous?.revision ?? 0, snapshotRevision: previous?.snapshotRevision ?? 0,
      enteredEventId: event.id, commands: previous?.commands ?? [],
      control: { input: neutralInput(), inputUntilTick: state.tick, substeps: 0 },
    };
    b.present = false; b.vel = { x: 0, y: 0, z: 0 }; b.path = null; b.pathGoal = null;
    if (c.type === 'ascend') {
      const result = applyCanonicalTravelCommand(s, { type: 'soar' });
      if (!result.ok) throw Error(result.error);
    }
  } else {
    const r = previous!;
    const mappedReturn = r.state.settlementRevision === 1 ? universePointToBody(s, r.state.position, r.state.systemIndex) : null;
    const direction = mappedReturn ? planetDirectionToSettlement(planetSpec(w.seed), mappedReturn.realm, r.state.position, r.state.forward) : null;
    stopCanonicalUniverse(s);
    b.pos = { ...returning!.arrival! }; b.yaw = direction ? Math.atan2(-direction.x, -direction.z) : r.returnYaw;
    b.vel = { x: 0, y: 0, z: 0 }; b.path = null; b.pathGoal = null;
    b.present = true; r.active = false;
    const event = w.emit('universe_returned', { actor: p.id, pos: { ...b.pos }, causes: [r.enteredEventId], significance: .4,
      data: { bindingId: r.id, bodyId: b.id, planetId: r.state.landedPlanetId, vesselId: r.state.vesselId,
        requestedAnchor: { ...(mappedReturn?.position ?? r.returnPos) }, entryAnchor: { ...r.returnPos }, arrival: { ...b.pos } },
      summary: `${p.name} returned through the Veil with the same body and belongings` });
    r.returnedEventId = event.id;
  }
  const next = w.universeExpedition!;
  next.revision++; next.snapshotRevision++;
  next.commands.push({ id: c.id, digest, revision: next.revision });
  if (next.commands.length > 128) next.commands.shift();
  w.rebuildLivingIndices();
  return { ok: true };
}

/** Record actual travel outcomes in the same causal history as realm actions. No
 * astronomical position is submitted to planar witnesses or collision queries. */
function retainTravelEvents(s: RealmSession, before: Set<TravelState['events'][number]>, flight?: PersonalFlight): void {
  const r = s.world.universeExpedition!;
  for (const event of r.state.events) if (!before.has(event)) {
    const assessment = event.type === 'soar' ? flightAssessment(s) : null;
    const recorded = s.world.emit('universe_travel', { actor: r.personId,
      causes: [r.enteredEventId, ...(assessment?.causes ?? []), ...(flight?.startedEventId ? [flight.startedEventId] : [])],
      significance: .2, visibility: 0, loudness: 0,
      data: { bindingId: r.id, bodyId: r.bodyId, vesselId: r.state.vesselId, ...event,
        ...(assessment ? { flightAssessment: assessment } : {}),
        ...(flight ? { locomotion: 'personal', manaSpent: flight.manaSpent, effortSpent: flight.effortSpent } : {}) },
      summary: `${s.person.name}: universe ${event.type}` });
    if (event.type === 'soar' && r.state.personalFlight) r.state.personalFlight.startedEventId = recorded.id;
  }
}
export function applyCanonicalTravelCommand(s: RealmSession, value: UniverseCommand): CommandResult {
  const r = s.world.universeExpedition;
  if (!r?.active) return { ok: false, error: 'Board the Veil vessel first.' };
  let command: UniverseCommand;
  try { command = parseUniverseCommand(value); } catch (e) { return { ok: false, error: String(e) }; }
  const before = new Set(r.state.events);
  const route = command.type === 'navigate' ? command.planetId : command.type === 'cruise' && command.enabled ? r.state.targetPlanetId ?? undefined : undefined;
  const result = command.type === 'soar' ? beginPersonalFlight(r.spec, r.state, s.body.id, flightAssessment(s))
    : r.state.personalFlight ? commandPersonalFlight(r.spec, r.state, command, flightAssessment(s, route))
    : applyTravelCommand(r.spec, r.state, command, canonicalTravelGeometry(s));
  if (result.ok) {
    if (command.type === 'input') { r.control.input = command.input; r.control.inputUntilTick = r.state.tick + 6; }
    else { r.control.input = neutralInput(); r.control.inputUntilTick = r.state.tick; }
    r.snapshotRevision++; retainTravelEvents(s, before);
  }
  return result;
}
/** Called once by the existing 60 Hz realm clock. Partial travel steps survive
 * checkpoints; there is no second wall clock and no idle-time catch-up teleport. */
export function stepCanonicalUniverse(s: RealmSession): void {
  const r = s.world.universeExpedition;
  if (!r?.active) return;
  r.control.substeps++;
  if (r.control.substeps < 3) return;
  r.control.substeps = 0;
  const before = new Set(r.state.events), flight = r.state.personalFlight, from = { ...r.state.position }, wasFlight = r.state.mode === 'flight';
  const input = r.state.tick < r.control.inputUntilTick ? r.control.input : neutralInput();
  const geometry = canonicalTravelGeometry(s);
  const result = flight ? stepPersonalFlight(r.spec, r.state, input, flightAssessment(s), geometry) : undefined;
  if (!flight) stepTravel(r.spec, r.state, input, geometry);
  const contact = constrainUniverseSettlementMovement(s, from, wasFlight, flight ?? false);
  if (contact.collision && (r.state.events.at(-1)?.type !== 'collision' || r.state.events.at(-1)?.tick !== r.state.tick))
    recordTravel(r.state, 'collision', generateSystem(r.spec, 0).planets[0].id);
  if (contact.landingCandidate) {
    const state = r.state, home = generateSystem(r.spec, 0).planets[0], up = normalize(sub(contact.landingCandidate.position, home.center));
    state.position = contact.landingCandidate.position; state.velocity = { x: 0, y: 0, z: 0 }; state.up = up;
    const tangent = sub(state.forward, scale(up, dot(state.forward, up)));
    state.forward = length(tangent) > .001 ? normalize(tangent) : tangentFrame(up).north;
    state.mode = 'surface'; state.landedPlanetId = home.id; state.landing = false; state.cruise = false;
    state.landedVesselPosition = flight ? state.parkedVessel?.planetId === home.id ? { ...state.parkedVessel.position } : null : { ...state.position };
    delete state.personalFlight;
    if (!state.discoveries.some(d => d.planetId === home.id))
      state.discoveries.push({ planetId: home.id, systemIndex: 0, tick: state.tick, explorerId: state.explorerId, method: 'landed' });
    recordTravel(state, 'land', home.id);
  }
  stepUniverseBody(s, result, flight);
  r.snapshotRevision++; retainTravelEvents(s, before, flight);
}
export function stopCanonicalUniverse(s: RealmSession): void {
  const r = s.world.universeExpedition;
  if (!r) return;
  r.control.input = neutralInput(); r.control.inputUntilTick = r.state.tick;
  r.state.cruise = false; r.state.landing = false;
  // Disconnect stops the clock, not gravity. Retain personal momentum for the
  // next committed tick so reconnecting cannot repeatedly cancel a fall.
  if (!r.state.personalFlight) r.state.velocity = { x: 0, y: 0, z: 0 };
  r.snapshotRevision++;
}
