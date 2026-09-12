import type { Body, Creature, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { RNG } from '../core/rng';
import { SECONDS_PER_DAY as DAY } from '../core/time';
import { defaultPhysiology } from '../core/physiology';
import { makeBody } from '../world/factory';
import { WILDLIFE_SPECIES } from './species';
import type { AnimalEmbodiment, SpeciesSpec } from './types';

export function enableEcology(world: World, species = WILDLIFE_SPECIES): void {
  if (world.ecology) return;
  for (const spec of Object.values(species)) validateWildlifeSpec(spec);
  world.ecology = { version: 1, species: structuredClone(species), rngState: new RNG(world.seed).fork(431).state(),
    processedAt: world.now, pendingWorldSeconds: 0, pendingPhysicalSeconds: 0, nextCensusAt: world.now + DAY, census: {} };
}

export function validateWildlifeSpec(s: SpeciesSpec): void {
  if (s.cognition.controller !== 'reactive_wildlife' || !s.locomotion.walk || s.reproduction.mode !== 'gestation') {
    throw new Error(`Unsupported wildlife components for ${s.id}; select/implement the appropriate canonical controller`);
  }
  const positives = [s.bodyPlan.massKg, s.bodyPlan.heightM, s.bodyPlan.radiusM, s.locomotion.walk.speedMps, s.senses.localRadiusM,
    s.metabolism.energyReserveKJ, s.metabolism.waterReserveLitres, s.metabolism.foodKgPerDay, s.metabolism.waterLitresPerDay,
    s.metabolism.starvationHours, s.metabolism.dehydrationHours, s.lifecycle.maturityDays, s.lifecycle.lifespanDays,
    s.reproduction.gestationDays, s.reproduction.weaningDays, s.reproduction.breedingIntervalDays, s.spacing.densityRadiusM];
  if (positives.some(n => !Number.isFinite(n) || n <= 0) || !Object.values(s.diet).some(n => n > 0)
    || s.metabolism.sleepHoursPerDay <= 0 || s.metabolism.sleepHoursPerDay >= 24
    || s.reproduction.birthMassFraction <= 0 || s.reproduction.birthMassFraction > 1
    || !Number.isInteger(s.reproduction.litter[0]) || !Number.isInteger(s.reproduction.litter[1])
    || s.reproduction.litter[0] < 1 || s.reproduction.litter[1] < s.reproduction.litter[0]) throw new Error(`Invalid wildlife biology: ${s.id}`);
}

/** The RNG is an ordinary persisted Torn Veil stream, separate from combat/human cognition. */
export function ecologyRng(world: World): RNG {
  const rng = new RNG(0); rng.setState(world.ecology!.rngState); return rng;
}
export function ageDays(animal: Creature, tick: number): number { return Math.max(0, (tick - animal.wildlife!.bornAt) / DAY); }
export function bodyScale(spec: SpeciesSpec, age: number): number {
  return spec.reproduction.birthMassFraction + (1 - spec.reproduction.birthMassFraction) * Math.min(1, age / spec.lifecycle.maturityDays);
}
export function animalAlive(world: World, animal: Creature): boolean {
  return !!animal.wildlife && animal.bodies.some(id => { const b = world.body(id); return !!b && !b.dead && b.health > 0; });
}
export function isMature(animal: Creature, spec: SpeciesSpec, tick: number): boolean { return ageDays(animal, tick) >= spec.lifecycle.maturityDays; }

export function attachAnimalBody(world: World, animal: Creature, body: Body, tick = world.now): AnimalEmbodiment {
  if (!animal.wildlife || body.ownerId !== animal.id) throw new Error('Animal body owner mismatch');
  if (!animal.bodies.includes(body.id)) animal.bodies.push(body.id);
  return animal.wildlife.embodiments[body.id] ??= {
    physiology: defaultPhysiology(tick), activity: 'idle', target: null, starvationHours: 0, dehydrationHours: 0,
    distanceM: 0, foodKg: 0, waterLitres: 0,
  };
}

/** Creation is an explicit founder endowment or a paid birth, never a population repair. */
export function createAnimal(world: World, speciesId: string, pos: Vec3, options: {
  ageDays?: number; sex?: 'male' | 'female'; parentIds?: string[]; tick?: number; cause?: string;
} = {}): Creature {
  enableEcology(world);
  const spec = world.ecology!.species[speciesId]; if (!spec) throw new Error(`Unknown species ${speciesId}`);
  validateWildlifeSpec(spec);
  if (!world.nav.canStepTo(pos, pos.x, pos.z) || world.nav.walkCost(Math.floor(pos.x), Math.floor(pos.z)) >= 3) throw new Error('Animal requires physically walkable starting ground');
  const tick = options.tick ?? world.now, age = options.ageDays ?? spec.lifecycle.maturityDays;
  if (!Number.isFinite(age) || age < 0) throw new Error('Invalid animal age');
  const rng = ecologyRng(world), bornAt = tick - age * DAY;
  const animal: Creature = {
    id: world.nextId('wild'), kind: 'creature', name: spec.name, createdAt: tick, tags: ['wildlife'], species: speciesId,
    bodies: [], homeId: null, ownerId: null, wanderTimer: 0,
    wildlife: { bornAt, sex: options.sex ?? (rng.chance(0.5) ? 'female' : 'male'), parentIds: options.parentIds ?? [],
      senescenceAt: bornAt + spec.lifecycle.lifespanDays * rng.range(0.85, 1.15) * DAY,
      nextBreedAt: tick, pregnancy: null, embodiments: {} },
  };
  world.ecology!.rngState = rng.state();
  world.add(animal);
  const body = makeBody(world, animal.id, pos, spec.bodyPlan.shape, 100);
  body.createdAt = tick; body.speed = spec.locomotion.walk.speedMps;
  attachAnimalBody(world, animal, body, tick);
  if (options.parentIds?.length) {
    world.emit('animal_born', { actor: options.parentIds[0], target: animal.id, tick, pos: { ...pos },
      category: 'world', significance: 0.08, visibility: 0.25, loudness: 0.1,
      causes: options.cause ? [options.cause] : [], data: { species: speciesId, parents: options.parentIds }, summary: `A ${spec.name} was born` });
  } else {
    const census = world.ecology!.census[speciesId] ??= { reference: 0, lastEventAt: tick };
    census.reference++;
  }
  return animal;
}

/** Small mortality adapter: World.markDead is Person-specific (estates and living-person
 * indexes). Keep Body health/dead authoritative without calling combat or inventing animal HP. */
export function naturalDeath(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, cause: NonNullable<AnimalEmbodiment['deathCause']>, tick: number): void {
  if (body.dead) return;
  body.health = 0; body.dead = true; body.pose = 'dead'; body.path = null; body.pathGoal = null; body.vel = { x: 0, y: 0, z: 0 };
  state.activity = 'dead'; state.target = null; state.diedAt = tick; state.deathCause = cause;
  world.emit('animal_died', { actor: animal.id, tick, pos: { ...body.pos }, category: 'world', significance: 0.1,
    visibility: 0.3, loudness: 0, data: { species: animal.species, bodyId: body.id, cause,
      energy: state.physiology.energy, hydration: state.physiology.hydration, starvationHours: state.starvationHours, dehydrationHours: state.dehydrationHours },
    summary: `A ${animal.name} died of ${cause.replaceAll('_', ' ')}` });
}
