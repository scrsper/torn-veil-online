import { RNG } from '../../core/rng';
import { towerEncounter } from '../../progression/towerEncounters';
import { planInterior, type InteriorPlan } from './layout';
import { trialKit, type WardenArchetype } from './trialKit';

/** One description of every Tower floor, derived only from the mechanics that already
 * govern the canonical Tower (tower.ts, maze.ts, trialKit.ts, progression/tower.ts) and
 * the world seed. Nothing here is authored per floor and nothing here is new rules:
 * it names what createFloor/observeCanonicalTower/advancement will do on that floor so
 * presentation, tests and tools agree. Same seed + floor → same spec. */
export const TOWER_FLOORS = 100;
export type ThemeKey = 'stone' | 'aether' | 'brass';
export type FloorKind = 'threshold' | 'trial' | 'hall' | 'arena' | 'boss' | 'summit';
export interface FloorAward { abilityId: string; kind: 'book' | 'essence'; quantity: number; provisions: number }
export interface FloorDressing { moduleId: string; role: 'light' | 'archive' | 'stores' | 'crypt' | 'shrine' | 'ruin' | 'banner'; x: number; y: number; z: number; yaw: number }
export interface TowerFloorSpec {
  floor: number; band: number; bandName: string; theme: ThemeKey; kind: FloorKind; name: string;
  /** Gating: the canonical journey only begins floor n after n-1 clears; the summit also needs Silver. */
  gate: { previousFloor: number | null; stage: 'Silver' | null };
  /** Advancement tier the journey reaches by clearing this floor (progression/tower.ts thresholds). */
  tierOnClear: 'Normal' | 'Iron' | 'Bronze' | 'Silver' | 'Gold candidate';
  encounter: ReturnType<typeof towerEncounter>;
  wardens: WardenArchetype[];
  award: FloorAward;
  /** Floor 1's field manual and dagger, finite authored stores. */
  startingSources: boolean;
  /** Reward kinds progression/tower.ts accepts here. */
  rewardKinds: ('tome' | 'form' | 'essence' | 'boon' | 'trial')[];
  rest: boolean;
  layout: { half: number; arena: boolean; rooms: number; walls: number };
  dressing: FloorDressing[];
  lighting: { torch: [number, number, number]; ambient: [number, number, number]; fog: number; torches: number };
}
/** The finite award cycle instantiated by tower.ts createFloor. */
export const FLOOR_AWARDS = ['book-ward', 'book-mend', 'book-sigil', 'ess-swift', 'ess-bone', 'ess-iron', 'ess-life', 'ess-fire', 'ess-storm', 'ess-water', 'ess-gravity', 'ess-time', 'ess-ice', 'ess-blood', 'ess-shadow'] as const;
const THEMES: ThemeKey[] = ['stone', 'aether', 'brass'];
const THEME_NAMES: Record<ThemeKey, string> = { stone: 'Stone sanctum', aether: 'Aether archive', brass: 'Brass foundry' };
const BAND_WORDS = ['Threshold', 'Cloister', 'Lantern', 'Ossuary', 'Archive', 'Forge', 'Gallery', 'Reliquary', 'Spire', 'Crown'];
/** Same band → theme mapping as web/realms/towerThemes.ts (seeded shuffle of three palettes over ten-floor bands). */
export function floorTheme(seed: number, floor: number): ThemeKey {
  const band = Math.floor((clampFloor(floor) - 1) / 10) % 3;
  return new RNG(seed).fork(0x5448454d).shuffle([...THEMES])[band];
}
const clampFloor = (f: number) => Math.max(1, Math.min(TOWER_FLOORS, Math.floor(f) || 1));
/** The descriptor tower.ts registers for floor n (slot only moves the origin, not the layout). */
export function floorPlan(seed: number, floor: number, slot = 0): InteriorPlan {
  return planInterior({ version: 1, id: `veil:tower:spec:floor:${floor}`, buildingId: 'veil:tower:chrysanthus', seed, floor, slot });
}
function tierOnClear(n: number): TowerFloorSpec['tierOnClear'] { return n === 100 ? 'Gold candidate' : n >= 65 ? 'Silver' : n >= 30 ? 'Bronze' : n >= 10 ? 'Iron' : 'Normal'; }
function kindOf(n: number): FloorKind { return n === 1 ? 'threshold' : n === 100 ? 'summit' : n === 10 ? 'trial' : n % 10 === 0 ? 'boss' : n % 5 === 0 ? 'arena' : 'hall'; }

/** Presentation dressing from the verified library module set, placed only on solids the
 * plan already owns (corner benches, partition ends) so it never narrows a route. */
