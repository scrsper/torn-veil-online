import * as THREE from 'three';
import { B, BLOCKS } from '../../sim/physical/blocks';
import { VoxelGrid } from '../../sim/physical/grid';
import type { World } from '../../sim/core/world';
import type { Place } from '../../sim/core/types';
import type { RevealBox } from '../voxel/mesher';
import { GeoAccum, UNIT, place as xf, shade, tapered, type RGB } from './geo';
import { surfaceMaterial, surfaceTex, type SurfaceFamily } from './textures';

/**
 * Architecture, drawn as architecture.
 *
 * The canonical village is a set of `Place`s with real footprints, real doorways, real interiors
 * and real walls made of real blocks; the simulation reasons about all of it (who is inside,
 * what is owned, where a door is, whether a wall blocks sight). None of that changes here. What
 * changes is that the STAIRCASE the gable roof makes out of cubes is replaced by a pitched
 * surface built from the same cells, the walls get their timber frame, the window holes get
 * frames and mullions, and the door cells get a leaf that actually swings on the canonical
 * `doorStates` bit.
 *
 * How a building is found is entirely canonical: `Place.bounds` gives the footprint, the grid
 * gives the courses. Nothing is hand-placed, so any structure the world generator (or a future
 * construction project) produces is skinned by the same code.
 *
 * The one canonical fact this layer publishes back to another renderer is `claimedCells()` —
 * the cells it has taken responsibility for, so the chunk mesher stops drawing them and no cell
 * is ever drawn twice.
 */

/** Wall/roof fabric: the substances a building is made of, and the only cells this may claim. */
const FABRIC = new Set<number>([
  B.Planks, B.DarkPlanks, B.StoneBrick, B.Plaster, B.Log, B.Log2, B.Cobble, B.Brick,
  B.Thatch, B.RoofTile, B.Wool, B.Cloth, B.ClothRed, B.ClothBlue, B.Stone,
]);
/** Never counted as "the top of the building": these poke through or hang off the roof. */
const NOT_ROOF = new Set<number>([B.Chimney, B.Torch, B.Lantern, B.Fence, B.Sign, B.Air]);

const ROOF_FAMILY: Partial<Record<number, SurfaceFamily>> = {
  [B.Thatch]: 'thatch', [B.RoofTile]: 'tile', [B.DarkPlanks]: 'plank', [B.Planks]: 'plank',
  [B.StoneBrick]: 'stone', [B.Cobble]: 'stone', [B.Plaster]: 'plaster', [B.Log]: 'plank',
};

function rgbOf(id: number, k = 1): RGB {
  const c = BLOCKS[id]?.color ?? [0.5, 0.5, 0.5];
  return shade([c[0], c[1], c[2]], k);
}
function rnd(a: number, b: number, s: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s, 1013904223);
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Awning fabric. A market stall's canopy is cloth laid one course thick — a flat slab. */
const CLOTH = new Set<number>([B.Cloth, B.ClothRed, B.ClothBlue, B.Wool]);

interface StallPlan { place: Place; x0: number; x1: number; z0: number; z1: number; y: number; id: number; }

interface RoofPlan {
  place: Place;
  mask: Set<number>;              // (x * D + z) columns the roof covers
  topOf: Map<number, number>;     // column -> top roof cell y
  eaveY: number;
  roofId: number;                 // dominant roof substance
  wallId: number;                 // dominant wall substance
}

/** A door leaf that swings because the canonical door is open, not the other way round. */
interface DoorView { group: THREE.Group; x: number; y: number; z: number; closedYaw: number; openYaw: number; cur: number; }

