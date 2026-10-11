/**
 * HUD layout check (dev server running): the Proving Hall at several widths; reports the rects of the main HUD blocks and
 * every pair that overlaps, and saves a screenshot per width.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-hud-layout.ts --name hud-layout [--widths 1280,900]
 * Exits non-zero when any overlap remains.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'hud-layout'), widths = arg('widths', '1280,900').split(',').map(Number);
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const report: Record<string, unknown> = {}; let bad = 0;
for (const width of widths) {
  const page = await (await browser.newContext({ viewport: { width, height: 720 } })).newPage();
  await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=male`);
  await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => (window as any).__arena.hud.showHelp(false));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const blocks: Record<string, string> = { status: '.ar-frame', header: '.ar-wave', weapons: '.ar-weapons', weaponName: '.ar-wname', skills: '.ar-skills', radar: '.ar-radar' };
    const rects: Record<string, number[]> = {};
    for (const [k, sel] of Object.entries(blocks)) { const e = document.querySelector(sel) as HTMLElement | null; if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') continue; const b = e.getBoundingClientRect(); if (b.width && b.height) rects[k] = [b.left, b.top, b.right, b.bottom].map(Math.round); }
    const keys = Object.keys(rects), overlaps: string[] = [];
    // The weapon name lives inside the weapons block: compare it with everything else, not with its parent.
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j]; if ((a === 'weapons' && b === 'weaponName') || (a === 'weaponName' && b === 'weapons')) continue;
      const A = rects[a], B = rects[b]; if (A[0] < B[2] - 1 && B[0] < A[2] - 1 && A[1] < B[3] - 1 && B[1] < A[3] - 1) overlaps.push(`${a} x ${b}`);
    }
    return { rects, overlaps };
  });
  await page.screenshot({ path: join(out, `hall-${width}.png`) });
  report[width] = r; bad += r.overlaps.length;
  await page.context().close();
}
await browser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
process.exit(bad ? 1 : 0);
