import { describe, expect, it } from 'vitest';
import { LIBRARY, LIBRARY_PLACEMENTS, libraryAsset, placementDir, provenanceOk, usableLibrary } from '../../src/sim/world/assets/library';
import { HOME_ANCHOR, PROP_ASSET, arc, planetSpec, propsNear, reserved, resolveObstacles, spawnBody, siteHeight, surfaceHeight, HOME_PLATEAU, normalize, sub, dot, length, scale, upOf } from '../../src/sim/world/planet';

const spec = planetSpec(20261017);
describe('asset library registry', () => {
  it('registers all twelve manifest assets by id and sha256 with provenance verdicts', () => {
    expect(LIBRARY.assets).toHaveLength(12);
    for (const a of LIBRARY.assets) { expect(a.sha256).toMatch(/^[a-f0-9]{64}$/); expect(a.path).toBe(`models/${a.id}.glb`); }
    expect(usableLibrary()).toHaveLength(12);
  });
  it('refuses denied provenance text and denied hashes', () => {
    const a = libraryAsset('tv_31_06_tavern')!;
    expect(provenanceOk(a)).toBe(true);
    expect(provenanceOk({ ...a, provenance: { ...a.provenance, notice: 'Aion source-game extraction' } })).toBe(false);
    expect(provenanceOk(a, new Set([a.sha256]))).toBe(false);
    expect(provenanceOk({ ...a, verdict: 'skip' })).toBe(false);
  });
  it('places every usable asset, on level ground, using known ids', () => {
    const placed = new Set([...LIBRARY_PLACEMENTS.map(p => p.assetId), ...Object.values(PROP_ASSET).filter(Boolean)]);
    for (const a of usableLibrary()) expect(placed.has(a.id), a.id).toBe(true);
    for (const p of LIBRARY_PLACEMENTS) { expect(libraryAsset(p.assetId)).toBeDefined(); expect(siteHeight(spec, placementDir(spec, p))).toBeCloseTo(HOME_PLATEAU.height, 2); }
  });
});
describe('seeded props and collision', () => {
  it('scatters the same props for the same neighbourhood and keeps the town route clear', () => {
    const d = normalize({ x: .3, y: .5, z: .8 });
    expect(propsNear(spec, d, 300).map(p => p.id)).toEqual(propsNear(spec, d, 300).map(p => p.id));
    expect(propsNear(spec, HOME_ANCHOR, 120).length).toBe(0);
    expect(reserved(spec, HOME_ANCHOR)).toBe(true);
  });
  it('pushes the walker out of an obstacle along the surface', () => {
    const b = spawnBody(spec, HOME_ANCHOR), r = resolveObstacles(spec, b, [{ dir: HOME_ANCHOR, radius: 1 }]);
    const c = scale(normalize(HOME_ANCHOR), length(r.pos)), off = sub(r.pos, c), up = upOf(r);
    expect(length(sub(off, scale(up, dot(off, up))))).toBeGreaterThan(1.4);
    expect(arc(spec, upOf(r), HOME_ANCHOR)).toBeLessThan(2);
  });
});
describe('region landmarks', () => {
  it('sets a library settlement on levelled ground at land region centres', async () => {
    const { regionLandmarks } = await import('../../src/sim/world/assets/library');
    const { landmarkSites, surfaceHeight: h, regionCentres } = await import('../../src/sim/world/planet');
    const marks = regionLandmarks(spec), sites = landmarkSites(spec);
    expect(marks.length).toBeGreaterThan(5);
    expect(regionLandmarks(planetSpec(20261017)).map(m => m.id)).toEqual(marks.map(m => m.id));
    for (const s of sites) expect(h(spec, s.dir)).toBeCloseTo(s.height, 6);
    for (const m of marks) { expect(libraryAsset(m.assetId)).toBeDefined(); const site = sites.find(s => s.region === m.site)!; expect(h(spec, placementDir(spec, m))).toBeCloseTo(site.height, 3); }
    expect(regionCentres(spec)).toHaveLength(28);
  });
});
describe('stand-in collision proxies', () => {
  it('maps asset-local proxies through the placement yaw onto the chart', async () => {
    const { placementLocal, standInProxies } = await import('../../src/sim/world/assets/library');
    const p = LIBRARY_PLACEMENTS.find(q => q.assetId === 'tv_04_01_gatehouse')!;
    expect(standInProxies(libraryAsset(p.assetId)!)).toHaveLength(2);
    expect(placementLocal({ ...p, yaw: 0 }, 3, 4)).toEqual({ east: p.east - 3, north: p.north + 4 });
    const q = placementLocal({ ...p, yaw: Math.PI / 2 }, 3, 0); expect(q.east).toBeCloseTo(p.east, 9); expect(q.north).toBeCloseTo(p.north - 3, 9);
    for (const a of usableLibrary()) for (const r of standInProxies(a)) expect(r.r).toBeGreaterThan(0);
  });
});
describe('placements follow manifest ports', () => {
  it('through-routes sit on the road line and stay clear of stand-in proxies', async () => {
    const { routeX, standInProxies, placementLocal } = await import('../../src/sim/world/assets/library');
    const gate = libraryAsset('tv_04_01_gatehouse')!, bridge = libraryAsset('tv_05_01_ravine_bridge')!;
    expect(routeX(gate)).toBe(0);
    expect(routeX(bridge)).toBe(-8);
    // The deck's port line lands on the south road (east 0); the gate passage stays open for a walker.
    const bp = LIBRARY_PLACEMENTS.find(p => p.id === 'home:bridge')!;
    expect(placementLocal(bp, routeX(bridge), 0).east).toBeCloseTo(0, 9);
    expect(standInProxies(bridge)).toHaveLength(0);
    for (const r of standInProxies(gate)) expect(Math.abs(r.x - routeX(gate)) - r.r).toBeGreaterThan(2.5);
  });
});
