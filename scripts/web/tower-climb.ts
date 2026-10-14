/**
 * Tower of Chrysanthus climb bot: real mouse/keyboard input against ?arena=1&tower=1 (dev server running).
 * Fights the nearest foe, walks through the door when it opens, takes boons/level-ups, records floors,
 * loot, classes and errors. Automation evidence, not a human playtest.
 *   npx tsx scripts/web/tower-climb.ts [--name climb] [--seconds 150] [--seed 7] [--video]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeInput } from './tower-driver';
import { startScreencast } from './screencast';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'climb'), seconds = Number(arg('seconds', '150')), seed = arg('seed', '7');
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const W = 1280, H = 720;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W + 16},${H + 130}`] });
// --video records native browser frames using the already installed ffmpeg.
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; try { localStorage.removeItem('tv.tower.codex.v1'); } catch { } });
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&seed=${seed}${process.argv.includes('--floor') ? `&floor=${arg('floor', '1')}` : ''}`);
await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 240_000 });
await page.evaluate(() => (window as any).__arena.hud.toggleHelp());
await page.mouse.click(W / 2, H / 2 - 100);
const capture = process.argv.includes('--video') ? await startScreencast(page, join(out, 'frames'), { everyNthFrame: 2 }) : null;

type S = { fps: number; floor: number; kind: string; open: boolean; shrine: boolean; boon: boolean; hero: { x: number; z: number; hp: number }; exit: { x: number; z: number }; shrinePos?: { x: number; z: number };
  foes: { x: number; z: number; state: string }[]; tier: string; cls: string; level: number; gear: string[]; skills: string[]; essences: string[]; scrolls: number; achievements: string[]; armor: string | null; over: boolean; loot: { x: number; z: number }[] };
const state = (p: Page) => p.evaluate(() => {
  const a = (window as any).__arena, t = a.tower, w = a.world;
  return { fps: a.scene.getEngine().getFps(), floor: t.floor, kind: t.plan.kind, open: t.doorOpen, shrine: t.shrineReady, boon: t.boonTaken, hero: { x: w.hero.pos.x, z: w.hero.pos.z, hp: w.hero.hp }, exit: t.plan.exit, shrinePos: t.plan.shrine,
    foes: w.fighters.filter((f: any) => f.role === 'foe' && f.alive).map((f: any) => ({ x: f.pos.x, z: f.pos.z, state: f.state })), tier: t.tier, cls: t.cls?.name ?? '', level: w.level,
    gear: Object.values(t.gear).map((g: any) => `${g.name} [${g.base}]`), skills: w.skills.map((k: any) => k?.name ?? '-'), essences: [...t.essences], scrolls: t.scrolls.length, achievements: [...t.earned], armor: t.armorItem?.name ?? null, over: t.over, loot: t.pickups.map((p: any) => ({ x: p.pos.x, z: p.pos.z })) };
}) as Promise<S>;
const screen = (x: number, z: number) => page.evaluate(([x, z]) => (window as any).__arena.screen(x, 1, z), [x, z]);
const held = new Set<string>();
const hold = async (k: string, on: boolean) => { if (on && !held.has(k)) { await page.keyboard.down(k); held.add(k); } if (!on && held.has(k)) { await page.keyboard.up(k); held.delete(k); } };
const steer = async (dx: number, dz: number) => { const f = -(dx + dz) / Math.SQRT2, r = (dx - dz) / Math.SQRT2, l = Math.hypot(f, r) || 1; await hold('KeyW', f / l > .38); await hold('KeyS', f / l < -.38); await hold('KeyD', r / l > .38); await hold('KeyA', r / l < -.38); };
const floors: { floor: number; at: number; tier: string; cls: string; gear: string[]; armor: string | null }[] = [];
const fps: number[] = [];
let lastFloor = 0, shot = 0, mouseDown = false;
let orbited = false;
const skipLoot = new Set<string>(); let lootKey = '', lootSince = 0;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < seconds) {
  if (await page.locator('.ar-modal.on .ar-card').count()) { await page.screenshot({ path: join(out, `${String(shot++).padStart(2, '0')}-cards.png`) }); await page.locator('.ar-modal.on .ar-card').first().click(); continue; }
  if (await page.locator('.ar-modal.on .ar-btn').count()) { await page.screenshot({ path: join(out, `${String(shot++).padStart(2, '0')}-fallen.png`) }); break; }
  const s = await state(page);
  if (s.fps > 0) fps.push(s.fps);
  if (process.argv.includes('--orbit') && !orbited && Date.now() - t0 > 15000) {
    orbited = true; await page.mouse.move(W * .7, H * .4); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(W * .3, H * .4, { steps: 16 }); await page.mouse.up({ button: 'middle' });
  }
  if (s.floor !== lastFloor) { lastFloor = s.floor; floors.push({ floor: s.floor, at: Math.round((Date.now() - t0) / 1000), tier: s.tier, cls: s.cls, gear: s.gear, armor: s.armor }); await page.waitForTimeout(400); await page.screenshot({ path: join(out, `${String(shot++).padStart(2, '0')}-floor${s.floor}.png`) }); }
  // Draw the best weapon found (bot preference: heavy, then blade, then fists).
  if (s.gear.length) await page.keyboard.press(s.gear.some(g => /Oathbreaker|Execution|Bell/.test(g)) ? 'F2' : s.gear.some(g => /Veilguard|Crimson|Serpent|Widow/.test(g)) ? 'F3' : 'F1');
  let target: { x: number; z: number } | null = null, attack = false;
  if (s.foes.length) { target = s.foes.reduce((b, f) => Math.hypot(f.x - s.hero.x, f.z - s.hero.z) < Math.hypot(b.x - s.hero.x, b.z - s.hero.z) ? f : b); attack = Math.hypot(target.x - s.hero.x, target.z - s.hero.z) < 3.2; }
  else if (s.loot.some(l => !skipLoot.has(`${s.floor}:${l.x.toFixed(1)}:${l.z.toFixed(1)}`))) {
    target = s.loot.find(l => !skipLoot.has(`${s.floor}:${l.x.toFixed(1)}:${l.z.toFixed(1)}`))!;
    const k = `${s.floor}:${target.x.toFixed(1)}:${target.z.toFixed(1)}`;
    if (k !== lootKey) { lootKey = k; lootSince = Date.now(); } else if (Date.now() - lootSince > 7000) skipLoot.add(k);
  }
  else if (s.shrine && !s.boon && s.shrinePos) { target = s.shrinePos; if (Math.hypot(target.x - s.hero.x, target.z - s.hero.z) < 2.6) { await page.keyboard.down('KeyE'); await page.waitForTimeout(150); await page.keyboard.up('KeyE'); } }
  else if (s.open) target = s.exit;
  if (target) {
    const p = await screen(target.x, target.z); await page.mouse.move(Math.max(5, Math.min(W - 5, p.x)), Math.max(5, Math.min(H - 5, p.y)));
    const d = Math.hypot(target.x - s.hero.x, target.z - s.hero.z);
    const route = await routeInput(page, target.x, target.z); attack = attack && route.visible && route.distance < 2.3;
    for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) await hold(k, !attack && d > .8 && route.keys.includes(k));
    if (attack !== mouseDown) { attack ? await page.mouse.down() : await page.mouse.up(); mouseDown = attack; }
    // Use whatever skills have emerged, and read scrolls, when foes are close.
    if (attack && Math.random() < .12) { const k = s.skills.map((n, i) => n !== '-' ? i : -1).filter(i => i >= 0); if (k.length) await page.keyboard.press(`Digit${k[Math.floor(Math.random() * k.length)] + 1}`); }
    if (attack && s.scrolls && Math.random() < .05) await page.keyboard.press('KeyG');
    if (s.foes.some(f => f.state === 'tell' && Math.hypot(f.x - s.hero.x, f.z - s.hero.z) < 3.5) && Math.random() < .3) await page.keyboard.press('Space');
  } else await steer(0, 0);
  await page.waitForTimeout(80);
}
for (const k of held) await page.keyboard.up(k);
if (mouseDown) await page.mouse.up();
const video = await capture?.stop('gameplay.mp4');
await page.screenshot({ path: join(out, 'zz-end.png') }).catch(() => undefined);
const final = await state(page).catch(() => null);
const codex = await page.evaluate(() => JSON.parse(localStorage.getItem('tv.tower.codex.v1') ?? '[]')).catch(() => []);
fps.sort((a, b) => a - b);
const report = { seed, seconds, floors, video, fps: { samples: fps.length, p10: fps[Math.floor(fps.length * .1)], median: fps[Math.floor(fps.length / 2)] }, final: final && { floor: final.floor, tier: final.tier, cls: final.cls, level: final.level, gear: final.gear, armor: final.armor, skills: final.skills, essences: final.essences, scrolls: final.scrolls, achievements: final.achievements, over: final.over, hero: final.hero, foes: final.foes, open: final.open, loot: final.loot.length }, codex, errors };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await ctx.close(); await browser.close();
