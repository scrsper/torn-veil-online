import catalogData from './libraryCatalog.json';
import { FAR_ANCHOR, HOME_ANCHOR, chartToDir, landmarkSites, regionCentres, type PlanetSpec, type V3 } from '../planet/planet';
import { RNG } from '../../core/rng';
import { planetRegions } from '../planet/regions';

/** The torn-veil-assets runtime library, keyed by manifest id and sha256. The catalog is
 * generated from INTEGRATION_MANIFEST.json + metadata by scripts/world/sync-library.mjs; it
 * holds no binaries. A GLB is only instantiated when its bytes hash to the recorded sha256;
 * otherwise the presentation uses a procedural stand-in of the same bounds. */
export interface LibraryPort { id: string; kind: string; position: [number, number, number]; outward: [number, number, number]; width: number }
export interface LibraryAsset {
  id: string; name: string; family: string; path: string; sha256: string; bytes: number;
  bounds: { min: [number, number, number]; max: [number, number, number] }; triangles: number; ports: LibraryPort[];
  provenance: { libraryFileId: string; archive: string; notice: string };
  verdict: 'use' | 'skip'; reasons: string[];
}
export const LIBRARY = catalogData as unknown as { version: 1; source: string; manifestCreated: string; assets: LibraryAsset[] };
/** Text that disqualifies an asset under the run's provenance rule. */
export const PROVENANCE_DENY = [/ncsoft/i, /\baion\b/i, /source[-_ ]game/i, /native[-_ ]buffer[-_ ]recovery/i, /bip001/i];
export function provenanceOk(a: LibraryAsset, deniedHashes: ReadonlySet<string> = new Set()): boolean {
  const text = JSON.stringify(a.provenance) + a.name + a.family + a.path;
  return a.verdict === 'use' && /^[a-f0-9]{64}$/.test(a.sha256) && !deniedHashes.has(a.sha256) && !PROVENANCE_DENY.some(r => r.test(text));
}
export function libraryAsset(id: string): LibraryAsset | undefined { return LIBRARY.assets.find(a => a.id === id); }
export const usableLibrary = () => LIBRARY.assets.filter(a => provenanceOk(a));

/** A whole-space static asset set on a chart around an anchor. east/north metres, yaw radians
 * (0 = asset +Z faces chart north). Proxies are conservative upright cylinders only where the
 * asset is solid mass (piers, towers); walkable whole-space interiors get none (START_HERE). */
export interface LibraryPlacement { id: string; assetId: string; anchor: 'home' | 'far' | 'site'; site?: number; east: number; north: number; yaw: number; proxies: { east: number; north: number; radius: number }[] }
const P = (id: string, assetId: string, anchor: 'home' | 'far', east: number, north: number, yaw = 0, proxies: LibraryPlacement['proxies'] = []): LibraryPlacement => ({ id, assetId, anchor, east, north, yaw, proxies });
/** Placed sensibly around the preserved town → forest → Tower route (focused town at chart 0,0;
 * forest north 40–190; Tower at -20,172): a south gate and road, a market and second tavern
 * east of the street, a lane and passage to the west, the bridge and watchpost on the south
 * road, the dungeon junction beside the ruined cloister. Aether Reach gets its own hamlet. */
export const LIBRARY_PLACEMENTS: readonly LibraryPlacement[] = Object.freeze([
  P('home:gatehouse', 'tv_04_01_gatehouse', 'home', 0, -78, 0, [{ east: -14, north: -78, radius: 3 }, { east: 14, north: -78, radius: 3 }]),
  P('home:gate-west', 'tv_41_01_gate_segment', 'home', -38, -78, Math.PI / 2),
  P('home:gate-east', 'tv_41_01_gate_segment', 'home', 42, -78, Math.PI / 2),
  P('home:market', 'tv_37_01_market_square', 'home', 62, -14, -Math.PI / 2),
  P('home:tavern', 'tv_31_06_tavern', 'home', 64, 22, -Math.PI / 2),
  P('home:lane', 'tv_08_01_village_lane', 'home', -66, 4, Math.PI / 2),
  P('home:passage', 'tv_42_01_courtyard_passage', 'home', -60, -42, 0),
  P('home:bridge', 'tv_05_01_ravine_bridge', 'home', 0, -150, 0),
  P('home:watchpost', 'tv_10_01_watchpost', 'home', 70, -150, 0),
  P('home:junction', 'tv_44_01_dungeon_junction', 'home', 76, 100, -Math.PI / 2),
  // Aether Reach's own city (generated realm chunks) fills the far plateau's centre; the
  // library hamlet sits on its southern outskirts along the approach.
  P('far:lane', 'tv_08_01_village_lane', 'far', 0, -210, 0),
  P('far:market', 'tv_37_01_market_square', 'far', 0, -176, 0),
  P('far:tavern', 'tv_31_06_tavern', 'far', 32, -210, -Math.PI / 2),
  P('far:watchpost', 'tv_10_01_watchpost', 'far', 0, -270, Math.PI),
  P('far:passage', 'tv_42_01_courtyard_passage', 'far', -32, -210, Math.PI / 2),
]);
export function placementDir(spec: PlanetSpec, p: { anchor: 'home' | 'far' | 'site'; site?: number; east: number; north: number }): V3 {
  const anchor = p.anchor === 'home' ? HOME_ANCHOR : p.anchor === 'far' ? FAR_ANCHOR : regionCentres(spec)[p.site ?? 0];
  return chartToDir(anchor, p.east, p.north, spec.radius);
}
/** A landmark settlement on each land region's levelled centre, chosen from the library by
 * biome (seeded): watch towers in woods and heights, lanes and markets on open downs and
 * plains, ruins in wastes and barrens, passages by fens and coasts. */
