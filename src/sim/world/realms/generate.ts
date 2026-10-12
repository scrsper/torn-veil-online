import type { World } from '../../core/world';
import { makeBody, makeItem, makePerson, makePlace } from '../factory';
import { setExternalControl } from '../../runtime/controllers';
import { RealmGrid } from './grid';
import { REALMS, CENTER, spawnPoint, type RealmSpec } from './layout';

/** Additive world kind. Ordinary Persons, Bodies, Items, Places, doors and persistence;
 * no parallel player sheet or inventory is introduced by realm generation. */
export function generateRealms(world: World, spec: RealmSpec = { version: 1, seed: world.seed }) {
  if (spec.version !== 1 || spec.seed !== world.seed || !Number.isInteger(spec.seed)) throw new Error('Unsupported realm generator');
  world.realmSpec = { ...spec };
  world.grid = new RealmGrid(spec); world.initNav(); world.clock.timeScale = 1;
  const places: ReturnType<typeof import('../village').generateVillage>['places'] = {};
  const people: ReturnType<typeof import('../village').generateVillage>['people'] = {};
  for (const realm of Object.values(REALMS)) {
    const grid=world.grid as RealmGrid,c=grid.chunk(realm.id,32,32),focused=realm.id==='brass'?grid.focusedTown?.tower:null;
    const b=c.buildings[0]??{...focused!,name:'Tower of Chrysanthus',door:focused!.entry};
    places[realm.id] = makePlace(world, 'square', `${realm.name} — Threshold Square`, { x0: c.x + 10, z0: c.z + 10, x1: c.x + 87, z1: c.z + 47, y0: 1, y1: 5 }, { inside: spawnPoint(realm.id), indoor: false });
    places[`${realm.id}:tower`] = makePlace(world, 'chapel', b.name, { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d, y0: 1, y1: 12 }, { inside: { x: b.door.x + .5, y: 1, z: b.z + 10 }, indoor: true });
    for (let i = 0; i < 2; i++) {
      const p = makePerson(world, { name: realm.id === 'aether' ? ['Iria Vale', 'Sen Oris'][i] : ['Mara Wren', 'Tomas Ash'][i], gender: i ? 'm' : 'f', age: 28 + i * 12, occupation: i ? 'smith' : 'traveler', traits: { aggression: 0 }, appearance: {}, bio: `A resident of ${realm.name}.`, home: places[realm.id].id });
      p.bodies.push(makeBody(world, p.id, { x: realm.offset + CENTER + 68 + i * 5, y: 1, z: CENTER + 26 }).id);
      people[`${realm.id}:${i}`] = p;
    }
  }
  const traveler = makePerson(world, { name: 'Veil traveler', gender: 'f', age: 25, occupation: 'traveler', traits: {}, appearance: {}, bio: 'A traveler between the connected realms.', home: places.aether.id });
  traveler.bodies.push(makeBody(world, traveler.id, spawnPoint('aether')).id);
  setExternalControl(traveler, true); world.playerId = traveler.id; people.traveler = traveler;
  makeItem(world, 'book', 'Threshold atlas', { owner: traveler.id, holder: traveler.id });
  makeItem(world, 'bread', 'Travel provisions', { owner: traveler.id, holder: traveler.id, quantity: 3 });
  world.grid.recording = true;
  return { places, people };
}
