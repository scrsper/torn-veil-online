/** Repeatable actual gameplay frames. Ordinary buttons/keys; no world/camera mutation. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/realms/art-pass');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), errors = [], shots = [], checks = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const state = () => page.evaluate(() => window.tvRealms?.state);
const ready = () => page.waitForFunction(() => window.tvRealms?.ready, null, { timeout: 150000 });
const held = new Set();
async function keys(wanted = []) {
  for (const k of [...held]) if (!wanted.includes(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of wanted) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
async function walk(x, z) {
  const deadline = Date.now() + 30000;
  try {
    while (Date.now() < deadline) {
      const p = (await state()).body.pos, dx = x - p.x, dz = z - p.z;
      if (Math.hypot(dx, dz) < .45) return;
      await keys([Math.abs(dx) > .25 ? (dx > 0 ? 'KeyA' : 'KeyD') : '', Math.abs(dz) > .25 ? (dz > 0 ? 'KeyW' : 'KeyS') : ''].filter(Boolean));
      await page.waitForTimeout(60);
    }
    throw Error(`Ordinary walk stalled before ${x},${z}`);
  } finally { await keys(); await page.waitForTimeout(250); }
}
const quantile = (v, p) => [...v].sort((a,b) => a-b)[Math.min(v.length-1,Math.floor(v.length*p))] ?? null;
async function capture(name) {
  await ready(); await page.waitForTimeout(6500);
  const observation = await page.evaluate(() => window.tvRealms.inspect());
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  shots.push({ name, observation, frames: { p50: quantile(observation.frames,.5), p95: quantile(observation.frames,.95), p99: quantile(observation.frames,.99) } });
  console.log(`CAPTURE ${name}: p95 ${shots.at(-1).frames.p95?.toFixed(2)}ms, ${observation.meshes} meshes, ${observation.loaded} chunks`);
}
let result = 'failed';
try {
  await page.goto(`${process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7510'}/?realms`); await ready();
  const initial = await state(); assert.equal(initial.realm,'aether','Use a fresh isolated review save.');
  for (const realm of ['aether','brass']) {
    const offset = realm === 'aether' ? 0 : 8192;
    await walk(offset + 3120.5, 3096.5); await capture(`${realm}-01-gameplay`);
    await walk(offset + 3117.5, 3114.5); await capture(`${realm}-02-entrance-detail`);
    await walk(offset + 3120.5, 3120.5);
    if ((await state()).prompt.includes('Open Tower')) await page.keyboard.press('KeyE');
    await walk(offset + 3120.5, 3128.5); assert.equal((await state()).tower,true);
    checks.push(`${realm}: unchanged doorway is traversable`); await capture(`${realm}-03-atrium`);
    await page.locator('#rv-portal').click();
    await page.waitForFunction(() => window.tvRealms.state.prompt.includes('Cross the Veil'), null, {timeout:45000});
    await page.keyboard.press('KeyE'); await page.locator('#rv-cross').click();
    await page.waitForFunction(r => window.tvRealms?.state?.realm !== r, realm, {timeout:30000}); await ready();
    assert.deepEqual((await state()).person, initial.person); assert.equal((await state()).body.id, initial.body.id);
    checks.push(`${realm}: portal preserves Person, inventory, rank and Body`);
  }
  await page.reload(); await ready(); assert.equal((await state()).realm,'aether');
  assert.deepEqual((await state()).person, initial.person);
  checks.push('round trip and reload preserve character'); assert.equal(errors.length,0); result = 'passed';
} catch (e) { errors.push(String(e)); console.error(String(e)); await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{}); }
finally {
  await keys(); writeFileSync(resolve(out,'report.json'), JSON.stringify({ result, checks, errors, shots, note:'Actual headed Chrome 1440x900, normal keys/buttons and read-only queries. No video overhead; shared machine, not a controlled benchmark. Frames are observed, not simulated.' },null,2));
  await context.close(); await browser.close();
}
if (result !== 'passed') process.exitCode = 1;
