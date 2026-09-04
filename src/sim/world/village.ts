import { World } from '../core/world';
import { B } from '../physical/blocks';
import { WORLD_W, WORLD_H, WORLD_D, CX, CZ, VILLAGE_TOP, generateTerrain, generateVegetation, terrainHeight, riverCenter } from './terrain';
import { buildHouse, buildTavern, buildSmithy, buildShop, buildChapel, buildGraveyard, buildGuardhouse, buildFarm, buildStall, buildWell, buildCamp, buildShrine, buildMill, buildBridge, flatten, reserve, fill, v, type BuildCtx, type Facing, type BuildResult } from './structures';
import { makePerson, makeItem, makePlace, makeBody, makeFaction, makeCreature, ITEM_LABEL } from './factory';
import { CAST } from './cast';
import type { Place, Person, Vec3, Anchor, EntityId, Item } from '../core/types';
import { createFields, cropBlockFor } from './metabolism';
import { plantGrove, registerStoneNodes } from './resources';
import { createConstructionProject } from './construction';
import { scheduleFor } from '../mind/schedule';
import { getRel, setRelTags, adjustRel } from '../mind/relationships';
import { remember } from '../mind/memory';
import { learn, learnPlace, learnAffordance } from '../mind/knowledge';
import { seedStartingSkills } from '../core/skills';
import { STARTING_AFFORDANCE_KNOWLEDGE } from '../core/affordance';
import { createFire } from './fire';
import { SECONDS_PER_DAY } from '../core/time';

const F = VILLAGE_TOP + 1; // feet level in the village

export interface GenResult { places: Record<string, Place>; people: Record<string, Person>; }

