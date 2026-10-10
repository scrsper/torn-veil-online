/** Presentation only. Distances are metres; phase is one complete left/right gait cycle. */
export interface Gait {
  cycleDistance: number;
  stance: number;
  lift: number;
  run: number;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export function gaitForSpeed(speed: number, stature = 1): Gait {
  const scale = Math.max(.25, stature), pace = Math.max(0, speed) / scale;
  const run = smooth((pace - 2.1) / 2.5);
  return { cycleDistance: (1.12 + .95 * run) * scale, stance: .64 - .23 * run, lift: (.075 + .13 * run) * scale, run };
}

/** Stance retreats at exactly travel speed. Swing returns the foot with zero lift at contact. */
export function sampleFoot(phase: number, gait: Gait): { travel: number; lift: number; planted: boolean; pitch: number } {
  const p = ((phase % 1) + 1) % 1;
  const span = gait.cycleDistance * gait.stance;
  if (p < gait.stance) {
    const t = p / gait.stance;
    return { travel: span * (.5 - t), lift: 0, planted: true, pitch: -.12 * smooth((t - .78) / .22) };
  }
  const t = (p - gait.stance) / (1 - gait.stance);
  return { travel: span * (smooth(t) - .5), lift: gait.lift * Math.sin(Math.PI * t) ** 2, planted: false, pitch: .18 * Math.sin(2 * Math.PI * t) };
}

/** Canonical forward is -Z at yaw zero; model-space +X is the person's left. */
export function localTravel(velocity: { x: number; z: number }, yaw: number): { x: number; z: number } {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < .001) return { x: 0, z: 0 };
  return { x: (-Math.cos(yaw) * velocity.x + Math.sin(yaw) * velocity.z) / speed,
    z: (-Math.sin(yaw) * velocity.x - Math.cos(yaw) * velocity.z) / speed };
}
