import type { Occupation, Person, Traits, Vec3 } from '../../src/sim/core/types';
import { World } from '../../src/sim/core/world';
import { B } from '../../src/sim/physical/blocks';
import { Simulation } from '../../src/sim/mind/agent';
import { makeBody, makePerson, makePlace } from '../../src/sim/world/factory';

export interface TestWorld {
  world: World;
  sim: Simulation;
  places: { square: string; tavern: string; chapel: string; guardhouse: string };
}

export function createTestWorld(seed = 123, size = 40): TestWorld {
  const world = new World(seed);
  world.initPhysical(size, 8, size);
  world.grid.initCaches();
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) world.grid.set(x, 0, z, B.Stone);

  const square = makePlace(world, 'square', 'test square', { x0: 0, z0: 0, x1: size - 1, z1: size - 1, y0: 1, y1: 4 }, { inside: v(size / 2, 1, size / 2), indoor: false });
  const tavern = makePlace(world, 'tavern', 'test tavern', { x0: size - 6, z0: 1, x1: size - 2, z1: 5, y0: 1, y1: 4 }, { inside: v(size - 4, 1, 3) });
  const chapel = makePlace(world, 'chapel', 'test chapel', { x0: 1, z0: size - 6, x1: 5, z1: size - 2, y0: 1, y1: 4 }, { inside: v(3, 1, size - 4) });
  const guardhouse = makePlace(world, 'guardhouse', 'test guardhouse', { x0: size - 6, z0: size - 6, x1: size - 2, z1: size - 2, y0: 1, y1: 4 }, { inside: v(size - 4, 1, size - 4) });
  world.initNav();
  world.grid.dirtyChunks.clear();
  return { world, sim: new Simulation(world), places: { square: square.id, tavern: tavern.id, chapel: chapel.id, guardhouse: guardhouse.id } };
}

export function addPerson(
  tw: TestWorld,
  name: string,
  occupation: Occupation,
  pos: Vec3,
  options: { controlled?: boolean; traits?: Partial<Traits>; workId?: string; homeId?: string } = {},
): Person {
  const p = makePerson(tw.world, {
    name,
    gender: 'f',
    age: 30,
    occupation,
    home: options.homeId ?? tw.places.tavern,
    work: options.workId ?? null,
    traits: { honesty: 0.9, courage: 0.5, sociability: 0.7, ...options.traits },
    appearance: {},
    bio: `${name} exists for a deterministic simulation test.`,
  });
  p.controlled = options.controlled ?? false;
  p.mind.thinkInterval = options.controlled ? Number.POSITIVE_INFINITY : 0.25;
  const body = makeBody(tw.world, p.id, pos);
  body.yaw = 0;
  p.bodies.push(body.id);
  if (p.controlled) tw.world.playerId = p.id;
  return p;
}

export function step(tw: TestWorld, seconds: number, substep = 0.05): void {
  let elapsed = 0;
  while (elapsed < seconds - 1e-8) {
    const dt = Math.min(substep, seconds - elapsed);
    const worldDt = tw.world.clock.advance(dt);
    tw.world.physicalTime += dt;
    tw.sim.step(dt, worldDt);
    tw.sim.flushSpeech();
    elapsed += dt;
  }
}

export function face(person: Person, tw: TestWorld, target: Vec3): void {
  const body = tw.world.primaryBody(person.id)!;
  body.yaw = Math.atan2(-(target.x - body.pos.x), -(target.z - body.pos.z));
}

export function wall(tw: TestWorld, x: number, z0: number, z1: number): void {
  for (let z = z0; z <= z1; z++) for (let y = 1; y <= 3; y++) tw.world.grid.set(x, y, z, B.Stone);
  tw.world.nav.rebuildArea(x - 1, z0 - 1, x + 1, z1 + 1);
}

export function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
