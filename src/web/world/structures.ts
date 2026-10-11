import { Mesh, Plane, Scene } from '@babylonjs/core';
import { B } from '../../sim/physical/blocks';
import type { MaterialLibrary, MatName } from '../render/materials';
import { hash2 } from '../render/noise';
import type { PlaceProjection, RegionProjection } from '../net/messages';
import { MeshBatch, type V } from './meshBatch';
import { architectureGrammar, type ArchitectureProfile } from './architecturalGrammar';
import { buildRoofIdentity } from './roofIdentity';

/**
 * Buildings from the exact projected voxel structure.
 *
 *   walls    exposed faces of wall cells with baked corner occlusion; timber trim stands proud of the plaster
 *   windows  the glazing cells become recessed frames, mullions, panes, sills and shutters
 *   roofs    every building in this world uses the same 45-degree stepped gable with a one-cell overhang;
 *            each is rebuilt as a clean, watertight gable and *verified against the real roof cells*,
 *            falling back to raw voxel faces if a roof ever does not fit
 *   others   chimneys, awnings, hay, ovens, gravestones, torches
 *
 * Nothing here decides where a wall is: cells come from the server. Presentation only.
 */
export interface WorldLight { x: number; y: number; z: number; color: [number, number, number]; intensity: number; range: number; kind: 'torch' | 'window' }
export interface StructureBuild { meshes: Mesh[]; lights: WorldLight[]; panes: Map<string, Mesh>; stats: { cells: number; faces: number; roofsAnalytic: number; roofsVoxel: number; windows: number } }

const ROOF_MATERIAL: Record<number, MatName> = { [B.RoofTile]: 'roofTile', [B.Thatch]: 'thatch', [B.DarkPlanks]: 'roofSlate' };
const WALL_MATERIAL: Record<number, MatName> = {
  [B.Plaster]: 'plaster', [B.Planks]: 'planks', [B.DarkPlanks]: 'darkwood', [B.Log]: 'log', [B.Log2]: 'log', [B.StoneBrick]: 'stone', [B.Mossy]: 'moss',
  [B.Stone]: 'stone', [B.Cobble]: 'cobble', [B.Brick]: 'stone', [B.Chimney]: 'stone', [B.Well]: 'moss', [B.Furnace]: 'stone', [B.Hay]: 'hay',
};
const CLOTH: Record<number, MatName> = { [B.Cloth]: 'cloth', [B.ClothRed]: 'clothRed', [B.ClothBlue]: 'clothBlue', [B.Wool]: 'cloth' };
const NON_OCCLUDING = new Set<number>([0, B.Glass, B.Torch, B.Cloth, B.ClothRed, B.ClothBlue, B.Wool, B.Gravestone]);
/** Whether a projected structure block would hide the camera (walls and roofs do; glass, cloth and torches do not). */
export const blocksCamera = (b: number): boolean => !NON_OCCLUDING.has(b);
const T = 0.42; // vertical roof thickness (metres)

