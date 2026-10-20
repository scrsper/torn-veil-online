/**
 * Bounded ordinary-UI acceptance against an explicitly isolated canonical realm host.
 *
 * Required opt-in: TV_UNIVERSE_CAMPAIGN_ISOLATED=1
 * URL: TV_UNIVERSE_CAMPAIGN_URL=http://127.0.0.1:7531/?universe&campaign
 * Optional exact host-save check: TV_UNIVERSE_CAMPAIGN_EXPECT_SAVE=<test world.json>
 * Return-only recovery: TV_UNIVERSE_CAMPAIGN_RESUME_RETURN=1 (requires an already
 * active character landed at home; never injects or skips required travel state).
 * Run: node scripts/world/universe-campaign-journey.mjs
 *
 * This script never launches a host, edits saves, submits debug commands, or injects
 * travel state. Browser interactions intentionally advance the isolated test world.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

if (process.env.TV_UNIVERSE_CAMPAIGN_ISOLATED !== '1') {
  throw Error('Refusing to drive a default world. Set TV_UNIVERSE_CAMPAIGN_ISOLATED=1 only for a separately saved test host.');
}
const target = new URL(process.env.TV_UNIVERSE_CAMPAIGN_URL || 'http://127.0.0.1:7531/?universe&campaign');
assert.ok(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname), 'Campaign acceptance requires a loopback HTTP test host');
assert.ok(target.port && target.port !== '7510', 'Use an explicit isolated port, not the standard realm host on 7510');
assert.ok(!target.username && !target.password, 'Do not put credentials in the acceptance URL');
assert.ok(target.searchParams.has('universe') && target.searchParams.has('campaign'), 'URL must select ?universe&campaign');
const output = resolve(process.env.TV_UNIVERSE_CAMPAIGN_EVIDENCE || '.debug/universe-campaign-evidence');
const resumeReturn = process.env.TV_UNIVERSE_CAMPAIGN_RESUME_RETURN === '1';
const checks = [], samples = [], browserErrors = [], httpErrors = [], intentionalNetworkErrors = [], commandCounts = new Map();
let injectingReadFailure = false;
const inventory = items => (items ?? []).map(({ id, name, quantity }) => ({ id, name, quantity })).sort((a, b) => a.id.localeCompare(b.id));
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); console.log(`PASS ${message}`); };
const same = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks.push(message); console.log(`PASS ${message}`); };
const readJson = async path => {
  const response = await fetch(new URL(path, target), { signal: AbortSignal.timeout(5000), cache: 'no-store' });
  assert.ok(response.ok, `Read-only ${path} returned HTTP ${response.status}`);
  return response.json();
};
const healthSummary = h => ({
  kind: h.kind, ready: h.ready, seed: h.seed, savePath: h.savePath,
  saveError: h.saveError, updateError: h.updateError,
});
const inspectionSummary = result => ({
  personId: result.world?.personId, bodyId: result.world?.bodyId,
  inventory: inventory(result.person?.truth?.economy?.inventory),
  manifestations: result.person?.truth?.overview?.bodyManifestations?.map(({ id, present, pos }) => ({ id, present, pos })),
  eventCount: result.world?.events,
  recentEvents: result.events?.slice(0, 12).map(({ id, type, actor, summary }) => ({ id, type, actor, summary })),
});
const initialHealth = await readJson('/realms/health');
assert.equal(initialHealth.kind, 'torn-veil-realms', 'Expected the canonical realm host');
assert.equal(initialHealth.ready, true, 'Canonical host must be healthy before UI actions');
assert.equal(initialHealth.saveError, '', 'Host must have no persistence error before UI actions');
if (process.env.TV_UNIVERSE_CAMPAIGN_EXPECT_SAVE) {
  const pathKey = path => resolve(path).replaceAll('\\', '/').toLowerCase();
  assert.equal(pathKey(initialHealth.savePath), pathKey(process.env.TV_UNIVERSE_CAMPAIGN_EXPECT_SAVE), 'Host save does not match the explicitly isolated fixture');
}
const baseline = inspectionSummary(await readJson('/realms/inspection'));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.TV_UNIVERSE_CAMPAIGN_HEADED !== '1',
  args: ['--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(30000);
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; void browser.close(); }, 300000);
deadline.unref();
const recordError = message => {
  const bounded = String(message).slice(0, 1200);
  if (browserErrors.length < 20 && !browserErrors.includes(bounded)) browserErrors.push(bounded);
};
page.on('pageerror', error => recordError(error.message));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const source = message.location().url;
  if (injectingReadFailure && message.text() === 'Failed to load resource: net::ERR_FAILED'
    && source && new URL(source).pathname === '/realms/universe') {
    intentionalNetworkErrors.push({ source: '/realms/universe', message: message.text() });
  } else recordError(message.text());
});
page.on('response', response => {
  if (response.status() < 400 || httpErrors.length >= 20) return;
  // Paths identify failing endpoints without retaining controller/session query parameters.
  const error = { status: response.status(), path: new URL(response.url()).pathname, method: response.request().method() };
  if (!httpErrors.some(previous => previous.status === error.status && previous.path === error.path)) httpErrors.push(error);
});
page.on('request', request => {
  if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/universe/command')) return;
  // Observe action types only; controller/session tokens never enter the evidence.
  try {
    const type = request.postDataJSON()?.command?.type;
    if (typeof type === 'string') commandCounts.set(type, (commandCounts.get(type) ?? 0) + 1);
  } catch { /* Non-JSON requests are reported by the normal browser error checks. */ }
});
const wait = (predicate, arg = null, timeout = 45000) => page.waitForFunction(predicate, arg, { timeout });
const ready = () => wait(() => window.__tvUniverse?.ready && window.__tvUniverse.campaign?.active, null, 60000);
const readUniverse = () => page.evaluate(() => {
  const view = window.__tvUniverse, snapshot = view?.snapshot, state = snapshot?.state;
  if (!view) return null;
  const campaign = view.campaign;
  return {
    campaign: campaign ? {
      active: campaign.active, personId: campaign.personId, bodyId: campaign.bodyId,
      name: campaign.name, rank: campaign.rank, health: campaign.health, maxHealth: campaign.maxHealth,
      inventory: campaign.inventory, canEnter: campaign.canEnter, canReturn: campaign.canReturn, message: campaign.message,
    } : null,
    state: state ? {
      mode: state.mode, systemIndex: state.systemIndex, tick: state.tick,
      explorerId: state.explorerId, vesselId: state.vesselId, position: state.position,
      targetPlanetId: state.targetPlanetId, landedPlanetId: state.landedPlanetId,
      cruise: state.cruise, landing: state.landing,
      discoveryCount: state.discoveries.length,
      discoveries: state.discoveries.slice(-128).map(({ planetId, explorerId }) => ({ planetId, explorerId })),
      collisionCount: state.events.filter(event => event.type === 'collision').length,
      recentEvents: state.events.slice(-12).map(({ type, planetId, tick }) => ({ type, planetId, tick })),
    } : null,
    planets: snapshot?.system.planets.map(({ id, name, kind }) => ({ id, name, kind })),
    status: snapshot?.status, stats: view.stats,
  };
});
const screenshot = async name => {
  await page.screenshot({ path: resolve(output, `${name}.png`) });
  samples.push({ name, elapsedMs: Date.now() - started, universe: await readUniverse() });
  console.log(`CAPTURE ${name}`);
};
const assertIdentity = (view, initial, message) => {
  same([view.campaign.personId, view.campaign.bodyId, view.state.explorerId, view.state.vesselId],
    [initial.campaign.personId, initial.campaign.bodyId, initial.state.explorerId, initial.state.vesselId], message);
  same(inventory(view.campaign.inventory), inventory(initial.campaign.inventory), `${message}: inventory`);
};
const selectWorld = async id => {
  const view = await readUniverse(), index = view.planets.findIndex(planet => planet.id === id);
  assert.ok(index >= 0, `World ${id} is present in chart`);
  if (!(await page.locator('.astral-chart').isVisible())) await page.locator('[data-chart-toggle]').click();
  await page.locator('.astral-world').nth(index).click();
  await wait(id => window.__tvUniverse.snapshot.state.targetPlanetId === id, id);
};
const arrive = id => wait(id => {
  const snapshot = window.__tvUniverse?.snapshot;
  return snapshot?.state.mode === 'flight' && !snapshot.state.cruise && !snapshot.state.landing
    && snapshot.status.nearestPlanetId === id && snapshot.status.canLand;
}, id, 90000);
const land = async id => {
  await page.locator('[data-launch]').click();
  await wait(id => {
    const state = window.__tvUniverse?.snapshot?.state;
    return state?.mode === 'surface' && state.landedPlanetId === id;
  }, id, 20000);
  await wait(() => document.querySelector('.astral-ui')?.dataset.mode === 'surface'
    && document.querySelector('[data-launch]')?.textContent?.startsWith('Launch'), null, 5000);
  // The canonical landing event precedes the presentation camera settling.
  await page.waitForTimeout(600);
};
const navigate = async id => {
  await selectWorld(id);
  await page.locator('[data-cruise]').click();
  await wait(() => window.__tvUniverse?.snapshot?.state.cruise === true, null, 15000);
};
const networkProbe = async () => {
  const pattern = /\/realms\/universe(?:\?.*)?$/;
  const activeReads = new Set();
  let phase = 'latency', maxConcurrentReads = 0, delayedReadsFinished = 0;
  let staleRoute, observeRoute, intentionalFailures = 0;
  let announceStale, announceObserve;
  const staleReady = new Promise(resolve => { announceStale = resolve; });
  const observeReady = new Promise(resolve => { announceObserve = resolve; });
  const isRead = request => request.method() === 'GET' && new URL(request.url()).pathname === '/realms/universe';
  const startedRead = request => {
    if (!isRead(request)) return;
    activeReads.add(request); maxConcurrentReads = Math.max(maxConcurrentReads, activeReads.size);
  };
  const finishedRead = request => {
    if (activeReads.delete(request) && phase === 'latency') delayedReadsFinished++;
  };
  const failedRead = request => {
    activeReads.delete(request);
    if (request === staleRoute?.request()) intentionalFailures++;
  };
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const bounded = (promise, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label} did not arrive within 10 seconds`)), 10000);
    })]).finally(() => clearTimeout(timer));
  };
  const routeRead = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (phase === 'latency') { await delay(1200); return route.continue(); }
    if (phase === 'stale') { staleRoute = route; announceStale(); return; }
    if (phase === 'observe') { observeRoute = route; announceObserve(); return; }
    return route.continue();
  };
  page.on('request', startedRead); page.on('requestfinished', finishedRead); page.on('requestfailed', failedRead);
  await page.route(pattern, routeRead);
  try {
    const latencyStart = Date.now();
    while (delayedReadsFinished < 3 && Date.now() - latencyStart < 10000) await delay(50);
    check(delayedReadsFinished >= 3 && maxConcurrentReads === 1, 'Slow 1.2-second reads remain serialized');
    phase = 'stale';
    await bounded(staleReady, 'Delayed stale read');
    const staleAt = Date.now();
    const before = await readUniverse();
    const alternate = before.planets.find(planet => planet.id !== before.state.targetPlanetId);
    await selectWorld(alternate.id);
    await delay(Math.max(0, 800 - (Date.now() - staleAt)));
    phase = 'observe'; injectingReadFailure = true;
    await staleRoute.abort('failed');
    await bounded(observeReady, 'Read following the injected failure');
    await delay(400);
    const connection = await page.evaluate(() => ({
      offline: document.querySelector('.astral-status')?.classList.contains('offline'),
      targetPlanetId: window.__tvUniverse?.snapshot?.state.targetPlanetId,
    }));
    check(connection.offline === false, 'An older failed read cannot mark a newer accepted action offline');
    same(connection.targetPlanetId, alternate.id, 'An older failed read preserves the newer selected world');
    phase = 'pass';
    await observeRoute.continue();
    observeRoute = null;
    await delay(250);
    check(intentionalFailures === 1, 'Exactly one stale read failure was deliberately injected');
    return { delayedReadsFinished, maxConcurrentReads, staleReadDelayMs: 800, intentionalFailures, connection };
  } finally {
    phase = 'pass';
    if (observeRoute) await observeRoute.continue().catch(() => {});
    if (staleRoute) await staleRoute.continue().catch(() => {});
    await page.unroute(pattern, routeRead);
    page.off('request', startedRead); page.off('requestfinished', finishedRead); page.off('requestfailed', failedRead);
    injectingReadFailure = false;
  }
};
const started = Date.now();
let result = 'failed', failure = null, finalHealth = null, town = null, finalInspection = null, boardingReview = null, networkReview = null;
try {
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  if (resumeReturn) {
    await ready();
    const resumed = await readUniverse();
    same([resumed.campaign.personId, resumed.campaign.bodyId, resumed.state.explorerId],
      [baseline.personId, baseline.bodyId, baseline.personId], 'Return recovery resumes the persisted canonical character');
    same(inventory(resumed.campaign.inventory), baseline.inventory, 'Return recovery retains the carried items');
    check(resumed.state.mode === 'surface' && resumed.state.systemIndex === 0
      && resumed.state.landedPlanetId === resumed.planets[0].id, 'Return recovery begins at the already reached home world');
    check(resumed.state.discoveryCount >= 2, 'Return recovery retains the previous interplanetary discovery');
    await wait(() => window.__tvUniverse?.campaign?.canReturn === true, null, 30000);
    await wait(() => window.__tvUniverse?.stats?.pendingTiles === 0, null, 20000);
    await screenshot('08-home-return-recovered');
  } else {
  await wait(() => window.__tvUniverse?.campaign?.canEnter === true);
  const boarding = await readUniverse();
  check(boarding.campaign.active === false && await page.locator('[data-board]').isVisible(), 'Inactive saved character reaches the boarding UI');
  same([boarding.campaign.personId, boarding.campaign.bodyId], [baseline.personId, baseline.bodyId], 'Boarding refers to the existing canonical person and body');
  same(inventory(boarding.campaign.inventory), baseline.inventory, 'Boarding displays existing carried items');
  await screenshot('00-boarding');
  await page.locator('[data-board]').click();
  await ready();
  const initial = await readUniverse();
  check(initial.state.mode === 'surface' && initial.state.systemIndex === 0, 'UI boarding reaches the home surface');
  same(initial.state.explorerId, initial.campaign.personId, 'Explorer identity is the canonical person ID');
  same(initial.campaign.bodyId, baseline.bodyId, 'Canonical body identity survives boarding');
  same(inventory(initial.campaign.inventory), baseline.inventory, 'Boarding preserves canonical inventory');
  const home = initial.planets[0].id, destination = initial.planets[1].id;
  await page.waitForTimeout(500);
  await screenshot('01-home-first-500ms');
  await wait(() => window.__tvUniverse?.stats?.pendingTiles === 0, null, 20000);
  await screenshot('02-home-settled');

  await page.keyboard.press('KeyF');
  await wait(() => window.__tvUniverse?.snapshot?.state.mode === 'flight', null, 15000);
  await selectWorld(destination);
  await wait(() => window.__tvUniverse?.snapshot?.status.canLand === true, null, 10000);
  await wait(() => {
    const snapshot = window.__tvUniverse?.snapshot, label = document.querySelector('[data-target]')?.textContent ?? '';
    return snapshot?.state.targetPlanetId !== snapshot?.status.nearestPlanetId && !label.includes('landing available');
  }, null, 5000);
  check(!(await page.locator('[data-target]').innerText()).includes('landing available'), 'Remote selected world does not inherit the nearby landing label');

  await page.locator('[data-help]').click();
  await page.waitForTimeout(300);
  const actionCounts = () => ['launch', 'land', 'navigate'].map(type => commandCounts.get(type) ?? 0);
  const beforeHelp = actionCounts();
  await page.keyboard.press('KeyF'); await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  same(actionCounts(), beforeHelp, 'Help suppresses F/C action requests');
  const afterHelp = await readUniverse();
  check(afterHelp.state.mode === 'flight' && !afterHelp.state.cruise && !afterHelp.state.landing, 'Help hotkeys cannot launch landing or assisted navigation');
  await screenshot('03-help-input-guard');
  await page.locator('[data-close-help]').click();

  await navigate(destination);
  await page.waitForTimeout(2500);
  await screenshot('04-interplanetary-transit');
  await arrive(destination);
  check((await readUniverse()).status.nearestPlanetId === destination, 'Assisted passage arrives above the selected world');
  await screenshot('05-destination-approach');
  await land(destination);
  const landed = await readUniverse();
  assertIdentity(landed, initial, 'Interplanetary landing preserves canonical identity');
  check(landed.state.discoveries.some(discovery => discovery.planetId === destination && discovery.explorerId === baseline.personId), 'Discovery belongs to the canonical person');
  await wait(() => window.__tvUniverse?.stats?.pendingTiles === 0, null, 20000);
  await screenshot('06-destination-surface');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  const resumed = await readUniverse();
  assertIdentity(resumed, initial, 'Browser reload resumes the same canonical character');
  same(resumed.state.discoveryCount, landed.state.discoveryCount, 'Browser reload retains discoveries');
  same(resumed.state.landedPlanetId, destination, 'Browser reload retains the landed world');
  await screenshot('07-destination-resumed');

  await page.keyboard.press('KeyF');
  await wait(() => window.__tvUniverse?.snapshot?.state.mode === 'flight', null, 15000);
  await navigate(home);
  await arrive(home); await land(home);
  await wait(() => window.__tvUniverse?.campaign?.canReturn === true, null, 30000);
  const returned = await readUniverse();
  assertIdentity(returned, initial, 'Return passage preserves canonical identity');
  check(returned.state.discoveries.filter(discovery => discovery.planetId === home).length === 1, 'Home return does not duplicate discovery');
  same(returned.state.collisionCount, initial.state.collisionCount, 'Assisted round trip adds no terrain collision events');
  await screenshot('08-home-return');
  }
  await page.locator('[data-campaign-return]').click();
  await page.waitForURL(url => url.origin === target.origin && url.searchParams.has('realms'), { timeout: 20000 });
  await wait(() => !!window.tvRealms?.state, null, 90000);
  town = await page.evaluate(() => {
    const state = window.tvRealms.state;
    return { realm: state.realm, personId: state.person.id, bodyId: state.body.id,
      inventory: state.person.inventory, health: state.body.hp, maxHealth: state.body.maxHp, position: state.body.pos,
      nearbyVisibleBodies: state.residents.map(resident => ({ id: resident.id, position: resident.pos,
        horizontalDistance: Math.hypot(resident.pos.x - state.body.pos.x, resident.pos.z - state.body.pos.z),
        verticalDistance: Math.abs(resident.pos.y - state.body.pos.y) }))
        .filter(resident => resident.horizontalDistance < 4).slice(0, 12) };
  });
  same([town.personId, town.bodyId], [baseline.personId, baseline.bodyId], 'Return-to-town UI restores the original canonical person and body');
  same(inventory(town.inventory), baseline.inventory, 'Return to town preserves the original carried items');
  const arrivalAnchor = baseline.manifestations.find(body => body.id === baseline.bodyId)?.pos;
  check(arrivalAnchor && Math.hypot(town.position.x - arrivalAnchor.x, town.position.y - arrivalAnchor.y,
    town.position.z - arrivalAnchor.z) <= 3.00001, 'Town return resolves within three metres of the saved arrival');
  check(town.nearbyVisibleBodies.every(body => body.horizontalDistance >= .8 || body.verticalDistance >= 1.8),
    'Returned position clears the nearby visible town bodies');
  finalInspection = inspectionSummary(await readJson('/realms/inspection'));
  same([finalInspection.personId, finalInspection.bodyId], [baseline.personId, baseline.bodyId], 'Read-only host inspection confirms returned identity');
  same(finalInspection.inventory, baseline.inventory, 'Read-only host inspection confirms inventory continuity');
  check(finalInspection.manifestations.some(body => body.id === baseline.bodyId && body.present), 'Returned canonical body is present in the town world');
  await page.waitForFunction(() => window.tvRealms?.ready, null, { timeout: 45000 }).catch(() => {});
  town.presentationReady = await page.evaluate(() => window.tvRealms?.ready === true);
  const beginJourney = page.getByRole('button', { name: 'Begin journey', exact: true });
  if (await beginJourney.isVisible()) {
    await beginJourney.click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: resolve(output, '09-returned-town.png') });
  if (!(await page.locator('#rv-universe').isVisible())) await page.locator('.rv-wayfinder > summary').click();
  await page.locator('#rv-universe').click();
  await page.waitForURL(url => url.origin === target.origin && url.searchParams.has('universe') && url.searchParams.has('campaign'));
  await wait(() => window.__tvUniverse?.campaign?.active === false && window.__tvUniverse.campaign.canEnter);
  boardingReview = await page.evaluate(() => new Promise(resolve => {
    const labels = new Set(), hiddenSelectors = ['.astral-flight', '.astral-location', '.astral-chart', '.astral-chart-toggle', '.astral-reticle', '.astral-target'];
    let frameCount = 0;
    const frame = () => {
      labels.add(document.querySelector('[data-link]')?.textContent ?? '');
      if (++frameCount < 120) { requestAnimationFrame(frame); return; }
      resolve({
        frameCount, labels: [...labels],
        hiddenChrome: hiddenSelectors.every(selector => {
          const element = document.querySelector(selector), rect = element?.getBoundingClientRect();
          return !!element && (!rect?.width || !rect.height || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden');
        }),
        active: window.__tvUniverse.campaign.active,
      });
    };
    requestAnimationFrame(frame);
  }));
  check(boardingReview.hiddenChrome, 'Boarding keeps flight and chart controls hidden');
  check(boardingReview.labels.length === 1 && boardingReview.labels[0].includes('shared journey saved'),
    'Campaign status label stays stable across 120 rendered frames');
  check(boardingReview.active === false, 'Reopening boarding does not board or alter the returned character');
  await screenshot('10-boarding-review');
  await page.locator('[data-board]').click();
  await ready();
  networkReview = await networkProbe();
  await screenshot('11-network-recovery');
  await wait(() => window.__tvUniverse?.campaign?.canReturn === true, null, 30000);
  await page.locator('[data-campaign-return]').click();
  await page.waitForURL(url => url.origin === target.origin && url.searchParams.has('realms'), { timeout: 20000 });
  await wait(() => !!window.tvRealms?.state, null, 90000);
  const finalTown = await page.evaluate(() => ({ personId: window.tvRealms.state.person.id, bodyId: window.tvRealms.state.body.id, inventory: window.tvRealms.state.person.inventory }));
  same([finalTown.personId, finalTown.bodyId], [baseline.personId, baseline.bodyId], 'Network verification leaves the same character returned to town');
  same(inventory(finalTown.inventory), baseline.inventory, 'Network verification preserves carried items');
  finalHealth = healthSummary(await readJson('/realms/health'));
  check(finalHealth.ready && !finalHealth.saveError && !finalHealth.updateError, 'Canonical host remains healthy after the round trip');
  const transientReadBackpressure = httpErrors.some(error => error.status === 503 && error.method === 'GET' && error.path === '/realms/universe')
    && httpErrors.every(error => error.status !== 503 || error.method === 'GET' && error.path === '/realms/universe');
  const fatalBrowserErrors = browserErrors.filter(error => !transientReadBackpressure
    || !/^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(error));
  check(fatalBrowserErrors.length === 0, 'No unrecovered browser or runtime errors during campaign acceptance');
  check(httpErrors.every(error => error.status === 503 && error.method === 'GET' && error.path === '/realms/universe'),
    'HTTP failures, if any, are recovered read-only save backpressure');
  result = 'passed';
} catch (error) {
  failure = timedOut ? 'Acceptance exceeded its five-minute wall-clock bound' : String(error?.stack ?? error).slice(0, 5000);
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  const observation = await readUniverse().catch(() => null);
  samples.push({ name: 'failure', elapsedMs: Date.now() - started, universe: observation });
  console.error(failure); process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  finalHealth ??= await readJson('/realms/health').then(healthSummary).catch(error => ({ error: String(error).slice(0, 500) }));
  const evidence = {
    result, mode: resumeReturn ? 'resume-return' : 'round-trip', checks, failure, browserErrors, httpErrors, intentionalNetworkErrors,
    elapsedMs: Date.now() - started, url: target.href,
    note: 'Automated ordinary keyboard/button input in isolated Chrome; read-only browser diagnostics and host inspection. No debug movement, save editing, or human-playtest claim. Session/controller tokens omitted.',
    initialHealth: healthSummary(initialHealth), finalHealth, baseline, town, finalInspection, boardingReview, networkReview,
    commandCounts: Object.fromEntries(commandCounts), samples,
  };
  await writeFile(resolve(output, 'journey.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ result, checks: checks.length, browserErrors, failure, output, elapsedMs: evidence.elapsedMs }, null, 2));
  await context.close().catch(() => {}); await browser.close().catch(() => {});
}