export function generateVillage(world: World): GenResult {
  world.initPhysical(WORLD_W, WORLD_H, WORLD_D);
  const grid = world.grid; grid.initCaches();
  const reserved = new Uint8Array(WORLD_W * WORLD_D);
  const ctx: BuildCtx = { grid, reserved, rng: world.rng.fork(3) };
  generateTerrain(grid, world.seed, reserved);

  const places: Record<string, Place> = {};
  // Every place registered through P() gets its village.ts dictionary key as a stable slug
  // (Constitution §50) — e.g. places.tavern.slug === 'tavern' — regardless of which builder
  // helper (fromBuild/house/farm/stall/gate/wild) constructed it.
  const P = (key: string, p: Place) => { world.bindSlug(p, key); places[key] = p; return p; };
  const bounds = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number) => ({ x0, z0, x1, z1, y0, y1 });
  const fromBuild = (key: string, type: Place['type'], name: string, x0: number, z0: number, x1: number, z1: number, floor: number, r: BuildResult, desc: string, indoor = true) =>
    P(key, makePlace(world, type, name, bounds(x0, z0, x1, z1, floor, r.y1), { door: r.door, inside: r.inside, anchors: r.anchors, description: desc, indoor, fires: r.fires, chimneys: r.chimneys }));
  const floorAt = (x0: number, z0: number, x1: number, z1: number) => { const h = terrainHeight(Math.floor((x0 + x1) / 2), Math.floor((z0 + z1) / 2), world.seed); return Math.max(h, 12) + 1; };
  const house = (key: string, name: string, x0: number, z0: number, x1: number, z1: number, facing: Facing, opts: Parameters<typeof buildHouse>[7], desc: string) => {
    const fl = floorAt(x0, z0, x1, z1) ; flatten(grid, x0, z0, x1, z1, fl - 1, 2);
    const r = buildHouse(ctx, x0, z0, x1, z1, fl - 1, facing, opts); return fromBuild(key, 'house', name, x0, z0, x1, z1, fl, r, desc);
  };

  // ---- Square & roads
  reserve(ctx, 84, 84, 108, 108, 1);
  fill(grid, 84, VILLAGE_TOP, 84, 108, VILLAGE_TOP, 108, B.Cobble); fill(grid, 84, F, 84, 108, F + 6, 108, B.Air);
  const squareAnchors: Anchor[] = [...buildWell(ctx, CX, CZ, VILLAGE_TOP)];
  for (let x = 86; x <= 106; x += 5) for (const z of [86, 106]) { if (Math.abs(x - 96) < 3) continue; grid.set(x, F, z, B.Fence); grid.set(x, F + 1, z, B.Fence); grid.set(x, F + 2, z, B.Lantern); }
  for (let z = 91; z <= 101; z += 5) for (const x of [86, 106]) { grid.set(x, F, z, B.Fence); grid.set(x, F + 1, z, B.Fence); grid.set(x, F + 2, z, B.Lantern); }
  for (const [x, z] of [[88, 88], [104, 88], [88, 104], [104, 104]]) { grid.set(x, F, z, B.Bench); squareAnchors.push({ pos: v(x, F, z), kind: 'seat', label: 'bench' }); }
  for (let i = 0; i < 6; i++) squareAnchors.push({ pos: v(90 + i * 2, F, 99), kind: 'work', label: 'square' });
  for (const [x, z] of [[92, 92], [100, 92], [92, 100], [100, 100], [96, 90]]) squareAnchors.push({ pos: v(x, F, z), kind: 'inside', label: 'square' });
  P('square', makePlace(world, 'square', 'the village square', bounds(84, 84, 108, 108, F, F + 6), { inside: v(94, F, 94), anchors: squareAnchors, description: 'The cobbled heart of Ashford Vale, around the old well.', indoor: false }));
  // v0.2.4: the well is a canonical water source (Place), not just square decoration — the
  // approach cell just outside its wall, so thirsty NPCs can path to it and drink.
  P('well', makePlace(world, 'well', 'the village well', bounds(CX - 2, CZ - 2, CX + 2, CZ + 2, F, F + 2), { inside: v(CX - 2, F, CZ), anchors: [{ pos: v(CX - 2, F, CZ), kind: 'work', label: 'well' }], description: 'The old stone well at the heart of the square.', indoor: false, parent: places.square.id }));
  // stalls
  const stall = (key: string, name: string, x: number, z: number, cloth: number, facing: Facing) => P(key, makePlace(world, 'stall', name, bounds(x - 2, z - 2, x + 2, z + 2, F, F + 3), { inside: v(x, F, z + (facing === 'N' ? 1 : -1)), anchors: buildStall(ctx, x, z, VILLAGE_TOP, cloth, facing), description: `A market stall in the square.`, indoor: false, parent: places.square.id }));
  stall('stall_bread', "the bread stall", 89, 90, B.ClothRed, 'E'); stall('stall_produce', 'the vegetable stall', 103, 90, B.ClothBlue, 'W');
  stall('stall_grain', 'the grain stall', 89, 102, B.Cloth, 'E'); stall('stall_game', "the hunter's stall", 103, 102, B.ClothRed, 'W');

  // ---- Buildings
  const tav = buildTavern(ctx, 112, 78, 127, 89, VILLAGE_TOP, 'W', []); fromBuild('tavern', 'tavern', 'The Gilded Boar', 112, 78, 127, 89, F, tav, 'The village tavern: ale, stew, gossip and a warm fire.');
  // v0.8 §C/D: a real, canonical fire at the tavern's own hearth (the existing fireplace block
  // this Place has always had) — unlit until the cook actually lights it (world/cooking.ts).
  // Indoor, so never rain-exposed (`exposed: false`).
  if (tav.fires[0]) createFire(world, places.tavern.id, tav.fires[0], false);
  const smi = buildSmithy(ctx, 112, 102, 122, 110, VILLAGE_TOP, 'W'); fromBuild('smithy', 'smithy', "Ironhand's Smithy", 112, 102, 122, 110, F, smi, 'Garrick Ironhand\'s forge. The ring of the hammer carries across the square.', false);
  const bak = buildShop(ctx, 70, 78, 79, 86, VILLAGE_TOP, 'E', 'bakery', []); fromBuild('bakery', 'bakery', "Bramble's Bakery", 70, 78, 79, 86, F, bak, 'Osric Bramble\'s bakery. The ovens are lit before dawn.');
  const sto = buildShop(ctx, 69, 102, 79, 110, VILLAGE_TOP, 'E', 'store', []); fromBuild('store', 'store', "Crane's General Store", 69, 102, 79, 110, F, sto, 'Wendel Crane\'s store: tools, cloth, cheese, candles, and credit at a price.');
  const chp = buildChapel(ctx, 90, 54, 102, 71, VILLAGE_TOP, 'S', []); fromBuild('chapel', 'chapel', 'Chapel of the Lantern-Bearer', 88, 54, 107, 73, F, chp, 'The stone chapel and its bell tower. Services at dawn and dusk.');
  flatten(grid, 110, 56, 122, 68, VILLAGE_TOP, 1);
  const graves = buildGraveyard(ctx, 110, 56, 122, 68, VILLAGE_TOP, ['Anna Wold', 'Lissa Bramble', 'Old Tam Reed', 'Mira Reed', 'Aldric Ashford', 'Bet Penny']);
  P('graveyard', makePlace(world, 'graveyard', 'the graveyard', bounds(110, 56, 122, 68, F, F + 3), { inside: v(112, F, 62), anchors: graves, description: 'Rows of headstones behind the chapel.', indoor: false }));
  const gua = buildGuardhouse(ctx, 91, 114, 101, 123, VILLAGE_TOP, 'N', []); fromBuild('guardhouse', 'guardhouse', 'the guardhouse', 91, 114, 105, 127, F, gua, 'Stone barracks of the village watch, with a lookout tower.');

  house('house_garrick', "the Ironhand house", 132, 80, 140, 87, 'S', { style: 'plank', roof: 'tile', beds: 2, tables: 1 }, "Garrick and Edda Ironhand's home.");
  house('house_godwin', "Elder Godwin's house", 144, 80, 151, 87, 'S', { style: 'plaster', roof: 'tile', beds: 1, shelves: true }, "The elder's house, full of books and old quarrels.");
  house('house_rowan', "Captain Ashford's house", 156, 80, 163, 87, 'S', { style: 'stone', roof: 'dark', beds: 1 }, "Captain Rowan's tidy house at the east end.");
  house('hut_tomas', "Tomas's hut", 132, 104, 138, 110, 'N', { style: 'log', roof: 'thatch', beds: 1, fireplace: true, tables: 0 }, 'A one-room hut the apprentice rents from Garrick.');
  house('house_wendel', 'the Crane house', 144, 104, 152, 112, 'N', { style: 'plaster', roof: 'tile', beds: 2, shelves: true }, "Wendel and Petra Crane's house, the finest in the village.");
  house('house_bors', "Bors's house", 78, 128, 85, 135, 'E', { style: 'log', roof: 'thatch', beds: 1 }, "The woodcutter's house. Logs stacked to the eaves.");
  house('house_cedric', "Cedric's house", 78, 142, 85, 149, 'E', { style: 'plank', roof: 'thatch', beds: 2 }, "Cedric Wold's house. One bed has not been slept in since winter.");
  house('house_maud', "Maud's house", 158, 60, 165, 67, 'W', { style: 'plank', roof: 'thatch', beds: 1 }, "Maud Penny's cottage by her fields.");
  house('house_jory', 'the Fletcher house', 106, 142, 114, 150, 'W', { style: 'plank', roof: 'thatch', beds: 3 }, "Jory, Nell and Tilly Fletcher's home.");
  house('farmhouse_alwin', 'the Hollis farmhouse', 56, 84, 64, 91, 'S', { style: 'plank', roof: 'thatch', beds: 3 }, "The Hollis family's farmhouse.");
  house('hut_kestrel', "Kestrel's hut", 150, 36, 156, 42, 'S', { style: 'log', roof: 'dark', beds: 1, tables: 0 }, "The hunter's hut at the edge of the northern forest.");
  house('hut_wyn', "Old Wyn's hut", 40, 160, 46, 166, 'N', { style: 'log', roof: 'thatch', beds: 1, shelves: true, tables: 0 }, "The herbalist's hut, hung with drying herbs.");
  // farms
  const farm = (key: string, name: string, x0: number, z0: number, x1: number, z1: number, desc: string) => { const fl = VILLAGE_TOP; flatten(grid, x0, z0, x1, z1, fl, 1); P(key, makePlace(world, 'farm', name, bounds(x0, z0, x1, z1, F, F + 2), { inside: v(Math.floor((x0 + x1) / 2), F, z0 + 1), anchors: buildFarm(ctx, x0, z0, x1, z1, fl), description: desc, indoor: false })); };
  farm('farm_alwin', 'the Hollis fields', 36, 100, 66, 124, 'Wheat and vegetables west of the village.');
  farm('farm_jory', 'the Fletcher fields', 120, 118, 146, 142, 'Grain fields south-east of the village.');
  farm('farm_cedric', "Cedric's fields", 40, 132, 70, 156, 'A widower\'s fields, a little overgrown.');
  farm('farm_maud', "Maud's fields", 132, 56, 156, 74, 'Maud Penny\'s fields north-east of the village.');
  // mill & bridge
  { const fl = VILLAGE_TOP; flatten(grid, 30, 80, 38, 88, fl, 2); const r = buildMill(ctx, 30, 80, 38, 88, fl, 'E', 'W', []); fromBuild('mill', 'mill', 'the old mill', 28, 80, 38, 88, F, r, 'Hobb Grist\'s mill on the river.'); }
  // v0.2.4: a second canonical water source — the river bank by the mill, for the western farms.
  P('riverbank', makePlace(world, 'well', 'the river bank', bounds(38, 90, 42, 94, F, F + 2), { inside: v(40, F, 92), anchors: [{ pos: v(40, F, 92), kind: 'work', label: 'river' }], description: 'A worn place on the river bank where folk draw water.', indoor: false }));
  buildBridge(ctx, 14, 30, 96, VILLAGE_TOP);
  // wilderness places
  { const fl = terrainHeight(166, 30, world.seed); const r = buildCamp(ctx, 166, 30, fl, []); P('camp', makePlace(world, 'camp', 'the bandit camp', bounds(160, 24, 172, 36, fl + 1, fl + 4), { inside: v(166, fl + 1, 32), anchors: r.anchors, description: 'A hidden camp in the north-eastern forest.', indoor: false, fires: r.fires })); }
  { const fl = terrainHeight(60, 28, world.seed); const a = buildShrine(ctx, 60, 28, fl); P('shrine', makePlace(world, 'shrine', 'the old shrine', bounds(55, 23, 65, 33, fl + 1, fl + 5), { inside: v(60, fl + 1, 31), anchors: a, description: 'A mossy ring of stones on the northern hill, older than the village.', indoor: false })); }
  const wild = (key: string, name: string, x0: number, z0: number, x1: number, z1: number, desc: string) => { const a: Anchor[] = []; for (let i = 0; i < 5; i++) { const x = x0 + 2 + Math.floor(ctx.rng.next() * (x1 - x0 - 4)), z = z0 + 2 + Math.floor(ctx.rng.next() * (z1 - z0 - 4)); a.push({ pos: v(x, terrainHeight(x, z, world.seed) + 1, z), kind: 'work', label: name }); } P(key, makePlace(world, 'wilderness', name, bounds(x0, z0, x1, z1, 0, 40), { inside: a[0].pos, anchors: a, description: desc, indoor: false })); };
  wild('forest_north', 'the northern forest', 100, 20, 140, 44, 'Deep pines where Kestrel hunts.');
  wild('river_woods', 'the river woods', 26, 130, 50, 158, 'Damp woods along the river where herbs grow.');
  // v0.3 Living World I — worksites for the timber / stone / construction chain, set on flat
  // plateau ground south of the Fletcher fields so every link is actually reachable.
  { // the woodcutter's clearing: a deterministic grove is planted here (below), on level ground
    reserve(ctx, 94, 128, 122, 150, 0); flatten(grid, 94, 128, 122, 150, VILLAGE_TOP, 0);
    P('clearing', makePlace(world, 'wilderness', "the woodcutter's clearing", bounds(94, 128, 122, 150, F, F + 12), { inside: v(109, F, 139), anchors: [{ pos: v(109, F, 139), kind: 'work', label: 'clearing' }, { pos: v(107, F, 133), kind: 'work', label: 'clearing' }, { pos: v(113, F, 143), kind: 'work', label: 'clearing' }], description: 'A stand of trees the village works for timber, and stumps where it already has.', indoor: false }));
  }
  { // sawpit: an open worksite where felled logs are sawn into planks
    const x0 = 116, z0 = 152, x1 = 122, z1 = 158; const fl = VILLAGE_TOP; reserve(ctx, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1); flatten(grid, x0, z0, x1, z1, fl, 1);
    for (let x = x0; x <= x1; x++) grid.set(x, F, z0, B.Log);
    grid.set(x0 + 1, F, z1 - 1, B.Crate); grid.set(x0 + 3, F, z1 - 1, B.Table);
    P('sawpit', makePlace(world, 'sawpit', 'the sawpit', bounds(x0, z0, x1, z1, F, F + 3), { inside: v(x0 + 3, F, z1 - 2), anchors: [{ pos: v(x0 + 3, F, z1 - 2), kind: 'work', label: 'saw' }, { pos: v(x0 + 2, F, z1 - 3), kind: 'inside', label: 'sawpit' }], description: 'Trestles and a great two-man saw for cutting planks.', indoor: false }));
  }
  { // construction site: a flattened, staked-out plot where the storage shed will be raised
    const x0 = 126, z0 = 152, x1 = 133, z1 = 159; const fl = VILLAGE_TOP; reserve(ctx, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1); flatten(grid, x0, z0, x1, z1, fl, 1);
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { grid.set(cx, F, cz, B.Fence); grid.set(cx, F + 1, cz, B.Fence); }
    grid.set(x0 + 3, F, z0, B.Sign);
    P('shed_site', makePlace(world, 'construction', 'the storage shed site', bounds(x0, z0, x1, z1, F, F + 4), { inside: v(x0 + 3, F, z0 + 3), anchors: [{ pos: v(x0 + 3, F, z0 + 3), kind: 'work', label: 'site' }, { pos: v(x0 + 4, F, z0 + 4), kind: 'inside', label: 'site' }], description: 'A staked-out plot. The village means to raise a storage shed here.', indoor: false }));
  }
  { // quarry: a stone outcrop on the northern rise — a deliberately long haul to the site
    const x0 = 68, z0 = 22, x1 = 78, z1 = 32; const fl = terrainHeight(73, 27, world.seed); reserve(ctx, x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1); flatten(grid, x0, z0, x1, z1, fl, 1, B.Gravel);
    P('quarry', makePlace(world, 'quarry', 'the north quarry', bounds(x0, z0, x1, z1, fl + 1, fl + 4), { inside: v(x0 + 5, fl + 1, z1 - 2), anchors: [{ pos: v(x0 + 5, fl + 1, z1 - 2), kind: 'work', label: 'quarry' }], description: 'Bare rock the village breaks for building stone.', indoor: false }));
  }
  // gates (posts on the roads)
  const gate = (key: string, name: string, x: number, z: number) => { reserve(ctx, x - 3, z - 3, x + 3, z + 3, 0); for (const [ox, oz] of [[-2, 0], [2, 0]]) { const gx = x + (z === 96 ? 0 : ox), gz = z + (z === 96 ? ox : 0); fill(grid, gx, F, gz, gx, F + 3, gz, B.Log); grid.set(gx, F + 4, gz, B.Lantern); } P(key, makePlace(world, 'gate', name, bounds(x - 3, z - 3, x + 3, z + 3, F, F + 5), { inside: v(x, F, z), anchors: [{ pos: v(x, F, z + (z === 96 ? -1 : 0) + (z !== 96 ? 0 : 0)), kind: 'post', label: name }], description: 'Lantern posts marking the edge of the village.', indoor: false })); };
  gate('gate_east', 'the east gate', 168, 96); gate('gate_south', 'the south gate', 96, 160); gate('gate_west', 'the west gate', 34, 96);

  // ---- Roads (after buildings; connect doors to main roads)
  const road = (x0: number, z0: number, x1: number, z1: number, block = B.Cobble) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) { if (!grid.inBounds(x, 0, z)) continue; const h = grid.groundHeight(x, z); const top = grid.get(x, h, z); if (top === B.Grass || top === B.Dirt || top === B.Path || top === B.Sand) { grid.set(x, h, z, block); for (let y = h + 1; y <= h + 3; y++) { const b = grid.get(x, y, z); if (b === B.Tallgrass || b === B.Flowers || b === B.Bush) grid.set(x, y, z, B.Air); } reserved[x * WORLD_D + z] = 1; } } };
  road(60, 95, 140, 97, B.Cobble); road(31, 95, 59, 97, B.Path); road(141, 95, 190, 97, B.Path); road(0, 95, 13, 97, B.Path);
  road(95, 74, 97, 130, B.Cobble); road(95, 20, 97, 53, B.Path); road(95, 131, 97, 185, B.Path);
  for (const p of Object.values(places)) { if (!p.door) continue; const d = p.door; const dx = Math.abs(d.x - 96) < Math.abs(d.z - 96) ? 96 : d.x; // connect to nearest main road with an L
    if (Math.abs(d.z - 96) <= Math.abs(d.x - 96)) road(d.x, d.z, d.x, 96, B.Path); else road(d.x, d.z, 96, d.z, B.Path); void dx; }
  road(112, 83, 108, 83, B.Cobble); road(80, 82, 84, 82, B.Cobble); road(80, 106, 84, 106, B.Cobble); road(108, 106, 112, 106, B.Cobble); road(95, 72, 97, 84, B.Cobble); road(95, 108, 97, 113, B.Cobble);
  road(163, 30, 168, 96, B.Path); // faint trail to the camp
  generateVegetation(grid, world.seed, reserved);
  grid.initCaches(); world.initNav();

  // ---- Factions
  const village = makeFaction(world, 'Ashford Vale', 'The village and its people.', { slug: 'village', factionType: 'civic' });
  const watch = makeFaction(world, 'the Village Watch', 'Captain Rowan\'s guards.', { slug: 'watch', factionType: 'watch' });
  const bandits = makeFaction(world, 'the Blackthorn Bandits', 'Two outlaws camped in the north-east forest.', { slug: 'bandits', factionType: 'outlaw' });
  bandits.hostileTo.push(village.id, watch.id); watch.hostileTo.push(bandits.id);

  // ---- People
  const people: Record<string, Person> = {};
  for (const c of CAST) {
    const home = places[c.home]; const work = c.work ? places[c.work] : null;
    const p = makePerson(world, { name: c.name, gender: c.gender, age: c.age, occupation: c.occupation, title: c.title, home: home?.id, work: work?.id, traits: c.traits, appearance: c.look, bio: c.bio, wealth: c.wealth, hostile: c.hostile, slug: c.key });
    people[c.key] = p;
    // v0.6 §V.10: profession-seeded starting proficiency — world-generation background, not
    // magical job permission (Constitution v0.6 §V.10).
    seedStartingSkills(p);
    // v0.7 §Affordances: plausible starting recognition of common worksite tools by profession —
    // world-generation background, exactly like starting skills/knowledge (never omniscient: an
    // occupation absent from the table recognizes none of these until they use one themselves).
    for (const t of STARTING_AFFORDANCE_KNOWLEDGE[c.occupation] ?? []) learnAffordance(world, p, t, { type: 'prior' });
    const fac = c.occupation === 'bandit' ? bandits : (c.occupation === 'guard' || c.occupation === 'captain') ? watch : village;
    p.factionId = fac.id; fac.members.push(p.id);
    if (home) home.residents.push(p.id); if (work) work.workers.push(p.id);
    p.schedule = scheduleFor(p, { work: work?.id ?? null, home: home?.id ?? null, tavern: places.tavern.id, square: places.square.id, chapel: places.chapel.id, stall: c.stall ? places[c.stall].id : null, field: c.field ? places[c.field].id : null, saw: places.sawpit.id, shift: c.shift });
    // v0.3: the woodcutter also works the sawpit (log → plank) in the afternoon.
    if (c.occupation === 'woodcutter') places.sawpit.workers.push(p.id);
    // patrol routes for guards
    if (c.occupation === 'guard' || c.occupation === 'captain') p.patrol = [v(96, F, 100), v(110, F, 96), v(96, F, 112), v(96, F, 78), v(84, F, 96), v(140, F, 96), v(96, F, 130)];
    if (c.key === 'hale') p.patrol = [v(168, F, 95), v(160, F, 96)];
    if (c.key === 'brigid') p.patrol = [v(96, F, 158), v(96, F, 130), v(100, F, 100), v(96, F, 78)];
  }
  // ---- Faction leadership (Constitution §36: factions have leaders, not just members)
  watch.leaderId = people.rowan.id; bandits.leaderId = people.skarn.id; village.leaderId = people.godwin.id;
  // Important people remain semantic entities after death even though they have no bodies.
  const historical = [
    { key: 'anna', name: 'Anna Wold', gender: 'f' as const, age: 57, occupation: 'farmer' as const, home: 'house_cedric', work: 'farm_cedric', died: world.now - 200 * SECONDS_PER_DAY, bio: "Cedric Wold's wife. She died of winter fever; her lost wedding ring remains part of the village's history." },
    { key: 'lissa', name: 'Lissa Bramble', gender: 'f' as const, age: 40, occupation: 'baker' as const, home: 'bakery', work: 'bakery', died: world.now - 6 * 365 * SECONDS_PER_DAY, bio: "Osric Bramble's wife and Mara's mother. She died in childbirth." },
    { key: 'tam', name: 'Tam Reed', gender: 'm' as const, age: 39, occupation: 'smith' as const, home: 'hut_tomas', work: 'smithy', died: world.now - 12 * 365 * SECONDS_PER_DAY, bio: "Tomas Reed's father, a smith who died in the great river flood." },
    { key: 'mira', name: 'Mira Reed', gender: 'f' as const, age: 37, occupation: 'farmer' as const, home: 'hut_tomas', work: null, died: world.now - 12 * 365 * SECONDS_PER_DAY, bio: "Tomas Reed's mother, who died with Tam in the great river flood." },
  ];
  for (const h of historical) {
    const person = makePerson(world, { name: h.name, gender: h.gender, age: h.age, occupation: h.occupation, home: places[h.home]?.id, work: h.work ? places[h.work]?.id : null, traits: {}, appearance: {}, bio: h.bio, slug: h.key });
    person.alive = false; person.deathTick = h.died; person.factionId = village.id; person.createdAt = h.died - h.age * 365 * SECONDS_PER_DAY;
    village.members.push(person.id); people[h.key] = person;
  }
  const graveOwners: Record<string, EntityId> = { 'Anna Wold': people.anna.id, 'Lissa Bramble': people.lissa.id, 'Old Tam Reed': people.tam.id, 'Mira Reed': people.mira.id };
  for (const grave of graves) if (grave.label && graveOwners[grave.label]) grave.entityId = graveOwners[grave.label];
  // assign beds
  const bedFor = (key: string, placeKey: string, idx = 0) => { const pl = places[placeKey]; const beds = pl.anchors.filter(a => a.kind === 'bed' && !a.ownerId); if (beds[idx]) beds[idx].ownerId = people[key].id; else { const any = pl.anchors.filter(a => a.kind === 'bed'); if (any[0]) any[0].ownerId ??= people[key].id; } };
  // tavern: build beds for the family now that people exist
  { const pl = places.tavern; const g = grid; const bz = pl.bounds.z1 - 1; const ids = [people.hilda.id, people.bram.id, people.ysolde.id]; let i = 0; for (let x = pl.bounds.x0 + 1; x <= pl.bounds.x1 - 1 && i < ids.length; x += 2) { if (g.get(x, F, bz) !== B.Air) continue; g.set(x, F, bz, B.Bed); pl.anchors.push({ pos: v(x, F, bz), kind: 'bed', ownerId: ids[i++] }); } const bench = pl.anchors.find(a => a.kind === 'bed' && a.label === 'bench'); if (bench) bench.ownerId = people.fenn.id; }
  { const pl = places.bakery; const bz = pl.bounds.z0 + 1; const ids = [people.osric.id, people.mara.id]; let i = 0; for (let x = pl.bounds.x0 + 1; x <= pl.bounds.x1 - 1 && i < ids.length; x += 2) { if (grid.get(x, F, bz) !== B.Air) continue; grid.set(x, F, bz, B.Bed); pl.anchors.push({ pos: v(x, F, bz), kind: 'bed', ownerId: ids[i++] }); } }
  { const pl = places.store; const bz = pl.bounds.z1 - 1; if (grid.get(pl.bounds.x0 + 2, F, bz) === B.Air) { grid.set(pl.bounds.x0 + 2, F, bz, B.Bed); pl.anchors.push({ pos: v(pl.bounds.x0 + 2, F, bz), kind: 'bed', label: 'spare' }); } }
  { const pl = places.chapel; const ex1 = 107, ez0 = 54; for (const [i, key] of [[0, 'aldous'], [1, 'ione']] as [number, string][]) { const bz = ez0 + 1 + i * 2; grid.set(ex1 - 1, F, bz, B.Bed); pl.anchors.push({ pos: v(ex1 - 1, F, bz), kind: 'bed', ownerId: people[key].id }); } }
  { const pl = places.guardhouse; const ids = [people.hale.id, people.dunstan.id, people.brigid.id]; const bz = pl.bounds.z1 - 1 - 4; let i = 0; for (let x = pl.bounds.x0 + 1; x <= pl.bounds.x1 - 1 && i < ids.length; x += 2) { if (grid.get(x, F, 122) !== B.Air) continue; grid.set(x, F, 122, B.Bed); pl.anchors.push({ pos: v(x, F, 122), kind: 'bed', ownerId: ids[i++] }); } void bz; }
  { const pl = places.camp; const beds = pl.anchors.filter(a => a.kind === 'bed'); beds[0] && (beds[0].ownerId = people.skarn.id); beds[1] && (beds[1].ownerId = people.vex.id); }
  { const pl = places.mill; const beds = pl.anchors.filter(a => a.kind === 'bed'); if (!beds.length) { grid.set(pl.bounds.x1 - 1, F, pl.bounds.z0 + 1, B.Bed); pl.anchors.push({ pos: v(pl.bounds.x1 - 1, F, pl.bounds.z0 + 1), kind: 'bed', ownerId: people.hobb.id }); } else beds[0].ownerId = people.hobb.id; }
  bedFor('garrick', 'house_garrick', 0); bedFor('edda', 'house_garrick', 1); bedFor('godwin', 'house_godwin'); bedFor('rowan', 'house_rowan'); bedFor('tomas', 'hut_tomas');
  bedFor('wendel', 'house_wendel', 0); bedFor('petra', 'house_wendel', 1); bedFor('bors', 'house_bors'); bedFor('cedric', 'house_cedric', 0); bedFor('maud', 'house_maud');
  bedFor('jory', 'house_jory', 0); bedFor('nell', 'house_jory', 1); bedFor('tilly', 'house_jory', 2); bedFor('alwin', 'farmhouse_alwin', 0); bedFor('greta', 'farmhouse_alwin', 1); bedFor('pip', 'farmhouse_alwin', 2);
  bedFor('kestrel', 'hut_kestrel'); bedFor('wyn', 'hut_wyn');
  grid.dirtyChunks.clear(); world.nav.rebuildAll();

  // ---- Bodies: spawn everyone where their schedule says they'd be at the current hour
  for (const key of Object.keys(people)) {
    const p = people[key];
    if (!p.alive) continue;
    const b = makeBody(world, p.id, v(96, F, 96), 'humanoid', p.occupation === 'child' ? 40 : p.occupation === 'guard' || p.occupation === 'captain' || p.occupation === 'bandit' ? 110 : 80);
    b.speed = p.occupation === 'child' ? 3.2 : 3.4; p.bodies.push(b.id);
    const home = world.place(p.homeId); const anchor = home?.anchors.find(a => a.kind === 'bed' && a.ownerId === p.id) ?? home?.anchors.find(a => a.kind === 'bed');
    const pos = anchor ? anchor.pos : home?.inside ?? v(96, F, 96);
    b.pos = { x: pos.x + 0.5, y: world.nav.floorY(pos.x, pos.z) >= 0 ? world.nav.floorY(pos.x, pos.z) : pos.y, z: pos.z + 0.5 };
    b.yaw = world.rng.next() * Math.PI * 2;
  }
  // chickens
  for (let i = 0; i < 6; i++) { const c = makeCreature(world, 'chicken', 'chicken', places.farm_alwin.id, people.greta.id); const b = makeBody(world, c.id, v(58 + i * 1.5 + 0.5, F, 94.5 + (i % 2)), 'chicken', 6); b.speed = 1.6; c.bodies.push(b.id); }
  for (let i = 0; i < 3; i++) { const c = makeCreature(world, 'chicken', 'chicken', places.farm_jory.id, people.nell.id); const b = makeBody(world, c.id, v(116.5 + i, F, 140.5 + i), 'chicken', 6); b.speed = 1.6; c.bodies.push(b.id); }

  // ---- Items with provenance
  const yearsAgo = (y: number) => world.now - y * 365 * SECONDS_PER_DAY; const daysAgo = (d: number) => world.now - d * SECONDS_PER_DAY;
  const item = (type: Item['type'], name: string, o: Parameters<typeof makeItem>[3]) => makeItem(world, type, name, o);
  const oath = item('sword', 'Oathkeeper', { owner: people.rowan.id, holder: people.rowan.id, named: true, damage: 30, value: 200, description: 'A long sword with a worn leather grip. Forged by Garrick Ironhand for Captain Rowan after Rowan saved his life on the east road.' });
  oath.provenance.push({ tick: yearsAgo(5), from: null, to: people.garrick.id, how: 'forged by Garrick Ironhand' }, { tick: yearsAgo(5) + 86400 * 20, from: people.garrick.id, to: people.rowan.id, how: 'gift of thanks' });
  const hammer = item('hammer', "Tam Reed's hammer", { owner: people.garrick.id, pos: v(117.5, F, 105.5), placeId: places.smithy.id, named: true, description: "A smith's hammer with a blackened ash handle. Belonged to Tomas's father, Tam Reed; Garrick keeps it on the anvil." });
  hammer.provenance.push({ tick: yearsAgo(30), from: null, to: people.tam.id, how: 'made' }, { tick: yearsAgo(12), from: people.tam.id, to: people.garrick.id, how: "inherited when Tam died; held for Tomas" });
  const ring = item('ring', "Anna's ring", { owner: people.cedric.id, pos: v(places.shrine.inside.x + 1.5, places.shrine.bounds.y0, places.shrine.inside.z - 2.5), placeId: places.shrine.id, named: true, value: 120, description: 'A thin silver band engraved with a wheat sheaf. Anna Wold\'s wedding ring, lost the day she died.' });
  ring.provenance.push({ tick: yearsAgo(30), from: null, to: people.cedric.id, how: 'bought from a travelling silversmith' }, { tick: yearsAgo(30), from: people.cedric.id, to: people.anna.id, how: 'wedding gift' }, { tick: daysAgo(200), from: people.anna.id, to: null, how: 'lost on the northern hill' });
  for (const [who, t, n] of [[people.garrick, 'hammer', 'a heavy hammer'], [people.bors, 'axe', "Bors's axe"], [people.kestrel, 'dagger', 'a hunting knife'], [people.hale, 'sword', 'a watch sword'], [people.brigid, 'sword', 'a watch sword'], [people.dunstan, 'sword', 'a watch sword'], [people.skarn, 'sword', 'a notched sword'], [people.vex, 'dagger', 'a curved knife'], [people.tomas, 'hammer', 'an apprentice hammer']] as [Person, Item['type'], string][]) {
    const it = item(t, n, { owner: who.id, holder: who.id }); it.provenance.push({ tick: yearsAgo(1), from: null, to: who.id, how: 'owned' });
  }
  // v0.4 §5: communal worksite tools — nobody personally owns these, but anyone actually
  // working the quarry/sawpit/construction site can use them in place (core/tools.ts's
  // `bestToolFor`). Whoever the generic labour pool sends to gather stone/build without a
  // personal tool still works far more effectively here than bare-handed elsewhere.
  item('pickaxe', 'the quarry pickaxe', { placeId: places.quarry.id, pos: { ...places.quarry.inside } });
  item('saw', 'the sawpit saw', { placeId: places.sawpit.id, pos: { ...places.sawpit.inside } });
  item('hammer', "the builders' hammer", { placeId: places.shed_site.id, pos: { ...places.shed_site.inside } });
  // shop goods on display
  const display = (placeKey: string, type: Item['type'], name: string, ownerKey: string, n: number, price?: number) => { const pl = places[placeKey]; const spots = pl.anchors.filter(a => a.kind === 'display'); for (let i = 0; i < n; i++) { const a = spots[i % spots.length]; if (!a) break; const it = item(type, name, { owner: people[ownerKey].id, pos: v(a.pos.x + 0.5 + (i % 2) * 0.3 - 0.15, a.pos.y, a.pos.z + 0.5 + (i % 3) * 0.25 - 0.25), placeId: pl.id, value: price }); it.provenance.push({ tick: daysAgo(0.3), from: null, to: people[ownerKey].id, how: 'made' }); } };
  display('bakery', 'bread', ITEM_LABEL.bread, 'osric', 4); display('bakery', 'pie', ITEM_LABEL.pie, 'osric', 1); display('stall_bread', 'bread', ITEM_LABEL.bread, 'osric', 3);
  display('store', 'cheese', ITEM_LABEL.cheese, 'wendel', 2); display('store', 'lantern', ITEM_LABEL.lantern, 'wendel', 1); display('store', 'dagger', 'a plain dagger', 'wendel', 1);
  display('tavern', 'ale', ITEM_LABEL.ale, 'hilda', 3); display('smithy', 'sword', 'a new-forged sword', 'garrick', 1, 90); display('smithy', 'axe', 'a felling axe', 'garrick', 1);
  display('stall_produce', 'wheat', ITEM_LABEL.wheat, 'greta', 2); display('stall_game', 'meat', ITEM_LABEL.meat, 'kestrel', 2); display('camp', 'coins', 'a stolen purse', 'hobb', 1);
  { const purse = world.items().find(i => i.name === 'a stolen purse')!; purse.quantity = 40; purse.provenance.push({ tick: daysAgo(12), from: people.hobb.id, to: people.skarn.id, how: 'stolen on the east road' }); }
  world.items().filter(i => i.name === 'a stolen purse').forEach(i => { i.ownerId = people.hobb.id; });

  // ---- World metabolism (v0.2.4): cultivated fields, starting food-chain stock, household larders.
  createFields(world, [
    { placeId: places.farm_alwin.id, ownerId: people.alwin.id, startMoisture: 0.45 },
    { placeId: places.farm_jory.id, ownerId: people.jory.id, startMoisture: 0.4 },
    { placeId: places.farm_cedric.id, ownerId: people.cedric.id, startMoisture: 0.35 },
    { placeId: places.farm_maud.id, ownerId: people.maud.id, startMoisture: 0.5 },
  ]);
  // Seed a mix so a short run exercises the whole chain without a day-1 harvest frenzy:
  // ~1/3 of the mature plots stay ripe (harvestable now), ~1/3 go fallow (plantable now),
  // ~1/3 advance mid-growth; the plots that started fallow (no wheat block) stay fallow.
  for (const f of world.fields) {
    f.plots.forEach((p, i) => {
      if (p.state !== 'mature') return;
      const bucket = i % 3;
      if (bucket === 0) { p.state = 'fallow'; p.growth = 0; p.plantedAt = 0; }
      else if (bucket === 1) { p.state = 'growing'; p.growth = 0.35 + (i % 4) * 0.1; p.plantedAt = world.now - 70 * 3600; }
      world.grid.set(p.x, p.y, p.z, cropBlockFor(p.state));
    });
  }
  // Starting food-chain stock so the mill/bakery are not cold on day 1.
  const stock = (type: Item['type'], name: string, placeKey: string, ownerKey: string, qty: number) => {
    const pl = places[placeKey]; const it = makeItem(world, type, name, { owner: people[ownerKey].id, pos: v(pl.inside.x + 0.5, pl.inside.y, pl.inside.z + 0.5), placeId: pl.id, quantity: qty });
    it.provenance.push({ tick: daysAgo(2), from: null, to: people[ownerKey].id, how: 'in store' });
  };
  // v0.3: production inputs must now be physically local (transform() no longer reaches across
  // the village), and hauling moves them there — so the mill/bakery start with only a working
  // day's stock, farms start with grain to be carried, and the haul chain does the rest.
  stock('grain', 'sack of grain', 'mill', 'hobb', 24);
  stock('flour', 'sack of flour', 'mill', 'hobb', 6);
  stock('flour', 'sack of flour', 'bakery', 'osric', 28);
  stock('bread', 'fresh loaves', 'bakery', 'osric', 40);
  stock('bread', 'loaves for sale', 'stall_bread', 'osric', 14);
  stock('grain', 'sack of grain', 'farm_alwin', 'alwin', 40);
  stock('grain', 'sack of grain', 'farm_jory', 'jory', 34);
  stock('grain', 'sack of grain', 'farm_maud', 'maud', 26);
  stock('grain', 'sack of grain', 'farm_cedric', 'cedric', 22);
  // A week's larder in every household (all residents can eat it), so nobody starves before the
  // production chain settles — and a larder for the miller/baker at their own workplace-homes.
  const seenHome = new Set<string>();
  for (const key of Object.keys(people)) {
    const p = people[key]; if (!p.alive || !p.homeId || p.occupation === 'bandit') continue;
    if (seenHome.has(p.homeId)) continue; seenHome.add(p.homeId);
    const home = world.place(p.homeId); if (!home) continue;
    const larderOwner = home.residents[0] ?? p.id;
    const it = makeItem(world, 'bread', ITEM_LABEL.bread, { owner: larderOwner, pos: v(home.inside.x + 0.5, home.inside.y, home.inside.z - 0.5), placeId: home.id, quantity: 12 });
    it.provenance.push({ tick: daysAgo(1), from: null, to: larderOwner, how: 'household larder' });
    const ch = makeItem(world, 'cheese', ITEM_LABEL.cheese, { owner: larderOwner, pos: v(home.inside.x - 0.5, home.inside.y, home.inside.z - 0.5), placeId: home.id, quantity: 6 });
    ch.provenance.push({ tick: daysAgo(1), from: null, to: larderOwner, how: 'household larder' });
  }

  // ---- World logistics, materials & construction (v0.3 Living World I)
  // Trees near the woodcutter's clearing become canonical timber; a stone outcrop is quarried.
  plantGrove(world, { x0: 96, z0: 130, x1: 120, z1: 148 }, places.clearing.id, places.clearing.id, 14,
    [places.sawpit.bounds, places.farm_jory.bounds, places.house_jory.bounds]);
  registerStoneNodes(world, places.quarry.id, [v(70, 25, 24), v(74, 25, 27), v(72, 25, 30)]);
  // One authored construction project (Constitution §67 — authored starting condition; its
  // *fulfilment* is entirely emergent). The structure is NOT built now: materials must be
  // chopped/sawn/quarried, hauled here, and worked before the shed becomes real.
  createConstructionProject(world, {
    name: 'the village storage shed', template: 'storage_shed',
    siteBounds: { x0: 126, z0: 152, x1: 133, z1: 159, y0: F, y1: F + 4 },
    sitePlaceId: places.shed_site.id,
    required: [{ type: 'plank', quantity: 16 }, { type: 'stone', quantity: 8 }],
    ownerId: people.godwin.id, laborRequired: 3 * 3600,
  });

  // ---- Player
  const player = makePerson(world, { name: 'the Traveler', gender: 'm', age: 28, occupation: 'traveler', traits: { courage: 0.7 }, appearance: { skin: 0xd9a988, hair: 0x2a1a10, shirt: 0x3a5a7a, pants: 0x3a3a3a, hatStyle: 'hood', hat: 0x3a4a5a }, bio: 'A stranger who walked in on the west road.' , wealth: 25 });
  player.controlled = true; player.factionId = null; world.playerId = player.id;
  const pb = makeBody(world, player.id, v(40.5, F, 96.5), 'humanoid', 100); pb.speed = 4.6; player.bodies.push(pb.id);
  item('dagger', 'a travel-worn dagger', { owner: player.id, holder: player.id, description: 'Your own knife. It has been with you a long time.' });
  item('bread', ITEM_LABEL.bread, { owner: player.id, holder: player.id, quantity: 2 });
  item('coins', 'silver coins', { owner: player.id, holder: player.id, quantity: 25 });

  seedHistory(world, people, places);
  return { places, people };
}

