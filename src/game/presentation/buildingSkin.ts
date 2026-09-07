import * as THREE from 'three';
import { B, BLOCKS } from '../../sim/physical/blocks';
import { VoxelGrid } from '../../sim/physical/grid';
import type { World } from '../../sim/core/world';
import type { Place } from '../../sim/core/types';
import type { RevealBox } from '../voxel/mesher';
import { GeoAccum, UNIT, place as xf, shade, shell, tapered, mixRGB, type RGB } from './geo';
import { surfaceMaterial, surfaceTex, type SurfaceFamily } from './textures';
import { archetypeOf, buildingStyle, cultureFor, type BuildingArchetype, type BuildingStyle } from './culture';

/**
 * Architecture, drawn as architecture.
 *
 * The canonical village is a set of `Place`s with real footprints, doorways, interiors and walls
 * made of real blocks, and the simulation reasons about all of it. None of that changes here.
 * What this does is reinterpret the SHAPE: the staircase a gable roof makes out of cubes becomes
 * a deep-eaved pitched roof with a ridge and lifted corners, the wall courses get a timber frame
 * over plaster infill, the footprint gets a stone plinth and a plank veranda, and the doorway
 * gets a hanging curtain.
 *
 * Which vocabulary those parts are drawn in is NOT decided here — `culture.ts` maps the canonical
 * `Place.type` to a culture-free archetype and then to a style pack, so the same canonical
 * bakery could be presented in a completely different architectural tradition by adding a pack.
 * This file only knows "deep eave", "ridge cap", "infill panel"; it does not know the word
 * "kawara" and it does not know which culture it is drawing.
 *
 * `claimedCells()` is the one thing published back to another renderer: the cells this skin has
 * taken responsibility for, which the chunk mesher then reads as air so nothing is drawn twice.
 */

/** Wall/roof fabric: the substances a building is made of, and the only cells this may claim. */
const FABRIC = new Set<number>([
  B.Planks, B.DarkPlanks, B.StoneBrick, B.Plaster, B.Log, B.Log2, B.Cobble, B.Brick,
  B.Thatch, B.RoofTile, B.Wool, B.Cloth, B.ClothRed, B.ClothBlue, B.Stone,
]);
/** Never counted as "the top of the building": these poke through or hang off the roof. */
const NOT_ROOF = new Set<number>([B.Chimney, B.Torch, B.Lantern, B.Fence, B.Sign, B.Air]);
/** Awning fabric. A market stall's canopy is cloth laid one course thick — a flat slab. */
const CLOTH = new Set<number>([B.Cloth, B.ClothRed, B.ClothBlue, B.Wool]);

function rgbOf(id: number, k = 1): RGB {
  const c = BLOCKS[id]?.color ?? [0.5, 0.5, 0.5];
  return shade([c[0], c[1], c[2]], k);
}
function rnd(a: number, b: number, s: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s, 1013904223);
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface StallPlan { place: Place; x0: number; x1: number; z0: number; z1: number; y: number; id: number; }

interface RoofPlan {
  place: Place;
  archetype: BuildingArchetype;
  style: BuildingStyle;
  mask: Set<number>;
  topOf: Map<number, number>;
  eaveY: number;
  roofId: number;
  wallId: number;
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
  private clothMat = (() => {
    // Hung cloth is smooth at a distance: the weave normal is dialled right down so an awning
    // reads as fabric under tension rather than as a rock face.
    const m = surfaceMaterial('cloth', { side: THREE.DoubleSide, roughness: 0.95 });
    m.normalScale.set(0.25, 0.25);
    return m;
  })();
  private glassMat = new THREE.MeshStandardMaterial({ color: 0xf0dcae, roughness: 0.55, metalness: 0, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  /** Lantern light. `Atmosphere` still reads `BlockDef.light` off the grid; this is the flame. */
  private glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffb060, emissiveIntensity: 1.7, roughness: 0.5 });

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

  claimedCells(): Set<number> { return this.claimed; }

  /* ------------------------------- planning (canonical read) ------------------------------ */

