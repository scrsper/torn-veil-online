import * as THREE from 'three';
import type { Appearance, Body } from '../../sim/core/types';
import type { WorkStyle } from './activityCues';
import { GeoAccum, UNIT, place as xf, rgb, shade, tapered, type RGB } from './geo';
import { surfaceMaterial, surfaceTex } from './textures';

/**
 * A person, drawn as a person.
 *
 * This replaces the block figure the client has drawn since v0.1. It is still entirely
 * procedural — nothing is imported, nothing is authored by hand, and every character in the
 * village is generated from the same canonical `Appearance` (skin, hair, shirt, pants, apron,
 * beard, hat, build, height) the simulation already carries. What changed is the SKELETON and
 * the PROPORTIONS: roughly seven and a half heads tall, with a segmented spine, shoulders,
 * elbows, hips, knees and feet, built out of tapered solids instead of stacked cubes.
 *
 * The contract with the simulation is unchanged and deliberately one-way. `animate` reads
 * `Body.pose`, `Body.vel`, `Body.yaw`, `Body.lastHitAt`, `Body.lastAttackAt` — canonical fields
 * the simulation writes for its own reasons — and writes nothing back. There is no second
 * animation state machine: every branch below is keyed off a canonical `Pose` value or the
 * `WorkStyle` resolved from the actor's own active canonical Action.
 *
 * Cost control: each character is TEN merged meshes (one per bone), all sharing one material,
 * with every part's colour baked into vertex colours. That is fewer draw calls than the old
 * cube figure used, so the whole cast got more detailed and cheaper at the same time.
 */

/* --------------------------------- proportions (metres) ----------------------------------- */
const SOLE = 0.0, ANKLE = 0.10, KNEE = 0.49, HIP = 0.93;
const CHEST = 1.30, SHOULDER = 1.46, NECK = 1.56, HEAD_C = 1.72;
const THIGH = HIP - KNEE, SHIN = KNEE - ANKLE;
const UPPER_ARM = 0.31, FOREARM = 0.27;

const bodyMaterial = (() => { let m: THREE.MeshStandardMaterial | null = null; return () => (m ??= surfaceMaterial('cloth', { roughness: 0.86 })); })();
const gearMaterial = (() => { let m: THREE.MeshStandardMaterial | null = null; return () => (m ??= surfaceMaterial('metal')); })();


export class HumanoidRig {
  root = new THREE.Group();
  /** Whole-body transform: scaled by canonical height, and where prone/kneeling poses live. */
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
  /** One material per person: shared textures, but its own emissive so a hit flashes only them. */
  private skinMat = bodyMaterial().clone();
  private phase = 0;

  /** Add a bone's merged geometry, built in bone-local space, to its group. */
  private attach(parent: THREE.Object3D, acc: GeoAccum): void {
    const g = acc.build(); if (!g) return;
    const m = new THREE.Mesh(g, this.skinMat);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
  }

