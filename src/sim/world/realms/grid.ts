import { VoxelGrid } from '../../physical/grid';
import { B } from '../../physical/blocks';
import { REALMS, REALM_CHUNK, REALM_SIZE, generateRealmChunk, realmAt, type RealmChunk, type RealmSpec } from './layout';

/** Same VoxelGrid contract as the inhabited world, with a bounded descriptor cache.
 * Eviction drops derived geography only; edits and doors retain canonical identity. */
export class RealmGrid extends VoxelGrid {
  private chunks = new Map<string, RealmChunk>();
  private edits = new Map<number, number>();
  constructor(readonly spec: RealmSpec) { super(8192 + REALM_SIZE, 176, REALM_SIZE, true); }
  chunk(realm: keyof typeof REALMS, cx: number, cz: number): RealmChunk {
    const key = `${realm}:${cx},${cz}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = generateRealmChunk(this.spec, realm, cx, cz);
      if (this.chunks.size >= 128) this.chunks.delete(this.chunks.keys().next().value!);
      this.chunks.set(key, c);
    }
    return c;
  }
  get cachedChunks(): number { return this.chunks.size; }
  evict(): void { this.chunks.clear(); }
  override get(x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isInteger)) return B.Air;
    const realm = realmAt(x, z);
    if (!realm || y < 0) return B.Stone;
    if (y >= this.H) return B.Air;
    const edit = this.edits.get(this.idx(x, y, z)); if (edit !== undefined) return edit;
    if (y === 0) return B.Stone;
    const c = this.chunk(realm, Math.floor((x - REALMS[realm].offset) / REALM_CHUNK), Math.floor(z / REALM_CHUNK));
    for (const b of c.buildings) {
      if (x < b.x || x >= b.x + b.w || z < b.z || z >= b.z + b.d) continue;
      const doorWidth = b.use === 'tower' ? 5 : 3;
      if (z === b.door.z && x >= b.door.x - Math.floor(doorWidth / 2) && x < b.door.x + Math.ceil(doorWidth / 2) && y < (b.use === 'tower' ? 8 : 4)) {
        // A single canonical door controls the full opening, including body height.
        if (x === b.door.x && y === 1) return B.Door;
        const open = this.doorStates.get(this.idx(b.door.x, 1, b.door.z)) ?? false;
        return open ? B.Air : B.Plaster;
      }
      if (b.solids.some(s => x + .5 >= s.x && x + .5 < s.x + s.w && y + .5 >= s.y && y + .5 < s.y + s.h && z + .5 >= s.z && z + .5 < s.z + s.d)) return B.Stone;
    }
    return B.Air;
  }
  override set(x: number, y: number, z: number, id: number): void {
    if (!this.inBounds(x, y, z)) return;
    const i = this.idx(x, y, z); this.edits.set(i, id);
    if (this.recording) this.diffs.set(i, id);
    this.markDirty(x, z);
  }
  override isDoorOpen(x: number, y: number, z: number): boolean { return this.doorStates.get(this.idx(x, y, z)) ?? false; }
  override setDoorOpen(x: number, y: number, z: number, open: boolean): boolean {
    const realm = realmAt(x, z); if (!realm || y !== 1) return false;
    const c = this.chunk(realm, Math.floor((x - REALMS[realm].offset) / REALM_CHUNK), Math.floor(z / REALM_CHUNK));
    if (!c.buildings.some(b => b.door.x === x && b.door.z === z) || this.isDoorOpen(x, y, z) === open) return false;
    this.doorStates.set(this.idx(x, y, z), open); this.markDirty(x, z); return true;
  }
  override restoreDoorStates(states: [number, boolean][]): void {
    for (const [i, open] of states) {
      const y = i % this.H, col = (i - y) / this.H;
      this.setDoorOpen(Math.floor(col / this.D), y, col % this.D, open);
    }
  }
  override initCaches(): void { /* Never allocate a continent-sized dense cache. */ }
  override groundHeight(x: number, z: number): number { return realmAt(x, z) ? 0 : -1; }
}
