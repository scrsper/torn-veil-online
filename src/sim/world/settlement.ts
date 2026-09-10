import type { World } from '../core/world';
import type { Person, Place, PlaceType, Occupation, Vec3, WorldEvent, Settlement } from '../core/types';
import { RNG } from '../core/rng';
import { VoxelGrid } from '../physical/grid';
import { RegionalGrid } from '../physical/regionalGrid';
import { B } from '../physical/blocks';
import { buildHouse, buildTavern, buildShop, buildMill, buildFarm, buildWell, flatten, type BuildResult, type Facing } from './structures';
import { makePerson, makePlace, makeBody, makeItem, makeFaction } from './factory';
import { createFields } from './metabolism';
import { plantGrove, registerStoneNodes, registerGameGround } from './resources';
import { makeHousehold, joinHousehold } from './household';
import { getRel, setRelTags } from '../mind/relationships';
import { learn, learnPlace, learnAffordance } from '../mind/knowledge';
import { remember } from '../mind/memory';
import { scheduleFor } from '../mind/schedule';
import { seedStartingSkills } from '../core/skills';
import { STARTING_AFFORDANCE_KNOWLEDGE } from '../core/affordance';
import { createFire } from './fire';
import { generateSettlementSpec, ISOLATED_SITES, SETTLEMENT_SIZE, settlementHeight, type SettlementSite, type SettlementSpec } from './settlementSpec';

export interface SettlementResult { spec: SettlementSpec; places: Record<string, Place>; people: Record<string, Person>; }
const WORK: Partial<Record<Occupation, string>> = { baker: 'bakery', miller: 'mill', cook: 'tavern', innkeeper: 'tavern', woodcutter: 'clearing', hunter: 'forest', herbalist: 'herbs' };