const LANDMARKS: Record<string, string[][]> = {
  forest: [['tv_10_01_watchpost'], ['tv_08_01_village_lane', 'tv_31_06_tavern']], taiga: [['tv_10_01_watchpost']], mountain: [['tv_10_01_watchpost'], ['tv_04_01_gatehouse']],
  grassland: [['tv_08_01_village_lane', 'tv_37_01_market_square'], ['tv_31_06_tavern', 'tv_42_01_courtyard_passage']], savanna: [['tv_37_01_market_square', 'tv_31_06_tavern']],
  desert: [['tv_41_01_gate_segment', 'tv_44_01_dungeon_junction']], tundra: [['tv_44_01_dungeon_junction'], ['tv_41_01_gate_segment']], snow: [['tv_44_01_dungeon_junction']],
  swamp: [['tv_42_01_courtyard_passage'], ['tv_05_01_ravine_bridge']], beach: [['tv_31_06_tavern', 'tv_42_01_courtyard_passage']], ocean: [],
};
const landmarkCache = new WeakMap<PlanetSpec, LibraryPlacement[]>();
export function regionLandmarks(spec: PlanetSpec): LibraryPlacement[] {
  const hit = landmarkCache.get(spec); if (hit) return hit;
  const regions = planetRegions(spec), out: LibraryPlacement[] = [];
  for (const site of landmarkSites(spec)) {
    const r = regions[site.region], rng = new RNG((spec.seed ^ Math.imul(site.region, 0x9e3779b1)) >>> 0), options = LANDMARKS[r.biome] ?? [];
    if (!options.length) continue;
    const set = rng.pick(options), yaw = rng.int(0, 3) * Math.PI / 2;
    set.forEach((assetId, k) => out.push({ id: `site:${site.region}:${k}`, assetId, anchor: 'site', site: site.region, east: k ? 30 * Math.cos(yaw) : 0, north: k ? 30 * Math.sin(yaw) : 0, yaw, proxies: [] }));
  }
  landmarkCache.set(spec, out); return out;
}

/** Conservative upright-cylinder proxies (asset-local x, z, radius) for the solid masses of the
 * procedural stand-ins. Real GLBs are whole-space walkable meshes with no approved collision,
 * so these apply only while a stand-in is shown. */
export function standInProxies(a: LibraryAsset): { x: number; z: number; r: number }[] {
  const [x0, , z0] = a.bounds.min, [x1, , z1] = a.bounds.max, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  switch (a.family) {
    case 'tavern': return [{ x: cx, z: cz, r: Math.min(w * .8, d * .7) / 2 }];
    case 'village_lane': return [0, 1, 2, 3].map(i => ({ x: cx + (i % 2 ? 1 : -1) * w * .26, z: z0 + d * (.18 + Math.floor(i / 2) * .5), r: Math.min(w, d) * .15 }));
    case 'gatehouse': return [-1, 1].map(s => ({ x: cx + s * 9, z: cz, r: 4.6 }));
    case 'gate_segment': return [-1, 1].flatMap(s => [-.3, 0, .3].map(k => ({ x: cx + s * w * .3 + k * w * .38, z: cz, r: 1.4 })));
    case 'dungeon_junction': return [{ x: cx, z: cz, r: Math.min(w, d) * .3 }];
    case 'ravine_bridge': return [-1, 1].map(s => ({ x: cx, z: cz + s * d * .3, r: 1.6 }));
    default: return [];
  }
}
/** Asset-local (x, z) → chart (east, north) under the placement yaw; the frame maps local +x to west. */
export function placementLocal(p: LibraryPlacement, x: number, z: number) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw), rx = x * c + z * s, rz = -x * s + z * c;
  return { east: p.east - rx, north: p.north + rz };
}
