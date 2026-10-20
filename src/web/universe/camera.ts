/** Spherical third-person framing. Input, preferred zoom and interpolation are
 * presentation state only; this module cannot write a body or travel command. */
import { add, cross, dot, length, normalize, scale, sub, tangentFrame, type V3 } from '../../sim/world/planet/planet';

export const ORBIT_INPUT = Object.freeze({ yawPerPixel: .004, pitchPerPixel: .0035,
  minPitch: -15 * Math.PI / 180, maxPitch: 75 * Math.PI / 180, minDistance: 3, maxDistance: 18 });
/** Automatic horizon motion only; pointer orbit/recenter keep their own response. */
export const MAX_HORIZON_SPEED = Math.PI / 2;
export type CameraClockSource = 'timeline' | 'fallback' | 'unavailable';
/** Camera motion follows the document frame timeline (the RAF timestamp), not
 * the callback's execution time: main-thread scheduling can make a 7ms frame
 * appear to the engine performance monitor as a 10.7ms callback interval.
 * A monotonic callback clock is the explicit fallback where no timeline exists.
 * Switching clock domains rebases without spending time from a different epoch. */
export class CameraFrameClock {
  private previous: number | null = null;
  private source: CameraClockSource = 'unavailable';
  readonly debug = { source: 'unavailable' as CameraClockSource, timestampMs: null as number | null, deltaSeconds: 0 };
  step(timelineTime: unknown, fallbackTime: number): number {
    const timeline = typeof timelineTime === 'number' && Number.isFinite(timelineTime);
    const source: CameraClockSource = timeline ? 'timeline' : Number.isFinite(fallbackTime) ? 'fallback' : 'unavailable';
    const timestamp = source === 'timeline' ? timelineTime as number : source === 'fallback' ? fallbackTime : null;
    let dt = 0;
    if (timestamp === null) this.previous = null;
    else if (source !== this.source || this.previous === null) this.previous = timestamp;
    else if (timestamp > this.previous) {
      dt = Math.min((timestamp - this.previous) / 1000, .1); this.previous = timestamp;
    }
    // A duplicate/backwards timestamp spends no time and cannot inflate the next
    // interval by moving the high-water mark backwards.
    this.source = source;
    Object.assign(this.debug, { source, timestampMs: timestamp, deltaSeconds: dt });
    return dt;
  }
}
export type OrbitMode = 'ground' | 'personal' | 'vessel';
export interface SphericalCameraInput {
  radial: V3; forward: V3; velocity: V3; mode: OrbitMode;
}
export interface SphericalCameraPose {
  /** Offsets from the rendered travel reference, which is 3m above body feet. */
  position: V3; target: V3; pivot: V3; up: V3; tangentHeading: V3; fov: number;
}
export type OrbitObstruction = (pivot: V3, eye: V3) => number;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const damp = (v: number, dt: number) => 1 - Math.exp(-v * dt);
const copy = (v: V3): V3 => ({ x: v.x, y: v.y, z: v.z });
const rotate = (v: V3, axis: V3, angle: number) => add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
  scale(axis, dot(axis, v) * (1 - Math.cos(angle))));
const projected = (v: V3, up: V3) => sub(v, scale(up, dot(v, up)));
const angle = (a: V3, b: V3, up: V3) => Math.atan2(dot(cross(a, b), up), clamp(dot(a, b), -1, 1));
/** Exact fixed-target integration of d(error)/dt = -min(speed, damping*error).
 * Integrating both sides of the transition preserves the bound and response
 * across long/short render frames instead of Euler-stepping through it. */
function horizonFraction(from: V3, to: V3, dt: number) {
  const error = Math.acos(clamp(dot(from, to), -1, 1)), damping = 5;
  if (error < 1e-10) return 0;
  const threshold = MAX_HORIZON_SPEED / damping;
  const linearTime = Math.max(0, (error - threshold) / MAX_HORIZON_SPEED);
  const remaining = dt <= linearTime ? error - MAX_HORIZON_SPEED * dt
    : Math.min(error, threshold) * Math.exp(-damping * (dt - linearTime));
  return clamp((error - remaining) / error, 0, 1);
}
/** Minimal rotation, including a deterministic antipodal axis. */
function transport(v: V3, from: V3, to: V3, fallback: V3, fraction = 1): V3 {
  const crossed = cross(from, to), sine = length(crossed), cosine = clamp(dot(from, to), -1, 1);
  if (sine < 1e-9 && cosine > 0) return copy(v);
  const axis = sine > 1e-9 ? scale(crossed, 1 / sine) : normalize(projected(fallback, from));
  return rotate(v, axis, Math.atan2(sine, cosine) * fraction);
}

