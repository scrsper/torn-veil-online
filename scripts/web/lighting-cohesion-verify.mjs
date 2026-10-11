/** Controlled lighting comparison on a single frozen render pose, plus condition captures. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.TV_MOTION_URL ?? 'http://127.0.0.1:7517';
const out = process.env.TV_LIGHTING_OUT ?? '.debug/quality-pass/lighting';
const health = await fetch(base + '/api/health').then(r => r.json());
assert.equal(health.isolation, 'Disposable town and gym; no save access');
const control = async body => {
  const result = await fetch(base + '/api/gym/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(result.ok); return result.json();
};
mkdirSync(out, { recursive: true });
await control({ action: 'switch', scenario: 'town' });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [], rows = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '/?gym=1&scenario=town&autoplay=1&view=third-person&renderer=webgl2&hour=11');
  await page.waitForFunction(() => window.__tv?.ready && window.__tv.link.playable, null, { timeout: 180000 });
  await page.waitForTimeout(1800); await control({ action: 'pause', paused: true });
  await page.evaluate(() => window.__tv.ctx.engine.stopRenderLoop());
  const conditions = [
    ['before-clear11', 11, 'clear', true], ['after-clear11', 11, 'clear', false],
    ['dusk', 18.5, 'clear', false], ['night', 23, 'clear', false],
    ['rain', 11, 'rain', false], ['night-rain', 23, 'rain', false],
  ];
  for (const [name, hour, kind, old] of conditions) {
    rows.push(await page.evaluate(({ name, hour, kind, old }) => {
      const app = window.__tv, a = app.atmosphere;
      a.update(hour, { kind, intensity: kind === 'clear' ? 0 : 1, wind: .2 }, 0);
      if (old) {
        // Exact clear-noon light channels from commit679ce9a. Sky, exposure,
        // environment texture, material, camera and bone poses remain identical.
        a.key.intensity = 3.596; a.fill.intensity = .7644;
        a.fill.diffuse.set(.5, .58, .72); a.fill.groundColor.set(.3, .26, .2);
      }
      app.ctx.scene.render(false, true); app.ctx.scene.render(false, true);
      return { name, hour, kind, old, key: a.key.intensity, fill: a.fill.intensity,
        skyFill: a.fill.diffuse.asArray(), groundFill: a.fill.groundColor.asArray(), exposure: app.ctx.pipeline.imageProcessing.exposure,
        camera: app.camera.position.asArray(), rotation: app.camera.rotation.asArray(), origin: app.regions.origin,
        renderer: app.ctx.kind, quality: app.ctx.quality.tier, resolution: [app.ctx.engine.getRenderWidth(), app.ctx.engine.getRenderHeight()] };
    }, { name, hour, kind, old }));
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  assert.deepEqual(rows[0].camera, rows[1].camera); assert.equal(rows[0].exposure, rows[1].exposure); assert.deepEqual(errors, []);
  writeFileSync(out + '/conditions.json', JSON.stringify({ note: 'Single paused world and frozen camera/animation/grass. Scene.render(false,true) skips animation evaluation. Before changes only clear11 light channels. Weather overrides affect atmosphere only, not canonical weather, particles or material wetness. Screenshots are not a performance or subjective quality verdict.', rows, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, out, conditions: rows.length, errors }));
} finally { await browser.close(); }