const MODULES: Record<FloorDressing['role'], string[]> = {
  light: ['module:brazier', 'module:lantern_post'], archive: ['module:bookshelf', 'module:reading_desk'], stores: ['module:barrel_cluster', 'module:crate_cluster'],
  crypt: ['module:sarcophagus', 'module:ossuary'], shrine: ['module:altar'], ruin: ['module:broken_column', 'module:masonry_rubble'], banner: ['module:banner'],
};
function dressing(rng: RNG, plan: InteriorPlan, kind: FloorKind, band: number): FloorDressing[] {
  const out: FloorDressing[] = [], o = plan.origin;
  const roomRole: FloorDressing['role'][] = band % 4 === 3 ? ['crypt', 'ruin', 'stores'] : band % 2 ? ['archive', 'stores', 'ruin'] : ['stores', 'archive', 'crypt'];
  const benches = plan.solids.filter(s => s.kind === 'bench');
  benches.forEach((b, i) => {
    const role = roomRole[(i + rng.int(0, 2)) % roomRole.length];
    out.push({ moduleId: rng.pick(MODULES[role]), role, x: b.x + b.w / 2 - o.x, y: b.y + b.h, z: b.z + b.d / 2 - o.z, yaw: rng.int(0, 3) * Math.PI / 2 });
  });
  // Lights and banners hang on partition faces (half a metre proud of a 1 m wall, inside its footprint).
  const walls = plan.solids.filter(s => s.id.includes(':partition:') && Math.max(s.w, s.d) >= 6);
  const lights = Math.min(walls.length, 6 + band + (kind === 'boss' || kind === 'summit' ? 4 : 0));
  for (let i = 0; i < lights; i++) {
    const s = walls[Math.floor(i * walls.length / lights)], along = s.w > s.d, banner = i % 3 === 2, side = rng.chance(.5) ? 1 : -1;
    // Braziers burn on the partition crown; banners hang 5 cm proud of a wall face.
    out.push({ moduleId: banner ? 'module:banner' : 'module:brazier', role: banner ? 'banner' : 'light',
      x: s.x + s.w / 2 - o.x + (banner && !along ? side * .55 : 0), y: banner ? 2.4 : s.y + s.h, z: s.z + s.d / 2 - o.z + (banner && along ? side * .55 : 0),
      yaw: (along ? 0 : Math.PI / 2) + (side < 0 ? Math.PI : 0) });
  }
  if (kind !== 'hall') {
    const ex = plan.exit;
    out.push({ moduleId: kind === 'boss' || kind === 'summit' ? 'module:ornate_gate' : 'module:high_arch', role: 'shrine', x: ex.x - o.x, y: 1, z: ex.z - o.z - 2.5, yaw: 0 });
  }
  return out;
}
export function towerFloorSpec(seed: number, floor: number): TowerFloorSpec {
  if (!Number.isInteger(floor) || floor < 1 || floor > TOWER_FLOORS) throw Error('Tower floor outside 1..100');
  const band = Math.floor((floor - 1) / 10), theme = floorTheme(seed, floor), kind = kindOf(floor), plan = floorPlan(seed, floor);
  const encounter = towerEncounter(floor), rng = new RNG((seed ^ Math.imul(floor, 0x2545f491)) >>> 0).fork(0xd2e55);
  const abilityId = FLOOR_AWARDS[(floor - 1) % FLOOR_AWARDS.length], essence = abilityId.startsWith('ess-');
  const rewardKinds: TowerFloorSpec['rewardKinds'] = ['tome', 'form', 'essence'];
  if (floor % 10 === 0) rewardKinds.push('boon');
  if (floor === 10) rewardKinds.push('trial');
  const palette: Record<ThemeKey, [number, number, number]> = { stone: [1, .72, .42], aether: [.5, .85, 1], brass: [1, .62, .3] };
  const warm = palette[theme], depth = (floor - 1) / 99;
  return {
    floor, band, bandName: `${BAND_WORDS[band]} ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][(floor - 1) % 10]}`, theme, kind,
    name: `Floor ${floor} · ${THEME_NAMES[theme]} · ${BAND_WORDS[band]}${kind === 'hall' ? '' : ` ${kind}`}`,
    gate: { previousFloor: floor > 1 ? floor - 1 : null, stage: floor === 100 ? 'Silver' : null },
    tierOnClear: tierOnClear(floor), encounter,
    wardens: Array.from({ length: encounter.enemies }, (_, i) => trialKit(floor, i).archetype),
    award: { abilityId, kind: essence ? 'essence' : 'book', quantity: essence ? 2 : 1, provisions: 2 },
    startingSources: floor === 1, rewardKinds, rest: encounter.refill === 'rest',
    layout: { half: plan.half, arena: floor % 5 === 0, rooms: plan.rooms.length, walls: plan.solids.filter(s => s.id.includes(':partition:')).length },
    dressing: dressing(rng, plan, kind, band),
    lighting: { torch: warm, ambient: [.16 + .1 * (1 - depth), .15 + .06 * (1 - depth), .2 + .08 * depth], fog: .004 + depth * .01, torches: 6 + band },
  };
}
/** Compact structural fingerprint: two floors are distinct if any wall, room or start/exit differs. */
export function floorSignature(seed: number, floor: number): string {
  const p = floorPlan(seed, floor), o = p.origin, r = (n: number) => Math.round(n * 100) / 100;
  return [p.half, ...p.solids.map(s => [r(s.x - o.x), r(s.z - o.z), r(s.w), r(s.d)].join(',')), r(p.exit.z - o.z)].join(';');
}
