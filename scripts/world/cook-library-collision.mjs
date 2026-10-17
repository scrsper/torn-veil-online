// Cooks walker collision footprints from the real torn-veil-assets GLBs into a committed sim
// table (src/sim/world/assets/libraryCollision.json), keyed by asset id + sha256. The library
// ships no colliders (START_HERE.txt), so the footprint is derived from the geometry itself:
// any steep surface between step height and the provisional 2.10 m player height marks its cells.
// Usage: node scripts/world/cook-library-collision.mjs  (reads TV_ASSETS_DIR, default /workspace/torn-veil-assets)
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../..');
const root = process.env.TV_ASSETS_DIR || '/workspace/torn-veil-assets';
const catalog = JSON.parse(await readFile(resolve(repo, 'src/sim/world/assets/libraryCatalog.json'), 'utf8'));
// Placed whole-space families only; trees and boulders keep their scatter cylinders.
const FAMILIES = new Set(['village_lane', 'market_square', 'tavern', 'gatehouse', 'ravine_bridge', 'watchpost', 'dungeon_junction', 'gate_segment', 'courtyard_passage']);
const CELL = .25, STEP = .35, HEAD = 2.1, FLOOR_NY = .8, DECK_MAX = 2.7;

const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const local = n => {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
};
function triangles(buf) {
  const len = buf.readUInt32LE(12), j = JSON.parse(buf.subarray(20, 20 + len).toString()), binStart = 20 + len + 8;
  const read = (ai) => {
    const a = j.accessors[ai], v = j.bufferViews[a.bufferView], comps = { SCALAR: 1, VEC3: 3 }[a.type], size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    const stride = v.byteStride || comps * size, base = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out = new Float64Array(a.count * comps);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      out[i * comps + c] = a.componentType === 5126 ? buf.readFloatLE(o) : a.componentType === 5125 ? buf.readUInt32LE(o) : a.componentType === 5123 ? buf.readUInt16LE(o) : buf.readUInt8(o);
    }
    return out;
  };
  const tris = [];
  const walk = (ni, M) => {
    const n = j.nodes[ni], W = mul(M, local(n));
    if (n.mesh != null) for (const p of j.meshes[n.mesh].primitives) {
      if ((p.mode ?? 4) !== 4) continue;
      const pos = read(p.attributes.POSITION), idx = p.indices != null ? read(p.indices) : Float64Array.from({ length: pos.length / 3 }, (_, i) => i);
      const w = i => [0, 1, 2].map(k => W[k] * pos[i * 3] + W[4 + k] * pos[i * 3 + 1] + W[8 + k] * pos[i * 3 + 2] + W[12 + k]);
      for (let t = 0; t + 2 < idx.length; t += 3) tris.push([w(idx[t]), w(idx[t + 1]), w(idx[t + 2])]);
    }
    for (const c of n.children ?? []) walk(c, W);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return tris;
}
const out = { version: 1, cell: CELL, band: [STEP, HEAD], floorNormalY: FLOOR_NY, floorCell: CELL * 2, floorStep: .05, assets: {} };
for (const a of catalog.assets) {
  if (a.verdict !== 'use' || !FAMILIES.has(a.family)) continue;
  let buf; try { buf = await readFile(resolve(root, a.path)); } catch { console.log(`${a.id}\tmissing`); continue; }
  if (createHash('sha256').update(buf).digest('hex') !== a.sha256) { console.log(`${a.id}\thash mismatch, skipped`); continue; }
  const [x0, , z0] = a.bounds.min, [x1, , z1] = a.bounds.max, nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL), grid = new Uint8Array(nx * nz);
  const fx = Math.ceil(nx / 2), fz = Math.ceil(nz / 2), deck = a.family === 'ravine_bridge', floor = new Float64Array(fx * fz).fill(NaN);
  const fcell = (x, z) => { const i = Math.floor((x - x0) / (CELL * 2)), k = Math.floor((z - z0) / (CELL * 2)); return i >= 0 && i < fx && k >= 0 && k < fz ? k * fx + i : -1; };
  const samples = (p, q, r, cb) => {
    const e = Math.max(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]), Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]));
    const n = Math.max(1, Math.ceil(e / (CELL * .5)));
    for (let i = 0; i <= n; i++) for (let k = 0; k <= n - i; k++) { const u = i / n, v = k / n, w = 1 - u - v; cb(p[0] * w + q[0] * u + r[0] * v, p[1] * w + q[1] * u + r[1] * v, p[2] * w + q[2] * u + r[2] * v); }
  };
  const tris = triangles(buf).map(([p, q, r]) => {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, cl = Math.hypot(cx, cy, cz);
    return { p, q, r, ny: cl < 1e-9 ? 0 : cy / cl };
  });
  // Walkable floor (0.5 m cells, asset-local y): upward-facing near-horizontal faces between
  // -0.5 m and the deck limit. Ground-level spaces take the lowest such face (awnings and table
  // tops are not floors); the arched ravine bridge takes its highest (the deck over the gorge).
  for (const { p, q, r, ny } of tris) if (ny > FLOOR_NY) samples(p, q, r, (x, y, z) => {
    if (y < -.5 || y > DECK_MAX) return; const c = fcell(x, z); if (c < 0) return;
    if (Number.isNaN(floor[c]) || (deck ? y > floor[c] : y < floor[c])) floor[c] = y;
  });
  const floorAt = (x, z) => { const c = fcell(x, z), h = c < 0 ? NaN : floor[c]; return Number.isNaN(h) ? 0 : Math.max(0, h); };
  // Steep faces — walls, rails, posts, counter sides — block where they stand between step
  // height and head height above that cell's floor.
  for (const { p, q, r, ny } of tris) {
    if (Math.abs(ny) > FLOOR_NY || Math.max(p[1], q[1], r[1]) < STEP - .5 || Math.min(p[1], q[1], r[1]) > DECK_MAX + HEAD) continue;
    samples(p, q, r, (x, y, z) => {
      const h = y - floorAt(x, z); if (h < STEP || h > HEAD) return;
      const i = Math.floor((x - x0) / CELL), k = Math.floor((z - z0) / CELL); if (i >= 0 && i < nx && k >= 0 && k < nz) grid[k * nx + i] = 1;
    });
  }
  let filled = 0; for (const c of grid) filled += c;
  // Bitset rows and 5 cm floor steps (0 = asset ground), base64: compact and exact.
  const bits = new Uint8Array(Math.ceil(grid.length / 8)); grid.forEach((c, i) => { if (c) bits[i >> 3] |= 1 << (i & 7); });
  const steps = new Uint8Array(fx * fz); for (let k = 0; k < fz; k++) for (let i = 0; i < fx; i++) steps[k * fx + i] = Math.min(255, Math.round(floorAt(x0 + (i + .5) * CELL * 2, z0 + (k + .5) * CELL * 2) / .05));
  out.assets[a.id] = { sha256: a.sha256, origin: [x0, z0], size: [nx, nz], bits: Buffer.from(bits).toString('base64'), floor: Buffer.from(steps).toString('base64') };
  console.log(`${a.id}\t${nx}x${nz}\t${(100 * filled / grid.length).toFixed(1)}% blocked\tmax floor ${(Math.max(...steps) * .05).toFixed(2)} m`);
}
await writeFile(resolve(repo, 'src/sim/world/assets/libraryCollision.json'), JSON.stringify(out, null, 1) + '\n');
