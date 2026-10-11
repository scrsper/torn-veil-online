import { World } from '../core/world';
import { Simulation } from '../mind/agent';
import { B } from '../physical/blocks';
import { makeBody, makeCatalogItem, makeCatalogArmor, makeItem, makePerson, makePlace } from './factory';
import { makeContainer } from '../core/container';
import { setExternalControl } from '../runtime/controllers';
import { introduce } from '../mind/people';

/** Initial fixtures only. Published worlds use the ordinary simulation and bridge. */
export function createCombatGym(seed = 918271) {
  const world = new World(seed);
  world.clock.timeScale = 1;
  world.initPhysical(64, 8, 64);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) {
    world.grid.set(x, 0, z, B.Stone);
    if (x === 0 || z === 0 || x === 63 || z === 63) for (let y = 1; y < 3; y++) world.grid.set(x, y, z, B.Plaster);
  }
  const place = makePlace(world, 'square', 'Combat Gym', { x0: 1, z0: 1, x1: 62, z1: 62, y0: 1, y1: 4 }, { inside: { x: 32, y: 1, z: 32 }, indoor: false });
  const fixtures = [
    ['Gym traveler', 29, 32], ['Practice dummy', 30.1, 32],
    ['Single partner', 20, 23], ['Group partner A', 40, 23], ['Group partner B', 42, 23],
    ['Friendly guide', 22, 40],
  ] as const;
  for (const [i, [name, x, z]] of fixtures.entries()) {
    const p = makePerson(world, { name, gender: i % 2 ? 'm' : 'f', age: 25, occupation: 'traveler', traits: { aggression: 0, sociability: .8 }, appearance: { shirt: i === 0 ? 0x345477 : i === 5 ? 0x557969 : 0x9c6354 }, bio: 'Disposable Combat Gym fixture. Ordinary canonical actions apply.', home: place.id });
    world.attachBody(p, makeBody(world, p.id, { x, y: 1, z }));
    setExternalControl(p, true);
    world.primaryBody(p.id)!.yaw = i === 0 ? -Math.PI / 2 : Math.PI / 2;
    if (i === 0) world.playerId = p.id;
  }
  introduce(world, world.person(world.playerId!)!, world.persons()[5]);
  for (const [x, z, block] of [[31, 39, B.Table], [32, 39, B.Table], [31, 38, B.Chair], [32, 40, B.Chair], [16, 34, B.Crate], [17, 34, B.Barrel], [16, 35, B.Crate]] as const) world.grid.set(x, 1, z, block);
  const traveler=world.person(world.playerId!)!;
  for(const id of ['TV-010','TV-021'])makeCatalogItem(world,id,{owner:traveler.id,holder:traveler.id});
  for(const id of ['TV-081','TV-091','TV-101','TV-111','TV-121','TV-131'])makeCatalogArmor(world,id,{owner:traveler.id,holder:traveler.id});
  makeContainer(world, { name: 'Interaction chest', pos: { x: 26, y: 1, z: 39 }, open: false });
  makeItem(world, 'bread', 'Test bread', { pos: { x: 26, y: 1, z: 37 }, quantity: 2 });
  makeItem(world, 'stick', 'Test stick', { pos: { x: 27, y: 1, z: 37 } });
  world.grid.initCaches(); world.initNav(); world.grid.recording = true;
  return { world, sim: new Simulation(world), scenario: { id: 'combat-gym', title: 'Combat Gym', description: 'Disposable canonical test fixtures', invariants: [] as string[] }, initialEvents: [] as string[] };
}

