import * as THREE from 'three';
import type { Body } from '../../sim/core/types';
import type { WorkStyle } from './activityCues';
import type { AttireSpec } from './culture';
import { GeoAccum, UNIT, place as xf, shade, shell, tapered, mixRGB, type RGB } from './geo';
import { surfaceMaterial, surfaceTex } from './textures';

/**
 * A person, built as layers.
 *
 * v0.11 replaced the block figure with a proportioned rig. v0.12 rebuilds what that rig WEARS,
 * because the reference art's identity is almost entirely in the garment layering rather than in
 * the body: a crossed collar over an under-robe, a broad sash at the waist with a knotted cord,
 * an outer robe with wide flared sleeves and a contrasting hem, split trousers or a layered
 * skirt, and metal fittings on top of all of it. Get those layers right and a figure reads as a
 * person from a fantasy world; get only the anatomy right and it reads as a mannequin.
 *
 * The construction pipeline the milestone asks for, top to bottom:
 *
 *   canonical Person  →  culture.ts's AttireSpec  →  body  →  head/hair  →  garment layers
 *                                                  →  equipment  →  materials  →  animation
 *
 * Everything above the animation step is built once, at spawn. The animation step is the only
 * per-frame work, and it reads canonical `Body` state and writes nothing back — the same
 * one-way contract v0.8 established for `Body.pose` and v0.11 kept.
 *
 * Cost: garments and armour are merged into the same per-bone buffers as the limb they hang off,
 * so a fully-armoured guard is about fifteen meshes and an unarmoured farmer about ten.
 */

/* --------------------------------- proportions (metres) ----------------------------------- */
const ANKLE = 0.10, KNEE = 0.49, HIP = 0.93;
const CHEST = 1.30, SHOULDER = 1.46, NECK = 1.56, HEAD_C = 1.72;
const THIGH = HIP - KNEE, SHIN = KNEE - ANKLE;
const UPPER_ARM = 0.31, FOREARM = 0.27;

const clothMaterial = (() => {
  let m: THREE.MeshStandardMaterial | null = null;
  // Double-sided because every garment here is a shell: a sleeve, a skirt, a hanging panel.
  return () => (m ??= surfaceMaterial('cloth', { roughness: 0.88, side: THREE.DoubleSide }));
})();
const gearMaterial = (() => {
  let m: THREE.MeshStandardMaterial | null = null;
  return () => (m ??= surfaceMaterial('metal', { roughness: 0.38, metalness: 0.62 }));
})();

export class HumanoidRig {
  root = new THREE.Group();
  pivot = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  neck = new THREE.Group();
  shoulderL = new THREE.Group(); shoulderR = new THREE.Group();
  elbowL = new THREE.Group(); elbowR = new THREE.Group();
  hipL = new THREE.Group(); hipR = new THREE.Group();
  kneeL = new THREE.Group(); kneeR = new THREE.Group();
  private held: THREE.Object3D | null = null;
  private heldType = '';
  /** One cloth material per person: shared textures, private emissive so a hit flashes them alone. */
  private cloth = clothMaterial().clone();
  private gear = gearMaterial().clone();
  private phase = 0;

  private attach(parent: THREE.Object3D, cloth: GeoAccum, gear?: GeoAccum): void {
    for (const [acc, mat] of [[cloth, this.cloth], [gear, this.gear]] as const) {
      if (!acc) continue;
      const g = acc.build(); if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
    }
  }

