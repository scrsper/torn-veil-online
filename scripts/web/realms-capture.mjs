import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/realms/evidence');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,1000'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto('http://127.0.0.1:7510/?realms', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.tvRealms?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(out, '01-aether-street.png') });
  if (process.env.TV_REALMS_ART_REVIEW === '1') {
    // A repeatable representative-scene review, using normal pathing/input and full
    // frames. No model/material swaps, hidden defects, image edits or debug teleport.
    await page.locator('#rv-tower').click();
    await page.waitForFunction(() => Math.hypot(window.tvRealms.state.body.pos.x - 3120.5, window.tvRealms.state.body.pos.z - 3120.5) < .6, null, { timeout: 45000 });
    await page.keyboard.down('KeyS'); await page.waitForTimeout(4500); await page.keyboard.up('KeyS');
    await page.waitForTimeout(500); await page.screenshot({ path: resolve(out, '02-threshold-square-full-frame.png') });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
    await page.waitForTimeout(500); await page.screenshot({ path: resolve(out, '03-tower-entrance-close.png') });
  }
  const snapshot = await page.evaluate(() => window.tvRealms.inspect());
  writeFileSync(resolve(out, 'initial.json'), JSON.stringify({ snapshot, errors }, null, 2));
  console.log(JSON.stringify({ ready: true, state: snapshot.state, loaded: snapshot.loaded, meshes: snapshot.meshes, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} catch (e) {
  await page.screenshot({ path: resolve(out, 'failure.png') });
  console.log(JSON.stringify({ errors, error: String(e), text: await page.locator('body').innerText() }));
  throw e;
} finally { await context.close(); await browser.close(); }
