import { describe, expect, it } from 'vitest';
import {
  BIOMES, FAR_ANCHOR, HOME_ANCHOR, HOME_PLATEAU, HOME_ROUTE, arc, biomeAt, chartToHome, climateAt, dot, fromLatLon, gravityAt, homeToDir,
  length, normalize, planetRegions, planetSpec, regionAt, spawnBody, stepSurface, surfaceHeight, surfaceRadius, upOf, type V3,
} from '../../src/sim/world/planet';
import { REALMS } from '../../src/sim/world/realms/layout';

const spec = planetSpec(20261017);
const grid = (n: number) => { const out: V3[] = []; for (let i = 0; i < n; i++) for (let j = 0; j < n * 2; j++) out.push(fromLatLon(-85 + 170 * i / (n - 1), -180 + 360 * j / (n * 2))); return out; };

describe('planet geography', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = grid(12).map(d => [surfaceHeight(spec, d), biomeAt(spec, d)]);
    expect(grid(12).map(d => [surfaceHeight(planetSpec(20261017), d), biomeAt(planetSpec(20261017), d)])).toEqual(a);
    const other = grid(12).map(d => surfaceHeight(planetSpec(7), d));
    expect(other.filter((h, i) => Math.abs(h - (a[i][0] as number)) > 1).length).toBeGreaterThan(50);
  });
  it('has oceans, land and a spread of biomes', () => {
    const counts = new Map<string, number>();
    for (const d of grid(40)) { const b = climateAt(spec, d).biome; counts.set(b, (counts.get(b) ?? 0) + 1); }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect((counts.get('ocean') ?? 0) / total).toBeGreaterThan(.15);
    expect((counts.get('ocean') ?? 0) / total).toBeLessThan(.75);
    expect([...counts.keys()].filter(b => BIOMES.includes(b as never)).length).toBeGreaterThanOrEqual(7);
  });
  it('levels the home route and keeps it on land', () => {
    for (let n = -60; n <= 440; n += 20) expect(surfaceHeight(spec, homeToDir(spec, 0, n))).toBeCloseTo(HOME_PLATEAU.height, 3);
    expect(biomeAt(spec, homeToDir(spec, 0, 0))).toBe('grassland');
    expect(biomeAt(spec, homeToDir(spec, 0, 200))).toBe('forest');
    expect(arc(spec, HOME_ANCHOR, homeToDir(spec, HOME_ROUTE.tower.east, HOME_ROUTE.tower.north))).toBeCloseTo(390, 3);
    const c = chartToHome(spec, homeToDir(spec, 37, -120));
    expect(c.east).toBeCloseTo(37, 6); expect(c.north).toBeCloseTo(-120, 6);
  });
  it('lays named regions over the sphere with the existing realms charted', () => {
    const r = planetRegions(spec);
    expect(r).toHaveLength(28);
    expect(new Set(r.map(x => x.name)).size).toBe(28);
    expect(regionAt(spec, HOME_ANCHOR).name).toBe(REALMS.brass.name);
    expect(regionAt(spec, FAR_ANCHOR).name).toBe(REALMS.aether.name);
    expect(planetRegions(planetSpec(20261017)).map(x => x.name)).toEqual(r.map(x => x.name));
  });
});

describe('spherical gravity and surface walking', () => {
  it('pulls toward the centre everywhere', () => {
    for (const d of grid(6)) { const g = gravityAt(d); expect(dot(normalize(g), d)).toBeCloseTo(-1, 9); expect(length(g)).toBeCloseTo(9.81, 9); }
  });
  it('walks the full circumference without falling off or sinking', () => {
    // Head due east along the home latitude... then a full great circle through both poles.
    let b = spawnBody(spec, HOME_ANCHOR, fromLatLon(90, 0));
    const start = upOf(b), dt = 1 / 30, input = { forward: 1, right: 0, turn: 0, jump: false, run: true };
    let travelled = 0, prev = start, minClear = Infinity, lapped = false, steps = 0;
    while (steps++ < 200000) {
      b = stepSurface(spec, b, input, dt);
      const up = upOf(b);
      travelled += arc(spec, prev, up); prev = up;
      minClear = Math.min(minClear, length(b.pos) - Math.max(surfaceRadius(spec, up), spec.radius - .9));
      if (travelled > 2 * Math.PI * spec.radius * .98 && arc(spec, up, start) < 40) { lapped = true; break; }
    }
    expect(lapped).toBe(true);
    expect(minClear).toBeGreaterThan(-.06);
    expect(travelled).toBeLessThan(2 * Math.PI * spec.radius * 1.1);
  });
  it('jumps and lands back on the surface', () => {
    let b = spawnBody(spec, homeToDir(spec, 0, 0));
    b = stepSurface(spec, b, { forward: 0, right: 0, turn: 0, jump: true, run: false }, 1 / 30);
    expect(b.grounded).toBe(false);
    let peak = 0;
    for (let i = 0; i < 90; i++) { b = stepSurface(spec, b, { forward: 0, right: 0, turn: 0, jump: false, run: false }, 1 / 30); peak = Math.max(peak, length(b.pos) - surfaceRadius(spec, upOf(b))); }
    expect(peak).toBeGreaterThan(1); expect(b.grounded).toBe(true);
  });
});
describe('pagoda footprint', () => {
  it('lets a body climb the stair and reach the door, and stops it at the walls', async () => {
    const { pagodaSupport, pagodaBlocks, PAGODA_SHAPE } = await import('../../src/sim/world/planet/pagoda');
    let last = -1;
    for (let z = -22; z <= -8.2; z += .1) { expect(pagodaBlocks(0, z), `z ${z}`).toBe(false); const h = pagodaSupport(0, z) ?? 0; expect(h).toBeGreaterThanOrEqual(last - 1e-9); last = h; }
    expect(last).toBeCloseTo(PAGODA_SHAPE.podiumStep * 2, 6);
    expect(pagodaBlocks(4, -8)).toBe(true); expect(pagodaBlocks(0, 0)).toBe(true); expect(pagodaBlocks(8, 3)).toBe(true);
    expect(pagodaSupport(30, 30)).toBeNull();
  });
});
