import type { RealmSession } from '../sim/world/realms/session';
import { realmAt } from '../sim/world/realms/layout';
import { createTravelState, type TravelState } from '../sim/world/universe/travel';
import { generateSystem, universeSpec } from '../sim/world/universe/generation';
import { bodyPointToUniverse } from './universeSettlements';
import { settlementDirectionToPlanet, settlementAt, settlementPatches, settlementSaveValidator } from '../sim/world/universe/settlements';
import { normalize, planetSpec } from '../sim/world/planet/planet';

/** A reversible domain entry from actual canonical feet. This read-only builder
 * also supplies the preview, so accepting entry cannot change the camera point. */
export function surfaceEntryState(s: RealmSession): TravelState {
  const previous = s.world.universeExpedition;
  if (previous && previous.state.settlementRevision !== 1)
    throw Error('This expedition retains its original gateway geography.');
  const realm = realmAt(s.body.pos.x, s.body.pos.z);
  if (!realm) throw Error('Explore from a mapped settlement.');
  const spec = universeSpec(s.world.seed), planet = generateSystem(spec, 0).planets[0], sphere = planetSpec(s.world.seed);
  const position = bodyPointToUniverse(s, realm, s.body.pos);
  if (!settlementAt(sphere, position, settlementPatches(s.grid))) throw Error('Walk into the mapped town district before exploring the whole world.');
  const validate = settlementSaveValidator(sphere, s.grid);
  if (validate('body', position, 0, 'surface') !== true) throw Error('Current ground does not support a clear spherical entry.');
  const state = previous ? structuredClone(previous.state) : createTravelState(spec);
  state.explorerId = s.person.id; state.settlementRevision = 1;
  state.systemIndex = 0; state.mode = 'surface'; state.position = position; state.up = normalize(position);
  state.forward = settlementDirectionToPlanet(sphere, realm, s.body.pos, { x: -Math.sin(s.body.yaw), y: 0, z: -Math.cos(s.body.yaw) });
  // The differential basis has tiny curvature error; preserve a strict orthogonal frame.
  const projection = state.forward.x * state.up.x + state.forward.y * state.up.y + state.forward.z * state.up.z;
  state.forward = normalize({ x: state.forward.x - state.up.x * projection, y: state.forward.y - state.up.y * projection, z: state.forward.z - state.up.z * projection });
  state.velocity = { x: 0, y: 0, z: 0 }; state.landedPlanetId = planet.id;
  state.targetPlanetId = planet.id; state.cruise = false; state.landing = false;
  if (!previous) {
    // The existing traversal vessel is a fixture, not an inventory reward. Place
    // its hull on verified nearby ground once; later entries preserve its location.
    let vessel: typeof position | null = null;
    // Leave room for the full skiff wingspan and the standing traveler. A zero
    // radius berth put its hull directly over the body's head on first entry.
    for (const radius of [8, 16, 24, 40, 56]) {
      for (let i = 0; i < 16; i++) {
        const x = s.body.pos.x + Math.cos(i * Math.PI / 8) * radius, z = s.body.pos.z + Math.sin(i * Math.PI / 8) * radius;
        const geometry = s.grid.movementGeometryAt(x, z);
        const y = geometry ? geometry.supportAt(x, z, s.body.pos.y, .55) : 1;
        if (y === null) continue;
        const candidate = bodyPointToUniverse(s, realm, { x, y, z });
        if (validate('vessel', candidate, 0, 'surface') === true) { vessel = candidate; break; }
      }
      if (vessel) break;
    }
    if (!vessel) throw Error('No clear vessel berth within the town approach. Walk to open ground.');
    state.landedVesselPosition = vessel;
    for (const discovery of state.discoveries) discovery.explorerId = s.person.id;
  }
  return state;
}