export class BuildingSkin {
  group = new THREE.Group();
  private grid: VoxelGrid;
  private claimed = new Set<number>();
  private plans: RoofPlan[] = [];
  private stalls: StallPlan[] = [];
  private roofGroups = new Map<string, THREE.Group>();
  private doors: DoorView[] = [];
  private mats = new Map<SurfaceFamily, THREE.MeshStandardMaterial>();
  private glassMat = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  /** Lantern glass. The light itself is still the canonical block's — `Atmosphere` reads
   * `BlockDef.light` straight off the grid, exactly as before; this is only the visible flame. */
  private glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffa440, emissiveIntensity: 1.5, roughness: 0.4 });

  constructor(private world: World) {
    this.grid = world.grid;
    this.group.name = 'architecture';
    this.plan();
  }

  private mat(f: SurfaceFamily): THREE.MeshStandardMaterial {
    let m = this.mats.get(f);
    if (!m) { m = surfaceMaterial(f); this.mats.set(f, m); }
    return m;
  }

  /** Cells this skin has taken over. Hand to `VoxelRenderer.setSkinned` before the first build. */
  claimedCells(): Set<number> { return this.claimed; }

  /* ------------------------------- planning (canonical read) ------------------------------ */

  private topRoofY(x: number, z: number, floor: number): number {
    const g = this.grid;
    for (let y = g.H - 1; y > floor; y--) {
      const id = g.get(x, y, z);
      if (id === B.Air || NOT_ROOF.has(id)) continue;
      if (!FABRIC.has(id)) return -1;    // furniture/fixture on top: not a roof column
      return y;
    }
    return -1;
  }

  private plan(): void {
    const g = this.grid;
    this.planStalls();
    for (const p of this.world.places()) {
      if (!p.indoor) continue;
      const b = p.bounds;
      const floor = b.y0;
      // The eave is the lowest point of the roof over the building's own footprint. Columns that
      // do not end in roof fabric — a chimney stack punching through, a fixture on a wall head —
      // are simply not evidence either way, so they are ignored rather than treated as failure.
      // If too few columns are roofed at all, this is not a shape worth reinterpreting and the
      // building stays exactly as the chunk mesher already draws it.
      let eaveY = Infinity, roofed = 0, total = 0;
      for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) {
        total++;
        const t = this.topRoofY(x, z, floor);
        if (t < 0) continue;
        roofed++; eaveY = Math.min(eaveY, t);
      }
      if (!Number.isFinite(eaveY) || eaveY <= floor + 1 || roofed < total * 0.6) continue;

      const mask = new Set<number>(); const topOf = new Map<number, number>();
      const roofCount = new Map<number, number>();
      for (let x = b.x0 - 1; x <= b.x1 + 1; x++) for (let z = b.z0 - 1; z <= b.z1 + 1; z++) {
        if (!g.inBounds(x, 0, z)) continue;
        const t = this.topRoofY(x, z, floor);
        if (t < eaveY) continue;
        const col = x * g.D + z;
        mask.add(col); topOf.set(col, t);
        const id = g.get(x, t, z);
        roofCount.set(id, (roofCount.get(id) ?? 0) + 1);
        // Claim the fabric from the eave up: the roof shell and the gable ends it closes.
        for (let y = eaveY; y <= t; y++) {
          const cell = g.get(x, y, z);
          if (FABRIC.has(cell)) this.claimed.add(g.idx(x, y, z));
        }
      }
      if (!mask.size) continue;
      // Close single-column gaps the pass above left — the chimney penetration, mostly — so the
      // roof surface is continuous and the stack rises through it instead of standing in a hole.
      for (let x = b.x0 - 1; x <= b.x1 + 1; x++) for (let z = b.z0 - 1; z <= b.z1 + 1; z++) {
        const col = x * g.D + z;
        if (!g.inBounds(x, 0, z) || mask.has(col)) continue;
        let sum = 0, n = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = (x + dx) * g.D + (z + dz);
          if (mask.has(nc)) { sum += topOf.get(nc)!; n++; }
        }
        if (n >= 3) { mask.add(col); topOf.set(col, Math.round(sum / n)); }
      }
      let roofId = B.Thatch, best = -1;
      for (const [id, n] of roofCount) if (n > best) { best = n; roofId = id; }
      const wallId = this.dominantWall(p, eaveY);
      this.plans.push({ place: p, mask, topOf, eaveY, roofId, wallId });
    }
  }

  private dominantWall(p: Place, eaveY: number): number {
    const g = this.grid; const b = p.bounds; const count = new Map<number, number>();
    const y = Math.min(eaveY - 1, b.y0 + 2);
    for (let x = b.x0; x <= b.x1; x++) for (const z of [b.z0, b.z1]) { const id = g.get(x, y, z); if (FABRIC.has(id)) count.set(id, (count.get(id) ?? 0) + 1); }
    for (let z = b.z0; z <= b.z1; z++) for (const x of [b.x0, b.x1]) { const id = g.get(x, y, z); if (FABRIC.has(id)) count.set(id, (count.get(id) ?? 0) + 1); }
    let bestId = B.Planks, best = -1;
    for (const [id, n] of count) if (n > best) { best = n; bestId = id; }
    return bestId;
  }

  /* ------------------------------------- building ---------------------------------------- */

  build(): void {
    for (const p of this.plans) this.buildRoof(p);
    for (const s of this.stalls) this.buildAwning(s);
    this.buildOpenings();
  }

  /**
   * A market stall's canopy is one course of cloth in the canonical grid — a flat slab, and the
   * single most block-looking thing left standing in the square. Its extent, height and colour
   * are read from those cells; only its SHAPE is reinterpreted, into a pitched, valanced awning.
   */
  private planStalls(): void {
    const g = this.grid;
    for (const p of this.world.places()) {
      if (p.type !== 'stall') continue;
      const b = p.bounds;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = -1, id = B.Cloth;
      for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++) for (let yy = b.y0; yy <= b.y1 + 2; yy++) {
        const cell = g.get(x, yy, z);
        if (!CLOTH.has(cell)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
        y = Math.max(y, yy); id = cell;
        this.claimed.add(g.idx(x, yy, z));
      }
      if (y < 0) continue;
      this.stalls.push({ place: p, x0, x1, z0, z1, y, id });
    }
  }

  private buildAwning(s: StallPlan): void {
    const acc = new GeoAccum();
    const uv = surfaceTex('cloth').uvScale;
    const c = rgbOf(s.id, 1);
    const alongX = (s.x1 - s.x0) >= (s.z1 - s.z0);
    const O = 0.3;                                   // how far the canvas oversails the frame
    const lo0 = (alongX ? s.z0 : s.x0) - O, lo1 = (alongX ? s.z1 : s.x1) + 1 + O;
    const a0 = (alongX ? s.x0 : s.z0) - O, a1 = (alongX ? s.x1 : s.z1) + 1 + O;
    const mid = (lo0 + lo1) / 2;
    const eave = s.y + 0.05, ridge = s.y + 0.75;
    const P = (along: number, across: number, h: number) =>
      alongX ? new THREE.Vector3(along, h, across) : new THREE.Vector3(across, h, along);
    // Two panels meeting at a ridge, with a little sag toward the middle of each.
    const STEPS = 4;
    for (const side of [-1, 1] as const) {
      const edge = side < 0 ? lo0 : lo1;
      for (let i = 0; i < STEPS; i++) {
        const t0 = i / STEPS, t1 = (i + 1) / STEPS;
        const across = (t: number) => mid + (edge - mid) * t;
        const height = (t: number) => ridge + (eave - ridge) * t - Math.sin(t * Math.PI) * 0.09;
        const p00 = P(a0, across(t0), height(t0)), p10 = P(a1, across(t0), height(t0));
        const p01 = P(a0, across(t1), height(t1)), p11 = P(a1, across(t1), height(t1));
        const shadeK = 0.9 + t0 * 0.22;
        const q = (v: THREE.Vector3) => [v.x * uv, v.z * uv];
        acc.quad(p00, p10, p11, p01, shade(c, shadeK), [q(p00), q(p10), q(p11), q(p01)]);
      }
      // Scalloped valance hanging off the eave — the detail that says "market", not "slab".
      const n = Math.max(3, Math.round((a1 - a0) * 1.5));
      for (let i = 0; i < n; i++) {
        const u0 = a0 + (a1 - a0) * (i / n), u1 = a0 + (a1 - a0) * ((i + 1) / n);
        const drop = 0.16 + ((i % 2) ? 0.06 : 0);
        const t0 = P(u0, edge, eave), t1v = P(u1, edge, eave);
        const b0 = P(u0, edge, eave - drop), b1 = P(u1, edge, eave - drop);
        const q = (v: THREE.Vector3) => [v.x * uv, v.y * uv];
        acc.quad(t0, t1v, b1, b0, shade(c, 0.82), [q(t0), q(t1v), q(b1), q(b0)]);
      }
    }
    // Ridge pole and two struts, so the canvas is visibly held up by something.
    const wood: RGB = [0.32, 0.23, 0.14];
    const poleLen = a1 - a0;
    const cAlong = (a0 + a1) / 2;
    const rc = P(cAlong, mid, ridge + 0.04);
    acc.add(UNIT.cyl6, alongX
      ? xf(rc.x, rc.y, rc.z, 0.09, poleLen, 0.09, 0, 0, Math.PI / 2)
      : xf(rc.x, rc.y, rc.z, 0.09, poleLen, 0.09, 0, Math.PI / 2, 0), wood, surfaceTex('plank').uvScale);
    const geo = acc.build();
    if (!geo) return;
    const m = new THREE.Mesh(geo, surfaceMaterial('cloth', { side: THREE.DoubleSide, roughness: 0.95 }));
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  private buildRoof(plan: RoofPlan): void {
    const g = this.grid;
    const { mask, topOf, eaveY } = plan;
    const masked = (x: number, z: number) => mask.has(x * g.D + z);
    const cellH = (x: number, z: number) => (topOf.get(x * g.D + z) ?? eaveY - 1) + 1;

    // Corner-averaged vertex heights, exactly the trick the terrain skin uses: the staircase of
    // roof courses becomes one continuous slope without any of the cells moving.
    const vert = (vx: number, vz: number): { y: number; edge: THREE.Vector2 } => {
      let sum = 0, n = 0; const out = new THREE.Vector2();
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        if (masked(vx + dx, vz + dz)) { sum += cellH(vx + dx, vz + dz); n++; }
        else out.add(new THREE.Vector2(dx + 0.5, dz + 0.5));
      }
      return { y: n ? sum / n : eaveY, edge: out };
    };

    const OVERHANG = 0.42;
    const posOf = (vx: number, vz: number): THREE.Vector3 => {
      const v = vert(vx, vz);
      const e = v.edge;
      if (e.lengthSq() > 0) e.normalize().multiplyScalar(OVERHANG);
      return new THREE.Vector3(vx + e.x, v.y, vz + e.y);
    };

    const cache = new Map<number, THREE.Vector3>();
    const P = (vx: number, vz: number): THREE.Vector3 => {
      const k = vx * 4096 + vz;
      let v = cache.get(k); if (!v) { v = posOf(vx, vz); cache.set(k, v); }
      return v;
    };

    const roofFam = ROOF_FAMILY[plan.roofId] ?? 'thatch';
    const wallFam = ROOF_FAMILY[plan.wallId] ?? 'plaster';
    const roofAcc = new GeoAccum(), gableAcc = new GeoAccum(), timberAcc = new GeoAccum();
    const roofUV = surfaceTex(roofFam).uvScale;
    const baseC = rgbOf(plan.roofId, 1);

    let ridgeY = -Infinity;
    for (const col of mask) ridgeY = Math.max(ridgeY, cellH(Math.floor(col / g.D), col % g.D));

    for (const col of mask) {
      const x = Math.floor(col / g.D), z = col % g.D;
      const a = P(x, z), b = P(x + 1, z), c = P(x + 1, z + 1), d = P(x, z + 1);
      // Slope-aware shading: a lit pitch and a shaded pitch is most of what makes a roof read.
      const cc = shade(baseC, 0.9 + rnd(x, z, 3) * 0.2);
      const uv = (p: THREE.Vector3) => [p.x * roofUV, (p.z + p.y * 0.9) * roofUV];
      // Counter-clockwise seen from above, so the pitch's front face is the one you stand under.
      const n1 = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(b, a)).normalize();
      roofAcc.tri(a, c, b, n1, n1, n1, cc, cc, cc, uv(a), uv(c), uv(b));
      const n2 = new THREE.Vector3().subVectors(d, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      roofAcc.tri(a, d, c, n2, n2, n2, cc, cc, cc, uv(a), uv(d), uv(c));

      // Where the roof ends, drop a face to the eave line. On the long sides that is a shallow
      // fascia; on a gable end it is the triangle that closes the attic.
      const sides: [number, number, THREE.Vector3, THREE.Vector3][] = [
        [1, 0, b, c], [-1, 0, d, a], [0, 1, c, d], [0, -1, a, b],
      ];
      for (const [dx, dz, p0, p1] of sides) {
        if (masked(x + dx, z + dz)) continue;
        const bottom = eaveY - 0.28;
        const q0 = new THREE.Vector3(p0.x, bottom, p0.z), q1 = new THREE.Vector3(p1.x, bottom, p1.z);
        const gableish = Math.max(p0.y, p1.y) - eaveY > 1.2;
        const acc = gableish ? gableAcc : roofAcc;
        const col2 = gableish ? rgbOf(plan.wallId, 1) : shade(baseC, 0.72);
        const s = gableish ? surfaceTex(wallFam).uvScale : roofUV;
        acc.quad(p1, p0, q0, q1, col2, [[p1.x * s, p1.y * s], [p0.x * s, p0.y * s], [q0.x * s, q0.y * s], [q1.x * s, q1.y * s]]);
      }
    }

    // Ridge cap: the line of cells at the top of the roof, capped with a beam.
    const ridgeCells = [...mask].filter(col => cellH(Math.floor(col / g.D), col % g.D) >= ridgeY - 0.01)
      .map(col => ({ x: Math.floor(col / g.D), z: col % g.D }));
    if (ridgeCells.length > 1) {
      const xs = ridgeCells.map(r => r.x), zs = ridgeCells.map(r => r.z);
      const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
      const alongX = spanX >= spanZ;
      const cxm = (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5, czm = (Math.min(...zs) + Math.max(...zs)) / 2 + 0.5;
      const len = (alongX ? spanX : spanZ) + 1.6;
      // The unit primitive runs along Y: a ridge along X is a roll about Z, along Z about X.
      const m = alongX
        ? xf(cxm, ridgeY + 0.06, czm, 0.34, len, 0.34, 0, 0, Math.PI / 2)
        : xf(cxm, ridgeY + 0.06, czm, 0.34, len, 0.34, 0, Math.PI / 2, 0);
      timberAcc.add(UNIT.cyl8, m, shade(baseC, 0.78), surfaceTex(roofFam).uvScale);
    }

    this.timberFrame(plan, timberAcc);

    const grp = new THREE.Group();
    grp.name = `roof:${plan.place.id}`;
    for (const [acc, fam] of [[roofAcc, roofFam], [gableAcc, wallFam], [timberAcc, 'plank' as SurfaceFamily]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mat(fam as SurfaceFamily));
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    this.group.add(grp);
    this.roofGroups.set(plan.place.id, grp);
  }

  /**
   * Exposed timber framing on plastered or planked walls: sill, mid-rail, top plate and studs.
   * Emitted only where the canonical wall cell is actually solid, so a doorway or a window
   * opening is never framed over.
   */
  private timberFrame(plan: RoofPlan, acc: GeoAccum): void {
    const g = this.grid; const b = plan.place.bounds;
    if (plan.wallId !== B.Plaster && plan.wallId !== B.Planks) return;
    const timber: RGB = [0.24, 0.17, 0.11];
    const y0 = b.y0 + 1, y1 = plan.eaveY - 1;
    if (y1 <= y0) return;
    const T = 0.09, PROUD = 0.055;
    const solidAt = (x: number, y: number, z: number) => { const id = g.get(x, y, z); return id !== B.Air && id !== B.Door && id !== B.Glass && FABRIC.has(id); };

    // Four wall planes. `n` is the outward normal; the beams sit just proud of the wall face.
    const planes: { fixed: 'x' | 'z'; at: number; face: number; from: number; to: number }[] = [
      { fixed: 'z', at: b.z0, face: b.z0, from: b.x0, to: b.x1 },
      { fixed: 'z', at: b.z1, face: b.z1 + 1, from: b.x0, to: b.x1 },
      { fixed: 'x', at: b.x0, face: b.x0, from: b.z0, to: b.z1 },
      { fixed: 'x', at: b.x1, face: b.x1 + 1, from: b.z0, to: b.z1 },
    ];
    for (const pl of planes) {
      const outward = (pl.at === b.z0 || pl.at === b.x0) ? -1 : 1;
      const s = pl.face + outward * PROUD;
      const beam = (lo: number, hi: number, y: number, h: number) => {
        const mid = (lo + hi + 1) / 2, len = hi - lo + 1;
        if (pl.fixed === 'z') acc.add(UNIT.box, xf(mid, y, s, len, h, T), timber, surfaceTex('plank').uvScale);
        else acc.add(UNIT.box, xf(s, y, mid, T, h, len), timber, surfaceTex('plank').uvScale);
      };
      const cellSolid = (u: number, y: number) => pl.fixed === 'z' ? solidAt(u, y, pl.at) : solidAt(pl.at, y, u);
      // Horizontal members, broken wherever the wall itself is broken.
      for (const [y, h] of [[y0 + 0.06, 0.16], [(y0 + y1) / 2 + 0.5, 0.14], [y1 + 0.92, 0.2]] as const) {
        let run = -1;
        for (let u = pl.from; u <= pl.to + 1; u++) {
          const ok = u <= pl.to && cellSolid(u, Math.min(y1, Math.max(y0, Math.round(y))));
          if (ok && run < 0) run = u;
          else if (!ok && run >= 0) { beam(run, u - 1, y, h); run = -1; }
        }
      }
      // Studs, on the courses where the whole column is wall.
      for (let u = pl.from; u <= pl.to; u++) {
        if ((u - pl.from) % 2 !== 0) continue;
        let full = true;
        for (let y = y0; y <= y1 && full; y++) if (!cellSolid(u, y)) full = false;
        if (!full) continue;
        const mid = u + 0.5, h = y1 - y0 + 1.1;
        if (pl.fixed === 'z') acc.add(UNIT.box, xf(mid, (y0 + y1) / 2 + 0.5, s, 0.14, h, T), timber, surfaceTex('plank').uvScale);
        else acc.add(UNIT.box, xf(s, (y0 + y1) / 2 + 0.5, mid, T, h, 0.14), timber, surfaceTex('plank').uvScale);
      }
    }
  }

  /**
   * Windows, doors and fences: cells the style table routes to this skin (`architecture`), drawn
   * once for the whole world rather than per building, because they exist outside `Place`s too.
   */
  private buildOpenings(): void {
    const g = this.grid;
    const frameAcc = new GeoAccum(), glassAcc = new GeoAccum(), fenceAcc = new GeoAccum(), glowAcc = new GeoAccum();
    const timber: RGB = [0.26, 0.19, 0.12];
    const uvP = surfaceTex('plank').uvScale;
    for (let x = 0; x < g.W; x++) for (let z = 0; z < g.D; z++) for (let y = 1; y < g.H; y++) {
      const id = g.get(x, y, z);
      if (id === B.Glass) this.window(frameAcc, glassAcc, x, y, z, timber, uvP);
      else if (id === B.Door) this.door(frameAcc, x, y, z, timber, uvP);
      else if (id === B.Fence) this.fence(fenceAcc, x, y, z, uvP);
      else if (id === B.Lantern) this.lantern(frameAcc, glowAcc, x, y, z, uvP);
    }
    for (const [acc, mat] of [[frameAcc, this.mat('plank')], [fenceAcc, this.mat('plank')], [glassAcc, this.glassMat], [glowAcc, this.glowMat]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, mat as THREE.Material);
      m.castShadow = mat !== this.glassMat; m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** True when the wall this opening sits in runs along X (so the opening faces ±z). */
  private alongX(x: number, y: number, z: number): boolean {
    const g = this.grid;
    const wallLike = (id: number) => id !== B.Air && id !== B.Door && id !== B.Glass && (BLOCKS[id]?.shape === 'cube');
    return Number(wallLike(g.get(x - 1, y, z))) + Number(wallLike(g.get(x + 1, y, z)))
      >= Number(wallLike(g.get(x, y, z - 1))) + Number(wallLike(g.get(x, y, z + 1)));
  }

  private window(frame: GeoAccum, glass: GeoAccum, x: number, y: number, z: number, timber: RGB, uv: number): void {
    const ax = this.alongX(x, y, z);
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const T = 0.13, D = 0.34;
    // Frame: head, sill and two jambs, recessed into the wall thickness.
    if (ax) {
      frame.add(UNIT.box, xf(cx, y + 0.94, cz, 1.0, T, D), timber, uv);
      frame.add(UNIT.box, xf(cx, y + 0.06, cz, 1.0, T, D), shade(timber, 1.1), uv);
      for (const dx of [-0.44, 0.44]) frame.add(UNIT.box, xf(cx + dx, cy, cz, T, 1.0, D), timber, uv);
      frame.add(UNIT.box, xf(cx, cy, cz, 0.07, 0.9, D * 0.8), timber, uv);
      frame.add(UNIT.box, xf(cx, cy, cz, 0.85, 0.06, D * 0.8), timber, uv);
      glass.quad(new THREE.Vector3(x + 0.06, y + 0.1, cz), new THREE.Vector3(x + 0.94, y + 0.1, cz), new THREE.Vector3(x + 0.94, y + 0.9, cz), new THREE.Vector3(x + 0.06, y + 0.9, cz), [0.75, 0.85, 0.92]);
    } else {
      frame.add(UNIT.box, xf(cx, y + 0.94, cz, D, T, 1.0), timber, uv);
      frame.add(UNIT.box, xf(cx, y + 0.06, cz, D, T, 1.0), shade(timber, 1.1), uv);
      for (const dz of [-0.44, 0.44]) frame.add(UNIT.box, xf(cx, cy, cz + dz, D, 1.0, T), timber, uv);
      frame.add(UNIT.box, xf(cx, cy, cz, D * 0.8, 0.9, 0.07), timber, uv);
      frame.add(UNIT.box, xf(cx, cy, cz, D * 0.8, 0.06, 0.85), timber, uv);
      glass.quad(new THREE.Vector3(cx, y + 0.1, z + 0.06), new THREE.Vector3(cx, y + 0.1, z + 0.94), new THREE.Vector3(cx, y + 0.9, z + 0.94), new THREE.Vector3(cx, y + 0.9, z + 0.06), [0.75, 0.85, 0.92]);
    }
  }

  /**
   * A door: a static frame in the merged geometry, plus a hinged leaf as its own small object so
   * it can swing. The swing is driven every frame from `VoxelGrid.isDoorOpen` — canonical state
   * the simulation's own `toggleDoor` writes — and drives nothing in return.
   */
  private door(frame: GeoAccum, x: number, y: number, z: number, timber: RGB, uv: number): void {
    const ax = this.alongX(x, y, z);
    const cx = x + 0.5, cz = z + 0.5;
    const jamb = shade(timber, 0.85);
    if (ax) {
      for (const dx of [-0.46, 0.46]) frame.add(UNIT.box, xf(cx + dx, y + 0.5, cz, 0.1, 1.06, 0.4), jamb, uv);
      frame.add(UNIT.box, xf(cx, y + 1.0, cz, 1.06, 0.14, 0.44), jamb, uv);
    } else {
      for (const dz of [-0.46, 0.46]) frame.add(UNIT.box, xf(cx, y + 0.5, cz + dz, 0.4, 1.06, 0.1), jamb, uv);
      frame.add(UNIT.box, xf(cx, y + 1.0, cz, 0.44, 0.14, 1.06), jamb, uv);
    }
    // The leaf, modelled about its hinge so a rotation on the group is a real swing.
    const leafAcc = new GeoAccum();
    const W = 0.86, H = 0.96;
    const boards = 4;
    for (let i = 0; i < boards; i++) {
      const w = W / boards;
      leafAcc.add(UNIT.box, xf(w * (i + 0.5), H / 2, 0, w * 0.94, H, 0.11), shade(timber, 1.05 + (i % 2) * 0.12), uv);
    }
    for (const by of [H * 0.24, H * 0.76]) leafAcc.add(UNIT.box, xf(W / 2, by, 0.06, W, 0.09, 0.05), [0.16, 0.15, 0.15], uv);
    leafAcc.add(UNIT.cyl6, xf(W * 0.86, H * 0.5, 0.1, 0.07, 0.16, 0.07), [0.2, 0.19, 0.18], uv);
    const geo = leafAcc.build();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, this.mat('plank'));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const grp = new THREE.Group();
    grp.add(mesh);
    // Hinge on the low-coordinate jamb; the leaf fills the opening when closed.
    const closedYaw = ax ? 0 : Math.PI / 2;
    grp.position.set(ax ? x + 0.07 : cx, y, ax ? cz : z + 0.07);
    grp.rotation.y = closedYaw;
    this.group.add(grp);
    this.doors.push({ group: grp, x, y, z, closedYaw, openYaw: closedYaw - Math.PI * 0.52, cur: closedYaw });
  }

  /** A hanging lantern: an iron frame around a lit pane, instead of a glowing cube. */
  private lantern(frame: GeoAccum, glow: GeoAccum, x: number, y: number, z: number, uv: number): void {
    const cx = x + 0.5, cz = z + 0.5, cy = y + 0.34;
    const iron: RGB = [0.17, 0.16, 0.16];
    glow.add(tapered(0.9, 6), xf(cx, cy, cz, 0.3, 0.34, 0.3), [1.0, 0.84, 0.5], uv);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      frame.add(UNIT.box, xf(cx + dx * 0.14, cy, cz + dz * 0.14, 0.045, 0.36, 0.045), iron, uv);
    }
    frame.add(UNIT.cone, xf(cx, cy + 0.28, cz, 0.42, 0.2, 0.42), iron, uv);
    frame.add(UNIT.cyl6, xf(cx, cy - 0.19, cz, 0.3, 0.05, 0.3), iron, uv);
    frame.add(UNIT.cyl6, xf(cx, cy + 0.42, cz, 0.09, 0.12, 0.09), iron, uv);
  }

  private fence(acc: GeoAccum, x: number, y: number, z: number, uv: number): void {
    const g = this.grid;
    const c = rgbOf(B.Fence, 0.95 + rnd(x, z, 7) * 0.15);
    const cx = x + 0.5, cz = z + 0.5;
    acc.add(UNIT.cyl6, xf(cx, y + 0.52, cz, 0.15, 1.04, 0.15), c, uv);
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      if (g.get(x + dx, y, z + dz) !== B.Fence) continue;
      for (const ry of [0.36, 0.78]) {
        acc.add(UNIT.cyl6, xf(cx + dx * 0.5, y + ry, cz + dz * 0.5, 0.09, 1.0, 0.09, 0, dz ? Math.PI / 2 : 0, dx ? Math.PI / 2 : 0), shade(c, 1.05), uv);
      }
    }
  }

  /* -------------------------------------- runtime ---------------------------------------- */

  /**
   * Hide the pitched roof of the building currently being looked into. The chunk mesher already
   * drops the wall courses above the cut (`RevealBox`); this is the same signal applied to the
   * one piece of the building this skin owns, so v0.10.1's interior reveal keeps working exactly
   * as it did.
   */
  setReveal(box: RevealBox | null): void {
    for (const p of this.plans) {
      const g = this.roofGroups.get(p.place.id);
      if (!g) continue;
      const b = p.place.bounds;
      const hidden = !!box && box.x0 <= b.x0 && box.x1 >= b.x1 && box.z0 <= b.z0 && box.z1 >= b.z1;
      g.visible = !hidden;
    }
  }

  /** Swing every door toward whatever the canonical grid says it is. Presentation only. */
  update(dt: number): void {
    for (const d of this.doors) {
      const want = this.grid.isDoorOpen(d.x, d.y, d.z) ? d.openYaw : d.closedYaw;
      if (Math.abs(want - d.cur) < 1e-3) continue;
      d.cur += (want - d.cur) * Math.min(1, dt * 9);
      d.group.rotation.y = d.cur;
    }
  }
}
