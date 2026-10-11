/** Ordinary-input matched capture. Fixtures are explicitly labeled developer scenarios. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const label = process.env.TV_MOTION_LABEL ?? 'before';
const out = resolve(process.env.TV_MOTION_EVIDENCE ?? `.debug/motion-oct9/${label}`); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], phases = [], checks = [];
page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const held = new Set();
async function keys(next = []) {
  for (const k of [...held]) if (!next.includes(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of next) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
async function hold(input, ms) { await keys(input); await page.waitForTimeout(ms); await keys(); }
async function capture(name) {
  const frame = await page.evaluate(() => window.tvMotion.frame);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
  phases.push({ name, at: Date.now(), tick: frame.snapshot.tick, bodies: frame.snapshot.bodies.map(b => ({ id: b.bodyId, pos: b.pos, pose: b.pose, action: b.combatAction, hitSeq: b.hitSeq, attackSeq: b.attackSeq })) });
  console.log(`CAPTURE ${label} ${name}`);
}
let result = 'failed', observation, gpu;
try {
  await page.goto(`${process.env.TV_MOTION_URL ?? 'http://127.0.0.1:7518'}/?motion-review`);
  await page.waitForFunction(() => window.tvMotion?.ready, null, { timeout: 180000 }); await page.waitForTimeout(1200);
  gpu = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null; });
  await capture('01-idle');
  await hold(['KeyS'], 750); await page.waitForTimeout(300); await capture('02-stop');
  await hold(['KeyD'], 550); await hold(['KeyA'], 550); await page.waitForTimeout(250); await capture('03-turn');
  await hold(['KeyW'], 750); await page.waitForTimeout(250);
  await hold(['KeyS', 'ShiftLeft'], 550); await hold(['KeyW', 'ShiftLeft'], 550); await page.waitForTimeout(350); await capture('04-run-stop');
  await page.locator('#motion-single').click(); await page.waitForTimeout(650);
  for (let i = 0; i < 4; i++) { await page.keyboard.press(i === 2 ? 'KeyL' : 'KeyJ'); await page.waitForTimeout(400); if (i === 1) await capture('05-combination'); await page.waitForTimeout(230); }
  await page.waitForTimeout(700); await capture('06-recovery');
  await keys(['KeyA']); await page.keyboard.press('Space'); await page.waitForTimeout(180); await capture('07-dodge'); await page.waitForTimeout(300); await keys();
  await hold(['KeyD'], 450); await page.waitForTimeout(500); await capture('08-after-dodge');
  await page.locator('#motion-incoming').click(); await page.waitForTimeout(2100); await capture('09-receive-hit');
  await hold(['KeyG'], 1000); await page.waitForTimeout(200);
  await page.locator('#motion-crowd').click(); await page.waitForTimeout(1000); await capture('10-five-opponents');
  await hold(['KeyG'], 800); await page.keyboard.press('Tab'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(650);
  await keys(['KeyS']); await page.keyboard.press('Space'); await page.waitForTimeout(450); await keys(); await page.waitForTimeout(1000); await capture('11-crowd-recovery');
  observation = await page.evaluate(() => window.tvMotion.inspect());
  assert.ok(observation.commands.some(c => c.status === 'applied'), 'ordinary commands reach canonical bridge'); checks.push('ordinary bound commands were applied');
  assert.ok(observation.mocap, 'existing mocap pack loaded'); checks.push('existing motion-capture assets loaded');
  assert.equal(observation.people, 6); checks.push('one hero and five canonical partners rendered');
  assert.ok(phases.some(p => p.bodies.some(b => b.hitSeq > 0))); checks.push('canonical contact was observed');
  result = 'passed';
} finally {
  await keys(); const video = page.video(); await context.close();
  const path = await video.path(); renameSync(path, resolve(out, `${label}-gameplay.webm`)); await browser.close();
  const quantile = (a, q) => [...a].sort((x,y) => x-y)[Math.min(a.length-1, Math.floor(a.length*q))] ?? null;
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ result, label, gpu, checks, errors, phases, observation,
    timing: observation ? { p50: quantile(observation.frames,.5), p95: quantile(observation.frames,.95), p99: quantile(observation.frames,.99), serverP95: quantile(observation.serverMs,.95) } : null }, null, 2));
  console.log(JSON.stringify({ result, checks, errors }));
}