  private topRoofY(x: number, z: number, floor: number): number {
    const g = this.grid;
    for (let y = g.H - 1; y > floor; y--) {
      const id = g.get(x, y, z);
      if (id === B.Air || NOT_ROOF.has(id)) continue;
      if (!FABRIC.has(id)) return -1;
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
        for (let y = eaveY; y <= t; y++) {
          const cell = g.get(x, y, z);
          if (FABRIC.has(cell)) this.claimed.add(g.idx(x, y, z));
        }
      }
      if (!mask.size) continue;
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
      const archetype = archetypeOf(p.type);
      const style = buildingStyle(cultureFor(p), archetype);
      this.plans.push({ place: p, archetype, style, mask, topOf, eaveY, roofId, wallId: this.dominantWall(p, eaveY) });
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

  /* ------------------------------------- building ---------------------------------------- */

  build(): void {
    for (const p of this.plans) this.buildBuilding(p);
    for (const s of this.stalls) this.buildAwning(s);
    this.buildOpenings();
  }

  /**
   * One building: roof, then everything that hangs off it or sits under it. All of it is placed
   * from canonical geometry — the footprint, the eave course, the doorway cell — so a differently
   * shaped building produces a differently shaped result with no per-building authoring.
   */
  private buildBuilding(plan: RoofPlan): void {
    const g = this.grid;
    const { mask, topOf, eaveY, style } = plan;
    const masked = (x: number, z: number) => mask.has(x * g.D + z);
    const cellH = (x: number, z: number) => (topOf.get(x * g.D + z) ?? eaveY - 1) + 1;

    // Corner-averaged vertex heights, then pitched up: the canonical courses give the SHAPE of
    // the roof, and the style pack exaggerates it into the steep, deep-eaved profile the
    // references use. The eave stays exactly where the canonical wall head is, so the roof never
    // floats off the building it belongs to.
    const vert = (vx: number, vz: number): { y: number; edge: THREE.Vector2; open: number } => {
      let sum = 0, n = 0, open = 0; const out = new THREE.Vector2();
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        if (masked(vx + dx, vz + dz)) { sum += cellH(vx + dx, vz + dz); n++; }
        else { out.add(new THREE.Vector2(dx + 0.5, dz + 0.5)); open++; }
      }
      const raw = n ? sum / n : eaveY;
      const pitched = eaveY + (raw - eaveY) * (1 + style.pitchLift * 0.5);
      return { y: pitched, edge: out, open };
    };

    const posOf = (vx: number, vz: number): THREE.Vector3 => {
      const v = vert(vx, vz);
      const e = v.edge;
      if (e.lengthSq() > 0) e.normalize().multiplyScalar(style.overhang);
      // Outer corners (three of the four cells around the vertex are outside the roof) lift, the
      // subtle upsweep that stops a deep eave reading as a slab.
      const lift = v.open === 3 ? style.cornerLift : 0;
      return new THREE.Vector3(vx + e.x, v.y + lift, vz + e.y);
    };

    const cache = new Map<number, THREE.Vector3>();
    const P = (vx: number, vz: number): THREE.Vector3 => {
      const k = vx * 4096 + vz;
      let v = cache.get(k); if (!v) { v = posOf(vx, vz); cache.set(k, v); }
      return v;
    };
    // Per-vertex normals from the roof's own height field, exactly as the terrain skin does.
    // With flat per-triangle normals a shallow pitch reads as a visible staircase of facets —
    // the very thing this whole layer exists to stop the world looking like.
    const nCache = new Map<number, THREE.Vector3>();
    const N = (vx: number, vz: number): THREE.Vector3 => {
      const k = vx * 4096 + vz;
      let n = nCache.get(k);
      if (!n) {
        n = new THREE.Vector3(P(vx - 1, vz).y - P(vx + 1, vz).y, 2, P(vx, vz - 1).y - P(vx, vz + 1).y).normalize();
        nCache.set(k, n);
      }
      return n;
    };

    const roofAcc = new GeoAccum(), wallAcc = new GeoAccum(), timberAcc = new GeoAccum(), trimAcc = new GeoAccum();
    const roofUV = surfaceTex('tile').uvScale;
    // Substance still shows through: a thatched building keeps a warmer, rougher roof than a
    // tiled one even though both are drawn in the style pack's palette.
    const roofC = plan.roofId === B.Thatch ? mixRGB(style.roof, rgbOf(B.Thatch, 0.8), 0.45) : style.roof;
    const roofFam: SurfaceFamily = plan.roofId === B.Thatch ? 'thatch' : 'tile';

    let ridgeY = -Infinity;
    for (const col of mask) ridgeY = Math.max(ridgeY, cellH(Math.floor(col / g.D), col % g.D));
    ridgeY = eaveY + (ridgeY - eaveY) * (1 + style.pitchLift * 0.5);

    for (const col of mask) {
      const x = Math.floor(col / g.D), z = col % g.D;
      const a = P(x, z), b = P(x + 1, z), c = P(x + 1, z + 1), d = P(x, z + 1);
      const cc = shade(roofC, 0.92 + rnd(x, z, 3) * 0.16);
      const uv = (p: THREE.Vector3) => [p.x * roofUV, (p.z + p.y * 0.9) * roofUV];
      const na = N(x, z), nb = N(x + 1, z), nc = N(x + 1, z + 1), nd = N(x, z + 1);
      roofAcc.tri(a, c, b, na, nc, nb, cc, cc, cc, uv(a), uv(c), uv(b));
      roofAcc.tri(a, d, c, na, nd, nc, cc, cc, cc, uv(a), uv(d), uv(c));

      const sides: [number, number, THREE.Vector3, THREE.Vector3][] = [
        [1, 0, b, c], [-1, 0, d, a], [0, 1, c, d], [0, -1, a, b],
      ];
      for (const [dx, dz, p0, p1] of sides) {
        if (masked(x + dx, z + dz)) continue;
        const gableish = Math.max(p0.y, p1.y) - eaveY > 1.2;
        if (gableish) {
          // The triangular end wall, closing the attic in the wall material.
          const bottom = eaveY - 0.28;
          const q0 = new THREE.Vector3(p0.x, bottom, p0.z), q1 = new THREE.Vector3(p1.x, bottom, p1.z);
          const s = surfaceTex('plaster').uvScale;
          wallAcc.quad(p1, p0, q0, q1, mixRGB(style.plaster, style.timber, 0.34), [[p1.x * s, p1.y * s], [p0.x * s, p0.y * s], [q0.x * s, q0.y * s], [q1.x * s, q1.y * s]]);
        } else {
          // The eave edge: a fascia board plus the rafter tails showing under it. This is the
          // single most identifiable piece of the reference roofs.
          const fasciaDrop = 0.22;
          const q0 = new THREE.Vector3(p0.x, p0.y - fasciaDrop, p0.z), q1 = new THREE.Vector3(p1.x, p1.y - fasciaDrop, p1.z);
          const s = surfaceTex('plank').uvScale;
          trimAcc.quad(p1, p0, q0, q1, style.timber, [[p1.x * s, p1.y * s], [p0.x * s, p0.y * s], [q0.x * s, q0.y * s], [q1.x * s, q1.y * s]]);
          if (style.rafterTails) {
            const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
            const inward = new THREE.Vector3(-dx, 0, -dz).multiplyScalar(0.5);
            timberAcc.add(UNIT.box, xf(mid.x + inward.x, mid.y - fasciaDrop * 0.55, mid.z + inward.z,
              dz ? 0.11 : 0.85, 0.1, dz ? 0.85 : 0.11), shade(style.timber, 0.85), s);
          }

        }
      }
    }

    // Ridge: a rolled cap along the top with a round emblem at each end.
    const ridgeCells = [...mask].filter(col => cellH(Math.floor(col / g.D), col % g.D) >= (ridgeY - eaveY) / (1 + style.pitchLift * 0.5) + eaveY - 0.01)
      .map(col => ({ x: Math.floor(col / g.D), z: col % g.D }));
    if (ridgeCells.length > 1) {
      const xs = ridgeCells.map(r => r.x), zs = ridgeCells.map(r => r.z);
      const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
      const alongX = spanX >= spanZ;
      const cxm = (Math.min(...xs) + Math.max(...xs)) / 2 + 0.5, czm = (Math.min(...zs) + Math.max(...zs)) / 2 + 0.5;
      const len = (alongX ? spanX : spanZ) + 1.9 + style.overhang;
      const m = alongX
        ? xf(cxm, ridgeY + 0.14, czm, 0.46, len, 0.46, 0, 0, Math.PI / 2)
        : xf(cxm, ridgeY + 0.14, czm, 0.46, len, 0.46, 0, Math.PI / 2, 0);
      trimAcc.add(UNIT.cyl8, m, style.ridge, surfaceTex('tile').uvScale);
      for (const s of [-1, 1]) {
        const ex = cxm + (alongX ? s * len / 2 : 0), ez = czm + (alongX ? 0 : s * len / 2);
        trimAcc.add(UNIT.cyl12, xf(ex, ridgeY + 0.14, ez, 0.5, 0.1, 0.5, alongX ? 0 : Math.PI / 2, 0, Math.PI / 2), style.ridge, surfaceTex('tile').uvScale);
        trimAcc.add(UNIT.cyl12, xf(ex + (alongX ? s * 0.07 : 0), ridgeY + 0.14, ez + (alongX ? 0 : s * 0.07), 0.3, 0.05, 0.3, alongX ? 0 : Math.PI / 2, 0, Math.PI / 2), style.mon, surfaceTex('metal').uvScale);
      }
      if (style.upperTier) this.upperTier(trimAcc, roofAcc, plan, cxm, czm, ridgeY, alongX, spanX, spanZ, roofC);
    }

    this.wallSkin(plan, wallAcc, timberAcc);
    this.groundWorks(plan, wallAcc, timberAcc, trimAcc);

    const grp = new THREE.Group();
    grp.name = `roof:${plan.place.id}`;
    for (const [acc, fam] of [[roofAcc, roofFam], [wallAcc, 'plaster' as SurfaceFamily], [timberAcc, 'plank' as SurfaceFamily], [trimAcc, 'tile' as SurfaceFamily]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mat(fam as SurfaceFamily));
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    this.group.add(grp);
    this.roofGroups.set(plan.place.id, grp);
    this.dressing(plan);
  }

  /** A second, smaller roof above the first — what makes a temple read as a temple. */
  private upperTier(trim: GeoAccum, roof: GeoAccum, plan: RoofPlan, cx: number, cz: number, ridgeY: number, alongX: boolean, spanX: number, spanZ: number, roofC: RGB): void {
    const halfX = (spanX + 2) * 0.32, halfZ = (spanZ + 2) * 0.32;
    const base = ridgeY + 0.3, top = base + 1.15;
    const uv = surfaceTex('tile').uvScale;
    // four pitches meeting at a short ridge
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const rx = alongX ? halfX * 0.42 : 0, rz = alongX ? 0 : halfZ * 0.42;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const A = new THREE.Vector3(cx + ax * halfX, base, cz + az * halfZ);
      const Bv = new THREE.Vector3(cx + bx * halfX, base, cz + bz * halfZ);
      const R0 = new THREE.Vector3(cx - rx, top, cz - rz), R1 = new THREE.Vector3(cx + rx, top, cz + rz);
      const n = new THREE.Vector3().subVectors(Bv, A).cross(new THREE.Vector3().subVectors(R0, A)).normalize();
      const q = (p: THREE.Vector3) => [p.x * uv, (p.z + p.y) * uv];
      roof.tri(A, Bv, R1, n, n, n, roofC, roofC, roofC, q(A), q(Bv), q(R1));
      roof.tri(A, R1, R0, n, n, n, roofC, roofC, roofC, q(A), q(R1), q(R0));
    }
    trim.add(UNIT.cyl8, alongX ? xf(cx, top + 0.07, cz, 0.3, halfX * 1.1, 0.3, 0, 0, Math.PI / 2) : xf(cx, top + 0.07, cz, 0.3, halfZ * 1.1, 0.3, 0, Math.PI / 2, 0), plan.style.ridge, uv);
    for (const s of [-1, 1]) trim.add(UNIT.box, xf(cx + (alongX ? s * halfX * 0.5 : 0), base + 0.5, cz + (alongX ? 0 : s * halfZ * 0.5), 0.16, 1.0, 0.16), plan.style.timber, surfaceTex('plank').uvScale);
  }

