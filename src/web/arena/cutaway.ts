/**
 * Wall cutaway test (pure): does a wall's footprint stand between the camera and the hero? The segment from the camera to
 * the hero is tested against the wall's box in the wall's own frame (slab method); the last 0.4 units before the hero are
 * ignored, so a wall the hero stands against on the far side, or merely beside, stays solid.
 * Box: centre (x, z), rotation yaw, half extents hx (across) and hz (along), as world.ts props store them.
 */
export interface CutBox { x: number; z: number; yaw: number; hx: number; hz: number }
export function blocksView(cam: { x: number; z: number }, hero: { x: number; z: number }, b: CutBox): boolean {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const ax = (cam.x - b.x) * c - (cam.z - b.z) * s, az = (cam.x - b.x) * s + (cam.z - b.z) * c;
  const bx = (hero.x - b.x) * c - (hero.z - b.z) * s, bz = (hero.x - b.x) * s + (hero.z - b.z) * c;
  const dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  for (const [o, d, e] of [[ax, dx, b.hx], [az, dz, b.hz]] as const) {
    if (Math.abs(d) < 1e-6) { if (Math.abs(o) > e) return false; continue; }
    let u = (-e - o) / d, v = (e - o) / d; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
  }
  return t0 <= t1 && t0 < 1 - .4 / Math.max(.5, Math.hypot(dx, dz));
}
