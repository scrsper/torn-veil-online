import { RNG } from '../../core/rng';

/** Metres. Versioned addresses, independent of load order and the live simulation RNG. */
export const REALM_CHUNK = 96;
export const REALM_SIZE = REALM_CHUNK * 64;
export type RealmId = 'aether' | 'brass';
export interface RealmSpec { version: 1; seed: number; focusedKit?:1;focusedGeometrySha?:string;focusedGenerator?:string }
export interface Point { x: number; y: number; z: number }
export interface Solid { x: number; y: number; z: number; w: number; h: number; d: number; material: 'wall' | 'metal' | 'roof' | 'stone' }
export interface Building {
  id: string; name: string; use: 'dwelling' | 'workshop' | 'archive' | 'tower';
  x: number; z: number; w: number; d: number; height: number;
  door: Point; solids: Solid[]; windows: Point[]; style: number; floors: number;
  roof: 'terrace' | 'gable' | 'spire'; accent: number; interior: boolean;
}
export interface RealmChunk {
  focused?:boolean;
  id: string; realm: RealmId; cx: number; cz: number; x: number; z: number;
  district: string; buildings: Building[]; plaza: boolean; seed: number;
}
export const REALMS = {
  aether: { id: 'aether' as const, name: 'Aether Reach', subtitle: 'THE GLASS MERIDIAN', offset: 0, districts: ['Transit Ward', 'Lantern Exchange', 'Skyline Archives', 'Foundry Circuit'] },
  brass: { id: 'brass' as const, name: 'Cinderveil', subtitle: 'THE BRASS & THORN REALM', offset: 8192, districts: ['Clockmakers Row', 'Embermarket', 'Scholar Cloister', 'Copper Gardens'] },
};
export const CENTER = 32 * REALM_CHUNK;
export function realmAt(x: number, z: number): RealmId | null {
  if (z < 0 || z >= REALM_SIZE) return null;
  for (const r of Object.values(REALMS)) if (x >= r.offset && x < r.offset + REALM_SIZE) return r.id;
  return null;
}
export function realmSeed(seed: number, ...keys: (string | number)[]): number {
  let h = (seed ^ 2166136261) >>> 0;
  for (const c of keys.join('/')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
export function spawnPoint(realm: RealmId): Point { return { x: REALMS[realm].offset + CENTER + 48.5, y: 1, z: CENTER + 20.5 }; }
export function portalPoint(realm: RealmId): Point { return { x: REALMS[realm].offset + CENTER + 20.5, y: 1, z: CENTER + 30.5 }; }
export function towerThreshold(realm: RealmId): Point { return { x: REALMS[realm].offset + CENTER + 48.5, y: 1, z: CENTER + 50.5 }; }

/** A bounded room kit is shared by tower atria, workshops and archives. The central
 * processional aisle and real openings are constraints, not random afterthoughts. */
function roomKit(b: Building, seed: number): Solid[] {
  const parts: Solid[] = [], rng = new RNG(seed);
  const box = (x: number, z: number, w: number, d: number, h = 3) => parts.push({ x, y: 1, z, w, h, d, material: 'stone' });
  if (b.use === 'tower') {
    for (const x of [b.x + 5, b.x + b.w - 7]) for (const z of [b.z + 8, b.z + 19]) box(x, z, 2, 2, 9);
    // Side chapels, with two openings into the central aisle.
    for (const x of [b.x + 9, b.x + b.w - 10]) {
      box(x, b.z + 5, 1, 5, 5); box(x, b.z + 14, 1, 8, 5);
    }
    box(b.x + 3, b.z + b.d - 5, 6, 2, 1);
    box(b.x + b.w - 9, b.z + b.d - 5, 6, 2, 1);
  } else if (b.interior) {
    box(b.x + 2, b.z + b.d - 4, Math.max(3, b.w - 4), 1, 1);
    if (rng.chance(.6)) box(b.x + 2, b.z + 5, 2, 3, 2);
  }
  return parts;
}
function building(seed: number, realm: RealmId, id: string, x: number, z: number, w: number, d: number, tower = false, programme = 0): Building {
  const rng = new RNG(realmSeed(seed, id)), sci = realm === 'aether';
  const floorRanges = sci ? [[7,11],[5,9],[12,19],[4,10]] : [[3,5],[2,3],[4,7],[2,4]];
  const [low, high] = floorRanges[programme];
  const style = rng.int(0, 3), floors = tower ? 22 : rng.int(low, high);
  const height = tower ? 118 : floors * (sci ? 4 : 3.5) + 1;
  const use = tower ? 'tower' : programme === 2 ? 'archive' : programme === 0 || programme === 3 ? 'workshop' : 'dwelling';
  const door = { x: x + Math.floor(w / 2), y: 1, z };
  const b: Building = { id, x, z, w, d, height, floors, style, accent: rng.int(0, 3), use, door,
    name: tower ? 'Tower of Chrysanthus' : `${rng.pick(sci ? ['Helix', 'Orison', 'Prism', 'Vector'] : ['Amber', 'Thorn', 'Copper', 'Morrow'])} ${use === 'workshop' ? 'Works' : use === 'archive' ? 'Archive' : 'House'}`,
    solids: [], windows: [], roof: tower || (!sci && style === 3) ? 'spire' : sci ? 'terrace' : 'gable', interior: true };
  const add = (xx: number, yy: number, zz: number, ww: number, hh: number, dd: number, material: Solid['material'] = 'wall') => b.solids.push({ x: xx, y: yy, z: zz, w: ww, h: hh, d: dd, material });
  // Continuous doorway is three metres wide. Upper facades are real walls; luminous
  // windows are glazing decoration, never advertised as traversable rooms.
  const opening = tower ? 5 : 3, left = door.x - Math.floor(opening / 2);
  add(x, 1, z, left - x, height, 1); add(left + opening, 1, z, x + w - left - opening, height, 1);
  add(left, tower ? 8 : 4, z, opening, height - (tower ? 7 : 3), 1);
  add(x, 1, z + d - 1, w, height, 1); add(x, 1, z + 1, 1, height, d - 2); add(x + w - 1, 1, z + 1, 1, height, d - 2);
  add(x, tower ? 12 : 5, z, w, 1, d, 'stone');
  add(x, height, z, w, 1, d, 'roof');
  if (sci || tower) {
    for (let i = 0; i < (tower ? 3 : style + 1); i++) {
      const inset = 2 + i * 2, h = tower ? 10 : 5;
      if (w - inset * 2 > 2) add(x + inset, height + 1 + i * h, z + inset, w - inset * 2, h, d - inset * 2, i % 2 ? 'metal' : 'wall');
    }
  }
  for (let yy = 7; yy < height - 2; yy += sci ? 4 : 3.5) {
    for (let xx = x + 2; xx < x + w - 2; xx += 3) {
      // Glazing must not float across a real aperture. The Tower opening extends
      // above the first window row; the ordinary ground-floor door does not.
      if (!(tower && yy - .85 < 8 && xx + .6 > left && xx - .6 < left + opening)) b.windows.push({ x: xx, y: yy, z: z - .08 });
      b.windows.push({ x: xx, y: yy, z: z + d + .08 });
    }
    for (let zz = z + 3; zz < z + d - 2; zz += 3) b.windows.push({ x: x - .08, y: yy, z: zz }, { x: x + w + .08, y: yy, z: zz });
  }
  b.solids.push(...roomKit(b, realmSeed(seed, id, 'interior')));
  return b;
}
export function generateRealmChunk(spec: RealmSpec, realm: RealmId, cx: number, cz: number): RealmChunk {
  if (spec.version !== 1 || !Number.isInteger(spec.seed) || !Number.isInteger(cx) || !Number.isInteger(cz) || cx < 0 || cz < 0 || cx >= 64 || cz >= 64) throw new Error('Unsupported realm address');
  const id = `veil:v1:${spec.seed}:${realm}:district:${Math.floor(cx / 3)},${Math.floor(cz / 3)}:chunk:${cx},${cz}`;
  const seed = realmSeed(spec.seed, realm, cx, cz), rng = new RNG(seed), x = REALMS[realm].offset + cx * REALM_CHUNK, z = cz * REALM_CHUNK;
  const plaza = cx === 32 && cz === 32;
  const programme = realmSeed(spec.seed, realm, Math.floor(cx / 3), Math.floor(cz / 3)) % 4;
  const buildings: Building[] = [];
  if (plaza) buildings.push(building(spec.seed, realm, `${id}:tower`, x + 32, z + 50, 33, 34, true));
  else for (let i = 0; i < 4; i++) {
    const px = i % 2, pz = Math.floor(i / 2), w = rng.int(21, 29), d = rng.int(23, 29);
    buildings.push(building(spec.seed, realm, `${id}:parcel:${i}`, x + 12 + px * 43 + rng.int(0, 2), z + 12 + pz * 43 + rng.int(0, 2), w, d, false, programme));
  }
  const district = REALMS[realm].districts[programme];
  return { id, realm, cx, cz, x, z, district, seed, plaza, buildings };
}

/** Wanted order supports incremental upload, and is independently bounded per view. */
export function realmResidency(pos: Point, radius = 4): { realm: RealmId; cx: number; cz: number; lod: number }[] {
  const realm = realmAt(pos.x, pos.z); if (!realm) return [];
  const cx = Math.floor((pos.x - REALMS[realm].offset) / REALM_CHUNK), cz = Math.floor(pos.z / REALM_CHUNK), result = [];
  for (let x = Math.max(0, cx - radius); x <= Math.min(63, cx + radius); x++) for (let z = Math.max(0, cz - radius); z <= Math.min(63, cz + radius); z++) {
    const distance = Math.max(Math.abs(x - cx), Math.abs(z - cz));
    result.push({ realm, cx: x, cz: z, lod: distance <= 1 ? 0 : distance <= 2 ? 1 : 2 });
  }
  return result.sort((a, b) => a.lod - b.lod || Math.hypot(a.cx - cx, a.cz - cz) - Math.hypot(b.cx - cx, b.cz - cz) || a.cx - b.cx || a.cz - b.cz);
}