  /**
   * Walls: dark timber frame over pale infill panels. The canonical wall cells decide where
   * there is wall at all — a doorway or a window opening is never framed over — and the
   * canonical substance decides whether the infill is plaster or boarded.
   */
  private wallSkin(plan: RoofPlan, wall: GeoAccum, timber: GeoAccum): void {
    const g = this.grid; const b = plan.place.bounds; const s = plan.style;
    const boarded = plan.wallId === B.Planks || plan.wallId === B.DarkPlanks || plan.wallId === B.Log;
    const infill = boarded ? mixRGB(s.plaster, rgbOf(plan.wallId), 0.62) : s.plaster;
    const y0 = b.y0 + 1, y1 = plan.eaveY - 1;
    if (y1 <= y0) return;
    const T = 0.1, PROUD = 0.05;
    const uvP = surfaceTex('plank').uvScale, uvW = surfaceTex('plaster').uvScale;
    const solidAt = (x: number, y: number, z: number) => { const id = g.get(x, y, z); return id !== B.Air && id !== B.Door && id !== B.Glass && FABRIC.has(id); };

    const planes: { fixed: 'x' | 'z'; at: number; face: number; from: number; to: number }[] = [
      { fixed: 'z', at: b.z0, face: b.z0, from: b.x0, to: b.x1 },
      { fixed: 'z', at: b.z1, face: b.z1 + 1, from: b.x0, to: b.x1 },
      { fixed: 'x', at: b.x0, face: b.x0, from: b.z0, to: b.z1 },
      { fixed: 'x', at: b.x1, face: b.x1 + 1, from: b.z0, to: b.z1 },
    ];
    for (const pl of planes) {
      const outward = (pl.at === b.z0 || pl.at === b.x0) ? -1 : 1;
      const sp = pl.face + outward * PROUD;
      const at = (u: number, y: number, d: number) => pl.fixed === 'z' ? xf(u, y, sp, d, 0, 0) : xf(sp, y, u, 0, 0, d);
      void at;
      const beam = (lo: number, hi: number, y: number, h: number, c: RGB) => {
        const mid = (lo + hi + 1) / 2, len = hi - lo + 1;
        if (pl.fixed === 'z') timber.add(UNIT.box, xf(mid, y, sp, len, h, T), c, uvP);
        else timber.add(UNIT.box, xf(sp, y, mid, T, h, len), c, uvP);
      };
      const panel = (u: number, y: number, h: number) => {
        if (pl.fixed === 'z') wall.add(UNIT.box, xf(u + 0.5, y, sp - outward * 0.02, 0.98, h, 0.04), infill, uvW);
        else wall.add(UNIT.box, xf(sp - outward * 0.02, y, u + 0.5, 0.04, h, 0.98), infill, uvW);
      };
      const cellSolid = (u: number, y: number) => pl.fixed === 'z' ? solidAt(u, y, pl.at) : solidAt(pl.at, y, u);

      // infill panels wherever the canonical wall is actually solid
      for (let u = pl.from; u <= pl.to; u++) {
        let run = -1;
        for (let y = y0; y <= y1 + 1; y++) {
          const ok = y <= y1 && cellSolid(u, y);
          if (ok && run < 0) run = y;
          else if (!ok && run >= 0) { panel(u, (run + y) / 2, y - run); run = -1; }
        }
      }
      // sill, mid rail and head plate, broken wherever the wall itself is broken
      for (const [y, h] of [[y0 + 0.04, 0.2], [(y0 + y1) / 2 + 0.5, 0.15], [y1 + 0.94, 0.24]] as const) {
        let run = -1;
        for (let u = pl.from; u <= pl.to + 1; u++) {
          const ok = u <= pl.to && cellSolid(u, Math.min(y1, Math.max(y0, Math.round(y))));
          if (ok && run < 0) run = u;
          else if (!ok && run >= 0) { beam(run, u - 1, y, h, s.timber); run = -1; }
        }
      }
      // posts on full-height bays
      for (let u = pl.from; u <= pl.to; u++) {
        const corner = u === pl.from || u === pl.to;
        if (!corner && (u - pl.from) % 2 !== 0) continue;
        let full = true;
        for (let y = y0; y <= y1 && full; y++) if (!cellSolid(u, y)) full = false;
        if (!full) continue;
        const mid = u + 0.5, h = y1 - y0 + 1.2, w = corner ? 0.22 : 0.15;
        if (pl.fixed === 'z') timber.add(UNIT.box, xf(mid, (y0 + y1) / 2 + 0.5, sp, w, h, T * 1.4), s.timber, uvP);
        else timber.add(UNIT.box, xf(sp, (y0 + y1) / 2 + 0.5, mid, T * 1.4, h, w), s.timber, uvP);
      }
    }
  }