function materialize(world: World, spec: SettlementSpec, regional: RegionalGrid): SettlementResult {
  const rng = new RNG(spec.seed), size = SETTLEMENT_SIZE;
  const grid = new VoxelGrid(size, 48, size); grid.initCaches();
  const ctx = { grid, reserved: new Uint8Array(size * size), rng };
  for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
    const h = settlementHeight(spec, x, z);
    for (let y = 0; y <= h; y++) grid.data[grid.idx(x, y, z)] = y === h ? (spec.biome === 'dryland' ? B.Sand : B.Grass) : y > h - 3 ? B.Dirt : B.Stone;
  }
  const places: Record<string, Place> = {}, people: Record<string, Person> = {};
  const shift = (v: Vec3): Vec3 => ({ x: v.x + spec.site.x, y: v.y, z: v.z + spec.site.z });
  // Search seeded candidate rectangles; reject collisions and steep foundations. A reserved
  // margin preserves door approaches. No Ashford coordinates or authored plot order are used.
  const plots: { x0: number; z0: number; x1: number; z1: number }[] = [];
  const place = (key: string, type: PlaceType, width: number, depth: number, beds = 0): Place => {
    let plot: typeof plots[number] | undefined;
    for (let attempt = 0; attempt < 8000; attempt++) {
      const x0 = key === 'square' ? rng.int(95, 125) : rng.int(12, size - width - 12), z0 = key === 'square' ? rng.int(95, 125) : rng.int(12, size - depth - 12);
      const p = { x0, z0, x1: x0 + width - 1, z1: z0 + depth - 1 };
      if (plots.some(q => p.x0 - 6 <= q.x1 && p.x1 + 6 >= q.x0 && p.z0 - 6 <= q.z1 && p.z1 + 6 >= q.z0)) continue;
      const hs = [settlementHeight(spec, p.x0, p.z0), settlementHeight(spec, p.x1, p.z1)];
      if (Math.max(...hs) - Math.min(...hs) > 1) continue;
      plot = p; break;
    }
    if (!plot) throw new Error(`No fitting plot for ${spec.name}:${key}`);
    plots.push(plot);
    const { x0, z0, x1, z1 } = plot, floor = settlementHeight(spec, Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2));
    flatten(grid, x0, z0, x1, z1, floor, 2);
    const facing = rng.pick(['N', 'S', 'E', 'W'] as Facing[]);
    let r: BuildResult;
    if (type === 'tavern') r = buildTavern(ctx, x0, z0, x1, z1, floor, facing, []);
    else if (type === 'bakery') r = buildShop(ctx, x0, z0, x1, z1, floor, facing, 'bakery', []);
    else if (type === 'mill') r = buildMill(ctx, x0, z0, x1, z1, floor, 'E', 'W', []);
    else if (type === 'house' || type === 'chapel') r = buildHouse(ctx, x0, z0, x1, z1, floor, facing, { beds, style: spec.biome === 'woodland' ? 'log' : 'stone', roof: 'thatch' });
    else {
      const inside = { x: x0 + 2, y: floor + 1, z: z0 + 2 };
      const anchors = type === 'farm' ? buildFarm(ctx, x0, z0, x1, z1, floor) : type === 'well' ? buildWell(ctx, x0 + 4, z0 + 4, floor) : [{ pos: inside, kind: 'work' as const, label: key }];
      r = { inside, anchors, door: null, fires: [], chimneys: [], y1: floor + 4 };
    }
    const p = makePlace(world, type, `${spec.name} ${key.replaceAll('_', ' ')}`, { x0: x0 + spec.site.x, z0: z0 + spec.site.z, x1: x1 + spec.site.x, z1: z1 + spec.site.z, y0: floor + 1, y1: r.y1 }, {
      inside: shift(r.inside), door: r.door ? shift(r.door) : null, anchors: r.anchors.map(a => ({ ...a, pos: shift(a.pos) })), fires: r.fires.map(shift), chimneys: r.chimneys.map(shift),
      indoor: ['house', 'tavern', 'bakery', 'mill', 'chapel'].includes(type), slug: `${spec.site.id}:${key}`,
    });
    p.createdAt = world.now - (Math.max(...spec.residents.map(p => p.age)) + 5) * 365 * 86400;
    places[key] = p; return p;
  };
  place('square', 'square', 14, 14); place('well', 'well', 9, 9);
  place('tavern', 'tavern', 16, 13); place('chapel', 'chapel', 11, 11);
  place('bakery', 'bakery', 12, 11); place('mill', 'mill', 12, 11);
  place('sawpit', 'sawpit', 9, 9); place('stall_game', 'stall', 8, 8);
  place('clearing', 'wilderness', 25, 25); place('forest', 'wilderness', 18, 18); place('herbs', 'wilderness', 14, 14); place('quarry', 'quarry', 18, 18);
  for (let i = 0; i < spec.resources.fields; i++) place(`farm_${i}`, 'farm', rng.int(18, 25), rng.int(18, 25));
  const householdIds = [...new Set(spec.residents.map(p => p.household))];
  for (const id of householdIds) {
    const members = spec.residents.filter(p => p.household === id).length;
    const side = Math.max(12, members * 2 + 3);
    place(`home_${id}`, 'house', side, side, members);
  }
  grid.initCaches(); regional.addPatch(spec.site.x, spec.site.z, grid);
  world.initNav();
  const faction = makeFaction(world, spec.name, `The residents of ${spec.name}.`, { slug: `${spec.site.id}:civic`, factionType: 'civic' });
  const households = new Map(householdIds.map(id => [id, makeHousehold(world, `${spec.name} household ${id}`, places[`home_${id}`].id)]));
  let farmer = 0;
  for (const c of spec.residents) {
    const home = places[`home_${c.household}`], work = c.occupation === 'farmer' ? places[`farm_${farmer++ % spec.resources.fields}`] : places[WORK[c.occupation] ?? ''];
    const p = makePerson(world, { name: c.name, gender: c.gender, age: c.age, occupation: c.occupation, home: home.id, work: work?.id, wealth: c.wealth, traits: { sociability: rng.range(0.2, 0.9), honesty: rng.range(0.3, 0.9), courage: rng.range(0.2, 0.8), piety: rng.range(0.1, 0.8) }, appearance: { shirt: rng.int(0x303030, 0xc0c0c0) }, bio: `A member of ${spec.name}, supported by its ${spec.biome} economy.`, slug: `${spec.site.id}:${c.key}` });
    people[c.key] = p; p.factionId = faction.id; faction.members.push(p.id);
    joinHousehold(world, p, households.get(c.household)!); home.residents.push(p.id);
    const bed = home.anchors.find(a => a.kind === 'bed' && !a.ownerId); if (bed) bed.ownerId = p.id;
    if (work) { work.workers.push(p.id); work.ownerId ??= p.id; }
    if (c.occupation === 'hunter') { places.stall_game.workers.push(p.id); places.stall_game.ownerId ??= p.id; }
    home.ownerId ??= p.id;
    const b = makeBody(world, p.id, home.inside); p.bodies.push(b.id);
    p.schedule = scheduleFor(p, { home: home.id, work: work?.id ?? null, tavern: places.tavern.id, square: places.square.id, chapel: places.chapel.id, field: c.occupation === 'farmer' ? work?.id : null, saw: places.sawpit.id, stall: c.occupation === 'hunter' ? places.stall_game.id : null });
    seedStartingSkills(p);
    for (const t of STARTING_AFFORDANCE_KNOWLEDGE[p.occupation] ?? []) learnAffordance(world, p, t, { type: 'prior' });
    for (const pl of Object.values(places)) {
      learnPlace(world, p, pl, { type: 'prior' });
      learn(world, p, { key: `place:${pl.id}`, kind: 'fact', claim: { placeId: pl.id, pos: pl.inside }, confidence: 1, source: { type: 'prior' } }, true);
    }
  }
  faction.leaderId = Object.values(people).filter(p => p.age >= 18).sort((a, b) => b.age - a.age)[0].id;
  const historical = (event: WorldEvent, witnesses: Person[]) => {
    for (const p of witnesses) {
      const source = { type: 'witnessed' as const, viaEvent: event.id };
      learn(world, p, { key: `ev:${event.id}`, kind: 'event', claim: { eventId: event.id, type: event.type, actor: event.actor, target: event.target, tick: event.tick, ...event.data }, confidence: 1, source }, true);
      remember(world, p, { type: event.type, summary: event.summary!, eventId: event.id, entities: witnesses.map(p => p.id), significance: 0.6, source, tick: event.tick }, true);
    }
  };
  for (const c of spec.residents) {
    const p = people[c.key]; p.parentIds = c.parents.map(k => people[k].id);
    for (const parent of p.parentIds) { setRelTags(p, parent, 'parent'); setRelTags(world.person(parent)!, p.id, 'child'); }
    for (const sibling of spec.residents.filter(q => q.key !== c.key && q.parents.some(id => c.parents.includes(id)))) setRelTags(p, people[sibling.key].id, 'sibling');
    if (p.parentIds.length) historical(world.emit('birth', {
      actor: p.parentIds[0], target: p.id, placeId: p.homeId!, tick: p.birthTick, category: 'history', significance: 0.7,
      data: { parentIds: p.parentIds }, summary: `${p.name} was born to ${p.parentIds.map(id => world.nameOf(id)).join(' and ')}`,
    }), p.parentIds.map(id => world.person(id)!));
    if (c.spouse) {
      const q = people[c.spouse]; setRelTags(p, q.id, 'spouse'); Object.assign(getRel(p, q.id), { affection: 0.8, trust: 0.7, familiarity: 1 });
      if (p.id < q.id) {
        const oldestChild = Math.max(0, ...spec.residents.filter(k => k.parents.includes(c.key)).map(k => k.age));
        historical(world.emit('marriage', { actor: p.id, target: q.id, placeId: places.chapel.id, tick: world.now - (oldestChild + 1) * 365 * 86400, category: 'history', significance: 0.7, summary: `${p.name} married ${q.name}` }), [p, q]);
      }
    }
    for (const q of Object.values(people)) if (q.id !== p.id && (q.homeId === p.homeId || rng.chance(0.2))) {
      const rel = getRel(p, q.id); rel.familiarity = Math.max(rel.familiarity, rng.range(0.3, 0.8));
      if (!rel.tags.length) { rel.affection = rng.range(-0.2, 0.5); rel.trust = rng.range(0.1, 0.6); }
    }
  }
  for (const h of [...spec.history].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const a = people[h.a], b = people[h.b], amount = Math.min(h.amount, b.wealth);
    const type = h.kind === 'debt' ? 'debt' : 'dispute';
    if (h.kind === 'debt') {
      b.wealth -= amount; a.wealth += amount; setRelTags(a, b.id, 'debtor'); setRelTags(b, a.id, 'creditor');
      b.desires.push({ type: 'collect_debt', targetId: a.id, note: `${a.name} owes me ${amount} silver.`, reward: 0, fulfilled: false });
    }
    else { getRel(a, b.id).grudge += 0.2; getRel(b, a.id).grudge += 0.1; }
    historical(world.emit(type, { actor: a.id, target: b.id, placeId: places.square.id, tick: world.now - h.daysAgo * 86400, category: 'history', significance: 0.6, data: { amount }, summary: h.kind === 'debt' ? `${a.name} borrowed ${amount} silver from ${b.name}` : `${a.name} and ${b.name} argued over access to work` }), [a, b]);
  }
  for (const pl of Object.values(places)) {
    const stock = (type: Parameters<typeof makeItem>[1], quantity: number) => makeItem(world, type, type, { owner: pl.ownerId, placeId: pl.id, pos: pl.inside, quantity });
    if (pl.type === 'house') { stock('bread', spec.resources.foodReserve * pl.residents.length); stock('cheese', spec.resources.foodReserve * pl.residents.length); }
    if (pl.type === 'farm') stock('grain', rng.int(24, 70));
    if (pl.type === 'mill') { stock('grain', rng.int(12, 40)); stock('flour', 12); }
    if (pl.type === 'bakery') { stock('flour', rng.int(12, 40)); stock('bread', rng.int(20, 50)); }
    if (pl.type === 'tavern') { stock('ale', 12); stock('meat', 12); stock('log', 8); stock('stick', 12); stock('stew', 12); if (pl.fires[0]) createFire(world, pl.id, pl.fires[0], false); }
    if (pl.type === 'sawpit') { stock('saw', 1); stock('log', 6); }
    if (pl.type === 'quarry') stock('pickaxe', 1);
  }
  for (const p of Object.values(people)) if (p.occupation === 'woodcutter') {
    places.sawpit.workers.push(p.id); makeItem(world, 'axe', `${p.name}'s axe`, { owner: p.id, holder: p.id });
  }
  plantGrove(world, places.clearing.bounds, places.clearing.id, places.clearing.id, spec.resources.timber);
  registerGameGround(world, places.forest.id, Math.round(20 + spec.resources.timber * 3 * spec.moisture));
  registerStoneNodes(world, places.quarry.id, Array.from({ length: spec.resources.stone }, (_, i) => ({ x: places.quarry.bounds.x0 + 3 + (i % 3) * 4, y: 0, z: places.quarry.bounds.z0 + 3 + Math.floor(i / 3) * 4 })));
  // Route footpaths through actual navigable ground, never through buildings. These are local
  // streets, not roads across the intervening wilderness.
  for (const pl of Object.values(places)) {
    const route = world.nav.findPath(places.square.inside, pl.inside, 100000);
    if (!route) throw new Error(`Unreachable generated place ${pl.slug}`);
    let previous = places.square.inside;
    for (const point of route) {
      const steps = Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) * 2);
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 1, x = Math.floor(previous.x + (point.x - previous.x) * t), z = Math.floor(previous.z + (point.z - previous.z) * t);
        const y = world.nav.floorY(x, z) - 1, b = regional.get(x, y, z);
        if (b === B.Grass || b === B.Dirt || b === B.Sand) regional.set(x, y, z, B.Path);
      }
      previous = point;
    }
  }
  world.nav.rebuildArea(spec.site.x, spec.site.z, spec.site.x + size - 1, spec.site.z + size - 1);
  const settlement = world.add<Settlement>({ id: world.nextId('settlement'), kind: 'settlement', slug: 'settlement:' + spec.site.id,
    name: spec.name, createdAt: Math.min(...Object.values(places).map(p => p.createdAt)), tags: [], siteId: spec.site.id,
    localSeed: spec.seed, location: { ...places.square.inside }, bounds: { x0: spec.site.x, z0: spec.site.z, x1: spec.site.x + size - 1, z1: spec.site.z + size - 1 },
    foundedAt: null, generatedAt: world.now, formerInhabitantIds: Object.values(people).map(p => p.id),
    populationHistory: [{ tick: world.now, population: Object.values(people).filter(p => p.alive).length, type: 'baseline' }] });
  for (const place of Object.values(places)) place.settlementId = settlement.id;
  return { spec, places, people };
}

