/**
 * Third-person camera review in the disposable town (and gym for combat). Real keyboard input for movement;
 * orbit and zoom go through the same rig entry points the mouse and wheel use (pointer lock cannot be driven
 * reliably by synthetic relative motion). Writes screenshots and a camera telemetry JSON per shot.
 *
 * Needs the combat-gym server on :7505 (town scenario) and `vite --config vite.web.config.ts` on :5180 with
 * TV_WEB_GATEWAY_PORT=7505.
 *   npx tsx scripts/web/camera-pass.ts [--name camera] [--only default,walk]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const out = join(process.cwd(), '.debug/web', flag('name', 'camera')); mkdirSync(out, { recursive: true });
const only = new Set(flag('only', '').split(',').filter(Boolean));
const W = 1600, H = 900;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--window-size=${W + 16},${H + 130}`] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });

const control = (body: object) => fetch(`${flag('host', 'http://127.0.0.1:5180')}/api/gym/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
async function open(scenario: 'town' | 'gym', extra = ''): Promise<void> {
  await control({ action: 'switch', scenario });
  await page.goto(`${flag('host', 'http://127.0.0.1:5180')}/?gym=1&scenario=${scenario}&autoplay=1&view=third-person&hour=11${extra}`);
  await page.waitForFunction(() => (window as any).__tv?.ready === true, undefined, { timeout: 300_000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(W / 2, H / 2);
}
/** Camera telemetry: distance, height over the pivot, pitch, fov, and the player's on-screen height share. */
const telemetry = (p: Page) => p.evaluate(() => {
  const tv = (window as any).__tv, r = tv.rig, cam = tv.camera, vis = tv.predictor.visual(), o = tv.regions.origin;
  if (!vis) return null;
  const foot = { x: vis.pos.x - o.x, y: vis.pos.y - o.y, z: vis.pos.z - o.z };
  const BV = (window as any).BABYLON;
  const eng = tv.ctx.engine, scene = tv.ctx.scene;
  const proj = (y: number) => { const m = scene.getTransformMatrix(), v = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const V = cam.position.constructor; return V.Project(new V(foot.x, foot.y + y, foot.z), m.constructor.Identity(), m, v); };
  const a = proj(0), b = proj(1.75);
  void BV;
  const dx = cam.position.x - foot.x, dz = cam.position.z - foot.z;
  return { dist: +Math.hypot(dx, cam.position.y - foot.y - 1.4, dz).toFixed(2), flat: +Math.hypot(dx, dz).toFixed(2), height: +(cam.position.y - foot.y).toFixed(2),
    pitchDeg: +(r.pitch * 180 / Math.PI).toFixed(1), fovDeg: +(cam.fov * 180 / Math.PI).toFixed(1), playerScreenShare: +((a.y - b.y) / eng.getRenderHeight()).toFixed(3),
    playerScreenY: +(a.y / eng.getRenderHeight()).toFixed(3), mode: r.mode, state: r.adaptive?.debug ? { ...r.adaptive.debug } : null };
});
const shots: Record<string, unknown> = {};
async function shot(name: string): Promise<void> {
  await page.screenshot({ path: join(out, `${name}.png`) });
  shots[name] = await telemetry(page); console.log(name, JSON.stringify(shots[name]));
}
const hold = async (keys: string[], ms: number) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const look = (dx: number, dy: number) => page.evaluate(([x, y]) => (window as any).__tv.rig.addLook(x, y), [dx, dy]);
const zoom = (d: number) => page.evaluate(x => (window as any).__tv.rig.zoom(x), d);
const want = (n: string) => !only.size || only.has(n);

