import { buildMaze, type Maze } from '../../../sim/world/interiors/maze';
export { buildMaze, type Maze, type MazeRoom } from '../../../sim/world/interiors/maze';
import { mulberry } from '../../render/noise';
import type { FoeKind } from '../combat';
import { TIERS, type Element, type Tier } from './capability';
import { towerEncounter } from '../../../sim/progression/towerEncounters';

/**
 * Procedural floors for the Tower of Chrysanthus. Deterministic per (run seed, floor).
 *   every floor:   connected rooms and maze corridors, furniture and guarded detours
 *   every 5th:     a named boss guards the stair
 *   every 10th:    a god's shrine and its champion; beating the champion lets you claim a boon
 *   floor 100:     the summit deity
 * The playable area grows every 25 floors. Each tier band (Constitution §13 names) has its own look.
 */
export interface Theme { tier: Tier; name: string; floor: string; line: string; wall: [number, number, number]; light: [number, number, number]; fog: number }
export const THEMES: Theme[] = [
  { tier: 'Normal', name: 'The Root Cellars', floor: '#cfc8bc', line: '#bdb4a6', wall: [.62, .56, .48], light: [1, .95, .86], fog: 0 },
  { tier: 'Iron', name: 'The Iron Halls', floor: '#b9bec4', line: '#a6acb3', wall: [.46, .49, .53], light: [.9, .95, 1], fog: 0 },
  { tier: 'Bronze', name: 'The Bronze Galleries', floor: '#c9b08e', line: '#b59a76', wall: [.55, .38, .22], light: [1, .86, .66], fog: 0 },
  { tier: 'Silver', name: 'The Silver Cloisters', floor: '#d9dde3', line: '#c6ccd4', wall: [.72, .75, .8], light: [.88, .92, 1], fog: 0 },
  { tier: 'Gold', name: 'The Gilded Courts', floor: '#d8c389', line: '#c6ad6a', wall: [.7, .56, .24], light: [1, .92, .7], fog: 0 },
  { tier: 'Diamond', name: 'The Crystal Spires', floor: '#c9e3ea', line: '#addbe6', wall: [.55, .78, .86], light: [.82, .95, 1], fog: 0 },
  { tier: 'God', name: 'The Threshold of Chrysanthus', floor: '#e4d6ea', line: '#d2bedb', wall: [.82, .7, .86], light: [1, .9, 1], fog: 0 },
];
export const themeFor = (floor: number) => THEMES[Math.min(6, Math.floor((floor - 1) / 15))];
export const halfSizeFor = (floor: number) => 24 + 6 * Math.floor(floor / 25);

export interface God { name: string; domain: Element; title: string }
export const GODS: God[] = [
  { name: 'Pyrrhos', domain: 'flame', title: 'the Ember Throne' }, { name: 'Isveld', domain: 'frost', title: 'of the Long Winter' },
  { name: 'Thalor', domain: 'storm', title: 'Who Splits the Sky' }, { name: 'Ysra', domain: 'swift', title: 'the Unheld Wind' },
  { name: 'Ankh-Varro', domain: 'iron', title: 'the Unbowed' }, { name: 'Nyx-Sel', domain: 'shadow', title: 'the Quiet Knife' },
  { name: 'Maelith', domain: 'verdance', title: 'of Green Return' },
];

/** hall: floor 0, the Proving Hall (every magic to try, training dummies). avatar: floor 10, Chrysanthus's first trial. */
export type FloorKind = 'battle' | 'boss' | 'shrine' | 'summit' | 'hall' | 'avatar';
export interface Wall { x: number; z: number; len: number; yaw: number }
export interface FloorPlan {
  floor: number; seed: number; half: number; theme: Theme; kind: FloorKind;
  walls: Wall[];
  /** Height of the floor's maze walls (world units; the perimeter is taller). */
  wallHeight: number;
  /** The cell maze behind the walls (null on open floors): rooms, corridors and which cell edges are open. */
  maze: Maze | null;
  props: { key: string; x: number; z: number; yaw: number }[];
  chests: { x: number; z: number; yaw: number }[];
  foes: { kind: FoeKind; x: number; z: number }[];
  faction?: 'greenskin' | 'undead' | 'raider';
  boss?: { kind: FoeKind; name: string; x: number; z: number; hpMul: number; dmgMul: number; scale: number };
  god?: God; shrine?: { x: number; z: number };
  start: { x: number; z: number }; exit: { x: number; z: number };
  objective: string;
  /** The element whose mana runs strong on this floor (null on the first floors and in the hall). */
  ley: Element | null;
}

const BOSS_FIRST = ['Gorrak', 'Velma', 'Draun', 'Isolde', 'Mordecai', 'Hask', 'Brynja', 'Oren', 'Sable', 'Teodric', 'Ulla', 'Corvin'];
const BOSS_EPITHET: Record<Tier, string[]> = {
  Normal: ['the Cellar King', 'Rat-Tamer', 'the Bent Nail'], Iron: ['the Iron-Willed', 'Anvil-Born', 'of the Black Forge'],
  Bronze: ['the Bronze Bell', 'Lantern-Eater', 'of the Hollow Gallery'], Silver: ['the Silvered', 'Moon-Sworn', 'of the Pale Choir'],
  Gold: ['the Gilded Tyrant', 'Sun-Crowned', 'of the Golden Court'], Diamond: ['the Unbreaking', 'Glass-Saint', 'of the Spires'],
  God: ['Herald of Chrysanthus', 'the Last Door', 'Who Waits Above'],
};

