/** Versioned residency in the universe domain. The retained Body's planar position
 * is an arrival anchor, not a second live manifestation or an astronomical position. */
import type { World } from '../../core/world';
import type { RealmId, Point } from '../realms/layout';
import { realmAt } from '../realms/layout';
import { validateUniversePayload } from './persistence';
import { parseUniverseCommand, TRAVEL_LIMITS, type TravelInput, type TravelState } from './travel';
import { generateSystem, type UniverseSpec } from './generation';
import { length, sub, planetSpec } from '../planet/planet';
import { settlementSaveValidator, settlementAt, settlementPatches, type SettlementGrid } from './settlements';

export interface CanonicalUniverseBinding {
  version: 1;
  authority: 'canonical';
  id: string;
  personId: string;
  bodyId: string;
  active: boolean;
  realm: RealmId;
  returnPos: Point;
  returnYaw: number;
  spec: UniverseSpec;
  state: TravelState;
  /** Transition revision is independent of the continuously increasing projection revision. */
  revision: number;
  snapshotRevision: number;
  enteredEventId: string;
  returnedEventId?: string;
  commands: { id: string; digest: string; revision: number }[];
  control: { input: TravelInput; inputUntilTick: number; substeps: number };
}
const natural = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const identity = (v: unknown): v is string => typeof v === 'string' && /^[\w:-]{1,128}$/.test(v);

/** Only this validated binding permits a saved canonical player to have no planar
 * primary body. An absent body by itself is never sufficient. */
export function validCanonicalUniverse(w: World, value: unknown, saveVersion: number): value is CanonicalUniverseBinding | undefined {
  if (value === undefined) return true;
  try {
    const r = value as CanonicalUniverseBinding;
    if (saveVersion < 32 || !r || r.version !== 1 || r.authority !== 'canonical'
      || !identity(r.id) || typeof r.active !== 'boolean' || !w.realmSpec
      || r.personId !== w.playerId || !identity(r.bodyId)
      || !['aether', 'brass'].includes(r.realm)
      || ![r.returnPos?.x, r.returnPos?.y, r.returnPos?.z, r.returnYaw].every(Number.isFinite)
      || realmAt(r.returnPos.x, r.returnPos.z) !== r.realm
      || !natural(r.revision) || r.revision < 1 || !natural(r.snapshotRevision) || r.snapshotRevision < r.revision
      || !Array.isArray(r.commands) || !r.commands.length || r.commands.length > 128
      || !r.control || !natural(r.control.inputUntilTick) || ![0, 1, 2].includes(r.control.substeps)) return false;
    const p = w.person(r.personId), b = w.body(r.bodyId);
    if (!p || !b || b.ownerId !== p.id || !p.bodies.includes(b.id)
      || r.active && (!p.alive || b.dead || b.health <= 0 || b.present || w.primaryBody(p.id)
        || b.pos.x !== r.returnPos.x || b.pos.y !== r.returnPos.y || b.pos.z !== r.returnPos.z || b.yaw !== r.returnYaw)
      || !r.active && w.primaryBody(p.id)?.id !== b.id
      || r.active && (w.realmExpedition?.active || w.canonicalTower?.active)) return false;
    // returnPos records entry history. Current occupancy is checked against the
    // actual active travel pose; arrival is checked again when returning.
    const payload = validateUniversePayload({ spec: r.spec, state: r.state, revision: r.snapshotRevision }, {
      allowPersonal: true, allowSettlements: true,
      settlementValidation: settlementSaveValidator(planetSpec(w.seed), w.grid, { historicalBody: !r.active }),
    });
    if (payload.spec.seed !== (w.seed >>> 0) || r.state.explorerId !== p.id
      || r.state.vesselId !== `${r.id}:vessel` || r.control.inputUntilTick > r.state.tick + 6) return false;
    if (r.state.personalFlight) {
      const flight = r.state.personalFlight, event = flight.startedEventId && w.event(flight.startedEventId);
      if (!r.active || flight.bodyId !== b.id || !event || event.type !== 'universe_travel'
        || event.actor !== p.id || event.data.type !== 'soar' || event.data.bodyId !== b.id || event.data.bindingId !== r.id) return false;
      const initialMana = (event.data.flightAssessment as { manaAvailable?: number } | undefined)?.manaAvailable;
      if (typeof initialMana !== 'number' || !Number.isFinite(initialMana) || flight.manaSpent > initialMana + 1e-6
        || !b.arcana || Math.abs(initialMana - flight.manaSpent - b.arcana.mana) > 1e-6) return false;
    }
    if (!r.active && (r.state.mode !== 'surface' || r.state.systemIndex !== 0
      || r.state.landedPlanetId !== generateSystem(r.spec, 0).planets[0].id
      || (r.state.settlementRevision === 1
        ? !settlementAt(planetSpec(w.seed), r.state.position, settlementPatches(w.grid as SettlementGrid))
        : !r.state.landedVesselPosition || length(sub(r.state.position, r.state.landedVesselPosition)) > TRAVEL_LIMITS.launchDistance))) return false;
    const input = parseUniverseCommand({ type: 'input', input: r.control.input });
    if (input.type !== 'input' || JSON.stringify(input.input) !== JSON.stringify(r.control.input)) return false;
    const enter = w.event(r.enteredEventId), returned = r.returnedEventId ? w.event(r.returnedEventId) : undefined;
    if (enter?.type !== 'universe_entered' || enter.actor !== p.id || enter.data.bodyId !== b.id || enter.data.bindingId !== r.id
      || enter.pos?.x !== r.returnPos.x || enter.pos?.y !== r.returnPos.y || enter.pos?.z !== r.returnPos.z
      || r.active && r.returnedEventId !== undefined
      || !r.active && (returned?.type !== 'universe_returned' || returned.actor !== p.id || returned.data.bindingId !== r.id
        || !returned.causes.includes(enter.id))) return false;
    const seen = new Set<string>();
    for (const [i, c] of r.commands.entries()) {
      if (!c || typeof c.id !== 'string' || !/^[\w:-]{8,100}$/.test(c.id) || typeof c.digest !== 'string' || !/^[a-f0-9]{64}$/.test(c.digest)
        || !natural(c.revision) || c.revision < 1 || c.revision > r.revision || seen.has(c.id)
        || i > 0 && c.revision !== r.commands[i - 1].revision + 1) return false;
      seen.add(c.id);
    }
    return r.commands.at(-1)!.revision === r.revision;
  } catch { return false; }
}

/** Reference resolution for retained inactive Tower/legacy records only. Simulation
 * targeting continues to use primaryBody and therefore cannot target the traveller. */
export function canonicalPlayerBodyId(w: World, personId: string): string | undefined {
  return w.primaryBody(personId)?.id
    ?? (w.universeExpedition?.active && w.universeExpedition.personId === personId ? w.universeExpedition.bodyId : undefined);
}
