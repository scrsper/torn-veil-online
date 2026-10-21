import { describe, expect, it } from 'vitest';
import { RealmGrid } from '../../src/sim/world/realms/grid';
import { B } from '../../src/sim/physical/blocks';
import { StaticGeometry, type StaticTriangle } from '../../src/sim/physical/staticGeometry';
import {
  add, dot, FAR_ANCHOR, HOME_ANCHOR, length, normalize, planetSpec, scale, sub, type V3,
} from '../../src/sim/world/planet/planet';
import { AETHER_CHART } from '../../src/sim/world/planet/aether';
import { realmToPlanet } from '../../src/sim/world/planet/chart';
import {
  CANONICAL_SETTLEMENT_CHARTS, planetDirectionToSettlement, planetToSettlement, settlementAt,
  settlementDirectionToPlanet, settlementGroundAt, settlementPatches, settlementSaveValidator, settlementToPlanet, sweepSettlements,
  type SettlementGrid, type SettlementShape,
} from '../../src/sim/world/universe/settlements';

const spec = planetSpec(20261017);
const walk: SettlementShape = { radius: .3, height: 1.8, footOffset: 0, mode: 'walk' };
const sphere: SettlementShape = { radius: .4, height: .8, footOffset: .4, mode: 'flight' };
const closePoint = (actual: V3, expected: V3) => {
  expect(actual.x).toBeCloseTo(expected.x, 6); expect(actual.y).toBeCloseTo(expected.y, 6); expect(actual.z).toBeCloseTo(expected.z, 6);
};

describe('canonical realm sphere charts', () => {
  it('preserves the exact brass and Aether chart origins and planar roundtrips', () => {
    const brass = CANONICAL_SETTLEMENT_CHARTS.brass, aether = CANONICAL_SETTLEMENT_CHARTS.aether;
    expect(brass.origin).toEqual({ x: 11312.5, z: 3092.5 });
    expect(aether.origin).toEqual({ x: 3120, z: 3120 });
    closePoint(settlementToPlanet(spec, 'brass', { ...brass.origin, y: 1 }), scale(HOME_ANCHOR, 1606));
    closePoint(settlementToPlanet(spec, 'aether', { ...aether.origin, y: 1 }), scale(FAR_ANCHOR, 1606));
    const global = { x: 3108.25, y: 18.75, z: 3199.5 };
    closePoint(settlementToPlanet(spec, 'aether', global), realmToPlanet(spec, AETHER_CHART, global.x - 3072, global.y, global.z - 3072));
    for (const realm of ['brass', 'aether'] as const) {
      const chart = CANONICAL_SETTLEMENT_CHARTS[realm];
      for (const x of [-200, 0, 143.999, 200]) for (const z of [-144, 0, 144]) for (const y of [1, 30, 280]) {
        const p = { x: chart.origin.x + x, y, z: chart.origin.z + z };
        closePoint(planetToSettlement(spec, realm, settlementToPlanet(spec, realm, p)), p);
      }
    }
    expect(() => settlementToPlanet(spec, 'brass', { x: brass.origin.x + Math.PI * spec.radius, y: 1, z: brass.origin.z })).toThrow(/invertible/);
    expect(() => planetToSettlement(spec, 'brass', scale(HOME_ANCHOR, -1606))).toThrow(/invertible/);
  });
  it('projects direction without a handedness flip and keeps finite patch seams explicit', () => {
    const at = { x: 11330.25, y: 2, z: 3190.75 }, forward = normalize({ x: .6, y: .1, z: .8 });
    const planetary = settlementToPlanet(spec, 'brass', at);
    const direction = settlementDirectionToPlanet(spec, 'brass', at, forward);
    expect(dot(planetDirectionToSettlement(spec, 'brass', planetary, direction), forward)).toBeCloseTo(1, 9);
    const patches = settlementPatches({ focusedGeometry: { bounds: { x0: 11200, x1: 11470, z0: 2970, z1: 3430 } } });
    expect(patches[0].bounds).toEqual({ x0: 11168, x1: 11470, z0: 2970, z1: 3430 });
    expect(patches[1].bounds).toEqual({ x0: 2976, x1: 3264, z0: 2976, z1: 3264 });
    expect(settlementAt(spec, settlementToPlanet(spec, 'aether', { x: 3264, y: 1, z: 3120 }), patches)?.patch.realm).toBe('aether');
    expect(settlementAt(spec, settlementToPlanet(spec, 'aether', { x: 3264.01, y: 1, z: 3120 }), patches)).toBeNull();
    expect(settlementAt(spec, { x: 0, y: 1700, z: 0 }, patches)).toBeNull();
  });
});

