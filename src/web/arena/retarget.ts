import { Animation, AnimationGroup, AnimationKeyInterpolation, Matrix, Quaternion, Vector3, type TransformNode } from '@babylonjs/core';

/**
 * Retarget KayKit combat clips onto the Torn Veil human kit skeleton (UE-mannequin naming).
 *
 * Per sampled frame, each mapped source bone's model-space rotation change from its rest pose is
 * applied to the matching target bone. Limb rest directions are aligned for T-pose vs A-pose,
 * while the target torso keeps its authored neutral geometry. Bones the source lacks are
 * blended from neighbours (spine_02, neck) or follow their parent (clavicles follow the chest).
 * The hips' travel is rescaled by the ratio of hip heights. Output: shared Animation tracks keyed
 * by target bone name, instantiated per person as AnimationGroups.
 */
type Rig = { space: TransformNode; nodes: Map<string, TransformNode> };


type Pair = [string, string, string | null, string | null];
/** How one source rig maps onto the UE-named target: [source bone, target bone, source child, target child] (children give rest directions). */
export interface RigMap { map: Pair[]; blend: [string, string, string][]; follow: [string, string][]; hips: string; handR: string; handL: string; feet?: [string, string]; preserveRest?: readonly string[] }

export const KAYKIT: RigMap = {
  hips: 'hips', handR: 'wrist.r', handL: 'wrist.l', feet: ['foot.l', 'foot.r'],
  map: [
    ['hips', 'pelvis', 'spine', 'spine_01'], ['spine', 'spine_01', 'chest', 'spine_03'], ['chest', 'spine_03', 'head', 'neck_01'], ['head', 'head', null, null],
    ['upperarm.l', 'upperarm_l', 'lowerarm.l', 'lowerarm_l'], ['lowerarm.l', 'lowerarm_l', 'wrist.l', 'hand_l'], ['wrist.l', 'hand_l', 'hand.l', 'middle_01_l'],
    ['upperarm.r', 'upperarm_r', 'lowerarm.r', 'lowerarm_r'], ['lowerarm.r', 'lowerarm_r', 'wrist.r', 'hand_r'], ['wrist.r', 'hand_r', 'hand.r', 'middle_01_r'],
    ['upperleg.l', 'thigh_l', 'lowerleg.l', 'calf_l'], ['lowerleg.l', 'calf_l', 'foot.l', 'foot_l'], ['foot.l', 'foot_l', 'toes.l', 'ball_l'],
    ['upperleg.r', 'thigh_r', 'lowerleg.r', 'calf_r'], ['lowerleg.r', 'calf_r', 'foot.r', 'foot_r'], ['foot.r', 'foot_r', 'toes.r', 'ball_r'],
  ],
  blend: [['spine_02', 'spine_01', 'spine_03'], ['neck_01', 'spine_03', 'head']],
  follow: [['clavicle_l', 'spine_03'], ['clavicle_r', 'spine_03']],
};

