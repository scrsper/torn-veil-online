/** Bounded offline population audit. No assets loaded, no saves read or written. */
import { ATLAS_ASSETS, ATLAS_CATALOG, ATLAS_REVISION, getAtlasAsset } from '../../src/sim/world/atlas';
import { atlasPlanetPlacements, atlasPlacementPolicy, atlasTowerDecorations } from '../../src/sim/world/atlas/placement';
import { cubeToDir } from '../../src/sim/world/planet/scatter';
import { generateSystem, landingSite, universeSpec } from '../../src/sim/world/universe/generation';

const unique = new Set<string>(), placements = new Set<string>(), contexts: Record<string, Set<string>> = {};
const rejectionReasons: Record<string, number> = {}, selectedByRole: Record<string, number> = {}, started = performance.now();
let queries = 0;
for (const asset of ATLAS_ASSETS) {
  const decisions = ['scatter', 'landmark', 'tower'].map(context => atlasPlacementPolicy(asset, context as 'scatter' | 'landmark' | 'tower'));
  if (decisions.every(Boolean)) {
    const reason = decisions[asset.role === 'scene' ? 1 : 0]!;
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
}
function record(values: ReturnType<typeof atlasPlanetPlacements>): void {
  for (const p of values) {
    placements.add(p.id); unique.add(p.assetId);
    (contexts[p.context] ??= new Set()).add(p.assetId);
  }
}
// Three deterministic systems, every biome, all six faces, nine caps per face.
// Plus arrival neighbourhoods, ensuring settlement context is sampled.
for (const systemIndex of [0, 7, 31]) {
  for (const planet of generateSystem(universeSpec(20261017), systemIndex).planets) {
    record(atlasPlanetPlacements(planet, landingSite(planet), 256)); queries++;
    for (let face = 0; face < 6; face++) for (const u of [-.75, 0, .75]) for (const v of [-.75, 0, .75]) {
      record(atlasPlanetPlacements(planet, cubeToDir(face, u, v), 180)); queries++;
    }
  }
}
const supports = Array.from({ length: 12 }, (_, i) => ({
  id: `existing-bench:${i}`, position: { x: i * 5, y: .5, z: 0 }, half: { x: 1.7, y: .5, z: .7 },
}));
for (let floor = 1; floor <= 100; floor++)
  record(atlasTowerDecorations({ id: 'coverage:existing-tower', seed: 20261017, floor, supports }));
for (const id of unique) {
  const role = getAtlasAsset(id)!.role; selectedByRole[role] = (selectedByRole[role] ?? 0) + 1;
}
console.log(JSON.stringify({
  revision: ATLAS_REVISION, placementRevision: 1, sampleSeed: 20261017, sampledSystems: [0, 7, 31],
  surfaceQueries: queries, towerFloors: 100, uniquePlacements: placements.size,
  selectedUniqueAssets: unique.size, selectedByRole,
  contextUniqueAssets: Object.fromEntries(Object.entries(contexts).map(([k, ids]) => [k, ids.size])),
  catalog: ATLAS_CATALOG.summary, rejectedByPlacementPolicy: rejectionReasons,
  selectedAssetIds: [...unique].sort(), seconds: Math.round((performance.now() - started) / 10) / 100,
}, null, 2));
