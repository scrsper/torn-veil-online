import type { Vec3 } from '../../core/types';
import type { World } from '../../core/world';
import { createAnimal, enableEcology } from '../../ecology/animals';
import { changeEquipment } from '../../physical/equipment';
import { makeBody, makeItem, makePerson, makePlace } from '../factory';
import type { RealmGrid } from './grid';
import { FOCUSED_CATALOG } from '../assets/focusedRuntime';
import { placedPoint } from '../assets/focused';

/**
 * One explicit founder endowment for the focused town and the forest between it and the Tower:
 * defensive boars, roe deer and a hare, an armed outlaw camped at the ruined cloister, and four
 * townsfolk (a watch, a baker, a woodcutter and an herbalist) beside the original residents. It is the
 * same kind of seeded generation `initializeWildlife` performs for village worlds, journaled
 * as its own host operation. Afterwards the ordinary ecology and cognition own everything:
 * animals forage, defend and can starve; the outlaw robs or flees by the bandit rules.
 * Idempotent: a World that already has ecology is left alone.
 */
export const FOREST_FOUNDERS = [
  { species: 'woodland_boar', placement: 'forest-cross', offset: [9, 10] },
  { species: 'woodland_boar', placement: 'forest-branches', offset: [10, -2] },
  { species: 'roe_deer', placement: 'forest-cross', offset: [-10, 4] },
  { species: 'roe_deer', placement: 'forest-cross', offset: [-12, 8] },
  { species: 'field_hare', placement: 'forest-cross', offset: [12, 10] },
  { species: 'roe_deer', placement: 'forest-turn', offset: [-6, 8] },
] as const;
const OUTLAW = { placement: 'ruins', offset: [0, 0] } as const;
/** Town founders beside the two original residents: a watch, a provisioner and two households.
 * Food is uneven on purpose of nothing but stock: whoever carries none is hungry soon enough. */
export const TOWN_FOUNDERS = [
  { name: 'Hale Brennick', gender: 'm', age: 41, occupation: 'guard', placement: 'home-west', offset: [1.2, 0], wealth: 30, weapon: 'sword', food: 0,
    traits: { courage: .85, aggression: .45, honesty: .8 }, bio: 'Keeps the watch on the forest path to the Tower.' },
  { name: 'Odile Marsh', gender: 'f', age: 36, occupation: 'baker', placement: 'store', offset: [1.2, 0], wealth: 45, weapon: null, food: 4,
    traits: { sociability: .7, greed: .45 }, bio: 'Bakes for the square; her flour comes up the forest road.' },
  { name: 'Pell Arden', gender: 'm', age: 29, occupation: 'woodcutter', placement: 'home-east', offset: [1.2, 0], wealth: 14, weapon: null, food: 0,
    traits: { courage: .55 }, bio: 'Cuts timber at the forest edge when the boars allow it.' },
  { name: 'Wenna Arden', gender: 'f', age: 27, occupation: 'herbalist', placement: 'home-east', offset: [-1.2, 0], wealth: 18, weapon: null, food: 1,
    traits: { curiosity: .7 }, bio: 'Gathers herbs under the pines with her brother Pell.' },
] as const;

/** Nearest standable cell to an authored point, searched in a fixed ring order. */
function standable(w: World, x: number, z: number, test: (p: Vec3) => boolean): Vec3 | null {
  for (let r = 0; r <= 6; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const cx = Math.floor(x) + dx, cz = Math.floor(z) + dz, y = w.nav.floorY(cx, cz), p = { x: cx + .5, y, z: cz + .5 };
    if (y >= 0 && w.nav.walkCost(cx, cz) < 3 && test(p)) return p;
  }
  return null;
}