/** Mixamo (mixamorig:*) including all finger joints, so captured grips transfer. */
export const MIXAMO: RigMap = (() => {
  const m = (n: string) => `mixamorig:${n}`;
  const map: Pair[] = [
    [m('Hips'), 'pelvis', m('Spine'), 'spine_01'], [m('Spine'), 'spine_01', m('Spine1'), 'spine_02'], [m('Spine1'), 'spine_02', m('Spine2'), 'spine_03'],
    [m('Spine2'), 'spine_03', m('Neck'), 'neck_01'], [m('Neck'), 'neck_01', m('Head'), 'head'], [m('Head'), 'head', null, null],
  ];
  for (const [S, s] of [['Left', 'l'], ['Right', 'r']] as const) {
    map.push([m(S + 'Shoulder'), `clavicle_${s}`, m(S + 'Arm'), `upperarm_${s}`], [m(S + 'Arm'), `upperarm_${s}`, m(S + 'ForeArm'), `lowerarm_${s}`],
      [m(S + 'ForeArm'), `lowerarm_${s}`, m(S + 'Hand'), `hand_${s}`], [m(S + 'Hand'), `hand_${s}`, m(S + 'HandMiddle1'), `middle_01_${s}`],
      [m(S + 'UpLeg'), `thigh_${s}`, m(S + 'Leg'), `calf_${s}`], [m(S + 'Leg'), `calf_${s}`, m(S + 'Foot'), `foot_${s}`],
      [m(S + 'Foot'), `foot_${s}`, m(S + 'ToeBase'), `ball_${s}`], [m(S + 'ToeBase'), `ball_${s}`, null, null]);
    for (const [F, f] of [['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky'], ['Thumb', 'thumb']] as const)
      for (let j = 1; j <= 3; j++) map.push([m(`${S}Hand${F}${j}`), `${f}_0${j}_${s}`, j < 3 ? m(`${S}Hand${F}${j + 1}`) : null, j < 3 ? `${f}_0${j + 1}_${s}` : null]);
  }
  // This capture rig's torso joint spacing has substantial forward bind curvature.
  // Transfer its motion delta while preserving the target's neutral trunk geometry.
  return { map, blend: [], follow: [], hips: m('Hips'), handR: m('RightHand'), handL: m('LeftHand'), feet: [m('LeftFoot'), m('RightFoot')],
    preserveRest: ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'] };
})();

/** UE-mannequin names (the TRELLIS/Motifect unarmed set): same body names; grouped fingers fan out to all four fingers. */
export const UE: RigMap = (() => {
  const chain = [['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'head'], ['head', null]] as const;
  const map: Pair[] = chain.map(([a, b]) => [a, a, b, b]);
  for (const s of ['l', 'r']) {
    for (const [a, b] of [['clavicle', 'upperarm'], ['upperarm', 'lowerarm'], ['lowerarm', 'hand'], ['thigh', 'calf'], ['calf', 'foot'], ['foot', 'ball']]) map.push([`${a}_${s}`, `${a}_${s}`, `${b}_${s}`, `${b}_${s}`]);
    map.push([`hand_${s}`, `hand_${s}`, `fingers_01_${s}`, `middle_01_${s}`], [`ball_${s}`, `ball_${s}`, null, null]);
    for (const f of ['index', 'middle', 'ring', 'pinky']) map.push([`fingers_01_${s}`, `${f}_01_${s}`, `fingers_02_${s}`, `${f}_02_${s}`], [`fingers_02_${s}`, `${f}_02_${s}`, null, null]);
    map.push([`thumb_01_${s}`, `thumb_01_${s}`, `thumb_02_${s}`, `thumb_02_${s}`], [`thumb_02_${s}`, `thumb_02_${s}`, null, null]);
  }
  return { map, blend: [], follow: [], hips: 'pelvis', handR: 'hand_r', handL: 'hand_l', feet: ['foot_l', 'foot_r'] };
})();

/** Quaternius UAL Unreal/Godot export: full finger chains and capitalised Head. */
export const UAL: RigMap = (() => {
  const sourceName = (target: string) => target === 'head' ? 'Head' : target;
  const map: Pair[] = MIXAMO.map.map(([, target, , child]) =>
    [sourceName(target), target, child ? sourceName(child) : null, child]);
  return { map, blend: [], follow: [], hips: 'pelvis', handR: 'hand_r', handL: 'hand_l',
    feet: ['foot_l', 'foot_r'], preserveRest: MIXAMO.preserveRest };
})();

export interface MotionProvenance {
  source: string;
  file: string;
  sourceClip: string;
  retargetLook: string;
  sha256?: string;
  license?: string;
}
export interface ClipTemplate {
  name: string; frames: number; fps: number; tracks: { bone: string; anim: Animation }[];
  provenance?: MotionProvenance;
  /** Fastest-hand speed per frame (model units/s): attack windows are measured from it. */
  swing: number[];
  /** Per frame, whether each foot (l, r) is planted (near its lowest height in the clip). */
  contact: [Uint8Array, Uint8Array] | null;
  /** Ground speed implied by the planted foot sliding back under the hips (target model units/s at speed 1); 0 for non-locomotion. */
  stance: number;
}
export interface Grip { rot: Quaternion; pos: Vector3; scale: number }

const conj = (q: Quaternion) => Quaternion.Inverse(q);
function modelRot(rig: Rig, n: TransformNode): Quaternion {
  const q = new Quaternion(); n.getWorldMatrix().decompose(undefined, q, undefined);
  const s = new Quaternion(); rig.space.getWorldMatrix().decompose(undefined, s, undefined);
  return conj(s).multiply(q).normalize();
}
function modelPos(rig: Rig, n: TransformNode): Vector3 {
  const inv = rig.space.getWorldMatrix().clone().invert();
  return Vector3.TransformCoordinates(n.getAbsolutePosition(), inv);
}
function refresh(rig: Rig): void {
  rig.space.computeWorldMatrix(true);
  const depth = (n: TransformNode) => { let d = 0, p = n.parent; while (p) { d++; p = p.parent; } return d; };
  for (const n of [...rig.nodes.values()].sort((a, b) => depth(a) - depth(b))) n.computeWorldMatrix(true);
}
function rotFromTo(a: Vector3, b: Vector3): Quaternion {
  const u = a.normalizeToNew(), v = b.normalizeToNew(), d = Vector3.Dot(u, v);
  if (d > .9999) return Quaternion.Identity();
  if (d < -.9999) { let ax = Vector3.Cross(Vector3.Right(), u); if (ax.lengthSquared() < 1e-6) ax = Vector3.Cross(Vector3.Up(), u); return Quaternion.RotationAxis(ax.normalize(), Math.PI); }
  return Quaternion.RotationAxis(Vector3.Cross(u, v).normalize(), Math.acos(d));
}

/**
 * One source track at a frame. The packed Mixamo clips store constant channels (e.g. the closed fingers of a sword
 * hand) as a few STEP-interpolated keys; Animation.evaluate does not hold those past the first segment and returns the
 * rest pose, which opened every such fist in the bakes. STEP tracks are therefore held at the last key at or before the
 * frame; every other track uses Babylon's own evaluation.
 *
 * The result is always a copy: past a clip's last key (run_sprint ends at frame 37.5 but bakes sample frame 38)
 * evaluate returns the key's own value object, and the bake's rest reset then copied the rest pose into it, which
 * corrupted that key for every later bake of the clip and pulled the loop's last frames toward the rest pose.
 */
export function sampleSource(anim: Animation, frame: number): unknown {
  const keys = anim.getKeys();
  if (!keys.length || !keys.every(k => k.interpolation === AnimationKeyInterpolation.STEP)) { const v = anim.evaluate(frame); return typeof v?.clone === 'function' ? v.clone() : v; }
  let v = keys[0].value; for (const k of keys) { if (k.frame <= frame) v = k.value; else break; }
  return typeof v?.clone === 'function' ? v.clone() : v;
}

export class Retargeter {
  private sRest = new Map<string, { q: Quaternion; p: Vector3; local: { r: Quaternion | null; p: Vector3; s: Vector3 } }>();
  private tRest = new Map<string, { q: Quaternion; p: Vector3; localQ: Quaternion }>();
  private corr = new Map<string, Quaternion>();
  private hipScale = 1;
  private tParentOfPelvis: TransformNode | null;
  private tParent = new Map<string, string | undefined>();
  private tPelvisRestPos = new Vector3();

  private readonly keyed: string[];
  constructor(private readonly src: Rig, private readonly tgt: Rig, private readonly rm: RigMap = KAYKIT) {
    this.keyed = [...rm.map.map(m => m[1]), ...rm.blend.map(b => b[0]), ...rm.follow.map(f => f[0])].filter(b => tgt.nodes.has(b));
    refresh(src); refresh(tgt);
    for (const [n, node] of src.nodes) {
      node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
      this.sRest.set(n, { q: modelRot(src, node), p: modelPos(src, node), local: { r: node.rotationQuaternion.clone(), p: node.position.clone(), s: node.scaling.clone() } });
    }
    for (const [n, node] of tgt.nodes) {
      node.rotationQuaternion ??= Quaternion.FromEulerVector(node.rotation);
      this.tRest.set(n, { q: modelRot(tgt, node), p: modelPos(tgt, node), localQ: node.rotationQuaternion.clone() });
    }
    for (const [s, t, sc, tc] of rm.map) {
      if (rm.preserveRest?.includes(t) || !sc || !tc || !src.nodes.has(sc) || !tgt.nodes.has(tc)) { this.corr.set(t, Quaternion.Identity()); continue; }
      const ds = this.sRest.get(sc)!.p.subtract(this.sRest.get(s)!.p), dt = this.tRest.get(tc)!.p.subtract(this.tRest.get(t)!.p);
      this.corr.set(t, rotFromTo(dt, ds));
    }
    const byNode = new Map([...tgt.nodes].map(([k, v]) => [v, k] as const));
    for (const [n, node] of tgt.nodes) this.tParent.set(n, node.parent ? byNode.get(node.parent as TransformNode) : undefined);
    this.hipScale = this.tRest.get('pelvis')!.p.y / Math.max(1e-3, this.sRest.get(rm.hips)!.p.y);
    this.tParentOfPelvis = (tgt.nodes.get('pelvis')!.parent as TransformNode) ?? null;
    this.tPelvisRestPos = tgt.nodes.get('pelvis')!.position.clone();
  }

  private resetSource(): void {
    for (const [n, r] of this.sRest) { const node = this.src.nodes.get(n)!; if (r.local.r) node.rotationQuaternion!.copyFrom(r.local.r); node.position.copyFrom(r.local.p); node.scaling.copyFrom(r.local.s); }
  }

  /** Bake one source clip into target-bone tracks at the source frame rate. */
  /** Bake one source clip. `inPlace` removes the hips' net horizontal travel (linear drift), so loops and strafes stay put. */
  bake(name: string, g: AnimationGroup, inPlace = true): ClipTemplate {
    const rm = this.rm; const swing: number[] = []; let prevEnds: Vector3[] | null = null; const footY: [number[], number[]] = [[], []]; const footRel: [Vector3[], Vector3[]] = [[], []];
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    const frames = Math.max(1, Math.round(g.to - g.from) + 1);
    const keys = new Map<string, { frame: number; value: Quaternion }[]>(this.keyed.map(k => [k, []]));
    const pelvisKeys: { frame: number; value: Vector3 }[] = [];
    const parentInv = this.tParentOfPelvis ? this.tParentOfPelvis.computeWorldMatrix(true).clone().multiply(this.tgt.space.getWorldMatrix().clone().invert()).invert() : Matrix.Identity();
    for (let i = 0; i < frames; i++) {
      this.resetSource();
      const f = g.from + i;
      for (const ta of g.targetedAnimations) { const t = ta.target as Record<string, unknown>; t[ta.animation.targetProperty] = sampleSource(ta.animation, f); }
      refresh(this.src);
      const delta = new Map<string, Quaternion>();
      for (const [s, t] of rm.map) {
        const sn = this.src.nodes.get(s); if (!sn || !this.tgt.nodes.has(t)) continue;
        delta.set(t, modelRot(this.src, sn).multiply(conj(this.sRest.get(s)!.q)));
      }
      for (const [b, a, c] of rm.blend) if (delta.has(a) && delta.has(c)) delta.set(b, Quaternion.Slerp(delta.get(a)!, delta.get(c)!, .5));
      for (const [b, p] of rm.follow) if (delta.has(p)) delta.set(b, delta.get(p)!.clone());
      // Desired model-space rotations, then locals in hierarchy order.
      const world = new Map<string, Quaternion>();
      const want = (bone: string): Quaternion => {
        if (world.has(bone)) return world.get(bone)!;
        const d = delta.get(bone);
        const rest = this.tRest.get(bone)!;
        let w: Quaternion;
        if (d) w = d.multiply(this.corr.get(bone) ?? Quaternion.Identity()).multiply(rest.q);
        else { const pn = this.tParent.get(bone); w = (pn ? want(pn) : this.parentRest(bone)).multiply(rest.localQ); }
        world.set(bone, w); return w;
      };
      for (const bone of this.keyed) {
        if (!this.tgt.nodes.has(bone) || !delta.has(bone)) continue;
        const pn = this.tParent.get(bone);
        const pw = pn ? want(pn) : this.parentRest(bone);
        keys.get(bone)!.push({ frame: i, value: conj(pw).multiply(want(bone)).normalize() });
      }
      // Fastest limb end (hands, and feet for kicks), measured relative to the hips.
      const ends = [rm.handR, rm.handL, ...(rm.feet ?? [])].map(n => this.src.nodes.get(n)).filter((n): n is TransformNode => !!n);
      const hp = modelPos(this.src, this.src.nodes.get(rm.hips)!);

      const cur = ends.map(n => modelPos(this.src, n).subtract(hp));
      swing.push(prevEnds ? Math.max(...cur.map((p, k) => Vector3.Distance(p, prevEnds![k]))) * fps * this.hipScale : 0); prevEnds = cur;
      const hs = modelPos(this.src, this.src.nodes.get(rm.hips)!).subtract(this.sRest.get(rm.hips)!.p).scale(this.hipScale);
      const tp = this.tRest.get('pelvis')!.p.add(hs);
      pelvisKeys.push({ frame: i, value: Vector3.TransformCoordinates(tp, parentInv) });
      // Forward kinematics on the target: its own feet decide contact and stride (the source's legs differ).
      const tf = this.tgt.nodes.get('foot_l'), tr = this.tgt.nodes.get('foot_r'), tpel = this.tgt.nodes.get('pelvis')!;
      if (tf && tr) {
        for (const [bone, k] of keys) { const v = k[k.length - 1]; const n = this.tgt.nodes.get(bone); if (v && n && v.frame === i) n.rotationQuaternion!.copyFrom(v.value); }
        tpel.position.copyFrom(pelvisKeys[pelvisKeys.length - 1].value);
        refresh(this.tgt);
        const pp = modelPos(this.tgt, tpel);
        [tf, tr].forEach((fn, k) => { const fp = modelPos(this.tgt, fn); footY[k].push(fp.y); footRel[k].push(fp.subtract(pp)); });
        for (const [n, r] of this.tRest) { const node = this.tgt.nodes.get(n)!; node.rotationQuaternion!.copyFrom(r.localQ); }
        tpel.position.copyFrom(this.tPelvisRestPos);
      }
    }
    this.resetSource(); refresh(this.src);
    const tracks: ClipTemplate['tracks'] = [];
    for (const [bone, k] of keys) {
      if (!k.length) continue;
      const a = new Animation(`${name}.${bone}`, 'rotationQuaternion', fps, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
      a.setKeys(k); tracks.push({ bone, anim: a });
    }
    const p = new Animation(`${name}.pelvis.pos`, 'position', fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
    p.setKeys(pelvisKeys); tracks.push({ bone: 'pelvis', anim: p });
    if (inPlace && pelvisKeys.length > 1) {
      // Remove net horizontal travel in model space, then convert back to the pelvis parent frame.
      const toModel = Matrix.Invert(parentInv);
      const m = pelvisKeys.map(k => Vector3.TransformCoordinates(k.value, toModel));
      const d = m[m.length - 1].subtract(m[0]);
      m.forEach((p, i) => { const t = i / (m.length - 1); p.x -= d.x * t; p.z -= d.z * t; pelvisKeys[i].value = Vector3.TransformCoordinates(p, parentInv); });
    }
    // Contacts: a foot is planted when within a small band (4% of hip height) of its lowest point in the clip.
    let contact: [Uint8Array, Uint8Array] | null = null;
    if (footY[0].length === frames && footY[1].length === frames) {
      const band = .035 * this.tRest.get('pelvis')!.p.y;
      contact = footY.map(ys => { const lo = Math.min(...ys); return Uint8Array.from(ys, y => (y < lo + band ? 1 : 0)); }) as [Uint8Array, Uint8Array];
    }
    // Stride: while planted, the foot slides back under the hips at the clip's implied ground speed.
    let stance = 0;
    if (contact) {
      let sum = 0, n = 0;
      for (let k = 0; k < 2; k++) for (let i = 1; i < frames; i++) if (contact[k][i] && contact[k][i - 1]) {
        const a = footRel[k][i - 1], b = footRel[k][i]; sum += Math.hypot(b.x - a.x, b.z - a.z) * fps; n++;
      }
      stance = n > 3 ? sum / n : 0;
    }
    return { name, frames, fps, tracks, swing, contact, stance };
  }

  /** Model-space rest rotation of a target bone's parent (for bones whose parent is outside the map). */
  private parentRest(bone: string): Quaternion {
    const parent = this.tgt.nodes.get(bone)!.parent as TransformNode | null;
    if (!parent) return Quaternion.Identity();
    parent.computeWorldMatrix(true);
    return modelRot(this.tgt, parent);
  }

  /** Where a source hand slot sits relative to the target hand, so weapons keep the source grip. */
  grip(srcHand: string, srcSlot: string, tgtHand: string, tgtChild: string): Grip {
    const sh = this.sRest.get(srcHand)!, ss = this.sRest.get(srcSlot)!, th = this.tRest.get(tgtHand)!;
    const c = this.corr.get(tgtHand) ?? Quaternion.Identity();
    const frame = c.multiply(th.q);
    const rot = conj(frame).multiply(ss.q).normalize();
    const sLen = Vector3.Distance(sh.p, this.sRest.get(srcHand.replace('wrist', 'hand'))?.p ?? sh.p) || .1;
    const tLen = Vector3.Distance(th.p, this.tRest.get(tgtChild)?.p ?? th.p) || .1;
    const off = ss.p.subtract(sh.p).scale(tLen / sLen);
    const handNode = this.tgt.nodes.get(tgtHand)!;
    const ws = new Vector3(); handNode.getWorldMatrix().decompose(ws); const ss2 = new Vector3(); this.tgt.space.getWorldMatrix().decompose(ss2);
    const scale = ws.x / ss2.x;
    const pos = off.applyRotationQuaternion(conj(frame)).scale(1 / scale);
    return { rot, pos, scale };
  }
}

/** Instantiate baked clips on one person's bone nodes. */
export function instantiateClips(tag: string, clips: Map<string, ClipTemplate>, nodes: Map<string, TransformNode>, scene: import('@babylonjs/core').Scene): Map<string, AnimationGroup> {
  const out = new Map<string, AnimationGroup>();
  for (const [name, c] of clips) {
    const g = new AnimationGroup(`${tag}.${name}`, scene);
    for (const t of c.tracks) { const n = nodes.get(t.bone); if (n) g.addTargetedAnimation(t.anim, n); }
    g.normalize(0, c.frames - 1);
    out.set(name, g);
  }
  return out;
}

/** Seconds into a clip where the strike is live: the contiguous run around peak hand speed above `k` of peak. */
export function strikeWindow(c: ClipTemplate, k = .5, from = 0, to = 1): [number, number] {
  const sw = c.swing, n = sw.length; if (n < 3) return [0, c.frames / c.fps];
  const a = Math.floor(n * from), b = Math.max(a + 1, Math.floor(n * to));
  let pk = a; for (let i = a; i < b; i++) if (sw[i] > sw[pk]) pk = i;
  let i0 = pk, i1 = pk; while (i0 > a && sw[i0 - 1] > sw[pk] * k) i0--; while (i1 < b - 1 && sw[i1 + 1] > sw[pk] * k) i1++;
  return [i0 / c.fps, (i1 + 1) / c.fps];
}
