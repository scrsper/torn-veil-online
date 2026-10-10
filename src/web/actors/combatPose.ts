import { Quaternion, Vector3 } from '@babylonjs/core';
import { Q } from './characterRig';

/**
 * Poses for the canonical combat vocabulary: light/heavy strikes (jab, cross, front kick, round kick),
 * guard, and the three defensive steps. Each is driven by the *action's own phase timing* --
 * preparation, active (the contact window) and recovery, in seconds since it started -- so what the
 * body shows is the same clock the server decides contact on. Whether a blow lands is never decided
 * here.
 *
 * "Cinematic fantasy" is expressed in presentation only: anticipation gets a longer hold on the
 * pose before the strike (the timings are the server's; the pose eases through them), the active
 * frames snap with overshoot, and recovery carries follow-through. No time dilation, no bullet-time.
 */
export interface CombatContext {
  moveId: string;            // jab | cross | front_kick | round_kick | sidestep | backstep | duck | guard | stance
  weight: 'light' | 'heavy';
  age: number; prep: number; active: number; recovery: number;
  dirLocal?: { x: number; z: number };         // dodge direction in the body's own frame (x = its left, z = forward)
  side?: number;
  predicted?: boolean;
}
type Pose = { set(bone: string, q: Quaternion, w?: number): void; pelvis: Vector3; clear(): void };

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const back = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const chain = Q.chain;
const fwd = (a: number) => Q.x(-a);
const out = (a: number, side: 1 | -1) => Q.z(a * side);
const lean = (a: number) => Q.x(a);
const turn = (a: number) => Q.y(a);
const tilt = (a: number) => Q.z(-a);

/** Progress through the strike: 0..1 for each phase and the peak blend (extension) value. */
function phases(c: CombatContext) {
  const { age, prep, active, recovery } = c;
  const hold = 0.0;
  const p = sstep(0, prep, age - hold), a = sstep(prep, prep + active, age), r = sstep(prep + active, prep + active + recovery, age);
  // extension: rises through preparation, snaps to full in active, falls in recovery
  const ext = age < prep ? ease(p) * 0.55 : age < prep + active ? 0.55 + 0.45 * back(a) : (1 - r);
  return { p, a, r, ext, wind: age < prep ? p : 1 - Math.max(0, r) * 0 };
}