/** One registry, physical coordinate space, simulation and clock. Ashford's entry point stays
 * untouched. Only generation is local-seeded; runtime systems share the canonical World. */
export function generateProceduralWorld(world: World, sites: readonly SettlementSite[] = ISOLATED_SITES): SettlementResult[] {
  if (world.entities.size) throw new Error('Procedural generation requires an empty World');
  if (!sites.length || new Set(sites.map(s => s.id)).size !== sites.length) throw new Error('Expected unique settlement site IDs');
  const sorted = [...sites].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length; i++) for (const b of sorted.slice(i + 1)) if (Math.abs(sorted[i].x - b.x) < SETTLEMENT_SIZE && Math.abs(sorted[i].z - b.z) < SETTLEMENT_SIZE) throw new Error('Settlement patches overlap');
  world.settlementSites = sorted.map(s => ({ ...s }));
  const grid = new RegionalGrid(Math.max(...sites.map(s => s.x)) + SETTLEMENT_SIZE + 128, Math.max(...sites.map(s => s.z)) + SETTLEMENT_SIZE + 128, world.seed);
  world.grid = grid;
  const settlements = sorted.map(site => materialize(world, generateSettlementSpec(world.seed, site), grid));
  createFields(world, settlements.flatMap(s => Object.values(s.places).filter(p => p.type === 'farm').map(p => ({ placeId: p.id, ownerId: p.ownerId, startMoisture: s.spec.moisture }))));
  world.events.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  world.pendingStimuli = [];
  grid.recording = true;
  return settlements;
}
