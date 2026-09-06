import * as THREE from 'three';
import type { Vec3 } from '../../sim/core/types';
import type { VoxelGrid } from '../../sim/physical/grid';
import { blockDef } from '../../sim/physical/blocks';

/**
 * The elevated third-person ("ARPG") camera (v0.10 Part V).
 *
 * This is PRESENTATION ONLY. It owns nothing but a yaw, a pitch, a distance and some smoothing;
 * it reads a focus point and the voxel grid and produces a camera transform. It never touches
 * canonical state, never decides what anyone does, and is deliberately not a second renderer —
 * the same `THREE.PerspectiveCamera`, the same scene, the same meshes as the immersive mode.
 *
 * The one piece of real work here is obstruction handling: an overhead-ish camera in a village
 * of solid voxel buildings spends a lot of its time with a roof between it and whoever it is
 * watching, so the camera is pulled in along its own boom until it has a clear line to the
 * focus — the same technique the existing third-person camera in `player/controller.ts` uses,
 * just over a longer boom and with a floor on how close it may come.
 */
export class ArpgCamera {
  /** Rotation about the world Y axis, radians. */
  yaw = Math.PI * 0.25;
  /** How far above the horizon the camera sits, radians. Clamped to a useful band. */
  pitch = 0.62;
  /** Boom length in blocks. */
  distance = 18;
  /** The point the camera is currently looking at — lerped toward the requested focus so that
   * following a walking person, or switching who is followed, glides instead of snapping. */
  private focus = new THREE.Vector3();
  private focused = false;

  static readonly MIN_DISTANCE = 6;
  static readonly MAX_DISTANCE = 52;
  static readonly MIN_PITCH = 0.22;   // ~13 degrees: almost level, for looking down a street
  static readonly MAX_PITCH = 1.45;   // ~83 degrees: very nearly straight down

  zoom(deltaY: number): void {
    const factor = Math.exp(deltaY * 0.0012);
    this.distance = Math.max(ArpgCamera.MIN_DISTANCE, Math.min(ArpgCamera.MAX_DISTANCE, this.distance * factor));
  }
  rotate(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(ArpgCamera.MIN_PITCH, Math.min(ArpgCamera.MAX_PITCH, this.pitch + dPitch));
  }
  /** Jump straight to a focus point without gliding — used when the mode is first entered. */
  snapTo(target: Vec3): void { this.focus.set(target.x, target.y + 1, target.z); this.focused = true; }

  /**
   * Place `camera` for this frame. `target` is what should be centred (the player, or whoever the
   * observer is following). Returns the world-space point actually being looked at, so callers
   * that need to unproject the cursor have the same reference the camera used.
   */
  /**
   * When the world is being drawn with its roof cut off above `roofCutY` (see
   * `VoxelRenderer.setRoofCut`), the boom must ignore the geometry that is no longer there —
   * otherwise the camera keeps politely refusing to pass through a roof the viewer cannot see,
   * and collapses to arm's length indoors. The same cut also steepens the boom, so it climbs out
   * of the room over the wall tops rather than pressing against them.
   */
  static readonly INDOOR_MIN_PITCH = 0.85;

  update(camera: THREE.PerspectiveCamera, target: Vec3, dt: number, grid: VoxelGrid, roofCutY: number | null = null): THREE.Vector3 {
    const desired = new THREE.Vector3(target.x, target.y + 1, target.z);
    if (!this.focused) { this.focus.copy(desired); this.focused = true; }
    // Frame-rate independent smoothing: the same fraction of the remaining distance per second,
    // however long the frame took.
    this.focus.lerp(desired, 1 - Math.pow(0.0025, Math.max(0.0001, dt)));

    const pitch = roofCutY === null ? this.pitch : Math.max(this.pitch, ArpgCamera.INDOOR_MIN_PITCH);
    const horizontal = Math.cos(pitch);
    const boom = new THREE.Vector3(Math.sin(this.yaw) * horizontal, Math.sin(pitch), Math.cos(this.yaw) * horizontal);
    let distance = this.distance;
    // Outdoors, pull in until the boom has a clear line. Indoors — where the roof is not being
    // drawn at all — do not pull in: the boom climbs out through the missing roof at a steep
    // angle and looks down into the room, and the only things it would have collided with on the
    // way are the roof (gone) and the room's own walls (which it passes over). Measured directly:
    // testing collisions here anyway pinned the camera at three blocks against whatever wall the
    // sleeper happened to be lying beside, which is a close-up of masonry, not an observation.
    if (roofCutY === null) {
      for (let d = 1.5; d <= this.distance; d += 0.5) {
        const p = this.focus.clone().addScaledVector(boom, d);
        if (blockDef(grid.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))).opaque) { distance = Math.max(3, d - 1); break; }
      }
    }
    camera.position.copy(this.focus.clone().addScaledVector(boom, distance));
    camera.lookAt(this.focus);
    return this.focus.clone();
  }

  /** A ray from the camera through a screen point in normalized device coordinates — this is what
   * makes the cursor, rather than a fixed crosshair, the thing that picks targets in this mode. */
  ray(camera: THREE.PerspectiveCamera, ndcX: number, ndcY: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    return { origin: camera.position.clone(), dir };
  }
}
