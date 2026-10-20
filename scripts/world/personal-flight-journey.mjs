import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
if (process.env.TV_FLIGHT_ISOLATED !== '1' || !process.env.TV_FLIGHT_URL || !process.env.TV_FLIGHT_EXPECT_SAVE)
  throw Error('Require explicit isolated URL, expected save path, and TV_FLIGHT_ISOLATED=1.');
const target = new URL(process.env.TV_FLIGHT_URL);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port !== '7510');
const health = await (await fetch(new URL('/realms/health', target))).json();
const key = p => resolve(p).replaceAll('\\', '/').toLowerCase();
assert.equal(key(health.savePath), key(process.env.TV_FLIGHT_EXPECT_SAVE));
assert.equal(health.ready, true); assert.equal(health.saveError, '');
const output = resolve(process.env.TV_FLIGHT_OUTPUT ?? `.debug/personal-flight-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(output, { recursive: true });
const report = { note: 'Ordinary UI journey against a parent-created, isolated capability fixture. No client capability grant, observer teleport, save edit or direct movement injection. This is not a progression-earned character claim.', checks: [], samples: [], errors: [], http: [], commands: {} };
const check = (ok, label) => { assert.ok(ok, label); report.checks.push(label); console.log('PASS ' + label); };
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
const watchdog = setTimeout(() => void browser.close(), 420000);
const error = message => {
  // Shader diagnostics can print entire programs; preserve the actual compiler
  // reason and counts without storing megabytes of generated shader source.
  if (/BJS .*: (Uniforms:|Defines:|Attributes:|Vertex code:|Fragment code:|#version)/.test(message)) {
    report.shaderDiagnosticBlocks = (report.shaderDiagnosticBlocks ?? 0) + 1; return;
  }
  const detail = message.slice(0, 1200);
  if (report.errors.length < 25 && !report.errors.includes(detail)) { report.errors.push(detail); console.log('BROWSER ERROR ' + detail.slice(0, 500)); }
};
page.on('pageerror', e => error(e.message));
page.on('console', m => { if (m.type() === 'error') error(m.text()); });
page.on('response', async r => {
  if (r.status() < 400 || report.http.length >= 25) return;
  const entry = { status: r.status(), path: new URL(r.url()).pathname };
  report.http.push(entry);
  // Record host rejection reasons, never response bodies/session tokens.
  if (entry.path === '/realms/universe/command') try { entry.reason = String((await r.json()).error ?? '').slice(0, 240); } catch {}
});
page.on('request', r => {
  if (r.method() !== 'POST') return;
  try {
    const data = r.postDataJSON(), type = data?.command?.type ?? data?.type;
    if (type) report.commands[type] = (report.commands[type] ?? 0) + 1;
  } catch {}
});
const save = () => writeFile(resolve(output, 'journey.json'), JSON.stringify(report, null, 2));
const wait = (fn, arg, timeout = 45000) => page.waitForFunction(fn, arg, { timeout });
const read = () => page.evaluate(() => {
  const d = window.__tvUniverse, s = d?.snapshot, c = d?.campaign;
  return { state: s?.state, status: s?.status, system: s?.system, preview: d?.preview,
    campaign: c ? { active: c.active, personId: c.personId, bodyId: c.bodyId, name: c.name, health: c.health, inventory: c.inventory,
      canExplore: c.canExplore, canReturn: c.canReturn, flight: c.flight, message: c.message } : null,
    atlas: d?.atlas, avatar: d?.avatar, settlements: d?.settlements, terrain: d?.stats, vessel: d?.vessel,
    phase: document.querySelector('[data-phase]')?.textContent, toast: document.querySelector('.astral-toast:not([hidden])')?.textContent };
});
const capture = async name => {
  const metrics = await page.evaluate(() => new Promise(resolve => {
    const intervals = [], draws = [], motionSamples = []; let last = performance.now(), previousDraw = null;
    const frame = now => {
      intervals.push(now - last); last = now;
      const r = window.__tvUniverse.render;
      if (intervals.length % 15 === 0) {
        const avatar = window.__tvUniverse.avatar;
        motionSamples.push({ clip: avatar.motion?.dominantClip, frame: avatar.motion?.frame, joints: avatar.joints });
      }
      if (previousDraw !== null) draws.push(r.drawCalls >= previousDraw ? r.drawCalls - previousDraw : r.drawCalls);
      previousDraw = r.drawCalls;
      if (intervals.length < 120) return requestAnimationFrame(frame);
      intervals.sort((a, b) => a - b); draws.sort((a, b) => a - b);
      resolve({ p50: intervals[60], p95: intervals[114], draws: draws[59], activeMeshes: r.activeMeshes, totalMeshes: r.totalMeshes, motionSamples });
    };
    requestAnimationFrame(frame);
  }));
  await page.screenshot({ path: resolve(output, name + '.png') });
  const view = await read();
  report.samples.push({ name, metrics, ...view });
  console.log(JSON.stringify({ capture: name, metrics: { ...metrics, motionSamples: undefined }, mode: view.state?.mode, altitude: view.status?.altitude,
    phase: view.state?.personalFlight?.phase, mana: view.campaign?.flight.manaAvailable, settlements: view.settlements, avatar: view.avatar?.ready, errors: report.errors.length }));
  await save();
};
const press = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const select = async id => {
  if (!(await page.locator('.astral-chart').isVisible())) await page.locator('[data-chart-toggle]').click();
  const state = await read(), index = state.system.planets.findIndex(p => p.id === id);
  await page.locator('.astral-world').nth(index).click();
  await wait(id => window.__tvUniverse.snapshot.state.targetPlanetId === id, id);
};
const navigate = async id => {
  await select(id); await page.locator('[data-cruise]').click();
  await wait(() => window.__tvUniverse.snapshot.state.cruise);
};
const arrive = id => wait(id => {
  const s = window.__tvUniverse.snapshot;
  return s.state.mode === 'flight' && !s.state.cruise && s.status.nearestPlanetId === id && s.status.altitude < 250;
}, id, 120000);
const land = async id => {
  await page.locator('[data-launch]').click();
  await wait(id => window.__tvUniverse.snapshot.state.mode === 'surface' && window.__tvUniverse.snapshot.state.landedPlanetId === id, id, 45000);
  await page.waitForTimeout(500);
};
let initial;
try {
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await wait(() => window.__tvUniverse?.campaign?.canExplore && window.__tvUniverse?.avatar.ready && window.__tvUniverse.settlements.focused > 0, null, 90000);
  initial = await read();
  check(!initial.campaign.active && !!initial.preview, 'Inactive page projects actual town before entry');
  check(initial.campaign.flight.canCrossSpace, 'Isolated fixture is admitted for interplanetary personal flight');
  await capture('00-town-preview');
  await page.locator('[data-board]').click();
  await wait(() => window.__tvUniverse.campaign.active && window.__tvUniverse.snapshot.state.mode === 'surface');
  const entered = await read();
  check(Math.hypot(...['x','y','z'].map(k => entered.state.position[k] - initial.preview.state.position[k])) < .05, 'Explore preserves the preview position');
  check(entered.state.settlementRevision === 1 && entered.state.explorerId === initial.campaign.personId, 'Mapped settlement traversal retains canonical identity');
  const httpBeforeHelp = report.http.length;
  await page.locator('[data-help]').click();
  await page.waitForTimeout(350);
  check(report.http.length === httpBeforeHelp, 'Opening ground controls produces no rejected travel command');
  const beforeHelp = JSON.stringify(report.commands);
  await page.keyboard.press('g'); await page.keyboard.press('f'); await page.keyboard.press('c');
  await page.waitForTimeout(350);
  check(JSON.stringify(report.commands) === beforeHelp, 'Help suppresses G/F/C travel commands');
  await page.locator('[data-close-help]').click();
  await press('w', 700); await page.waitForTimeout(350);
  await capture('01-town-on-foot');
  const beforeLift = await read();
  await page.keyboard.press('g');
  await wait(() => !!window.__tvUniverse.snapshot.state.personalFlight);
  const lifted = await read();
  check(lifted.state.personalFlight.bodyId === initial.campaign.bodyId, 'G lifts the same canonical body');
  check(Math.hypot(...['x','y','z'].map(k => lifted.state.position[k] - beforeLift.state.position[k])) < 3, 'Lift begins at the walked position without relocating to the vessel');
  const parked = structuredClone(lifted.state.parkedVessel);
  check(!!parked, 'Vessel has a retained parked position');
  check(await page.locator('[data-warp]').isDisabled(), 'Personal flight cannot use vessel warp');
  await press('e', 1800); await page.locator('[data-brake]').click(); await page.waitForTimeout(700);
  await capture('02-personal-ascent');
  const airborne = await read();
  check(airborne.avatar.visible && airborne.avatar.phase === 'flight', 'Shared hero is visible in personal flight');
  check(airborne.campaign.flight.manaAvailable < beforeLift.campaign.flight.manaAvailable, 'Powered flight spends canonical mana');
  const home = airborne.system.planets[0].id;
  const other = airborne.system.planets.filter(p => p.id !== home).sort((a, b) => {
    const distance = p => Math.hypot(...['x','y','z'].map(k => p.center[k] - airborne.state.position[k]));
    return distance(a) - distance(b);
  })[0].id;
  await navigate(other);
  await page.waitForTimeout(1000);
  await capture('03-between-worlds');
  await arrive(other); await capture('04-other-world-approach');
  await land(other); await capture('05-other-world-ground');
  const landed = await read();
  check(landed.state.landedVesselPosition === null, 'Foreign personal landing has no local vessel');
  check(!landed.phase.includes('within 60 m') && landed.phase.includes('vessel parked on'), 'Foreign surface HUD describes the parked vessel on its actual world');
  assert.deepEqual(landed.campaign.inventory, initial.campaign.inventory);
  check(landed.campaign.personId === initial.campaign.personId && landed.campaign.bodyId === initial.campaign.bodyId, 'Foreign landing retains full canonical identity and inventory');
  assert.deepEqual(landed.state.parkedVessel, parked);
  check(landed.state.discoveries.some(d => d.planetId === other && d.explorerId === initial.campaign.personId), 'Personal landing records the same explorer discovery');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(() => window.__tvUniverse?.ready && window.__tvUniverse.avatar.ready, null, 90000);
  const reloaded = await read();
  check(reloaded.campaign.personId === initial.campaign.personId && reloaded.campaign.bodyId === initial.campaign.bodyId && reloaded.state.landedPlanetId === other, 'Reload preserves body, person and foreign landing');
  assert.deepEqual(reloaded.campaign.inventory, initial.campaign.inventory);
  assert.deepEqual(reloaded.state.parkedVessel, parked);
  await capture('06-reloaded-foreign-ground');
  await page.keyboard.press('g'); await wait(() => !!window.__tvUniverse.snapshot.state.personalFlight);
  await navigate(home); await arrive(home); await land(home);
  await capture('07-returned-home');
  const returned = await read();
  check(returned.state.parkedVessel && returned.state.landedVesselPosition, 'Home landing restores access to the original parked vessel');
  assert.deepEqual(returned.campaign.inventory, initial.campaign.inventory);
  check(returned.campaign.personId === initial.campaign.personId && returned.campaign.bodyId === initial.campaign.bodyId, 'Home return retains full canonical identity and inventory');
  check(returned.campaign.canReturn, 'Home landing is admitted for canonical town return');
  await page.locator('[data-campaign-return]').click(); await page.waitForURL('**/?realms', { timeout: 20000 });
  check(true, 'Ordinary return control reaches the town view');
  check(report.http.length === 0, 'No rejected or failed HTTP requests during journey');
  check(report.errors.length === 0, 'No browser runtime or asset errors during journey');
} catch (e) {
  report.failure = String(e); console.error(e);
  try { report.lastState = await read(); await page.screenshot({ path: resolve(output, 'failure.png') }); } catch {}
  process.exitCode = 1;
} finally {
  await save(); clearTimeout(watchdog); await browser.close();
}
