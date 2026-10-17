import catalogData from './libraryCatalog.json';
import { FAR_ANCHOR, HOME_ANCHOR, chartToDir, type PlanetSpec, type V3 } from '../planet/planet';

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
export interface LibraryPlacement { id: string; assetId: string; anchor: 'home' | 'far'; east: number; north: number; yaw: number; proxies: { east: number; north: number; radius: number }[] }
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
  P('far:lane', 'tv_08_01_village_lane', 'far', 0, 0, 0),
  P('far:market', 'tv_37_01_market_square', 'far', 0, 34, 0),
  P('far:tavern', 'tv_31_06_tavern', 'far', 30, 0, -Math.PI / 2),
  P('far:watchpost', 'tv_10_01_watchpost', 'far', 0, -60, Math.PI),
  P('far:passage', 'tv_42_01_courtyard_passage', 'far', -30, 0, Math.PI / 2),
]);
export function placementDir(spec: PlanetSpec, p: { anchor: 'home' | 'far'; east: number; north: number }): V3 {
  return chartToDir(p.anchor === 'home' ? HOME_ANCHOR : FAR_ANCHOR, p.east, p.north, spec.radius);
}
