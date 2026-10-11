import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { RegionManager } from '../src/web/world/regionManager';
import { Cells } from '../src/web/world/structures';
import { footSurface } from '../src/web/audio/footfalls';

/** Exercise the real region/material query over the projected terrain/cell formats;
 * no GPU/material setup is needed by these read-only methods. */
function fixture(substrate = B.Cobble, wet = -1) {
  const cells = new Cells(0, 0);
  const grid = { n: 2, stride: 2, x0: 0, z0: 0, block: new Uint8Array(4).fill(substrate), water: new Float32Array([-1, -1, -1, wet]) };
  const regions = Object.assign(Object.create(RegionManager.prototype), { regionSize: 256, regions: new Map([['0,0', { cells, terrain: { grid } }]]) }) as RegionManager;
  const sound = (y: number) => footSurface(regions.supportBlockAt(.5, y, .5), true);
  return { cells, regions, sound };
}

describe('projected supporting surface for Foley', () => {
  it('hears an upper wooden floor over its cobble substrate, but not an overhead roof', () => {
    const f = fixture(); f.cells.set(0, 3, 0, B.Planks); f.cells.set(0, 8, 0, B.DarkPlanks);
    expect(f.sound(4)).toBe('wood'); expect(f.sound(1)).toBe('stone');
  });
  it('retains stone floors indoors instead of guessing that every interior is wood', () => {
    const f = fixture(B.Grass); f.cells.set(0, 3, 0, B.StoneBrick);
    expect(f.sound(4)).toBe('stone');
  });
  it('uses the drawn water quad even when only the far corner has water', () => {
    const f = fixture(B.Grass, 2);
    expect(f.regions.blockAt(.5, .5)).toBe(B.Grass);
    expect(f.sound(1)).toBe('water');
  });
  it('keeps a bridge above water wooden and submerged support wet', () => {
    const f = fixture(B.Grass, 2); f.cells.set(0, 3, 0, B.Planks); f.cells.set(0, 0, 0, B.Planks);
    expect(f.sound(4)).toBe('wood'); expect(f.sound(1)).toBe('water');
  });
  it('does not use a wall, non-solid prop or unloaded region as supporting floor', () => {
    const f = fixture(); f.cells.set(0, 1, 0, B.Planks); f.cells.set(0, 0, 0, B.Table);
    expect(f.sound(1)).toBe('stone');
    expect(f.regions.supportBlockAt(300, 1, 0)).toBeNull();
  });
});
