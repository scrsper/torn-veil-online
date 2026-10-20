import { describe, expect, it } from 'vitest';
import {
  add, cross, dot, HOME_ANCHOR, length, normalize, planetSpec, scale, sub, tangentFrame, type V3,
} from '../src/sim/world/planet/planet';
import { planetRoads } from '../src/sim/world/planet/roads';
import { cubeToDir } from '../src/sim/world/planet/scatter';
import { generateSystem, landingSite, terrainHeight, universeSpec } from '../src/sim/world/universe/generation';
import { applyTravelCommand, createTravelState, neutralInput, stepTravel, travelStatus } from '../src/sim/world/universe/travel';
import { validateUniversePayload } from '../src/sim/world/universe/persistence';
import { ATLAS_ASSETS, ATLAS_REVISION, getAtlasAsset } from '../src/sim/world/atlas';
import {
  atlasHomeReserved, atlasLocalToWorld, atlasPlacementBasis, atlasPlacementPolicy,
  atlasPlanetPlacements, atlasSpherePlacements, atlasTowerDecorations, type AtlasPlacement,
} from '../src/sim/world/atlas/placement';
import {
  atlasPlanetLandingClear, atlasPlanetSweep, atlasStepWalker, atlasSweepSphere, atlasSweepWalker, atlasWalkSupport,
} from '../src/sim/world/atlas/collision';

const spec = universeSpec(20261017), system = generateSystem(spec, 0), planet = system.planets[1];
const arc = (radius: number, a: V3, b: V3) => radius * Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const arrival = () => atlasPlanetPlacements(planet, landingSite(planet), 256);

describe('deterministic Atlas geography', () => {
  it('has stable IDs, native units, right-handed bases and frozen canonical placements', () => {
    const first = arrival();
    expect(first.length).toBeGreaterThan(10);
    const elsewhere = atlasPlanetPlacements(system.planets[2], { x: 1, y: 1, z: 1 }, 220);
    expect(elsewhere).toBeDefined();
    expect(arrival()).toEqual(first);
    expect(new Set(first.map(p => p.id)).size).toBe(first.length);
    for (const p of first) {
      const asset = getAtlasAsset(p.assetId)!;
      expect(p.scale).toBe(1);
      expect(p.catalog).toBe(ATLAS_REVISION);
      expect(asset.eligible).toBe(true);
      expect(asset.role).not.toBe('mob-draft');
      const basis = atlasPlacementBasis(p);
      expect(dot(cross(basis.x, basis.y), basis.z)).toBeCloseTo(1, 12);
      expect(length(p.position) - asset.groundOffset - planet.radius).toBeCloseTo(terrainHeight(planet, p.up), 8);
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.position)).toBe(true);
    }
  });
  it('queries bounded caps without changing placements at cube edges or poles', () => {
    const points = [
      normalize({ x: 1, y: 1, z: 1 }), normalize({ x: 1, y: 0, z: 1 }),
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, normalize(landingSite(planet)),
    ];
    let checked = 0;
    for (const dir of points) {
      const wide = atlasPlanetPlacements(planet, dir, 256);
      for (const p of wide) {
        const narrow = atlasPlanetPlacements(planet, p.up, 0);
        expect(narrow.some(q => q.id === p.id)).toBe(true);
        expect(arc(planet.radius, dir, p.up)).toBeLessThanOrEqual(256 + p.footprintRadius + 1e-5);
        checked++;
      }
      for (const p of atlasPlanetPlacements(planet, dir, 80))
        expect(wide.some(q => q.id === p.id)).toBe(true);
    }
    expect(checked).toBeGreaterThan(40);
    expect(() => atlasPlanetPlacements(planet, HOME_ANCHOR, 257)).toThrow();
    expect(() => atlasPlanetPlacements(planet, { x: NaN, y: 0, z: 0 }, 2)).toThrow();
    expect(() => atlasPlanetPlacements(planet, HOME_ANCHOR, 1, 2)).toThrow();
    expect(atlasPlanetPlacements(planet, HOME_ANCHOR, 256, 0)).toEqual([]);
  });
  it('keeps native parcel footprints disjoint within and between both population layers', () => {
    const placements = arrival();
    for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i], b = placements[j];
      expect(arc(planet.radius, a.up, b.up)).toBeGreaterThan(a.footprintRadius + b.footprintRadius);
    }
  });
  it('preserves authored home routes and every known universe arrival site', () => {
    const home = system.planets[0], original = planetSpec(spec.seed, home.radius);
    expect(atlasPlanetPlacements(home, HOME_ANCHOR, 100)).toEqual([]);
    for (const road of planetRoads(original)) for (let i = 0; i < road.points.length; i += 30)
      expect(atlasHomeReserved(original, road.points[i], 5)).toBe(true);
    for (const p of system.planets) {
      const site = landingSite(p);
      expect(atlasPlanetPlacements(p, site, 32)).toEqual([]);
      expect(atlasPlanetLandingClear(p, add(site, scale(normalize(site), 120)))).toBe(true);
    }
    const dir = cubeToDir(4, .6, .1);
    expect(atlasPlanetPlacements(home, dir, 150)).toEqual(atlasSpherePlacements(original, dir, 150));
  });
  it('uses actual native bounds on existing Tower supports and adds no route solids', () => {
    const supports = Array.from({ length: 8 }, (_, i) => ({
      id: `bench:${i}`, position: { x: i * 8, y: 1, z: 3 }, half: { x: 1.5, y: .5, z: .65 },
    }));
    const props = atlasTowerDecorations({ id: 'tower:known', seed: spec.seed, floor: 50, supports, limit: 8 });
    expect(props.length).toBe(8);
    expect(atlasTowerDecorations({ id: 'tower:known', seed: spec.seed, floor: 50, supports: [...supports].reverse(), limit: 8 })).toEqual(props);
    for (const p of props) {
      const support = supports.find(s => s.id === p.cell)!, asset = getAtlasAsset(p.assetId)!;
      expect(p.solid).toBe(false);
      for (const x of [asset.bounds.min.x, asset.bounds.max.x]) for (const z of [asset.bounds.min.z, asset.bounds.max.z]) {
        const v = atlasLocalToWorld(p, { x, y: asset.bounds.min.y, z });
        expect(Math.abs(v.x - support.position.x)).toBeLessThan(support.half.x);
        expect(Math.abs(v.z - support.position.z)).toBeLessThan(support.half.z);
        expect(v.y).toBeCloseTo(support.position.y + support.half.y, 8);
      }
    }
    const scenes = ATLAS_ASSETS.filter(a => !atlasPlacementPolicy(a, 'landmark'));
    expect(scenes.length).toBeGreaterThan(20);
    expect(scenes.every(a => a.proxy.kind === 'boxes')).toBe(true);
    expect(ATLAS_ASSETS.filter(a => a.role === 'mob-draft').every(a => atlasPlacementPolicy(a, 'scatter') === 'living-draft')).toBe(true);
  });
});

