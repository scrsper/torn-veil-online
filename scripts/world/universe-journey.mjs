// Bounded browser acceptance using ordinary UI controls against an isolated host.
// Start with TORN_VEIL_UNIVERSE_HOME=<test-directory> npm run universe:play -- --no-open.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TV_UNIVERSE_TEST_URL || 'http://127.0.0.1:7525';
const output = resolve(process.env.TV_UNIVERSE_EVIDENCE || '.debug/universe-evidence');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__tvUniverse.snapshot);
const check = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
const ready = () => page.waitForFunction(() => window.__tvUniverse?.ready, null, { timeout: 60000 });
const arrival = id => page.waitForFunction(id => { const s = window.__tvUniverse.snapshot; return s.state.mode === 'flight' && !s.state.cruise && s.status.nearestPlanetId === id && s.status.canLand; }, id, { timeout: 90000 });
const land = async () => { await page.locator('[data-launch]').click(); await page.waitForFunction(() => window.__tvUniverse.snapshot.state.mode === 'surface', null, { timeout: 15000 }); };
try {
  await page.goto(`${base}/?universe`, { waitUntil: 'domcontentloaded' }); await ready();
  const initial = await snapshot();
  check(initial.state.mode === 'surface' && initial.state.systemIndex === 0, 'Isolated expedition starts on home surface');
  const home = initial.system.planets[0].id, destination = initial.system.planets[1].id;
  await page.waitForTimeout(1800); await page.screenshot({ path: resolve(output, '01-home.png') });
  await page.locator('[data-launch]').click();
  await page.waitForFunction(() => window.__tvUniverse.snapshot.state.mode === 'flight');
  await page.locator('.astral-world').nth(1).click(); await page.locator('[data-cruise]').click();
  await page.waitForFunction(() => window.__tvUniverse.snapshot.state.cruise);
  await page.waitForTimeout(7000); await page.screenshot({ path: resolve(output, '02-transit.png') });
  await arrival(destination); check((await snapshot()).state.cruise === false, 'Assisted travel brakes above destination');
  await page.screenshot({ path: resolve(output, '03-approach.png') });
  await land(); const landed = await snapshot();
  check(landed.state.landedPlanetId === destination, 'UI landing reaches selected world');
  check(landed.state.explorerId === initial.state.explorerId && landed.state.vesselId === initial.state.vesselId, 'Identity survives interplanetary journey');
  check(landed.state.discoveries.some(d => d.planetId === destination), 'Landing records discovery');
  await page.waitForTimeout(1600); await page.screenshot({ path: resolve(output, '04-new-world.png') });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(600); await page.keyboard.up('KeyW'); await page.waitForTimeout(300);
  const walked = await snapshot();
  check(Math.hypot(walked.state.position.x - landed.state.position.x, walked.state.position.y - landed.state.position.y, walked.state.position.z - landed.state.position.z) > 1, 'Ordinary keyboard input walks on destination surface');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  const resumed = await snapshot(); check(resumed.state.explorerId === initial.state.explorerId && resumed.state.discoveries.length === walked.state.discoveries.length, 'Browser reload resumes host identity and discoveries');
  await page.locator('[data-launch]').click(); await page.waitForFunction(() => window.__tvUniverse.snapshot.state.mode === 'flight');
  await page.locator('.astral-world').nth(0).click(); await page.locator('[data-cruise]').click(); await arrival(home); await land();
  const returned = await snapshot(); check(returned.state.landedPlanetId === home, 'Round trip returns to original world');
  check(returned.state.discoveries.filter(d => d.planetId === home).length === 1, 'Return visit does not duplicate discovery');
  check(!returned.state.events.some(e => e.type === 'collision'), 'Assisted route completes without terrain collision');
  await page.setViewportSize({ width: 760, height: 540 }); await page.locator('[data-chart-toggle]').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(output, '05-compact.png') });
  const performance = await page.evaluate(() => new Promise(done => { const frames = []; let last = window.performance.now(); function frame(t) { frames.push(t-last); last=t; if(frames.length<120)requestAnimationFrame(frame);else{frames.sort((a,b)=>a-b);done({medianMs:frames[60],p95Ms:frames[114],terrain:window.__tvUniverse.stats})} } requestAnimationFrame(frame); }));
  check(errors.length === 0, 'No browser errors during journey');
  const result = { checks, errors, performance, final: returned };
  await writeFile(resolve(output, 'journey.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ checks, errors, performance, output }, null, 2));
} catch (error) { await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); console.error(JSON.stringify({ checks, errors, failure: error.message })); process.exitCode = 1; }
finally { await browser.close(); }
