import type { TravelState } from '../../sim/world/universe/travel';

/** Read-only visibility location. A flying body never relocates its vessel. */
export function vesselLocation(state: TravelState) {
  if (state.mode === 'flight' && !state.personalFlight)
    return { position: state.position, planetId: null, piloting: true };
  if (state.parkedVessel?.systemIndex === state.systemIndex)
    return { position: state.parkedVessel.position, planetId: state.parkedVessel.planetId, piloting: false };
  if (state.mode === 'surface' && state.landedVesselPosition && state.landedPlanetId)
    return { position: state.landedVesselPosition, planetId: state.landedPlanetId, piloting: false };
  return null;
}
