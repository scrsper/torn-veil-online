import { AdaptiveCamera } from '../game/adaptiveCamera';
import { loadSettings } from '../game/bindings';

/** Right-handed camera basis, shared by street exploration and the canonical Tower.
 * Input uses the rendered yaw so eased orbit never changes the visible movement basis. */
export function cameraRelativeMove(right: number, forward: number, yaw: number) {
  const length = Math.max(1, Math.hypot(right, forward));
  return { x: (right * Math.cos(yaw) - forward * Math.sin(yaw)) / length,
    z: (-forward * Math.cos(yaw) - right * Math.sin(yaw)) / length };
}
export const travelFacing = (move: { x: number; z: number }): number | undefined =>
  Math.hypot(move.x, move.z) > .001 ? Math.atan2(-move.x, -move.z) : undefined;
export const smoothYaw = (current: number, target: number, dt: number) =>
  current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * (1 - Math.exp(-24 * dt));

/** Elevated perspective, never fixed isometric. Wheel retains a wider range than
 * the previous Tower's 3..13 m, with the same shared adaptive obstruction/recovery. */
export function primaryCamera(view: 'realm' | 'tower', storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const camera = new AdaptiveCamera({ minDistance: 3, maxDistance: 18, maxExceptional: 24,
    minPitch: 8 * Math.PI / 180, maxPitch: 60 * Math.PI / 180 });
  camera.preset('wide'); camera.preferred = 10.5; camera.pitch = 38 * Math.PI / 180;
  camera.yaw = view === 'realm' ? Math.PI : 0;
  const key = `torn-veil.primary-camera.${view}.v1`;
  try {
    storage ??= globalThis.localStorage;
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && Number.isFinite(saved.yaw) && Math.abs(saved.yaw) <= Math.PI) camera.yaw = saved.yaw;
    if (saved && Number.isFinite(saved.pitch) && saved.pitch >= camera.limits.minPitch && saved.pitch <= camera.limits.maxPitch) camera.pitch = saved.pitch;
    if (saved && Number.isFinite(saved.distance) && saved.distance >= 3 && saved.distance <= 18) camera.preferred = saved.distance;
  } catch { /* Browser preferences cannot invalidate a canonical save. */ }
  const persist = () => { try { storage?.setItem(key, JSON.stringify({ yaw: camera.yaw, pitch: camera.pitch, distance: camera.preferred })); } catch { /* storage denied */ } };
  return { camera, persist };
}

/** MMB orbit reserves LMB/RMB for existing combat; never captures the pointer. */
export function attachOrbit(canvas: HTMLCanvasElement, camera: AdaptiveCamera, persist: () => void) {
  const settings = loadSettings(); let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { if (e.button === 1) { drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); } });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const sensitivity = settings.mouseSensitivity / 1000;
    camera.addLook((e.clientX - drag.x) * sensitivity, (e.clientY - drag.y) * sensitivity * (settings.invertY ? -1 : 1));
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', e => { if (e.button === 1) { drag = null; persist(); } });
  window.addEventListener('blur', () => { drag = null; });
  window.addEventListener('pointercancel', () => { drag = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) drag = null; });
  canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('wheel', e => { camera.zoom(Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 + .3)); persist(); e.preventDefault(); }, { passive: false });
}
