import * as THREE from 'three';
import { B } from '../../sim/physical/blocks';
import { VoxelGrid, CHUNK } from '../../sim/physical/grid';
import { channelOf, groundStyle } from './style';
import { surfaceMaterial, surfaceTex } from './textures';
import { GeoAccum, mixRGB, type RGB } from './geo';

/**
 * The ground, drawn as ground.
 *
 * NOTHING about the world changes here. The canonical grid still stores a column of cubes per
 * (x, z); navigation, collision, line of sight, digging and every simulation coordinate are
 * exactly what they were. This is a presentation ADAPTER: it reads the canonical height field —
 * the topmost cell in each column whose substance is a walking surface (`style.ts`'s `terrain`
 * channel) — and drapes one continuous, corner-averaged, smoothly-shaded mesh over it, while
 * the chunk mesher stops emitting cubes for those same cells.
 *
 * The result is that a hillside reads as a hillside instead of as a staircase, without a single
 * simulation coordinate moving. A cell's canonical substance still decides its colour and its
 * material family, so a cobbled square, a dirt path and a ploughed field remain visibly
 * different things, and a block edited by the simulation still changes what is drawn.
 *
 * Deliberate, accepted imprecision: a person stands at the canonical integer surface height,
 * while the drawn surface is the smoothed average of the four columns meeting under their feet.
 * On the flat village plateau those agree exactly; on a slope they differ by at most half a
 * block. Presentation bends to look right; the simulation does not bend to match it.
 */

/** Rendering-only vertical nudge so the drawn ground never z-fights a floor laid exactly on it. */
const EPS = 0.002;

export class TerrainSkin {
  group = new THREE.Group();
  private matGround = surfaceMaterial('ground', { roughness: 1 });
  private matRock = surfaceMaterial('rock');
  /** Cached top-of-terrain y per column; -1 means "not computed yet". */
  private top: Int16Array;
  private meshes = new Map<number, THREE.Mesh[]>();

  constructor(private grid: VoxelGrid) {
    this.group.name = 'terrain';
    this.top = new Int16Array(grid.W * grid.D).fill(-2);
  }

  /** Highest cell in this column whose substance is a walking surface, or -1 if there is none. */
  private topY(x: number, z: number): number {
    const g = this.grid;
    if (x < 0 || z < 0 || x >= g.W || z >= g.D) return -1;
    const ci = x * g.D + z;
    const cached = this.top[ci];
    if (cached !== -2) return cached;
    let y = -1;
    for (let i = g.H - 1; i >= 0; i--) { if (channelOf(g.get(x, i, z)) === 'terrain') { y = i; break; } }
    this.top[ci] = y;
    return y;
  }
  private surfaceBlock(x: number, z: number): number {
    const y = this.topY(x, z);
    return y < 0 ? B.Grass : this.grid.get(x, y, z);
  }
  /** Height of the drawn surface directly above column (x, z). */
  private colH(x: number, z: number): number {
    const g = this.grid;
    const cx = Math.max(0, Math.min(g.W - 1, x)), cz = Math.max(0, Math.min(g.D - 1, z));
    const y = this.topY(cx, cz);
    return y < 0 ? 0 : y + 1;
  }
  /** Corner-averaged vertex height: this single line is what turns the staircase into a slope. */
  private vertH(vx: number, vz: number): number {
    return (this.colH(vx - 1, vz - 1) + this.colH(vx, vz - 1) + this.colH(vx - 1, vz) + this.colH(vx, vz)) * 0.25
      + noise(vx, vz) * 0.05;
  }

