import type { Body, Creature, ResourceNode } from '../core/types';
import type { World } from '../core/world';
import { SECONDS_PER_DAY as DAY } from '../core/time';
import { ecologicalResourceAvailable, habitatAt } from '../world/ecologyResources';
import { ageDays, animalAlive, bodyScale, createAnimal, ecologyRng, isMature } from './animals';
import { localAnimals, visible, type EcologyQueries } from './sensing';
import type { AnimalEmbodiment, SpeciesSpec } from './types';

export function reproductiveEligibility(world: World, animal: Creature, body: Body, spec: SpeciesSpec, resources: ResourceNode[], queries: EcologyQueries, tick = world.now): boolean {
  const a = animal.wildlife!, e = a.embodiments[body.id], p = e.physiology;
  if (a.sex !== 'female' || !isMature(animal, spec, tick) || a.nextBreedAt > tick || body.dead || !body.present
    || p.energy < spec.reproduction.minCondition || p.hydration < spec.reproduction.minCondition || p.fatigue > 0.6 || p.sleepDebt > 6
    || (spec.habitats[habitatAt(world, body.pos)] ?? 0) < 0.5 || !resources.some(n => n.kind === 'surface_water')) return false;
  resources = localAvailableResources(world, body, spec, resources);
  if (!resources.some(n => n.kind === 'surface_water')) return false;
  const neighbours = localAnimals(world, queries, body, spec.spacing.densityRadiusM);
  const food = resources.reduce((sum, n) => sum + (n.forage ? n.remaining * (spec.diet[n.forage] ?? 0) : 0), 0);
  const bestFood = Math.max(...Object.values(spec.diet));
  // Resource availability is the gate. Density only bounds reproduction pressure; never health.
  return food >= spec.metabolism.foodKgPerDay * bestFood * (neighbours.length + 1 + spec.reproduction.litter[0]) * 3
    && neighbours.filter(b => world.get<Creature>(b.ownerId)?.species === animal.species).length < spec.spacing.comfortableNeighbours * 2;
}

export function nurse(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, tick: number): boolean {
  if (ageDays(animal, tick) >= spec.reproduction.weaningDays || state.physiology.energy >= 0.65) return false;
  const mother = world.get<Creature>(animal.wildlife!.parentIds[0]);
  if (!mother?.wildlife) return false;
  const maternalBody = mother.bodies.map(id => world.body(id)).find(b => b?.present && !b.dead && visible(world, body.pos, b.pos, 2));
  if (!maternalBody) return false;
  const source = mother.wildlife.embodiments[maternalBody.id]?.physiology; if (!source) return false;
  const childScale = bodyScale(spec, ageDays(animal, tick)), motherScale = bodyScale(spec, ageDays(mother, tick));
  const transferKJ = Math.min(0.15 * spec.metabolism.energyReserveKJ * childScale, Math.max(0, source.energy - 0.35) * spec.metabolism.energyReserveKJ * motherScale);
  const transferL = Math.min(0.15 * spec.metabolism.waterReserveLitres * childScale, Math.max(0, source.hydration - 0.35) * spec.metabolism.waterReserveLitres * motherScale);
  source.energy -= transferKJ / (spec.metabolism.energyReserveKJ * motherScale);
  source.hydration -= transferL / (spec.metabolism.waterReserveLitres * motherScale);
  state.physiology.energy = Math.min(1, state.physiology.energy + transferKJ * 0.8 / (spec.metabolism.energyReserveKJ * childScale));
  state.physiology.hydration = Math.min(1, state.physiology.hydration + transferL / (spec.metabolism.waterReserveLitres * childScale));
  return transferKJ > 0;
}

