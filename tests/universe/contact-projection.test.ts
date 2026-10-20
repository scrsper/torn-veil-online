import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { CONTACT_TRIANGLE_LIMIT, universeContactPatch, type UniverseContactPatch } from '../../src/server/universeContacts';
import { bodyPointToUniverse } from '../../src/server/universeSettlements';
import { RealmSession } from '../../src/sim/world/realms/session';
import { createTravelState, type TravelState } from '../../src/sim/world/universe/travel';
import { generateSystem, universeSpec } from '../../src/sim/world/universe/generation';
import { StaticGeometry, type StaticTriangle } from '../../src/sim/physical/staticGeometry';
import { add, length, normalize, planetSpec, scale, sub, type V3 } from '../../src/sim/world/planet/planet';
import { planetToSettlement, settlementToPlanet } from '../../src/sim/world/universe/settlements';
import { UniverseFootSupport } from '../../src/web/universe/contactSupport';

const seed = 20261017, spec = universeSpec(seed), planets = generateSystem(spec, 0).planets, home = planets[0];
const stable = (s: RealmSession) => { const saved = JSON.parse(s.save()); delete saved.savedAt; return saved; };
function stateAt(s: RealmSession, point: V3, realm: 'brass' | 'aether' = 'brass') {
  return { ...createTravelState(spec), settlementRevision: 1 as const,
    position: bodyPointToUniverse(s, realm, point), landedPlanetId: home.id };
}
function planarTriangles(patch: UniverseContactPatch, realm: 'brass' | 'aether' = 'brass') {
  return patch.triangles.map(t => Array.from({ length: 3 }, (_, i) =>
    planetToSettlement(planetSpec(seed, home.radius), realm,
      sub(add(patch.origin, { x: t[i * 3], y: t[i * 3 + 1], z: t[i * 3 + 2] }), home.center))));
}
function installed(s: RealmSession, count: number, supported = true) {
  const p = { x: 11312.5, y: 1, z: 3092.5 };
  const triangle: StaticTriangle = { p: [p.x - 1, 1, p.z - 1, p.x - 1, 1, p.z + 1, p.x + 1, 1, p.z - 1], support: supported };
  const geometry = new StaticGeometry(Array.from({ length: count }, () => ({ ...triangle, p: [...triangle.p] })),
    { x0: p.x - 5, x1: p.x + 5, z0: p.z - 5, z1: p.z + 5 });
  s.grid.movementGeometryAt = () => geometry;
  return { geometry, state: stateAt(s, p) };
}

