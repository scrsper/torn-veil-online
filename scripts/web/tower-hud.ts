/**
 * Tower HUD notifications: banner, achievement notice and toasts raised through the game's own paths on a real Tower
 * floor (a non-persistent floor preview: no expedition save is read or written), help collapsed, at two viewports.
 * Reports every overlap between a notification and the play HUD (HP frame, radar, skills, weapons, floor title,
 * combo, boss bar).
 *   npx tsx scripts/web/tower-hud.ts [--name tower-hud] [--legacy-css]
 * --legacy-css re-applies the earlier (central) notification rules over the current HUD, for before/after shots.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-hud'), legacy = process.argv.includes('--legacy-css');
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
// The notification rules as they were before the compact pass (hud.ts at 22211a0).
const LEGACY = `.ar-wave{left:50%;transform:translateX(-50%);text-align:center;max-width:none}.ar-wave b{font-size:26px}
.ar-banner{left:50%;top:22%;transform:translateX(-50%);max-width:none;padding:0;background:none;font:900 46px/1 "Segoe UI",sans-serif;letter-spacing:.12em;text-shadow:0 3px 0 #4a2b00,0 0 22px #000}
.ar-banner .s{font:900 16px/1 "Segoe UI",sans-serif;letter-spacing:.05em;margin-top:8px;color:#ffe6a8}
.ar-toasts{left:50%;bottom:110px;transform:translateX(-50%);gap:6px;align-items:center;max-width:none}
.ar-toast{padding:6px 14px;background:#0d1118d8;border-left-width:1px;border-radius:4px;font:600 14px "Segoe UI",sans-serif}
.ar-ach{left:50%;right:auto;top:150px;bottom:auto;transform:translateX(-50%);width:auto;min-width:380px;max-width:560px;background:#0b0f18f0;border-width:2px;border-radius:6px;padding:12px 18px;font:500 14px/1.4 "Segoe UI",sans-serif;box-shadow:0 0 30px #000}
.ar-ach h4{margin:0 0 2px;font:900 12px sans-serif;letter-spacing:.2em}.ar-ach h3{margin:0 0 4px;font:800 19px "Segoe UI",sans-serif}.ar-ach p{margin:0 0 6px}`;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const report: Record<string, unknown> = { legacy };
const errors: string[] = [], failures: string[] = [];
let aborted: string | null = null;
try {
  for (const [vw, vh] of [[760, 760], [1100, 700]] as const) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
    await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&seed=918271&floor=2`);
    await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind && !(window as any).__arena.hud.modalOpen, null, { timeout: 300_000 });
    if (legacy) await page.addStyleTag({ content: LEGACY });
    await page.evaluate(() => {
      const a = (window as any).__arena, t = a.tower, w = a.world; a.hud.showHelp(false); w.freezeFoes = true;
      // Real paths: the climb-start banner from start(), First Blood from the Tower's own achievement check, a pickup toast.
      t.stats.kills = Math.max(1, t.stats.kills); t.checkAchievements();
      t.take({ kind: 'weapon', id: 'qa-hud-blade', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 });
      a.hud.announce('FLOOR 2', `${t.plan.theme.name} · ${t.plan.objective}`);
    });
    await page.waitForTimeout(900);
    const shot = `hud-${vw}x${vh}.png`; await page.screenshot({ path: join(out, shot) });
    const layout = await page.evaluate(() => {
      const R = (sel: string) => [...document.querySelectorAll(sel)].filter(e => { const s = getComputedStyle(e as Element); return s.display !== 'none' && Number(s.opacity) > .05; }).map(e => (e as Element).getBoundingClientRect()).filter(r => r.width && r.height);
      const notes = { banner: R('.ar-banner'), achievement: R('.ar-ach'), toasts: R('.ar-toast') };
      const hud = { hpFrame: R('.ar-frame'), radar: R('.ar-radar'), skills: R('.ar-skills'), weapons: R('.ar-weapons'), floorTitle: R('.ar-wave'), combo: R('.ar-combo'), bossBar: R('.ar-boss') };
      // Every one of these must be on screen (no empty-element passes); combo and boss bar are only checked when shown.
      const required = { banner: notes.banner, achievement: notes.achievement, toasts: notes.toasts, hpFrame: hud.hpFrame, radar: hud.radar, skills: hud.skills, weapons: hud.weapons, floorTitle: hud.floorTitle };
      const missing = Object.entries(required).filter(([, v]) => !v.length).map(([k]) => k);
      const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const overlaps: string[] = [];
      for (const r of hud.floorTitle) for (const s of hud.hpFrame) if (hit(r, s)) overlaps.push('floorTitle x hpFrame');
      for (const [n, rs] of Object.entries(notes)) for (const r of rs) for (const [m, ss] of Object.entries(hud)) for (const s of ss) if (hit(r, s)) overlaps.push(`${n} x ${m}`);
      const kinds = Object.entries(notes);
      for (let i = 0; i < kinds.length; i++) for (let j = i + 1; j < kinds.length; j++) for (const r of kinds[i][1]) for (const s of kinds[j][1]) if (hit(r, s)) overlaps.push(`${kinds[i][0]} x ${kinds[j][0]}`);
      const box = (rs: DOMRect[]) => rs.map(r => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]);
      return { missing, overlaps, hud: Object.fromEntries(Object.entries(hud).map(([k, v]) => [k, box(v)])), notes: Object.fromEntries(Object.entries(notes).map(([k, v]) => [k, box(v)])), text: { banner: document.querySelector('.ar-banner')?.textContent, achievement: document.querySelector('.ar-ach')?.textContent, toasts: [...document.querySelectorAll('.ar-toast')].map(e => e.textContent) } };
    });
    report[`${vw}x${vh}`] = { shot, ...layout };
    console.log(`${vw}x${vh}: missing ${layout.missing.join(', ') || 'none'}; overlaps ${layout.overlaps.length ? [...new Set(layout.overlaps)].join(', ') : 'none'}`);
    if (layout.missing.length || layout.overlaps.length) failures.push(`${vw}x${vh}`);
    await ctx.close();
  }
} catch (e) { aborted = String((e as Error).message); }
report.errors = errors; report.failures = failures; report.aborted = aborted;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close().catch(() => undefined);
console.log(`tower HUD -> ${out} (${failures.length} failing viewports, ${errors.length} page errors${aborted ? ', aborted: ' + aborted : ''})`);
// The legacy (before) mode only records; the current HUD must be clean.
process.exit(!legacy && (failures.length || errors.length || aborted) ? 1 : 0);
