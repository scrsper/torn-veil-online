/** Actual browser journey from the input-driven headless completion save. The prior
 * fight is NOT portrayed as rendered play. This records subsequent real movement,
 * two realm crossings, Tower resumption and persistent canonical possessions. */
import { chromium } from 'playwright';
import { route } from './canonical-tower-qa-route.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7520';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/canonical-tower-oct9/portal'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), checks = [], errors = [], observations = [];
page.on('pageerror', e => errors.push(String(e))); page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
const wait = (fn, arg = null, timeout = 120000) => page.waitForFunction(fn, arg, { timeout });
const realmReady = () => wait(() => window.tvRealms?.ready), ascentReady = () => wait(() => window.tvAscent?.ready, null, 240000);
const realm = () => page.evaluate(() => window.tvRealms.state), ascent = () => page.evaluate(() => window.tvAscent.frame);
const shot = async name => page.screenshot({ path: resolve(out, name + '.png') });
const check = (name, ok) => { checks.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name); assert.ok(ok, name); };
async function collectAndAscend() {
  await page.goto(`${base}/?ascent`); await ascentReady(); const before = await ascent();
  check('continues the recorded real first-floor clearance', before.tower.floor === 1 && before.tower.clear && before.tower.defeated === 3);
  const plan = await page.evaluate(() => window.tvAscent.plan), held = new Set();
  const keys = async next => {
    for (const k of held) if (!next.includes(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of next) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const started = Date.now(); let path = [], nextRoute = 0;
  try { while (Date.now() - started < 120000) {
    const f = await ascent(), own = f.snapshot.bodies.find(b => b.bodyId === f.own.bodyId);
    if (f.snapshot.interactions.some(i => i.kind === 'open' && i.label.includes('sealed award'))) break;
    const target = f.containers.find(c => c.name.includes('sealed award'))?.pos ?? plan.exit;
    if (Date.now() >= nextRoute) { path = route(plan, own.pos, target); nextRoute = Date.now() + 700; }
    while (path.length && Math.hypot(path[0].x - own.pos.x, path[0].z - own.pos.z) < .3) path.shift();
    const to = path[0] ?? target, input = [];
    if (Math.abs(to.x - own.pos.x) > .12) input.push(to.x > own.pos.x ? 'KeyD' : 'KeyA');
    if (Math.abs(to.z - own.pos.z) > .12) input.push(to.z > own.pos.z ? 'KeyS' : 'KeyW');
    await keys(input); await page.waitForTimeout(50);
  } } finally { await keys([]); }
  await page.getByRole('button', { name: 'Open Floor 1 sealed award', exact: true }).click();
  await page.getByRole('button', { name: 'Take Tome from trial 1', exact: true }).click();
  await page.getByRole('button', { name: 'Take Trial provisions', exact: true }).click();
  await page.getByRole('button', { name: 'Study Tome from trial 1', exact: true }).click();
  await wait(() => window.tvAscent.frame.own.learned.some(a => a.id === 'book-ward'));
  check('collected and learned the finite reward through real hand controls', (await ascent()).own.sources.some(s => s.abilityId === 'book-ward'));
  await shot('00-earned-ward-at-chest'); await page.locator('#as-next').click();
  await wait(() => window.tvAscent.frame.tower.floor === 2);
  const next = await ascent(); check('physical stair preserved injuries body identity and learning', next.own.bodyId === before.own.bodyId && next.own.health < next.own.maxHealth && next.own.learned.some(s => s.id === 'book-ward'));
  await shot('00-ascended'); await leave();
}
async function enter() {
  const state = await realm();
  if (!state.tower) {
    await page.locator('#rv-tower').click();
    await wait(x => Math.hypot(window.tvRealms.state.body.pos.x - x, window.tvRealms.state.body.pos.z - 3120.5) < .6, state.realm === 'aether' ? 3120.5 : 11312.5);
    if ((await realm()).prompt.includes('Open Tower')) await page.keyboard.press('KeyE');
    await page.keyboard.down('KeyW');
    try { await wait(() => window.tvRealms.state.tower, null, 12000); } finally { await page.keyboard.up('KeyW'); }
  }
  await page.locator('#rv-canonical').click(); await ascentReady();
}
async function leave() { await page.locator('#as-return').click(); await realmReady(); }
async function cross(to, cancelFirst = false) {
  await page.locator('#rv-portal').click(); await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'));
  await page.keyboard.press('KeyE');
  if (cancelFirst) { await page.locator('#rv-cancel').click(); await wait(() => !window.tvRealms.state.pending); check('portal cancellation retained the departure realm', (await realm()).realm !== to); await page.keyboard.press('KeyE'); }
  await page.locator('#rv-cross').click(); await wait(realm => window.tvRealms?.ready && window.tvRealms.state.realm === realm, to);
}
try {
  if (process.env.TV_TOWER_FINISH_FLOOR === '1') await collectAndAscend();
  await page.goto(`${base}/?realms`); await realmReady(); const first = await realm(); observations.push(first);
  check('starts from the completed canonical fight save', first.canonicalTower.floor === 2 && first.person.inventory.some(i => i.name === 'Tome from trial 1'));
  await shot('01-earned-rewards-in-city'); await enter(); const entered = await ascent(); observations.push(entered.own);
  check('resumed floor two with the earned Ward and same body', entered.tower.floor === 2 && entered.own.bodyId === first.body.id && entered.own.learned.some(s => s.id === 'book-ward'));
  await shot('02-floor-two-earned-ward'); await page.reload(); await ascentReady();
  check('browser reload retained canonical run and learning', (await ascent()).tower.id === entered.tower.id && (await ascent()).own.learned.some(s => s.id === 'book-ward'));
  await leave(); await cross('brass', true); await shot('03-cinderveil-arrival'); await enter(); const other = await ascent();
  check('Cinderveil Tower resumes the same canonical floor', other.tower.id === entered.tower.id && other.tower.floor === 2 && other.own.id === first.person.id && other.own.bodyId === first.body.id);
  await shot('04-same-floor-from-cinderveil'); await leave(); await cross('aether'); await page.reload(); await realmReady(); const returned = await realm(); observations.push(returned);
  check('portal round trip retained identity inventory and rank', returned.realm === first.realm && returned.body.id === first.body.id && JSON.stringify(returned.person) === JSON.stringify(first.person));
  await shot('05-round-trip'); check('no browser errors', errors.length === 0);
} catch(e) { errors.push(String(e)); console.error(e); process.exitCode = 1; await shot('failure'); }
finally {
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ note: process.env.TV_TOWER_FINISH_FLOOR === '1' ? 'Continues the separately recorded actual keyboard fight save with real reward pickup, learning, ascent, return and two realm crossings. Concurrent tests; not a performance benchmark.' : 'Rendered journey starts from the input-driven headless completion save; it does not depict the prior fight. Concurrent tests; not a performance benchmark.', checks, errors, observations }, null, 2));
  const video = page.video(); await context.close(); if (video) await video.saveAs(resolve(out, 'actual-portal-round-trip.webm')); await browser.close();
}
