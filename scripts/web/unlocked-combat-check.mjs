/** Ordinary mouse input against a fresh disposable App host; never the active 7517 preview. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REPAIR_URL ?? 'http://127.0.0.1:7543';
const out = resolve('.debug/input-posture-repair/mouse-gameplay'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
await context.addInitScript(() => localStorage.setItem('torn-veil-web.settings.v1', JSON.stringify({ captureMouse: false, viewMode: 'third-person', quality: 'balanced' })));
const page = await context.newPage(), errors = [], checks = [], samples = [];
page.on('pageerror', e => errors.push(String(e)));
const read = () => page.evaluate(() => { const a = window.__tv, own = a.own(); return { own, body: a.snapshot.bodies.find(b => b.bodyId === own.bodyId), identity: a.link.hello.playerId, inventory: a.snapshot.carried.map(i => ({ id: i.id, quantity: i.quantity })), locked: a.input.pointerLocked, captureMouse: a.settings.captureMouse, view: a.settings.viewMode, motion: a.actors.get(own.bodyId)?.visual.root.metadata.motion }; });
const check = (name, ok) => { checks.push({ name, ok }); assert.ok(ok, name); console.log('PASS', name); };
try {
  const health = await page.request.get(base + '/api/health').then(r => r.json());
  assert.ok(health.isolation.includes('Disposable')); assert.ok(health.buildRoot.includes('input-posture-repair'));
  for (const scenario of ['gym', 'town']) {
    await page.request.post(base + '/api/gym/control', { data: { action: 'switch', scenario } });
    await page.goto(base + '/?gym=1&scenario=' + scenario + '&autoplay=1&view=third-person&renderer=webgl2');
    await page.waitForFunction(() => window.__tv?.ready && window.__tv.link.playable, null, { timeout: 240000 });
    await page.waitForTimeout(600); const before = await read();
    check(`${scenario}: third-person capture disabled`, !before.locked && !before.captureMouse && before.view === 'third-person');
    if (scenario === 'gym') await page.keyboard.press('KeyF');
    const stateBefore = await page.request.get(base + '/api/gym/state').then(r => r.json());
    await page.mouse.click(1000, 600, { button: 'left' });
    await page.waitForFunction(seq => window.__tv.own().attackSeq > seq, before.own.attackSeq, { timeout: 8000 });
    await page.waitForTimeout(250); const attacked = await read();
    await page.screenshot({ path: resolve(out, scenario + '-strike.png') });
    check(`${scenario}: actual LMB reaches canonical attack`, attacked.own.attackSeq > before.own.attackSeq && !attacked.locked);
    await page.waitForTimeout(1000);
    const stateAfter = await page.request.get(base + '/api/gym/state').then(r => r.json());
    if (scenario === 'gym') check('Gym: mouse strike causes real canonical contact', stateAfter.bodies[1].health < stateBefore.bodies[1].health && stateAfter.bodies[1].hitSeq > stateBefore.bodies[1].hitSeq);
    await page.mouse.move(1000, 600); await page.mouse.down({ button: 'right' });
    await page.waitForFunction(() => window.__tv.own().guarding, null, { timeout: 8000 });
    const guard = await read(); await page.screenshot({ path: resolve(out, scenario + '-guard.png') });
    check(`${scenario}: actual RMB holds canonical guard`, guard.own.guarding && !guard.locked);
    await page.mouse.up({ button: 'right' });
    await page.waitForFunction(() => !window.__tv.own().guarding, null, { timeout: 8000 });
    const after = await read();
    check(`${scenario}: release preserves identity/inventory`, after.identity === before.identity && JSON.stringify(after.inventory) === JSON.stringify(before.inventory));
    samples.push({ scenario, before, attacked, guard, after, contact: scenario === 'gym' ? { before: stateBefore.bodies[1].health, after: stateAfter.bodies[1].health } : null });
  }
  assert.deepEqual(errors, []);
} finally {
  await page.mouse.up({ button: 'right' }).catch(() => {});
  const video = page.video(); await context.close(); renameSync(await video.path(), resolve(out, 'unlocked-mouse-gameplay.webm')); await browser.close();
  writeFileSync(resolve(out, 'result.json'), JSON.stringify({ scope: 'Actual mouse input and canonical receipts in a fresh disposable App Gym and Town; no saves, no active user preview commands.', errors, checks, samples }, null, 2));
}
