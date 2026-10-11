/**
 * Magic showcase in the Proving Hall (?arena=1&tower=1&hall=1): casts spells of every form and many elements at the
 * training dummies with real keys and mouse, stages the reactions (soak+shock, soak+freeze, freeze+fire, gather+burst,
 * slow+strikes), and records screenshots, the reaction words that appeared, and errors -> .debug/arena/<name>.
 *   npx tsx scripts/web/magic-showcase.ts [--name magic] [--host http://127.0.0.1:5180] [--only bolts,reactions]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = join(process.cwd(), '.debug/arena', arg('name', 'magic')); mkdirSync(out, { recursive: true });
const host = arg('host', 'http://127.0.0.1:5180'), only = new Set(arg('only', '').split(',').filter(Boolean));
const want = (n: string) => !only.size || only.has(n);
const W = 1600, H = 900;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W + 16},${H + 130}`] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
await page.addInitScript(() => {
  (window as any).__name = (f: unknown) => f;
  // Record every floating word (reactions, statuses) the HUD shows.
  (window as any).__words = [];
});
await page.goto(`${host}/?arena=1&tower=1&hall=1&seed=3`);
await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 240_000 });
await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleHelp(); const w0 = a.hud.word.bind(a.hud); a.hud.word = (p: unknown, t: string, c: string) => { (window as any).__words.push(t); w0(p, t, c); }; a.world.hero.maxHp = a.world.hero.hp = 1e6; });
await page.mouse.click(W / 2, H * .4); await page.waitForTimeout(2500);
const shots: string[] = [];
const shot = async (n: string) => { await page.screenshot({ path: join(out, `${n}.png`) }); shots.push(n); };
const screen = (x: number, y: number, z: number) => page.evaluate(([x, y, z]) => (window as any).__arena.screen(x, y, z), [x, y, z]);
/** Place the hero, face the dummies, aim at one, put a spell in slot 1 and cast it (real key press). */
async function cast(id: string, target: number, opts: { wait?: number; shotAt?: number; name?: string; hold?: boolean } = {}): Promise<void> {
  const d = await page.evaluate(([id, k]) => {
    const a = (window as any).__arena, w = a.world, t = a.tower, ds = w.fighters.filter((f: any) => f.foeKind === 'dummy');
    const sp = t.known.find((s: any) => s.id === id); if (!sp) return null;
    w.skills[0] = sp; w.skillCd[0] = 0; w.hero.mana = w.hero.maxMana; w.hero.state = 'idle';
    const dm = ds[k % ds.length]; return { x: dm.pos.x, z: dm.pos.z };
  }, [id, target]);
  if (!d) { console.log('missing spell', id); return; }
  const p = await screen(d.x, 1, d.z); await page.mouse.move(p.x, p.y); await page.waitForTimeout(120);
  await page.keyboard.press('Digit1');
  if (opts.shotAt !== undefined) { await page.waitForTimeout(opts.shotAt); await shot(opts.name ?? id.replace(/:/g, '-')); }
  await page.waitForTimeout(opts.wait ?? 700);
}
const place = (x: number, z: number) => page.evaluate(([x, z]) => { const h = (window as any).__arena.world.hero; h.pos.set(x, 0, z); }, [x, z]);
const view = (pitch: number, yaw: number, zoom: number) => page.evaluate(([p, y, z]) => { const a = (window as any).__arena; a.cam.pitch = p; a.cam.yaw = y; a.cam.preferred = z; }, [pitch, yaw, zoom]);
await place(0, 6); await view(.42, 0, 9); await page.waitForTimeout(800);
await shot('00-hall');

