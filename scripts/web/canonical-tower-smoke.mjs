/** Real browser inputs against an isolated QA save. No body/HP/floor mutation. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7520', out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/canonical-tower-oct9/smoke');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1440,1000'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const wait = (fn, timeout = 90000) => page.waitForFunction(fn, null, { timeout });
const shot = async name => { await page.screenshot({ path: resolve(out, `${name}.png`) }); console.log('CAPTURE', name); };
const check = (name, value) => { checks.push({ name, ok: !!value }); console.log(value ? 'PASS' : 'FAIL', name); assert.ok(value, name); };
try {
  await page.goto(`${base}/?realms`); await wait(() => window.tvRealms?.ready);
  const first = await page.evaluate(() => window.tvRealms.state);
  await shot('01-city');
  await page.locator('#rv-tower').click();
  await wait(() => Math.hypot(window.tvRealms.state.body.pos.x - 3120.5, window.tvRealms.state.body.pos.z - 3120.5) < .6);
  if ((await page.evaluate(() => window.tvRealms.state.prompt)).includes('Open Tower')) await page.keyboard.press('KeyE');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2700); await page.keyboard.up('KeyW'); await wait(() => window.tvRealms.state.tower);
  await page.locator('#rv-canonical').click(); await wait(() => window.tvAscent?.ready, 240000);
  const entered = await page.evaluate(() => window.tvAscent.frame);
  check('one canonical person and body entered', entered.own.id === first.person.id && entered.own.bodyId === first.body.id);
  await page.waitForTimeout(600); await shot('02-shared-floor');
  await page.getByRole('button', { name: 'Take Ember field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Study Ember field manual', exact: true }).click();
  await wait(() => window.tvAscent.frame.own.learned.some(s => s.id === 'book-ember'));
  check('ordinary pickup and source-backed learning reached host', true);
  await page.getByRole('button', { name: 'Take Trial steel dagger', exact: true }).click();
  await page.getByRole('button', { name: 'Equip Trial steel dagger', exact: true }).click();
  await shot('03-source-and-equipment');
  await page.locator('#as-save').click(); await page.waitForTimeout(500); await page.reload(); await wait(() => window.tvAscent?.ready, 240000);
  const reloaded = await page.evaluate(() => window.tvAscent.frame);
  check('reload retained run, learning, equipment and body', entered.tower.id === reloaded.tower.id && reloaded.own.bodyId === first.body.id && reloaded.own.learned.some(s => s.id === 'book-ember') && reloaded.snapshot.carried.some(i => i.name === 'Trial steel dagger' && i.description.some(x => x.includes('Equipped'))));
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(800); await shot('04-real-action');
  await page.locator('#as-return').click(); await wait(() => window.tvRealms?.ready);
  const returned = await page.evaluate(() => window.tvRealms.state);
  check('returned to real atrium carrying Tower sources', returned.person.id === first.person.id && returned.body.id === first.body.id && returned.tower && returned.person.inventory.some(i => i.name === 'Ember field manual'));
  await shot('05-returned'); check('no browser errors', errors.length === 0);
} catch (e) { errors.push(String(e)); console.error(e); await shot('failure'); process.exitCode = 1; }
finally { writeFileSync(resolve(out, 'result.json'), JSON.stringify({ checks, errors, completedAt: new Date().toISOString() }, null, 2)); const video = page.video(); await context.close(); if (video) await video.saveAs(resolve(out, 'actual-traversal.webm')); await browser.close(); }