  constructor(public a: AttireSpec) {
    const B = a.build, uv = surfaceTex('cloth').uvScale, uvM = surfaceTex('metal').uvScale;
    const { skin, hair, base, accent, under, trim, leather } = a;

    /* ---- skeleton ---------------------------------------------------------------------- */
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP;
    this.hips.add(this.torso);
    this.torso.add(this.neck);
    this.neck.position.y = NECK - HIP;
    this.torso.add(this.shoulderL, this.shoulderR);
    const shW = 0.185 * B;
    this.shoulderL.position.set(-shW, SHOULDER - HIP, 0);
    this.shoulderR.position.set(shW, SHOULDER - HIP, 0);
    this.shoulderL.add(this.elbowL); this.shoulderR.add(this.elbowR);
    this.elbowL.position.y = -UPPER_ARM; this.elbowR.position.y = -UPPER_ARM;
    this.hips.add(this.hipL, this.hipR);
    this.hipL.position.set(-0.105 * B, 0, 0); this.hipR.position.set(0.105 * B, 0, 0);
    this.hipL.add(this.kneeL); this.hipR.add(this.kneeR);
    this.kneeL.position.y = -THIGH; this.kneeR.position.y = -THIGH;

    /* ---- torso: body, then under-robe, then outer robe, then sash ----------------------- */
    const t = new GeoAccum(), tGear = new GeoAccum();
    const y = (v: number) => v - HIP;

    // body underneath — barely seen, but it gives the garments something to sit on
    t.add(tapered(0.85), xf(0, y(0.95), 0, 0.25 * B, 0.2, 0.18 * B), shade(base, 0.6), uv);
    t.add(tapered(1.1), xf(0, y(1.10), 0, 0.235 * B, 0.2, 0.165 * B), shade(base, 0.6), uv);
    t.add(tapered(1.25), xf(0, y(CHEST), 0, 0.265 * B, 0.26, 0.185 * B), shade(base, 0.6), uv);
    t.add(tapered(0.72), xf(0, y(NECK - 0.06), 0, 0.115, 0.14, 0.115), skin, uv);

    // under-robe: the pale layer that shows at the throat and in the collar opening
    t.add(tapered(1.2), xf(0, y(1.24), 0, 0.29 * B, 0.42, 0.21 * B), under, uv);
    // crossed collar — two angled lapels meeting in a V. The single most legible cue that this
    // is a wrapped garment rather than a shirt.
    for (const s of [-1, 1]) {
      t.add(UNIT.box, xf(s * 0.075 * B, y(1.36), 0.1 * B, 0.075 * B, 0.34, 0.035), under, uv, 0, 0);
      const lapel = new THREE.Matrix4().compose(
        new THREE.Vector3(s * 0.082 * B, y(1.36), 0.1 * B),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, s * 0.34)),
        new THREE.Vector3(0.085 * B, 0.36, 0.05));
      t.add(UNIT.box, lapel, mixRGB(under, base, 0.25), uv);
    }

    // outer robe: shoulders and body, then the flared skirt with its hem band
    t.add(shell(1.18), xf(0, y(1.30), 0, 0.31 * B, 0.4, 0.235 * B), base, uv);
    for (const s of [-1, 1]) t.add(UNIT.sphere, xf(s * 0.175 * B, y(SHOULDER - 0.02), 0, 0.17 * B, 0.15, 0.17 * B), base, uv);

    const hemY = HIP - 0.02 - a.robeLength * 0.78;
    if (a.robeLength > 0.05) {
      const flare = 1 + a.robeLength * 0.75;
      const topR = 0.28 * B, botR = 0.28 * B * flare;
      t.add(shell(topR / botR), xf(0, y((1.02 + hemY) / 2), 0, botR * 2, 1.02 - hemY, botR * 1.55), base, uv);
      if (a.hemBand) t.add(shell(0.96), xf(0, y(hemY + 0.055), 0, botR * 2.03, 0.12, botR * 1.58), a.accent, uv);
      // a second layer showing beneath the outer one, as every reference sheet does
      t.add(shell(0.94), xf(0, y(hemY + 0.005), 0, botR * 1.88, 0.1, botR * 1.45), mixRGB(accent, under, 0.35), uv);
      // front opening: a narrow panel of the accent colour running down the centre
      t.add(UNIT.box, xf(0, y((1.02 + hemY) / 2), botR * 0.74, 0.1 * B, 1.0 - hemY, 0.02), accent, uv);
    }

    // obi: broad sash, knot at the back, cord and tassel at the front
    if (a.obiWidth > 0) {
      t.add(UNIT.cyl12, xf(0, y(1.03), 0, 0.30 * B, a.obiWidth, 0.225 * B), accent, uv);
      t.add(UNIT.cyl12, xf(0, y(1.03 + a.obiWidth * 0.4), 0, 0.305 * B, 0.022, 0.23 * B), trim, uvM);
      t.add(UNIT.box, xf(0, y(1.03), -0.14 * B, 0.22 * B, a.obiWidth * 1.5, 0.11), shade(accent, 1.12), uv);
      if (a.sashTassel) {
        t.add(UNIT.cyl6, xf(0.1 * B, y(0.94), 0.14 * B, 0.035, 0.2, 0.035), trim, uvM);
        t.add(tapered(1.6, 6), xf(0.1 * B, y(0.82), 0.14 * B, 0.07, 0.16, 0.07), shade(accent, 1.25), uv);
      }
      if (a.monDisc) t.add(UNIT.cyl12, xf(0, y(1.03), 0.235 * B, 0.11, 0.03, 0.11, 0, Math.PI / 2, 0), trim, uvM);
    }

    if (a.apron) {
      t.add(UNIT.box, xf(0, y(1.12), 0.115 * B, 0.32 * B, 0.46, 0.03), leather, uv);
      t.add(UNIT.box, xf(0, y(1.42), 0.11 * B, 0.15 * B, 0.2, 0.025), leather, uv);
    }
    if (a.chestPlate) {
      tGear.add(UNIT.box, xf(0, y(1.33), 0.14 * B, 0.34 * B, 0.3, 0.07), shade(base, 0.55), uvM);
      for (let i = 0; i < 3; i++) tGear.add(UNIT.box, xf(0, y(1.20 - i * 0.085), 0.15 * B, 0.32 * B, 0.07, 0.05), shade(base, 0.45 + i * 0.05), uvM);
      tGear.add(UNIT.cyl12, xf(0, y(1.36), 0.185 * B, 0.09, 0.025, 0.09, 0, Math.PI / 2, 0), trim, uvM);
    }
    if (a.scabbard) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(-0.19 * B, y(1.0), -0.02),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0.32)),
        new THREE.Vector3(0.055, 0.82, 0.055));
      tGear.add(UNIT.cyl8, m, shade(leather, 0.55), uvM);
    }
    if (a.hood) {
      t.add(shell(1.55), xf(0, y(1.2), -0.03, 0.38 * B, 0.5, 0.32 * B), shade(base, 0.85), uv);
    }
    this.attach(this.torso, t, tGear);

    /* ---- head ---------------------------------------------------------------------------- */
    const hd = new GeoAccum(), hdGear = new GeoAccum();
    const hy = (v: number) => v - NECK;
    hd.add(UNIT.sphere, xf(0, hy(HEAD_C), 0.005, 0.205, 0.25, 0.215), skin, uv);
    hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.075), 0.03, 0.163, 0.15, 0.19), skin, uv);
    hd.add(UNIT.cone, xf(0, hy(HEAD_C - 0.005), 0.10, 0.05, 0.075, 0.06, 0, Math.PI / 2, 0), skin, uv);
    for (const s of [-1, 1]) hd.add(UNIT.sphereLo, xf(s * 0.104, hy(HEAD_C + 0.005), -0.005, 0.045, 0.075, 0.05), skin, uv);
    for (const s of [-1, 1]) {
      hd.add(UNIT.sphereLo, xf(s * 0.052, hy(HEAD_C + 0.012), 0.093, 0.036, 0.032, 0.02), [0.92, 0.9, 0.86], uv);
      hd.add(UNIT.sphereLo, xf(s * 0.052, hy(HEAD_C + 0.012), 0.104, 0.019, 0.019, 0.014), [0.09, 0.07, 0.06], uv);
      hd.add(UNIT.box, xf(s * 0.056, hy(HEAD_C + 0.054), 0.088, 0.06, 0.013, 0.02), shade(hair, 0.75), uv);
    }
    this.hairFor(hd, hy, hair);
    if (a.beard) {
      hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.105), 0.045, 0.163, 0.16, 0.175), a.beard, uv);
      hd.add(UNIT.box, xf(0, hy(HEAD_C - 0.028), 0.098, 0.085, 0.024, 0.03), a.beard, uv);
    }
    if (a.strawHat) {
      hd.add(UNIT.cone, xf(0, hy(HEAD_C + 0.13), 0, 0.86, 0.24, 0.86), [0.72, 0.62, 0.36], uv);
      hd.add(UNIT.cyl12, xf(0, hy(HEAD_C + 0.06), 0, 0.5, 0.02, 0.5), [0.6, 0.5, 0.28], uv);
    } else if (a.hood) {
      hd.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.045), -0.03, 0.28, 0.31, 0.31), shade(base, 0.8), uv);
    } else if (a.role === 'warrior') {
      hdGear.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.035), 0, 0.25, 0.27, 0.255), shade(base, 0.5), uvM);
      hdGear.add(UNIT.cyl12, xf(0, hy(HEAD_C + 0.095), 0, 0.27, 0.03, 0.27), trim, uvM);
      hdGear.add(UNIT.box, xf(0, hy(HEAD_C + 0.115), 0.09, 0.06, 0.11, 0.07), trim, uvM);
    }
    this.attach(this.neck, hd, hdGear);

    /* ---- arms: limb, then the wide sleeve hanging off the shoulder ---------------------- */
    for (const [sh, el, side] of [[this.shoulderL, this.elbowL, -1], [this.shoulderR, this.elbowR, 1]] as const) {
      const u = new GeoAccum(), uGear = new GeoAccum();
      u.add(tapered(0.85), xf(0, -UPPER_ARM / 2, 0, 0.105 * B, UPPER_ARM, 0.105 * B), mixRGB(base, under, 0.35), uv);
      if (a.sleeveFlare > 0.05) {
        // The signature silhouette: a sleeve that widens as it falls, well past the elbow.
        const len = UPPER_ARM * (0.75 + a.sleeveFlare * 0.85);
        const top = 0.15 * B, bot = 0.15 * B * (1 + a.sleeveFlare * 1.15);
        u.add(shell(top / bot), xf(0, -len / 2 + 0.03, 0, bot * 2, len, bot * 1.7), base, uv);
        if (a.hemBand) u.add(shell(0.95), xf(0, -len + 0.075, 0, bot * 2.04, 0.075, bot * 1.74), accent, uv);
      }
      if (a.shoulderPlates) {
        for (let i = 0; i < 3; i++) {
          uGear.add(UNIT.box, xf(side * 0.02, -0.03 - i * 0.075, 0, 0.23 * B, 0.07, 0.19 * B), shade(base, 0.5 + i * 0.06), uvM);
        }
        uGear.add(UNIT.cyl12, xf(side * 0.04, 0.03, 0.06, 0.09, 0.025, 0.09, 0, Math.PI / 2, 0), trim, uvM);
      }
      this.attach(sh, u, uGear);

      const f = new GeoAccum(), fGear = new GeoAccum();
      f.add(tapered(0.78), xf(0, -FOREARM / 2, 0, 0.09 * B, FOREARM, 0.09 * B), mixRGB(base, under, 0.5), uv);
      f.add(UNIT.sphere, xf(0, -FOREARM - 0.05, 0.005, 0.095, 0.13, 0.07), skin, uv);
      if (a.bracers) fGear.add(tapered(0.85), xf(0, -FOREARM * 0.62, 0, 0.11 * B, 0.19, 0.11 * B), leather, uvM);
      this.attach(el, f, fGear);
    }

    /* ---- legs: limb, then hakama or leggings, then footwear ----------------------------- */
    for (const [hp, kn] of [[this.hipL, this.kneeL], [this.hipR, this.kneeR]] as const) {
      const th = new GeoAccum();
      th.add(tapered(0.8), xf(0, -THIGH / 2, 0, 0.15 * B, THIGH, 0.15 * B), shade(base, 0.75), uv);
      if (a.hakama) {
        // wide split trousers: a shell that flares to the knee, per the ronin/traveller refs
        th.add(shell(0.62), xf(0, -THIGH / 2 - 0.02, 0, 0.30 * B, THIGH + 0.14, 0.28 * B), mixRGB(base, accent, 0.18), uv);
      }
      this.attach(hp, th);

      const sn = new GeoAccum();
      sn.add(tapered(0.72), xf(0, -SHIN / 2, 0, 0.12 * B, SHIN, 0.12 * B), shade(base, 0.6), uv);
      if (a.hakama) sn.add(shell(1.25), xf(0, -SHIN * 0.34, 0, 0.24 * B, SHIN * 0.66, 0.23 * B), mixRGB(base, accent, 0.18), uv);
      // wrapped legging above a flat sandal — the footwear the references use almost throughout
      sn.add(UNIT.cyl8, xf(0, -SHIN + 0.05, 0, 0.135 * B, 0.16, 0.135 * B), mixRGB(under, leather, 0.4), uv);
      sn.add(UNIT.box, xf(0, -SHIN - 0.055, 0.055, 0.13, 0.05, 0.29), shade(leather, 0.7), uv);
      sn.add(UNIT.box, xf(0, -SHIN - 0.02, 0.02, 0.035, 0.045, 0.11), shade(leather, 1.2), uv);
      this.attach(kn, sn);
    }

    this.pivot.scale.setScalar(a.height);
  }

  /** Hair as a mass with a style, not a cap: topknot, bun, long fall, cropped. */
  private hairFor(hd: GeoAccum, hy: (v: number) => number, hair: RGB): void {
    const uv = surfaceTex('cloth').uvScale;
    hd.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.022), -0.012, 0.222, 0.252, 0.228), hair, uv);
    switch (this.a.hairStyle) {
      case 'topknot':
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.02), -0.09, 0.19, 0.22, 0.13), hair, uv);
        hd.add(UNIT.cyl8, xf(0, hy(HEAD_C + 0.135), -0.02, 0.075, 0.09, 0.075), shade(hair, 0.85), uv);
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.195), -0.03, 0.13, 0.13, 0.13), hair, uv);
        break;
      case 'bun':
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.03), -0.095, 0.2, 0.24, 0.14), hair, uv);
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.08), -0.15, 0.17, 0.16, 0.16), hair, uv);
        hd.add(UNIT.cyl6, xf(0.06, hy(HEAD_C + 0.115), -0.15, 0.02, 0.24, 0.02, 0, 0, 1.2), [0.85, 0.72, 0.4], uv);
        break;
      case 'long':
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.05), -0.1, 0.21, 0.26, 0.15), hair, uv);
        hd.add(tapered(1.25), xf(0, hy(HEAD_C - 0.34), -0.11, 0.30, 0.5, 0.17), hair, uv);
        for (const s of [-1, 1]) hd.add(tapered(1.1), xf(s * 0.12, hy(HEAD_C - 0.2), 0.05, 0.09, 0.34, 0.09), hair, uv);
        break;
      case 'loose':
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.05), -0.1, 0.23, 0.27, 0.17), hair, uv);
        hd.add(tapered(1.15), xf(0, hy(HEAD_C - 0.22), -0.1, 0.26, 0.3, 0.16), hair, uv);
        break;
      default:  // crop
        hd.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.005), -0.055, 0.2, 0.22, 0.19), hair, uv);
        break;
    }
  }

  /** What is visibly in the right hand. Same canonical trigger as before: a carried item type. */
  setHeld(type: string): void {
    if (type === this.heldType) return;
    this.heldType = type;
    if (this.held) { this.elbowR.remove(this.held); this.held = null; }
    if (!type) return;
    const acc = new GeoAccum();
    const uv = surfaceTex('metal').uvScale;
    const steel: RGB = [0.74, 0.77, 0.82], dark: RGB = [0.16, 0.16, 0.18], wood: RGB = [0.35, 0.24, 0.14];
    switch (type) {
      case 'sword': case 'dagger': {
        // A slightly curved single-edged blade with a disc guard, per the references.
        const len = type === 'sword' ? 0.92 : 0.42;
        const seg = 5;
        for (let i = 0; i < seg; i++) {
          const t0 = i / seg;
          const bend = t0 * t0 * (type === 'sword' ? 0.1 : 0.03);
          acc.add(UNIT.box, xf(0, 0.16 + len * (t0 + 0.5 / seg), bend, 0.045, len / seg, 0.014), steel, uv);
        }
        acc.add(UNIT.cyl12, xf(0, 0.15, 0, 0.13, 0.022, 0.13), this.a.trim, uv);
        acc.add(UNIT.cyl8, xf(0, 0.07, 0, 0.048, 0.17, 0.048), dark, uv);
        break;
      }
      case 'axe':
        acc.add(UNIT.cyl8, xf(0, 0.28, 0, 0.045, 0.62, 0.045), wood, uv);
        acc.add(UNIT.box, xf(0.06, 0.56, 0, 0.16, 0.2, 0.05), steel, uv);
        break;
      case 'hammer':
        acc.add(UNIT.cyl8, xf(0, 0.24, 0, 0.045, 0.5, 0.045), wood, uv);
        acc.add(UNIT.box, xf(0, 0.5, 0, 0.22, 0.11, 0.11), dark, uv);
        break;
      case 'lantern':
        acc.add(UNIT.cyl6, xf(0, 0.12, 0, 0.13, 0.2, 0.13), [1.0, 0.82, 0.42], uv);
        acc.add(UNIT.cyl6, xf(0, 0.24, 0, 0.15, 0.04, 0.15), dark, uv);
        break;
      default:
        acc.add(UNIT.box, xf(0, 0.1, 0, 0.16, 0.16, 0.16), wood, uv);
    }
    const geo = acc.build(); if (!geo) return;
    const mesh = new THREE.Mesh(geo, this.gear);
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(0, -FOREARM - 0.04, 0.03);
    g.rotation.x = -Math.PI / 2 + 0.35;
    this.held = g;
    this.elbowR.add(g);
  }

  /**
   * Drive the rig from canonical body state. Read-only with respect to the simulation: every
   * branch corresponds to a canonical `Pose` (`sim/core/types.ts`) or, for the generic `work`
   * pose, to the `WorkStyle` `presentation/activityCues.ts` resolves from the actor's own active
   * canonical Action.
   */
  animate(dt: number, body: Body, physTime: number, workStyle: WorkStyle | null = null): void {
    const speed = Math.hypot(body.vel.x, body.vel.z);
    const pose = body.pose;
    const moving = speed > 0.3 && (pose === 'walk' || pose === 'run' || pose === 'stand' || pose === 'haul');
    this.phase += dt * (moving ? speed * 3.0 + 1.2 : 0);
    const p = this.phase, t = physTime;
    const L = (o: THREE.Object3D, rx: number, rz = 0, k = 0.25, ry = 0) => {
      o.rotation.x += (rx - o.rotation.x) * k;
      o.rotation.z += (rz - o.rotation.z) * k;
      o.rotation.y += (ry - o.rotation.y) * k;
    };
    this.pivot.position.set(0, 0, 0); this.pivot.rotation.set(0, 0, 0);
    this.hips.position.y = HIP;

    const flash = body.lastHitAt > physTime - 0.35;
    const em = flash ? 0x4a1414 : 0x000000;
    this.cloth.emissive.setHex(em); this.gear.emissive.setHex(em);

    if (pose === 'dead' || pose === 'downed') {
      this.pivot.rotation.x = -Math.PI / 2 * 0.94; this.pivot.position.y = 0.28;
      L(this.torso, 0.1, 0, 0.2); L(this.neck, 0.25);
      L(this.shoulderL, 0.4, -0.7, 0.2); L(this.shoulderR, 0.35, 0.7, 0.2);
      L(this.elbowL, -0.5, 0, 0.2); L(this.elbowR, -0.6, 0, 0.2);
      L(this.hipL, 0.2, 0.12, 0.2); L(this.hipR, -0.15, -0.1, 0.2);
      L(this.kneeL, -0.5, 0, 0.2); L(this.kneeR, -0.3, 0, 0.2);
      return;
    }
    if (pose === 'sleep') {
      this.pivot.rotation.x = -Math.PI / 2; this.pivot.position.y = 0.42;
      const breathe = Math.sin(t * 0.9) * 0.03;
      L(this.torso, 0.05 + breathe, 0, 0.15); L(this.neck, 0.12, 0.1, 0.15);
      L(this.shoulderL, -0.15, -0.35, 0.15); L(this.shoulderR, -0.15, 0.35, 0.15);
      L(this.elbowL, -0.7, 0, 0.15); L(this.elbowR, -0.7, 0, 0.15);
      L(this.hipL, 0.12, 0.05, 0.15); L(this.hipR, 0.08, -0.05, 0.15);
      L(this.kneeL, -0.35, 0, 0.15); L(this.kneeR, -0.28, 0, 0.15);
      return;
    }
    if (pose === 'sit' || pose === 'eat') {
      this.hips.position.y = HIP - 0.4;
      L(this.hipL, -Math.PI / 2 + 0.12, 0.06); L(this.hipR, -Math.PI / 2 + 0.12, -0.06);
      L(this.kneeL, -1.35); L(this.kneeR, -1.35);
      L(this.torso, 0.06); L(this.neck, 0);
      if (pose === 'eat') {
        const bite = Math.sin(t * 2.2) * 0.5 + 0.5;
        L(this.shoulderR, -0.55 - bite * 0.35, -0.2); L(this.elbowR, -1.65 - bite * 0.5);
        L(this.shoulderL, -0.25, 0.12); L(this.elbowL, -0.6);
        L(this.neck, 0.18 - bite * 0.1);
      } else { L(this.shoulderL, -0.2, 0.1); L(this.shoulderR, -0.2, -0.1); L(this.elbowL, -0.45); L(this.elbowR, -0.45); }
      return;
    }
    if (pose === 'pray') {
      this.hips.position.y = HIP - 0.52;
      L(this.hipL, -Math.PI / 2 + 0.25, 0.1); L(this.hipR, -Math.PI / 2 + 0.25, -0.1);
      L(this.kneeL, -1.7); L(this.kneeR, -1.7);
      L(this.torso, 0.16); L(this.neck, 0.32);
      L(this.shoulderL, -1.15, 0.42); L(this.shoulderR, -1.15, -0.42);
      L(this.elbowL, -0.9, -0.25); L(this.elbowR, -0.9, 0.25);
      return;
    }
    if (pose === 'attack') {
      const k = Math.min(1, (physTime - body.lastAttackAt) / 0.4);
      const swing = Math.sin(k * Math.PI);
      L(this.shoulderR, -2.5 + swing * 2.9, -0.25, 0.55); L(this.elbowR, -0.9 + swing * 0.8, 0, 0.55);
      L(this.shoulderL, -0.45, 0.3); L(this.elbowL, -0.7);
      L(this.torso, 0.05, 0, 0.4, -0.35 + swing * 0.7);
      L(this.hipL, 0.28); L(this.hipR, -0.22); L(this.kneeL, -0.18); L(this.kneeR, -0.12);
      return;
    }
    if (pose === 'hit') {
      L(this.torso, -0.3, 0, 0.5); L(this.neck, -0.15, 0, 0.5);
      L(this.shoulderL, -1.05, -0.4, 0.5); L(this.shoulderR, -1.05, 0.4, 0.5);
      L(this.elbowL, -1.1, 0, 0.5); L(this.elbowR, -1.1, 0, 0.5);
      L(this.hipL, 0.1); L(this.hipR, 0.1); L(this.kneeL, -0.25); L(this.kneeR, -0.25);
      return;
    }
    if (pose === 'work') {
      if (workStyle === 'chop') { this.swing(L, t, 1.25, 2.5, 0.55, 0.18); return; }
      if (workStyle === 'quarry') { this.swing(L, t, 1.6, 1.7, 0.4, 0.3); return; }
      const w = Math.sin(t * 6.5);
      L(this.torso, 0.22, 0, 0.3); L(this.neck, 0.14);
      L(this.shoulderR, -0.95 + w * 0.55, -0.18, 0.4); L(this.elbowR, -0.75 - w * 0.4, 0, 0.4);
      L(this.shoulderL, -0.7 + Math.sin(t * 3.2) * 0.2, 0.2); L(this.elbowL, -0.8);
      L(this.hipL, 0.05, 0.05); L(this.hipR, -0.05, -0.05); L(this.kneeL, -0.1); L(this.kneeR, -0.08);
      return;
    }
    if (pose === 'chop') { this.swing(L, t, 1.35, 2.6, 0.55, 0.18); return; }
    if (pose === 'talk') {
      L(this.shoulderR, -0.35 + Math.sin(t * 4.5) * 0.28, -0.22); L(this.elbowR, -0.85 - Math.sin(t * 5.1) * 0.3);
      L(this.shoulderL, -0.2 + Math.sin(t * 3.6 + 1) * 0.18, 0.18); L(this.elbowL, -0.6);
      L(this.neck, Math.sin(t * 1.7) * 0.05, 0, 0.2, Math.sin(t * 1.3) * 0.12);
      L(this.torso, 0.02, 0, 0.2, Math.sin(t * 0.9) * 0.06);
      L(this.hipL, 0.02, 0.03); L(this.hipR, -0.02, -0.03); L(this.kneeL, -0.05); L(this.kneeR, -0.05);
      return;
    }
    if (pose === 'drink') {
      const sip = Math.sin(t * 1.6) * 0.5 + 0.5;
      L(this.shoulderR, -1.35 - sip * 0.4, -0.25); L(this.elbowR, -1.5 - sip * 0.35);
      L(this.shoulderL, -0.15, 0.12); L(this.elbowL, -0.4);
      L(this.neck, -sip * 0.28);
      L(this.hipL, 0); L(this.hipR, 0); L(this.kneeL, -0.04); L(this.kneeR, -0.04);
      return;
    }

    const hauling = pose === 'haul';
    if (moving) {
      const amp = Math.min(1.05, speed * 0.42);
      const sw = Math.sin(p), sw2 = Math.sin(p + Math.PI);
      L(this.hipL, sw * amp, 0.04, 0.45); L(this.hipR, sw2 * amp, -0.04, 0.45);
      L(this.kneeL, -Math.max(0, -Math.sin(p - 0.7)) * amp * 1.5 - 0.05, 0, 0.45);
      L(this.kneeR, -Math.max(0, -Math.sin(p + Math.PI - 0.7)) * amp * 1.5 - 0.05, 0, 0.45);
      if (hauling) {
        L(this.shoulderL, -1.5, 0.3, 0.35); L(this.shoulderR, -1.5, -0.3, 0.35);
        L(this.elbowL, -0.9); L(this.elbowR, -0.9);
        L(this.torso, 0.14, 0, 0.3);
      } else {
        L(this.shoulderL, -sw * amp * 0.75, 0.09, 0.45); L(this.shoulderR, -sw2 * amp * 0.75, -0.09, 0.45);
        L(this.elbowL, -0.3 - Math.max(0, sw) * 0.5, 0, 0.4); L(this.elbowR, -0.3 - Math.max(0, sw2) * 0.5, 0, 0.4);
        L(this.torso, 0.04 + amp * 0.06, 0, 0.3, -sw * amp * 0.12);
      }
      this.hips.position.y = HIP + Math.abs(Math.sin(p)) * 0.045 * amp - 0.02 * amp;
      L(this.neck, -0.02, 0, 0.3, 0);
    } else {
      const b = Math.sin(t * 1.15), b2 = Math.sin(t * 0.73 + 1.2);
      L(this.hipL, 0.02 + b * 0.02, 0.03); L(this.hipR, -0.02 - b * 0.02, -0.03);
      L(this.kneeL, -0.06); L(this.kneeR, -0.05);
      if (hauling) { L(this.shoulderL, -1.5, 0.3); L(this.shoulderR, -1.5, -0.3); L(this.elbowL, -0.9); L(this.elbowR, -0.9); L(this.torso, 0.12); }
      else {
        L(this.shoulderL, b * 0.05, 0.12); L(this.shoulderR, b2 * 0.05, -0.12);
        L(this.elbowL, -0.24 + b * 0.05); L(this.elbowR, -0.24 + b2 * 0.05);
        L(this.torso, 0.01 + b * 0.012, 0, 0.2, b2 * 0.04);
      }
      this.hips.position.y = HIP + b * 0.008;
      L(this.neck, b2 * 0.03, 0, 0.2, b * 0.07);
    }
  }

  /** The shared overhead-swing motion behind chopping and quarrying. */
  private swing(L: (o: THREE.Object3D, rx: number, rz?: number, k?: number, ry?: number) => void, t: number, rate: number, reach: number, lift: number, lean: number): void {
    const cyc = (t * rate) % 1;
    const raise = cyc < 0.55 ? cyc / 0.55 : 1 - (cyc - 0.55) / 0.45;
    L(this.shoulderR, -reach * raise - 0.15, -0.12, 0.5); L(this.elbowR, -0.55 - raise * 0.5, 0, 0.5);
    L(this.shoulderL, -reach * raise * 0.82 - 0.2, 0.12, 0.5); L(this.elbowL, -0.6 - raise * 0.4, 0, 0.5);
    L(this.torso, lean + (1 - raise) * lift * 0.5, 0, 0.4);
    L(this.neck, 0.1);
    L(this.hipL, 0.16, 0.05); L(this.hipR, -0.13, -0.05);
    L(this.kneeL, -0.2); L(this.kneeR, -0.16);
  }
}