describe('live canonical settlement collision', () => {
  it('uses actual RealmGrid door state immediately, including at high traversal speed', () => {
    const grid = new RealmGrid({ version: 1, seed: spec.seed });
    const building = grid.chunk('aether', 32, 32).buildings.find(b => b.use === 'tower')!;
    const door = building.door;
    const from = settlementToPlanet(spec, 'aether', { x: door.x + .5, y: 1, z: door.z - 3 });
    const to = settlementToPlanet(spec, 'aether', { x: door.x + .5, y: 1, z: door.z + 3 });
    const closed = sweepSettlements(spec, grid, from, to, walk);
    expect(closed.collision?.reason).toBe('solid');
    expect(closed.collision!.t).toBeGreaterThan(0);
    expect(closed.collision!.t).toBeLessThan(1);
    expect(planetToSettlement(spec, 'aether', closed.position).z).toBeLessThan(door.z);
    expect(grid.setDoorOpen(door.x, 1, door.z, true)).toBe(true);
    const open = sweepSettlements(spec, grid, from, to, walk);
    expect(open.collision).toBeNull();
    closePoint(open.position, to);
    expect(open.support?.planar.y).toBe(1);
    expect(grid.setDoorOpen(door.x, 1, door.z, false)).toBe(true);
    expect(sweepSettlements(spec, grid, from, to, walk).collision?.reason).toBe('solid');
  });
  it('does not tunnel through an edited voxel wall or invent collision beyond the charted patch', () => {
    const grid = new RealmGrid({ version: 1, seed: spec.seed }), x0 = 3120, z = 3090;
    // Explicit ephemeral grid edits, not a generated stand-in collision world.
    for (let x = x0 - 55; x <= x0 + 55; x++) for (let zz = z - 2; zz <= z + 2; zz++)
      for (let y = 1; y <= 7; y++) grid.set(x, y, zz, B.Air);
    for (let zz = z - 2; zz <= z + 2; zz++) for (let y = 1; y <= 7; y++) grid.set(x0, y, zz, B.Stone);
    const from = settlementToPlanet(spec, 'aether', { x: x0 - 50, y: 3, z: z + .5 });
    const to = settlementToPlanet(spec, 'aether', { x: x0 + 50, y: 3, z: z + .5 });
    const result = sweepSettlements(spec, grid, from, to, sphere);
    expect(result.collision?.reason).toBe('solid');
    const stop = planetToSettlement(spec, 'aether', result.position);
    expect(stop.x).toBeGreaterThan(x0 - .5);
    expect(stop.x).toBeLessThanOrEqual(x0 - .39);
    const outsideA = settlementToPlanet(spec, 'aether', { x: 3300, y: 3, z: 3120 });
    const outsideB = settlementToPlanet(spec, 'aether', { x: 3350, y: 3, z: 3120 });
    expect(sweepSettlements(spec, grid, outsideA, outsideB, sphere).collision).toBeNull();
    expect(() => sweepSettlements(spec, grid, from, add(from, { x: 600, y: 0, z: 0 }), sphere)).toThrow(/budget/);
  });
  function sourceGrid(ceiling = false): { grid: SettlementGrid; center: V3 } {
    const center = { x: 11312.5, y: 1.4, z: 3092.5 }, x = center.x, z = center.z, triangles: StaticTriangle[] = [
      { p: [x - 20, 1.4, z - 20, x - 20, 1.4, z + 20, x + 20, 1.4, z + 20], support: true },
      { p: [x - 20, 1.4, z - 20, x + 20, 1.4, z + 20, x + 20, 1.4, z - 20], support: true },
      { p: [x + 5, 1.4, z - 10, x + 5, 8, z - 10, x + 5, 8, z + 10], support: false },
      { p: [x + 5, 1.4, z - 10, x + 5, 8, z + 10, x + 5, 1.4, z + 10], support: false },
    ];
    if (ceiling) triangles.push(
      { p: [x - 2, 3, z - 2, x + 2, 3, z - 2, x + 2, 3, z + 2], support: false },
      { p: [x - 2, 3, z - 2, x + 2, 3, z + 2, x - 2, 3, z + 2], support: false },
    );
    const geometry = new StaticGeometry(triangles, { x0: x - 20, x1: x + 20, z0: z - 20, z1: z + 20 });
    return { grid: { H: 176, focusedGeometry: geometry,
      movementGeometryAt: (xx, zz) => geometry.contains(xx, zz) ? geometry : null,
      isSolidAt: (_xx, yy) => yy < 1 }, center };
  }
  it('uses authoritative source triangles for thin walls, real floor support and headroom', () => {
    const { grid, center } = sourceGrid();
    const from = settlementToPlanet(spec, 'brass', { ...center, x: center.x - 10, y: 3 });
    const to = settlementToPlanet(spec, 'brass', { ...center, x: center.x + 10, y: 3 });
    const flight = sweepSettlements(spec, grid, from, to, sphere);
    expect(flight.collision?.reason).toBe('solid');
    expect(planetToSettlement(spec, 'brass', flight.position).x).toBeLessThan(center.x + 5);
    const start = settlementToPlanet(spec, 'brass', { ...center, x: center.x - 10 });
    const end = settlementToPlanet(spec, 'brass', { ...center, x: center.x - 5, y: 1 });
    const walking = sweepSettlements(spec, grid, start, end, walk);
    expect(walking.collision).toBeNull();
    expect(walking.support?.planar.y).toBeCloseTo(1.4, 8);
    expect(planetToSettlement(spec, 'brass', walking.position).y).toBeCloseTo(1.4, 8);
    const low = sourceGrid(true), below = settlementToPlanet(spec, 'brass', low.center);
    const refused = sweepSettlements(spec, low.grid, below, below, walk);
    expect(refused.collision?.reason).toBe('solid');
    expect(refused.headroom).toBe(false);
    // No renderer, network model, or asset-loader state participates in any result.
    expect(sweepSettlements(spec, grid, from, to, sphere)).toEqual(flight);
    const validate = settlementSaveValidator(spec, grid);
    const supported = add(settlementToPlanet(spec, 'brass', center), scale(normalize(settlementToPlanet(spec, 'brass', center)), 3));
    expect(validate('body', supported, 0, 'surface')).toBe(true);
    expect(validate('body', add(supported, scale(normalize(supported), .3)), 0, 'surface')).toBe(false);
    expect(validate('body', settlementToPlanet(spec, 'brass', { ...center, y: -50 }), 0, 'flight')).toBe(false);
    expect(validate('body', scale(normalize(supported), 30000), 0, 'surface')).toBeUndefined();
    expect(validate('body', supported, 1, 'surface')).toBeUndefined();
    const ground = settlementGroundAt(spec, grid, add(supported, scale(normalize(supported), 30)))!;
    expect(ground.planar.y).toBeCloseTo(1.4, 8);
    expect(ground.height).toBeCloseTo(6.4, 8);
    expect(settlementGroundAt(spec, grid, scale(normalize(supported), 30000))).toBeNull();
  });
});