describe('Atlas collision and durable generation pins', () => {
  it('steps onto low native floors, down off them, and respects high steps, walls and headroom', () => {
    const asset = ATLAS_ASSETS.find(a => a.eligible && a.role === 'module' && a.height < .4 && a.footprintRadius > 2)!;
    const floor: AtlasPlacement = {
      id: 'test:existing-floor', assetId: asset.id, revision: 1, catalog: ATLAS_REVISION,
      position: { x: 0, y: asset.groundOffset, z: 0 }, up: { x: 0, y: 1, z: 0 }, yaw: 0,
      scale: 1, footprintRadius: asset.footprintRadius, height: asset.height, solid: true, context: 'landmark', cell: 'test',
    };
    const from = { x: -3, y: 0, z: 0 }, to = { x: -1, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 };
    const step = atlasStepWalker([floor], from, to, up);
    expect(step.blocked).toBe(false);
    expect(step.foot.y).toBeCloseTo(asset.height, 8);
    expect(atlasWalkSupport([floor], to, up)).toBeCloseTo(asset.height, 8);
    expect(atlasSweepWalker([floor], step.foot, step.foot, up)).toBeNull();
    const down = atlasStepWalker([floor], step.foot, from, up);
    expect(down.blocked).toBe(false); expect(down.foot).toEqual(from);
    const high = { ...floor, position: add(floor.position, { x: 0, y: .4, z: 0 }) };
    expect(atlasStepWalker([high], from, to, up).blocked).toBe(true);
    const ceiling = { ...floor, id: 'test:ceiling', position: add(floor.position, { x: 0, y: 2, z: 0 }) };
    expect(atlasStepWalker([floor, ceiling], from, to, up).blocked).toBe(true);
    const wallAsset = ATLAS_ASSETS.find(a => a.eligible && a.role === 'module' && a.height > 3 && a.footprintRadius < 1)!;
    const wall = { ...floor, id: 'test:wall', assetId: wallAsset.id, position: { x: 0, y: wallAsset.groundOffset, z: 0 } };
    expect(atlasStepWalker([floor, wall], from, { x: .5, y: 0, z: 0 }, up).blocked).toBe(true);
  });
  function obstacle(): { placement: AtlasPlacement; center: V3; across: V3 } {
    const placement = arrival().find(p => p.solid && getAtlasAsset(p.assetId)!.height > .6)!;
    const asset = getAtlasAsset(placement.assetId)!, box = asset.proxy.boxes[0];
    return { placement, center: atlasLocalToWorld(placement, scale(add(box.min, box.max), .5)), across: atlasPlacementBasis(placement).x };
  }
  it('sweeps a thin cooked box without any renderer or asset download', () => {
    const { placement, center, across } = obstacle();
    const from = sub(center, scale(across, 100)), to = add(center, scale(across, 100));
    const hit = atlasSweepSphere([placement], from, to, .4);
    expect(hit?.placementId).toBe(placement.id);
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.t).toBeLessThan(1);
    expect(atlasSweepSphere([placement], from, from, .4)).toBeNull();
    expect(atlasSweepWalker([placement], sub(center, scale(placement.up, .5)), sub(center, scale(placement.up, .5)), placement.up)).not.toBeNull();
    expect(atlasSweepSphere([{ ...placement, solid: false }], from, to, 3)).toBeNull();
    expect(atlasPlanetSweep(planet, from, to, .4)?.placementId).toBe(placement.id);
    expect(atlasPlanetSweep(planet, from, to, .4, 0)).toBeNull();
  });
  it('new saves pin placements and content; old saves retain terrain-only semantics', () => {
    const fresh = createTravelState(spec);
    expect(fresh.atlasRevision).toBe(1);
    expect(fresh.atlasCatalog).toBe(ATLAS_REVISION);
    expect(validateUniversePayload({ spec, state: fresh, revision: 0 }).state).toEqual(fresh);
    const legacy = structuredClone(fresh); delete legacy.atlasRevision; delete legacy.atlasCatalog;
    const loaded = validateUniversePayload({ spec, state: legacy, revision: 0 }).state;
    expect(loaded.atlasRevision).toBeUndefined();
    applyTravelCommand(spec, loaded, { type: 'launch' });
    for (let i = 0; i < 20; i++) stepTravel(spec, loaded, { ...neutralInput(), throttle: 1 });
    expect(loaded.atlasRevision).toBeUndefined();
    expect(() => validateUniversePayload({ spec, state: { ...fresh, atlasCatalog: 'changed-cook' }, revision: 0 })).toThrow(/Atlas/);
    expect(() => validateUniversePayload({ spec, state: { ...legacy, atlasCatalog: ATLAS_REVISION }, revision: 0 })).toThrow(/Atlas/);
    const replay = validateUniversePayload({ spec, state: fresh, revision: 0 }).state;
    for (let i = 0; i < 30; i++) { stepTravel(spec, fresh, { ...neutralInput(), throttle: 1 }); stepTravel(spec, replay, { ...neutralInput(), throttle: 1 }); }
    expect(replay).toEqual(fresh);
  });
  it('refuses ship landing through an obstacle and blocks a cruise-speed wall crossing', () => {
    const { placement, center, across } = obstacle(), state = createTravelState(spec);
    applyTravelCommand(spec, state, { type: 'launch' });
    state.position = add(planet.center, add(placement.position, scale(placement.up, 60)));
    state.velocity = { x: 0, y: 0, z: 0 };
    expect(atlasPlanetLandingClear(planet, sub(state.position, planet.center))).toBe(false);
    expect(travelStatus(spec, state).canLand).toBe(false);
    state.position = add(planet.center, sub(center, scale(across, 55)));
    state.forward = across; state.up = placement.up; state.velocity = scale(across, 2600);
    stepTravel(spec, state, { ...neutralInput(), throttle: 1 });
    expect(length(state.velocity)).toBe(0);
    expect(state.events.at(-1)?.type).toBe('collision');
    expect(dot(sub(state.position, add(planet.center, center)), across)).toBeLessThan(0);
  });
});