  /** Public read of the drawn ground height — used to sit props on the surface, not on the cube. */
  drawnHeightAt(x: number, z: number): number {
    const fx = Math.floor(x), fz = Math.floor(z);
    const tx = x - fx, tz = z - fz;
    const h00 = this.vertH(fx, fz), h10 = this.vertH(fx + 1, fz), h01 = this.vertH(fx, fz + 1), h11 = this.vertH(fx + 1, fz + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  invalidateChunk(cx: number, cz: number): void {
    const g = this.grid;
    for (let x = cx * CHUNK - 1; x <= cx * CHUNK + CHUNK; x++) {
      for (let z = cz * CHUNK - 1; z <= cz * CHUNK + CHUNK; z++) {
        if (x >= 0 && z >= 0 && x < g.W && z < g.D) this.top[x * g.D + z] = -2;
      }
    }
  }

  buildAll(): void {
    const g = this.grid;
    for (let cx = 0; cx < g.W / CHUNK; cx++) for (let cz = 0; cz < g.D / CHUNK; cz++) this.rebuild(cx, cz);
  }

  rebuild(cx: number, cz: number): void {
    const key = cx * 1024 + cz;
    const old = this.meshes.get(key);
    if (old) for (const m of old) { this.group.remove(m); m.geometry.dispose(); }

    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const N = CHUNK + 1;
    // Precompute the corner lattice once: heights, normals and colours are shared between the
    // (up to four) cells that touch each vertex, which is what makes the shading continuous.
    const hs = new Float32Array(N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) hs[i * N + j] = this.vertH(x0 + i, z0 + j);
    const normals: THREE.Vector3[] = [];
    const colors: RGB[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const hL = this.vertH(x0 + i - 1, z0 + j), hR = this.vertH(x0 + i + 1, z0 + j);
      const hD = this.vertH(x0 + i, z0 + j - 1), hU = this.vertH(x0 + i, z0 + j + 1);
      const n = new THREE.Vector3(hL - hR, 2, hD - hU).normalize();
      normals.push(n);
      // Steeper ground shows what is under the turf. `slope` is the canonical block's own
      // sub-surface colour, so a rocky hill and a grassy one weather differently.
      const style = groundStyle(this.surfaceBlock(Math.min(this.grid.W - 1, x0 + i), Math.min(this.grid.D - 1, z0 + j)));
      const steep = Math.max(0, Math.min(1, (1 - n.y) * 2.6));
      const tint = 0.88 + noise(x0 + i, z0 + j) * 0.24;
      const c = mixRGB(style.top, style.slope, steep);
      colors.push([c[0] * tint, c[1] * tint, c[2] * tint]);
    }

    const ground = new GeoAccum(), rock = new GeoAccum();
    const uvGround = surfaceTex('ground').uvScale, uvRock = surfaceTex('rock').uvScale;
    const P = (i: number, j: number) => new THREE.Vector3(x0 + i, hs[i * N + j] + EPS, z0 + j);
    for (let i = 0; i < CHUNK; i++) for (let j = 0; j < CHUNK; j++) {
      const bx = Math.min(this.grid.W - 1, x0 + i), bz = Math.min(this.grid.D - 1, z0 + j);
      if (this.topY(bx, bz) < 0) continue;
      const isRock = groundStyle(this.surfaceBlock(bx, bz)).family === 'rock';
      const acc = isRock ? rock : ground;
      const uvS = isRock ? uvRock : uvGround;
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      const ia = i * N + j, ib = (i + 1) * N + j, ic = (i + 1) * N + j + 1, id = i * N + j + 1;
      const uv = (p: THREE.Vector3) => [p.x * uvS, p.z * uvS];
      // Split along the shorter diagonal so a ridge stays a ridge instead of sagging. Winding is
      // counter-clockwise seen from above (+Y), which is what makes these the front faces.
      if (Math.abs(a.y - c.y) <= Math.abs(b.y - d.y)) {
        acc.tri(a, c, b, normals[ia], normals[ic], normals[ib], colors[ia], colors[ic], colors[ib], uv(a), uv(c), uv(b));
        acc.tri(a, d, c, normals[ia], normals[id], normals[ic], colors[ia], colors[id], colors[ic], uv(a), uv(d), uv(c));
      } else {
        acc.tri(a, d, b, normals[ia], normals[id], normals[ib], colors[ia], colors[id], colors[ib], uv(a), uv(d), uv(b));
        acc.tri(b, d, c, normals[ib], normals[id], normals[ic], colors[ib], colors[id], colors[ic], uv(b), uv(d), uv(c));
      }
    }

    const made: THREE.Mesh[] = [];
    for (const [acc, mat] of [[ground, this.matGround], [rock, this.matRock]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true; m.castShadow = true; m.frustumCulled = true;
      this.group.add(m); made.push(m);
    }
    this.meshes.set(key, made);
  }
}

/** Deterministic hash noise in 0..1 — visual dressing only, never simulation state. */
function noise(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + 1013904223;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
