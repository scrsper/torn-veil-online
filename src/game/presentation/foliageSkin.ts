import * as THREE from 'three';
import { B, BLOCKS } from '../../sim/physical/blocks';
import { VoxelGrid, CHUNK } from '../../sim/physical/grid';
import { GeoAccum, UNIT, place, shade, tapered, type RGB } from './geo';
import { surfaceMaterial, surfaceTex } from './textures';

/**
 * Living things, drawn as living things.
 *
 * Every plant here is a projection of canonical grid cells and nothing else. A tree is a real
 * tapered trunk with a real canopy because there are `B.Log`/`B.Leaves` cells in the canonical
 * grid at that spot — and when the simulation fells that tree (`world/resources.ts`'s
 * `extractFromNode` clears the node's blocks) those cells become air, the chunk is marked dirty,
 * this skin rebuilds it, and the tree is gone. Same for a bush cleared to make a road, a crop
 * cell advancing from seedling to sprout to standing wheat to stubble as `CropPlot` state moves,
 * or anything a future system writes into the grid. There is no second list of trees to keep in
 * sync, because there is no list: the grid IS the state, and this reads it.
 */

/* ------------------------------ procedural plant primitives ------------------------------- */

/** One tapered, slightly curved blade — the unit of all grass, crops and small plants. */
const BLADE = (() => {
  const segs = 3, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const w0 = 0.055, w1 = 0.006, bend = 0.28;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = w0 + (w1 - w0) * t;
    const z = bend * t * t;
    pos.push(-w, t, z, w, t, z);
    nor.push(0, 0.35, 1, 0, 0.35, 1);
    uv.push(0, t, 1, t);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
})();

/** Deterministic per-cell jitter so no two plants are identical but every reload is. */
function rnd(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2246822519) ^ Math.imul(s, 1013904223);
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function blockRGB(id: number, k = 1): RGB {
  const c = BLOCKS[id]?.color ?? [0.4, 0.4, 0.4];
  return shade([c[0], c[1], c[2]], k);
}

/** A clump of blades: the shared shape behind grass, crops and flower stems. */
function clump(acc: GeoAccum, x: number, y: number, z: number, n: number, height: number, spread: number, color: RGB, seed: number, sway: number): void {
  for (let i = 0; i < n; i++) {
    const a = rnd(x, z, i, seed) * Math.PI * 2;
    const r = rnd(x, z, i, seed + 1) * spread;
    const h = height * (0.65 + rnd(x, z, i, seed + 2) * 0.6);
    const tilt = (rnd(x, z, i, seed + 3) - 0.5) * 0.55;
    const c = shade(color, 0.8 + rnd(x, z, i, seed + 4) * 0.45);
    acc.add(BLADE, place(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 1, h, 1, a, tilt, 0), c, 1, sway, y);
  }
}

/* ------------------------------------- the skin ------------------------------------------- */

const TRUNK = new Set<number>([B.Log, B.Log2]);
const LEAF = new Set<number>([B.Leaves, B.Leaves2]);

export class FoliageSkin {
  group = new THREE.Group();
  private matWood = surfaceMaterial('bark');
  private matLeaf = surfaceMaterial('leaf', { side: THREE.DoubleSide });
  private meshes = new Map<number, THREE.Mesh[]>();
  private shaders: { uniforms: Record<string, { value: number }> }[] = [];

  constructor(private grid: VoxelGrid) {
    this.group.name = 'foliage';
    for (const m of [this.matWood, this.matLeaf]) this.installWind(m);
  }