export function planFloor(runSeed: number, floor: number): FloorPlan {
  const rnd = mulberry((runSeed * 7919 + floor * 104729) >>> 0);
  const half = halfSizeFor(floor), theme = themeFor(floor);
  if (floor <= 0) return provingHall(runSeed);
  const kind: FloorKind = floor >= 100 ? 'summit' : floor === 10 ? 'avatar' : floor % 10 === 0 ? 'shrine' : floor % 5 === 0 ? 'boss' : 'battle';
  const start = { x: 0, z: half - 4 }, exit = { x: 0, z: -half + 2.5 };
  const walls: Wall[] = [], props: FloorPlan['props'] = [], chests: FloorPlan['chests'] = [];
  // A connected maze of rooms and corridors (see buildMaze), on its own random stream so the rest of the plan does not
  // depend on how many draws the layout took. Props keep clear of every open edge (doorways) and of the cell centres
  // corridors run through: storage sits in room corners, a table set in the middle of larger rooms.
  const big = kind === 'boss' || kind === 'shrine' || kind === 'summit';
  const maze = kind === 'avatar' ? null : buildMaze(mulberry((runSeed * 31337 + floor * 7349) >>> 0), half, big ? [-half * .52, -half * .2] : null);
  if (maze) {
    walls.push(...maze.walls);
    maze.rooms.forEach((r, k) => {
      if (r.role !== 'room') return;
      const x0 = maze.x(r.i0) - maze.cell / 2, x1 = maze.x(r.i0 + r.w - 1) + maze.cell / 2, z0 = maze.z(r.j0) - maze.cell / 2, z1 = maze.z(r.j0 + r.d - 1) + maze.cell / 2;
      const corners = [[x0 + 1.4, z0 + 1.4], [x1 - 1.4, z0 + 1.4], [x0 + 1.4, z1 - 1.4], [x1 - 1.4, z1 - 1.4]];
      const set = rnd() < .5 ? ['barrel', 'barrel_small', 'keg'] : rnd() < .5 ? ['crate', 'crate_small', 'stool'] : ['pot', 'jar', 'pot'];
      const used = new Set<number>();
      corners.forEach(([cx, cz], c) => { if (rnd() < .55 && maze.cornerClosed(cx, cz)) { used.add(c); for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) props.push({ key: set[Math.floor(rnd() * set.length)], x: cx + (rnd() - .5) * .9, z: cz + (rnd() - .5) * .9, yaw: rnd() * 6 }); } });
      if (r.w * r.d >= 6 && rnd() < .5) {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; props.push({ key: 'table', x: cx, z: cz, yaw: rnd() < .5 ? 0 : Math.PI / 2 });
        for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) if (rnd() < .7) props.push({ key: 'chair', x: cx + dx, z: cz + dz, yaw: Math.atan2(-dx, -dz) });
      }
      // A chest gets a corner of its own (a storage cluster around it boxed it in).
      const free = [0, 1, 2, 3].map(c => (c + k) % 4).find(c => !used.has(c) && maze.cornerClosed(corners[c][0], corners[c][1]));
      if (free !== undefined && rnd() < .45) chests.push({ x: corners[free][0], z: corners[free][1], yaw: rnd() * 6 });
    });
    // Dead ends reward the detour.
    for (const c of maze.deadEnds) if (chests.length < 6 && rnd() < .5) chests.push({ x: maze.x(c.i), z: maze.z(c.j), yaw: rnd() * 6 });
  }
  // Enemies: count and mix scale with the floor.
  const foes: FloorPlan['foes'] = [];
  const count = kind === 'avatar' ? 0 : kind === 'shrine' || kind === 'summit' ? 3 + Math.floor(floor / 15) : towerEncounter(floor).enemies;
  // Each floor belongs to a faction (greenskins, the dead, raiders); a fifth of its foes are drawn from the others.
  const faction = floorFaction(floor, rnd);
  for (let i = 0; i < count; i++) {
    const own = rnd() < .8, f = own ? faction : (['greenskin', 'undead', 'raider'] as Faction[])[Math.floor(rnd() * 3)];
    const p = towerEncounter(floor);
    const choice = floor >= 5 && i === 0 ? p.rangedShare * .5 : floor >= 8 && i === 1 ? p.rangedShare + p.heavyShare * .5 : rnd();
    const k = rollFoe(f, floor, choice);
    let x = 0, z = 0;
    for (let t = 0; t < 20; t++) {
      if (maze) { const c = maze.cells[Math.floor(rnd() * maze.cells.length)]; x = maze.x(c.i) + (rnd() - .5) * maze.cell * .4; z = maze.z(c.j) + (rnd() - .5) * maze.cell * .4; }
      else { x = (rnd() * 2 - 1) * (half - 3); z = (rnd() * 2 - 1) * (half - 3); }
      if (Math.hypot(x - start.x, z - start.z) > 14) break;
    }
    foes.push({ kind: k, x, z });
  }
  const tier = theme.tier;
  let boss: FloorPlan['boss'], god: God | undefined, shrine: FloorPlan['shrine'];
  const bossName = () => `${BOSS_FIRST[Math.floor(rnd() * BOSS_FIRST.length)]} ${BOSS_EPITHET[tier][Math.floor(rnd() * 3)]}`;
  if (kind === 'boss') boss = { kind: faction === 'undead' ? 'skeleton_brute' : faction === 'greenskin' ? 'orc' : 'warrior', name: bossName(), x: 0, z: -half * .35, hpMul: 6 + floor * .25, dmgMul: 1.3 + floor * .02, scale: 1.3 };
  if (kind === 'shrine' || kind === 'summit') {
    god = GODS[Math.floor(rnd() * GODS.length)];
    shrine = { x: 0, z: -half * .45 };
    boss = { kind: 'warrior', name: kind === 'summit' ? `${god.name}, ${god.title}` : `Champion of ${god.name}`, x: 0, z: -half * .3, hpMul: (kind === 'summit' ? 30 : 9) + floor * .3, dmgMul: 1.5 + floor * .025, scale: kind === 'summit' ? 1.6 : 1.4 };
  }
  if (kind === 'summit') boss = { kind: 'chrysanthus', name: 'Chrysanthus, God of the Tower', x: 0, z: -half * .3, hpMul: 1, dmgMul: 1.6 + floor * .02, scale: 1 };
  const objective = kind === 'avatar' ? 'Survive the trial of Chrysanthus' : kind === 'battle' ? 'Defeat every foe on the floor' : kind === 'boss' ? `Defeat ${boss!.name}` : kind === 'shrine' ? `Defeat the ${boss!.name} and claim a boon` : `Face ${boss!.name}`;
  if (kind === 'avatar') { boss = undefined; walls.length = 0; }   // an open hall for the god's trial
  const ley: Element | null = floor < 3 ? null : LEY_ORDER[Math.floor(rnd() * LEY_ORDER.length)];
  return { floor, seed: runSeed, half, theme, kind, walls, wallHeight: MAZE_WALL_H, maze, props, chests, foes, boss, god, shrine, start, exit, objective, faction, ley };
}