  /** Stone plinth under the whole footprint, and a raised plank veranda at the entrance face. */
  private groundWorks(plan: RoofPlan, wall: GeoAccum, timber: GeoAccum, trim: GeoAccum): void {
    const b = plan.place.bounds, s = plan.style, floor = b.y0;
    const uvS = surfaceTex('stone').uvScale, uvP = surfaceTex('plank').uvScale;
    const w = b.x1 - b.x0 + 1, d = b.z1 - b.z0 + 1;
    // plinth: a course of dressed stone the timber frame sits on
    wall.add(UNIT.box, xf(b.x0 + w / 2, floor + 0.62, b.z0 + d / 2, w + 0.5, 0.5, d + 0.5), s.plinth, uvS);
    trim.add(UNIT.box, xf(b.x0 + w / 2, floor + 0.9, b.z0 + d / 2, w + 0.62, 0.09, d + 0.62), shade(s.plinth, 0.8), uvS);
    void timber;

    if (!s.engawa) return;
    const door = plan.place.door;
    if (!door) return;
    // Which face the doorway is on decides where the veranda goes — canonical, not authored.
    const dx = door.x < b.x0 ? -1 : door.x > b.x1 ? 1 : 0;
    const dz = door.z < b.z0 ? -1 : door.z > b.z1 ? 1 : 0;
    if (dx === 0 && dz === 0) return;
    const deck = 0.95;
    const cx = dx ? (dx < 0 ? b.x0 - deck / 2 - 0.05 : b.x1 + 1 + deck / 2 + 0.05) : b.x0 + w / 2;
    const cz = dz ? (dz < 0 ? b.z0 - deck / 2 - 0.05 : b.z1 + 1 + deck / 2 + 0.05) : b.z0 + d / 2;
    const lx = dx ? deck : w + 0.4, lz = dz ? deck : d + 0.4;
    timber.add(UNIT.box, xf(cx, floor + 1.02, cz, lx, 0.16, lz), mixRGB(s.timber, [0.45, 0.34, 0.22], 0.55), uvP);
    const n = Math.max(2, Math.round((dx ? lz : lx) / 1.6));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = dx ? cx : b.x0 - 0.2 + (w + 0.4) * t, pz = dz ? cz : b.z0 - 0.2 + (d + 0.4) * t;
      const qx = dx ? px : px, qz = dx ? b.z0 - 0.2 + (d + 0.4) * t : pz;
      timber.add(UNIT.box, xf(dx ? cx : qx, floor + 0.7, dz ? cz : qz, 0.14, 0.5, 0.14), s.timber, uvP);
    }
    // a step down to the ground at the doorway
    trim.add(UNIT.box, xf(door.x + 0.5, floor + 0.72, door.z + 0.5, 1.3, 0.24, 1.3), s.plinth, uvS);
  }

  /**
   * The things that make a building look inhabited: a curtain across the doorway, a banner on a
   * pole, a pair of stone lanterns. All placed off the canonical door cell and footprint.
   */
  private dressing(plan: RoofPlan): void {
    const b = plan.place.bounds, s = plan.style, door = plan.place.door;
    const grp = this.roofGroups.get(plan.place.id)!;
    const cloth = new GeoAccum(), solid = new GeoAccum();
    const uvC = surfaceTex('cloth').uvScale, uvS = surfaceTex('stone').uvScale, uvP = surfaceTex('plank').uvScale;
    if (door && s.curtainOverDoor) {
      const dx = door.x < b.x0 ? -1 : door.x > b.x1 ? 1 : 0;
      const alongX = dx === 0;
      const y = b.y0 + 2.55;
      const cx = door.x + 0.5 + (alongX ? 0 : -dx * 0.22), cz = door.z + 0.5 + (alongX ? (door.z < b.z0 ? -1 : 1) * -0.22 : 0);
      // three hanging panels with a gap between them, as every reference shopfront has
      for (let i = -1; i <= 1; i++) {
        const off = i * 0.44;
        const m = alongX ? xf(cx + off, y - 0.42, cz, 0.4, 0.84, 0.03) : xf(cx, y - 0.42, cz + off, 0.03, 0.84, 0.4);
        cloth.add(UNIT.box, m, s.curtain, uvC);
      }
      solid.add(UNIT.box, alongX ? xf(cx, y + 0.06, cz, 1.5, 0.14, 0.14) : xf(cx, y + 0.06, cz, 0.14, 0.14, 1.5), s.timber, uvP);
      // the round emblem in the middle of the curtain
      cloth.add(UNIT.cyl12, alongX ? xf(cx, y - 0.42, cz + 0.02, 0.34, 0.02, 0.34, 0, Math.PI / 2, 0) : xf(cx + 0.02, y - 0.42, cz, 0.34, 0.02, 0.34, Math.PI / 2, Math.PI / 2, 0), s.mon, uvC);
    }
    if (s.bannerPole && door) {
      const px = door.x + 1.6, pz = door.z + 0.5, py = b.y0;
      solid.add(UNIT.cyl8, xf(px, py + 2.1, pz, 0.13, 4.2, 0.13), s.timber, uvP);
      for (let i = 0; i < 5; i++) cloth.add(UNIT.box, xf(px + 0.28, py + 3.5 - i * 0.44, pz, 0.5, 0.42, 0.03), shade(s.curtain, 0.94 + (i % 2) * 0.12), uvC);
    }
    if (s.stoneLanterns && door) {
      for (const side of [-1, 1]) {
        const lx = door.x + 0.5 + side * 1.9, lz = door.z + 0.5, ly = b.y0 + 1;
        solid.add(UNIT.cyl8, xf(lx, ly + 0.35, lz, 0.34, 0.7, 0.34), s.plinth, uvS);
        solid.add(UNIT.cyl8, xf(lx, ly + 0.78, lz, 0.5, 0.16, 0.5), shade(s.plinth, 1.1), uvS);
        solid.add(UNIT.box, xf(lx, ly + 1.02, lz, 0.42, 0.34, 0.42), mixRGB(s.plinth, s.lantern, 0.45), uvS);
        solid.add(UNIT.cone, xf(lx, ly + 1.32, lz, 0.7, 0.34, 0.7), s.plinth, uvS);
      }
    }
    for (const [acc, mat] of [[cloth, this.clothMat], [solid, this.mat('stone')]] as const) {
      const geo = acc.build(); if (!geo) continue;
      const m = new THREE.Mesh(geo, mat as THREE.Material);
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
  }

  private buildAwning(s: StallPlan): void {
    const acc = new GeoAccum();
    const uv = surfaceTex('cloth').uvScale;
    // Muted toward the settlement palette: a market awning is dyed cloth, not a colour swatch.
    const c = mixRGB(rgbOf(s.id, 1), [0.30, 0.20, 0.17], 0.34);
    const alongX = (s.x1 - s.x0) >= (s.z1 - s.z0);
    const O = 0.35;
    const lo0 = (alongX ? s.z0 : s.x0) - O, lo1 = (alongX ? s.z1 : s.x1) + 1 + O;
    const a0 = (alongX ? s.x0 : s.z0) - O, a1 = (alongX ? s.x1 : s.z1) + 1 + O;
    const mid = (lo0 + lo1) / 2;
    const eave = s.y + 0.05, ridge = s.y + 0.8;
    const P = (along: number, across: number, h: number) =>
      alongX ? new THREE.Vector3(along, h, across) : new THREE.Vector3(across, h, along);
    const STEPS = 4;
    for (const side of [-1, 1] as const) {
      const edge = side < 0 ? lo0 : lo1;
      for (let i = 0; i < STEPS; i++) {
        const t0 = i / STEPS, t1 = (i + 1) / STEPS;
        const across = (t: number) => mid + (edge - mid) * t;
        const height = (t: number) => ridge + (eave - ridge) * t - Math.sin(t * Math.PI) * 0.1;
        const p00 = P(a0, across(t0), height(t0)), p10 = P(a1, across(t0), height(t0));
        const p01 = P(a0, across(t1), height(t1)), p11 = P(a1, across(t1), height(t1));
        const q = (v: THREE.Vector3) => [v.x * uv, v.z * uv];
        acc.quad(p00, p10, p11, p01, shade(c, 0.9 + t0 * 0.22), [q(p00), q(p10), q(p11), q(p01)]);
      }
      const n = Math.max(3, Math.round((a1 - a0) * 1.5));
      for (let i = 0; i < n; i++) {
        const u0 = a0 + (a1 - a0) * (i / n), u1 = a0 + (a1 - a0) * ((i + 1) / n);
        const drop = 0.18 + ((i % 2) ? 0.07 : 0);
        const t0 = P(u0, edge, eave), t1v = P(u1, edge, eave);
        const b0 = P(u0, edge, eave - drop), b1 = P(u1, edge, eave - drop);
        const q = (v: THREE.Vector3) => [v.x * uv, v.y * uv];
        acc.quad(t0, t1v, b1, b0, shade(c, 0.8), [q(t0), q(t1v), q(b1), q(b0)]);
      }
    }
    const wood: RGB = [0.3, 0.22, 0.14];
    const poleLen = a1 - a0, cAlong = (a0 + a1) / 2;
    const rc = P(cAlong, mid, ridge + 0.05);
    acc.add(UNIT.cyl6, alongX
      ? xf(rc.x, rc.y, rc.z, 0.1, poleLen, 0.1, 0, 0, Math.PI / 2)
      : xf(rc.x, rc.y, rc.z, 0.1, poleLen, 0.1, 0, Math.PI / 2, 0), wood, surfaceTex('plank').uvScale);
    const geo = acc.build();
    if (!geo) return;
    const m = new THREE.Mesh(geo, this.clothMat);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  private buildOpenings(): void {
    const g = this.grid;
    const frameAcc = new GeoAccum(), glassAcc = new GeoAccum(), fenceAcc = new GeoAccum(), glowAcc = new GeoAccum();
    const timber: RGB = [0.19, 0.14, 0.1];
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

  private alongX(x: number, y: number, z: number): boolean {
    const g = this.grid;
    const wallLike = (id: number) => id !== B.Air && id !== B.Door && id !== B.Glass && (BLOCKS[id]?.shape === 'cube');
    return Number(wallLike(g.get(x - 1, y, z))) + Number(wallLike(g.get(x + 1, y, z)))
      >= Number(wallLike(g.get(x, y, z - 1))) + Number(wallLike(g.get(x, y, z + 1)));
  }

  /** A shoji-style lattice: a fine grid of muntins over a translucent panel, recessed in the wall. */
  private window(frame: GeoAccum, glass: GeoAccum, x: number, y: number, z: number, timber: RGB, uv: number): void {
    const ax = this.alongX(x, y, z);
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const T = 0.12, D = 0.3, M = 0.035;
    const put = (w: number, h: number, dep: number, ox = 0, oy = 0) =>
      frame.add(UNIT.box, ax ? xf(cx + ox, cy + oy, cz, w, h, dep) : xf(cx, cy + oy, cz + ox, dep, h, w), timber, uv);
    put(1.0, T, D, 0, 0.44); put(1.0, T, D, 0, -0.44);
    put(T, 1.0, D, -0.44, 0); put(T, 1.0, D, 0.44, 0);
    for (let i = 1; i <= 2; i++) put(M, 0.9, D * 0.7, -0.44 + i * 0.293, 0);
    for (let i = 1; i <= 3; i++) put(0.9, M, D * 0.7, 0, -0.44 + i * 0.22);
    const p = (a: number, b: number) => ax ? new THREE.Vector3(x + a, y + b, cz) : new THREE.Vector3(cx, y + b, z + a);
    glass.quad(p(0.06, 0.08), p(0.94, 0.08), p(0.94, 0.92), p(0.06, 0.92), [0.95, 0.88, 0.7]);
  }

  private door(frame: GeoAccum, x: number, y: number, z: number, timber: RGB, uv: number): void {
    const ax = this.alongX(x, y, z);
    const cx = x + 0.5, cz = z + 0.5;
    const jamb = shade(timber, 0.9);
    if (ax) {
      for (const dx of [-0.46, 0.46]) frame.add(UNIT.box, xf(cx + dx, y + 0.5, cz, 0.12, 1.06, 0.42), jamb, uv);
      frame.add(UNIT.box, xf(cx, y + 1.0, cz, 1.12, 0.18, 0.46), jamb, uv);
    } else {
      for (const dz of [-0.46, 0.46]) frame.add(UNIT.box, xf(cx, y + 0.5, cz + dz, 0.42, 1.06, 0.12), jamb, uv);
      frame.add(UNIT.box, xf(cx, y + 1.0, cz, 0.46, 0.18, 1.12), jamb, uv);
    }
    const leafAcc = new GeoAccum();
    const W = 0.86, H = 0.96;
    for (let i = 0; i < 4; i++) {
      const w = W / 4;
      leafAcc.add(UNIT.box, xf(w * (i + 0.5), H / 2, 0, w * 0.94, H, 0.11), shade(timber, 1.15 + (i % 2) * 0.14), uv);
    }
    for (const by of [H * 0.24, H * 0.76]) leafAcc.add(UNIT.box, xf(W / 2, by, 0.06, W, 0.09, 0.05), [0.12, 0.11, 0.11], uv);
    leafAcc.add(UNIT.cyl12, xf(W * 0.82, H * 0.5, 0.09, 0.12, 0.03, 0.12, 0, Math.PI / 2, 0), [0.55, 0.44, 0.2], uv);
    const geo = leafAcc.build();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, this.mat('plank'));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const grp = new THREE.Group();
    grp.add(mesh);
    const closedYaw = ax ? 0 : Math.PI / 2;
    grp.position.set(ax ? x + 0.07 : cx, y, ax ? cz : z + 0.07);
    grp.rotation.y = closedYaw;
    this.group.add(grp);
    this.doors.push({ group: grp, x, y, z, closedYaw, openYaw: closedYaw - Math.PI * 0.52, cur: closedYaw });
  }

  /** A hanging box lantern: an iron frame around lit paper panels under a small pyramid cap. */
  private lantern(frame: GeoAccum, glow: GeoAccum, x: number, y: number, z: number, uv: number): void {
    const cx = x + 0.5, cz = z + 0.5, cy = y + 0.36;
    const iron: RGB = [0.13, 0.12, 0.12];
    glow.add(UNIT.box, xf(cx, cy, cz, 0.34, 0.44, 0.34), [1.0, 0.86, 0.56], uv);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      frame.add(UNIT.box, xf(cx + dx * 0.17, cy, cz + dz * 0.17, 0.05, 0.46, 0.05), iron, uv);
    }
    for (const yy of [cy - 0.23, cy + 0.23]) frame.add(UNIT.box, xf(cx, yy, cz, 0.4, 0.05, 0.4), iron, uv);
    frame.add(UNIT.cone, xf(cx, cy + 0.34, cz, 0.62, 0.2, 0.62, Math.PI / 4), iron, uv);
    frame.add(UNIT.cyl6, xf(cx, cy + 0.48, cz, 0.07, 0.12, 0.07), iron, uv);
  }

  private fence(acc: GeoAccum, x: number, y: number, z: number, uv: number): void {
    const g = this.grid;
    const c = rgbOf(B.Fence, 0.85 + rnd(x, z, 7) * 0.15);
    const cx = x + 0.5, cz = z + 0.5;
    acc.add(UNIT.box, xf(cx, y + 0.54, cz, 0.15, 1.08, 0.15), c, uv);
    acc.add(UNIT.cone, xf(cx, y + 1.12, cz, 0.22, 0.14, 0.22), shade(c, 0.8), uv);
    for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
      if (g.get(x + dx, y, z + dz) !== B.Fence) continue;
      for (const ry of [0.34, 0.8]) {
        acc.add(UNIT.box, xf(cx + dx * 0.5, y + ry, cz + dz * 0.5, dx ? 1.0 : 0.08, 0.1, dz ? 1.0 : 0.08), shade(c, 1.05), uv);
      }
    }
  }

  /* -------------------------------------- runtime ---------------------------------------- */

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