export function stepReproduction(world: World, animal: Creature, body: Body, state: AnimalEmbodiment, spec: SpeciesSpec, resources: ResourceNode[], queries: EcologyQueries, tick: number, seconds: number): void {
  const a = animal.wildlife!, p = state.physiology, gestation = a.pregnancy;
  if (gestation) {
    if (gestation.bodyId !== body.id) return;
    // Gestation is paid biological work in addition to the newborn's transferred reserves.
    p.energy = Math.max(0, p.energy - 0.06 * gestation.offspring * seconds / (spec.reproduction.gestationDays * DAY));
    if (body.dead || p.energy < 0.05 || p.hydration < 0.05) { losePregnancy(world, animal, body, tick, 'maternal_condition'); return; }
    if (tick < gestation.dueAt) return;
    resources = localAvailableResources(world, body, spec, resources);
    const scale = bodyScale(spec, ageDays(animal, tick));
    const birthEnergy = gestation.offspring * spec.reproduction.birthMassFraction * 0.5 / scale;
    const birthWater = gestation.offspring * spec.reproduction.birthMassFraction * 0.7 / scale;
    if (p.energy < birthEnergy + 0.15 || p.hydration < birthWater + 0.15 || !resources.some(n => n.forage && n.remaining > 0)) {
      losePregnancy(world, animal, body, tick, 'insufficient_birth_resources'); return;
    }
    p.energy -= birthEnergy; p.hydration -= birthWater;
    a.pregnancy = null;
    for (let i = 0; i < gestation.offspring; i++) {
      const child = createAnimal(world, animal.species, { ...body.pos }, { ageDays: 0, parentIds: [animal.id, gestation.mateId], tick, cause: gestation.cause });
      const childBody = world.body(child.bodies[0])!, childState = child.wildlife!.embodiments[childBody.id];
      childState.physiology.energy = 0.5; childState.physiology.hydration = 0.7;
      queries.bodies.point(childBody, childBody.pos);
    }
    return;
  }
  if (!reproductiveEligibility(world, animal, body, spec, resources, queries, tick)) return;
  const mates = localAnimals(world, queries, body, spec.reproduction.mateRadiusM).filter(b => {
    const mate = world.get<Creature>(b.ownerId), mp = mate?.wildlife?.embodiments[b.id]?.physiology;
    return mate?.species === animal.species && mate.wildlife?.sex === 'male' && isMature(mate, spec, tick)
      && mp && mp.energy >= spec.reproduction.minCondition && mp.hydration >= spec.reproduction.minCondition;
  });
  if (!mates.length) return;
  const count = localAnimals(world, queries, body, spec.spacing.densityRadiusM).length;
  const pressure = Math.min(1, spec.spacing.comfortableNeighbours / Math.max(1, count));
  const rng = ecologyRng(world), succeeds = rng.chance(1 - Math.exp(-spec.reproduction.conceptionChancePerDay * pressure * seconds / DAY));
  const mate = succeeds ? rng.pick(mates) : null, offspring = succeeds ? rng.int(...spec.reproduction.litter) : 0;
  world.ecology!.rngState = rng.state();
  if (!mate) return;
  const event = world.emit('animal_conceived', { actor: animal.id, target: mate.ownerId, tick, pos: { ...body.pos },
    category: 'world', significance: 0.02, visibility: 0, loudness: 0,
    data: { species: animal.species, bodyId: body.id, offspring }, summary: `A ${spec.name} conceived` });
  a.pregnancy = { bodyId: body.id, mateId: mate.ownerId, offspring, conceivedAt: tick, dueAt: tick + spec.reproduction.gestationDays * DAY, cause: event.id };
  a.nextBreedAt = tick + Math.max(spec.reproduction.breedingIntervalDays, spec.reproduction.gestationDays + spec.reproduction.weaningDays) * DAY;
  p.energy = Math.max(0, p.energy - 0.03);
}

/** Intake/movement earlier in this quantum can invalidate the initial sensory snapshot. */
function localAvailableResources(world: World, body: Body, spec: SpeciesSpec, resources: ResourceNode[]): ResourceNode[] {
  return resources.filter(n => ecologicalResourceAvailable(world, n) && visible(world, body.pos, n.pos, spec.senses.localRadiusM));
}

function losePregnancy(world: World, animal: Creature, body: Body, tick: number, reason: string): void {
  const pregnancy = animal.wildlife!.pregnancy; if (!pregnancy) return;
  animal.wildlife!.pregnancy = null;
  world.emit('animal_pregnancy_lost', { actor: animal.id, tick, pos: { ...body.pos }, category: 'world', significance: 0.03,
    visibility: 0, loudness: 0, causes: [pregnancy.cause], data: { species: animal.species, reason }, summary: `A ${animal.name} pregnancy ended: ${reason}` });
}

/** Observational census over tracked individuals, not a carrying-capacity controller. */
export function censusEcology(world: World, tick: number): void {
  const ecology = world.ecology!;
  if (tick < ecology.nextCensusAt) return;
  ecology.nextCensusAt = tick + DAY;
  const counts: Record<string, number> = {};
  for (const c of world.creatures()) if (animalAlive(world, c)) counts[c.species] = (counts[c.species] ?? 0) + 1;
  for (const [species, previous] of Object.entries(ecology.census)) {
    const count = counts[species] ?? 0, reference = previous.reference;
    const kind = count === 0 && reference >= 4 ? 'extinction' : reference >= 12 && count <= reference / 2 ? 'collapse'
      : count >= Math.max(12, reference * 2) ? 'boom' : null;
    if (!kind) continue;
    // These are actual emitted lifecycle events, never manufactured links from a UI reader.
    const causes = world.events.filter(e => e.tick > previous.lastEventAt && e.tick <= tick && e.data.species === species
      && (e.type === 'animal_born' || e.type === 'animal_died')).slice(-64).map(e => e.id);
    world.emit('ecology_changed', { tick, category: 'history', significance: kind === 'extinction' ? 0.7 : 0.6, visibility: 0, loudness: 0,
      causes, data: { species, kind, previous: reference, population: count, scope: 'tracked_world_population' },
      summary: `${ecology.species[species].name} ${kind}: tracked population ${reference} → ${count}` });
    previous.reference = count; previous.lastEventAt = tick;
  }
}