const DIRS: { n: V; corners: [number, number, number][] }[] = [
  { n: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];
const AO = [0.52, 0.68, 0.84, 1];

export class Cells {
  private readonly m = new Map<number, number>();
  constructor(readonly x0: number, readonly z0: number) {}
  private key(x: number, y: number, z: number): number { return ((((x - this.x0 + 2) << 9) | (z - this.z0 + 2)) << 8) | (y & 255); }
  set(x: number, y: number, z: number, b: number): void { this.m.set(this.key(x, y, z), b); }
  get(x: number, y: number, z: number): number { return this.m.get(this.key(x, y, z)) ?? 0; }
  get size(): number { return this.m.size; }
  *entries(): Generator<[number, number, number, number]> {
    for (const [k, b] of this.m) yield [(k >> 17) - 2 + this.x0, k & 255, ((k >> 8) & 511) - 2 + this.z0, b];
  }
}
/** Decode `structures.runs` (x, z, n, then n triples of y, length, block) into a cell lookup. */
export function decodeStructure(runs: number[], x0: number, z0: number): Cells {
  const cells = new Cells(x0, z0);
  for (let i = 0; i < runs.length;) {
    const x = runs[i++], z = runs[i++], n = runs[i++];
    for (let k = 0; k < n; k++, i += 3) for (let y = runs[i]; y < runs[i] + runs[i + 1]; y++) cells.set(x, y, z, runs[i + 2]);
  }
  return cells;
}

interface RoofFit { roofY: number; alongX: boolean; material: MatName; wall: MatName }

/** Whole-region build in one go (tests, showroom). The streaming path drives `buildStructuresSteps` inside a frame budget. */
export function buildStructures(scene: Scene, mats: MaterialLibrary, r: RegionProjection, litPlaces: ReadonlySet<string> = new Set()): StructureBuild {
  const steps = buildStructuresSteps(scene, mats, r, litPlaces);
  for (;;) { const s = steps.next(); if (s.done) return s.value; }
}
/** The same build, yielding every few milliseconds so a large settlement never holds a frame. */
export function* buildStructuresSteps(scene: Scene, mats: MaterialLibrary, r: RegionProjection, litPlaces: ReadonlySet<string> = new Set()): Generator<void, StructureBuild, void> {
  const out: StructureBuild = { meshes: [], lights: [], panes: new Map(), stats: { cells: 0, faces: 0, roofsAnalytic: 0, roofsVoxel: 0, windows: 0 } };
  if (!r.structures?.runs.length) return out;
  const x0 = r.bounds.x0, z0 = r.bounds.z0, cells = decodeStructure(r.structures.runs, x0, z0);
  const naturalTreeCells = new Set<string>();
  for (const t of r.structures.trees ?? []) for (let y = t.y; y < t.y + t.height; y++) naturalTreeCells.add(`${t.x},${y},${t.z}`);
  out.stats.cells = cells.size;
  let activePlace: PlaceProjection | undefined;
  const batches = new Map<string, { batch: MeshBatch; material: MatName; place?: PlaceProjection }>();
  const batch = (m: MatName) => { const key = (activePlace?.id ?? '') + ':' + m; let b = batches.get(key); if (!b) { b = { batch: new MeshBatch(), material: m, place: activePlace }; batches.set(key, b); } return b.batch; };
  const L = (x: number, z: number): [number, number] => [x - x0, z - z0];
  const buildings = r.places.filter(p => p.indoor);
  const placeOf = (x: number, z: number): PlaceProjection | undefined => buildings.find(p => x >= p.bounds.x0 - 1 && x <= p.bounds.x1 + 1 && z >= p.bounds.z0 - 1 && z <= p.bounds.z1 + 1);
  const solid = (x: number, y: number, z: number) => !NON_OCCLUDING.has(cells.get(x, y, z));
  const glassBatches = new Map<string, MeshBatch>();
  function paneBatch(id: string): MeshBatch { let g = glassBatches.get(id); if (!g) glassBatches.set(id, g = new MeshBatch()); return g; }
  const millWheels = new Map<string, MillWheel>();
  for (const p of buildings) if (p.type === 'mill') { const wheel = findMillWheel(cells, p); if (wheel) { millWheels.set(p.id, wheel); activePlace = p; buildMillWheel(batch, mats, wheel, x0, z0); } }

  const wheelCells = new Set([...millWheels.values()].flatMap(w => [...w.cells]));

  // ── roofs: fit each building's analytic gable to its actual roof cells ─────────────────────────
  const fits = new Map<string, RoofFit>();
  for (const p of buildings) {
    const fit = fitRoof(cells, p);
    if (!fit) { out.stats.roofsVoxel++; continue; }
    fits.set(p.id, fit); out.stats.roofsAnalytic++;
    activePlace = p; buildGableRoof(batch, mats, p, fit, x0, z0, architectureGrammar(p, cells));
  }
  const insideFittedRoof = (x: number, y: number, z: number, b: number): boolean => {
    const p = placeOf(x, z); if (!p) return false;
    const fit = fits.get(p.id); if (!fit || y < fit.roofY) return false;
    // Everything above the wall top under a fitted roof is replaced by the analytic gable, except chimneys and torches.
    return b !== B.Chimney && b !== B.Torch;
  };

  // ── walls and other cells ──────────────────────────────────────────────────────────────────────
  let sliceAt = performance.now(), visited = 0;
  for (const [x, y, z, b] of cells.entries()) {
    if ((++visited & 127) === 0 && performance.now() - sliceAt > 3) { yield; sliceAt = performance.now(); }
    if (insideFittedRoof(x, y, z, b)) continue;
    // Grid logs remain in `cells` for collision/occlusion authority, but natural tree trunks
    // are rendered by the shared vegetation path below so their canopies are preserved.
    if (naturalTreeCells.has(`${x},${y},${z}`)) continue;
    if (wheelCells.has(`${x},${y},${z}`)) continue;
    const place = placeOf(x, z), variation = 0.95 + hash2(x, z, 11) * 0.05 + hash2(x + y * 7, z, 3) * 0.04;
    activePlace = place;
    const buildingTint = place ? 0.92 + hash2(place.visualSeed | 0, 5, 1) * 0.16 : 1;
    if (b === B.Glass) { windowAt(x, y, z, place); continue; }
    if (b === B.Torch) { out.lights.push({ x: x - x0 + 0.5, y: y + 0.75, z: z - z0 + 0.5, color: [1, 0.66, 0.32], intensity: 1.1, range: 9, kind: 'torch' }); torchAt(x, y, z); continue; }
    if (b === B.Sign) { signAt(x, y, z, place); continue; }
    if (b === B.Chimney && cells.get(x, y + 1, z) === 0) chimneyCrownAt(x, y, z);
    if (CLOTH[b] !== undefined) { awning(x, y, z, CLOTH[b]); continue; }
    if (b === B.Gravestone) { const [lx, lz] = L(x, z); batch('stone').box([lx + 0.2, y, lz + 0.42], [lx + 0.8, y + 0.9, lz + 0.58], [0.85, 0.85, 0.85], mats.tilesPerMetre('stone')); continue; }
    let mat = WALL_MATERIAL[b]; if (!mat) { const roof = ROOF_MATERIAL[b]; if (!roof) continue; mat = roof; }
    if (b === B.DarkPlanks && place) { const fit = fits.get(place.id); if (fit && y < fit.roofY) { trimAt(x, y, z, mat); continue; } }
    if (ROOF_MATERIAL[b] && b !== B.DarkPlanks && place && !fits.has(place.id)) mat = ROOF_MATERIAL[b];
    const bt = batch(mat), tpm = mats.tilesPerMetre(mat), [lx, lz] = L(x, z);
    for (const d of DIRS) {
      const nx = x + d.n[0], ny = y + d.n[1], nz = z + d.n[2];
      if (solid(nx, ny, nz) && cells.get(nx, ny, nz) !== 0) continue;
      const pts = d.corners.map(c => [lx + c[0], y + c[1], lz + c[2]] as V);
      const tints = d.corners.map(c => {
        const ax = d.n[0] ? 0 : d.n[1] ? 1 : 2, t1 = (ax + 1) % 3, t2 = (ax + 2) % 3, s1 = c[t1] ? 1 : -1, s2 = c[t2] ? 1 : -1;
        const at = (a: number, b2: number) => { const q = [nx, ny, nz]; q[t1] += a; q[t2] += b2; return solid(q[0], q[1], q[2]) && cells.get(q[0], q[1], q[2]) !== 0 ? 1 : 0; };
        const e1 = at(s1, 0), e2 = at(0, s2), cr = at(s1, s2), ao = e1 && e2 ? 0 : 3 - (e1 + e2 + cr), k = AO[ao] * variation * buildingTint;
        return [k, k, k] as V;
      });
      bt.quad(pts[0], pts[1], pts[2], pts[3], tints, tpm, { normal: d.n });
      out.stats.faces++;
    }
  }

  // Presentation shell: the projected cells remain the wall/roof authority, while this
  // deterministic pass gives the broad faces a readable timber-and-infill construction.
  // Every piece is kept on the outside skin and is owned by the same place batch, so the
  // existing cutaway material still removes it with the building.
  for (const p of buildings) {
    const fit = fits.get(p.id);
    if (!fit) continue;
    activePlace = p;
    decorateBuilding(batch, mats, cells, p, fit, x0, z0, architectureGrammar(p, cells));
  }

  function trimAt(x: number, y: number, z: number, mat: MatName): void {
    // Timber posts and beams stand 4 cm proud of the plaster; faces shared with other trim are dropped.
    const bt = batch(mat), tpm = mats.tilesPerMetre(mat), [lx, lz] = L(x, z), e = 0.04;
    for (const d of DIRS) {
      if (cells.get(x + d.n[0], y + d.n[1], z + d.n[2]) === B.DarkPlanks) continue;
      const pts = d.corners.map(c => [lx + c[0] + (c[0] ? e : -e), y + c[1] + (c[1] ? e : -e), lz + c[2] + (c[2] ? e : -e)] as V);
      bt.quad(pts[0], pts[1], pts[2], pts[3], [0.78, 0.78, 0.78], tpm, { normal: d.n });
    }
  }
  function torchAt(x: number, y: number, z: number): void {
    const [lx, lz] = L(x, z), bt = batch('darkwood');
    bt.box([lx + 0.45, y, lz + 0.45], [lx + 0.55, y + 0.62, lz + 0.55], [1, 1, 1], mats.tilesPerMetre('darkwood'));
    batch('gold').box([lx + 0.4, y + 0.62, lz + 0.4], [lx + 0.6, y + 0.72, lz + 0.6], [1.6, 1.3, 0.7], mats.tilesPerMetre('gold'));
  }
  function signAt(x: number, y: number, z: number, place: PlaceProjection | undefined): void {
    const [lx, lz] = L(x, z), sign = batch('wood');
    const front = place?.door ? (Math.abs(place.door.z - z) <= 1 ? (place.door.z <= place.bounds.z0 ? -1 : 1) : 0) : -1;
    if (front) {
      sign.box([lx + 0.12, y + 0.2, lz + (front < 0 ? -0.08 : 0.92)], [lx + 0.88, y + 0.68, lz + (front < 0 ? 0.08 : 1.08)], [0.84, 0.58, 0.34], mats.tilesPerMetre('wood'));
      batch('darkwood').box([lx + 0.45, y - 0.08, lz + 0.43], [lx + 0.55, y + 0.22, lz + 0.57], [0.72, 0.62, 0.48], mats.tilesPerMetre('darkwood'));
    } else {
      sign.box([lx + (place?.door && place.door.x <= x ? -0.08 : 0.92), y + 0.2, lz + 0.12], [lx + (place?.door && place.door.x <= x ? 0.08 : 1.08), y + 0.68, lz + 0.88], [0.84, 0.58, 0.34], mats.tilesPerMetre('wood'));
    }
  }
  function chimneyCrownAt(x: number, y: number, z: number): void {
    const [lx, lz] = L(x, z), crown = batch('stone');
    crown.box([lx - 0.06, y + 1, lz - 0.06], [lx + 1.06, y + 1.14, lz + 1.06], [0.68, 0.65, 0.58], mats.tilesPerMetre('stone'));
  }
  function awning(x: number, y: number, z: number, mat: MatName): void {
    const [lx, lz] = L(x, z), sag = 0.06 * Math.sin((x * 1.7 + z * 2.3)), bt = batch(mat);
    bt.box([lx, y + 0.82 + sag, lz], [lx + 1, y + 0.96 + sag, lz + 1], [1, 1, 1], mats.tilesPerMetre(mat));
  }
  function windowAt(x: number, y: number, z: number, place: PlaceProjection | undefined): void {
    out.stats.windows++;
    const [lx, lz] = L(x, z), alongX = (solid(x - 1, y, z) && solid(x + 1, y, z)) || !(solid(x, y, z - 1) && solid(x, y, z + 1));
    const frame = batch('darkwood'), glass = paneBatch(place?.id ?? '');
    const ftpm = mats.tilesPerMetre('darkwood'), gtpm = mats.tilesPerMetre('glass'), fw = 0.09, ft = 0.07;
    // Outer side: toward the nearest outside face of the owning building; inner is the other.
    let outer = -1;
    if (place) outer = alongX ? (z <= place.bounds.z0 ? -1 : 1) : (x <= place.bounds.x0 ? -1 : 1);
    const dark: V = [0.85, 0.85, 0.85];
    const bar = (min: V, max: V) => frame.box(min, max, dark, ftpm);
    if (alongX) {
      const pz = lz + 0.5; glass.quad([lx, y, pz], [lx + 1, y, pz], [lx + 1, y + 1, pz], [lx, y + 1, pz], [1, 1, 1], gtpm, { normal: [0, 0, 1] });
      glass.quad([lx, y, pz], [lx, y + 1, pz], [lx + 1, y + 1, pz], [lx + 1, y, pz], [1, 1, 1], gtpm, { normal: [0, 0, -1] });
      for (const zz of [lz - 0.02, lz + 1 - ft + 0.02]) { bar([lx, y, zz], [lx + fw, y + 1, zz + ft]); bar([lx + 1 - fw, y, zz], [lx + 1, y + 1, zz + ft]); bar([lx, y, zz], [lx + 1, y + fw, zz + ft]); bar([lx, y + 1 - fw, zz], [lx + 1, y + 1, zz + ft]); }
      bar([lx + 0.48, y, pz - 0.02], [lx + 0.52, y + 1, pz + 0.02]); bar([lx, y + 0.48, pz - 0.02], [lx + 1, y + 0.52, pz + 0.02]);
      const oz = outer < 0 ? lz - 0.12 : lz + 1.02;
      bar([lx - 0.04, y - 0.06, oz], [lx + 1.04, y + 0.03, oz + 0.12]);
      if (hash2(x, z, 77) > 0.4 && outer !== 0) { const sz = outer < 0 ? lz - 0.05 : lz + 1.0; bar([lx - 0.5, y, sz], [lx - 0.03, y + 1, sz + 0.05]); bar([lx + 1.03, y, sz], [lx + 1.5, y + 1, sz + 0.05]); }
    } else {
      const px = lx + 0.5; glass.quad([px, y, lz + 1], [px, y, lz], [px, y + 1, lz], [px, y + 1, lz + 1], [1, 1, 1], gtpm, { normal: [1, 0, 0] });
      glass.quad([px, y, lz], [px, y, lz + 1], [px, y + 1, lz + 1], [px, y + 1, lz], [1, 1, 1], gtpm, { normal: [-1, 0, 0] });
      for (const xx of [lx - 0.02, lx + 1 - ft + 0.02]) { bar([xx, y, lz], [xx + ft, y + 1, lz + fw]); bar([xx, y, lz + 1 - fw], [xx + ft, y + 1, lz + 1]); bar([xx, y, lz], [xx + ft, y + fw, lz + 1]); bar([xx, y + 1 - fw, lz], [xx + ft, y + 1, lz + 1]); }
      bar([px - 0.02, y, lz + 0.48], [px + 0.02, y + 1, lz + 0.52]); bar([px - 0.02, y + 0.48, lz], [px + 0.02, y + 0.52, lz + 1]);
      const ox = outer < 0 ? lx - 0.12 : lx + 1.02;
      bar([ox, y - 0.06, lz - 0.04], [ox + 0.12, y + 0.03, lz + 1.04]);
      if (hash2(x, z, 77) > 0.4) { const sx = outer < 0 ? lx - 0.05 : lx + 1.0; bar([sx, y, lz - 0.5], [sx + 0.05, y + 1, lz - 0.03]); bar([sx, y, lz + 1.03], [sx + 0.05, y + 1, lz + 1.5]); }
    }
    if (place && litPlaces.has(place.id)) out.lights.push({ x: lx + 0.5, y: y + 0.5, z: lz + 0.5, color: [1, 0.72, 0.4], intensity: 0.5, range: 6, kind: 'window' });
  }
  for (const [key, entry] of batches) {
    const mesh = entry.batch.build(`structure-${r.id}-${key}`, scene, mats.get(entry.material), { receiveShadow: true });
    if (mesh) {
      if (entry.place) {
        const material = mats.clone(entry.material, mesh.name + '-cutaway');
        material.clipPlane = new Plane(0, 1, 0, -1e8); mesh.material = material;
        mesh.metadata = { cutawayBounds: entry.place.bounds, ownsCutawayMaterial: true };
      }
      out.meshes.push(mesh);
    }
    yield;
  }
  for (const [id, gb] of glassBatches) {
    const mesh = gb.build(`panes-${r.id}-${id}`, scene, mats.get('glass'), { receiveShadow: false });
    if (mesh) {
      const place = buildings.find(p => p.id === id);
      if (place) { const material = mesh.material!.clone(mesh.name + '-cutaway')!; material.clipPlane = new Plane(0, 1, 0, -1e8); mesh.material = material; mesh.metadata = { cutawayBounds: place.bounds, ownsCutawayMaterial: true }; }
      out.meshes.push(mesh); out.panes.set(id, mesh);
    }
    yield;
  }
  return out;
}

/** Add restrained, cell-derived facade construction without changing the canonical shell. */
function decorateBuilding(batch: (m: MatName) => MeshBatch, mats: MaterialLibrary, cells: Cells, p: PlaceProjection, fit: RoofFit, rx: number, rz: number, profile: ArchitectureProfile): void {
  const { x0, x1, z0, z1 } = p.bounds;
  const base = fit.roofY - 1;
  const wallTop = base;
  const plaster = batch('plaster'), timber = batch('darkwood'), stone = batch('stone');
  const pt = mats.tilesPerMetre('plaster'), tt = mats.tilesPerMetre('darkwood'), st = mats.tilesPerMetre('stone');
  const age = hash2(p.visualSeed, 29, 71), panelTint: V = [.84-age*.09, .79-age*.10, .66-age*.07], beamTint: V = [0.86, 0.78, 0.67], foundationTint: V = [0.76, 0.76, 0.72];
  const wallCell = (x: number, y: number, z: number): number => cells.get(x, y, z);
  const isWall = (b: number): boolean => b === B.Planks || b === B.Log || b === B.DarkPlanks;
  // Greedily merge adjacent wood cells into broad infill faces. Openings remain holes in
  // the occupancy grid, so windows and doors never get painted over by the shell.
  const panels = (side: 'north' | 'south' | 'west' | 'east'): void => {
    const along = side === 'north' || side === 'south' ? x1 - x0 + 1 : z1 - z0 + 1;
    const rows = wallTop - (p.bounds.y0 + 1) + 1, used = new Uint8Array(along * rows);
    const filled = (i: number, j: number): boolean => {
      const x = side === 'north' || side === 'south' ? x0 + i : side === 'west' ? x0 : x1;
      const z = side === 'north' || side === 'south' ? (side === 'north' ? z0 : z1) : z0 + i;
      return isWall(wallCell(x, p.bounds.y0 + 1 + j, z));
    };
    const emit = (i0: number, j0: number, i1: number, j1: number): void => {
      const lx0 = x0 - rx + i0, lx1 = x0 - rx + i1 + 1, lz0 = z0 - rz + i0, lz1 = z0 - rz + i1 + 1;
      const y0 = p.bounds.y0 + 1 + j0, y1 = p.bounds.y0 + 2 + j1, d = 0.055;
      if (side === 'north') plaster.quad([lx0 + 0.04, y0, z0 - rz - d], [lx1 - 0.04, y0, z0 - rz - d], [lx1 - 0.04, y1, z0 - rz - d], [lx0 + 0.04, y1, z0 - rz - d], panelTint, pt, { normal: [0, 0, -1], flip: true });
      else if (side === 'south') plaster.quad([lx1 - 0.04, y0, z1 - rz + 1 + d], [lx0 + 0.04, y0, z1 - rz + 1 + d], [lx0 + 0.04, y1, z1 - rz + 1 + d], [lx1 - 0.04, y1, z1 - rz + 1 + d], panelTint, pt, { normal: [0, 0, 1], flip: true });
      else if (side === 'west') plaster.quad([x0 - rx - d, y0, lz1 - 0.04], [x0 - rx - d, y0, lz0 + 0.04], [x0 - rx - d, y1, lz0 + 0.04], [x0 - rx - d, y1, lz1 - 0.04], panelTint, pt, { normal: [-1, 0, 0], flip: true });
      else plaster.quad([x1 - rx + 1 + d, y0, lz0 + 0.04], [x1 - rx + 1 + d, y0, lz1 - 0.04], [x1 - rx + 1 + d, y1, lz1 - 0.04], [x1 - rx + 1 + d, y1, lz0 + 0.04], panelTint, pt, { normal: [1, 0, 0], flip: true });
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < along; i++) {
      const k = j * along + i; if (used[k] || !filled(i, j)) continue;
      let i1 = i; while (i1 + 1 < along && filled(i1 + 1, j) && !used[j * along + i1 + 1]) i1++;
      let j1 = j; outer: while (j1 + 1 < rows) { for (let q = i; q <= i1; q++) if (!filled(q, j1 + 1) || used[(j1 + 1) * along + q]) break outer; j1++; }
      for (let yy = j; yy <= j1; yy++) for (let xx = i; xx <= i1; xx++) used[yy * along + xx] = 1;
      emit(i, j, i1, j1);
    }
  };
  panels('north'); panels('south'); panels('west'); panels('east');
  // Low plinth and regular corner posts establish scale at distance; they deliberately sit
  // within the existing one-cell foundation margin and never cover an opening cell.
  stone.box([x0 - rx - 0.04, p.bounds.y0 - 0.18, z0 - rz - 0.04], [x1 + 1 - rx + 0.04, p.bounds.y0 + 0.04, z0 - rz + 0.1], foundationTint, st);
  stone.box([x0 - rx - 0.04, p.bounds.y0 - 0.18, z1 + 1 - rz - 0.1], [x1 + 1 - rx + 0.04, p.bounds.y0 + 0.04, z1 + 1 - rz + 0.04], foundationTint, st);
  stone.box([x0 - rx - 0.04, p.bounds.y0 - 0.18, z0 - rz + 0.1], [x0 - rx + 0.1, p.bounds.y0 + 0.04, z1 + 1 - rz - 0.1], foundationTint, st);
  stone.box([x1 - rx - 0.1, p.bounds.y0 - 0.18, z0 - rz + 0.1], [x1 + 1 - rx + 0.04, p.bounds.y0 + 0.04, z1 + 1 - rz - 0.1], foundationTint, st);
  const post = (x: number, z: number): void => timber.box([x - rx - 0.075, p.bounds.y0 + 0.02, z - rz - 0.075], [x - rx + 0.075, wallTop + 0.08, z - rz + 0.075], beamTint, tt);
  post(x0, z0); post(x0, z1+1); post(x1+1, z0); post(x1+1, z1+1);
  // Sill segments follow solid cells, including the door gap: a continuous sill would
  // visually block the doorway even though it has no canonical collision.
  const beamY0 = p.bounds.y0 + 1.02, beamY1 = wallTop + 0.02;
  for (const z of [z0,z1]) for (let x=x0;x<=x1;x++) if (isWall(cells.get(x,p.bounds.y0+1,z))) {
    const plane=z===z0?z0:z1+1;
    timber.box([x-rx,beamY0,plane-rz-.08],[x+1-rx,beamY0+.14,plane-rz+.08],beamTint,tt);
    stone.box([x-rx,p.bounds.y0-.08,plane-rz-.07],[x+1-rx,p.bounds.y0+.32,plane-rz+.07],foundationTint,st);
  }
  for (const x of [x0,x1]) for (let z=z0;z<=z1;z++) if (isWall(cells.get(x,p.bounds.y0+1,z))) {
    const plane=x===x0?x0:x1+1;
    timber.box([plane-rx-.08,beamY0,z-rz],[plane-rx+.08,beamY0+.14,z+1-rz],beamTint,tt);
    stone.box([plane-rx-.07,p.bounds.y0-.08,z-rz],[plane-rx+.07,p.bounds.y0+.32,z+1-rz],foundationTint,st);
  }
  timber.box([x0 - rx - 0.08, beamY1, z0 - rz - 0.08], [x1 + 1 - rx + 0.08, beamY1 + 0.14, z0 - rz + 0.06], beamTint, tt);
  timber.box([x0 - rx - 0.08, beamY1, z1 - rz + 0.94], [x1 + 1 - rx + 0.08, beamY1 + 0.14, z1 - rz + 1.08], beamTint, tt);
  timber.box([x0 - rx - 0.08, beamY1, z0 - rz - 0.08], [x0 - rx + 0.06, beamY1 + 0.14, z1 + 1 - rz + 0.08], beamTint, tt);
  timber.box([x1 - rx + 0.94, beamY1, z0 - rz - 0.08], [x1 - rx + 1.08, beamY1 + 0.14, z1 + 1 - rz + 0.08], beamTint, tt);
  // Three-metre bays keep the framing legible without recreating the voxel grid. A post is
  // emitted only where the canonical wall is wood for the entire story segment.
  const bayPost = (side: 'north' | 'south' | 'west' | 'east', i: number): void => {
    const vertical = (side === 'north' || side === 'south') ? x0 + i : z0 + i;
    for (let y = p.bounds.y0 + 1; y <= wallTop; y++) {
      const x = side === 'north' || side === 'south' ? vertical : side === 'west' ? x0 : x1;
      const z = side === 'north' || side === 'south' ? (side === 'north' ? z0 : z1) : vertical;
      if (!isWall(wallCell(x, y, z))) return;
    }
    if (side === 'north' || side === 'south') timber.box([vertical - rx - 0.07, beamY0, (side === 'north' ? z0 : z1) - rz - (side === 'north' ? 0.07 : -0.93)], [vertical - rx + 0.07, beamY1 + 0.14, (side === 'north' ? z0 : z1) - rz - (side === 'north' ? -0.07 : -1.07)], beamTint, tt);
    else timber.box([(side === 'west' ? x0 : x1) - rx - (side === 'west' ? 0.07 : -0.93), beamY0, vertical - rz - 0.07], [(side === 'west' ? x0 : x1) - rx - (side === 'west' ? -0.07 : -1.07), beamY1 + 0.14, vertical - rz + 0.07], beamTint, tt);
  };
  for (let i = 3; i < x1 - x0; i += profile.bay) { bayPost('north', i); bayPost('south', i); }
  for (let i = 3; i < z1 - z0; i += profile.bay) { bayPost('west', i); bayPost('east', i); }
  const solidBay = (side: 'north' | 'south' | 'west' | 'east', i0: number, i1: number): boolean => {
    for (let i = i0; i <= i1; i++) for (let y = p.bounds.y0 + 1; y <= wallTop; y++) {
      const x = side === 'north' || side === 'south' ? x0 + i : side === 'west' ? x0 : x1;
      const z = side === 'north' || side === 'south' ? (side === 'north' ? z0 : z1) : z0 + i;
      if (!isWall(wallCell(x, y, z))) return false;
    }
    return true;
  };
  const by0 = beamY0 + 0.14, by1 = beamY1;
  const brace = (side: 'north' | 'south' | 'west' | 'east', i0: number, i1: number): void => {
    if (!solidBay(side, i0, i1)) return;
    const lo = side === 'north' || side === 'south' ? x0 - rx + i0 : z0 - rz + i0;
    const hi = side === 'north' || side === 'south' ? x0 - rx + i1 + 1 : z0 - rz + i1 + 1;
    const d = 0.16;
    if (side === 'north' || side === 'south') {
      const z = (side === 'north' ? z0 - rz : z1 - rz) + (side === 'north' ? -0.085 : 1.085);
      const n: V = side === 'north' ? [0, 0, -1] : [0, 0, 1];
      const q=fixWinding([[lo,by0,z],[lo+d,by0,z],[hi,by1,z],[hi-d,by1,z]],n);
      timber.quad(q[0],q[1],q[2],q[3],beamTint,tt,{normal:n});
    } else {
      const x = (side === 'west' ? x0 - rx : x1 - rx) + (side === 'west' ? -0.085 : 1.085);
      const n: V = side === 'west' ? [-1, 0, 0] : [1, 0, 0];
      const q=fixWinding([[x,by0,lo],[x,by0,lo+d],[x,by1,hi],[x,by1,hi-d]],n);
      timber.quad(q[0],q[1],q[2],q[3],beamTint,tt,{normal:n});
    }
  };
  for (let i = 0; i < x1 - x0; i += 3) { brace('north', i, Math.min(i + 2, x1 - x0)); brace('south', i, Math.min(i + 2, x1 - x0)); }
  for (let i = 0; i < z1 - z0; i += 3) { brace('west', i, Math.min(i + 2, z1 - z0)); brace('east', i, Math.min(i + 2, z1 - z0)); }
  // Bracket-supported entry roofs stay above head clearance; there are no cosmetic
  // posts in the canonical approach lane. Public halls have a gabled porch hood,
  // while working buildings have a broader shed hood.
  if (profile.entry && p.door) {
    const side = [{d:Math.abs(p.door.z-z0),nx:0,nz:-1},{d:Math.abs(p.door.z-z1),nx:0,nz:1},{d:Math.abs(p.door.x-x0),nx:-1,nz:0},{d:Math.abs(p.door.x-x1),nx:1,nz:0}].sort((a,b)=>a.d-b.d)[0];
    const {nx,nz}=side, ex=nx?(nx<0?x0:x1+1):p.door.x+.5, ez=nz?(nz<0?z0:z1+1):p.door.z+.5;
    const half=profile.kind==='cottage'?.95:profile.kind==='workshop'||profile.kind==='shop'?2:1.65, depth=profile.kind==='cottage'?.8:1.35;
    const y=p.door.y+2.75, pitched=profile.kind==='tavern'||profile.kind==='civic'||profile.kind==='cottage';
    const P=(u:number,v:number,h:number):V=>[ex-rx+nz*u+nx*v,h,ez-rz-nx*u+nz*v];
    const face=(m:MeshBatch,q:V[],n:V,t:V,tpm:number)=>m.polygon(fixWinding(q,n),n,t,tpm);
    const hood=batch(fit.material),ht=mats.tilesPerMetre(fit.material);
    if(pitched) {
      for(const s of [-1,1]) {
        const surface=[P(s*half,-.08,y),P(s*half,depth,y),P(0,depth,y+.85),P(0,-.08,y+.85)];
        face(hood,surface,[nz*s,1,-nx*s],[.9,.86,.78],ht);
        face(timber,surface.map(p=>[p[0],p[1]-.08,p[2]] as V),[-nz*s,-1,nx*s],beamTint,tt);
        face(timber,[P(s*half,depth+.015,y-.12),P(0,depth+.015,y+.73),P(0,depth+.015,y+.87),P(s*half,depth+.015,y+.02)],[nx,0,nz],beamTint,tt);
      }
    } else {
      face(hood,[P(-half,-.08,y+.5),P(half,-.08,y+.5),P(half,depth,y),P(-half,depth,y)],[nx*.35,1,nz*.35],[.85,.8,.68],ht);
      face(timber,[P(-half,-.08,y+.42),P(half,-.08,y+.42),P(half,depth,y-.08),P(-half,depth,y-.08)],[-nx*.35,-1,-nz*.35],beamTint,tt);
      face(timber,[P(-half,depth,y-.13),P(half,depth,y-.13),P(half,depth,y),P(-half,depth,y)],[nx,0,nz],beamTint,tt);
    }
    // Side corbels tie the hood back into the wall above the doorway lintel.
    for(const s of [-1,1]) for(const u of [s*(half-.2)-.05,s*(half-.2)+.05]) {
      face(timber,[P(u,.03,y-.42),P(u,depth*.78,y-.08),P(u,.03,y-.08)],[nz*s,0,-nx*s],beamTint,tt);
    }
  }

}

/** Find the building's roof from its real cells, or null if it is not the standard gable. */
function fitRoof(cells: Cells, p: PlaceProjection): RoofFit | null {
  const { x0, x1, z0, z1 } = p.bounds;
  let roofY = Infinity, mat: MatName | null = null;
  for (let y = 0; y < 128; y++) { const b = cells.get(x0 - 1, y, z0 - 1); if (ROOF_MATERIAL[b]) { roofY = y; mat = ROOF_MATERIAL[b]; break; } }
  if (mat === null) return null;
  const alongZ = !!ROOF_MATERIAL[cells.get(x0 - 1, roofY, z0)] && !ROOF_MATERIAL[cells.get(x0, roofY, z0 - 1)];
  const alongX = !alongZ;
  // Expected roof cells for the standard construction.
  const expect = new Set<string>();
  const [a0, a1, b0, b1] = alongX ? [x0 - 1, x1 + 1, z0 - 1, z1 + 1] : [z0 - 1, z1 + 1, x0 - 1, x1 + 1];
  for (let i = 0; ; i++) {
    const ba = b0 + i, bb = b1 - i; if (ba > bb) break; const y = roofY + i;
    for (let a = a0; a <= a1; a++) for (const bcell of ba === bb ? [ba] : [ba, bb]) expect.add(alongX ? `${a},${y},${bcell}` : `${bcell},${y},${a}`);
  }
  let matches = 0, extra = 0;
  for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) for (let y = roofY; y < roofY + 40; y++) {
    if (!ROOF_MATERIAL[cells.get(x, y, z)]) continue;
    if (expect.has(`${x},${y},${z}`)) matches++; else extra++;
  }
  // A chimney or torch may stand where one roof cell would be; a few missing cells are fine, foreign cells are not.
  if (extra > 0 || expect.size - matches > Math.max(3, expect.size * 0.04)) return null;
  // Select gable infill from the dominant wall cells, rather than one corner sample
  // (which can accidentally hit a chimney, roof edge, or foundation block).
  const votes = new Map<MatName, number>();
  for (let y = roofY - 1; y >= roofY - 5; y--) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const b = cells.get(x, y, z), m = WALL_MATERIAL[b];
    if (m && !ROOF_MATERIAL[b] && b !== B.Glass && b !== B.DarkPlanks) votes.set(m, (votes.get(m) ?? 0) + 1);
  }
  let wall: MatName = 'plaster', best = -1;
  for (const [m, n] of votes) if (n > best) { wall = m; best = n; }
  return { roofY, alongX, material: mat, wall };
}

