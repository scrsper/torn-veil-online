import type { EntityId, EventId, Physiology, Tick, Vec3 } from '../core/types';
import type { CreatureSpeciesSpec } from '../core/creatureSpecies';

export type Habitat = 'grassland' | 'woodland' | 'bare' | 'water' | 'built';
export type Forage = 'grass' | 'browse' | 'mast';
/** The supported ecological biology components. This refines the general creature species
 * composition; it does not require all creatures to eat plants, gestate or use this cognition. */
export interface SpeciesSpec extends CreatureSpeciesSpec {
  role: 'small_herbivore' | 'large_herbivore' | 'omnivore';
  diet: Partial<Record<Forage, number>>; // assimilable kJ per kg of physical forage
  habitats: Partial<Record<Habitat, number>>;
  metabolism: {
  foodKgPerDay: number; energyReserveKJ: number;
  waterLitresPerDay: number; waterReserveLitres: number; sleepHoursPerDay: number;
  /** Current weather supports wetness/heat load, not a measured ambient Celsius field. */
  exposureTolerance: number;
  starvationHours: number; dehydrationHours: number;
  };
  lifecycle: { maturityDays: number; lifespanDays: number };
  reproduction: {
  mode: 'gestation'; gestationDays: number; weaningDays: number;
  litter: [number, number]; birthMassFraction: number; breedingIntervalDays: number;
  conceptionChancePerDay: number; minCondition: number;
  mateRadiusM: number;
  };
  spacing: { densityRadiusM: number; comfortableNeighbours: number };
}
export type AnimalActivity = 'seek_food' | 'eat' | 'seek_water' | 'drink' | 'sleep' | 'rest' | 'seek_habitat' | 'roam' | 'idle' | 'nurse' | 'dead';
export interface AnimalEmbodiment {
  physiology: Physiology;
  activity: AnimalActivity;
  target: { pos: Vec3; resourceId?: EntityId } | null;
  /** Bounded memory of physically failed approaches, not omniscient reachability knowledge. */
  blockedSources?: { id: EntityId; until: Tick }[];
  starvationHours: number; dehydrationHours: number;
  distanceM: number; foodKg: number; waterLitres: number;
  diedAt?: Tick; deathCause?: 'starvation' | 'dehydration' | 'old_age';
}
export interface AnimalState {
  bornAt: Tick; sex: 'female' | 'male'; parentIds: EntityId[];
  /** Drawn at birth; not a new random old-age roll on every render/simulation step. */
  senescenceAt: Tick;
  nextBreedAt: Tick;
  pregnancy: { bodyId: EntityId; mateId: EntityId; conceivedAt: Tick; dueAt: Tick; offspring: number; cause: EventId } | null;
  embodiments: Record<EntityId, AnimalEmbodiment>;
}
export interface EcologyState {
  version: 1;
  species: Record<string, SpeciesSpec>;
  rngState: number;
  processedAt: Tick; pendingWorldSeconds: number; pendingPhysicalSeconds: number;
  nextCensusAt: Tick;
  census: Record<string, { reference: number; lastEventAt: Tick }>;
}
