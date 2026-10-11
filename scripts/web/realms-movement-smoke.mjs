import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve('.debug/realms/movement-smoke'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
let result = 'failed', before, after, distance;
try {
  await page.goto(`${process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7510'}/?realms`);
  await page.waitForFunction(() => window.tvRealms?.ready);
  before = await page.evaluate(() => window.tvRealms.state.body.pos);
  // At ~45 degrees, forward+strafe would exceed a per-axis input bound without normalization.
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(600); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD'); await page.waitForTimeout(1400);
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD'); await page.waitForTimeout(250);
  after = await page.evaluate(() => window.tvRealms.state.body.pos);
  distance = Math.hypot(after.x-before.x, after.z-before.z);
  assert.ok(distance > 2 && distance < 7, `Expected ordinary rotated diagonal movement, got ${distance}m`);
  assert.equal(errors.length, 0); await page.screenshot({ path: resolve(out,'rotated-diagonal.png') });
  result = 'passed'; console.log('PASS rotated diagonal input travels through canonical collision', distance);
} catch(e) { errors.push(String(e)); console.error(String(e)); }
finally { writeFileSync(resolve(out,'report.json'), JSON.stringify({result,before,after,distance,errors},null,2)); await browser.close(); }
if(result!=='passed')process.exitCode=1;