describe('bounded canonical spherical foot-contact projection', () => {
  let s: RealmSession;
  beforeAll(() => { loadFocusedGeometry(); s = new RealmSession(seed); s.adoptFocusedWorld(); });

  it('projects actual focused street, mortar/paving and forest slope without altering source or body truth', () => {
    const geometry = s.grid.focusedGeometry!, original = stable(s), before = JSON.stringify(geometry.triangles);
    const samples: { name: string; point: V3 }[] = [
      { name: 'street', point: { ...s.grid.focusedTown!.spawn } },
      { name: 'paving seam', point: { x: 11312.488024842572, y: 1.0625, z: 3093.1147530743033 } },
    ];
    // Select one actual walkable, sloped authored forest triangle, not a test
    // plane or generated replacement for the source geometry.
    const slope = geometry.triangles.find(t => {
      if (!t.support || !t.node?.includes(':forest-') || Math.max(t.p[1], t.p[4], t.p[7]) - Math.min(t.p[1], t.p[4], t.p[7]) < .08) return false;
      const x = (t.p[0] + t.p[3] + t.p[6]) / 3, y = (t.p[1] + t.p[4] + t.p[7]) / 3, z = (t.p[2] + t.p[5] + t.p[8]) / 3;
      const actual = geometry.supportAt(x, z, y, .55);
      return actual !== null && Math.abs(actual - y) < .15 && geometry.fits(x, actual, z, .3, 1.8);
    });
    expect(slope).toBeDefined();
    const slopePoint = { x: (slope!.p[0] + slope!.p[3] + slope!.p[6]) / 3,
      y: (slope!.p[1] + slope!.p[4] + slope!.p[7]) / 3, z: (slope!.p[2] + slope!.p[5] + slope!.p[8]) / 3 };
    slopePoint.y = geometry.supportAt(slopePoint.x, slopePoint.z, slopePoint.y, .55)!;
    samples.push({ name: 'forest slope', point: slopePoint });
    const measurements = [];
    for (const { name, point } of samples) {
      const state = stateAt(s, point), stateBefore = structuredClone(state), patch = universeContactPatch(s, state, home)!;
      expect(patch?.available, name).toBe(true); expect(patch.reason).toBe('ready');
      expect(patch.triangles.length).toBeGreaterThan(0); expect(patch.triangles.length).toBeLessThanOrEqual(CONTACT_TRIANGLE_LIMIT);
      expect(patch.triangles.every(t => t.length === 9 && t.every(Number.isFinite))).toBe(true);
      const projected = planarTriangles(patch);
      // Every returned triangle is exactly an existing source triangle after
      // the inverse chart map; the adapter must not flatten paving or slopes.
      const window = geometry.window(Math.floor(point.x) - 3, Math.floor(point.z) - 3, 7).triangles;
      for (const vertices of projected) expect(window.some(t => vertices.every((p, i) =>
        length(sub(p, { x: t.p[i * 3], y: t.p[i * 3 + 1], z: t.p[i * 3 + 2] })) < 1e-7))).toBe(true);
      if (name === 'paving seam') expect(projected.some(t => t.every(p => Math.abs(p.y - 1.0625) < 1e-7))).toBe(true);
      if (name === 'forest slope') expect(projected.some(t => Math.max(...t.map(p => p.y)) - Math.min(...t.map(p => p.y)) > .08)).toBe(true);
      const sampler = new UniverseFootSupport(); sampler.setPatch(patch);
      const foot = settlementToPlanet(planetSpec(seed, home.radius), 'brass', point), up = normalize(foot);
      const support = sampler.sample(home, true, 1, add(foot, scale(up, .06)), up, .09, .3);
      expect(support, name + ' projected sampler').not.toBeNull();
      const measured = planetToSettlement(planetSpec(seed, home.radius), 'brass', support!.point);
      // Individual soles may sample mortar below the capsule's higher support
      // band. Match the actual triangle under that sole, not a flattened1.0625m.
      const sourceHeight = geometry.sampleGroundAt(point.x, point.z, point.y)!;
      expect(Math.abs(measured.y - sourceHeight)).toBeLessThan(.01);
      expect(state).toEqual(stateBefore);
      const bytes = Buffer.byteLength(JSON.stringify(patch));
      expect(bytes).toBeLessThan(160000);
      measurements.push({ name, point, triangles: patch.triangles.length, bytes });
    }
    expect(stable(s)).toEqual(original); expect(JSON.stringify(geometry.triangles)).toBe(before);
    console.info('Contact projection measured fixture:', JSON.stringify(measurements));
  });

  it('memoizes immutable source-geometry cells without exposing mutable output', () => {
    const state = stateAt(s, s.grid.focusedTown!.spawn), geometry = s.grid.focusedGeometry!;
    const window = vi.spyOn(geometry, 'window');
    try {
      const first = universeContactPatch(s, state, home)!;
      const calls = window.mock.calls.length;
      expect(universeContactPatch(s, state, home)).toBe(first); expect(window).toHaveBeenCalledTimes(calls);
      expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.origin)).toBe(true);
      expect(Object.isFrozen(first.triangles)).toBe(true); expect(first.triangles.every(Object.isFrozen)).toBe(true);
      expect(() => { (first.origin as V3).x += 1; }).toThrow(TypeError);
      expect(() => { (first.triangles[0] as number[])[0] += 1; }).toThrow(TypeError);
    } finally { window.mockRestore(); }
  });

  it('admits exactly the triangle budget and fails closed without partial floors above it', () => {
    for (const count of [CONTACT_TRIANGLE_LIMIT, CONTACT_TRIANGLE_LIMIT + 1]) {
      const native = new RealmSession(seed), { state } = installed(native, count);
      const patch = universeContactPatch(native, state, home)!;
      expect(patch.available).toBe(count === CONTACT_TRIANGLE_LIMIT);
      expect(patch.reason).toBe(count === CONTACT_TRIANGLE_LIMIT ? 'ready' : 'budget');
      expect(patch.triangles).toHaveLength(count === CONTACT_TRIANGLE_LIMIT ? count : 0);
      expect(universeContactPatch(native, state, home)).toBe(patch);
    }
  });

  it('returns unavailable rather than inventing floor when source has no supported triangles', () => {
    const native = new RealmSession(seed), { state } = installed(native, 10, false);
    expect(universeContactPatch(native, state, home)).toMatchObject({ available: false, reason: 'unsupported', triangles: [] });
  });

  it('uses actual native voxel tops in the other realm without requiring focused assets there', () => {
    const native = new RealmSession(seed), feet = { ...native.body.pos };
    expect(native.grid.movementGeometryAt(feet.x, feet.z)).toBeNull();
    const patch = universeContactPatch(native, stateAt(native, feet, 'aether'), home)!;
    expect(patch.available).toBe(true); expect(patch.triangles.length).toBeLessThanOrEqual(50);
    for (const t of planarTriangles(patch, 'aether')) for (const p of t) expect(p.y).toBeCloseTo(feet.y, 8);
  });

  it('returns no town contacts in flight, legacy geography, outside patches, or on another world', () => {
    const state = stateAt(s, s.grid.focusedTown!.spawn);
    expect(universeContactPatch(s, { ...state, mode: 'flight' }, home)).toBeNull();
    expect(universeContactPatch(s, { ...state, settlementRevision: undefined }, home)).toBeNull();
    expect(universeContactPatch(s, { ...state, systemIndex: 1 }, home)).toBeNull();
    expect(universeContactPatch(s, undefined, home)).toBeNull(); expect(universeContactPatch(s, state, undefined)).toBeNull();
    expect(universeContactPatch(s, { ...state, position: { x: 0, y: home.radius + 3, z: 0 } }, home)).toBeNull();
    const foreign = planets[1], local = settlementToPlanet(planetSpec(seed, foreign.radius), 'brass', s.grid.focusedTown!.spawn);
    const offworld: TravelState = { ...state, landedPlanetId: foreign.id,
      position: add(foreign.center, add(local, scale(normalize(local), 3))) };
    expect(universeContactPatch(s, offworld, foreign)).toBeNull();
  });
});
