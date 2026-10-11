/**
 * Matched floor screenshots (dev server running): the same floors, seed, body and camera every run, for before/after
 * environment review.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-scenes.ts --name scenes-before [--floors 0,4,16]
 * Per floor: a gameplay view (default camera at the start), a wide establishing view, and a close character view.
 * Foes are frozen so the frames are comparable. Page errors and console rendering errors (shader/WebGL) are recorded and
 * fail the run, as does a floor that is not renderable (env-floor mesh, ready material, non-blank albedo). Writes .debug/arena/<name>/floor<N>-<view>.png and report.json.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-scenes'), body = arg('body', 'male');
const floors = arg('floors', '0,4,16,31,46,61,76,91').split(',').map(Number);
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const host = process.env.ARENA_HOST ?? 'http://127.0.0.1:5180';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const report: Record<string, unknown> = { body, floors, errors: [] as string[], console: [] as string[] };
for (const fl of floors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage(); page.on('pageerror', e => (report.errors as string[]).push(`floor ${fl}: ${String(e)}`));
  // Shader compile/link failures and WebGL errors only reach the console (a failed effect renders nothing, no pageerror).
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && /shader|webgl|effect|compil|uniform|varying/i.test(t))) (report.console as string[]).push(`floor ${fl} [${m.type()}]: ${t.slice(0, 400)}`); });
  await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
  await page.goto(`${host}/?arena=1&tower=1&seed=918271&body=${body}&${fl === 0 ? 'hall=1' : `floor=${fl}`}`);
  await page.waitForFunction(f => (window as any).__arena?.tower?.plan?.floor === f && (window as any).__arena.world.hero, fl, { timeout: 300_000 });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world; a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
    w.freezeFoes = true;
    // Which lights each material actually binds: the first N ENABLED light sources, in Babylon's order.
    const bound = (m: any, n: number) => (m?.lightSources ?? []).filter((l: any) => l.isEnabled()).slice(0, n).map((l: any) => l.name);
    const heroMesh = w.hero.inst.meshes.find((m: any) => m.material && m.isVisible), floorMesh = a.scene.getMeshByName('env-floor');
    return { kind: a.tower.plan.kind, theme: a.tower.plan.theme.name, meshes: a.scene.meshes.length, lights: a.scene.lights.length, draw: a.scene.getActiveMeshes().length,
      heroLights: bound(heroMesh, heroMesh?.material?.maxSimultaneousLights ?? 4), heroMax: heroMesh?.material?.maxSimultaneousLights, floorLights: bound(floorMesh, floorMesh?.material?.maxSimultaneousLights ?? 8) };
  });
  const views: [string, () => Promise<void>][] = [
    ['play', async () => { await page.evaluate(() => { const a = (window as any).__arena; a.view(.22, -Math.PI * .25); a.zoom(8); }); }],
    ['wide', async () => { await page.evaluate(() => { const a = (window as any).__arena; a.view(.5, -Math.PI * .2); a.zoom(26); }); }],
    ['close', async () => { await page.evaluate(() => { const a = (window as any).__arena; a.view(.12, Math.PI * .85); a.zoom(4.2); }); }],
  ];
  for (const [v, set] of views) { await set(); await page.waitForTimeout(900); await page.screenshot({ path: join(out, `floor${fl}-${v}.png`) }); }
  // Frame rate and enabled lights at the gameplay view (rendered frames counted over 3 s in this headed window).
  await views[0][1]();
  const perf = await page.evaluate(() => new Promise<{ fps: number; enabledLights: number }>(res => { const a = (window as any).__arena, t0 = performance.now(); let n = 0; const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res({ fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1), enabledLights: a.scene.lights.filter((l: any) => l.isEnabled()).length }); }; requestAnimationFrame(tick); }));
  // Floor readiness: the env-floor mesh, a ready material, and an albedo texture that is ready and not blank (a cloned
  // DynamicTexture once rendered as flat grey with no error anywhere). Pixel variance is read back from the GPU texture.
  const floorCheck = await page.evaluate(async () => {
    const a = (window as any).__arena, m = a.scene.getMeshByName('env-floor'); if (!m) return { ok: false, reason: 'no env-floor mesh' };
    const mat = m.material, tex = mat?.albedoTexture; if (!mat || !mat.isReady(m)) return { ok: false, reason: 'floor material not ready' };
    if (!tex || !tex.isReady()) return { ok: false, reason: 'albedo texture missing or not ready' };
    const px = await tex.readPixels(); if (!px) return { ok: false, reason: 'albedo pixels unreadable' };
    const d = px as Uint8Array, n = Math.floor(d.length / 4), step = Math.max(1, Math.floor(n / 4096)); let sum = 0, sq = 0, k = 0;
    for (let i = 0; i < n; i += step) { const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765; sum += l; sq += l * l; k++; }
    const mean = sum / k, variance = sq / k - mean * mean;
    return { ok: variance > 1e-4, reason: variance > 1e-4 ? 'ok' : 'albedo is blank (no variation)', texture: tex.name, size: tex.getSize(), mean: +mean.toFixed(3), variance: +variance.toFixed(5) };
  });
  if (!floorCheck.ok) (report.errors as string[]).push(`floor ${fl}: floor not renderable: ${floorCheck.reason}`);
  report[`floor${fl}`] = { ...info, ...perf, floorCheck };
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
if ((report.errors as string[]).length || (report.console as string[]).length) process.exitCode = 1;
