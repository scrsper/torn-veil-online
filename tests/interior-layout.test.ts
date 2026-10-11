import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { planFloor } from '../src/web/arena/tower/floorgen';
import { INTERIOR_NAMESPACE, interiorOrigin, interiorSlot, interiorVoxel, planInterior, type InteriorDescriptor } from '../src/sim/world/interiors/layout';
import { B } from '../src/sim/physical/blocks';
import { VoxelGrid } from '../src/sim/physical/grid';
import { Navigator } from '../src/sim/physical/nav';
import { predictMovement } from '../src/sim/physical/prediction';
import { FoldedRealmGrid, emptyInteriors, validInteriorRegistry } from '../src/sim/world/interiors/grid';

const descriptor = (floor = 1, seed = 317, slot = 0): InteriorDescriptor => ({ version: 1, id: `tower:review:floor:${floor}`, buildingId: 'aether:32:32:tower', seed, floor, slot });
function physical(d: InteriorDescriptor) {
  const plan = planInterior(d);
  class InteriorGrid extends VoxelGrid {
    constructor() { super(14336, 176, 6144, true); }
    override get(x: number, y: number, z: number) { return interiorVoxel(plan, x, y, z) ?? B.Stone; }
    override groundHeight(x: number, z: number) { return interiorVoxel(plan, x, 0, z) === undefined ? -1 : 0; }
  }
  const grid = new InteriorGrid(), nav = new Navigator(grid);
  return { plan, grid, nav };
}

describe('canonical folded-interior geometry', () => {
  it('preserves every existing Tower floor descriptor for established seeds across the extraction', () => {
    // Captured from unmodified floorgen at 0ee4660, before moving its room grammar.
    // Geographic save compatibility needs a baseline, not two calls to the same function.
    for (const [seed, expected] of [
      [317, '161c6af3f4b5e5b238e7491367f2ede7ef7731f4193b41636fbd814e84ba8e60'],
      [918271, '893301b50c03bde8c4c8d8329361926925b4116b31f039177a8d790202764bca'],
    ] as const) {
      const plans = Array.from({ length: 101 }, (_, floor) => planFloor(seed, floor));
      expect(createHash('sha256').update(JSON.stringify(plans)).digest('hex')).toBe(expected);
    }
  });
  it('has explicit non-overlapping capacity and retains the current grid dimensions', () => {
    const addresses = new Set<string>();
    for (let slot = 0; slot < INTERIOR_NAMESPACE.capacity; slot++) {
      const p = interiorOrigin(slot); expect(interiorSlot(p.x, p.z)).toBe(slot); addresses.add(`${p.x},${p.z}`);
      expect(p.x).toBeGreaterThan(6144); expect(p.x).toBeLessThan(8192); expect(p.z).toBeLessThan(6144);
    }
    expect(addresses.size).toBe(768); expect(interiorSlot(3120, 3090)).toBeNull(); expect(interiorSlot(11200, 3090)).toBeNull();
    expect(() => interiorOrigin(768)).toThrow(); expect(() => planInterior(descriptor(101))).toThrow();
  });
  it('reproduces IDs and geometry independently of generation order and JSON storage', () => {
    const d = descriptor(), first = planInterior(d); planInterior(descriptor(77, 42, 31));
    expect(planInterior(JSON.parse(JSON.stringify(d)))).toEqual(first);
    expect(planInterior(descriptor(1, 318)).solids).not.toEqual(first.solids);
    expect(new Set(first.solids.map(s => s.id)).size).toBe(first.solids.length);
  });
  it('keeps entrance, exit and room sources reachable through the actual navigation grid across scale bands', () => {
    for (const floor of [1, 5, 25, 50, 75, 100]) {
      const { plan, nav } = physical(descriptor(floor));
      expect(nav.isWalkable(Math.floor(plan.start.x), Math.floor(plan.start.z))).toBe(true);
      expect(nav.findPath(plan.start, plan.exit), `floor ${floor} exit`).not.toBeNull();
      for (const source of plan.sources) expect(nav.findPath(plan.start, source), `floor ${floor} source ${source.id}`).not.toBeNull();
    }
  });
  it('sweeps body collision against the declared physical partition solids', () => {
    const { plan, grid, nav } = physical(descriptor());
    const east = plan.solids.find(s => s.id.endsWith(':east'))!;
    let state = { pos: { x: east.x - 1, y: 1, z: plan.origin.z + plan.half - 3 }, yaw: 0, speed: 6, eligible: true };
    for (let i = 0; i < 10; i++) state = predictMovement(state, { x: 1, z: 0, sprint: true }, .1, (x, z) => ({ floor: nav.floorY(x, z), walkable: nav.isWalkable(x, z), solids: [1, 2, 3].filter(y => grid.isSolidAt(x, y, z)) }));
    expect(state.pos.x).toBeLessThan(east.x); expect(interiorVoxel(plan, east.x, 2, state.pos.z)).toBe(B.Stone);
  });
  it('bounds derived caches while retaining both realm and interior edits through storage/reload', () => {
    const registry = emptyInteriors(), grid = new FoldedRealmGrid({ version: 1, seed: 317 }, registry);
    for (let slot = 0; slot < 20; slot++) grid.register(descriptor(slot + 1, 317, slot));
    const start = grid.interior(descriptor().id).start;
    grid.recording = true; grid.set(Math.floor(start.x), 1, Math.floor(start.z), B.Crate); grid.set(3120, 1, 3092, B.Crate);
    for (const d of registry.descriptors) grid.interior(d.id);
    expect(grid.cachedInteriors).toBeLessThanOrEqual(12); grid.evict();
    const reloaded = new FoldedRealmGrid({ version: 1, seed: 317 }, JSON.parse(JSON.stringify(registry)));
    reloaded.applyDiffs(JSON.parse(JSON.stringify([...grid.diffs])));
    expect(reloaded.get(Math.floor(start.x), 1, Math.floor(start.z))).toBe(B.Crate);
    expect(reloaded.get(3120, 1, 3092)).toBe(B.Crate);
    expect(reloaded.get(8000, 1, 6000)).toBe(B.Stone);
    expect(reloaded.idx(3120, 1, 3092)).toBe(grid.idx(3120, 1, 3092));
    expect(() => reloaded.register({ ...descriptor(), seed: 9 })).toThrow();
    expect(() => reloaded.register({ ...descriptor(), id: 'collision' })).toThrow();
  });
  it('rejects ambiguous registries and latent edits without reinterpreting existing physical state', () => {
    expect(validInteriorRegistry({ ...emptyInteriors(), descriptors: [descriptor(), descriptor()] })).toBe(false);
    expect(validInteriorRegistry({ ...emptyInteriors(), namespace: 'unversioned' })).toBe(false);
    const grid = new FoldedRealmGrid({ version: 1, seed: 317 }, emptyInteriors());
    grid.register(descriptor());
    const d = descriptor();
    // Equivalent JSON objects need not retain their property insertion order.
    grid.register({ slot: d.slot, floor: d.floor, seed: d.seed, buildingId: d.buildingId, id: d.id, version: 1 });
    expect(grid.interiors.descriptors).toHaveLength(1);
    const unallocated = interiorOrigin(1); grid.recording = true;
    grid.set(unallocated.x, 1, unallocated.z, B.Crate);
    expect(() => grid.register(descriptor(2, 317, 1))).toThrow('existing edits');
    expect(grid.get(unallocated.x, 1, unallocated.z)).toBe(B.Stone);
    expect(grid.diffs.get(grid.idx(unallocated.x, 1, unallocated.z))).toBe(B.Crate);
  });
});
