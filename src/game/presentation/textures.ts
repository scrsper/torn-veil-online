import * as THREE from 'three';

/**
 * Procedurally generated surface detail.
 *
 * The milestone brief is explicit that no time should go into hunting or authoring art assets,
 * so every texture in this prototype is generated here, at boot, on a 2D canvas: a greyscale
 * height field per material family, converted into a subtle albedo modulation (`map`) and a
 * normal map (`normalMap`). That is the cheapest thing that reliably kills the "flat untextured
 * cube" read — flat vertex colour under a directional light is most of what makes the old
 * presentation look like a voxel sandbox, and a normal map costs nothing per frame.
 *
 * Colour still comes from vertex colours (ultimately from the canonical block palette), so the
 * texture is a MODULATION, never the identity of a surface: `map` is centred near white.
 */

export type SurfaceFamily =
  | 'ground' | 'rock' | 'plaster' | 'plank' | 'stone' | 'thatch' | 'tile' | 'bark' | 'leaf' | 'cloth' | 'metal' | 'grain';

export interface SurfaceTex { map: THREE.Texture; normalMap: THREE.Texture; roughness: number; metalness: number; uvScale: number; }

/* ---------- deterministic value noise (visual only; unrelated to the simulation RNG) -------- */
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
/** Tiling value noise: period `p` cells across the tile, so the result wraps seamlessly. */
function vnoise(x: number, y: number, p: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smoothstep(x - xi), yf = smoothstep(y - yi);
  const w = (a: number) => ((a % p) + p) % p;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s);
  const c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  const top = a + (b - a) * xf;
  const bot = c + (d - c) * xf;
  return top + (bot - top) * yf;
}
function fbmT(x: number, y: number, p: number, s: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f, p * f, s + i * 37) * amp; amp *= 0.5; f *= 2; }
  return v;
}

const SIZE = 256;

function heightField(fn: (u: number, v: number) => number): Float32Array {
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = fn(x / SIZE, y / SIZE);
  return h;
}

