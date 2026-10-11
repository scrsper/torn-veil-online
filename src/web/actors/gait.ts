/**
 * Human gait curves for the procedural animator.
 * Source: PR65, claude/natural-human-gait at
 * 1a61094fdfcb700dda01fbcc175b66aaea747187. These are authored smooth
 * approximations, not measurements from the inaccessible reference video.
 *
 * Joint angles over one gait cycle for walking and running, taken as smooth approximations of
 * normative sagittal-plane gait data (hip flexion, knee flexion, foot pitch to the ground) and
 * the pelvis/trunk motions that accompany them. A cycle starts at heel strike (walk) or foot
 * strike (run) of the leg it describes; the other leg runs half a cycle later. Walking has a long
 * stance (toe-off near 60%) with a small loading knee bend and a large swing bend; running has a
 * short stance (toe-off near 38%), a deeper loaded knee and a flight phase.
 *
 * Presentation only: nothing here reads or changes canonical state.
 */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** A periodic curve sampled at [cycle fraction, degrees] keys, interpolated with Catmull-Rom. */
type Keys = ReadonlyArray<readonly [number, number]>;

function periodic(keys: Keys): (u: number) => number {
  const n = keys.length;
  return (u: number) => {
    u -= Math.floor(u);
    let i = n - 1;
    for (let j = 0; j < n; j++) if (keys[j][0] > u) { i = j - 1; break; }
    const at = (k: number) => { const m = ((k % n) + n) % n, wrap = Math.floor(k / n); return [keys[m][0] + wrap, keys[m][1]] as const; };
    const [x1, y1] = at(i), [x2, y2] = at(i + 1), [x0, y0] = at(i - 1), [x3, y3] = at(i + 2);
    const t = (u - x1) / (x2 - x1 || 1);
    // Non-uniform Catmull-Rom tangents (finite differences over neighbouring spans).
    const m1 = ((y2 - y0) / (x2 - x0 || 1)) * (x2 - x1), m2 = ((y3 - y1) / (x3 - x1 || 1)) * (x2 - x1);
    const t2 = t * t, t3 = t2 * t;
    return ((2 * t3 - 3 * t2 + 1) * y1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * y2 + (t3 - t2) * m2) * DEG;
  };
}

const WALK = {
  // Hip flexion (+) / extension (-) relative to the pelvis.
  hip: periodic([[0, 28], [0.1, 25], [0.2, 16], [0.3, 6], [0.4, -4], [0.5, -11], [0.6, -6], [0.7, 10], [0.8, 24], [0.9, 30]]),
  // Knee flexion: loading response bend, near-straight midstance, big swing bend.
  knee: periodic([[0, 3], [0.08, 14], [0.15, 18], [0.25, 9], [0.4, 4], [0.5, 9], [0.6, 36], [0.7, 58], [0.75, 60], [0.82, 46], [0.9, 18], [0.96, 4]]),
  // Foot pitch to the ground: + toes down (heel up), - toes up.
  foot: periodic([[0, -18], [0.06, -6], [0.1, 0], [0.4, 0], [0.5, 10], [0.6, 30], [0.68, 22], [0.78, 2], [0.88, -10], [0.95, -18]]),
  // Toe bend at the ball, - toes bent up relative to the foot (heel rise and push-off).
  ball: periodic([[0, 0], [0.4, 0], [0.5, -12], [0.6, -30], [0.66, -10], [0.72, 0]]),
};

const RUN = {
  hip: periodic([[0, 32], [0.12, 20], [0.25, 2], [0.38, -12], [0.45, -6], [0.55, 14], [0.7, 38], [0.82, 46], [0.92, 40]]),
  knee: periodic([[0, 22], [0.12, 42], [0.25, 28], [0.38, 18], [0.5, 60], [0.62, 100], [0.72, 105], [0.82, 72], [0.92, 34]]),
  foot: periodic([[0, -4], [0.06, 0], [0.22, 0], [0.32, 18], [0.4, 40], [0.5, 30], [0.62, 10], [0.8, 0], [0.92, -8]]),
  ball: periodic([[0, 0], [0.2, 0], [0.3, -18], [0.38, -32], [0.45, -8], [0.52, 0]]),
};

export interface LegPose { hip: number; knee: number; foot: number; ball: number }

/**
 * Leg pose (radians) at cycle fraction `u` for one leg. `run` blends walk to run curves;
 * `amp` (0..1) scales the range of motion toward a short, shuffling step for slow walking.
 */
export function legPose(u: number, run: number, amp: number): LegPose {
  const w = 1 - run;
  const hip = WALK.hip(u) * w + RUN.hip(u) * run;
  const knee = WALK.knee(u) * w + RUN.knee(u) * run;
  const foot = WALK.foot(u) * w + RUN.foot(u) * run;
  const ball = WALK.ball(u) * w + RUN.ball(u) * run;
  // A slow step keeps its timing but narrows its range; the knee keeps a little swing clearance.
  const a = 0.35 + 0.65 * amp;
  return { hip: hip * a, knee: knee * (0.45 + 0.55 * amp), foot: foot * a, ball: ball * a };
}

export interface BodySway {
  /** Pelvis translation in character space (x = figure's left, y = up, z = forward), metres before scaling. */
  x: number; y: number;
  /** Pelvis yaw (left hip forward = -), list (left side down = +) in radians. */
  pelvisTurn: number; pelvisList: number;
  /** Thorax counter-rotation against the pelvis. */
  thoraxTurn: number;
}

/**
 * Whole-body motion at the left leg's cycle fraction `u`: the pelvis is lowest at double support
 * when walking but lowest at mid-stance when running, shifts over the stance foot, drops on the
 * swing side, and rotates with the forward leg while the thorax turns the other way.
 */
export function bodySway(u: number, run: number, amp: number): BodySway {
  const w = 1 - run;
  const walkY = -Math.cos(2 * TAU * u) * 0.022;                 // low at heel strike, high at mid-stance
  const runY = -Math.cos(2 * TAU * (u - 0.19)) * 0.035;         // low at mid-stance, high in flight
  const x = Math.sin(TAU * (u - 0.02)) * (0.022 * w + 0.008 * run);
  const list = -Math.sin(TAU * (u + 0.06)) * (0.07 * w + 0.05 * run);
  const turn = -Math.cos(TAU * u) * (0.08 * w + 0.13 * run);
  const thorax = Math.cos(TAU * (u - 0.03)) * (0.09 * w + 0.17 * run);
  return { x: x * amp, y: (walkY * w + runY * run) * amp, pelvisTurn: turn * amp, pelvisList: list * amp, thoraxTurn: thorax * amp };
}

/**
 * Arm swing for the arm on the same side as the leg at `u`: it swings opposite that leg, lagging
 * it slightly, and the elbow bends more as the arm comes forward. Running carries a held elbow.
 */
export function armSwing(u: number, run: number, amp: number): { shoulder: number; elbow: number } {
  const s = -Math.cos(TAU * (u - 0.05));
  const range = (0.2 * (1 - run) + 0.42 * run) * amp;
  // A runner's elbow holds near a right angle and the swing sits behind the body, so the hands pass the hip, not the face.
  const elbowBase = 0.22 + 0.1 * amp + 1.0 * run;
  const elbow = elbowBase + Math.max(0, s) * (0.22 + 0.2 * run) * amp;
  return { shoulder: s * range + 0.03 - 0.22 * run, elbow };
}
