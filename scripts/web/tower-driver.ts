import type { Page } from 'playwright';
/** Read-only route query; callers still use real keyboard/mouse input and game collision. */
export async function routeInput(page: Page, tx: number, tz: number) {
  return page.evaluate(([tx, tz]) => {
    const a = (window as any).__arena, w = a.world, h = w.hero;
    const dx = tx - h.pos.x, dz = tz - h.pos.z, distance = Math.hypot(dx, dz);
    const d = w.navDir(h.pos.x, h.pos.z, tx, tz) ?? { x: dx / (distance || 1), z: dz / (distance || 1) };
    const yaw = a.cam.yaw, f = -d.x * Math.sin(yaw) - d.z * Math.cos(yaw), r = d.x * Math.cos(yaw) - d.z * Math.sin(yaw);
    let visible = true;
    for (let n = 1; n < Math.ceil(distance / .3); n++) { const t = n / Math.ceil(distance / .3); if (w.cameraBlocked(h.pos.x + dx * t, 1.4, h.pos.z + dz * t)) { visible = false; break; } }
    return { distance, visible, keys: [f > .38 ? 'KeyW' : f < -.38 ? 'KeyS' : '', r > .38 ? 'KeyD' : r < -.38 ? 'KeyA' : ''].filter(Boolean) };
  }, [tx, tz]);
}