export function seedForestLife(w: World): { animals: number; outlaw: string | null; residents: number } {
  const town = (w.grid as RealmGrid).focusedTown;
  if (w.ecology || !town) return { animals: 0, outlaw: null, residents: 0 };
  enableEcology(w);
  const at = (key: string) => town.placements.find(p => p.id.endsWith(':' + key))?.position;
  let animals = 0;
  for (const f of FOREST_FOUNDERS) {
    const origin = at(f.placement); if (!origin) continue;
    const pos = standable(w, origin[0] + f.offset[0], origin[2] + f.offset[1], p => w.nav.canStepTo(p, p.x, p.z)); if (!pos) continue;
    createAnimal(w, f.species, pos);
    // The forest floor's browse and mast, endowed once where the founders stand; renewable, never refilled by this call.
    for (const forage of ['browse', 'mast'] as const) w.resourceNodes.push({ id: `forage_${forage}_focused_${Math.floor(pos.x)}_${Math.floor(pos.z)}`, kind: 'forage', forage,
      yield: 'biomass', pos: { ...pos }, blocks: [], remaining: forage === 'mast' ? 2.4 : 9.6, capacity: forage === 'mast' ? 2.4 : 9.6, renewable: true,
      regrowHours: (forage === 'mast' ? 120 : 30) * 24, renewedAt: w.now, state: 'available' });
    animals++;
  }
  let outlaw: string | null = null;
  const ruin = at(OUTLAW.placement), pos = ruin && standable(w, ruin[0] + OUTLAW.offset[0], ruin[2] + OUTLAW.offset[1], p => !!w.grid.movementGeometryAt(p.x, p.z)?.fits(p.x, p.y, p.z, .3, 1.75));
  if (pos) {
    const camp = makePlace(w, 'camp', 'Cloister ruin camp', { x0: pos.x - 6, x1: pos.x + 6, z0: pos.z - 6, z1: pos.z + 6, y0: pos.y, y1: pos.y + 4 }, { inside: pos, indoor: false });
    const p = makePerson(w, { name: 'Corran the poacher', gender: 'm', age: 34, occupation: 'bandit', home: camp.id, work: camp.id, hostile: true, wealth: 12,
      traits: { courage: .7, aggression: .8, greed: .85, honesty: .15, sociability: .3 }, appearance: {}, tags: ['forest-outlaw'],
      bio: 'Poaches the forest between the town and the Tower, and robs travellers on the path.' });
    p.bodies.push(makeBody(w, p.id, pos).id);
    const blade = makeItem(w, 'dagger', 'Poacher’s knife', { owner: p.id, holder: p.id, condition: 1 });
    blade.provenance.push({ tick: w.now, from: null, to: p.id, how: 'forest founder endowment' });
    changeEquipment(w, p, blade.id, true);
    outlaw = p.id;
  }
  const residents = seedTownFounders(w);
  w.nav.rebuildAll();
  return { animals, outlaw, residents };
}

function seedTownFounders(w: World): number {
  const town = (w.grid as RealmGrid).focusedTown; if (!town) return 0;
  const square = w.places().find(p => p.type === 'square' && p.name.startsWith('Cinderveil'));
  let made = 0;
  for (const f of TOWN_FOUNDERS) {
    const placement = town.placements.find(p => p.id.endsWith(':' + f.placement)); if (!placement) continue;
    const at = placedPoint(FOCUSED_CATALOG.sources[placement.assetId].spawn, placement);
    const pos = standable(w, at[0] + f.offset[0], at[2] + f.offset[1], p => !!w.grid.movementGeometryAt(p.x, p.z)?.fits(p.x, p.y, p.z, .3, 1.75)
      && !w.nearbyPhysicalBodies(p, .8, true).some(b => b.present)); if (!pos) continue;
    const p = makePerson(w, { name: f.name, gender: f.gender, age: f.age, occupation: f.occupation, wealth: f.wealth, traits: { ...f.traits }, appearance: {},
      home: square?.id ?? null, bio: f.bio, tags: ['town-founder'] });
    p.bodies.push(makeBody(w, p.id, pos).id);
    const endow = (type: 'sword' | 'bread', name: string, quantity = 1) => {
      const i = makeItem(w, type, name, { owner: p.id, holder: p.id, quantity, ...(type === 'sword' ? { condition: 1 } : {}) });
      i.provenance.push({ tick: w.now, from: null, to: p.id, how: 'town founder endowment' }); return i;
    };
    if (f.weapon) changeEquipment(w, p, endow(f.weapon, 'Watch sword').id, true);
    if (f.food) endow('bread', 'Square loaves', f.food);
    made++;
  }
  return made;
}
