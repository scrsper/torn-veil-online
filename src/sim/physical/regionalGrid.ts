import { VoxelGrid } from './grid';
import { B, BLOCKS } from './blocks';
import { valueNoise } from '../core/rng';

/** Dense inhabited patches over continuous, lazily evaluated wilderness. Coordinates remain
 * physical metres; unloaded terrain is real ground, not a wall or an inaccessible region. */
export class RegionalGrid extends VoxelGrid {
  readonly patches: { x: number; z: number; grid: VoxelGrid }[] = [];
  private edits = new Map<number, number>();
  constructor(W: number, D: number, readonly seed: number) {
    super(W, 48, D, true);
    if (!Number.isSafeInteger(W) || !Number.isSafeInteger(D) || W <= 0 || D <= 0 || !Number.isSafeInteger(W * D * 48)) {
      throw new Error('Regional grid dimensions exceed exact voxel indexing');
    }
  }
  addPatch(x: number, z: number, grid: VoxelGrid): void {
    this.patches.push({ x, z, grid });
    for (const [i, open] of grid.doorStates) {
      const y = i % grid.H, col = (i - y) / grid.H;
      this.doorStates.set(this.idx(x + Math.floor(col / grid.D), y, z + col % grid.D), open);
    }
  }
  override get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return y < 0 ? B.Stone : B.Air;
    const edit = this.edits.get(this.idx(x, y, z)); if (edit !== undefined) return edit;
    const patch = this.patches.find(p => x >= p.x && z >= p.z && x < p.x + p.grid.W && z < p.z + p.grid.D);
    if (patch) return patch.grid.get(x - patch.x, y, z - patch.z);
    const top = 10 + Math.floor(5 * valueNoise(x / 120, z / 120, this.seed));
    return y > top ? B.Air : y === top ? B.Grass : y > top - 3 ? B.Dirt : B.Stone;
  }
  override set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z) || this.get(x, y, z) === id) return;
    const i = this.idx(x, y, z);
    this.edits.set(i, id);
    if (id === B.Door) this.doorStates.set(i, false); else this.doorStates.delete(i);
    if (this.recording) this.diffs.set(i, id);
    this.markDirty(x, z);
  }
  override markDirty(x: number, z: number): void {
    if (x >= 0 && z >= 0 && x < this.W && z < this.D) this.dirtyChunks.add(Math.floor(x / 16) * Math.ceil(this.D / 16) + Math.floor(z / 16));
  }
  override initCaches(): void { /* Sparse terrain is evaluated on demand. */ }
  override groundHeight(x: number, z: number): number {
    for (let y = this.H - 1; y >= 0; y--) {
      const b = this.get(x, y, z);
      if (BLOCKS[b].solid && BLOCKS[b].shape !== 'cross' && b !== B.Fence && b !== B.Door) return y;
    }
    return 0;
  }
  override restoreDoorStates(states: [number, boolean][]): void {
    for (const [i, open] of states) {
      const y = i % this.H, col = (i - y) / this.H;
      if (this.get(Math.floor(col / this.D), y, col % this.D) === B.Door) this.doorStates.set(i, open);
    }
  }
}