export class SphericalOrbitCamera {
  yaw = 0;
  pitch = 28 * Math.PI / 180;
  preferredDistance = 6;
  private started = false;
  private recenterWanted = false;
  private rawUp: V3 = { x: 0, y: 1, z: 0 };
  private frameUp: V3 = { x: 0, y: 1, z: 0 };
  private heading: V3 = { x: 0, y: 0, z: -1 };
  private axis: V3 = { x: 0, y: 0, z: -1 };
  private yawS = 0;
  private pitchS = this.pitch;
  private distance = this.preferredDistance;
  private allowedDistance = Infinity;
  private clearFor = 0;
  private pivotHeight = -1.65;
  private lead = 0;
  private fov = 52 * Math.PI / 180;
  private inputRevision = 0;
  readonly debug = {
    mode: 'ground' as OrbitMode, yaw: 0, renderedYaw: 0, pitch: 0, renderedPitch: 0,
    preferredDistance: 6, renderedDistance: 6, desiredDistance: 6, obstructionDistance: 6,
    inputRevision: 0, fov: 52 * Math.PI / 180, maxHorizonSpeed: MAX_HORIZON_SPEED, input: ORBIT_INPUT,
  };

  orbitPixels(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.look(x * ORBIT_INPUT.yawPerPixel, y * ORBIT_INPUT.pitchPerPixel);
  }
  look(yaw: number, pitch: number) {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;
    this.yaw = wrap(this.yaw - yaw); this.pitch = clamp(this.pitch + pitch, ORBIT_INPUT.minPitch, ORBIT_INPUT.maxPitch);
    this.inputRevision++;
  }
  zoom(steps: number) {
    if (!Number.isFinite(steps)) return;
    this.preferredDistance = clamp(this.preferredDistance * Math.exp(clamp(steps, -6, 6) * .12),
      ORBIT_INPUT.minDistance, ORBIT_INPUT.maxDistance);
    this.inputRevision++;
  }
  recenter() { this.recenterWanted = true; this.inputRevision++; }
  /** Only discontinuous host placement (system warp/reload) resets smoothing. */
  reset() { this.started = false; this.allowedDistance = Infinity; this.clearFor = 0; }
  preferences() { return { yaw: this.yaw, pitch: this.pitch, distance: this.preferredDistance }; }
  restore(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const p = value as Record<string, unknown>;
    if (typeof p.yaw === 'number' && Number.isFinite(p.yaw) && Math.abs(p.yaw) <= Math.PI) this.yaw = p.yaw;
    if (typeof p.pitch === 'number' && Number.isFinite(p.pitch) && p.pitch >= ORBIT_INPUT.minPitch && p.pitch <= ORBIT_INPUT.maxPitch) this.pitch = p.pitch;
    if (typeof p.distance === 'number' && Number.isFinite(p.distance) && p.distance >= ORBIT_INPUT.minDistance && p.distance <= ORBIT_INPUT.maxDistance) this.preferredDistance = p.distance;
  }

