/** Observed browser combat acceptance. Reads the projected map/bodies and uses keyboard
 * input only. Existing QA character must already own the source/equipment; no fixtures,
 * damage writes, hidden enemy positions, instant travel or reward commands are used. */
import { chromium } from 'playwright';
import { route } from './canonical-tower-qa-route.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7520';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/canonical-tower-oct9/combat');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], checks = [], trace = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const shot = async name => page.screenshot({ path: resolve(out, `${name}.png`) });
const check = (name, ok) => { checks.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name); assert.ok(ok, name); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const held = new Set();
async function keys(next) { for (const k of held) if (!next.includes(k)) { await page.keyboard.up(k); held.delete(k); } for (const k of next) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); } }

let metrics = null, initial = null, final = null;
try {
  await page.goto(`${base}/?realms`); await page.waitForFunction(() => window.tvRealms?.ready);
  await page.locator('#rv-canonical').click(); await page.waitForFunction(() => window.tvAscent?.ready, null, { timeout: 240000 });
  initial = await page.evaluate(() => window.tvAscent.frame); const plan = await page.evaluate(() => window.tvAscent.plan);
  await shot('01-entered');
  let target = plan.exit, path = [], nextRoute = 0, patrol = 0, lastShot = 0, catchingBreath = false;
  const started = Date.now(), stations = [plan.exit, ...plan.rooms.map(r => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 }))];
  while (Date.now() - started < 300000) {
    const f = await page.evaluate(() => window.tvAscent.frame), own = f.snapshot.bodies.find(b => b.bodyId === f.own.bodyId);
    const opponents = f.snapshot.bodies.filter(b => b.bodyId !== own.bodyId && !b.incapacitated && !b.dead && !f.tower.retiredBodyIds.includes(b.bodyId));
    const enemy = opponents.sort((a, b) => dist(own.pos, a.pos) - dist(own.pos, b.pos))[0];
    // This is the same selected ring available to a human, changed only by Tab.
    if (enemy) for (let n = 0; n < opponents.length; n++) {
      if (await page.evaluate(() => window.tvAscent.targetId) === enemy.bodyId) break;
      await page.keyboard.press('Tab');
    }
    const distance = enemy ? dist(own.pos, enemy.pos) : Infinity;
    if (f.own.breath < .35) catchingBreath = true;
    if (f.own.breath > .75) catchingBreath = false;
    if (!enemy && dist(own.pos, stations[patrol]) < 1) patrol = (patrol + 1) % stations.length;
    target = enemy?.pos ?? stations[patrol];
    if (Date.now() >= nextRoute) { path = route(plan, own.pos, target); nextRoute = Date.now() + 700; }
    while (path.length && dist(own.pos, path[0]) < .35) path.shift();
    if (catchingBreath) {
      const dx = enemy ? own.pos.x - enemy.pos.x : 0, dz = enemy ? own.pos.z - enemy.pos.z : 0;
      await keys(enemy && distance < 4 ? [Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'KeyD' : 'KeyA') : (dz > 0 ? 'KeyS' : 'KeyW')] : []);
      await page.waitForTimeout(120);
    } else if (enemy && distance < 5.5 && f.own.mana >= 22 && !(f.own.cast && !f.own.cast.resolved && !f.own.cast.cancelled)) {
      await keys([]); await page.keyboard.press('Digit1'); await page.waitForTimeout(950);
    } else if (enemy && distance < 1.8) {
      await keys(['KeyQ']); await page.waitForTimeout(180); await page.keyboard.press('KeyJ'); await page.waitForTimeout(550);
    } else {
      const to = path[0];
      // Approach the cell centre on both axes. A dominant-axis-only driver can
      // repeatedly scrape the same wall corner despite the displayed route being open.
      const input = [];
      if (to && Math.abs(to.x - own.pos.x) > .12) input.push(to.x > own.pos.x ? 'KeyD' : 'KeyA');
      if (to && Math.abs(to.z - own.pos.z) > .12) input.push(to.z > own.pos.z ? 'KeyS' : 'KeyW');
      if (enemy) input.push('KeyQ');
      await keys(input); await page.waitForTimeout(50);
    }
    if (Date.now() - lastShot > 15000) { lastShot = Date.now(); trace.push({ at: new Date().toISOString(), frame: f }); await shot(`combat-${trace.length}`); }
    if (f.tower.clear) break;
  }
  await keys([]); final = await page.evaluate(() => window.tvAscent.frame); metrics = await page.evaluate(() => window.tvAscent.inspect());
  await shot('02-after-combat');
  check('canonical combat produced an observed bodily consequence', final.own.health < initial.own.health || final.tower.defeated > initial.tower.defeated);
  check('accepted body-bound attacks or casts', metrics.receipts.some(r => r.status === 'executed' || r.result === 'accepted'));
  check('cleared the real first-floor encounter using live controls', final.tower.clear && final.tower.defeated === 3);
  check('brief combat did not produce hours of lasting fatigue', final.own.fatigue - initial.own.fatigue < .03);
  const identity = final.own.bodyId, runId = final.tower.id;
  await page.locator('#as-save').click(); await page.waitForTimeout(500); await page.reload();
  await page.waitForFunction(() => window.tvAscent?.ready, null, { timeout: 240000 });
  const resumed = await page.evaluate(() => window.tvAscent.frame);
  check('combat reload retained character/run and earned source', resumed.own.bodyId === identity && resumed.tower.id === runId && resumed.own.learned.some(a => a.id === 'book-ember'));
  check('combat reload did not grant health', resumed.own.health <= final.own.health + .1);
  await shot('03-reloaded'); check('no browser errors', errors.length === 0);
} catch (e) { errors.push(String(e)); console.error(e); await shot('failure'); process.exitCode = 1; }
finally {
  await keys([]); writeFileSync(resolve(out, 'result.json'), JSON.stringify({ kind: 'actual rendered keyboard traversal, concurrent regression load; not a benchmark', checks, errors, initial, final, metrics, trace }, null, 2));
  const video = page.video(); await context.close(); if (video) await video.saveAs(resolve(out, 'actual-combat.webm')); await browser.close();
}
