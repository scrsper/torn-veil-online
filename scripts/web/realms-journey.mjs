import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? 'docs/evidence/connected-realms/journey');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-size=1440,1000', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], samples = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const read = () => page.evaluate(() => window.tvRealms.inspect());
const wait = (fn, arg = null, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
const shot = async name => { await page.screenshot({ path: resolve(out, `${name}.png`) }); samples.push({ name, ...(await read()) }); console.log(name); };
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const distribution = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = q => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2)) : null;
  return { samples: sorted.length, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99), max: quantile(1) };
};
let result = 'failed';
try {
  await page.goto('http://127.0.0.1:7510/?realms', { waitUntil: 'domcontentloaded' });
  await wait(() => window.tvRealms?.ready, null, 90000);
  if ((await read()).state.realm === 'brass') {
    await page.locator('#rv-portal').click(); await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'));
    await page.keyboard.press('KeyE'); await page.locator('#rv-cross').click();
    await wait(() => window.tvRealms.state.realm === 'aether' && window.tvRealms.ready);
  }
  const initial = (await read()).state.person;
  assert.equal((await read()).state.realm, 'aether');
  await page.waitForTimeout(2000); await shot('01-aether');
  await page.locator('#rv-tower').click();
  // Let the guided path finish aligning with the actual opening. The interaction
  // prompt appears before arrival and is not proof that forward input clears a jamb.
  await wait(() => Math.hypot(window.tvRealms.state.body.pos.x - 3120.5, window.tvRealms.state.body.pos.z - 3120.5) < .6);
  await wait(() => window.tvRealms.state.prompt.includes('Tower'));
  if ((await read()).state.prompt.includes('Open Tower')) await page.keyboard.press('KeyE');
  await wait(() => window.tvRealms.state.doors.some(d => d.open));
  await hold('KeyW', 2700);
  await wait(() => window.tvRealms.state.tower);
  await shot('02-tower-atrium');
  await hold('KeyS', 2700);
  await wait(() => !window.tvRealms.state.tower);
  await page.locator('#rv-portal').click();
  await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'));
  await page.keyboard.press('KeyE');
  await wait(() => !!window.tvRealms.state.pending);
  await page.locator('#rv-cancel').click();
  await wait(() => !window.tvRealms.state.pending);
  assert.equal((await read()).state.realm, 'aether');
  await page.keyboard.press('KeyE');
  await page.locator('#rv-cross').click();
  await wait(() => window.tvRealms.state.realm === 'brass' && window.tvRealms.ready);
  assert.deepEqual((await read()).state.person, initial);
  await page.waitForTimeout(2000); await shot('03-cinderveil');
  // Reach the north-south avenue using ordinary strafe input, then cross a chunk boundary.
  await hold('KeyD', 4700);
  const beforeWalk = (await read()).state.body.pos;
  await page.keyboard.down('ShiftLeft'); await hold('KeyW', 20000); await page.keyboard.up('ShiftLeft');
  await wait(() => window.tvRealms.ready);
  const afterWalk = (await read()).state.body.pos;
  assert.ok(afterWalk.z - beforeWalk.z > 95, `Expected streamed traversal; got ${afterWalk.z - beforeWalk.z}m`);
  assert.equal((await read()).loaded, 81);
  await shot('04-streamed-brass-street');
  await page.locator('#rv-portal').click();
  await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'), null, 65000);
  await page.keyboard.press('KeyE'); await page.locator('#rv-cross').click();
  await wait(() => window.tvRealms.state.realm === 'aether' && window.tvRealms.ready);
  assert.deepEqual((await read()).state.person, initial);
  await page.locator('#rv-journal').click(); await page.locator('#rv-save').click(); await shot('05-shared-character'); await page.locator('#rv-close').click();
  await page.reload(); await wait(() => window.tvRealms?.ready, null, 90000);
  assert.deepEqual((await read()).state.person, initial);
  assert.ok((await read()).state.doors.some(d => d.open), 'Tower door must survive browser reload');
  for (let i = 0; i < 2; i++) {
    await page.locator('#rv-portal').click(); await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'));
    await page.keyboard.press('KeyE'); await page.locator('#rv-cross').click();
    await wait(realm => window.tvRealms.ready && window.tvRealms.state.realm === realm, i === 0 ? 'brass' : 'aether');
  }
  await shot('06-returned-aether');
  // Frame the Tower from the square with ordinary look/move input, without a debug teleport.
  await hold('ArrowLeft', 650); await hold('KeyS', 1800); await hold('ArrowUp', 300);
  await shot('07-tower-landmark');
  assert.deepEqual((await read()).state.person, initial); assert.equal(errors.length, 0, errors.join('\n'));
  result = 'passed';
} catch (e) { errors.push(String(e)); samples.push({ name: 'failure', ...(await read()) }); await page.screenshot({ path: resolve(out, 'failure.png') }); console.error(String(e)); }
finally {
  const health = await (await fetch('http://127.0.0.1:7510/realms/health')).json();
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ result, errors, samples, health, note: 'Observed headed Chrome at 1440x900 with video recording; automated ordinary keyboard/button input, not a human playtest.' }, null, 2));
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify({ result, errors, health,
    measurement: 'Observed headed Chrome at 1440x900 with video recording. Frame intervals include scheduling/recording overhead, not GPU timings. Buffers overlap between captures; do not sum rows. Buffers reset on page reload. Server timings cover the simulation step only, excluding projection, transport and saving.',
    samples: samples.map(s => ({ name: s.name, realm: s.state.realm, position: s.state.body.pos, hardware: s.hardware, width: s.width, height: s.height,
      loaded: s.loaded, pending: s.pending, meshes: s.meshes, textures: s.textures, materials: s.materials, heap: s.heap,
      frameMs: distribution(s.frames), streamingFrameMs: distribution(s.streamingFrames), chunkUploadMs: distribution(s.uploads), simulationStepMs: distribution(s.serverSamples),
      journeys: s.journeys.map(j => ({ realm: j.realm, initialStateToAllChunksMs: j.readyAt ? Number((j.readyAt - j.at).toFixed(2)) : null })) })) }, null, 2));
  const video = page.video(); await context.close(); if (video) await video.saveAs(resolve(out, 'traversal.webm')); await browser.close();
}
if (result !== 'passed') process.exitCode = 1;
