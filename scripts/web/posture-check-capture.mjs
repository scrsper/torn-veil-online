import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve('.debug/input-posture-repair/side-views-final'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], samples = [];
page.on('pageerror', e => { errors.push(String(e)); console.error('PAGE ERROR', String(e)); });
page.on('console', e => console.log('BROWSER', e.type(), e.text()));
try {
  await page.goto('http://127.0.0.1:7544/posture-check.html');
  console.log('POSE PAGE LOADED');
  await page.addScriptTag({ type: 'module', url: '/@fs/' + resolve('scripts/web/posture-check.ts').replaceAll('\\', '/') });
  if (errors.length) throw new Error(errors.join('\n'));
  await page.waitForFunction(() => window.tvPosture?.ready, null, { timeout: 240000 });
  for (const look of ['hero', 'wren', 'brann', 'mystic']) for (const pose of ['neutral', 'walk', 'run', 'combat']) for (const variant of ['before', 'after']) {
    const sample = await page.evaluate(({ variant, look, pose }) => window.tvPosture.select(variant, look, pose), { variant, look, pose });
    await page.waitForTimeout(500);
    const file = `${look}-${pose}-${variant}.png`; await page.screenshot({ path: resolve(out, file) }); samples.push({ ...sample, file });
    assert.deepEqual(sample.measurement.root, [0, 0, 0]);
    console.log('CAPTURE', file, sample.measurement);
  }
  for (const look of ['hero', 'wren', 'brann', 'mystic']) {
    const select = variant => samples.find(s => s.look === look && s.pose === 'neutral' && s.variant === variant).measurement;
    assert.ok(select('after').upper < select('before').upper, `${look} neutral upper chain should lose the transferred source curvature`);
    const combat = variant => samples.find(s => s.look === look && s.pose === 'combat' && s.variant === variant).measurement;
    assert.ok(Math.abs(combat('after').upper - combat('before').upper) < .001, `${look} existing UE unarmed combat transfer is preserved`);
  }
  assert.deepEqual(errors, []);
} finally {
  const gl = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null; }).catch(() => null);
  const video = page.video(); await context.close(); renameSync(await video.path(), resolve(out, 'matched-posture-fixtures.webm')); await browser.close();
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ scope: 'Actual rendered GLBs with authored fixed-phase poses, matched camera, historical/current retargeters. Controlled fixture, separate from gameplay, with no live-world commands.', errors, gpu: gl, samples }, null, 2));
}