  constructor(public app: Appearance) {
    const B = app.build ?? 1, uvC = surfaceTex('cloth').uvScale;
    const skin = rgb(app.skin), hair = rgb(app.hair), shirt = rgb(app.shirt), pants = rgb(app.pants);
    const boot: RGB = shade(pants, 0.5);

    // --- hierarchy ---------------------------------------------------------------------
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP;
    this.hips.add(this.torso);
    this.torso.add(this.neck);
    this.neck.position.y = NECK - HIP;
    this.torso.add(this.shoulderL, this.shoulderR);
    this.shoulderL.position.set(-0.185 * B, SHOULDER - HIP, 0);
    this.shoulderR.position.set(0.185 * B, SHOULDER - HIP, 0);
    this.shoulderL.add(this.elbowL); this.shoulderR.add(this.elbowR);
    this.elbowL.position.y = -UPPER_ARM; this.elbowR.position.y = -UPPER_ARM;
    this.hips.add(this.hipL, this.hipR);
    this.hipL.position.set(-0.105 * B, 0, 0); this.hipR.position.set(0.105 * B, 0, 0);
    this.hipL.add(this.kneeL); this.hipR.add(this.kneeR);
    this.kneeL.position.y = -THIGH; this.kneeR.position.y = -THIGH;

    // --- torso: a tapered ribcage over a narrower waist, wearing a tunic ------------------
    const t = new GeoAccum();
    const y = (v: number) => v - HIP;
    t.add(tapered(0.85), xf(0, y(0.95), 0, 0.25 * B, 0.2, 0.18 * B), pants, uvC);
    t.add(tapered(1.1), xf(0, y(1.10), 0, 0.235 * B, 0.2, 0.165 * B), shirt, uvC);
    t.add(tapered(1.25), xf(0, y(CHEST), 0, 0.265 * B, 0.26, 0.185 * B), shirt, uvC);
    // shoulders and collar
    for (const s of [-1, 1]) t.add(UNIT.sphere, xf(s * 0.175 * B, y(SHOULDER - 0.02), 0, 0.16 * B, 0.15, 0.16 * B), shirt, uvC);
    t.add(tapered(0.72), xf(0, y(NECK - 0.06), 0, 0.115, 0.14, 0.115), skin, uvC);
    // belt and a short tunic skirt: the silhouette cue that says "clothed person", not "box"
    t.add(UNIT.cyl12, xf(0, y(1.02), 0, 0.255 * B, 0.07, 0.185 * B), shade(pants, 0.65), uvC);
    t.add(tapered(0.72), xf(0, y(0.90), 0, 0.28 * B, 0.2, 0.21 * B), shade(shirt, 0.92), uvC);
    if (app.apron !== undefined) {
      t.add(UNIT.box, xf(0, y(1.12), 0.105 * B, 0.30 * B, 0.42, 0.035), rgb(app.apron), uvC);
      t.add(UNIT.box, xf(0, y(1.40), 0.10 * B, 0.16 * B, 0.2, 0.03), rgb(app.apron), uvC);
    }
    if (app.hatStyle === 'hood') {
      // a cloak fanning off the shoulders
      t.add(tapered(1.5), xf(0, y(1.18), -0.03, 0.36 * B, 0.5, 0.3 * B), rgb(app.hat ?? 0x33302c), uvC);
    }
    this.attach(this.torso, t);

    // --- head ---------------------------------------------------------------------------
    const h = new GeoAccum();
    const hy = (v: number) => v - NECK;
    h.add(UNIT.sphere, xf(0, hy(HEAD_C), 0.005, 0.205, 0.25, 0.215), skin, uvC);
    h.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.075), 0.03, 0.165, 0.15, 0.19), skin, uvC);          // jaw
    h.add(UNIT.cone, xf(0, hy(HEAD_C - 0.005), 0.10, 0.05, 0.075, 0.06, 0, Math.PI / 2, 0), skin, uvC); // nose
    for (const s of [-1, 1]) h.add(UNIT.sphereLo, xf(s * 0.104, hy(HEAD_C + 0.005), -0.005, 0.045, 0.075, 0.05), skin, uvC);
    for (const s of [-1, 1]) {
      h.add(UNIT.sphereLo, xf(s * 0.052, hy(HEAD_C + 0.012), 0.093, 0.036, 0.032, 0.02), [0.92, 0.92, 0.9], uvC);
      h.add(UNIT.sphereLo, xf(s * 0.052, hy(HEAD_C + 0.012), 0.104, 0.019, 0.019, 0.014), [0.09, 0.07, 0.06], uvC);
      h.add(UNIT.box, xf(s * 0.055, hy(HEAD_C + 0.052), 0.088, 0.058, 0.014, 0.02), shade(hair, 0.8), uvC);
    }
    // hair: a cap that sits on the skull plus a fall at the back, rather than two boxes
    h.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.022), -0.012, 0.222, 0.252, 0.228), hair, uvC);
    h.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.02), -0.088, 0.2, 0.25, 0.13), hair, uvC);
    if (app.beard !== undefined) {
      h.add(UNIT.sphere, xf(0, hy(HEAD_C - 0.105), 0.045, 0.165, 0.16, 0.175), rgb(app.beard), uvC);
      h.add(UNIT.box, xf(0, hy(HEAD_C - 0.028), 0.098, 0.085, 0.024, 0.03), rgb(app.beard), uvC);
    }
    switch (app.hatStyle) {
      case 'helm': {
        const c = rgb(app.hat ?? 0x8a8e96);
        h.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.03), 0, 0.245, 0.28, 0.25), c, uvC);
        h.add(UNIT.box, xf(0, hy(HEAD_C - 0.01), 0.116, 0.035, 0.16, 0.03), shade(c, 0.85), uvC);
        h.add(UNIT.cyl12, xf(0, hy(HEAD_C + 0.09), 0, 0.25, 0.035, 0.25), shade(c, 0.8), uvC);
        break;
      }
      case 'hood': {
        const c = rgb(app.hat ?? 0x33302c);
        h.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.045), -0.03, 0.27, 0.3, 0.3), c, uvC);
        h.add(tapered(0.4), xf(0, hy(HEAD_C - 0.16), -0.06, 0.34, 0.22, 0.32), c, uvC);
        break;
      }
      case 'cap': {
        const c = rgb(app.hat ?? 0x445066);
        h.add(UNIT.sphere, xf(0, hy(HEAD_C + 0.075), -0.01, 0.235, 0.15, 0.24), c, uvC);
        h.add(UNIT.box, xf(0, hy(HEAD_C + 0.055), 0.115, 0.2, 0.025, 0.1), shade(c, 0.85), uvC);
        break;
      }
      case 'wide': {
        const c = rgb(app.hat ?? 0xb2a464);
        h.add(UNIT.cyl12, xf(0, hy(HEAD_C + 0.115), 0, 0.6, 0.035, 0.6), c, uvC);
        h.add(tapered(0.8), xf(0, hy(HEAD_C + 0.17), 0, 0.24, 0.14, 0.24), shade(c, 0.9), uvC);
        break;
      }
    }
    this.attach(this.neck, h);

    // --- arms ---------------------------------------------------------------------------
    for (const [sh, el] of [[this.shoulderL, this.elbowL], [this.shoulderR, this.elbowR]] as const) {
      const u = new GeoAccum();
      u.add(tapered(0.85), xf(0, -UPPER_ARM / 2, 0, 0.108 * B, UPPER_ARM, 0.108 * B), shirt, uvC);
      this.attach(sh, u);
      const f = new GeoAccum();
      f.add(tapered(0.78), xf(0, -FOREARM / 2, 0, 0.092 * B, FOREARM, 0.092 * B), shade(shirt, 0.94), uvC);
      f.add(UNIT.cyl8, xf(0, -FOREARM * 0.42, 0, 0.1 * B, 0.07, 0.1 * B), skin, uvC);
      f.add(UNIT.sphere, xf(0, -FOREARM - 0.05, 0.005, 0.095, 0.13, 0.07), skin, uvC);       // hand
      this.attach(el, f);
    }

    // --- legs ---------------------------------------------------------------------------
    for (const [hp, kn] of [[this.hipL, this.kneeL], [this.hipR, this.kneeR]] as const) {
      const th = new GeoAccum();
      th.add(tapered(0.8), xf(0, -THIGH / 2, 0, 0.155 * B, THIGH, 0.155 * B), pants, uvC);
      this.attach(hp, th);
      const sh = new GeoAccum();
      sh.add(tapered(0.72), xf(0, -SHIN / 2, 0, 0.125 * B, SHIN, 0.125 * B), shade(pants, 0.95), uvC);
      sh.add(UNIT.sphere, xf(0, -SHIN + 0.02, 0, 0.12, 0.11, 0.12), boot, uvC);
      sh.add(UNIT.box, xf(0, -SHIN - (ANKLE - SOLE) + 0.045, 0.055, 0.125, 0.09, 0.28), boot, uvC);
      this.attach(kn, sh);
    }

    this.pivot.scale.setScalar(app.height ?? 1);
  }

  /** What is visibly in the right hand. Same canonical trigger as before: a carried item type. */
  setHeld(type: string): void {
    if (type === this.heldType) return;
    this.heldType = type;
    if (this.held) { this.elbowR.remove(this.held); this.held = null; }
    if (!type) return;
    const acc = new GeoAccum();
    const uv = surfaceTex('metal').uvScale;
    const steel: RGB = [0.74, 0.77, 0.82], dark: RGB = [0.3, 0.3, 0.33], wood: RGB = [0.35, 0.24, 0.14];
    switch (type) {
      case 'sword': case 'dagger': {
        const len = type === 'sword' ? 0.86 : 0.4;
        acc.add(UNIT.box, xf(0, len / 2 + 0.12, 0, 0.055, len, 0.016), steel, uv);
        acc.add(UNIT.box, xf(0, 0.12, 0, 0.22, 0.035, 0.045), dark, uv);
        acc.add(UNIT.cyl8, xf(0, 0.055, 0, 0.05, 0.14, 0.05), wood, uv);
        break;
      }
      case 'axe': {
        acc.add(UNIT.cyl8, xf(0, 0.28, 0, 0.045, 0.62, 0.045), wood, uv);
        acc.add(UNIT.box, xf(0.06, 0.56, 0, 0.16, 0.2, 0.05), steel, uv);
        break;
      }
      case 'hammer': {
        acc.add(UNIT.cyl8, xf(0, 0.24, 0, 0.045, 0.5, 0.045), wood, uv);
        acc.add(UNIT.box, xf(0, 0.5, 0, 0.22, 0.11, 0.11), dark, uv);
        break;
      }
      case 'lantern': {
        acc.add(UNIT.cyl6, xf(0, 0.12, 0, 0.13, 0.2, 0.13), [1.0, 0.82, 0.42], uv);
        acc.add(UNIT.cyl6, xf(0, 0.24, 0, 0.15, 0.04, 0.15), dark, uv);
        break;
      }
      default:
        acc.add(UNIT.box, xf(0, 0.1, 0, 0.16, 0.16, 0.16), wood, uv);
    }
    const geo = acc.build(); if (!geo) return;
    const mesh = new THREE.Mesh(geo, gearMaterial());
    mesh.castShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(0, -FOREARM - 0.04, 0.03);
    g.rotation.x = -Math.PI / 2 + 0.35;
    this.held = g;
    this.elbowR.add(g);
  }

  /**
   * Drive the rig from canonical body state.
   *
   * Read-only with respect to the simulation. Every branch corresponds to a canonical `Pose`
   * (`sim/core/types.ts`) or, for the generic `work` pose, to the `WorkStyle` that
   * `presentation/activityCues.ts` resolves from the actor's active canonical Action.
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
    // reset the whole-body transform each frame; individual poses re-apply what they need
    this.pivot.position.set(0, 0, 0); this.pivot.rotation.set(0, 0, 0);
    this.hips.position.y = HIP;

    // Getting hit flashes the shared body material; canonical `lastHitAt` decides when.
    const flash = body.lastHitAt > physTime - 0.35;
    this.skinMat.emissive.setHex(flash ? 0x4a1414 : 0x000000);

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
      // Semantic Activity Projection: chopping and quarrying swing distinctly from generic
      // labour. Which one is decided by the actor's canonical Action, not by this renderer.
      if (workStyle === 'chop') { this.swing(L, t, 1.25, 2.5, 0.55, 0.18); return; }
      if (workStyle === 'quarry') { this.swing(L, t, 1.6, 1.7, 0.4, 0.3); return; }
      const w = Math.sin(t * 6.5);
      L(this.torso, 0.22, 0, 0.3); L(this.neck, 0.14);
      L(this.shoulderR, -0.95 + w * 0.55, -0.18, 0.4); L(this.elbowR, -0.75 - w * 0.4, 0, 0.4);
      L(this.shoulderL, -0.7 + Math.sin(t * 3.2) * 0.2, 0.2); L(this.elbowL, -0.8);
      L(this.hipL, 0.05, 0.05); L(this.hipR, -0.05, -0.05); L(this.kneeL, -0.1); L(this.kneeR, -0.08);
      return;
    }
    // The player's own one-shot extraction swing (interaction.ts sets this pose for 0.6s).
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

    // --- locomotion, plus `haul` which is locomotion with the arms full -------------------
    const hauling = pose === 'haul';
    if (moving) {
      const amp = Math.min(1.05, speed * 0.42);
      const sw = Math.sin(p), sw2 = Math.sin(p + Math.PI);
      L(this.hipL, sw * amp, 0.04, 0.45); L(this.hipR, sw2 * amp, -0.04, 0.45);
      // Knees only bend one way, and only on the trailing leg: this is what stops a walk cycle
      // reading as two rigid pendulums.
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
      // Idle: weight shift and breath, so a standing person is not a statue.
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
