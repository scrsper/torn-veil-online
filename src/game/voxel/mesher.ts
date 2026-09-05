import * as THREE from 'three';
import { B, BLOCKS, type BlockDef } from '../../sim/physical/blocks';
import { VoxelGrid, CHUNK } from '../../sim/physical/grid';
import { hash2 } from '../../sim/core/rng';

/** Builds chunk meshes from the canonical voxel grid: vertex colours, baked ambient occlusion, emissive attribute. */
export class ChunkMesher {
  constructor(private grid: VoxelGrid) {}

  build(cx: number, cz: number): { opaque: THREE.BufferGeometry | null; water: THREE.BufferGeometry | null } {
    const g = this.grid; const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const op = new GeoBuilder(), wa = new GeoBuilder();
    for (let x = x0; x < x0 + CHUNK; x++) for (let z = z0; z < z0 + CHUNK; z++) for (let y = 0; y < g.H; y++) {
      const id = g.get(x, y, z); if (id === B.Air) continue;
      const def = BLOCKS[id];
      if (id === B.Water) { if (g.get(x, y + 1, z) !== B.Water) this.waterTop(wa, x, y, z); for (const [dx, dy, dz, f] of DIRS) { if (dy) continue; const n = g.get(x + dx, y + dy, z + dz); if (n === B.Air) this.face(wa, x, y, z, f, def, id, 0, 1, 0, 1, 0, 1, true); } continue; }
      switch (def.shape) {
        case 'cube': for (let i = 0; i < 6; i++) { const [dx, dy, dz, f] = DIRS[i]; const n = g.get(x + dx, y + dy, z + dz); const nd = BLOCKS[n]; if (n !== B.Air && nd.opaque && nd.shape === 'cube') continue; if (n === id && (id === B.Glass || id === B.Leaves || id === B.Leaves2)) continue; this.face(id === B.Glass ? wa : op, x, y, z, f, def, id, 0, 1, 0, 1, 0, 1, true); } break;
        case 'slab': this.box(op, x, y, z, def, id, 0, def.height ?? 0.5, 0, 1, 0, 1); break;
        case 'inset': { if (id === B.Door) this.door(op, x, y, z, def, id); else { const i = def.inset ?? 0.2; this.box(op, x, y, z, def, id, 0, def.height ?? 1, i, 1 - i, i, 1 - i); } break; }
        case 'post': { const h = def.height ?? 1; if (id === B.Torch) { this.box(op, x, y, z, def, id, 0, h, 0.42, 0.58, 0.42, 0.58); } else { this.box(op, x, y, z, def, id, 0, h, 0.35, 0.65, 0.35, 0.65); const nx = g.get(x + 1, y, z) === id, nz = g.get(x, y, z + 1) === id; if (nx) this.box(op, x, y, z, def, id, 0.55, 0.85, 0.5, 1.5, 0.42, 0.58); if (nz) this.box(op, x, y, z, def, id, 0.55, 0.85, 0.42, 0.58, 0.5, 1.5); } break; }
        case 'cross': this.cross(op, x, y, z, def, id); break;
      }
    }
    return { opaque: op.toGeometry(), water: wa.toGeometry() };
  }

  private colorFor(def: BlockDef, id: number, x: number, y: number, z: number, face: number): [number, number, number] {
    let [r, g, b] = def.color;
    if (id === B.Grass && face !== 2) { const c2 = def.color2!; const t = face === 3 ? 1 : 0.55; r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t; }
    if (id === B.Bed && face === 2) { const c2 = def.color2!; const t = ((x + z) & 1) ? 0.9 : 0.2; r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t; }
    if (id === B.Bookshelf && face !== 2 && face !== 3) { const c2 = def.color2!; const t = ((x * 3 + y * 7 + z * 5) % 4 === 0) ? 0.7 : 0.15; r = r * (1 - t) + c2[0] * t; g = g * (1 - t) + c2[1] * t; b = b * (1 - t) + c2[2] * t; }
    const n = def.noise ?? 0.03; const h = (hash2(x * 3 + face, z * 5 + y * 7, id) - 0.5) * 2 * n;
    return [Math.max(0, r + h), Math.max(0, g + h), Math.max(0, b + h)];
  }
  private ao(x: number, y: number, z: number, face: number, cornerA: number[], cornerB: number[], cornerC: number[]): number {
    const s = (dx: number, dy: number, dz: number) => { const b = this.grid.get(x + dx, y + dy, z + dz); return b !== B.Air && BLOCKS[b].opaque && BLOCKS[b].shape === 'cube' ? 1 : 0; };
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
    gb.quad(verts, N, col, shade, aos, em);
  }
  private box(gb: GeoBuilder, x: number, y: number, z: number, def: BlockDef, id: number, y0: number, y1: number, x0: number, x1: number, z0: number, z1: number): void {
    for (let f = 0; f < 6; f++) this.face(gb, x, y, z, f, def, id, y0, y1, x0, x1, z0, z1, false);
  }
  private door(gb: GeoBuilder, x: number, y: number, z: number, def: BlockDef, id: number): void {
    const wallLike = (block: number) => block !== B.Air && block !== B.Door && BLOCKS[block].shape === 'cube';
    const alongX = Number(wallLike(this.grid.get(x - 1, y, z))) + Number(wallLike(this.grid.get(x + 1, y, z))) >= Number(wallLike(this.grid.get(x, y, z - 1))) + Number(wallLike(this.grid.get(x, y, z + 1)));
    if (!this.grid.isDoorOpen(x, y, z)) {
      if (alongX) this.box(gb, x, y, z, def, id, 0, 1, 0.04, 0.96, 0.42, 0.58);
      else this.box(gb, x, y, z, def, id, 0, 1, 0.42, 0.58, 0.04, 0.96);
    } else if (alongX) this.box(gb, x, y, z, def, id, 0, 1, 0.04, 0.18, 0.04, 0.96);
    else this.box(gb, x, y, z, def, id, 0, 1, 0.04, 0.96, 0.04, 0.18);
  }
  private cross(gb: GeoBuilder, x: number, y: number, z: number, def: BlockDef, id: number): void {
    const col = this.colorFor(def, id, x, y, z, 2); const em = def.emissive ?? [0, 0, 0];
    // v0.8 "The Legible World" §C: read the block's own declared `height` instead of
    // special-casing individual block IDs here — a crop lifecycle state (or any future
    // cross-shaped block) is legible by declaring its height in `blocks.ts` once, not by also
    // editing the mesher. This actually applies `B.Sprout`'s long-declared `height: 0.5` for the
    // first time (previously silently ignored by the old `id === B.Wheat ? 0.9 : 0.8` special
    // case) — a growing sprout now genuinely renders shorter than mature wheat, not just a
    // different color at the same height.
    const h = def.height ?? 0.8; const o = (hash2(x, z, 9) - 0.5) * 0.3;
    const a = [x + 0.1 + o, y, z + 0.1, x + 0.9 + o, y + h, z + 0.9], b = [x + 0.9 + o, y, z + 0.1, x + 0.1 + o, y + h, z + 0.9];
    for (const q of [a, b]) {
      const vs = [[q[0], q[1], q[2]], [q[3], q[1], q[5]], [q[3], q[4], q[5]], [q[0], q[4], q[2]]];
      const n = [0, 1, 0];
      gb.quad(vs, n, col, 0.95, [0.85, 0.85, 1, 1], em); gb.quad([vs[3], vs[2], vs[1], vs[0]], n, col, 0.95, [1, 1, 0.85, 0.85], em);
    }
  }
  private waterTop(gb: GeoBuilder, x: number, y: number, z: number): void {
    const def = BLOCKS[B.Water]; const col = this.colorFor(def, B.Water, x, y, z, 2);
    gb.quad(faceVerts(2, x, y, z, x + 1, y + 0.85, z + 1), [0, 1, 0], col, 1, [1, 1, 1, 1], [0, 0, 0]);
  }
}