/** Maze walls stand about 4.4 m (the hero is 2.2 units); the perimeter is taller still. */
export const MAZE_WALL_H = 5.4;
const LEY_ORDER: Element[] = ['flame', 'frost', 'storm', 'swift', 'iron', 'shadow', 'verdance', 'water', 'gravity'];

/** Floor 0: the Proving Hall of Chrysanthus. No enemies but training dummies; every element and form to try. */
function provingHall(runSeed: number): FloorPlan {
  const half = 22, theme: Theme = { ...THEMES[6], name: 'The Proving Hall' };
  const props: FloorPlan['props'] = [];
  for (let i = 0; i < 6; i++) props.push({ key: i % 2 ? 'barrel' : 'crate', x: -15 + i * 6, z: 9, yaw: i });
  for (let i = 0; i < 5; i++) props.push({ key: 'pot', x: -12 + i * 6, z: -12, yaw: i });
  const foes: FloorPlan['foes'] = [];
  for (let i = 0; i < 7; i++) foes.push({ kind: 'dummy', x: -12 + i * 4, z: -3 - (i % 2) * 2.5 });
  return { floor: 0, seed: runSeed, half, theme, kind: 'hall', walls: [], wallHeight: MAZE_WALL_H, maze: null, props, chests: [{ x: 14, z: 12, yaw: 0 }], foes, start: { x: 0, z: half - 5 }, exit: { x: 0, z: -half + 2.5 },
    objective: 'Try every magic: B opens the Spellbook · N summons foes · the door leads to Floor 1', ley: null };
}

export type Faction = 'greenskin' | 'undead' | 'raider';
/** Floor 1 is goblins; the dead rise from floor 3; raiders are always about. */
export function floorFaction(floor: number, rnd: () => number): Faction {
  if (floor <= 2) return 'greenskin';
  const r = rnd();
  return r < .38 ? 'greenskin' : r < .7 ? 'undead' : 'raider';
}
/** One foe of a faction, unlocking its stronger kinds with depth. */
export function rollFoe(f: Faction, floor: number, r: number): FoeKind {
  const p = towerEncounter(floor);
  if (f === 'greenskin') return r < p.rangedShare ? 'goblin_archer' : r < p.rangedShare + p.heavyShare ? 'orc' : 'goblin';
  if (f === 'undead') return r < p.rangedShare ? 'skeleton_mage' : r < p.rangedShare + p.heavyShare ? 'skeleton_brute' : 'skeleton';
  return r < p.rangedShare ? 'mage' : r < p.rangedShare + p.heavyShare ? 'warrior' : floor >= 8 && r < .8 ? 'rogue' : 'minion';
}

export { TIERS };
