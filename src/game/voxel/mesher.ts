import * as THREE from 'three';
import { B, BLOCKS, type BlockDef } from '../../sim/physical/blocks';
import { VoxelGrid, CHUNK } from '../../sim/physical/grid';
import { hash2 } from '../../sim/core/rng';
import { channelOf, familyOf, MESH_FAMILIES } from '../presentation/style';
import { surfaceMaterial, surfaceTex, type SurfaceFamily } from '../presentation/textures';

/**
 * A region of the world that is being drawn WITHOUT its upper geometry — the roof (and anything
 * above `y`) of one building, so an elevated camera can see into the room the player is standing
 * in. Purely a presentation mask: the blocks are still there in the canonical grid, and nothing
 * outside this box is affected.
 */
export interface RevealBox { x0: number; x1: number; z0: number; z1: number; y: number; }

/**
 * Builds chunk meshes from the canonical voxel grid.
 *
 * v0.11: this is no longer the only renderer of the world. Terrain, vegetation and building
 * roofs are drawn by the semantic skins in `game/presentation/`, and the mesher deliberately
 * emits nothing for the cells they own (`style.ts`'s channel table, plus the `skinned` cell set
 * a skin registers for cells it claims dynamically). What is left here is the built fabric —
 * walls, floors, furniture, fixtures, water — now split into one geometry per material family
 * so each can carry its own texture, roughness and normal map instead of a single flat colour.
 */
export class ChunkMesher {
  constructor(private grid: VoxelGrid) {}
  /** Set by `VoxelRenderer`; see `RevealBox`. */
  reveal: RevealBox | null = null;
  /** Grid indices claimed by a semantic skin (building roofs). Read as air; see `at`. */
  skinned: Set<number> | null = null;

