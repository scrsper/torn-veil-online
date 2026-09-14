import { World } from '../../sim/core/world';
import { WorldClock, SECONDS_PER_DAY as DAY } from '../../sim/core/time';
import { B } from '../../sim/physical/blocks';
import { registerEcologyResources } from '../../sim/world/ecologyResources';
import { animalAlive, createAnimal, enableEcology } from '../../sim/ecology/animals';
import { stepWildlife, ECOLOGY_QUANTUM_SECONDS } from '../../sim/ecology/simulation';

/** Controlled headless habitats use ordinary metres, days and resource regeneration.
 * World-generation endowment is disclosed; no lifecycle/resource rates are accelerated. */
export function ecologyScenario(seed = 701, population = 8, options: { water?: boolean; size?: number; foodKg?: number; species?: string } = {}): World {
  const size = options.size ?? 48;
  const world = new World(seed, new WorldClock({ worldSeconds: 0, timeScale: 6 }));
  world.initPhysical(size, 12, size);
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
    world.grid.set(x, 0, z, B.Grass);
    if (options.water !== false && x === Math.floor(size / 2)) world.grid.set(x, 1, z, B.Water);
  }
  world.grid.initCaches(); world.initNav();
  registerEcologyResources(world, { x0: 1, z0: 1, x1: size - 2, z1: size - 2 });
  const forage = world.resourceNodes.filter(n => n.kind === 'forage');
  if (options.foodKg !== undefined) for (const n of forage) n.remaining = n.capacity = options.foodKg / forage.length;
  enableEcology(world);
  for (let i = 0; i < population; i++) {
    createAnimal(world, options.species ?? 'field_hare', { x: size / 2 - 5.5 - (i % 3), y: 1, z: size / 2 - 3.5 + (i % 7) }, { sex: i % 2 ? 'male' : 'female' });
  }
  return world;
}

export function advanceEcology(world: World, days: number): void {
  let remaining = days * DAY;
  while (remaining > 1e-8) {
    const seconds = Math.min(remaining, ECOLOGY_QUANTUM_SECONDS), physical = seconds / world.clock.timeScale;
    world.clock.advance(physical); world.physicalTime += physical;
    stepWildlife(world, physical, seconds); remaining -= seconds;
  }
}

export function ecologySnapshot(world: World) {
  const animals = world.creatures().filter(c => c.wildlife), living = animals.filter(c => animalAlive(world, c));
  const embodiments = living.flatMap(c => Object.entries(c.wildlife!.embodiments).filter(([id]) => !world.body(id)?.dead).map(([, e]) => e));
  const deaths: Record<string, number> = {};
  for (const animal of animals) for (const e of Object.values(animal.wildlife!.embodiments)) if (e.deathCause) deaths[e.deathCause] = (deaths[e.deathCause] ?? 0) + 1;
  return {
    day: world.now / DAY, alive: living.length, born: animals.filter(c => c.wildlife!.parentIds.length > 0).length,
    pregnant: living.filter(c => c.wildlife!.pregnancy).length,
    forageKg: +world.resourceNodes.filter(n => n.kind === 'forage').reduce((s, n) => s + n.remaining, 0).toFixed(3),
    meanEnergy: +(embodiments.reduce((s, e) => s + e.physiology.energy, 0) / Math.max(1, embodiments.length)).toFixed(3),
    meanHydration: +(embodiments.reduce((s, e) => s + e.physiology.hydration, 0) / Math.max(1, embodiments.length)).toFixed(3),
    travelledM: +animals.flatMap(c => Object.values(c.wildlife!.embodiments)).reduce((s, e) => s + e.distanceM, 0).toFixed(2), deaths,
  };
}