export function combatPose(L: Pose, c: CombatContext, S: number): { weight: number; pelvis: Vector3 } {
  L.clear();
  const total = c.prep + c.active + c.recovery;
  const ph = phases(c);
  const heavy = c.weight === 'heavy' ? 1 : 0;
  let weight = sstep(0, 0.06, c.age) * (1 - sstep(total - 0.12, total, c.age));
  const P = new Vector3();
  // The hand has two knuckle joints. Curling only the first leaves the fingers visibly
  // straight during punches; both joints and the opposing thumb make a readable fist.
  for (const side of ['l', 'r']) {
    L.set(`fingers_01_${side}`, Q.x(-1.15)); L.set(`fingers_02_${side}`, Q.x(-1.25));
    L.set(`thumb_01_${side}`, Q.x(-.65)); L.set(`thumb_02_${side}`, Q.x(-.5));
  }
  const stance = (k: number) => {
    // Left-lead fighting stance: knees soft, weight low, hips turned toward the rear.
    L.set('pelvis', chain(turn(-0.32 * k), lean(0.05 * k)), 1); P.y -= 0.07 * S * k;
    L.set('thigh_l', chain(fwd(0.42 * k), out(0.10 * k, 1)), 1); L.set('thigh_r', chain(fwd(-0.22 * k), out(0.16 * k, -1)), 1);
    L.set('calf_l', Q.x(0.5 * k), 1); L.set('calf_r', Q.x(0.42 * k), 1);
    L.set('spine_02', chain(turn(0.20 * k), lean(0.10 * k)), 1); L.set('head', lean(-0.06 * k), 1);
  };
  switch (c.moveId) {
    case 'jab': {
      stance(1);
      const e = ph.ext;
      L.set('upperarm_l', chain(fwd(0.95 + 0.7 * e), out(-0.1 + 0.05 * e, 1)), 1); L.set('lowerarm_l', Q.x(-(1.9 - 1.75 * e)), 1); L.set('hand_l', Q.x(-0.05), 1);
      L.set('upperarm_r', chain(fwd(0.9), out(-0.05, -1)), 1); L.set('lowerarm_r', Q.x(-2.0), 1);
      L.set('spine_03', chain(turn(0.25 * e), lean(0.06 * e)), 1); L.set('clavicle_l', chain(fwd(0.15 * e), out(0, 1)), 1);
      L.set('thigh_l', chain(fwd(0.42 + 0.1 * e), out(0.10, 1)), 1); P.z += 0.05 * S * e;
      break;
    }
    case 'cross': {
      stance(1);
      const e = ph.ext;
      L.set('pelvis', chain(turn(-0.32 + 0.75 * e), lean(0.06)), 1);
      L.set('spine_02', chain(turn(0.20 - 0.55 * e), lean(0.10 + 0.05 * e)), 1); L.set('spine_03', turn(-0.20 * e), 1);
      L.set('upperarm_r', chain(fwd(0.9 + 0.7 * e), out(-0.05 + 0.02 * e, -1)), 1); L.set('lowerarm_r', Q.x(-(2.0 - 1.85 * e)), 1);
      L.set('upperarm_l', chain(fwd(0.95), out(-0.05, 1)), 1); L.set('lowerarm_l', Q.x(-1.9), 1);
      L.set('thigh_r', chain(fwd(-0.22 + 0.1 * e), out(0.16, -1)), 1); L.set('calf_r', Q.x(0.42 - 0.2 * e), 1); L.set('foot_r', Q.x(0.3 * e), 1);
      P.z += 0.06 * S * e;
      break;
    }
    case 'front_kick': {
      stance(0.6);
      const chamber = ph.a > 0 ? 1 : ph.p, ext = ph.ext;
      const lift = c.age < c.prep ? ease(ph.p) : 1 - ph.r * 0.9;
      L.set('thigh_r', chain(fwd(1.55 * lift), out(0.05, -1)), 1);
      L.set('calf_r', Q.x(c.age < c.prep ? 2.0 * ease(ph.p) : 2.0 - 1.9 * back(ph.a) * (1 - ph.r)), 1);
      L.set('foot_r', Q.x(-0.6 * lift), 1);
      L.set('spine_02', lean(-0.22 * lift * (heavy ? 1.3 : 1)), 1); L.set('pelvis', chain(turn(-0.15), lean(-0.1 * lift)), 1); P.y -= 0.03 * S * lift;
      L.set('upperarm_l', chain(fwd(0.5 * lift), out(0.35 * lift, 1)), 1); L.set('upperarm_r', chain(fwd(0.6), out(0.25 * lift, -1)), 1); L.set('lowerarm_l', Q.x(-1.2), 1); L.set('lowerarm_r', Q.x(-1.4), 1);
      L.set('thigh_l', fwd(0.25 * (1 - lift * 0.4)), 1); L.set('calf_l', Q.x(0.3), 1);
      break;
    }
    case 'round_kick': {
      stance(0.5);
      const e = c.age < c.prep ? ease(ph.p) * 0.5 : 0.5 + 0.5 * back(ph.a) * (1 - ph.r);
      L.set('pelvis', chain(turn(-0.3 + 1.0 * e), tilt(0.35 * e)), 1);
      L.set('thigh_r', chain(fwd(0.85 * e + 0.2), out(1.25 * e, -1)), 1); L.set('calf_r', Q.x(1.9 - 1.5 * e), 1);
      L.set('spine_02', chain(tilt(-0.5 * e), turn(-0.5 * e)), 1); L.set('spine_03', tilt(-0.25 * e), 1);
      L.set('upperarm_l', chain(fwd(0.3), out(0.9 * e, 1)), 1); L.set('upperarm_r', chain(fwd(0.7), out(0.2, -1)), 1); L.set('lowerarm_l', Q.x(-0.6), 1); L.set('lowerarm_r', Q.x(-1.6), 1);
      L.set('thigh_l', fwd(0.15), 1); L.set('calf_l', Q.x(0.3), 1);
      break;
    }
    case 'sidestep': {
      stance(0.6);
      const d = c.dirLocal ?? { x: (c.side ?? 1), z: 0 }, e = Math.sin(Math.min(1, c.age / total) * Math.PI);
      const sx = Math.max(-1, Math.min(1, d.x)), sz = Math.max(-1, Math.min(1, d.z));
      L.set('pelvis', chain(tilt(sx * 0.2 * e), lean(-sz * 0.18 * e)), 1); L.set('spine_02', chain(tilt(-sx * 0.28 * e), lean(-sz * 0.12 * e)), 1);
      L.set('thigh_l', chain(fwd(0.5 * e * sz + 0.2), out(0.5 * e * Math.max(0, sx), 1)), 1); L.set('thigh_r', chain(fwd(-0.4 * e * sz), out(0.5 * e * Math.max(0, -sx), -1)), 1);
      L.set('calf_l', Q.x(0.7 * e), 1); L.set('calf_r', Q.x(0.7 * e), 1); P.y -= 0.08 * S * e;
      L.set('upperarm_l', chain(fwd(0.9), out(0.1, 1)), 1); L.set('upperarm_r', chain(fwd(0.9), out(0.1, -1)), 1); L.set('lowerarm_l', Q.x(-1.8), 1); L.set('lowerarm_r', Q.x(-1.8), 1);
      weight = Math.min(weight * 1.1, 1);
      break;
    }
    case 'backstep': {
      stance(0.6); const e = Math.sin(Math.min(1, c.age / total) * Math.PI);
      L.set('pelvis', lean(-0.22 * e), 1); L.set('spine_02', lean(-0.18 * e), 1); L.set('thigh_l', fwd(-0.5 * e + 0.2), 1); L.set('thigh_r', fwd(-0.3 * e), 1); L.set('calf_l', Q.x(0.5 * e), 1); P.y -= 0.05 * S * e;
      L.set('upperarm_l', chain(fwd(0.9), out(0.1, 1)), 1); L.set('upperarm_r', chain(fwd(0.9), out(0.1, -1)), 1); L.set('lowerarm_l', Q.x(-1.8), 1); L.set('lowerarm_r', Q.x(-1.8), 1);
      break;
    }
    case 'duck': {
      const e = Math.sin(Math.min(1, c.age / total) * Math.PI) * 0.9 + 0.1;
      L.set('pelvis', lean(0.3 * e), 1); L.set('spine_01', lean(0.25 * e), 1); L.set('spine_02', lean(0.22 * e), 1); L.set('thigh_l', fwd(0.9 * e), 1); L.set('thigh_r', fwd(0.9 * e), 1); L.set('calf_l', Q.x(1.5 * e), 1); L.set('calf_r', Q.x(1.5 * e), 1); P.y -= 0.32 * S * e;
      L.set('upperarm_l', chain(fwd(0.9), out(0.1, 1)), 1); L.set('upperarm_r', chain(fwd(0.9), out(0.1, -1)), 1); L.set('lowerarm_l', Q.x(-1.8), 1); L.set('lowerarm_r', Q.x(-1.8), 1);
      break;
    }
    case 'guard': {
      const e = sstep(0, 0.12, c.age);
      stance(0.85 * e);
      L.set('upperarm_l', chain(fwd(1.05 * e), out(0.55 * e, 1)), 1); L.set('lowerarm_l', Q.x(-(2.15 * e)), 1); L.set('hand_l', Q.x(-0.2), 1);
      L.set('upperarm_r', chain(fwd(0.95 * e), out(0.5 * e, -1)), 1); L.set('lowerarm_r', Q.x(-(2.25 * e)), 1);
      L.set('spine_02', chain(turn(0.2 * e), lean(0.12 * e)), 1); L.set('head', lean(-0.12 * e), 1);
      weight = 1;
      break;
    }
    default: { stance(0.7); weight = Math.min(weight, 0.7); }
  }
  return { weight: Math.max(0, Math.min(1, weight)), pelvis: P };
}

export function idleStance(L: Pose, S: number): Vector3 {
  const P = new Vector3();
  L.clear();
  return P;
}