if (want('bolts')) {
  for (const [i, e] of ['flame', 'frost', 'storm', 'water', 'gravity', 'shadow', 'iron', 'verdance', 'swift', 'time'].entries()) await cast(`sp:${e}:bolt`, i % 7, { shotAt: 330, name: `10-bolt-${e}`, wait: 650 });
}
if (want('forms')) {
  await cast('sp:flame:wave', 3, { shotAt: 480, name: '20-wave-flame' }); await cast('sp:water:wave', 2, { shotAt: 480, name: '20b-wave-water' });
  await cast('sp:storm:wave', 4, { shotAt: 480, name: '20c-wave-storm' }); await cast('sp:frost:wave', 3, { shotAt: 480, name: '20d-wave-frost' });
  await cast('sp:frost:nova', 3, { shotAt: 300, name: '21-nova-frost' }); await place(0, 4);
  await cast('sp:storm:field', 2, { shotAt: 900, name: '22-field-storm', wait: 1500 });
  await cast('sp:gravity:field', 4, { shotAt: 1200, name: '23-field-gravity', wait: 1800 });
  await cast('sp:time:field', 1, { shotAt: 900, name: '24-field-time', wait: 1200 });
  await cast('sp:iron:lance', 3, { shotAt: 350, name: '25-lance-earth' });
  await cast('sp:swift:field', 5, { shotAt: 900, name: '26-field-wind', wait: 1200 });
  await cast('sp:water:field', 0, { shotAt: 900, name: '27-field-water', wait: 1200 });
  await cast('sp:storm:step', 3, { shotAt: 160, name: '28-step-lightning' });
  await cast('sp:flame:weave', 3, { shotAt: 500, name: '29-weave-flame' });
  await page.mouse.click(W / 2, H * .45); await page.waitForTimeout(250); await shot('29b-weave-blow');
  await cast('sp:iron:ward', 3, { shotAt: 300, name: '30-ward-earth' });
  await cast('sp:shadow:nova', 3, { shotAt: 300, name: '31-nova-shadow' });
  await cast('sp:verdance:nova', 3, { shotAt: 300, name: '32-nova-life' });
}
if (want('reactions')) {
  await place(0, 3); await view(.5, 0, 8); await page.waitForTimeout(600);
  // Soak then shock: water wave across the line, then a lightning bolt.
  await cast('sp:water:wave', 3, { wait: 500 }); await cast('sp:storm:bolt', 3, { shotAt: 160, name: '40-electrocute', wait: 900 });
  // Soak then freeze.
  await cast('sp:water:bolt', 2, { wait: 450 }); await cast('sp:frost:bolt', 2, { shotAt: 220, name: '41-freeze', wait: 600 });
  // Freeze then burn: shatter.
  await cast('sp:flame:bolt', 2, { shotAt: 200, name: '42-shatter', wait: 900 });
  // Gather then burst.
  await cast('sp:gravity:field', 3, { wait: 1600 }); await cast('sp:flame:nova', 3, { shotAt: 250, name: '43-crush', wait: 900 });
  // Slow then strike: rupture.
  await cast('sp:time:bolt', 4, { wait: 500 }); for (let k = 0; k < 3; k++) await cast('sp:storm:bolt', 4, { wait: 350 }); await shot('44-rupture'); await page.waitForTimeout(600);
  // Fire then wind: wildfire.
  await cast('sp:flame:wave', 3, { wait: 400 }); await cast('sp:swift:bolt', 3, { shotAt: 200, name: '45-wildfire', wait: 700 });
}
if (want('book')) { await page.keyboard.press('KeyB'); await page.waitForTimeout(500); await shot('50-spellbook'); await page.keyboard.press('KeyB'); }
const words = await page.evaluate(() => (window as any).__words as string[]);
const tally: Record<string, number> = {}; for (const w of words) tally[w] = (tally[w] ?? 0) + 1;
const perf = await page.evaluate(async () => { const d: number[] = []; let l = performance.now(); await new Promise<void>(r => { const f = (t: number) => { d.push(t - l); l = t; d.length < 120 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); d.sort((a, b) => a - b); return { median: +d[60].toFixed(1), p95: +d[114].toFixed(1) }; });
const report = { shots, words: tally, frameMs: perf, errors: errors.slice(0, 10) };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