  /** Wind is presentation-only: it moves vertices, never a canonical position. */
  private installWind(m: THREE.MeshStandardMaterial): void {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this.shaders.push(shader as unknown as { uniforms: Record<string, { value: number }> });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sw = aSway;
        transformed.x += sin(uTime * 1.15 + position.x * 0.55 + position.z * 0.37) * sw;
        transformed.z += cos(uTime * 0.92 + position.z * 0.61 + position.x * 0.23) * sw * 0.75;`);
    };
  }
  setTime(t: number, wind: number): void {
    for (const s of this.shaders) if (s.uniforms.uTime) s.uniforms.uTime.value = t * (0.5 + Math.min(1.4, wind));
  }

  buildAll(): void {
    const g = this.grid;
    for (let cx = 0; cx < g.W / CHUNK; cx++) for (let cz = 0; cz < g.D / CHUNK; cz++) this.rebuild(cx, cz);
  }

  rebuild(cx: number, cz: number): void {
    const key = cx * 1024 + cz;
    const old = this.meshes.get(key);
    if (old) for (const m of old) { this.group.remove(m); m.geometry.dispose(); }
    const g = this.grid;
    const wood = new GeoAccum(), leaf = new GeoAccum();
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let x = x0; x < x0 + CHUNK; x++) for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 1; y < g.H; y++) {
        const id = g.get(x, y, z);
        if (id === B.Air) continue;
        if (TRUNK.has(id)) { if (!TRUNK.has(g.get(x, y - 1, z))) this.tree(wood, leaf, x, y, z, id); continue; }
        if (LEAF.has(id)) continue;                       // drawn as part of its tree's canopy
        this.undergrowth(wood, leaf, x, y, z, id);
      }
    }
    const made: THREE.Mesh[] = [];
    for (const [acc, mat] of [[wood, this.matWood], [leaf, this.matLeaf]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); made.push(m);
    }
    this.meshes.set(key, made);
  }

  /**
   * One tree, measured from its own canonical cells: the trunk column tells us how tall it is,
   * the surrounding leaf cells tell us how wide and how high the crown reaches, and the species
   * comes from which log the world generator actually placed.
   */
  private tree(wood: GeoAccum, leaf: GeoAccum, x: number, y0: number, z: number, logId: number): void {
    const g = this.grid;
    let top = y0;
    while (top + 1 < g.H && TRUNK.has(g.get(x, top + 1, z))) top++;
    const trunkH = top - y0 + 1;
    const pine = logId === B.Log2;
    const leafId = pine ? B.Leaves2 : B.Leaves;
    // Measure the canopy the generator actually laid down.
    let lo = Infinity, hi = -Infinity, rad = 0, count = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let yy = y0; yy <= Math.min(g.H - 1, top + 4); yy++) {
      if (g.get(x + dx, yy, z + dz) !== leafId) continue;
      count++; lo = Math.min(lo, yy); hi = Math.max(hi, yy); rad = Math.max(rad, Math.hypot(dx, dz));
    }
    const seed = (x * 31 + z * 17) | 0;
    const lean = (rnd(x, z, 0, 3) - 0.5) * 0.22;
    const barkC = blockRGB(logId, 0.85 + rnd(x, z, 0, 9) * 0.3);

    // A log column with no canopy is not a tree — the world generator uses the same substance for
    // mill posts, gate posts and bridge piles. Those get a squared timber post: still a faithful
    // projection of the same canonical cells, just not pretending to be a plant.
    if (count === 0) {
      const h = trunkH + 0.1;
      wood.add(UNIT.cyl8, place(x + 0.5, y0 - 0.05 + h / 2, z + 0.5, 0.36, h, 0.36), shade(barkC, 0.95), surfaceTex('bark').uvScale);
      wood.add(UNIT.box, place(x + 0.5, y0 - 0.02, z + 0.5, 0.5, 0.12, 0.5), shade(barkC, 0.8), 1);
      return;
    }

    // Trunk: two tapered sections with a slight lean and a flared root, instead of a stack of cubes.
    const baseY = y0 - 0.4;
    const midY = baseY + trunkH * 0.55;
    const topY = baseY + trunkH + (pine ? 0.6 : 0.2);
    const r0 = (pine ? 0.15 : 0.19) + trunkH * 0.012;
    wood.add(tapered(0.72, 7), place(x + 0.5, (baseY + midY) / 2, z + 0.5, r0 * 2, midY - baseY, r0 * 2), barkC, 1);
    wood.add(tapered(0.6, 7), place(x + 0.5 + lean * 0.6, (midY + topY) / 2, z + 0.5 + lean * 0.4, r0 * 1.44, topY - midY, r0 * 1.44), barkC, 1);
    wood.add(UNIT.cone, place(x + 0.5, baseY + 0.28, z + 0.5, r0 * 3.4, 0.85, r0 * 3.4, 0, Math.PI, 0), shade(barkC, 0.85), 1);

    const crownLo = lo - 0.2, crownHi = hi + 0.7;
    const crownR = Math.max(1.1, rad + 0.55);
    const leafC = blockRGB(leafId, 0.9 + rnd(x, z, 0, 21) * 0.35);

    if (pine) {
      // Stacked tiers, widest at the bottom — the silhouette that reads as conifer at any range.
      const tiers = Math.max(3, Math.round((crownHi - crownLo) / 1.1));
      for (let i = 0; i < tiers; i++) {
        const t = i / Math.max(1, tiers - 1);
        const cy = crownLo + (crownHi - crownLo) * t;
        const r = crownR * (1.05 - t * 0.72);
        const c = shade(leafC, 0.82 + t * 0.3);
        leaf.add(UNIT.cone, place(x + 0.5 + lean * t, cy + 0.5, z + 0.5 + lean * t * 0.7, r * 2, 1.5, r * 2), c, surfaceTex('leaf').uvScale, 0.006, y0);
      }
    } else {
      // A few overlapping faceted masses: broadleaf crowns read as volume, not as a ball.
      const blobs = 4 + Math.floor(rnd(x, z, 0, 5) * 3);
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + rnd(x, z, i, 7);
        const rr = crownR * (0.34 + rnd(x, z, i, 11) * 0.34);
        const cy = crownLo + (crownHi - crownLo) * (0.3 + rnd(x, z, i, 13) * 0.65);
        const s = crownR * (0.62 + rnd(x, z, i, 17) * 0.44);
        const c = shade(leafC, 0.78 + rnd(x, z, i, 19) * 0.42);
        leaf.add(UNIT.blob, place(x + 0.5 + Math.cos(a) * rr + lean, cy, z + 0.5 + Math.sin(a) * rr, s * 2, s * 1.55, s * 2, rnd(x, z, i, 23) * 3), c, surfaceTex('leaf').uvScale, 0.008, y0 + 1);
      }
      // Two branches lifting into the crown, so trunk and canopy are visibly one plant.
      for (let i = 0; i < 2; i++) {
        const a = rnd(x, z, i, 29) * Math.PI * 2;
        const bx = x + 0.5 + Math.cos(a) * crownR * 0.35, bz = z + 0.5 + Math.sin(a) * crownR * 0.35;
        const by = crownLo + 0.3;
        wood.add(tapered(0.4, 5), place((x + 0.5 + bx) / 2, (topY - 0.9 + by) / 2, (z + 0.5 + bz) / 2, 0.12, Math.hypot(bx - x - 0.5, bz - z - 0.5) + 0.9, 0.12, 0, 0, 0), shade(barkC, 0.9), 1);
      }
    }
    void seed;
  }

  /** Small plants, crops and ground clutter — one canonical cell each. */
  private undergrowth(wood: GeoAccum, leaf: GeoAccum, x: number, y: number, z: number, id: number): void {
    const cx = x + 0.5, cz = z + 0.5;
    switch (id) {
      case B.Tallgrass:
        clump(leaf, cx, y, cz, 7, 0.55, 0.34, blockRGB(id, 0.95), 1, 0.05); break;
      case B.Flowers: {
        clump(leaf, cx, y, cz, 4, 0.34, 0.28, [0.30, 0.45, 0.22], 2, 0.05);
        const petal = blockRGB(id, 1);
        for (let i = 0; i < 3; i++) {
          const a = rnd(x, z, i, 31) * Math.PI * 2, r = 0.1 + rnd(x, z, i, 33) * 0.2;
          leaf.add(UNIT.blobLo, place(cx + Math.cos(a) * r, y + 0.34 + rnd(x, z, i, 35) * 0.16, cz + Math.sin(a) * r, 0.13, 0.1, 0.13), petal, 1, 0.06, y);
        }
        break;
      }
      case B.Bush: {
        const c = blockRGB(id, 0.95);
        for (let i = 0; i < 4; i++) {
          const a = rnd(x, z, i, 41) * Math.PI * 2, r = rnd(x, z, i, 43) * 0.24;
          const s = 0.42 + rnd(x, z, i, 45) * 0.26;
          leaf.add(UNIT.blob, place(cx + Math.cos(a) * r, y + 0.3 + rnd(x, z, i, 47) * 0.2, cz + Math.sin(a) * r, s, s * 0.82, s), shade(c, 0.82 + rnd(x, z, i, 49) * 0.4), 1, 0.01, y);
        }
        break;
      }
      // The crop lifecycle. `world/metabolism.ts` projects a canonical CropPlot state onto one of
      // these block ids; this turns each into a visibly different plant rather than a taller quad.
      case B.Seedling: clump(leaf, cx, y, cz, 4, 0.2, 0.22, blockRGB(id, 1), 3, 0.02); break;
      case B.Sprout: clump(leaf, cx, y, cz, 6, 0.45, 0.28, blockRGB(id, 1), 4, 0.04); break;
      case B.Stubble: clump(leaf, cx, y, cz, 8, 0.16, 0.32, blockRGB(id, 1), 5, 0.01); break;
      case B.Wheat: {
        const c = blockRGB(id, 1);
        clump(leaf, cx, y, cz, 7, 0.85, 0.3, shade(c, 0.9), 6, 0.05);
        for (let i = 0; i < 5; i++) {
          const a = rnd(x, z, i, 51) * Math.PI * 2, r = rnd(x, z, i, 53) * 0.26;
          const h = 0.72 + rnd(x, z, i, 55) * 0.22;
          leaf.add(tapered(0.25, 5), place(cx + Math.cos(a) * r, y + h + 0.1, cz + Math.sin(a) * r, 0.09, 0.26, 0.09), shade(c, 1.05), 1, 0.05, y);
        }
        break;
      }
      case B.Hay: {
        const c = blockRGB(id, 1);
        wood.add(UNIT.cyl12, place(cx, y + 0.45, cz, 0.92, 0.95, 0.92, 0, 0, Math.PI / 2), c, surfaceTex('thatch').uvScale);
        break;
      }
      case B.Pumpkin: {
        const c = blockRGB(id, 1);
        leaf.add(UNIT.sphereLo, place(cx, y + 0.32, cz, 0.72, 0.58, 0.72), c, 1);
        wood.add(UNIT.cyl6, place(cx, y + 0.62, cz, 0.09, 0.18, 0.09), [0.35, 0.34, 0.16], 1);
        break;
      }
    }
  }
}