  /**
   * The block at (x,y,z) AS DRAWN BY THIS MESHER — the canonical block, except where a
   * presentation layer above it has taken responsibility: inside the current reveal box above
   * its cut height, or in a cell some skin has claimed.
   *
   * Every read in this class goes through here, including the neighbour reads that decide face
   * culling and ambient occlusion. That is the whole point: if the mask were applied only where
   * geometry is emitted, the wall course just under the cut would still cull its top face against
   * a roof block that is no longer drawn, and the building would be visibly open at the seam.
   */
  private at(x: number, y: number, z: number): number {
    const r = this.reveal;
    if (r && y >= r.y && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return B.Air;
    if (this.skinned && this.grid.inBounds(x, y, z) && this.skinned.has(this.grid.idx(x, y, z))) return B.Air;
    return this.grid.get(x, y, z);
  }

  /**
   * The block at (x,y,z) as it exists for OCCLUSION purposes.
   *
   * A cell whose substance is drawn by another skin is still solid, opaque matter: the smoothed
   * ground under a floor, the tree trunk beside a wall. `at` reports air there so this mesher
   * does not draw it; this reports the truth so this mesher does not draw the faces hidden
   * behind it either. Without the distinction, hiding terrain would expose the underside of
   * every building foundation in the village.
   */
  private occluder(x: number, y: number, z: number): number {
    const r = this.reveal;
    if (r && y >= r.y && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return B.Air;
    if (this.skinned && this.grid.inBounds(x, y, z) && this.skinned.has(this.grid.idx(x, y, z))) return B.Air;
    const id = this.grid.get(x, y, z);
    // Foliage is porous by nature — a trunk should not seal the wall behind it.
    return channelOf(id) === 'foliage' ? B.Air : id;
  }

  build(cx: number, cz: number): { families: Map<SurfaceFamily, THREE.BufferGeometry>; water: THREE.BufferGeometry | null } {
    const g = this.grid; const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const builders = new Map<SurfaceFamily, GeoBuilder>();
    const gb = (id: number): GeoBuilder => {
      const f = familyOf(id);
      let b = builders.get(f); if (!b) { b = new GeoBuilder(surfaceTex(f).uvScale); builders.set(f, b); }
      return b;
    };
    const wa = new GeoBuilder(surfaceTex('grain').uvScale);
    for (let x = x0; x < x0 + CHUNK; x++) for (let z = z0; z < z0 + CHUNK; z++) for (let y = 0; y < g.H; y++) {
      const id = this.at(x, y, z); if (id === B.Air) continue;
      // Owned by a semantic skin (terrain surface, foliage, architecture): not this renderer's job.
      if (channelOf(id) !== 'voxel') continue;
      const def = BLOCKS[id];
      if (id === B.Water) { if (this.at(x, y + 1, z) !== B.Water) this.waterTop(wa, x, y, z); for (const [dx, dy, dz, f] of DIRS) { if (dy) continue; const n = this.occluder(x + dx, y + dy, z + dz); if (n === B.Air) this.face(wa, x, y, z, f, def, id, 0, 1, 0, 1, 0, 1, true); } continue; }
      const out = gb(id);
      switch (def.shape) {
        case 'cube': for (let i = 0; i < 6; i++) { const [dx, dy, dz, f] = DIRS[i]; const n = this.occluder(x + dx, y + dy, z + dz); const nd = BLOCKS[n]; if (n !== B.Air && nd.opaque && nd.shape === 'cube') continue; this.face(out, x, y, z, f, def, id, 0, 1, 0, 1, 0, 1, true); } break;
        case 'slab': this.box(out, x, y, z, def, id, 0, def.height ?? 0.5, 0, 1, 0, 1); break;
        case 'inset': { const i = def.inset ?? 0.2; this.box(out, x, y, z, def, id, 0, def.height ?? 1, i, 1 - i, i, 1 - i); break; }
        case 'post': { const h = def.height ?? 1; if (id === B.Torch) { this.box(out, x, y, z, def, id, 0, h, 0.42, 0.58, 0.42, 0.58); } else { this.box(out, x, y, z, def, id, 0, h, 0.35, 0.65, 0.35, 0.65); const nx = this.at(x + 1, y, z) === id, nz = this.at(x, y, z + 1) === id; if (nx) this.box(out, x, y, z, def, id, 0.55, 0.85, 0.5, 1.5, 0.42, 0.58); if (nz) this.box(out, x, y, z, def, id, 0.55, 0.85, 0.42, 0.58, 0.5, 1.5); } break; }
        case 'cross': this.cross(out, x, y, z, def, id); break;
      }
    }
    const families = new Map<SurfaceFamily, THREE.BufferGeometry>();
    for (const [f, b] of builders) { const geo = b.toGeometry(); if (geo) families.set(f, geo); }
    return { families, water: wa.toGeometry() };
  }

  private colorFor(def: BlockDef, id: number, x: number, y: number, z: number, face: number): [number, number, number] {
    let [r, g, b] = def.color;
    if (id === B.Bed && face === 2) { const c2 = def.color2!; const t = ((x + z) & 1) ? 0.9 : 0.2; r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t; }
    if (id === B.Bookshelf && face !== 2 && face !== 3) { const c2 = def.color2!; const t = ((x * 3 + y * 7 + z * 5) % 4 === 0) ? 0.7 : 0.15; r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t; }
    const n = def.noise ?? 0.03; const h = (hash2(x * 3 + face, z * 5 + y * 7, id) - 0.5) * 2 * n;
    return [Math.max(0, r + h), Math.max(0, g + h), Math.max(0, b + h)];
  }
  private ao(x: number, y: number, z: number, face: number, cornerA: number[], cornerB: number[], cornerC: number[]): number {
    const s = (dx: number, dy: number, dz: number) => { const b = this.occluder(x + dx, y + dy, z + dz); return b !== B.Air && BLOCKS[b].opaque && BLOCKS[b].shape === 'cube' ? 1 : 0; };
    const a = s(cornerA[0], cornerA[1], cornerA[2]), b = s(cornerB[0], cornerB[1], cornerB[2]), c = s(cornerC[0], cornerC[1], cornerC[2]);
    const v = (a && b) ? 0 : 3 - (a + b + c); return 0.55 + 0.45 * (v / 3);
  }
  private face(gb: GeoBuilder, x: number, y: number, z: number, f: number, def: BlockDef, id: number, y0: number, y1: number, x0: number, x1: number, z0: number, z1: number, withAO: boolean): void {
    const col = this.colorFor(def, id, x, y, z, f); const shade = FACE_SHADE[f];
    const em = def.emissive ?? [0, 0, 0];
    const verts = faceVerts(f, x + x0, y + y0, z + z0, x + x1, y + y1, z + z1);
    const N = FACE_NORMAL[f];
    const aos: number[] = [];
    for (let i = 0; i < 4; i++) {
      let ao = 1;
      if (withAO && def.shape === 'cube') { const cs = AO_CORNERS[f][i]; ao = this.ao(x, y, z, f, cs[0], cs[1], cs[2]); }
      aos.push(ao);
    }
    gb.quad(verts, N, col, shade, aos, em, f);
  }
  private box(gb: GeoBuilder, x: number, y: number, z: number, def: BlockDef, id: number, y0: number, y1: number, x0: number, x1: number, z0: number, z1: number): void {
    for (let f = 0; f < 6; f++) this.face(gb, x, y, z, f, def, id, y0, y1, x0, x1, z0, z1, false);
  }
  private cross(gb: GeoBuilder, x: number, y: number, z: number, def: BlockDef, id: number): void {
    const col = this.colorFor(def, id, x, y, z, 2); const em = def.emissive ?? [0, 0, 0];
    const h = def.height ?? 0.8; const o = (hash2(x, z, 9) - 0.5) * 0.3;
    const a = [x + 0.1 + o, y, z + 0.1, x + 0.9 + o, y + h, z + 0.9], b = [x + 0.9 + o, y, z + 0.1, x + 0.1 + o, y + h, z + 0.9];
    for (const q of [a, b]) {
      const vs = [[q[0], q[1], q[2]], [q[3], q[1], q[5]], [q[3], q[4], q[5]], [q[0], q[4], q[2]]];
      const n = [0, 1, 0];
      gb.quad(vs, n, col, 0.95, [0.85, 0.85, 1, 1], em, 2); gb.quad([vs[3], vs[2], vs[1], vs[0]], n, col, 0.95, [1, 1, 0.85, 0.85], em, 2);
    }
  }
  private waterTop(gb: GeoBuilder, x: number, y: number, z: number): void {
    const def = BLOCKS[B.Water]; const col = this.colorFor(def, B.Water, x, y, z, 2);
    gb.quad(faceVerts(2, x, y, z, x + 1, y + 0.85, z + 1), [0, 1, 0], col, 1, [1, 1, 1, 1], [0, 0, 0], 2);
  }
}

// face index: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const DIRS: [number, number, number, number][] = [[1, 0, 0, 0], [-1, 0, 0, 1], [0, 1, 0, 2], [0, -1, 0, 3], [0, 0, 1, 4], [0, 0, -1, 5]];
const FACE_SHADE = [0.86, 0.78, 1.0, 0.62, 0.92, 0.72];
const FACE_NORMAL = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function faceVerts(f: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
  switch (f) {
    case 0: return [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]];
    case 1: return [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
    case 2: return [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]];
    case 3: return [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    case 4: return [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    default: return [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]];
  }
}
// AO corner samples per face vertex (side1, side2, corner) relative offsets
const AO_CORNERS: number[][][][] = (() => {
  const out: number[][][][] = [];
  for (let f = 0; f < 6; f++) {
    const vs = faceVerts(f, 0, 0, 0, 1, 1, 1); const n = FACE_NORMAL[f]; const per: number[][][] = [];
    for (const v of vs) {
      // direction from block center to vertex, excluding normal axis
      const d = [v[0] * 2 - 1, v[1] * 2 - 1, v[2] * 2 - 1];
      const axes = [0, 1, 2].filter(a => n[a] === 0);
      const s1 = [0, 0, 0], s2 = [0, 0, 0], c = [0, 0, 0];
      s1[axes[0]] = d[axes[0]]; s2[axes[1]] = d[axes[1]]; c[axes[0]] = d[axes[0]]; c[axes[1]] = d[axes[1]];
      for (const a of [0, 1, 2]) if (n[a] !== 0) { s1[a] = n[a]; s2[a] = n[a]; c[a] = n[a]; }
      per.push([s1, s2, c]);
    }
    out.push(per);
  }
  return out;
})();

class GeoBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; em: number[] = []; uv: number[] = []; idx: number[] = [];
  constructor(private uvScale = 0.5) {}
  /**
   * `face` is the block-face index, used only to pick which two world axes become UV — a
   * world-space planar projection, which is what lets a shared tiling detail texture sit on
   * arbitrary block geometry without anyone authoring an atlas.
   */
  quad(v: number[][], n: number[], c: [number, number, number], shade: number, ao: number[], em: number[], face: number): void {
    const base = this.pos.length / 3;
    const s = this.uvScale;
    for (let i = 0; i < 4; i++) {
      const p = v[i];
      this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]);
      const k = shade * ao[i]; this.col.push(c[0] * k, c[1] * k, c[2] * k);
      this.em.push(em[0], em[1], em[2]);
      if (face === 2 || face === 3) this.uv.push(p[0] * s, p[2] * s);
      else if (face === 0 || face === 1) this.uv.push(p[2] * s, p[1] * s);
      else this.uv.push(p[0] * s, p[1] * s);
    }
    // flip quad diagonal for better AO interpolation
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }
  toGeometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aEmissive', new THREE.Float32BufferAttribute(this.em, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}