/** A watertight gable: two slopes, ridge, fascias, gable ends and eave friezes down to the wall tops. */
function buildGableRoof(batch: (m: MatName) => MeshBatch, mats: MaterialLibrary, p: PlaceProjection, fit: RoofFit, rx: number, rz: number, profile: ArchitectureProfile): void {
  const { x0, x1, z0, z1 } = p.bounds, y0 = fit.roofY, alongX = fit.alongX;
  // Work in (a = across the ridge, b = along the ridge) then map to x/z.
  const a0 = alongX ? z0 - 1 : x0 - 1, a1 = alongX ? z1 + 2 : x1 + 2, b0 = alongX ? x0 - 1 : z0 - 1, b1 = alongX ? x1 + 2 : z1 + 2;
  const ac = (a0 + a1) / 2, top = (a: number) => y0 + 0.5 + Math.min(a - a0, a1 - a), under = (a: number) => top(a) - T;
  const P = (a: number, b: number, y: number): V => alongX ? [b - rx, y, a - rz] : [a - rx, y, b - rz];
  const roof = batch(fit.material), rt = mats.tilesPerMetre(fit.material);
  // Timber houses get a warm plaster gable so the roof reads as a roof over a lived-in
  // wall, while stone/plaster buildings retain their canonical material identity.
  const gableWall: MatName = fit.wall === 'planks' || fit.wall === 'log' ? 'plaster' : fit.wall;
  const wallBatch = batch(gableWall), wt = mats.tilesPerMetre(gableWall);
  const tint: V = [1, 1, 1];
  const slope = (aa: number, ab: number, up: boolean) => {
    // top surface and underside for one slope between aa and ab
    const t0 = top(aa), t1 = top(ab);
    const q: V[] = [P(aa, b0, t0), P(aa, b1, t0), P(ab, b1, t1), P(ab, b0, t1)];
    const u: V[] = [P(aa, b0, t0 - T), P(aa, b1, t0 - T), P(ab, b1, t1 - T), P(ab, b0, t1 - T)];
    // orientation: make the normal point up for the top, down for the underside
    const n = cross3(sub3(q[1], q[0]), sub3(q[3], q[0]));
    const flipTop = n[1] < 0;
    roof.quad(q[0], q[1], q[2], q[3], tint, rt, { flip: flipTop });
    roof.quad(u[0], u[1], u[2], u[3], [0.72, 0.72, 0.72], rt, { flip: !flipTop });
    void up;
  };
  slope(a0, ac, true); slope(ac, a1, false);
  // Eave and barge fascia (the roof's edge thickness), in dark timber.
  const fas = batch('darkwood'), ft = mats.tilesPerMetre('darkwood'), dk: V = [0.9, 0.9, 0.9];
  const edge = (pts: V[], normal: V) => fas.polygon(fixWinding(pts, normal), normal, dk, ft);
  const nA0: V = alongX ? [0, 0, -1] : [-1, 0, 0], nA1: V = alongX ? [0, 0, 1] : [1, 0, 0], nB0: V = alongX ? [-1, 0, 0] : [0, 0, -1], nB1: V = alongX ? [1, 0, 0] : [0, 0, 1];
  edge([P(a0, b1, top(a0)), P(a0, b0, top(a0)), P(a0, b0, under(a0)), P(a0, b1, under(a0))], nA0);
  edge([P(a1, b0, top(a1)), P(a1, b1, top(a1)), P(a1, b1, under(a1)), P(a1, b0, under(a1))], nA1);
  for (const [b, nrm, flip] of [[b0, nB0, false], [b1, nB1, true]] as [number, V, boolean][]) {
    const prof = (aa: number, ab: number) => [P(aa, b, top(aa)), P(ab, b, top(ab)), P(ab, b, under(ab)), P(aa, b, under(aa))];
    for (const [aa, ab] of [[a0, ac], [ac, a1]]) { const q = prof(aa, ab); edge(flip ? q : q.slice().reverse(), nrm); }
  }
  const rr = ac, ty = top(rr), wallTop = y0;
  // A simple kingpost on each gable end gives the broad infill a structural reading at
  // distance without altering the fitted roof or any projected opening.
  const king = batch('darkwood'), kt = mats.tilesPerMetre('darkwood'), kTint: V = [0.72, 0.62, 0.48];
  const gablePost = (b: number): void => {
    const c = P(ac, b, wallTop + 0.03);
    king.box([c[0] - 0.08, c[1], c[2] - 0.08], [c[0] + 0.08, ty - 0.06, c[2] + 0.08], kTint, kt);
  };
  gablePost(b0 + 1); gablePost(b1 - 1);
  // Ridge cap.
  fas.box(alongX ? [b0 - rx - 0.06, ty - profile.eave, rr - rz - 0.16] : [rr - rx - 0.16, ty - profile.eave, b0 - rz - 0.06], alongX ? [b1 - rx + 0.06, ty + profile.eave, rr - rz + 0.16] : [rr - rx + 0.16, ty + profile.eave, b1 - rz + 0.06], dk, ft);
  // Wall fill from the wall top to the roof underside: eave friezes and gable ends, outside and in.
  const fill = (aLo: number, aHi: number, bPlane: number, outward: -1 | 1, nrm: V) => {
    // A face on the plane b = bPlane spanning a in [aLo, aHi], from wallTop up to the roof underside.
    const pts: V[] = [P(aLo, bPlane, wallTop), P(aHi, bPlane, wallTop)];
    const steps = [aHi, ...(aHi > ac && aLo < ac ? [ac] : []), aLo].filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
    for (const a of steps) pts.push(P(a, bPlane, Math.max(wallTop, under(a))));
    const ordered = outward < 0 ? pts : pts;
    wallBatch.polygon(ordered.length > 3 ? fixWinding(ordered, nrm) : ordered, nrm, [0.94, 0.94, 0.94], wt);
  };
  // gable ends (b planes): outer at b0+1 / b1-1 (wall faces), inner one cell in
  fill(a0 + 1, a1 - 1, b0 + 1, -1, nB0); fill(a0 + 2, a1 - 2, b0 + 2, 1, nB1.map(v => -v) as V);
  fill(a0 + 1, a1 - 1, b1 - 1, 1, nB1); fill(a0 + 2, a1 - 2, b1 - 2, -1, nB0.map(v => -v) as V);
  // eave friezes (a planes), outer and inner
  const frieze = (a: number, nrm: V) => {
    const h = Math.max(wallTop, under(a)); if (h - wallTop < 0.02) return;
    const q: V[] = [P(a, b0 + 1, wallTop), P(a, b1 - 1, wallTop), P(a, b1 - 1, h), P(a, b0 + 1, h)];
    wallBatch.polygon(fixWinding(q, nrm), nrm, [0.94, 0.94, 0.94], wt);
  };
  frieze(a0 + 1, nA0); frieze(a0 + 2, nA1); frieze(a1 - 1, nA1); frieze(a1 - 2, nA0);
  buildRoofIdentity(batch, mats, p, profile, {a0,a1,b0,b1,alongX,top,point:P,material:fit.material});
}
const sub3 = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface MillWheel { cells: Set<string>; x: number; y: number; z: number; radius: number }
export function findMillWheel(cells: Cells, p: PlaceProjection): MillWheel | null {
  if(p.type!=='mill') return null;
  // Recognize the canonical builder's nearby ring AND its axle. Never collect
  // unrelated dark roofs or trim elsewhere in the resident region.
  const {x0,x1,z0,z1,y0}=p.bounds, cz=Math.floor((z0+z1)/2);
  for(const x of [x0-2,x1+2]) for(const cy of [y0+1,y0+2]) {
    const towardWall=x<x0?1:-1;
    if([0,1,2].some(i=>cells.get(x+i*towardWall,cy,cz)!==B.Log)) continue;
    const ring=new Set<string>(); let missingAboveGround=false;
    for(let i=0;i<16;i++) {
      const a=i*Math.PI/8,y=cy+Math.round(Math.sin(a)*3.2),z=cz+Math.round(Math.cos(a)*3.2);
      if(cells.get(x,y,z)===B.DarkPlanks) ring.add(`${x},${y},${z}`);
      else if(y>=y0) missingAboveGround=true;
    }
    // Older observer recordings omit submerged/buried wheel cells. Never infer
    // missing above-ground parts, or sweep up unrelated roofs from the region.
    if(ring.size>=12&&!missingAboveGround) return {cells:ring,x:x+.5,y:cy+.5,z:cz+.5,radius:3.25};
  }
  return null;
}
export function buildMillWheel(batch: (m: MatName) => MeshBatch, mats: MaterialLibrary, w: MillWheel, rx: number, rz: number): void {
  const b=batch('wood'),tpm=mats.tilesPerMetre('wood'),tint:V=[.68,.57,.4],cx=w.x-rx,cz=w.z-rz;
  const point=(r:number,a:number,d:number):V=>[cx+d,w.y+Math.sin(a)*r,cz+Math.cos(a)*r];
  const face=(q:V[],n:V,color:V=tint)=>{const v=fixWinding(q,n);b.quad(v[0],v[1],v[2],v[3],color,tpm,{normal:n});};
  const inner=w.radius-.26,outer=w.radius,depth=.37;
  for(let i=0;i<24;i++) {
    const a=i*Math.PI/12,a1=(i+1)*Math.PI/12,mid=(a+a1)/2;
    for(const d of [-depth,depth]) face([point(inner,a,d),point(inner,a1,d),point(outer,a1,d),point(outer,a,d)],[Math.sign(d),0,0]);
    face([point(outer,a,-depth),point(outer,a1,-depth),point(outer,a1,depth),point(outer,a,depth)],[0,Math.sin(mid),Math.cos(mid)]);
    face([point(inner,a,-depth),point(inner,a1,-depth),point(inner,a1,depth),point(inner,a,depth)],[0,-Math.sin(mid),-Math.cos(mid)]);
    // Paddles sit inside the same original one-cell wheel thickness.
    if(i%2===0) face([point(outer-.08,a,-depth),point(outer+.13,a,-depth),point(outer+.13,a,depth),point(outer-.08,a,depth)],[0,Math.cos(a),-Math.sin(a)],[.54,.43,.28]);
  }
  for(let i=0;i<8;i++) {
    const a=i*Math.PI/4, sin=Math.sin(a),cos=Math.cos(a),near=.2,far=inner;
    const p=(r:number,s:number,d:number):V=>[cx+d,w.y+sin*r+cos*s,cz+cos*r-sin*s];
    for(const d of [-.16,.16]) face([p(near,-.09,d),p(far,-.09,d),p(far,.09,d),p(near,.09,d)],[Math.sign(d),0,0]);
    for(const s of [-.09,.09]) face([p(near,s,-.16),p(far,s,-.16),p(far,s,.16),p(near,s,.16)],[0,Math.sign(s)*cos,-Math.sign(s)*sin]);
  }
}
/** Reverse the point order if it winds clockwise relative to the requested outward normal. */
function fixWinding(points: V[], normal: V): V[] {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
  return nx * normal[0] + ny * normal[1] + nz * normal[2] < 0 ? points.slice().reverse() : points;
}
