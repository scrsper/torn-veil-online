/**
 * Combat Arena play harness: real mouse/keyboard input against http://127.0.0.1:5180/?arena=1
 * (run `npm run web:dev` first). Aims with the page's projector, records video + stills and a JSON
 * report into .debug/arena/<name>. Automation evidence, not a human playtest.
 *   npx tsx scripts/web/arena-play.ts [--name run1] [--seconds 60] [--url http://127.0.0.1:5180/?arena=1]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'run'), seconds = Number(arg('seconds', '60')), url = arg('url', 'http://127.0.0.1:5180/?arena=1&seed=918271');
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const W = 1280, H = 720;

const browser = await chromium.launch({ channel: process.env.TV_BROWSER ?? 'chrome', headless: false,
  args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', `--window-size=${W + 16},${H + 130}`] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
await context.addInitScript(() => { (window as unknown as { __name: (f: unknown) => unknown }).__name = f => f; });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => !!(window as unknown as { __arena?: unknown }).__arena, null, { timeout: 240_000 });
const zoomArg = Number(arg('zoom', '0'));
if (zoomArg) await page.evaluate(z => (window as any).__arena.zoom(z), zoomArg);
if (process.argv.includes('--nohelp')) await page.evaluate(() => (window as any).__arena.hud.toggleHelp());

type Summary = { time: number; wave: number; kills: number; smashed: number; level: number; combo: number; hp: number; heroState: string; debris: number;
  foes: { x: number; z: number; state: string; kind: string }[]; hero: { x: number; z: number }; props: { x: number; z: number; key: string }[] };
const summary = (p: Page) => p.evaluate(() => (window as unknown as { __arena: { summary(): unknown } }).__arena.summary()) as Promise<Summary>;
const screen = (p: Page, x: number, z: number) => p.evaluate(([x, z]) => (window as unknown as { __arena: { screen(x: number, y: number, z: number): { x: number; y: number } } }).__arena.screen(x, 1, z), [x, z]);
const fps = () => page.evaluate(() => (window as unknown as { __arena: { scene: { getEngine(): { getFps(): number } } } }).__arena.scene.getEngine().getFps());

let shot = 0;
const still = async (label: string) => { await page.screenshot({ path: join(out, `${String(shot++).padStart(2, '0')}-${label}.png`) }); };
// Dismiss the upgrade card or death screen if they appear.
const modals = async () => {
  if (await page.locator('.ar-modal.on .ar-card').count()) { await still('level-up'); await page.locator('.ar-modal.on .ar-card').first().click(); }
  if (await page.locator('.ar-modal.on .ar-btn').count()) { await still('fell'); await page.locator('.ar-modal.on .ar-btn').click(); }
};

await page.mouse.move(W * .62, H * .5);
await page.mouse.click(W * .62, H * .5);
await page.keyboard.press('KeyM');   // auto waves on (the arena starts as a sandbox)
await page.waitForTimeout(800);
await still('start');

let maxCombo = 0, maxDebris = 0;
const t0 = Date.now(); const samples: number[] = [];
const held = new Set<string>();
const hold = async (k: string, on: boolean) => { if (on && !held.has(k)) { await page.keyboard.down(k); held.add(k); } if (!on && held.has(k)) { await page.keyboard.up(k); held.delete(k); } };
const steer = async (dx: number, dz: number) => {
  // Camera looks from +x+z towards -x-z (yaw 45 deg): W = (-.71, -.71), D = screen-right = (.71, -.71).
  const f = -(dx + dz) / Math.SQRT2, r = (dx - dz) / Math.SQRT2;
  await hold('KeyW', f > .3); await hold('KeyS', f < -.3); await hold('KeyD', r > .3); await hold('KeyA', r < -.3);
};

let phase = 0, mouseDown = false, lastStill = 0;
const setMouse = async (down: boolean) => { if (down !== mouseDown) { down ? await page.mouse.down() : await page.mouse.up(); mouseDown = down; } };
while ((Date.now() - t0) / 1000 < seconds) {
  const el = (Date.now() - t0) / 1000;
  await modals();
  const s = await summary(page);
  maxCombo = Math.max(maxCombo, s.combo); maxDebris = Math.max(maxDebris, s.debris);
  samples.push(await fps());
  // Weapon plan: greatsword, then axe & shield, then crossbow, then greatsword whirlwind.
  const want = el < seconds * .3 ? '1' : el < seconds * .5 ? '2' : el < seconds * .65 ? '3' : el < seconds * .8 ? '4' : '2';
  if (want !== String(phase)) { await setMouse(false); await page.keyboard.press(`Digit${want}`); phase = Number(want); }
  const targets = s.foes.length ? s.foes.filter(f => f.state !== 'spawn').map(f => ({ x: f.x, z: f.z })) : s.props;
  let best = null as null | { x: number; z: number }, bd = 1e9;
  for (const t of targets) { const d = Math.hypot(t.x - s.hero.x, t.z - s.hero.z); if (d < bd) { bd = d; best = t; } }
  if (best) {
    const p = await screen(page, best.x, best.z);
    await page.mouse.move(Math.max(5, Math.min(W - 5, p.x)), Math.max(5, Math.min(H - 5, p.y)));
    const reach = phase === 4 ? 12 : phase === 1 ? 2.2 : 2.8;
    if (bd > reach) await steer(best.x - s.hero.x, best.z - s.hero.z); else await steer(0, 0);
    const tells = s.foes.filter(f => f.state === 'tell' && Math.hypot(f.x - s.hero.x, f.z - s.hero.z) < 4).length;
    if (tells && Math.random() < .35) { await page.keyboard.press('Space'); }
    if (phase === 2 && el > seconds * .8 && s.foes.length > 2 && bd < 5) { await setMouse(false); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(900); await page.mouse.up({ button: 'right' }); }
    else await setMouse(bd < reach + 1.5);
  }
  if (el - lastStill > 4) { lastStill = el; await still(`t${Math.round(el)}-w${phase}`); }
  await page.waitForTimeout(90);
}
await setMouse(false); await steer(0, 0);
await still('end');
const final = await summary(page);
samples.sort((a, b) => a - b);
const report = { url, seconds, final: { ...final, foes: final.foes.length, props: final.props.length }, maxCombo, maxDebris, fpsMedian: samples[samples.length >> 1], fpsP10: samples[Math.floor(samples.length * .1)], errors };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await context.close(); await browser.close();