function toAlbedo(h: Float32Array, strength: number): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!; const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // Centred near white: the texture darkens/lightens the vertex colour, never replaces it.
    const v = Math.max(0, Math.min(1, (1 - strength * 0.5) + (h[i] - 0.5) * strength));
    const c = Math.round(v * 255);
    img.data[i * 4] = c; img.data[i * 4 + 1] = c; img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function toNormal(h: Float32Array, strength: number): THREE.Texture {
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!; const img = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => h[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = y * SIZE + x;
    img.data[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    img.data[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    img.data[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

/* ------------------------------- the material families ------------------------------------ */

interface FieldSpec { h: Float32Array; albedo: number; normal: number; roughness: number; metalness: number; uvScale: number; }

const FIELDS: Record<SurfaceFamily, () => FieldSpec> = {
  // Organic mottling plus sparse speckles: reads as soil/turf at any distance.
  ground: () => ({
    h: heightField((u, v) => {
      const n = fbmT(u * 8, v * 8, 8, 11, 4);
      const speck = hash(Math.floor(u * SIZE), Math.floor(v * SIZE), 5) > 0.985 ? 0.35 : 0;
      return Math.min(1, n * 0.9 + speck);
    }), albedo: 0.30, normal: 5, roughness: 0.97, metalness: 0, uvScale: 0.42,
  }),
  // Rounded setts with mortar between them: a jittered cell pattern, so a road reads as laid
  // stone rather than as a grey plane with cracks in it.
  rock: () => ({
    h: heightField((u, v) => {
      const F = 6;
      const cu = u * F, cv = v * F;
      const ci = Math.floor(cu), cj = Math.floor(cv);
      let best = 9, second = 9;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const gi = ci + di, gj = cj + dj;
        const wi = ((gi % F) + F) % F, wj = ((gj % F) + F) % F;
        const px = gi + 0.2 + hash(wi, wj, 7) * 0.6, py = gj + 0.2 + hash(wi, wj, 13) * 0.6;
        const d = Math.hypot(px - cu, py - cv);
        if (d < best) { second = best; best = d; } else if (d < second) second = d;
      }
      const edge = Math.min(1, (second - best) * 3.2);      // 0 in the mortar joint, 1 mid-stone
      return Math.max(0, Math.min(1, 0.28 + edge * 0.6 + (fbmT(u * 20, v * 20, 20, 53, 3) - 0.5) * 0.22));
    }), albedo: 0.30, normal: 7, roughness: 0.93, metalness: 0, uvScale: 0.8,
  }),
  plaster: () => ({
    h: heightField((u, v) => 0.35 + fbmT(u * 5, v * 5, 5, 71, 4) * 0.55 + fbmT(u * 22, v * 22, 22, 3, 2) * 0.12),
    albedo: 0.16, normal: 3.5, roughness: 0.95, metalness: 0, uvScale: 0.5,
  }),
  // Long grain plus board seams: the direction is what sells it as sawn timber.
  plank: () => ({
    h: heightField((u, v) => {
      const grain = fbmT(u * 3, v * 40, 40, 17, 3);
      const board = Math.abs(((v * 4) % 1) - 0.5) > 0.46 ? -0.45 : 0;
      const knot = vnoise(u * 4, v * 4, 4, 91) > 0.93 ? 0.25 : 0;
      return Math.max(0, Math.min(1, 0.5 + (grain - 0.5) * 0.7 + board + knot));
    }), albedo: 0.26, normal: 4, roughness: 0.88, metalness: 0, uvScale: 0.5,
  }),
  // Coursed ashlar: horizontal beds, staggered vertical joints.
  stone: () => ({
    h: heightField((u, v) => {
      const row = Math.floor(v * 6);
      const offs = (row % 2) * 0.5;
      const bed = Math.abs(((v * 6) % 1) - 0.5) > 0.44 ? -0.5 : 0;
      const joint = Math.abs(((u * 4 + offs) % 1) - 0.5) > 0.47 ? -0.5 : 0;
      return Math.max(0, Math.min(1, 0.62 + (fbmT(u * 10, v * 10, 10, 53, 3) - 0.5) * 0.4 + bed + joint));
    }), albedo: 0.30, normal: 7, roughness: 0.92, metalness: 0, uvScale: 0.5,
  }),
  // Vertical strands, bundled into courses: thatch.
  thatch: () => ({
    h: heightField((u, v) => {
      const strand = vnoise(u * 90, v * 5, 90, 61);
      const bundle = Math.abs(((v * 5) % 1) - 0.5) > 0.42 ? -0.35 : 0;
      return Math.max(0, Math.min(1, 0.55 + (strand - 0.5) * 0.85 + bundle + (fbmT(u * 12, v * 12, 12, 7, 3) - 0.5) * 0.3));
    }), albedo: 0.34, normal: 6, roughness: 0.98, metalness: 0, uvScale: 0.35,
  }),
  // Overlapping scalloped courses: clay pantiles.
  tile: () => ({
    h: heightField((u, v) => {
      const row = v * 5, ri = Math.floor(row), rf = row - ri;
      const off = (ri % 2) * 0.5;
      const col = (u * 8 + off) % 1;
      const dome = Math.sin(col * Math.PI) * 0.5;
      const lip = rf < 0.14 ? -0.4 : 0;
      return Math.max(0, Math.min(1, 0.45 + dome * (1 - rf * 0.5) + lip + (fbmT(u * 20, v * 20, 20, 29, 2) - 0.5) * 0.2));
    }), albedo: 0.30, normal: 6, roughness: 0.85, metalness: 0, uvScale: 0.5,
  }),
  bark: () => ({
    h: heightField((u, v) => {
      const ridge = Math.abs(vnoise(u * 26, v * 3, 26, 13) - 0.5);
      return Math.max(0, Math.min(1, 0.7 - ridge * 1.6 + (fbmT(u * 14, v * 6, 14, 83, 3) - 0.5) * 0.4));
    }), albedo: 0.36, normal: 7, roughness: 0.95, metalness: 0, uvScale: 1.0,
  }),
  leaf: () => ({
    h: heightField((u, v) => fbmT(u * 14, v * 14, 14, 101, 4)),
    albedo: 0.34, normal: 4, roughness: 0.9, metalness: 0, uvScale: 0.6,
  }),
  cloth: () => ({
    h: heightField((u, v) => 0.5 + (vnoise(u * 60, v * 60, 60, 19) - 0.5) * 0.5 + (fbmT(u * 6, v * 6, 6, 43, 3) - 0.5) * 0.5),
    albedo: 0.20, normal: 3, roughness: 0.94, metalness: 0, uvScale: 0.6,
  }),
  metal: () => ({
    h: heightField((u, v) => 0.5 + (fbmT(u * 18, v * 18, 18, 67, 3) - 0.5) * 0.6),
    albedo: 0.14, normal: 2, roughness: 0.42, metalness: 0.7, uvScale: 0.6,
  }),
  grain: () => ({
    h: heightField((u, v) => fbmT(u * 12, v * 12, 12, 31, 4)),
    albedo: 0.20, normal: 3, roughness: 0.9, metalness: 0, uvScale: 0.5,
  }),
};

const cache = new Map<SurfaceFamily, SurfaceTex>();

/** The generated detail set for one material family. Built lazily, once, and shared. */
export function surfaceTex(family: SurfaceFamily): SurfaceTex {
  let t = cache.get(family);
  if (!t) {
    const f = FIELDS[family]();
    t = { map: toAlbedo(f.h, f.albedo), normalMap: toNormal(f.h, f.normal), roughness: f.roughness, metalness: f.metalness, uvScale: f.uvScale };
    cache.set(family, t);
  }
  return t;
}

/** A standard material carrying one family's detail; vertex colours supply the actual colour. */
export function surfaceMaterial(family: SurfaceFamily, over: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const t = surfaceTex(family);
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, map: t.map, normalMap: t.normalMap, roughness: t.roughness, metalness: t.metalness, ...over,
  });
  m.normalScale.set(1, 1);
  return m;
}
