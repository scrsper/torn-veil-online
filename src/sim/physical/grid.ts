import { B, blockDef, BLOCKS } from './blocks';
import type { Vec3 } from '../core/types';

/** The canonical voxel substance of the physical world. Chunked so the renderer can rebuild locally. */
export const CHUNK = 16;
export class VoxelGrid {
  readonly data: Uint8Array;
  readonly dirtyChunks = new Set<number>();
  readonly diffs = new Map<number, number>(); // modifications relative to generation (for persistence)
  recording = false;
  constructor(public readonly W: number, public readonly H: number, public readonly D: number) {
    this.data = new Uint8Array(W * H * D);
  }
  idx(x: number, y: number, z: number): number { return (x * this.D + z) * this.H + y; }
  inBounds(x: number, y: number, z: number): boolean { return x >= 0 && z >= 0 && y >= 0 && x < this.W && z < this.D && y < this.H; }
  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return y < 0 ? B.Stone : B.Air;
    return this.data[(x * this.D + z) * this.H + y];
  }
  set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    const i = (x * this.D + z) * this.H + y;
    if (this.data[i] === id) return;
    this.data[i] = id;
    if (this.recording) this.diffs.set(i, id);
    this.markDirty(x, z);
    if ((x & (CHUNK - 1)) === 0) this.markDirty(x - 1, z);
    if ((x & (CHUNK - 1)) === CHUNK - 1) this.markDirty(x + 1, z);
    if ((z & (CHUNK - 1)) === 0) this.markDirty(x, z - 1);
    if ((z & (CHUNK - 1)) === CHUNK - 1) this.markDirty(x, z + 1);
    this.heightCache[x * this.D + z] = -1;
  }
  markDirty(x: number, z: number): void {
    if (x < 0 || z < 0 || x >= this.W || z >= this.D) return;
    this.dirtyChunks.add((x >> 4) * 1024 + (z >> 4));
  }
  applyDiffs(diffs: [number, number][]): void {
    for (const [i, id] of diffs) {
      const y = i % this.H; const xz = (i - y) / this.H; const z = xz % this.D; const x = (xz - z) / this.D;
      this.set(x, y, z, id); this.diffs.set(i, id);
    }
  }
  private heightCache = new Int16Array(0);
  initCaches(): void { this.heightCache = new Int16Array(this.W * this.D).fill(-1); }
  /** Highest solid block y at column (x,z) */
  groundHeight(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.W || z >= this.D) return 0;
    const ci = x * this.D + z;
    if (this.heightCache.length && this.heightCache[ci] >= 0) return this.heightCache[ci];
    for (let y = this.H - 1; y >= 0; y--) {
      const b = this.data[(x * this.D + z) * this.H + y];
      if (b !== B.Air && BLOCKS[b].solid && BLOCKS[b].shape !== 'cross' && b !== B.Fence) { if (this.heightCache.length) this.heightCache[ci] = y; return y; }
    }
    return 0;
  }
  /** Walk surface height for an agent standing at x,z: top of the highest solid block + 1. */
  surfaceY(x: number, z: number): number { return this.groundHeight(Math.floor(x), Math.floor(z)) + 1; }
  isSolidAt(x: number, y: number, z: number): boolean { return blockDef(this.get(Math.floor(x), Math.floor(y), Math.floor(z))).solid; }
  isOpaqueAt(x: number, y: number, z: number): boolean { return blockDef(this.get(Math.floor(x), Math.floor(y), Math.floor(z))).opaque; }

  /** DDA raycast through opaque blocks. Returns true if the segment is unobstructed. */
  lineOfSight(a: Vec3, b: Vec3, maxDist = 64): boolean {
    let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    if (dist > maxDist) return false;
    dx /= dist; dy /= dist; dz /= dist;
    let x = Math.floor(a.x), y = Math.floor(a.y), z = Math.floor(a.z);
    const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity, tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity, tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((stepX > 0 ? x + 1 - a.x : a.x - x) * tDeltaX) : Infinity;
    let tMaxY = dy !== 0 ? ((stepY > 0 ? y + 1 - a.y : a.y - y) * tDeltaY) : Infinity;
    let tMaxZ = dz !== 0 ? ((stepZ > 0 ? z + 1 - a.z : a.z - z) * tDeltaZ) : Infinity;
    let t = 0; let guard = 0;
    while (t < dist && guard++ < 400) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
      if (t >= dist) break;
      if (blockDef(this.get(x, y, z)).opaque) return false;
    }
    return true;
  }
  /** Raycast for interaction: returns the first solid block hit and the face normal. */
  raycastBlock(origin: Vec3, dir: Vec3, maxDist: number): { x: number; y: number; z: number; nx: number; ny: number; nz: number; dist: number } | null {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity, tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity, tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX) : Infinity;
    let tMaxY = dir.y !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY) : Infinity;
    let tMaxZ = dir.z !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ) : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0, guard = 0;
    while (t < maxDist && guard++ < 200) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
      else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      const b = this.get(x, y, z);
      if (b !== B.Air && (blockDef(b).solid || blockDef(b).shape !== 'cube')) return { x, y, z, nx, ny, nz, dist: t };
    }
    return null;
  }
}
