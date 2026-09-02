import { B } from '../physical/blocks';
import { VoxelGrid } from '../physical/grid';
import { fbm, hash2 } from '../core/rng';

export const WORLD_W = 192, WORLD_H = 64, WORLD_D = 192;
export const CX = 96, CZ = 96;            // village centre
export const VILLAGE_TOP = 13;            // top solid block on the village plateau (feet at 14)
export const WATER_LEVEL = 11;
export const RIVER_X = 22;

export function riverCenter(z: number): number { return RIVER_X + Math.sin(z / 27) * 5 + Math.sin(z / 9.5) * 1.5; }

/** Terrain height (top solid block y) before structures. */
export function terrainHeight(x: number, z: number, seed: number): number {
  const dx = x - CX, dz = z - CZ; const d = Math.hypot(dx, dz);
  const n = fbm(x / 48, z / 48, 4, seed) - 0.5;         // -0.5..0.5
  const n2 = fbm(x / 14, z / 14, 3, seed + 99) - 0.5;
  let base = VILLAGE_TOP + n * 14 + n2 * 3;
  // northern hills
  const north = Math.max(0, (60 - z) / 60);
  base += north * north * 22;
  // eastern rise
  const east = Math.max(0, (x - 150) / 42); base += east * east * 8;
  // plateau blend
  const t = smooth(58, 84, d);
  let h = VILLAGE_TOP * (1 - t) + base * t;
  // river valley
  const rc = riverCenter(z); const rd = Math.abs(x - rc);
  if (rd < 4) h = Math.min(h, WATER_LEVEL - 2 + (rd > 2.5 ? 1 : 0));
  else if (rd < 9) { const k = (rd - 4) / 5; h = Math.min(h, (WATER_LEVEL - 1) * (1 - k) + Math.max(h, VILLAGE_TOP) * k); }
  return Math.max(3, Math.min(WORLD_H - 8, Math.round(h)));
}
function smooth(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export function generateTerrain(grid: VoxelGrid, seed: number, reserved: Uint8Array): void {
  const W = grid.W, D = grid.D;
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const h = terrainHeight(x, z, seed);
    const rc = riverCenter(z); const rd = Math.abs(x - rc);
    for (let y = 0; y <= h; y++) {
      let b = B.Stone;
      if (y === h) b = h >= 30 ? (h > 36 ? B.Snow : B.Stone) : (rd < 10 && h <= WATER_LEVEL + 1 ? B.Sand : B.Grass);
      else if (y > h - 3) b = B.Dirt;
      if (hash2(x, z, seed + y) < 0.02 && y < h - 2) b = B.Gravel;
      grid.data[grid.idx(x, y, z)] = b;
    }
    if (h < WATER_LEVEL) for (let y = h + 1; y <= WATER_LEVEL; y++) grid.data[grid.idx(x, y, z)] = B.Water;
  }
}

/** Vegetation after structures are placed. */
export function generateVegetation(grid: VoxelGrid, seed: number, reserved: Uint8Array): void {
  const W = grid.W, D = grid.D;
  const forest = (x: number, z: number) => { const d = Math.hypot(x - CX, z - CZ); const n = fbm(x / 30, z / 30, 3, seed + 7); return d > 66 ? Math.min(1, (d - 66) / 30) * (0.35 + n * 0.8) : 0; };
  for (let x = 2; x < W - 2; x++) for (let z = 2; z < D - 2; z++) {
    if (reserved[x * D + z]) continue;
    const h = grid.groundHeight(x, z); const top = grid.get(x, h, z);
    if (top !== B.Grass) continue;
    const r = hash2(x, z, seed + 1234); const f = forest(x, z);
    if (r < f * 0.09 && h < 34) { treeAt(grid, x, h, z, seed, reserved); continue; }
    if (r < 0.08 + f * 0.05) grid.data[grid.idx(x, h + 1, z)] = B.Tallgrass;
    else if (r < 0.10) grid.data[grid.idx(x, h + 1, z)] = B.Flowers;
    else if (r < 0.105 + f * 0.03) grid.data[grid.idx(x, h + 1, z)] = B.Bush;
  }
}

function treeAt(grid: VoxelGrid, x: number, y: number, z: number, seed: number, reserved: Uint8Array): void {
  // don't grow into reserved areas
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { const xx = x + dx, zz = z + dz; if (xx < 0 || zz < 0 || xx >= grid.W || zz >= grid.D || reserved[xx * grid.D + zz]) return; }
  const pine = hash2(x, z, seed + 77) < 0.45 + Math.max(0, (60 - z) / 120);
  const h = pine ? 6 + Math.floor(hash2(x, z, seed + 3) * 4) : 4 + Math.floor(hash2(x, z, seed + 3) * 3);
  const log = pine ? B.Log2 : B.Log, leaf = pine ? B.Leaves2 : B.Leaves;
  for (let i = 1; i <= h; i++) grid.data[grid.idx(x, y + i, z)] = log;
  if (pine) {
    for (let i = 2; i <= h + 1; i++) { const r = Math.max(0, Math.round((h + 1 - i) * 0.45)); for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.abs(dx) + Math.abs(dz) > r + (i % 2)) continue; if (dx === 0 && dz === 0 && i <= h) continue; const xx = x + dx, zz = z + dz; if (grid.inBounds(xx, y + i, zz) && grid.get(xx, y + i, zz) === B.Air) grid.data[grid.idx(xx, y + i, zz)] = leaf; } }
  } else {
    const r = 2 + (hash2(x, z, seed + 5) < 0.5 ? 1 : 0);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const dd = dx * dx + dz * dz + dy * dy * 1.6; if (dd > r * r + 0.5) continue; if (hash2(x + dx, z + dz, seed + dy) < 0.12 && dd > r * r - 2) continue;
      const xx = x + dx, yy = y + h + dy - 1, zz = z + dz; if (grid.inBounds(xx, yy, zz) && grid.get(xx, yy, zz) === B.Air) grid.data[grid.idx(xx, yy, zz)] = leaf;
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) reserved[(x + dx) * grid.D + z + dz] = 1;
}
