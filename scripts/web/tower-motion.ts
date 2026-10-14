/**
 * Tower hero motion, live (dev server running): a real-input loop per body, the same camera every run.
 *   npx tsx scripts/web/tower-motion.ts --name motion-before [--body male|female|legacy] [--video]
 * Sequence (Proving Hall, far from the dummies): calm idle -> calm walk -> calm turns (W, W+D, D, S) -> calm run -> foe-near ready idle -> ready
 * walk -> ready turns (S, A, W) -> ready run -> guard -> light attack -> recovery -> dodge -> recovery -> calm again.
 * Per rendered frame it records the hero state, playing clip, trunk lean, knee flex, hand closure and feet, then reports
 * per segment:
 * - trunk lean / knee flex (deg)
 * - hand closure: angle (deg) between the middle finger's first and last segment, per hand (0 = straight, ~90+ = closed)
 * - stance-foot slide: horizontal speed of a foot the playing clip marks as planted, over consecutive frames of the
 *   SAME clip with no loop wrap (frame index must advance) and a normal frame time; discontinuities are counted apart.
 * Writes .debug/arena/<name>/report.json, a screenshot per segment and optionally a video.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startScreencast } from './screencast';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-motion'), body = arg('body', 'male'), video = process.argv.includes('--video'), frames = process.argv.includes('--frames');
const out = join(process.cwd(), '.debug/arena', `${name}-${body}`); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 720 }, ...(video ? { recordVideo: { dir: out, size: { width: 960, height: 720 } } } : {}) });
const page = await ctx.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
// --frames: real-input footage through Chrome's screencast, encoded with the system ffmpeg (scripts/web/screencast.ts).
let cast: Awaited<ReturnType<typeof startScreencast>> | null = null;
await page.addInitScript(nl => { (window as any).__name = (f: unknown) => f; (window as any).__nolock = nl; }, process.argv.includes('--nolock'));
const report: Record<string, unknown> = { body };
let failed: string | null = null;
try {
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=${body}`);
  await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
  await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world, h = w.hero;
    a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
    a.tower.take({ kind: 'weapon', id: 'qa-veilguard', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 });
    w.setWeapon(h, 'axe');
    // Clear floor: 14 units from the dummies' centroid, on the far side from the spawn; dummies frozen.
    w.freezeFoes = true; if ((window as any).__nolock) w.footLock = false;
    const ds = w.fighters.filter((f: any) => f.foeKind === 'dummy'), cx = ds.reduce((s: number, f: any) => s + f.pos.x, 0) / ds.length, cz = ds.reduce((s: number, f: any) => s + f.pos.z, 0) / ds.length;
    const dx = h.pos.x - cx, dz = h.pos.z - cz, l = Math.hypot(dx, dz) || 1; h.pos.set(cx + dx / l * 14, 0, cz + dz / l * 14); h.yaw = Math.atan2(dx, dz);
    // Same camera every run: fixed pitch, yaw and distance relative to the world.
    a.view(.22, -Math.PI * .25); a.zoom(6);
    const rows: any[] = (window as any).__rows = []; (window as any).__seg = 'setup';
    const deg = (r: number) => r * 180 / Math.PI;
    const P = (n: string) => { const x = h.inst.bones.get(n); x.computeWorldMatrix(true); return x.getAbsolutePosition().clone(); };
    const ang = (u: any, v: any) => { const lu = u.length(), lv = v.length(); return lu && lv ? deg(Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y + u.z * v.z) / (lu * lv))))) : 0; };
    a.scene.onAfterRenderObservable.add(() => {
      const d = h.anim.dominant(), tpl = d && w.assets.clipsFor(h.inst.root.metadata?.look).get(d.name);
      const fi = tpl ? Math.round(d.frame) : -1, contact = tpl?.contact ? [tpl.contact[0][Math.max(0, Math.min(tpl.frames - 1, fi))], tpl.contact[1][Math.max(0, Math.min(tpl.frames - 1, fi))]] : [null, null];
      const pel = P('pelvis'), neck = P('neck_01'), up = neck.subtract(pel);
      const closure = (s: string) => ang(P(`middle_02_${s}`).subtract(P(`middle_01_${s}`)), P(`middle_03_${s}`).subtract(P(`middle_02_${s}`))) + ang(P(`middle_01_${s}`).subtract(P(`hand_${s}`)), P(`middle_02_${s}`).subtract(P(`middle_01_${s}`)));
      const knee = (s: string) => 180 - ang(P(`thigh_${s}`).subtract(P(`calf_${s}`)), P(`foot_${s}`).subtract(P(`calf_${s}`)));
      const feet = ['l', 'r'].map(s => { const p = P(`foot_${s}`); return [p.x, p.y - h.y, p.z]; });
      rows.push({ t: w.time, dt: a.scene.getEngine().getDeltaTime() / 1000, seg: (window as any).__seg, state: h.state, relaxed: h.relaxed, sheathed: h.sheathed, clip: d?.name ?? '', frame: fi, contact,
        lean: deg(Math.acos(Math.max(-1, Math.min(1, up.y / up.length())))), kneeL: knee('l'), kneeR: knee('r'), closeL: closure('l'), closeR: closure('r'), feet, root: [h.pos.x, h.pos.z], yaw: h.yaw,
        // Diagnostics: blend weights and the foot-plant locks (gap = locked point to the animated foot, m).
        w: Object.fromEntries([...(h.anim as any).active].map(([n, x]: [string, any]) => [n, +x.w.toFixed(2)])),
        plant: ((w as any).plants?.get(h)?.feet ?? []).map((L: any, k: number) => L.pin ? [L.mode, +Math.hypot(L.pin.x - feet[k][0], L.pin.z - feet[k][2]).toFixed(2)] : null) });
    });
  });
  const seg = (s: string) => page.evaluate(x => { (window as any).__seg = x; }, s);
  const shot = (s: string) => page.screenshot({ path: join(out, `${s}.png`) });
  const keys = async (ks: string[], ms: number, s: string) => { await seg(s); for (const k of ks) await page.keyboard.down(k); await page.waitForTimeout(ms / 2); await shot(s); await page.waitForTimeout(ms / 2); for (const k of ks) await page.keyboard.up(k); };
  const hold = async (ms: number, s: string) => { await seg(s); await page.waitForTimeout(ms / 2); await shot(s); await page.waitForTimeout(ms / 2); };
  await page.mouse.move(480, 200);
  if (frames) cast = await startScreencast(page, join(out, 'frames'));
  // Calm: wait until relaxed (weapon slung).
  await page.waitForFunction(() => (window as any).__arena.world.hero.relaxed, null, { timeout: 20_000 });
  await hold(1600, '01-calm-idle');
  await keys(['KeyW'], 1600, '02-calm-walk');
  // Turns under real input (movement is camera-relative): forward, diagonal, side, then a reversal.
  await seg('02b-calm-turn'); await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.down('KeyD'); await page.waitForTimeout(500);
  await page.keyboard.up('KeyW'); await page.waitForTimeout(500); await shot('02b-calm-turn'); await page.keyboard.up('KeyD'); await page.keyboard.down('KeyS'); await page.waitForTimeout(700); await page.keyboard.up('KeyS');
  await keys(['KeyW', 'ShiftLeft'], 1600, '03-calm-run');
  await hold(800, '03b-calm-stop');
  // Foe near (the alert the game gives within 9 m of a foe), held for the ready segments.
  await page.evaluate(() => { const w = (window as any).__arena.world; w.hero.alertT = 1e9; });
  await page.keyboard.press('KeyF'); await page.waitForTimeout(150);
  await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; });
  await hold(1600, '04-ready-idle');
  await keys(['KeyS'], 1600, '05-ready-walk');
  await seg('05b-ready-turn'); await page.keyboard.down('KeyS'); await page.waitForTimeout(400); await page.keyboard.up('KeyS'); await page.keyboard.down('KeyA'); await page.waitForTimeout(500); await shot('05b-ready-turn');
  await page.keyboard.up('KeyA'); await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
  await keys(['KeyS', 'ShiftLeft'], 1600, '06-ready-run');
  await hold(600, '06b-ready-stop');
  await keys(['KeyF'], 1400, '07-guard');
  // Let guard end first, so the click is a light attack (in guard it would be the shield bash).
  await page.waitForFunction(() => (window as any).__arena.world.hero.state !== 'guard', null, { timeout: 5000 }); await page.waitForTimeout(200);
  await seg('08-attack'); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(250); await shot('08-attack'); await page.waitForTimeout(600);
  await hold(1200, '09-recover');
  await seg('10-dodge'); await page.keyboard.down('KeyW'); await page.keyboard.press('Space'); await page.waitForTimeout(250); await shot('10-dodge'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
  await hold(1200, '11-recover');
  await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 0; });
  await page.waitForFunction(() => (window as any).__arena.world.hero.relaxed, null, { timeout: 10_000 });
  await hold(1200, '12-calm-again');
  const rows: any[] = await page.evaluate(() => (window as any).__rows);
  const segs: Record<string, any> = {};
  const q = (v: number[], p: number) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], p = rows[i - 1], S = segs[r.seg] ??= { frames: 0, clips: {} as Record<string, number>, states: {} as Record<string, number>, lean: [] as number[], knee: [] as number[], closeL: [] as number[], closeR: [] as number[], slide: [] as number[], discontinuities: { clipChange: 0, loopWrap: 0, frameTime: 0 } };
    S.frames++; S.clips[r.clip] = (S.clips[r.clip] ?? 0) + 1; S.states[r.state] = (S.states[r.state] ?? 0) + 1;
    S.lean.push(r.lean); S.knee.push(Math.max(r.kneeL, r.kneeR)); S.closeL.push(r.closeL); S.closeR.push(r.closeR);
    // Foot pops, independent of any contact flags: a foot moving > 0.3 m in one normal frame beyond the root's own move.
    if (r.dt > 0 && r.dt < .05) for (const k of [0, 1]) {
      const fm = Math.hypot(r.feet[k][0] - p.feet[k][0], r.feet[k][2] - p.feet[k][2]), rm = Math.hypot(r.root[0] - p.root[0], r.root[1] - p.root[1]);
      if ((fm - rm) / 1.22 > .3) (S.pops ??= []).push(+((fm - rm) / 1.22).toFixed(2));
    }
    if (r.clip !== p.clip) { S.discontinuities.clipChange++; continue; }
    if (r.frame < p.frame) { S.discontinuities.loopWrap++; continue; }
    if (!(r.dt > 0 && r.dt < .05)) { S.discontinuities.frameTime++; continue; }
    for (const k of [0, 1]) if (r.contact[k] === 1 && p.contact[k] === 1) S.slide.push(Math.hypot(r.feet[k][0] - p.feet[k][0], r.feet[k][2] - p.feet[k][2]) / r.dt / 1.22);
  }
  report.segments = Object.fromEntries(Object.entries(segs).map(([k, S]: [string, any]) => [k, {
    frames: S.frames, clips: S.clips, states: S.states, discontinuities: S.discontinuities, footPops_over_0_3m: S.pops ?? [],
    leanDeg: { median: q(S.lean, .5), max: q(S.lean, 1) }, kneeFlexMaxDeg: { median: q(S.knee, .5) },
    handClosureDeg: { left: q(S.closeL, .5), right: q(S.closeR, .5) },
    stanceSlide_mps: { samples: S.slide.length, median: q(S.slide, .5), p90: q(S.slide, .9), max: q(S.slide, 1), over_0_5: S.slide.filter((v: number) => v > .5).length },
  }]));
  if (video) report.video = await page.video()?.path();
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows));
} catch (e) { failed = String((e as Error).message); await page.screenshot({ path: join(out, 'fail.png') }).catch(() => undefined); }
if (cast) report.footage = await cast.stop(`motion-${body}.mp4`);
report.errors = errors; report.failed = failed;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await ctx.close().catch(() => undefined); await browser.close().catch(() => undefined);
console.log(JSON.stringify(Object.fromEntries(Object.entries((report.segments ?? {}) as Record<string, any>).map(([k, s]) => [k, `${Object.keys(s.states).join('/')} | ${Object.entries(s.clips).sort((a: any, b: any) => b[1] - a[1])[0]?.[0]} | lean ${s.leanDeg.median}/${s.leanDeg.max} knee ${s.kneeFlexMaxDeg.median} | closeL ${s.handClosureDeg.left} closeR ${s.handClosureDeg.right} | slide n${s.stanceSlide_mps.samples} med ${s.stanceSlide_mps.median} p90 ${s.stanceSlide_mps.p90} max ${s.stanceSlide_mps.max} | pops ${s.footPops_over_0_3m.length ? s.footPops_over_0_3m.join(',') : 0} | disc ${JSON.stringify(s.discontinuities)}`])), null, 1));
console.log(`-> ${out} errors ${errors.length}${failed ? ' FAILED ' + failed : ''}`);
process.exit(failed || errors.length ? 1 : 0);
