import { Camera, FreeCamera, Vector3 } from '@babylonjs/core';
import type { Settings } from './bindings';
import { AdaptiveCamera, CAMERA_LIMITS, marchObstruction, type CameraPresetName, type CameraSituation } from './adaptiveCamera';

/**
 * Fixed isometric, elevated exploration or shoulder perspective camera. Third-person orbits a pivot (the player's head in render space), keeps the player
 * readable in exploration, eases to frame a locked target in combat, and eases to an
 * over-the-shoulder shot for conversation. It never decides anything about the simulation: the pivot
 * and obstruction queries come from what is drawn (terrain height, built structure), and look
 * input only changes where the camera is.
 *
 * Yaw follows the simulation's convention (forward = (-sin yaw, 0, -cos yaw); increasing yaw turns
 * left), so camera-relative movement is exactly the same rotation the movement kernel uses.
 */
export interface CameraObstruction {
  /** True if a camera sphere centred here would be inside built structure or ground. */
  blocked(x: number, y: number, z: number): boolean;
  /** Ground height in render space under (x, z), or null when not resident. */
  ground(x: number, z: number): number | null;
}
export type CameraMode = 'explore' | 'combat' | 'talk';
export interface CameraFocus { x: number; y: number; z: number }

export const ORBIT_EXPLORATION_PITCH = .5;
/** Default third-person pitch (about 12 degrees down). */
export const THIRD_PERSON_PITCH = 12 * Math.PI / 180;
const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a: number, b: number, t: number) => a + wrap(b - a) * t;
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export class CameraRig {
  yaw = Math.PI; pitch = THIRD_PERSON_PITCH; distance = 4.6;
  /** The elevated adaptive camera (third-person view); talk, orbit and isometric keep their own framing. */
  readonly adaptive = new AdaptiveCamera();
  /** Situation from the app each frame (threats, large creatures, velocity, aiming); presentation only. */
  situation: Omit<CameraSituation, 'pivot'> = {};
  private obstruct: ReturnType<typeof marchObstruction>;
  private lastLookAt = -99; private clock = 0;
  private isoSpan = 10;
  private previousIso = false;
  private previousOrbit = false;
  get orbit(): boolean { return this.settings().viewMode === 'orbit'; }
  get cutaway(): boolean { return this.isometric || this.orbit; }
  aimYaw: number | null = null;
  get isometric(): boolean { return this.settings().viewMode === 'isometric'; }
  private desiredDistance = 4.6;
  private currentDistance = 4.6;
  private shoulder = 0.35;          // metres to the right of the pivot
  private shoulderNow = 0.35;
  private fov = 1.08;
  mode: CameraMode = 'explore';
  private shake = 0; private shakeT = 0;
  private lockPivot: CameraFocus | null = null;
  private talkAnchor: { npc: CameraFocus } | null = null;
  private kick = 0;
  readonly position = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  /** Extra vertical offset (crouch, sit) applied to the pivot. */
  pivotDrop = 0;

  constructor(readonly camera: FreeCamera, private readonly settings: () => Settings, private readonly world: CameraObstruction) {
    camera.minZ = 0.12; camera.maxZ = 3200; camera.inertia = 0; camera.fov = this.fov;
    this.obstruct = marchObstruction((x, y, z) => this.world.blocked(x, y, z));
  }
  /** Development presets (Default Exploration, Close, Wide, Group Combat, Large Creature, Interior). */
  preset(name: CameraPresetName | 'off'): void { if (name === 'off') { this.adaptive.forced = null; return; } this.adaptive.preset(name); this.pitch = this.adaptive.pitch; this.desiredDistance = this.adaptive.preferred; }
  private get adaptiveActive(): boolean { return !this.isometric && !this.orbit && this.mode !== 'talk'; }

  addLook(dx: number, dy: number): void {
    if (this.isometric || this.mode === 'talk') return;
    this.yaw = wrap(this.yaw - dx); this.lastLookAt = this.clock;
    this.pitch = this.orbit ? Math.max(0.32, Math.min(1.05, this.pitch + dy)) : Math.max(CAMERA_LIMITS.minPitch, Math.min(CAMERA_LIMITS.maxPitch, this.pitch + dy));
  }
  zoom(delta: number): void { if (this.isometric) { this.isoSpan = Math.max(6, Math.min(18, this.isoSpan * (1 + delta * 0.08))); return; } this.desiredDistance = Math.max(this.orbit ? 4 : CAMERA_LIMITS.minDistance, Math.min(this.orbit ? 14 : CAMERA_LIMITS.maxDistance, this.desiredDistance * (1 + delta * 0.08))); }
  /** A short impulse (metres of shove, seconds of shake), scaled by the reduced-motion/shake settings. */
  impact(strength: number): void { const s = this.settings(); if (s.reducedMotion) return; this.shake = Math.min(1, this.shake + strength * s.cameraShake); this.kick = Math.min(0.5, this.kick + strength * 0.25 * s.cameraShake); }
  setMode(mode: CameraMode): void { if (this.orbit && this.mode === 'talk' && mode !== 'talk') this.pitch = ORBIT_EXPLORATION_PITCH; this.mode = mode; }
  setLock(target: CameraFocus | null): void { this.lockPivot = target; }
  setTalk(npc: CameraFocus | null): void { this.talkAnchor = npc ? { npc } : null; }
  /** Horizontal camera yaw for camera-relative movement. */
  get moveYaw(): number { return this.isometric ? -Math.PI / 4 : this.yaw; }

  update(dt: number, pivot: CameraFocus, playerYaw: number): void {
    const s = this.settings(), t = Math.min(dt, 0.1);
    if (this.isometric) {
      this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      const aspect = this.camera.getEngine().getAspectRatio(this.camera);
      this.camera.orthoTop = this.isoSpan; this.camera.orthoBottom = -this.isoSpan;
      this.camera.orthoLeft = -this.isoSpan * aspect; this.camera.orthoRight = this.isoSpan * aspect;
      const yaw = this.moveYaw, pitch = Math.atan(1 / Math.sqrt(2)), d = 32;
      const target = new Vector3(pivot.x, pivot.y - .65 - this.pivotDrop, pivot.z);
      // Combat and conversation never rotate the screen's movement basis.
      this.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * d, target.y + Math.sin(pitch) * d, target.z + Math.cos(yaw) * Math.cos(pitch) * d);
      this.camera.position.copyFrom(this.position); this.camera.setTarget(target);
      this.forward.copyFrom(target.subtract(this.position).normalize()); this.previousIso = true;
      return;
    }
    this.camera.mode = Camera.PERSPECTIVE_CAMERA; this.clock += t;
    if (this.orbit !== this.previousOrbit) {
      this.pitch = this.orbit ? ORBIT_EXPLORATION_PITCH : THIRD_PERSON_PITCH;
      this.desiredDistance = this.orbit ? 8 : 4.6;
      this.previousOrbit = this.orbit;
    }
    if (this.previousIso) { this.yaw = playerYaw; this.pitch = this.orbit ? ORBIT_EXPLORATION_PITCH : THIRD_PERSON_PITCH; this.previousIso = false; this.aimYaw = null; this.adaptive.snap(); }
    if (this.adaptiveActive) { this.updateAdaptive(t, pivot); return; }

    // Mode targets.
    let targetShoulder = this.orbit ? 0 : 0.35, targetDist = this.desiredDistance, targetFov = (s.fov * Math.PI) / 180 * 1.0;
    let lookYawOverride: number | null = null;
    if (this.mode === 'combat' && this.lockPivot) {
      const dx = this.lockPivot.x - pivot.x, dz = this.lockPivot.z - pivot.z, d = Math.hypot(dx, dz);
      lookYawOverride = Math.atan2(-dx, -dz);
      targetDist = Math.max(this.orbit ? 6 : 3.4, Math.min(this.orbit ? 14 : 6.4, this.desiredDistance + d * (this.orbit ? .4 : .25))); targetFov += 0.04; targetShoulder = this.orbit ? 0 : 0.75;
      const dy = this.lockPivot.y - pivot.y; this.pitch += (Math.max(this.orbit ? .42 : .06, Math.min(this.orbit ? .85 : .5, (this.orbit ? .62 : .26) + dy * .05 - d * .015)) - this.pitch) * damp(3, t);
    } else if (this.mode === 'talk' && this.talkAnchor) {
      // Over the player's shoulder towards the speaker, a little closer than exploration.
      const dx = this.talkAnchor.npc.x - pivot.x, dz = this.talkAnchor.npc.z - pivot.z;
      lookYawOverride = Math.atan2(-dx, -dz) + 0.42; targetDist = 2.55; targetShoulder = 0.6; targetFov -= 0.06;
      this.pitch += (0.12 - this.pitch) * damp(3.5, t);
    } else if (this.mode === 'explore') { targetShoulder = this.orbit ? 0 : 0.32; }
    if (lookYawOverride !== null) this.yaw = lerpAngle(this.yaw, lookYawOverride, damp(this.mode === 'talk' ? 3.2 : 4.5, t));
    this.currentDistance += (targetDist - this.currentDistance) * damp(4, t);
    this.shoulderNow += (targetShoulder - this.shoulderNow) * damp(4, t);
    this.fov += (targetFov - this.fov) * damp(3, t);
    this.camera.fov = this.fov;

    // Ideal position from the pivot: back along the view direction, raised by pitch, offset to the shoulder.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    const px = pivot.x, py = pivot.y - this.pivotDrop, pz = pivot.z;
    const sx = px + rx * this.shoulderNow, sz = pz + rz * this.shoulderNow;
    let dist = this.currentDistance;
    const wantX = (d: number) => sx - fx * cp * d, wantY = (d: number) => py + sp * d, wantZ = (d: number) => sz - fz * cp * d;
    // March from the pivot toward the ideal position; stop short of anything solid, with a margin.
    let safe = 0; const step = 0.2;
    for (let d = step; d <= dist; d += step) {
      if (this.world.blocked(wantX(d), wantY(d), wantZ(d))) break;
      safe = d;
    }
    if (safe < dist) dist = Math.max(0.55, safe - 0.25);
    // Never dip under the ground.
    let cx = wantX(dist), cyv = wantY(dist), cz = wantZ(dist);
    const g = this.world.ground(cx, cz); if (g !== null && cyv < g + 0.35) cyv = g + 0.35;
    // Impact shake and kick.
    if (this.shake > 0.001) { this.shakeT += t * 38; const a = this.shake * 0.06; cx += Math.sin(this.shakeT * 1.3) * a; cyv += Math.sin(this.shakeT * 1.7 + 1) * a * 0.8; cz += Math.cos(this.shakeT * 1.1) * a; this.shake *= Math.exp(-9 * t); }
    if (this.kick > 0.001) { cx += fx * this.kick * 0.5; cz += fz * this.kick * 0.5; this.kick *= Math.exp(-11 * t); }
    // Distance smoothing when pulled in is instant (never see through a wall); recovery is eased by currentDistance above.
    this.position.set(cx, cyv, cz);
    this.camera.position.copyFrom(this.position);
    // Look at a point slightly ahead of the pivot so the player sits low in frame.
    let tx = px + rx * this.shoulderNow * 0.6, ty = py + 0.05, tz = pz + rz * this.shoulderNow * 0.6;
    if (this.orbit && this.mode === 'combat' && this.lockPivot) {
      tx = px * .65 + this.lockPivot.x * .35;
      ty = py * .65 + this.lockPivot.y * .35;
      tz = pz * .65 + this.lockPivot.z * .35;
    }
    if (this.mode === 'talk' && this.talkAnchor) {
      // Frame faces instead of lowering the view onto the player's waist.
      tx = px*.3 + this.talkAnchor.npc.x*.7;
      ty = py*.3 + this.talkAnchor.npc.y*.7;
      tz = pz*.3 + this.talkAnchor.npc.z*.7;
    }
    this.camera.setTarget(new Vector3(tx, ty, tz));
    this.forward.set(tx - cx, ty - cyv, tz - cz).normalize();
    void playerYaw; void TAU;
    this.adaptive.snap();   // talk/orbit framing owns the camera; resume cleanly afterwards
  }

  /** Third-person: the shared adaptive camera, plus a gentle lock assist that never fights recent look input. */
  private updateAdaptive(t: number, pivot: CameraFocus): void {
    const s = this.settings(), a = this.adaptive;
    if (this.mode === 'combat' && this.lockPivot && this.clock - this.lastLookAt > .8) {
      const lockYaw = Math.atan2(-(this.lockPivot.x - pivot.x), -(this.lockPivot.z - pivot.z));
      this.yaw = lerpAngle(this.yaw, lockYaw, damp(1.6, t));
    }
    a.yaw = this.yaw; a.pitch = this.pitch; a.preferred = this.desiredDistance; a.baseFov = (s.fov + 3) * Math.PI / 180;
    // Chest, not the eyes: the pivot handed in is head height.
    const chest = { x: pivot.x, y: pivot.y - this.pivotDrop - .3, z: pivot.z };
    // Interior probe: free height above the head (built structure only).
    let ceiling: number | null = null;
    for (let k = .5; k <= 4.5; k += .5) if (this.world.blocked(pivot.x, pivot.y + k, pivot.z)) { ceiling = k + .3; break; }
    const pose = a.update(t, { ...this.situation, pivot: chest, ceiling, engaged: this.mode === 'combat' || this.situation.engaged,
      focus: this.mode === 'combat' && this.lockPivot ? { point: this.lockPivot, weight: .3 } : null }, this.obstruct, (x, z) => this.world.ground(x, z));
    let { x: cx, y: cyv, z: cz } = pose.position;
    const fx = -Math.sin(a.renderedYaw), fz = -Math.cos(a.renderedYaw);
    if (this.shake > 0.001) { this.shakeT += t * 38; const k = this.shake * 0.06; cx += Math.sin(this.shakeT * 1.3) * k; cyv += Math.sin(this.shakeT * 1.7 + 1) * k * 0.8; cz += Math.cos(this.shakeT * 1.1) * k; this.shake *= Math.exp(-9 * t); }
    if (this.kick > 0.001) { cx += fx * this.kick * 0.5; cz += fz * this.kick * 0.5; this.kick *= Math.exp(-11 * t); }
    this.position.set(cx, cyv, cz); this.camera.position.copyFrom(this.position);
    this.fov = pose.fov; this.camera.fov = pose.fov; this.currentDistance = a.debug.dist;
    const tg = new Vector3(pose.target.x, pose.target.y, pose.target.z);
    this.camera.setTarget(tg);
    this.forward.copyFrom(tg.subtract(this.position).normalize());
  }
}
