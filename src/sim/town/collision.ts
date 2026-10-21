import { footprintBlocked, footprintFloor, libraryFootprint, type Footprint } from '../world/assets/libraryCollision';
import { placeRect, terrainHeight, toLocal, type Collider, type LibraryPlace, type TownLayout } from './layout';

/** Walker collision for the town: the library GLBs' cooked footprints (blocking cells and
 * walkable floors, keyed by sha256), the plan's prop colliders, and the playable ring.
 * Independent of what the browser has loaded. Pure and deterministic. */
interface Placed { p: LibraryPlace; f: Footprint; rect: { x0: number; x1: number; z0: number; z1: number } }
export interface Circle { x: number; z: number; r: number }
const GRID = 8;
export class TownCollision {
  private placed: Placed[] = [];
  private cells = new Map<number, Collider[]>();
  constructor(readonly layout: TownLayout) {
    for (const p of layout.library) { const f = libraryFootprint(p.assetId); if (f) this.placed.push({ p, f, rect: placeRect(p, 1) }); }
    for (const c of layout.colliders) {
      const r = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
      for (let i = Math.floor((c.x - r) / GRID); i <= Math.floor((c.x + r) / GRID); i++) for (let k = Math.floor((c.z - r) / GRID); k <= Math.floor((c.z + r) / GRID); k++) {
        const key = (i + 1000) * 4000 + (k + 1000); let list = this.cells.get(key); if (!list) this.cells.set(key, list = []); list.push(c);
      }
    }
  }
  private near(x: number, z: number): Collider[] { return this.cells.get((Math.floor(x / GRID) + 1000) * 4000 + Math.floor(z / GRID) + 1000) ?? []; }
  /** Whether a body of radius r at (x, z) overlaps anything solid. `extra` adds moving bodies (NPCs). */
  blocked(x: number, z: number, r = .35, extra: readonly Circle[] = []): boolean {
    const b = this.layout.bounds; if (Math.hypot(x - b.x, z - b.z) > b.r - r) return true;
    for (const c of this.near(x, z)) if (overlaps(c, x, z, r)) return true;
    for (const c of extra) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return true;
    for (const q of this.placed) {
      if (x < q.rect.x0 || x > q.rect.x1 || z < q.rect.z0 || z > q.rect.z1) continue;
      for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * .7, r * .7], [-r * .7, r * .7], [r * .7, -r * .7], [-r * .7, -r * .7]]) {
        const [lx, lz] = toLocal(q.p, x + ox, z + oz); if (footprintBlocked(q.f, lx, lz)) return true;
      }
    }
    return false;
  }
  /** Ground under (x, z): the terrain, raised by any library walkable floor (porches, decks, paving). */
  groundAt(x: number, z: number): number {
    let y = terrainHeight(x, z);
    for (const q of this.placed) {
      if (x < q.rect.x0 || x > q.rect.x1 || z < q.rect.z0 || z > q.rect.z1) continue;
      const [lx, lz] = toLocal(q.p, x, z), h = footprintFloor(q.f, lx, lz);
      if (h !== null && h > 0 && h < 1.2) y = Math.max(y, h);
    }
    return y;
  }
  /** Move by (dx, dz) with sliding: full move, else each axis alone, in small sub-steps. */
  move(x: number, z: number, dx: number, dz: number, r = .35, extra: readonly Circle[] = []): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * .5)));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.blocked(x + sx, z + sz, r, extra)) { x += sx; z += sz; continue; }
      if (sx && !this.blocked(x + sx, z, r, extra)) { x += sx; continue; }
      if (sz && !this.blocked(x, z + sz, r, extra)) { z += sz; continue; }
      break;
    }
    return [x, z];
  }
}
function overlaps(c: Collider, x: number, z: number, r: number): boolean {
  if (c.type === 'circle') return Math.hypot(c.x - x, c.z - z) < c.r + r;
  const [lx, lz] = toLocal(c, x, z), qx = Math.max(-c.hw, Math.min(c.hw, lx)), qz = Math.max(-c.hd, Math.min(c.hd, lz));
  return Math.hypot(lx - qx, lz - qz) < r;
}
