import { describe, expect, it } from 'vitest';
import { atlasSoleSupport, UniverseFootSupport } from '../../src/web/universe/contactSupport';
import { add, sub, scale, normalize, tangentFrame, dot, cross, length, type V3 } from '../../src/sim/world/planet/planet';
import { generateSystem, universeSpec, landingSite, terrainHeight } from '../../src/sim/world/universe/generation';
import type { UniverseContactPatch } from '../../src/server/universeContacts';
import { ATLAS_ASSETS, ATLAS_REVISION } from '../../src/sim/world/atlas';
import { atlasWalkSupport } from '../../src/sim/world/atlas/collision';
import { atlasLocalToWorld, atlasPlacementBasis, type AtlasPlacement } from '../../src/sim/world/atlas/placement';

const planet = generateSystem(universeSpec(42), 0).planets[0];
function fixture(up: V3, origin: V3, slope = 0) {
  const frame = tangentFrame(up), transform = (x: number, y: number, z: number) =>
    add(add(scale(frame.east, x), scale(up, y)), scale(frame.north, z));
  const at = (x: number, z: number) => transform(x, slope * x, z);
  const flatten = (points: V3[]) => points.flatMap(p => [p.x, p.y, p.z]);
  const patch: UniverseContactPatch = { id: 'floor', planetId: planet.id, origin, radius: 1.45, available: true, reason: 'ready',
    triangles: [flatten([at(-1, -1), at(1, -1), at(-1, 1)]), flatten([at(1, -1), at(1, 1), at(-1, 1)])] };
  // The tangent basis may be left-handed. Preserve outward support winding.
  if (dot(cross(sub(at(1, -1), at(-1, -1)), sub(at(-1, 1), at(-1, -1))), up) < 0) {
    patch.triangles = patch.triangles.map(p => [...p.slice(0, 3), ...p.slice(6, 9), ...p.slice(3, 6)]);
  }
  return { patch, transform };
}

describe('radial visual support uses real floor evidence', () => {
  it('preserves measured slopes and absolute coordinates across rotated latitude and distant origin', () => {
    for (const up of [{ x: 0, y: 1, z: 0 }, normalize({ x: 2, y: -3, z: 5 })]) {
      const origin = { x: 800000, y: -35000, z: 900000 }, { patch, transform } = fixture(up, origin, .1);
      const sampler = new UniverseFootSupport(); sampler.setPatch(patch);
      const point = add(origin, transform(.2, .16, .1)), before = structuredClone(patch);
      const hit = sampler.sample(planet, true, 1, point, up, .09, .3)!;
      expect(hit).not.toBeNull(); expect(length(sub(hit.point, add(origin, transform(.2, .02, .1))))).toBeLessThan(1e-7);
      expect(dot(hit.normal, up)).toBeCloseTo(1 / Math.sqrt(1.01), 7);
      expect(patch).toEqual(before);
    }
  });
  it('releases contact across gaps, stale patch boundaries, excessive reach and foreign worlds', () => {
    const up = { x: 0, y: 1, z: 0 }, { patch, transform } = fixture(up, { x: 0, y: 0, z: 0 });
    const sampler = new UniverseFootSupport(); sampler.setPatch(patch);
    for (const p of [transform(1.2, .1, 0), transform(0, .5, 0), transform(1.8, 0, 0)]) {
      expect(sampler.sample(planet, true, 1, p, up, .09, .3)).toBeNull();
    }
    expect(sampler.sample({ ...planet, id: 'foreign' }, true, 1, transform(0, .1, 0), up, .09, .3)).toBeNull();
    sampler.setPatch({ ...patch, id: 'unavailable', available: false, reason: 'budget', triangles: [] });
    expect(sampler.sample(planet, true, 1, transform(0, .1, 0), up, .09, .3)).toBeNull();
    sampler.setPatch(null);
    expect(sampler.sample(planet, true, 1, transform(0, .1, 0), up, .09, .3)).toBeNull();
  });
  it('rejects walls and a separated upper floor while retaining the nearby floor', () => {
    const up = { x: 0, y: 1, z: 0 }, { patch, transform } = fixture(up, { x: 0, y: 0, z: 0 });
    const upper = patch.triangles.map(p => p.map((v, i) => v + (i % 3 === 1 ? 3 : 0)));
    const sampler = new UniverseFootSupport(); sampler.setPatch({ ...patch, triangles: [...upper, ...patch.triangles, [0, 0, 0, 0, 2, 0, 0, 0, 2]] });
    const hit = sampler.sample(planet, true, 0, transform(.1, .1, .1), up, .09, .3)!;
    expect(hit.point.y).toBeCloseTo(0, 8);
  });
  it('does not extend a cached patch along a large source floor triangle', () => {
    const up = { x: 0, y: 1, z: 0 }, { patch } = fixture(up, { x: 0, y: 0, z: 0 });
    const sampler = new UniverseFootSupport(); sampler.setPatch({ ...patch,
      triangles: [[-10, 0, -10, -10, 0, 10, 10, 0, -10], [10, 0, -10, -10, 0, 10, 10, 0, 10]] });
    expect(sampler.sample(planet, true, 0, { x: 1.4, y: .1, z: 0 }, up, 0, .3)).not.toBeNull();
    expect(sampler.sample(planet, true, 0, { x: 1.4, y: .1, z: 0 }, up, .09, .3)).toBeNull();
    expect(sampler.sample(planet, true, 0, { x: 2, y: .1, z: 0 }, up, 0, .3)).toBeNull();
  });
  it('uses shared terrain outside towns but never substitutes it for missing town evidence', () => {
    const site = landingSite(planet), direction = normalize(site), sampler = new UniverseFootSupport();
    const floor = add(planet.center, scale(direction, planet.radius + Math.max(0, terrainHeight(planet, direction))));
    const point = add(floor, scale(direction, .1));
    const hit = sampler.sample(planet, false, 0, point, direction, .09, .3)!;
    expect(hit).not.toBeNull(); expect(length(sub(hit.point, floor))).toBeLessThan(1e-6);
    expect(sampler.sample(planet, true, 0, point, direction, .09, .3)).toBeNull();
  });
});

