import { describe, expect, it } from 'vitest';
import { LIBRARY_PLACEMENTS, libraryAsset, regionLandmarks } from '../../src/sim/world/assets/library';
import { HOME_PLATEAU, RAVINE, biomeAt, homeToDir, planetRavines, planetRoads, planetSpec, ravineDepth, siteHeight, surfaceHeight } from '../../src/sim/world/planet';

const spec = planetSpec(20261017);
// The home bridge: chart (-8, -150), yaw 0, so asset-local x runs west (east = -8 - x) and z north.
const bridge = LIBRARY_PLACEMENTS.find(p => p.id === 'home:bridge')!;
const at = (x: number, z: number) => homeToDir(spec, bridge.east - x, bridge.north + z);
describe('ravines under the bridges', () => {
  it('carves one gorge per ravine-bridge placement, deterministically', () => {
    const bridges = [...LIBRARY_PLACEMENTS, ...regionLandmarks(spec)].filter(p => libraryAsset(p.assetId)?.family === 'ravine_bridge');
    expect(planetRavines(spec)).toHaveLength(bridges.length);
    expect(planetRavines(planetSpec(20261017))).toEqual(planetRavines(spec));
  });
  it('drops the ground under the home bridge between its banks and keeps the banks at grade', () => {
    for (const x of [-14, -8, 0, 12, 26]) {
      expect(surfaceHeight(spec, at(x, 0))).toBeCloseTo(HOME_PLATEAU.height - RAVINE.depth, 3);
      expect(surfaceHeight(spec, at(x, 5.5))).toBeCloseTo(HOME_PLATEAU.height - RAVINE.depth, 3);
      expect(surfaceHeight(spec, at(x, 9.5))).toBeCloseTo(HOME_PLATEAU.height, 3);
      expect(surfaceHeight(spec, at(x, -14))).toBeCloseTo(HOME_PLATEAU.height, 3);
    }
    // The placement itself sits on the levelled ground; the bed stays above the sea.
    expect(siteHeight(spec, at(-8, 0))).toBeCloseTo(HOME_PLATEAU.height, 3);
    expect(surfaceHeight(spec, at(-8, 0))).toBeGreaterThan(1);
  });
  it('shallows out past the asset ends and keeps the surrounding biome', () => {
    const a = libraryAsset(bridge.assetId)!, end = a.bounds.max[0];
    const d1 = ravineDepth(spec, at(end + RAVINE.run / 2, 0)), d2 = ravineDepth(spec, at(end + RAVINE.run + 1, 0));
    expect(d1).toBeGreaterThan(0); expect(d1).toBeLessThan(RAVINE.rim); expect(d2).toBe(0);
    // The bed rises above the asset's water line (-3.8 m) at its ends.
    expect(ravineDepth(spec, at(end, 0))).toBeLessThan(3.8);
    expect(biomeAt(spec, at(0, 0))).toBe(biomeAt(spec, at(0, 20)));
  });
  it('leaves the road undrawn across the gorge (the bridge carries it)', () => {
    const spur = planetRoads(spec).find(r => r.id === 'road:home-gate')!;
    spur.points.forEach((p, i) => { if (ravineDepth(spec, p) > 0) expect(spur.wet[i]).toBe(true); });
    expect(spur.wet.some(w => !w)).toBe(true);
  });
});