/**
 * The per-family chunk material. Vertex colour still carries the canonical palette colour and
 * baked AO; the family's generated `map`/`normalMap` supply the surface detail that stops a
 * wall reading as a coloured cube. The emissive vertex attribute (torches, fire, ovens) is
 * injected exactly as it was before.
 */
export function makeChunkMaterial(family: SurfaceFamily, transparent = false): THREE.MeshStandardMaterial {
  const m = surfaceMaterial(family, {
    transparent, opacity: transparent ? 0.72 : 1,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !transparent,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }; (m as unknown as { userData: Record<string, unknown> }).userData.shader = shader;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aEmissive; varying vec3 vEmissive; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEmissive = aEmissive;\n${transparent ? 'if (transformed.y - floor(transformed.y) > 0.5) transformed.y += sin(uTime * 1.5 + transformed.x * 1.3 + transformed.z * 0.9) * 0.05;' : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vEmissive;')
      .replace('#include <dithering_fragment>', 'gl_FragColor.rgb += vEmissive * (0.6 + 0.4 * abs(sin(gl_FragCoord.x * 0.05)));\n#include <dithering_fragment>');
  };
  return m;
}

/** Keeps three.js chunk meshes in sync with the grid's dirty set. */
export class VoxelRenderer {
  group = new THREE.Group();
  private meshes = new Map<number, { solid: Map<SurfaceFamily, THREE.Mesh>; water: THREE.Mesh | null }>();
  private mesher: ChunkMesher;
  private mats = new Map<SurfaceFamily, THREE.MeshStandardMaterial>();
  private matWater = makeChunkMaterial('grain', true);
  constructor(private grid: VoxelGrid) {
    this.mesher = new ChunkMesher(grid); this.group.name = 'voxels';
    for (const f of MESH_FAMILIES) this.mats.set(f, makeChunkMaterial(f));
  }
  buildAll(): void { for (let cx = 0; cx < this.grid.W / CHUNK; cx++) for (let cz = 0; cz < this.grid.D / CHUNK; cz++) this.rebuild(cx, cz); this.grid.dirtyChunks.clear(); }
  update(): void { if (!this.grid.dirtyChunks.size) return; for (const key of this.grid.dirtyChunks) this.rebuild(Math.floor(key / 1024), key % 1024); this.grid.dirtyChunks.clear(); }
  setTime(t: number): void {
    for (const m of [...this.mats.values(), this.matWater]) {
      const s = (m as unknown as { userData: { shader?: { uniforms: Record<string, { value: number }> } } }).userData.shader;
      if (s) s.uniforms.uTime.value = t;
    }
  }
  /**
   * Cells a semantic skin has claimed (currently building roofs — see `presentation/buildingSkin`).
   * Registered once, before `buildAll`; the mesher reads them as air so nothing is drawn twice.
   */
  setSkinned(cells: Set<number>): void { this.mesher.skinned = cells; }
  /**
   * v0.10 Part V / v0.10.1 Part III: draw ONE building without its roof, so an elevated camera
   * can see into the room the player is standing in.
   *
   * The reveal is a BOX (`RevealBox`, from the canonical `Place.bounds` of the building actually
   * occupied) applied in the mesher rather than in a shader, so what is left is a correctly-formed
   * building with its roof off: neighbouring geometry is untouched, and the walls of the revealed
   * room close properly at the cut because the mask is applied to neighbour reads too (see
   * `ChunkMesher.at`). v0.11 keeps this exactly as it was; the pitched roof mesh the building skin
   * now draws above these walls is hidden by the same signal (see `WorldSkin.setReveal`).
   */
  private reveal: RevealBox | null = null;
  setReveal(box: RevealBox | null): void {
    const a = this.reveal, b = box;
    if (a === b || (a && b && a.x0 === b.x0 && a.x1 === b.x1 && a.z0 === b.z0 && a.z1 === b.z1 && a.y === b.y)) return;
    this.reveal = b;
    this.mesher.reveal = b;
    // Rebuild every chunk the OLD box covered (to put the roof back) and every chunk the NEW one
    // covers (to take it off). Usually the same one to four chunks.
    const dirty = new Set<number>();
    for (const r of [a, b]) {
      if (!r) continue;
      for (let cx = Math.floor(r.x0 / CHUNK); cx <= Math.floor(r.x1 / CHUNK); cx++) {
        for (let cz = Math.floor(r.z0 / CHUNK); cz <= Math.floor(r.z1 / CHUNK); cz++) {
          if (cx >= 0 && cz >= 0 && cx < this.grid.W / CHUNK && cz < this.grid.D / CHUNK) dirty.add(cx * 1024 + cz);
        }
      }
    }
    for (const key of dirty) this.rebuild(Math.floor(key / 1024), key % 1024);
  }
  /** The building currently being drawn without its roof, or null. */
  get revealed(): RevealBox | null { return this.reveal; }

  private rebuild(cx: number, cz: number): void {
    const key = cx * 1024 + cz; const old = this.meshes.get(key);
    if (old) {
      for (const m of old.solid.values()) { this.group.remove(m); m.geometry.dispose(); }
      if (old.water) { this.group.remove(old.water); old.water.geometry.dispose(); }
    }
    const { families, water } = this.mesher.build(cx, cz);
    const entry = { solid: new Map<SurfaceFamily, THREE.Mesh>(), water: null as THREE.Mesh | null };
    for (const [f, geo] of families) {
      const m = new THREE.Mesh(geo, this.mats.get(f)!);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true;
      this.group.add(m); entry.solid.set(f, m);
    }
    if (water) { const m = new THREE.Mesh(water, this.matWater); m.receiveShadow = true; m.renderOrder = 2; this.group.add(m); entry.water = m; }
    this.meshes.set(key, entry);
  }
}
