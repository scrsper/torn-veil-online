/**
 * Real keyboard traversal of a maze floor (dev server running): the hero walks from the start to the exit with actual
 * W/A/S/D key presses, chosen every 100 ms from the game's own route (world.navDir toward the exit, straight when clear)
 * relative to the camera, exactly as a player's keys map. Automation input, not human play; foes are frozen and moved away
 * (forced, labelled) so the route is about walls, not fights. Real movement collision decides where the hero can go.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-maze-walk.ts --name maze-walk [--floor 4] [--seed 918271]
 * Records: footage (frames/walk.mp4), positions, stuck intervals (< 0.3 u moved in 1.5 s while keys are held), the walls
 * the camera cut away (visibility < 0.5) and screenshots every few seconds. Exits non-zero if the exit is not reached.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startScreencast } from './screencast';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'maze-walk'), floor = Number(arg('floor', '4')), seed = Number(arg('seed', '918271'));
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 740 } })).newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&seed=${seed}&floor=${floor}&body=male`);
await page.waitForFunction(f => (window as any).__arena?.tower?.plan?.floor === f && (window as any).__arena.world.hero, floor, { timeout: 300_000 });
await page.waitForTimeout(1500);
// Forced setup: foes frozen and moved off the floor, HUD notices hidden.
await page.evaluate(() => { const a = (window as any).__arena, w = a.world; w.freezeFoes = true; for (const f of w.fighters) if (f.role === 'foe') f.pos.set(500, 0, 500); a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none'; a.view(.3, -Math.PI * .25); a.zoom(10); });
await page.mouse.move(600, 150);
const cast = await startScreencast(page, join(out, 'frames'));
const held = new Set<string>(), track: { t: number; x: number; z: number; keys: string; cut: number }[] = [];
const t0 = Date.now(); let reached = false, shot = 0;
while (Date.now() - t0 < 90_000) {
  const s = await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world, h = w.hero, plan = a.tower.plan, ex = plan.exit;
    const d = w.navDir(h.pos.x, h.pos.z, ex.x, ex.z) ?? (() => { const l = Math.hypot(ex.x - h.pos.x, ex.z - h.pos.z) || 1; return { x: (ex.x - h.pos.x) / l, z: (ex.z - h.pos.z) / l }; })();
    // The keyboard's camera-relative axes (arena.ts readInput).
    const yaw = a.cam.yaw, fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) }, right = { x: -fwd.z, z: fwd.x };
    const f = d.x * fwd.x + d.z * fwd.z, r = d.x * right.x + d.z * right.z;
    const keys = [f > .38 ? 'KeyW' : f < -.38 ? 'KeyS' : '', r > .38 ? 'KeyD' : r < -.38 ? 'KeyA' : ''].filter(Boolean);
    const cut = w.props.filter((p: any) => p.key === 'wall' && p.mesh.visibility < .5).length;
    return { x: h.pos.x, z: h.pos.z, dist: Math.hypot(ex.x - h.pos.x, ex.z - h.pos.z), keys, cut };
  });
  track.push({ t: (Date.now() - t0) / 1000, x: +s.x.toFixed(2), z: +s.z.toFixed(2), keys: s.keys.join('+'), cut: s.cut });
  if (s.dist < 2.6) { reached = true; break; }
  for (const k of [...held]) if (!s.keys.includes(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of s.keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  if ((Date.now() - t0) / 1000 > shot * 4) { await page.screenshot({ path: join(out, `walk-${String(shot).padStart(2, '0')}.png`) }); shot++; }
  await page.waitForTimeout(100);
}
for (const k of held) await page.keyboard.up(k);
await page.waitForTimeout(400); await page.screenshot({ path: join(out, 'walk-end.png') });
const footage = await cast.stop('walk.mp4');
// Stuck: under 0.3 units of travel over any 1.5 s window while keys were held.
const stuck: { from: number; to: number }[] = [];
for (let i = 0; i < track.length; i++) { const j = track.findIndex((p, k) => k > i && p.t - track[i].t >= 1.5); if (j < 0) break; if (track[i].keys && Math.hypot(track[j].x - track[i].x, track[j].z - track[i].z) < .3) stuck.push({ from: track[i].t, to: track[j].t }); }
const path = track.reduce((acc, p, i) => acc + (i ? Math.hypot(p.x - track[i - 1].x, p.z - track[i - 1].z) : 0), 0);
const report = { floor, seed, reached, seconds: track.length ? track[track.length - 1].t : 0, pathLength: +path.toFixed(1), stuckWindows: stuck.length, maxWallsCutAway: Math.max(0, ...track.map(p => p.cut)), framesWithCutaway: track.filter(p => p.cut > 0).length, samples: track.length, footage, errors, forced: ['foes frozen and moved off the floor', 'HUD notices hidden'] };
writeFileSync(join(out, 'report.json'), JSON.stringify({ ...report, track }, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(reached && !errors.length ? 0 : 1);
