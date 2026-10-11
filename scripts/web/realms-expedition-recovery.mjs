import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7510';
const out = resolve('.debug/realms/combined-recovery'); mkdirSync(out, { recursive: true });
const disk = () => JSON.parse(readFileSync(resolve(process.env.TV_REALMS_SAVE ?? '.debug/realms/combined-world.json'), 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage(), checks = [], errors = [];
page.on('pageerror', e => errors.push(String(e)));
const wait = (fn, timeout = 180000) => page.waitForFunction(fn, null, { timeout });
const check = (name, ok) => { checks.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name); };
let result = 'failed';
try {
  await page.goto(`${base}/?realms`); await wait(() => window.tvRealms?.ready);
  if (await page.evaluate(() => window.tvRealms.state.expedition?.active)) { await page.locator('#rv-return').click(); await wait(() => window.tvRealms?.ready && !window.tvRealms.state.expedition?.active); }
  const initial = await page.evaluate(() => window.tvRealms.state);
  assert.ok(initial.tower && !initial.expedition.active, 'Run the combined journey first; recovery uses its retained atrium save.');
  await page.locator('#rv-ascend').click(); await wait(() => window.__arena?.tower && !window.__arena.realmBinding.busy);
  const run = await page.evaluate(() => window.__arena.tower.runId);
  const other = await context.newPage(); await other.goto(`${base}/?arena=1&tower=1&world=1`);
  await other.waitForFunction(() => document.body.textContent.includes('already has a controller'), null, { timeout: 20000 });
  check('second tab is rejected without stealing the active run', disk().realmExpedition.runId === run && disk().realmExpedition.active);
  await other.close(); await page.bringToFront();
  await page.goto(`${base}/?realms`); await wait(() => !!window.tvRealms?.state?.expedition?.active);
  check('world reload exposes active-expedition recovery controls', await page.locator('#rv-resume').isVisible() && await page.locator('#rv-return').isVisible());
  await page.locator('#rv-resume').click(); await wait(() => window.__arena?.tower && !window.__arena.realmBinding.busy);
  check('recovery resumes same checkpoint and run', await page.evaluate(id => window.__arena.tower.runId === id && window.__arena.tower.floor === 2, run));
  let injected = false;
  // Explicit fault fixture: fail one HTTP return before the host receives it.
  await page.route('**/realms/expedition', async route => {
    const request = route.request();
    if (!injected && request.method() === 'POST' && request.postDataJSON()?.type === 'return') { injected = true; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected return-save outage for recovery QA.' }) }); }
    else await route.continue();
  });
  await page.locator('#realm-tower-return').click();
  await wait(() => window.__arena?.realmBinding?.error.includes('Injected return-save outage'));
  check('failed return pauses the encounter and retains active disk state', await page.evaluate(() => window.__arena.realmBinding.busy) && disk().realmExpedition.active);
  await page.screenshot({ path: resolve(out, '01-failed-return-retained.png') });
  await page.locator('#realm-tower-return').click();
  await wait(() => window.tvRealms?.ready && !window.tvRealms.state.expedition?.active);
  const returned = await page.evaluate(() => window.tvRealms.state);
  check('same return request retries successfully without a second-return dead end', returned.person.id === initial.person.id && returned.body.id === initial.body.id && !disk().realmExpedition.active);
  await page.locator('#rv-ascend').click(); await wait(() => window.__arena?.tower && !window.__arena.realmBinding.busy);
  await page.unroute('**/realms/expedition'); let lostAcknowledgement = false;
  await page.route('**/realms/expedition', async route => {
    const request = route.request();
    if (!lostAcknowledgement && request.method() === 'POST' && request.postDataJSON()?.type === 'return') {
      lostAcknowledgement = true; const response = await route.fetch(); assert.equal(response.status(), 200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected lost return acknowledgement after durable commit.' }) });
    } else await route.continue();
  });
  await page.locator('#realm-tower-return').click(); await wait(() => window.__arena?.realmBinding?.error.includes('lost return acknowledgement'));
  check('lost acknowledgement retains the durable completed return', !disk().realmExpedition.active);
  await page.locator('#realm-tower-return').click(); await wait(() => window.tvRealms?.ready && !window.tvRealms.state.expedition?.active);
  check('acknowledged return retry is idempotent in the actual browser', await page.evaluate(id => window.tvRealms.state.expedition.runId === id, run));
  await page.locator('#rv-ascend').click(); await wait(() => window.__arena?.tower && !window.__arena.realmBinding.busy);
  await page.goto(`${base}/?realms`); await wait(() => !!window.tvRealms?.state?.expedition?.active);
  await page.locator('#rv-return').click(); await wait(() => window.tvRealms?.ready && !window.tvRealms.state.expedition?.active);
  const final = await page.evaluate(() => window.tvRealms.state);
  check('reopened world can return directly from the saved expedition binding', JSON.stringify(final.person) === JSON.stringify(initial.person) && final.tower);
  await page.screenshot({ path: resolve(out, '02-recovered-atrium.png') });
  check('no unhandled browser exceptions', errors.length === 0);
  result = 'passed';
} catch (e) { errors.push(String(e)); console.error(String(e)); await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {}); }
finally { writeFileSync(resolve(out,'report.json'), JSON.stringify({ result, checks, errors, note: 'Actual browser navigation and UI; two explicitly injected HTTP 503 responses: before host receipt and after durable return acknowledgement. It is a fault test, not an observed disk failure or combat benchmark.' },null,2)); await browser.close(); }
if (result !== 'passed') process.exitCode = 1;