// face index: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const DIRS: [number, number, number, number][] = [[1, 0, 0, 0], [-1, 0, 0, 1], [0, 1, 0, 2], [0, -1, 0, 3], [0, 0, 1, 4], [0, 0, -1, 5]];
const FACE_SHADE = [0.82, 0.72, 1.0, 0.5, 0.88, 0.66];
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
  pos: number[] = []; nor: number[] = []; col: number[] = []; em: number[] = []; idx: number[] = [];
  quad(v: number[][], n: number[], c: [number, number, number], shade: number, ao: number[], em: number[]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) { this.pos.push(v[i][0], v[i][1], v[i][2]); this.nor.push(n[0], n[1], n[2]); const k = shade * ao[i]; this.col.push(c[0] * k, c[1] * k, c[2] * k); this.em.push(em[0], em[1], em[2]); }
    // flip quad diagonal for better AO interpolation
    if (ao[0] + ao[2] > ao[1] + ao[3]) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }
  toGeometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aEmissive', new THREE.Float32BufferAttribute(this.em, 3));
    g.setIndex(this.idx); g.computeBoundingSphere(); return g;
  }
}

export function makeChunkMaterial(transparent = false): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent, opacity: transparent ? 0.72 : 1, side: transparent ? THREE.DoubleSide : THREE.FrontSide, depthWrite: !transparent });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }; (m as any).userData.shader = shader;
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
  private meshes = new Map<number, { opaque: THREE.Mesh | null; water: THREE.Mesh | null }>();
  private mesher: ChunkMesher; private matOpaque = makeChunkMaterial(false); private matWater = makeChunkMaterial(true);
  constructor(private grid: VoxelGrid) { this.mesher = new ChunkMesher(grid); this.group.name = 'voxels'; }
  buildAll(): void { for (let cx = 0; cx < this.grid.W / CHUNK; cx++) for (let cz = 0; cz < this.grid.D / CHUNK; cz++) this.rebuild(cx, cz); this.grid.dirtyChunks.clear(); }
  update(): void { if (!this.grid.dirtyChunks.size) return; for (const key of this.grid.dirtyChunks) this.rebuild(Math.floor(key / 1024), key % 1024); this.grid.dirtyChunks.clear(); }
  setTime(t: number): void { for (const m of [this.matOpaque, this.matWater]) { const s = (m as any).userData.shader; if (s) s.uniforms.uTime.value = t; } }
  private rebuild(cx: number, cz: number): void {
    const key = cx * 1024 + cz; const old = this.meshes.get(key);
    if (old) { for (const m of [old.opaque, old.water]) if (m) { this.group.remove(m); m.geometry.dispose(); } }
    const { opaque, water } = this.mesher.build(cx, cz);
    const entry = { opaque: null as THREE.Mesh | null, water: null as THREE.Mesh | null };
    if (opaque) { const m = new THREE.Mesh(opaque, this.matOpaque); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true; this.group.add(m); entry.opaque = m; }
    if (water) { const m = new THREE.Mesh(water, this.matWater); m.receiveShadow = true; m.renderOrder = 2; this.group.add(m); entry.water = m; }
    this.meshes.set(key, entry);
  }
}
