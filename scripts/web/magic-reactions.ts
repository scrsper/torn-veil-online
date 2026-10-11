/**
 * Reaction rules check in the Proving Hall: applies element contacts to a training dummy through the world's real
 * reaction engine (ArenaWorld.elementHit) and reports which reaction each pair produced. Dev server must be running.
 *   npx tsx scripts/web/magic-reactions.ts [--host http://127.0.0.1:5180]
 */
import { chromium } from 'playwright';
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`${arg('host', 'http://127.0.0.1:5180')}/?arena=1&tower=1&hall=1&seed=3`);
await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 240_000 });
await page.waitForTimeout(1500);
const result = await page.evaluate(() => {
  const a = (window as any).__arena, w = a.world, h = w.hero, words: string[] = [];
  const w0 = a.hud.word.bind(a.hud); a.hud.word = (p: unknown, t: string, c: string) => { words.push(t); w0(p, t, c); };
  const d = w.fighters.filter((f: any) => f.foeKind === 'dummy');
  const clear = (t: any) => { t.wetT = t.frozenT = t.shockT = t.timeT = t.gatherT = t.burnT = 0; t.ruptureHits = 0; t.hp = t.maxHp; };
  const pair = (a1: string, b1: string, k = 0, times = 1) => { const t = d[k]; clear(t); words.length = 0; w.elementHit(h, t, a1, 1, 20); for (let i = 0; i < times; i++) w.elementHit(h, t, b1, 1, 20);
    return { pair: `${a1}+${b1}${times > 1 ? `x${times}` : ''}`, words: [...words], wet: +t.wetT.toFixed(1), frozen: +t.frozenT.toFixed(1), shock: +t.shockT.toFixed(1), time: +t.timeT.toFixed(1), burn: +t.burnT.toFixed(1), hpLost: Math.round(t.maxHp - t.hp) }; };
  const out = [pair('water', 'storm'), pair('water', 'frost'), pair('frost', 'flame'), pair('flame', 'water'), pair('flame', 'swift'), pair('time', 'storm', 0, 3)];
  // Freeze then shatter via the real path.
  { const t = d[1]; clear(t); words.length = 0; w.elementHit(h, t, 'water', 1, 20); w.elementHit(h, t, 'frost', 1, 20); const fr = t.frozenT; w.elementHit(h, t, 'flame', 1, 20); out.push({ pair: 'water+frost+flame', words: [...words], wet: 0, frozen: +fr.toFixed(1), shock: 0, time: 0, burn: 0, hpLost: Math.round(t.maxHp - t.hp) }); }
  // Gravity: gather three dummies, then a burst.
  { for (const t of d.slice(2, 5)) { clear(t); t.gatherT = 3; t.pos.set(d[3].pos.x + (Math.random() - .5), 0, d[3].pos.z + (Math.random() - .5)); } words.length = 0; w.elementHit(h, d[3], 'gravity', 1, 20); out.push({ pair: 'gathered+gravity', words: [...words], wet: 0, frozen: 0, shock: 0, time: 0, burn: 0, hpLost: Math.round(d[3].maxHp - d[3].hp) }); }
  return out;
});
console.log(JSON.stringify({ result, errors }, null, 1));
await browser.close();
