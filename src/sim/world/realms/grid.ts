import { VoxelGrid } from '../../physical/grid';
import { B } from '../../physical/blocks';
import { REALMS, REALM_CHUNK, REALM_SIZE, generateRealmChunk, realmAt, type RealmChunk, type RealmSpec } from './layout';
import {FOCUSED_GENERATOR,focusedTownPlan,type FocusedTownPlan} from '../assets/focusedLayouts';
import {FOCUSED_CATALOG,sceneGeometry,placementBounds} from '../assets/focusedRuntime';
import {StaticGeometry} from '../../physical/staticGeometry';
import {focusedTerrain,terrainTriangles,terrainJoinTriangles,type FocusedTerrain} from '../assets/focusedTerrain';
import type {Vec3} from '../../core/types';

/** Same VoxelGrid contract as the inhabited world, with a bounded descriptor cache.
 * Eviction drops derived geography only; edits and doors retain canonical identity. */
export class RealmGrid extends VoxelGrid {
  readonly focusedTown:FocusedTownPlan|null;
  readonly focusedGeometry:StaticGeometry|null;
  readonly focusedTerrain:FocusedTerrain|null;
  private chunks = new Map<string, RealmChunk>();
  private edits = new Map<number, number>();
  constructor(readonly spec: RealmSpec) { super(8192 + REALM_SIZE, 176, REALM_SIZE, true);
    if(spec.focusedKit&&(spec.focusedGeometrySha!==FOCUSED_CATALOG.geometrySha256||spec.focusedGenerator!==FOCUSED_GENERATOR))throw Error('Focused save requires its verified geometry and generator version');
    this.focusedTown=spec.focusedKit?focusedTownPlan(spec.seed):null;const sourceGeometry=this.focusedTown?sceneGeometry(this.focusedTown):null;
    this.focusedTerrain=sourceGeometry?focusedTerrain(this.focusedTown!.id+':terrain',sourceGeometry,{originX:REALMS.brass.offset,chunk:REALM_CHUNK}):null;
    this.focusedGeometry=sourceGeometry?new StaticGeometry([...sourceGeometry.triangles,...terrainTriangles(this.focusedTerrain!),...terrainJoinTriangles(this.focusedTerrain!)],this.focusedTerrain!.bounds):null;
  }
  override movementGeometryAt(x:number,z:number){return this.focusedGeometry?.contains(x,z)?this.focusedGeometry:null;}
  override isSolidAt(x:number,y:number,z:number):boolean{const geometry=this.movementGeometryAt(x,z);return geometry?geometry.blocked(x,y,z):super.isSolidAt(x,y,z);}
  override lineOfSight(a:Vec3,b:Vec3,maxDist=64):boolean{const geometry=this.movementGeometryAt(a.x,a.z)??this.movementGeometryAt(b.x,b.z);return geometry?Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<=maxDist&&geometry.lineClear(a,b):super.lineOfSight(a,b,maxDist);}
  override lineOfPassage(a:Vec3,b:Vec3,maxDist=64):boolean{const geometry=this.movementGeometryAt(a.x,a.z)??this.movementGeometryAt(b.x,b.z);return geometry?Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<=maxDist&&geometry.lineClear(a,b):super.lineOfPassage(a,b,maxDist);}
  chunk(realm: keyof typeof REALMS, cx: number, cz: number): RealmChunk {
    const key = `${realm}:${cx},${cz}`;
    let c = this.chunks.get(key);
    if (!c) {
      c = generateRealmChunk(this.spec, realm, cx, cz);
      if(this.focusedTerrain&&realm==='brass'){const bounds=this.focusedTerrain.bounds;if(c.x<bounds.x1&&c.x+REALM_CHUNK>bounds.x0&&c.z<bounds.z1&&c.z+REALM_CHUNK>bounds.z0){c.focused=true;c.plaza=false;c.buildings=c.buildings.filter(b=>b.x+b.w<bounds.x0||b.x>bounds.x1||b.z+b.d<bounds.z0||b.z>bounds.z1);}}
      if (this.chunks.size >= 128) this.chunks.delete(this.chunks.keys().next().value!);
      this.chunks.set(key, c);
    }
    return c;
  }
  get cachedChunks(): number { return this.chunks.size; }
  evict(): void { this.chunks.clear(); }
  override get(x: number, y: number, z: number): number {
    if (![x, y, z].every(Number.isInteger)) return B.Air;
    const geometry=this.movementGeometryAt(x+.5,z+.5);if(geometry){const floor=geometry.supportAt(x+.5,z+.5,1);return floor!==null&&y+.5<floor?B.Stone:geometry.blocked(x+.5,y+.5,z+.5)?B.Stone:B.Air;}
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