  update(dt: number, input: SphericalCameraInput, obstruct?: OrbitObstruction): SphericalCameraPose {
    const t = clamp(Number.isFinite(dt) ? dt : 0, 0, .1), radial = normalize(input.radial);
    const tangent = projected(input.forward, radial), speed = length(input.velocity);
    const factor = input.mode === 'vessel' ? 3.2 : input.mode === 'personal' ? 1.15 : 1;
    const speedBias = input.mode === 'ground' ? Math.min(.35, speed * .035)
      : Math.min(input.mode === 'personal' ? 1.2 : 3, Math.log1p(speed / 20) * .6);
    const desiredDistance = this.preferredDistance * factor + speedBias;
    // Close ground framing includes boots above the bottom HUD without changing
    // the free orbit angle or the user's preferred distance.
    const closeGround = input.mode === 'ground' ? clamp((6 - this.preferredDistance) / 3, 0, 1) : 0;
    const desiredPivot = input.mode === 'vessel' ? .5 : -1.65 - .3 * closeGround;
    const desiredLead = input.mode === 'vessel' ? 1.2 : .35 * (1 - closeGround);
    const desiredFov = (52 + (input.mode === 'ground' ? 0 : Math.min(5, Math.log1p(speed / 40) * 1.1))) * Math.PI / 180;
    if (!this.started) {
      this.rawUp = copy(radial); this.frameUp = copy(radial);
      this.heading = length(tangent) > .15 ? normalize(tangent) : tangentFrame(radial).north;
      this.axis = copy(this.heading); this.yawS = this.yaw; this.pitchS = this.pitch;
      this.distance = desiredDistance; this.pivotHeight = desiredPivot; this.lead = desiredLead; this.fov = desiredFov;
      this.started = true;
    } else {
      // Keep the prior anatomical tangent through a vertical ascent/descent.
      this.heading = normalize(projected(transport(this.heading, this.rawUp, radial, this.heading), radial));
      if (length(tangent) > .15) this.heading = normalize(rotate(this.heading, radial,
        angle(this.heading, normalize(tangent), radial) * damp(12, t)));
      this.rawUp = copy(radial);
      const oldUp = this.frameUp;
      this.frameUp = normalize(transport(oldUp, oldUp, radial, this.axis, horizonFraction(oldUp, radial, t)));
      this.axis = normalize(projected(transport(this.axis, oldUp, this.frameUp, this.axis), this.frameUp));
    }
    if (this.recenterWanted) {
      const facing = projected(this.heading, this.frameUp);
      if (length(facing) > .01) this.yaw = angle(this.axis, normalize(facing), this.frameUp);
      this.recenterWanted = false;
    }
    this.yawS = wrap(this.yawS + wrap(this.yaw - this.yawS) * damp(30, t));
    this.pitchS += (this.pitch - this.pitchS) * damp(20, t);
    this.distance += (desiredDistance - this.distance) * damp(5, t);
    this.pivotHeight += (desiredPivot - this.pivotHeight) * damp(5, t);
    this.lead += (desiredLead - this.lead) * damp(5, t);
    this.fov += (desiredFov - this.fov) * damp(3, t);
    const direction = normalize(rotate(this.axis, this.frameUp, this.yawS));
    const back = add(scale(direction, -Math.cos(this.pitchS)), scale(this.frameUp, Math.sin(this.pitchS)));
    const pivot = scale(this.frameUp, this.pivotHeight), desiredEye = add(pivot, scale(back, this.distance));
    const clear = clamp(obstruct?.(pivot, desiredEye) ?? this.distance, 0, this.distance);
    if (clear < this.allowedDistance) { this.allowedDistance = clear; this.clearFor = 0; }
    else {
      this.clearFor += t;
      if (this.clearFor >= .16) this.allowedDistance += (clear - this.allowedDistance) * damp(4, t);
    }
    const actual = Math.min(this.distance, this.allowedDistance);
    const position = add(pivot, scale(back, actual));
    // Minimum zoom removes look-ahead; complete wall retraction can then put
    // eye and target at the same pivot. Keep a defined direction without
    // pushing the lens through the obstruction or moving the body.
    const look = sub(scale(direction, this.lead), scale(back, actual)), lookDistance = length(look);
    const target = lookDistance > 1e-4 ? add(pivot, scale(direction, this.lead))
      : add(position, lookDistance > 1e-12 ? scale(look, 1 / lookDistance) : scale(back, -1));
    Object.assign(this.debug, { mode: input.mode, yaw: this.yaw, renderedYaw: this.yawS, pitch: this.pitch, renderedPitch: this.pitchS,
      preferredDistance: this.preferredDistance, renderedDistance: actual, desiredDistance, obstructionDistance: clear,
      inputRevision: this.inputRevision, fov: this.fov });
    return { position, target, pivot, up: copy(this.frameUp), tangentHeading: copy(this.heading), fov: this.fov };
  }
}
