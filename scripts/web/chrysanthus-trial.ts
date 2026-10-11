/**
 * The trial of Chrysanthus (Tower floor 10), driven with real keys and mouse: watch him descend, answer him,
 * fight (attack, dodge his unblockable verdicts), jump ahead to the staff phase, end the trial, take his gift.
 * Screenshots, the words that appeared and errors -> .debug/arena/<name>. Dev server must be running.
 *   npx tsx scripts/web/chrysanthus-trial.ts [--name trial] [--host http://127.0.0.1:5180]
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = join(process.cwd(), '.debug/arena', arg('name', 'trial')); mkdirSync(out, { recursive: true });
const W = 1600, H = 900;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W + 16},${H + 130}`] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await ctx.newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; (window as any).__words = []; });
await page.goto(`${arg('host', 'http://127.0.0.1:5180')}/?arena=1&tower=1&floor=10&seed=5`);
await page.waitForFunction(() => !!(window as any).__arena?.tower?.trial, null, { timeout: 240_000 });
await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleHelp(); const w0 = a.hud.word.bind(a.hud); a.hud.word = (p: unknown, t: string, c: string) => { (window as any).__words.push(t); w0(p, t, c); }; });
await page.mouse.click(W / 2, H * .4);
const shots: string[] = []; const shot = async (n: string) => { await page.screenshot({ path: join(out, `${n}.png`) }); shots.push(n); };
const state = () => page.evaluate(() => { const a = (window as any).__arena, t = a.tower.trial; return t ? { phase: t.phase, t: +t.t.toFixed(1), blows: t.blows, dodged: t.dodged, act: t.act, hp: Math.round(a.world.hero.hp), god: { x: t.f.pos.x, z: t.f.pos.z, hp: Math.round(t.f.hp), max: t.f.maxHp, hover: +t.f.hover.toFixed(2) }, hero: { x: a.world.hero.pos.x, z: a.world.hero.pos.z }, dialog: !!document.querySelector('.ar-dialog[style*="block"]') } : null; });
await page.waitForTimeout(900); await shot('01-descending');
await page.waitForFunction(() => (window as any).__arena.tower.trial.phase === 'talk' || !!document.querySelector('.ar-dialog[style*="block"]'), null, { timeout: 20_000 });
await page.waitForTimeout(600);
const lines: string[] = [];
for (let k = 0; k < 3; k++) {
  await page.waitForSelector('.ar-dialog[style*="block"]', { timeout: 15_000 });
  lines.push(await page.locator('.ar-dialog p').innerText());
  await shot(`02-dialogue-${k}`); await page.keyboard.press(k === 0 ? 'Digit1' : k === 1 ? 'Digit2' : 'Digit1'); await page.waitForTimeout(500);
}
// Fight with real input: close in, attack; dodge when a verdict mark or sweep is called.
const t0 = Date.now(); let n = 0;
while (Date.now() - t0 < 40_000) {
  const s = await state(); if (!s || s.phase !== 'fight') break;
  const p = await page.evaluate(([x, z]) => (window as any).__arena.screen(x, 1, z), [s.god.x, s.god.z]);
  await page.mouse.move(Math.max(5, Math.min(W - 5, p.x)), Math.max(5, Math.min(H - 5, p.y)));
  const d = Math.hypot(s.god.x - s.hero.x, s.god.z - s.hero.z);
  const danger = await page.evaluate(() => { const w = (window as any).__words as string[]; const k = w.lastIndexOf('UNBLOCKABLE'); if (k >= 0) { w.splice(k, 1, 'UNBLOCKABLE*'); return true; } return false; });
  if (danger) { await page.waitForTimeout(650); await page.keyboard.down('KeyS'); await page.keyboard.press('Space'); await page.keyboard.up('KeyS'); }
  else if (d > 2.6) { await page.keyboard.down('KeyW'); await page.waitForTimeout(200); await page.keyboard.up('KeyW'); }
  else { await page.mouse.down(); await page.waitForTimeout(140); await page.mouse.up(); }
  if (++n % 25 === 0) await shot(`03-fight-${n}`);
  await page.waitForTimeout(60);
}
const mid = await state(); console.log('after 40s', JSON.stringify(mid));
// The staff phase: skip ahead to the one-minute mark.
await page.evaluate(() => { const t = (window as any).__arena.tower.trial; t.t = 59.5; });
await page.waitForTimeout(1800); await shot('04-staff-drawn');
for (let k = 0; k < 8; k++) { await page.waitForTimeout(900); if (k % 2 === 0) await shot(`05-staff-${k}`); }
// End the trial: enough blows.
await page.evaluate(() => { const t = (window as any).__arena.tower.trial; t.blows = Math.max(t.blows, 30); });
await page.waitForSelector('.ar-dialog[style*="block"]', { timeout: 20_000 }); lines.push(await page.locator('.ar-dialog p').innerText()); await shot('06-farewell');
await page.keyboard.press('Digit1');
await page.waitForSelector('.ar-modal.on .ar-card', { timeout: 15_000 }); await shot('07-gift'); await page.keyboard.press('Digit1');
await page.waitForTimeout(2500); await shot('08-departed');
const end = await page.evaluate(() => { const a = (window as any).__arena, t = a.tower; return { door: t.doorOpen, time: t.sheet.affinity.time, spells: t.known.filter((k: any) => k.element === 'time').map((k: any) => k.name) }; });
const words = await page.evaluate(() => (window as any).__words as string[]); const tally: Record<string, number> = {}; for (const w of words) tally[w.replace('*', '')] = (tally[w.replace('*', '')] ?? 0) + 1;
const report = { mid, end, lines, words: tally, shots, errors: errors.slice(0, 10) };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await ctx.close(); await browser.close();