await open('town');
if (want('default')) { await shot('1-default'); }
if (want('walk')) {
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1600); await shot('2-walking'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1400); await shot('2b-sprint'); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  await hold(['KeyW', 'KeyD'], 1200); await page.waitForTimeout(500); await shot('2c-diagonal-settled');
}
if (want('orbit')) {
  for (let i = 0; i < 12; i++) { await look(.13, 0); await page.waitForTimeout(40); }
  await page.waitForTimeout(400); await shot('3-orbit-stationary');
  await page.keyboard.down('KeyW'); for (let i = 0; i < 20; i++) { await look(-.05, 0); await page.waitForTimeout(50); } await shot('3b-orbit-moving'); await page.keyboard.up('KeyW');
}
/** Walk (real W key) toward a world point: face the camera at it, hold W until within `stop` m or timeout. */
async function walkTo(x: number, z: number, stop: number, maxMs = 25_000): Promise<boolean> {
  const t0 = Date.now(); await page.keyboard.down('KeyW');
  try {
    while (Date.now() - t0 < maxMs) {
      const d = await page.evaluate(([x, z]) => { const tv = (window as any).__tv, p = tv.predictor.predicted.pos; const dx = x - p.x, dz = z - p.z; tv.rig.yaw = Math.atan2(-dx, -dz); return Math.hypot(dx, dz); }, [x, z]);
      if (d < stop) return true; await page.waitForTimeout(120);
    }
    return false;
  } finally { await page.keyboard.up('KeyW'); }
}
if (want('npcs')) {
  // The densest group of people: the person with the most neighbours within 10 m.
  const g = await page.evaluate(() => { const tv = (window as any).__tv, c = tv.candidates().filter((c: any) => c.kind === 'person' && !c.dead);
    let best = null, bn = -1; for (const a of c) { const n = c.filter((b: any) => Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 10).length; if (n > bn) { bn = n; best = a; } }
    return best ? { x: best.pos.x, z: best.pos.z, n: bn, total: c.length } : null; });
  console.log('group', JSON.stringify(g));
  if (g) { await walkTo(g.x, g.z, 7);
    // People further in come into the snapshot as we approach: follow the densest group a few times.
    for (let k = 0; k < 3; k++) { const n = await page.evaluate(() => { const tv = (window as any).__tv, p = tv.predictor.predicted.pos, c = tv.candidates().filter((c: any) => c.kind === 'person' && !c.dead && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 9); let best = null, bn = -1; for (const a of c) { const m = c.filter((b: any) => Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 10).length; if (m > bn) { bn = m; best = a; } } return best ? { x: best.pos.x, z: best.pos.z, n: bn } : null; }); console.log('next group', JSON.stringify(n)); if (!n) break; await walkTo(n.x, n.z, 6, 20_000); }
    await page.waitForTimeout(700); await shot('4-npcs');
    await look(.9, 0); await page.waitForTimeout(700); await shot('4b-npcs-side'); }
}
if (want('crowd')) {
  // The densest cluster of people (centroid of everyone within 12 m of the best-connected person): walk near it and face it.
  const cl = await page.evaluate(() => { const tv = (window as any).__tv, c = tv.candidates().filter((c: any) => c.kind === 'person' && !c.dead);
    let best: any[] = []; for (const a of c) { const m = c.filter((b: any) => Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) < 12); if (m.length > best.length) best = m; }
    if (!best.length) return null; const x = best.reduce((s: number, b: any) => s + b.pos.x, 0) / best.length, z = best.reduce((s: number, b: any) => s + b.pos.z, 0) / best.length; return { x, z, n: best.length, total: c.length }; });
  console.log('crowd', JSON.stringify(cl));
  if (cl) { await walkTo(cl.x, cl.z, 8, 40_000); await page.evaluate(([x, z]) => { const tv = (window as any).__tv, p = tv.predictor.predicted.pos; tv.rig.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }, [cl.x, cl.z]);
    await page.waitForTimeout(1500); await shot('4d-crowd');
    const seen = await page.evaluate(() => { const tv = (window as any).__tv, p = tv.predictor.predicted.pos; return tv.candidates().filter((c: any) => c.kind === 'person' && !c.dead && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < 20).length; }); console.log('people within 20 m', seen); }
}
if (want('zoom')) {
  for (let i = 0; i < 30; i++) await zoom(1); await page.waitForTimeout(1500); await shot('6-max-zoom');
  for (let i = 0; i < 30; i++) await zoom(-1); await page.waitForTimeout(1500); await shot('6b-min-zoom');
  for (let i = 0; i < 9; i++) await zoom(1); await page.waitForTimeout(1500); await shot('6c-restored');
}
if (want('obstruct')) {
  // Find the nearest built wall at chest height (the same structure query the camera uses), walk up to it,
  // then swing the camera so it would sit inside/behind the wall, and orbit back out.
  const wall = await page.evaluate(() => { const tv = (window as any).__tv, o = tv.regions.origin, p = tv.predictor.predicted.pos, W = tv.rig.world;
    for (let r = 3; r < 40; r += 1) for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2, x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (W.blocked(x - o.x, p.y - o.y + 1.4, z - o.z)) return { x, z, r }; }
    return null; });
  console.log('wall', JSON.stringify(wall));
  if (wall) {
    await walkTo(wall.x, wall.z, 1.6, 30_000);
    const p = await page.evaluate(() => { const v = (window as any).__tv.predictor.predicted.pos; return { x: v.x, z: v.z }; });
    // Camera back direction toward the wall: forward = (-sin yaw, -cos yaw), so back = (sin, cos).
    const yaw = Math.atan2(wall.x - p.x, wall.z - p.z);
    await page.evaluate(y => { (window as any).__tv.rig.yaw = y; }, yaw); await page.waitForTimeout(250); await shot('5-obstructed');
    await page.waitForTimeout(900); await shot('5b-obstructed-settled');
    for (let i = 0; i < 16; i++) { await look(.1, 0); await page.waitForTimeout(70); if (i === 7) await shot('5c-orbiting-out'); }
    await page.waitForTimeout(1200); await shot('5d-recovered');
    // Away from the wall: walk out toward whatever lies in front (the square, in the town fixture) and look at the crowd.
    await page.evaluate(y => { (window as any).__tv.rig.yaw = y; }, yaw); await hold(['KeyW'], 4200); await page.waitForTimeout(900); await shot('4c-square-crowd');
    // Frame time while walking among people (the camera's obstruction queries run every frame).
    await page.evaluate(() => { const r = (window as any).__tv.rig, u = r.update.bind(r); (window as any).__camCost = { t: 0, n: 0 }; r.update = (...x: unknown[]) => { const t0 = performance.now(); u(...x); const c = (window as any).__camCost; c.t += performance.now() - t0; c.n++; }; });
    const ft = await page.evaluate(async () => { const d: number[] = []; let last = performance.now(); await new Promise<void>(r => { const f = (t: number) => { d.push(t - last); last = t; d.length < 180 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); d.sort((a, b) => a - b); const c = (window as any).__camCost; return { median: +d[90].toFixed(1), p95: +d[171].toFixed(1), cameraMsPerFrame: +(c.t / Math.max(1, c.n)).toFixed(3) }; });
    console.log('frame ms', JSON.stringify(ft)); shots['frameMs'] = ft;
  }
}
if (want('combat')) {
  await open('gym');
  await page.waitForTimeout(800); await shot('7-combat-start');
  await hold(['KeyW'], 1500); await page.mouse.click(W / 2, H / 2); await page.waitForTimeout(300); await page.mouse.click(W / 2, H / 2); await page.waitForTimeout(700); await shot('7b-combat');
}
writeFileSync(join(out, 'telemetry.json'), JSON.stringify({ shots, errors }, null, 1));
console.log(JSON.stringify({ errors }));
await browser.close();
