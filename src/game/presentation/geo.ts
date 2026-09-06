import * as THREE from 'three';

/**
 * Geometry plumbing shared by every skin in this folder.
 *
 * The skins below build a LOT of small procedural pieces (a plank, a rafter, a leaf blob, a
 * forearm) and then have to draw them cheaply. `GeoAccum` is the answer used throughout: bake
 * each piece's colour into vertex colours and merge everything that shares a material into one
 * buffer, so a chunk of forest or a whole limb of a person is one draw call instead of twenty.
 *
 * Nothing here knows anything about the simulation. It is deliberately a dumb geometry library.
 */

/** RGB in 0..1, the form the accumulator stores. */
export type RGB = [number, number, number];

export function rgb(hex: number): RGB {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
/** Multiply a colour by a scalar and clamp — the cheap way to shade a variant of a base colour. */
export function shade(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}
export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const _m3 = new THREE.Matrix3();
const _v3 = new THREE.Vector3();

/**
 * Accumulates transformed copies of source geometries into one indexed buffer with
 * position/normal/uv/colour. Call `add` as many times as you like, then `build` once.
 */
export class GeoAccum {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  /** Per-vertex wind response, 0 for anything rigid. Foliage materials read it (see `foliageSkin`). */
  private sway: number[] = [];
  private idx: number[] = [];

  get empty(): boolean { return this.pos.length === 0; }
  get vertexCount(): number { return this.pos.length / 3; }

  /**
   * Append `geo` transformed by `m`, tinted `color`.
   *
   * `uvScale` multiplies whatever UVs the source carries; procedural primitives here are
   * generated with unit-ish UVs so a caller can tile a detail texture per world unit.
   */
  /**
   * `sway`/`swayBase` describe wind response: the stored per-vertex value is
   * `sway * max(0, worldY - swayBase)`, so a blade of grass or a canopy leans from its own root
   * instead of sliding sideways as a rigid body. Materials that ignore `aSway` are unaffected.
   */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: RGB, uvScale = 1, sway = 0, swayBase = 0): void {
    const p = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!p) return;
    const n = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const t = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    const base = this.pos.length / 3;
    _m3.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v3.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      this.pos.push(_v3.x, _v3.y, _v3.z);
      if (n) { _v3.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_m3).normalize(); this.nor.push(_v3.x, _v3.y, _v3.z); }
      else this.nor.push(0, 1, 0);
      if (t) this.uv.push(t.getX(i) * uvScale, t.getY(i) * uvScale);
      else this.uv.push(0, 0);
      this.col.push(color[0], color[1], color[2]);
      this.sway.push(sway === 0 ? 0 : sway * Math.max(0, this.pos[this.pos.length - 2] - swayBase));
    }
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  /** Append a raw triangle-less quad (4 corners, CCW) — used by the surface/skirt builders. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: RGB, uvs?: number[][], normal?: THREE.Vector3): void {
    const base = this.pos.length / 3;
    const nrm = normal ?? new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const corners = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      this.pos.push(corners[i].x, corners[i].y, corners[i].z);
      this.nor.push(nrm.x, nrm.y, nrm.z);
      this.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
      this.col.push(color[0], color[1], color[2]);
      this.sway.push(0);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A triangle with explicit per-corner normals (the smoothed surfaces need these). */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, ca: RGB, cb: RGB, cc: RGB, uva: number[], uvb: number[], uvc: number[]): void {
    const base = this.pos.length / 3;
    const P = [a, b, c], N = [na, nb, nc], C = [ca, cb, cc], U = [uva, uvb, uvc];
    for (let i = 0; i < 3; i++) {
      this.pos.push(P[i].x, P[i].y, P[i].z);
      this.nor.push(N[i].x, N[i].y, N[i].z);
      this.uv.push(U[i][0], U[i][1]);
      this.col.push(C[i][0], C[i][1], C[i][2]);
      this.sway.push(0);
    }
    this.idx.push(base, base + 1, base + 2);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Reusable unit primitives. Built once; every instance is a transformed copy. */
export const UNIT = {
  /** 1x1x1 box centred on the origin. */
  box: new THREE.BoxGeometry(1, 1, 1),
  /** Radius 0.5, height 1, centred, 8-sided — the workhorse for limbs, trunks, posts. */
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1),
  /** Radius 0.5 sphere, cheap. */
  sphere: new THREE.SphereGeometry(0.5, 10, 7),
  sphereLo: new THREE.SphereGeometry(0.5, 7, 5),
  /** Faceted blob for canopies and bushes. */
  blob: new THREE.IcosahedronGeometry(0.5, 1),
  blobLo: new THREE.IcosahedronGeometry(0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 8, 1),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 3, 8),
};

/** A tapered cylinder — cached by rounded taper ratio so trunks/limbs share buffers. */
const taperCache = new Map<string, THREE.BufferGeometry>();
export function tapered(topRatio: number, radial = 8): THREE.BufferGeometry {
  const k = `${Math.round(topRatio * 20)}:${radial}`;
  let g = taperCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(0.5 * topRatio, 0.5, 1, radial, 1); taperCache.set(k, g); }
  return g;
}

const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Transform for a unit-Y primitive scaled to (sx, sy, sz) at (x, y, z), optional Y rotation. */
export function place(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  _q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Transform placing a unit-Y primitive as a segment from `a` to `b` with the given radius. */
export function segment(a: THREE.Vector3, b: THREE.Vector3, radius: number, radiusScaleZ = 1): THREE.Matrix4 {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  _q.setFromUnitVectors(_up, dir.clone().normalize());
  return new THREE.Matrix4().compose(mid, _q, _s.set(radius * 2, len, radius * 2 * radiusScaleZ));
}
