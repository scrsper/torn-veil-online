import { describe, expect, it } from 'vitest';
import {
  generateSystem, landingSite, surfaceColor, terrainHeight, terrainNormal, universeSpec,
} from '../../src/sim/world/universe/generation';
import {
  HOME_ANCHOR, add, dot, fromLatLon, homeToDir, length, normalize, planetSpec, scale, sub, surfaceHeight,
} from '../../src/sim/world/planet/planet';

const directions = Array.from({ length: 180 }, (_, i) => {
  const y = 1 - 2 * (i + .5) / 180, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5));
  return { x: r * Math.cos(a), y, z: r * Math.sin(a) };
});

describe('deterministic universe generation', () => {
  it('reuses bounded immutable descriptors without allowing callers to change canonical terrain', () => {
    const spec = universeSpec(91), original = generateSystem(spec, 12), p = original.planets[0];
    const height = terrainHeight(p, HOME_ANCHOR), landing = landingSite(p);
    expect(generateSystem(spec, 12)).toBe(original);
    expect(() => { p.seed = 100; }).toThrow();
    expect(() => { p.center.x = 100; }).toThrow();
    expect(() => { p.palette.land = '#ffffff'; }).toThrow();
    expect(() => { original.planets.pop(); }).toThrow();
    // Exercise eviction; regeneration must preserve identity values and geography.
    for (let i = 100; i < 170; i++) generateSystem(spec, i);
    const regenerated = generateSystem(spec, 12);
    expect(regenerated).not.toBe(original);
    expect(regenerated).toEqual(original);
    expect(terrainHeight(regenerated.planets[0], HOME_ANCHOR)).toBe(height);
    expect(landingSite(regenerated.planets[0])).toEqual(landing);
  });

  it('supports direct random access with stable addresses and no query-order dependence', () => {
    const spec = universeSpec(20261017), first = generateSystem(spec, 65535);
    const points = first.planets.map(p => directions.map(d => [terrainHeight(p, d), surfaceColor(p, d)]));
    for (const i of [15, 0, 800, 65534]) generateSystem(spec, i).planets.forEach(p => landingSite(p));
    expect(generateSystem(spec, 65535)).toEqual(first);
    expect(generateSystem(spec, 65535).planets.map(p => directions.map(d => [terrainHeight(p, d), surfaceColor(p, d)]))).toEqual(points);
    expect(generateSystem(universeSpec(20261018), 65535)).not.toEqual(first);
    expect(first.id).toBe('u1:20261017:s65535');
    expect(new Set(first.planets.map(p => p.id)).size).toBe(first.planets.length);
  });

  it('rejects malformed specs and out-of-range addresses instead of wrapping system indices', () => {
    for (const seed of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => universeSpec(seed)).toThrow();
    expect(universeSpec(-1).seed).toBe(0xffffffff);
    for (const i of [-1, 65536, 1.2, NaN, Infinity]) expect(() => generateSystem(universeSpec(1), i)).toThrow();
    expect(() => generateSystem({ version: 2, seed: 1 } as never, 0)).toThrow();
    expect(() => generateSystem({ version: 1, seed: -1 }, 0)).toThrow();
    expect(() => generateSystem(universeSpec(0), 0)).not.toThrow();
    expect(() => generateSystem(universeSpec(0xffffffff), 65535)).not.toThrow();
  });

  it('preserves the original home sphere, authored route, ravines, and non-home geography', () => {
    const p = generateSystem(universeSpec(20261017), 0).planets[0], original = planetSpec(20261017);
    expect(p).toMatchObject({ name: 'Cinderveil', radius: 1600, seed: 20261017, center: { x: 0, y: 0, z: 0 } });
    for (const d of [...directions, HOME_ANCHOR, homeToDir(original, 25, 200), homeToDir(original, 0, 390)])
      expect(terrainHeight(p, d)).toBe(surfaceHeight(original, d));
    expect(terrainHeight(p, HOME_ANCHOR)).toBe(6);
    const elsewhere = generateSystem(universeSpec(20261017), 1).planets[0];
    expect(terrainHeight(elsewhere, HOME_ANCHOR)).not.toBe(6);
    expect(terrainHeight(elsewhere, HOME_ANCHOR)).not.toBe(surfaceHeight(planetSpec(elsewhere.seed), HOME_ANCHOR));
  });

  it('keeps systems compact with separated planets and breathable traversal clearances', () => {
    for (const seed of [0, 1, 7, 20261017, 0xffffffff]) for (const index of [0, 1, 41, 65535]) {
      const system = generateSystem(universeSpec(seed), index);
      expect(system.planets.length).toBeGreaterThanOrEqual(4);
      expect(system.planets.length).toBeLessThanOrEqual(6);
      for (const p of system.planets) {
        expect(p.radius).toBeGreaterThanOrEqual(1100);
        expect(p.radius).toBeLessThanOrEqual(2600);
        expect(p.atmosphere).toBeGreaterThanOrEqual(120);
        expect(p.gravity).toBeGreaterThan(0);
        for (const other of system.planets.filter(o => o.index > p.index)) {
          const separation = length(sub(p.center, other.center));
          expect(separation).toBeGreaterThan(12000);
          expect(separation).toBeLessThan(90000);
          expect(separation - p.radius - other.radius - p.atmosphere - other.atmosphere).toBeGreaterThan(5000);
        }
      }
    }
  });

  it('has coherent seam-free terrain, outward normals, and kind-specific geography', () => {
    const planets = Array.from({ length: 3 }, (_, i) => generateSystem(universeSpec(17), i + 1).planets).flat();
    expect(new Set(planets.map(p => p.kind)).size).toBe(5);
    for (const p of planets) {
      const heights = directions.map(d => terrainHeight(p, d));
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(20);
      for (const d of directions.filter((_, i) => i % 9 === 0)) {
        const h = terrainHeight(p, d), n = terrainNormal(p, d);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(-p.radius * .12);
        expect(h).toBeLessThanOrEqual(p.radius * .19);
        expect(length(n)).toBeCloseTo(1, 9);
        // Cliffs are allowed; the normal must face outward, not satisfy the
        // separate landing-site slope limit everywhere on the planet.
        expect(dot(n, d)).toBeGreaterThan(0);
        expect(surfaceColor(p, d)).toMatch(/^#[0-9a-f]{6}$/);
        expect(surfaceColor(p, d, h)).toBe(surfaceColor(p, d));
        expect(terrainHeight(p, scale(d, 9))).toBeCloseTo(h, 8);
        const nearby = normalize(add(d, { x: 1e-6, y: 0, z: 0 }));
        expect(Math.abs(terrainHeight(p, nearby) - h)).toBeLessThan(.02);
      }
      expect(terrainHeight(p, fromLatLon(30, -180))).toBeCloseTo(terrainHeight(p, fromLatLon(30, 180)), 8);
    }
    const ocean = planets.find(p => p.kind === 'oceanic')!, desert = planets.find(p => p.kind === 'desert')!;
    expect(directions.filter(d => terrainHeight(ocean, d) < 0).length).toBeGreaterThan(100);
    expect(directions.filter(d => terrainHeight(desert, d) > 0).length).toBeGreaterThan(100);
  });

  it('finds deterministic dry gentle landing sites without altering terrain', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const p of generateSystem(universeSpec(seed * 101 + 7), seed % 3).planets) {
        const before = directions.slice(0, 10).map(d => terrainHeight(p, d));
        const site = landingSite(p), d = normalize(site);
        expect(length(site)).toBeCloseTo(p.radius + terrainHeight(p, d), 8);
        expect(terrainHeight(p, d)).toBeGreaterThanOrEqual(p.name === 'Cinderveil' ? 5 : 8);
        expect(dot(d, terrainNormal(p, d))).toBeGreaterThan(.985);
        expect(landingSite(p)).toEqual(site);
        site.x += 100;
        expect(landingSite(p)).not.toEqual(site);
        expect(directions.slice(0, 10).map(d => terrainHeight(p, d))).toEqual(before);
      }
    }
  });
});
