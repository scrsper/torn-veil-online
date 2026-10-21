/** Third-person RPG camera math (pure; presentation only). The camera orbits a pivot near the
 * player's head, offset over the right shoulder. Yaw 0 looks toward +z. Pitch > 0 looks down.
 * Collision: the boom is cut short where a ray from the pivot hits geometry, minus a probe
 * radius, and never extends instantly back out (it eases), so walls never clip into view. */
export const PITCH_MIN = -.35, PITCH_MAX = 1.25, ZOOM_MIN = 1.6, ZOOM_MAX = 16, PROBE = .3, NEAR_MIN = .45;
export const SHOULDER = .55, PIVOT_HEIGHT = 1.62;
export interface Orbit { yaw: number; pitch: number; zoom: number }
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function clampPitch(p: number): number { return clamp(p, PITCH_MIN, PITCH_MAX); }
export function clampZoom(z: number): number { return clamp(z, ZOOM_MIN, ZOOM_MAX); }
/** Apply a mouse drag (pixels) and wheel (delta units) to the orbit. */
export function orbitInput(o: Orbit, dx: number, dy: number, wheel: number, sensitivity = .005): Orbit {
  return { yaw: o.yaw - dx * sensitivity, pitch: clampPitch(o.pitch + dy * sensitivity), zoom: clampZoom(o.zoom * Math.exp(wheel * .0012)) };
}
/** Unit vector from the pivot to the camera for a given orbit. */
export function boomDirection(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}
/** The shoulder pivot: head height, shifted to the player's right of the camera's view, scaled
 * down when zoomed far out (the shoulder framing matters close up). */
export function shoulderPivot(px: number, py: number, pz: number, yaw: number, zoom: number): [number, number, number] {
  const k = SHOULDER * clamp(1.2 - zoom / 12, .25, 1);
  return [px - Math.cos(yaw) * k, py + PIVOT_HEIGHT, pz + Math.sin(yaw) * k];
}
/** Distance the boom may extend given the nearest hit along it (null = clear). */
export function collideBoom(want: number, hit: number | null): number {
  if (hit === null) return want; return clamp(hit - PROBE, NEAR_MIN, want);
}
/** Ease the current boom length toward the allowed one: in at once (never show a wall), out slowly. */
export function easeBoom(current: number, allowed: number, dt: number): number {
  if (allowed <= current) return allowed;
  return current + (allowed - current) * (1 - Math.exp(-dt * 3.5));
}
/** Exponential smoothing for the follow target (frame-rate independent). */
export function follow(current: number, target: number, dt: number, rate = 12): number { return current + (target - current) * (1 - Math.exp(-dt * rate)); }
