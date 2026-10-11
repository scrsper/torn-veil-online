/**
 * Creator gear presentation (dev server running): the same body, weapon and cameras every run, stowed and drawn.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-gear.ts --name gear-before [--body male|female] [--weapon qa-veilguard]
 * Shots: stowed front 3/4, stowed back, drawn ready front 3/4, drawn at the gameplay camera. Also reports each held or
 * stowed mesh's world size against the hero's height, so gear proportions are numbers as well as pictures.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-gear'), body = arg('body', 'male');
const out = join(process.cwd(), '.debug/arena', `${name}-${body}`); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=${body}`);
await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
await page.evaluate(() => {
  const a = (window as any).__arena, w = a.world, h = w.hero;
  a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none'; w.freezeFoes = true;
  for (const f of w.fighters) if (f.role === 'foe') f.pos.set(60, 0, 60);
  a.tower.take({ kind: 'weapon', id: 'qa-veilguard', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 });
  w.setWeapon(h, 'axe'); h.pos.set(0, 0, 4); h.yaw = 0;
});
const measure = () => page.evaluate(() => {
  const a = (window as any).__arena, h = a.world.hero;
  const size = (ms: any[]) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const m of ms) { m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; b.minimumWorld.asArray().forEach((v: number, i: number) => lo[i] = Math.min(lo[i], v)); b.maximumWorld.asArray().forEach((v: number, i: number) => hi[i] = Math.max(hi[i], v)); } return hi.map((v, i) => +(v - lo[i]).toFixed(2)); };
  const hero = size(h.inst.meshes.filter((m: any) => m.isEnabled() && m.isVisible)), heroH = hero[1];
  return { heroHeight: heroH, sheathed: h.sheathed, gear: h.extra.map((m: any) => { const s = size([m]); return { name: m.name, parent: m.parent?.name, size: s, longestOverHero: +(Math.max(...s) / heroH).toFixed(2) }; }) };
});
const shot = async (file: string, pitch: number, yaw: number, zoom: number) => { await page.evaluate(([p, y, z]) => { const a = (window as any).__arena; a.view(p, y); a.zoom(z); }, [pitch, yaw, zoom]); await page.waitForTimeout(900); await page.screenshot({ path: join(out, file) }); };
const report: Record<string, unknown> = { body };
// Stowed: wait until calm (relaxed slings the weapon).
await page.waitForFunction(() => (window as any).__arena.world.hero.relaxed, null, { timeout: 30_000 });
report.stowed = await measure();
await shot('stowed-front.png', .12, Math.PI * .85, 4.2); await shot('stowed-back.png', .14, -Math.PI * .1, 4.2); await shot('stowed-play.png', .22, -Math.PI * .25, 8);
// Drawn: the ready stance (as if a foe were near).
await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; }); await page.keyboard.press('KeyF'); await page.waitForTimeout(150);
await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; }); await page.waitForTimeout(1500);
report.drawn = await measure();
await shot('drawn-front.png', .12, Math.PI * .85, 4.2); await shot('drawn-play.png', .22, -Math.PI * .25, 8);
report.errors = errors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
await browser.close();