/** The world existed before the player. Seed relationships, memories, knowledge and events with a past. */
function seedHistory(world: World, pp: Record<string, Person>, pl: Record<string, Place>): void {
  const daysAgo = (d: number) => world.now - d * SECONDS_PER_DAY; const yearsAgo = (y: number) => daysAgo(y * 365);
  const rel = (a: Person, b: Person, d: Parameters<typeof adjustRel>[3], ...tags: string[]) => { adjustRel(world, a, b.id, d, 'history', undefined, true); if (tags.length) setRelTags(a, b.id, ...tags); };
  const both = (a: Person, b: Person, d: Parameters<typeof adjustRel>[3], ...tags: string[]) => { rel(a, b, d, ...tags); rel(b, a, d, ...tags); };
  const everyone = Object.values(pp).filter(p => p.alive && !p.hostile);
  // baseline familiarity: villagers know each other
  for (const a of everyone) for (const b of everyone) if (a !== b) { const r = getRel(a, b.id); r.familiarity = 0.6 + world.rng.next() * 0.3; r.trust = 0.1 + world.rng.next() * 0.2; r.affection = world.rng.next() * 0.2; r.respect = 0.05 + world.rng.next() * 0.15; }
  for (const a of everyone) { rel(a, pp.godwin, { respect: 0.5, trust: 0.3 }); rel(a, pp.rowan, { respect: 0.35, trust: 0.25 }); rel(a, pp.aldous, { respect: 0.3, trust: 0.3 }); rel(a, pp.skarn, { fear: 0.3, grudge: 0.2 }); rel(a, pp.vex, { fear: 0.25, grudge: 0.15 }); getRel(a, pp.skarn.id).familiarity = 0.2; getRel(a, pp.vex.id).familiarity = 0.15; }
  // families
  both(pp.garrick, pp.edda, { affection: 0.7, trust: 0.7 }, 'spouse'); both(pp.hilda, pp.bram, { affection: 0.6, trust: 0.7 }, 'spouse'); both(pp.wendel, pp.petra, { affection: 0.4, trust: 0.6 }, 'spouse');
  both(pp.alwin, pp.greta, { affection: 0.7, trust: 0.8 }, 'spouse'); both(pp.jory, pp.nell, { affection: 0.6, trust: 0.7 }, 'spouse');
  const parent = (c: Person, ...ps: Person[]) => { for (const p of ps) { rel(c, p, { affection: 0.8, trust: 0.9, respect: 0.4 }, 'parent'); rel(p, c, { affection: 0.9, trust: 0.6 }, 'child'); } };
  parent(pp.ysolde, pp.hilda, pp.bram); parent(pp.pip, pp.alwin, pp.greta); parent(pp.tilly, pp.jory, pp.nell); parent(pp.mara, pp.osric); parent(pp.nell, pp.maud);
  both(pp.cedric, pp.anna, { affection: 0.9, trust: 0.9 }, 'spouse');
  both(pp.osric, pp.lissa, { affection: 0.8, trust: 0.8 }, 'spouse');
  parent(pp.mara, pp.lissa); parent(pp.tomas, pp.tam, pp.mira);
  rel(pp.maud, pp.tilly, { affection: 0.8 }, 'grandchild'); rel(pp.tilly, pp.maud, { affection: 0.6, trust: 0.7 }, 'grandparent');
  both(pp.pip, pp.tilly, { affection: 0.8, trust: 0.8 }, 'friend');
  rel(pp.garrick, pp.tomas, { affection: 0.6, trust: 0.6, respect: 0.2 }, 'foster', 'employer'); rel(pp.tomas, pp.garrick, { affection: 0.7, trust: 0.8, respect: 0.8 }, 'foster', 'employee');
  rel(pp.edda, pp.tomas, { affection: 0.6, trust: 0.5 }, 'foster');
  both(pp.tomas, pp.mara, { affection: 0.9, trust: 0.8 }, 'sweetheart');
  rel(pp.osric, pp.tomas, { affection: -0.3, respect: -0.4, trust: -0.1 }); rel(pp.tomas, pp.osric, { fear: 0.2, respect: 0.2 });
  rel(pp.hale, pp.ysolde, { affection: 0.7 }); rel(pp.ysolde, pp.hale, { affection: 0.25, trust: 0.3 });
  both(pp.garrick, pp.rowan, { affection: 0.5, trust: 0.9, respect: 0.8 }, 'friend'); rel(pp.garrick, pp.rowan, { respect: 0.2 });
  both(pp.garrick, pp.bors, { affection: -0.5, grudge: 0.6, trust: -0.5 }, 'rival');
  rel(pp.fenn, pp.wendel, { fear: 0.4, affection: -0.3 }, 'debtor'); rel(pp.wendel, pp.fenn, { grudge: 0.5, trust: -0.7, affection: -0.4 }, 'creditor');
  rel(pp.rowan, pp.fenn, { affection: 0.3, trust: 0.2 }, 'old comrade'); rel(pp.fenn, pp.rowan, { affection: 0.5, respect: 0.7, trust: 0.6 }, 'old comrade');
  rel(pp.hilda, pp.dunstan, { affection: -0.3, respect: -0.3 }); rel(pp.dunstan, pp.hilda, { fear: 0.15 });
  both(pp.kestrel, pp.wyn, { affection: 0.5, trust: 0.6 }, 'friend');
  rel(pp.petra, pp.wyn, { fear: 0.4, affection: -0.5, trust: -0.6 }); rel(pp.pip, pp.wyn, { fear: 0.6 }); rel(pp.greta, pp.wyn, { fear: 0.2, trust: -0.2 });
  both(pp.skarn, pp.vex, { affection: 0.4, trust: 0.6 }, 'partner');
  rel(pp.hobb, pp.skarn, { fear: 0.7, grudge: 0.9, affection: -0.8 }); rel(pp.hobb, pp.vex, { fear: 0.7, grudge: 0.8, affection: -0.8 });
  for (const g of [pp.hale, pp.dunstan, pp.brigid]) { rel(g, pp.rowan, { respect: 0.7, trust: 0.7 }, 'captain'); rel(pp.rowan, g, { trust: 0.6, respect: 0.3 }, 'subordinate'); }
  both(pp.hilda, pp.edda, { affection: 0.5, trust: 0.4 }, 'friend', 'employer'); both(pp.edda, pp.petra, { affection: 0.4, trust: 0.3 }, 'friend');
  both(pp.cedric, pp.aldous, { affection: 0.5, trust: 0.7 }, 'friend'); both(pp.jory, pp.bors, { affection: 0.4, trust: 0.3 }, 'friend');
  both(pp.greta, pp.nell, { affection: 0.5, trust: 0.5 }, 'friend'); both(pp.mara, pp.ysolde, { affection: 0.6, trust: 0.6 }, 'friend');
  both(pp.godwin, pp.aldous, { affection: 0.5, trust: 0.7 }, 'friend'); both(pp.hobb, pp.alwin, { affection: 0.3, trust: 0.4 }, 'friend');

  // history events, with memories and knowledge for those who lived them
  const H = (type: Parameters<typeof world.emit>[0], tick: number, o: NonNullable<Parameters<typeof world.emit>[1]>, witnesses: Person[], significance: number, valence: number, told: Person[] = [], tellerOf: Person | null = null) => {
    const e = world.emit(type, { ...o, tick, significance, category: 'history' });
    for (const w of witnesses) { remember(world, w, { type, summary: e.summary!, eventId: e.id, entities: [e.actor, e.target].filter(Boolean) as string[], significance, valence: w.id === e.target ? valence : valence * 0.6, source: { type: 'witnessed' }, tick }, true); learn(world, w, { key: `ev:${e.id}`, kind: 'event', claim: { eventId: e.id, type, tick, actor: e.actor, target: e.target, item: e.item, placeId: e.placeId, amount: o.data?.amount, about: o.data?.about, text: o.data?.text, significance }, confidence: 1, source: { type: 'witnessed', viaEvent: e.id } }, true); }
    for (const t of told) { const src = tellerOf ?? witnesses[0]; learn(world, t, { key: `ev:${e.id}`, kind: 'event', claim: { eventId: e.id, type, tick, actor: e.actor, target: e.target, item: e.item, placeId: e.placeId, amount: o.data?.amount, about: o.data?.about, text: o.data?.text, significance }, confidence: 0.7, source: { type: 'told', from: src?.id }, hops: 1 }, true); remember(world, t, { type: 'told', summary: `${src?.name ?? 'someone'} told me: ${e.summary}`, eventId: e.id, entities: [e.actor, e.target].filter(Boolean) as string[], significance: significance * 0.6, valence: valence * 0.3, source: { type: 'told', from: src?.id }, tick: tick + 86400 }, true); if (src) { const k = src.knowledge[`ev:${e.id}`]; if (k) k.sharedWith.push(t.id); } }
    return e;
  };
  const all = everyone;
  H('marriage', yearsAgo(22), { actor: pp.garrick.id, target: pp.edda.id, placeId: pl.chapel.id, summary: 'Garrick Ironhand married Edda at the chapel' }, [pp.garrick, pp.edda, pp.aldous, pp.godwin], 0.6, 0.8);
  H('marriage', yearsAgo(31), { actor: pp.cedric.id, target: pp.anna.id, placeId: pl.chapel.id, data: { text: 'Cedric Wold married Anna Wold' }, summary: 'Cedric Wold married Anna Wold at the chapel' }, [pp.cedric, pp.anna, pp.godwin, pp.aldous], 0.6, 0.9);
  H('death', daysAgo(200), { target: pp.anna.id, placeId: pl.house_cedric.id, data: { text: 'Anna Wold died of the winter fever' }, summary: 'Anna Wold died of the winter fever' }, [pp.anna, pp.cedric, pp.aldous, pp.ione, pp.wyn], 0.9, -0.9, all.filter(p => ![pp.cedric, pp.aldous, pp.ione, pp.wyn].includes(p)), pp.aldous);
  H('death', yearsAgo(6), { target: pp.lissa.id, placeId: pl.bakery.id, data: { text: 'Lissa Bramble, the baker\'s wife, died in childbirth' }, summary: "Lissa Bramble, the baker's wife, died" }, [pp.lissa, pp.osric, pp.mara, pp.aldous, pp.edda], 0.8, -0.9, [pp.hilda, pp.godwin, pp.greta, pp.petra], pp.edda);
  const flood = world.emit('weather', { tick: yearsAgo(12), placeId: pl.mill.id, significance: 0.8, category: 'history', data: { kind: 'flood' }, summary: 'The river flooded through Ashford Vale' });
  H('death', yearsAgo(12), { target: pp.tam.id, placeId: pl.mill.id, causes: [flood.id], data: { text: "Tam Reed drowned when the river flooded" }, summary: "Tam Reed drowned in the flood" }, [pp.tam, pp.garrick, pp.edda, pp.tomas, pp.godwin, pp.hobb], 0.8, -0.8, [pp.rowan, pp.hilda, pp.osric, pp.aldous], pp.godwin);
  H('death', yearsAgo(12), { target: pp.mira.id, placeId: pl.mill.id, causes: [flood.id], data: { text: "Mira Reed drowned when the river flooded" }, summary: "Mira Reed drowned in the flood; Garrick took in her boy Tomas" }, [pp.mira, pp.garrick, pp.edda, pp.tomas, pp.godwin, pp.hobb], 0.8, -0.8, [pp.rowan, pp.hilda, pp.osric, pp.aldous], pp.godwin);
  const ambush = H('attack', yearsAgo(5), { actor: pp.skarn.id, target: pp.garrick.id, placeId: pl.gate_east.id, data: { text: 'bandits ambushed Garrick on the east road; Rowan drove them off' }, summary: 'Bandits ambushed Garrick on the east road; Captain Rowan drove them off and was wounded' }, [pp.garrick, pp.rowan, pp.skarn], 0.8, -0.6, [pp.edda, pp.godwin, pp.hale, pp.brigid, pp.dunstan, pp.hilda, pp.fenn, pp.tomas], pp.garrick);
  H('gift', yearsAgo(5) + 20 * 86400, { actor: pp.garrick.id, target: pp.rowan.id, item: world.items().find(i => i.name === 'Oathkeeper')!.id, placeId: pl.smithy.id, causes: [ambush.id], summary: 'Garrick forged the sword Oathkeeper and gave it to Rowan in thanks' }, [pp.garrick, pp.rowan, pp.edda, pp.tomas], 0.6, 0.8, [pp.godwin, pp.hilda, pp.hale, pp.brigid], pp.edda);
  H('dispute', daysAgo(120), { actor: pp.garrick.id, target: pp.bors.id, placeId: pl.tavern.id, data: { about: 'the price of charcoal timber' }, summary: 'Garrick and Bors came to blows at the Boar over the price of charcoal timber; Bram threw Bors out' }, [pp.garrick, pp.bors, pp.hilda, pp.bram, pp.jory, pp.fenn, pp.hobb], 0.6, -0.5, [pp.edda, pp.tomas, pp.rowan, pp.godwin, pp.ysolde, pp.wendel], pp.hilda);
  const debt = H('debt', daysAgo(40), { actor: pp.fenn.id, target: pp.wendel.id, placeId: pl.store.id, data: { amount: 20 }, summary: 'Fenn Muddle borrowed twenty silver from Wendel Crane and has not repaid it' }, [pp.fenn, pp.wendel, pp.petra], 0.5, -0.3, [pp.hilda, pp.edda, pp.ysolde, pp.bram, pp.godwin, pp.rowan], pp.petra);
  pp.wendel.desires.push({ type: 'collect_debt', targetId: pp.fenn.id, note: 'Fenn Muddle owes me twenty silver. I want it back.', reward: 5, fulfilled: false });
  const robbery = H('theft', daysAgo(12), { actor: pp.skarn.id, target: pp.hobb.id, item: world.items().find(i => i.name === 'a stolen purse')!.id, placeId: pl.gate_east.id, data: { text: 'Skarn and Vex robbed Hobb on the east road' }, summary: 'Skarn and Vex robbed Hobb the miller of forty silver on the east road' }, [pp.hobb, pp.skarn, pp.vex], 0.7, -0.7, [pp.rowan, pp.hale, pp.brigid, pp.dunstan, pp.hilda, pp.bram, pp.alwin, pp.godwin, pp.wendel, pp.edda, pp.jory, pp.bors], pp.hobb);
  for (const g of [pp.rowan, pp.hale, pp.brigid, pp.dunstan]) { const k = g.knowledge[`ev:${robbery.id}`]; if (k) k.handled = true; }
  H('threat_spotted', daysAgo(6), { actor: pp.skarn.id, placeId: pl.camp.id, pos: pl.camp.inside, data: { text: 'Kestrel found the bandit camp in the north-east forest' }, summary: 'Kestrel found the bandit camp in the north-east forest' }, [pp.kestrel], 0.6, -0.4, [pp.rowan, pp.wyn], pp.kestrel);
  for (const p of [pp.kestrel, pp.rowan, pp.wyn, pp.skarn, pp.vex]) learn(world, p, { key: `loc:${pl.camp.id}`, kind: 'location', claim: { entityId: pl.camp.id, pos: pl.camp.inside, placeId: pl.camp.id }, confidence: p === pp.rowan ? 0.7 : 1, source: p === pp.rowan ? { type: 'told', from: pp.kestrel.id } : { type: 'witnessed' }, hops: p === pp.rowan ? 1 : 0 }, true);
  const rumor = H('rumor', daysAgo(30), { actor: pp.petra.id, target: pp.wyn.id, placeId: pl.store.id, data: { text: 'Old Wyn cursed the Cranes\' hens so they stopped laying' }, summary: 'Petra Crane says Old Wyn cursed her hens' }, [pp.petra], 0.4, -0.3, [pp.edda, pp.greta, pp.pip, pp.hilda, pp.ysolde, pp.nell, pp.maud, pp.osric], pp.petra);
  for (const p of [pp.edda, pp.greta, pp.pip, pp.hilda, pp.ysolde, pp.nell, pp.osric]) { const k = p.knowledge[`ev:${rumor.id}`]; if (k) k.confidence = 0.35 + world.rng.next() * 0.3; }
  { const k = pp.maud.knowledge[`ev:${rumor.id}`]; if (k) k.confidence = 0.1; }
  H('rumor', daysAgo(3), { actor: pp.ysolde.id, target: pp.hale.id, placeId: pl.tavern.id, data: { text: 'Hale Dorn is sweet on Ysolde and everyone but Bram has noticed' }, summary: 'Word around the Boar is that Hale is sweet on Ysolde' }, [pp.ysolde, pp.mara], 0.3, 0.3, [pp.edda, pp.hilda, pp.tomas, pp.greta], pp.mara);
  H('rumor', daysAgo(2), { actor: pp.wendel.id, placeId: pl.store.id, data: { text: 'Wendel Crane has raised the price of candles again' }, summary: 'Wendel raised his prices again; the village grumbles' }, [pp.wendel, pp.petra, pp.edda, pp.greta], 0.25, -0.2, [pp.hilda, pp.maud, pp.alwin, pp.nell, pp.godwin], pp.greta);
  H('dispute', daysAgo(9), { actor: pp.osric.id, target: pp.tomas.id, placeId: pl.bakery.id, data: { about: 'Mara' }, summary: 'Osric told Tomas to stay away from Mara; Tomas left the bakery red-faced' }, [pp.osric, pp.tomas, pp.mara], 0.5, -0.5, [pp.ysolde, pp.edda, pp.garrick, pp.hilda], pp.mara);
  H('heal', daysAgo(15), { actor: pp.wyn.id, target: pp.kestrel.id, placeId: pl.hut_wyn.id, summary: 'Old Wyn stitched a boar-tusk wound in Kestrel\'s leg' }, [pp.wyn, pp.kestrel], 0.4, 0.5, [pp.ione], pp.kestrel);
  H('weather', daysAgo(4), { placeId: pl.farm_alwin.id, data: { text: 'A storm flattened the Hollis fence' }, summary: 'A night storm flattened part of the Hollis fence' }, [pp.alwin, pp.greta, pp.pip], 0.3, -0.2, [pp.hobb, pp.nell, pp.jory], pp.alwin);
  H('mourning', daysAgo(1), { actor: pp.cedric.id, placeId: pl.graveyard.id, summary: 'Cedric sat by Anna\'s grave until dark, as he does every evening' }, [pp.cedric, pp.ione], 0.3, -0.4, [pp.aldous], pp.ione);
  // Wyn knows where Anna's ring is; Cedric wants it back
  const ring = world.items().find(i => i.name === "Anna's ring")!;
  learn(world, pp.wyn, { key: `loc:${ring.id}`, kind: 'location', claim: { entityId: ring.id, pos: ring.pos, placeId: pl.shrine.id }, confidence: 0.9, source: { type: 'witnessed' } }, true);
  remember(world, pp.wyn, { type: 'observed', summary: 'I saw a silver ring lying among the stones of the old shrine, and left it for the spirits', entities: [ring.id], significance: 0.4, valence: 0.1, source: { type: 'witnessed' }, tick: daysAgo(20) }, true);
  pp.cedric.desires.push({ type: 'recover_item', targetId: ring.id, note: "Anna's ring was lost the day she died. I would give anything to have it back.", reward: 30, fulfilled: false });
  for (const p of all) learn(world, p, { key: `owner:${ring.id}`, kind: 'ownership', claim: { itemId: ring.id, ownerId: pp.cedric.id }, confidence: 0.8, source: { type: 'prior' } }, true);
  // ownership knowledge of important items
  const hammerIt = world.items().find(i => i.name === "Tam Reed's hammer")!; const oathIt = world.items().find(i => i.name === 'Oathkeeper')!;
  for (const p of all) { learn(world, p, { key: `owner:${oathIt.id}`, kind: 'ownership', claim: { itemId: oathIt.id, ownerId: pp.rowan.id }, confidence: 1, source: { type: 'prior' } }, true); }
  for (const p of [pp.garrick, pp.tomas, pp.edda, pp.rowan, pp.godwin, pp.hobb, pp.bors]) learn(world, p, { key: `owner:${hammerIt.id}`, kind: 'ownership', claim: { itemId: hammerIt.id, ownerId: pp.garrick.id }, confidence: 1, source: { type: 'prior' } }, true);
  // everyone knows where the important places are and who lives/works where
  for (const p of all) for (const q of all) if (p !== q && q.homeId) learn(world, p, { key: `home:${q.id}`, kind: 'fact', claim: { text: `${q.name} lives at ${world.nameOf(q.homeId)}`, entityId: q.id, placeId: q.homeId }, confidence: 0.9, source: { type: 'prior' } }, true);
  // v0.6 §III.1: existing role/home knowledge — the third acquisition path, seeded at
  // generation rather than learned through play. A settlement this size (33 people) plausibly
  // has everyone knowing its handful of central services (the bakery, the well/river bank, the
  // tavern, the store) exactly as everyone already knows everyone else's home above; a farmer
  // additionally knows their own assigned field. Deliberately NOT seeded: the sawpit, quarry,
  // mill, or any resource node/haul-task opportunity — those remain genuinely learned through
  // direct observation or economic encounter (mind/knowledge.ts's `learnPlace`), which is what
  // makes a deliberately knowledge-sparse person (tests/knowledge-memory-skills-intent.test.ts)
  // behave differently from an ordinary villager instead of everyone being uniformly omniscient.
  const commonServices = [pl.bakery, pl.well, pl.riverbank, pl.tavern, pl.store].filter((x): x is Place => !!x);
  for (const p of all) for (const place of commonServices) learnPlace(world, p, place, { type: 'prior' });
  const farmOf: Record<string, string> = { alwin: 'farm_alwin', jory: 'farm_jory', cedric: 'farm_cedric', maud: 'farm_maud' };
  for (const [key, farmKey] of Object.entries(farmOf)) { const farmer = pp[key]; const field = pl[farmKey]; if (farmer && field) learnPlace(world, farmer, field, { type: 'prior' }); }
  // emotional residue
  pp.cedric.emotions.sadness = 0.6; pp.hobb.emotions.anger = 0.4; pp.fenn.emotions.stress = 0.4; pp.tomas.emotions.stress = 0.3; pp.osric.emotions.anger = 0.2;
  world.events.forEach(e => { if (e.category === 'history') e.summary = e.summary; });
}
