/**
 * Tower spell VFX, live (dev server running): real casts in the Proving Hall (every element and form is known there).
 *   npx tsx scripts/web/tower-vfx.ts [--name tower-vfx] [--video]
 * - Bolt (slot 1, flame) at a training dummy -> 'hit'; into open floor -> 'expire'; slot 3 (storm) into a wall -> 'wall'.
 * - Nova (slot 4, frost): the drawn border's final outer radius vs the damage query radius 4.2.
 * - Field (slot 5, gravity): lasts its timer, then fades out (presentation) and its handle is gone.
 * Outcomes are recorded from Vfx.impactAt (the presentation adapter), never by changing mechanics.
 * Writes .debug/arena/<name>/report.json, screenshots, optional video; exits non-zero on a failed check or page error.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-vfx'), video = process.argv.includes('--video'), out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, ...(video ? { recordVideo: { dir: out, size: { width: 1100, height: 700 } } } : {}) });
const page = await ctx.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
const checks: { step: string; ok: boolean; detail?: unknown }[] = [];
const check = (step: string, ok: boolean, detail?: unknown) => { checks.push({ step, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const report: Record<string, unknown> = {};
const aimAt = async (p: Page, x: number, z: number) => { const s = await p.evaluate(([x, z]) => (window as any).__arena.screen(x, 0, z), [x, z]); await p.mouse.move(s.x, s.y); };
const cast = async (slot: number) => { await page.keyboard.press(`Digit${slot}`); };
const outcomes = () => page.evaluate(() => (window as any).__vfxLog.splice(0));
try {
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271`);
  await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
  await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world; a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
    const log: unknown[] = (window as any).__vfxLog = [], orig = w.vfx.impactAt.bind(w.vfx);
    w.vfx.impactAt = (e: string, at: any, outcome: string, dir: any, size: number) => { log.push({ e, outcome, at: [at.x, at.z] }); return orig(e, at, outcome, dir, size); };
    w.hero.mana = w.hero.maxMana = 9999; a.view(.5, -Math.PI * .25); a.zoom(9);
  });
  await page.mouse.click(550, 300); await page.waitForTimeout(400);
  // Line up on the nearest dummy, a few metres away.
  const dummy = await page.evaluate(() => { const w = (window as any).__arena.world, h = w.hero, d = w.fighters.filter((f: any) => f.foeKind === 'dummy').sort((a: any, b: any) => Math.hypot(a.pos.x - h.pos.x, a.pos.z - h.pos.z) - Math.hypot(b.pos.x - h.pos.x, b.pos.z - h.pos.z))[0];
    h.pos.set(d.pos.x, 0, d.pos.z - 6); h.yaw = 0; return { x: d.pos.x, z: d.pos.z }; });
  await page.waitForTimeout(1800); await outcomes();   // let the camera settle before projecting the cursor
  // 1. Bolt at the dummy: hit.
  await aimAt(page, dummy.x, dummy.z); await cast(1); await page.waitForTimeout(330);
  report.hitCast = await page.evaluate(() => { const w = (window as any).__arena.world, h = w.hero; return { hero: [h.pos.x, h.pos.z], state: h.state, cast: h.castDef?.name ?? null, cd0: w.skillCd[0], slot0: w.skills[0]?.name ?? null, missiles: w.missiles.map((m: any) => ({ pos: [m.pos.x, m.pos.z], vel: [m.vel.x, m.vel.z], e: m.e })), dummies: w.fighters.filter((f: any) => f.foeKind === 'dummy').map((f: any) => ({ pos: [f.pos.x, f.pos.z], standing: f.standing, state: f.state, team: f.team })) }; }); await page.screenshot({ path: join(out, '1-bolt-flight.png') }); await page.waitForTimeout(320); await page.screenshot({ path: join(out, '1-bolt-hit.png') });
  const o1 = await outcomes(); check('bolt at a dummy ends as a confirmed hit', o1.some((x: any) => x.outcome === 'hit'), o1);
  await page.waitForTimeout(2500);
  // 2. Bolt into open floor (away from the dummy and walls): expires at the end of its range.
  await page.evaluate(() => { const h = (window as any).__arena.world.hero; h.yaw = Math.PI; }); await page.waitForTimeout(600);
  const open = await page.evaluate(() => { const h = (window as any).__arena.world.hero; return { x: h.pos.x, z: h.pos.z - 10 }; });
  await aimAt(page, open.x, open.z); await cast(1); await page.waitForTimeout(1700); await page.screenshot({ path: join(out, '2-bolt-expire.png') });
  const o2 = await outcomes(); check('bolt into open space ends as an expiry (no hit accent)', o2.length > 0 && o2.every((x: any) => x.outcome === 'expire'), o2);
  await page.waitForTimeout(2500);
  await page.waitForTimeout(2500);
  // 4. Nova (slot 4): sample the footprint ring's outer radius while it lives; the final radius must equal 4.2.
  await page.evaluate(() => { const a = (window as any).__arena, sc = a.scene; (window as any).__ring = 0;
    const obs = sc.onAfterRenderObservable.add(() => { for (const m of sc.meshes) if (m.name === 'vfx-footprint' && !m.isDisposed()) { m.refreshBoundingInfo(); const bb = m.getBoundingInfo().boundingBox, r = (bb.maximumWorld.x - bb.minimumWorld.x) / 2; (window as any).__ring = Math.max((window as any).__ring, r); } });
    (window as any).__ringObs = obs; });
  await cast(4); await page.waitForTimeout(250); await page.screenshot({ path: join(out, '4-nova.png') }); await page.waitForTimeout(700);
  const ring = await page.evaluate(() => { const a = (window as any).__arena; a.scene.onAfterRenderObservable.remove((window as any).__ringObs); return (window as any).__ring; });
  check('nova border ends at the 4.2 damage query radius (no overshoot)', ring > 4.1 && ring <= 4.2 + 1e-3, { maxOuterRadius: ring });
  report.novaOuterRadius = ring;
  await page.waitForTimeout(2500);
  // 5. Gravity field (slot 5) at the dummy: lasts 7 s, then fades and is gone; its final burst stays.
  await aimAt(page, dummy.x, dummy.z); await cast(5); await page.waitForTimeout(600); await page.screenshot({ path: join(out, '5-field.png') });
  const live = await page.evaluate(() => (window as any).__arena.world.fields.length);
  await page.waitForFunction(() => (window as any).__arena.world.fields.length === 0, null, { timeout: 15_000 });
  await page.waitForTimeout(120); await page.screenshot({ path: join(out, '5-field-expiring.png') });
  const fading = await page.evaluate(() => (window as any).__arena.scene.meshes.filter((m: any) => m.name === 'vfx-field-disc' && !m.isDisposed()).map((m: any) => +m.visibility.toFixed(2)));
  await page.waitForTimeout(600);
  const gone = await page.evaluate(() => (window as any).__arena.scene.meshes.filter((m: any) => /^vfx-field/.test(m.name) && !m.isDisposed()).length);
  check('field lasts its timer, fades out after it ends, then its meshes are gone', live === 1 && fading.length === 1 && fading[0] < 1 && gone === 0, { live, fading, gone });
  // 6. Wall strike, on a real floor (floor-2 preview: non-persistent, foes frozen). The Proving Hall has no interior
  //    walls, and missiles stop on ruin walls only. HARNESS-DRIVEN: the bolt is launched through world.launch, the same
  //    call a bolt cast makes, aimed at the nearest wall.
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&floor=2&seed=918271`);
  await page.waitForFunction(() => { const a = (window as any).__arena; return !!a?.tower?.plan && !a.hud.modalOpen; }, null, { timeout: 300_000 });
  const wall = await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world, h = w.hero; w.freezeFoes = true; a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
    const log: unknown[] = (window as any).__vfxLog = [], orig = w.vfx.impactAt.bind(w.vfx);
    w.vfx.impactAt = (e: string, at: any, outcome: string, dir: any, size: number) => { log.push({ e, outcome, at: [at.x, at.z] }); return orig(e, at, outcome, dir, size); };
    let best: any = null;
    for (let k = 0; k < 16; k++) { const ang = k / 16 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
      for (let d = 1; d < 30; d += .25) if (w.cameraBlocked(h.pos.x + dx * d, 1.2, h.pos.z + dz * d)) { if (!best || d < best.d) best = { d, dx, dz }; break; } }
    if (!best) return null;
    h.yaw = Math.atan2(best.dx, best.dz); a.view(.45, h.yaw + Math.PI * .75); a.zoom(9);
    const V = h.pos.constructor, from = h.pos.add(new V(best.dx * .7, 1.2, best.dz * .7));
    w.launch(h, 'storm', from, new V(best.dx, 0, best.dz), 1, 20); return best;
  });
  if (!wall) check('bolt into a wall ends as a wall strike', false, 'no wall within 30 units');
  else { await page.waitForTimeout(Math.min(1300, wall.d / 26 * 1000 + 250)); await page.screenshot({ path: join(out, '3-bolt-wall.png') }); await page.waitForTimeout(400);
    const o3 = await outcomes(); check('bolt into a wall ends as a wall strike (harness-driven launch)', o3.some((x: any) => x.outcome === 'wall'), { o3, wall }); }
  if (video) report.video = await page.video()?.path();
} catch (e) { check('harness completed every step', false, String((e as Error).message)); await page.screenshot({ path: join(out, 'fail.png') }).catch(() => undefined); }
report.checks = checks; report.errors = errors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await ctx.close().catch(() => undefined); await browser.close().catch(() => undefined);
console.log(`tower vfx -> ${out} (${checks.filter(c => c.ok).length}/${checks.length} checks, ${errors.length} page errors)`);
process.exit(checks.every(c => c.ok) && !errors.length ? 0 : 1);