describe('Atlas sole support uses the actual cooked top face', () => {
  const asset = ATLAS_ASSETS.find(a => a.eligible && a.role === 'module' && a.height < .4
    && a.footprintRadius > 2 && a.proxy.boxes.length === 1)!;
  const box = asset.proxy.boxes[0];
  const floor = (up: V3, yaw: number): AtlasPlacement => ({
    id: 'test:sole-floor', assetId: asset.id, revision: 1, catalog: ATLAS_REVISION,
    position: add({ x: 1000, y: -2000, z: 3000 }, scale(up, asset.groundOffset)), up, yaw,
    scale: 1, footprintRadius: asset.footprintRadius, height: asset.height, solid: true, context: 'landmark', cell: 'test',
  });
  it('rejects an overhanging sole while preserving the canonical walker capsule support', () => {
    const up = { x: 0, y: 1, z: 0 }, p = floor(up, 0);
    const edge = atlasLocalToWorld(p, { x: box.max.x, y: box.min.y, z: (box.min.z + box.max.z) / 2 });
    const outside = add(edge, scale(atlasPlacementBasis(p).x, .1));
    expect(atlasWalkSupport([p], outside, up)).toBeCloseTo(asset.height, 8);
    expect(atlasSoleSupport([p], outside, up)).toBeNull();
    expect(atlasSoleSupport([p], edge, up)!.point.y - edge.y).toBeCloseTo(asset.height, 8);
  });
  it('preserves exact top geometry under yaw, distant origins and rotated radial frames', () => {
    for (const up of [{ x: 0, y: 1, z: 0 }, normalize({ x: 2, y: -3, z: 5 })]) {
      const p = floor(up, 1.17), before = structuredClone(p);
      const ground = atlasLocalToWorld(p, { x: .2, y: box.min.y, z: -.1 });
      const top = atlasLocalToWorld(p, { x: .2, y: box.max.y, z: -.1 });
      const hit = atlasSoleSupport([p], ground, up)!;
      expect(hit).not.toBeNull(); expect(length(sub(hit.point, top))).toBeLessThan(1e-8);
      expect(dot(hit.normal, up)).toBeCloseTo(1, 10); expect(p).toEqual(before);
      expect(atlasSoleSupport([{ ...p, solid: false }], ground, up)).toBeNull();
      expect(atlasSoleSupport([{ ...p, position: add(p.position, scale(up, 1)) }], ground, up)).toBeNull();
    }
  });
  it('checks the ray intersection on the top rather than its ground projection', () => {
    const p = floor({ x: 0, y: 1, z: 0 }, .7), basis = atlasPlacementBasis(p);
    const axis = normalize(add(basis.y, scale(basis.x, .2)));
    const ground = atlasLocalToWorld(p, { x: box.max.x - .01, y: box.min.y, z: 0 });
    expect(atlasSoleSupport([p], ground, axis)).toBeNull();
    const inside = sub(ground, scale(basis.x, .1)), hit = atlasSoleSupport([p], inside, axis)!;
    expect(hit).not.toBeNull();
    expect(dot(sub(hit.point, p.position), basis.y)).toBeCloseTo(box.max.y, 8);
  });
});
