/** Headed acceptance against combat-gym-server.ts only (disposable worlds).
 * TV_MOTION_URL defaults to http://127.0.0.1:7515; TV_MOTION_OUT selects evidence directory.
 * Run after web:build with the gym server's TV_GYM_STATIC pointing at the built client. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.TV_MOTION_URL ?? 'http://127.0.0.1:7515';
const out = process.env.TV_MOTION_OUT ?? '.debug/human-motion/canonical';
const health = await fetch(base + '/api/health').then(r => r.json());
assert.equal(health.isolation, 'Disposable town and gym; no save access', 'Refusing to reset a persistent server');
const control = body => fetch(base + '/api/gym/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => { assert.ok(r.ok); return r.json(); });
await control({ action: 'switch', scenario: 'gym' });
await control({ action: 'reset', seed: 918271 });
const before = await fetch(base + '/api/gym/state').then(r => r.json());
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], result = {};
page.on('pageerror', e => errors.push(String(e)));
const ready = () => page.waitForFunction(() => window.__tv?.ready && window.__tv.link.playable, null, { timeout: 180000 });
const sample = () => page.evaluate(() => {
  const app = window.__tv, a = app.actors.get(app.snapshot.controlledBodyId), v = a.visual;
  return { position: a.pos.asArray(), velocity: app.own().velocity, yaw: a.yaw, innerYaw: v.instance?.root.rotation.y,
    visual: v.root.metadata, clip: v.animator.current, mode: v.previousMode, phase: app.own().combatAction?.phase,
    locks: v.plant?.lockCount?.() ?? v.plant?.feet?.filter(f => f.lock).length, actorCount: app.actors.count };
});
try {
  await page.goto(base + '/?gym=1&autoplay=1&view=orbit&renderer=webgl2');
  await ready(); await page.waitForTimeout(1500);
  result.initial = await sample();
  assert.ok(result.initial.visual.sharedLook, 'Expected the shared adult rig');
  assert.equal(result.initial.innerYaw, Math.PI, 'Expected the canonical-facing adapter');
  await page.screenshot({ path: out + '/gym-initial.png' });
  await page.keyboard.press('KeyF'); await page.waitForTimeout(200); await page.keyboard.press('KeyH');
  result.attack = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(65); result.attack.push(await sample());
    if (i === 3) await page.screenshot({ path: out + '/gym-attack.png' });
  }
  assert.ok(result.attack.some(a => a.mode === 'action' && a.clip === 'unarmed/jab_left'));
  await page.waitForTimeout(1200); result.recovered = await sample();
  assert.equal(result.recovered.mode, 'idle', 'A retained completed action must not keep animating');
  await page.keyboard.down('KeyB'); await page.keyboard.down('KeyA'); await page.waitForTimeout(550);
  result.guard = await sample(); assert.equal(result.guard.mode, 'guard');
  await page.screenshot({ path: out + '/gym-guard-strafe.png' });
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyB');
  await page.waitForFunction(() => !window.__tv.own().guarding, null, { timeout: 8000 });
  await page.keyboard.press('KeyF');
  // Move away from the dummy so its canonical collision cannot mask the gait check.
  await page.keyboard.down('KeyS');
  await page.waitForFunction(() => { const a = window.__tv; return a.actors.get(a.own().bodyId).visual.animator.current === 'loco' && Math.hypot(a.own().velocity.x, a.own().velocity.z) > 1; }, null, { timeout: 8000 });
  await page.waitForTimeout(300); result.walk = await sample();
  await page.screenshot({ path: out + '/gym-walk.png' });
  await page.keyboard.down('ShiftLeft');
  await page.waitForFunction(() => { const a = window.__tv; return Math.hypot(a.own().velocity.x, a.own().velocity.z) > 4; }, null, { timeout: 8000 });
  result.run = await sample();
  await page.screenshot({ path: out + '/gym-run.png' });
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyS');
  assert.equal(result.walk.clip, 'loco'); assert.equal(result.run.clip, 'loco');
  const speed = s => Math.hypot(s.velocity.x, s.velocity.z);
  assert.ok(speed(result.run) > speed(result.walk), 'Sprint must change canonical velocity');
  const after = await fetch(base + '/api/gym/state').then(r => r.json());
  result.contact = { before: before.bodies[1].health, after: after.bodies[1].health, hitSeq: after.bodies[1].hitSeq };
  assert.ok(result.contact.after < result.contact.before && result.contact.hitSeq > 0, 'Keyboard strike must cause a canonical contact');
  await control({ action: 'switch', scenario: 'town' }); await page.reload(); await ready(); await page.waitForTimeout(2000);
  result.town = await sample(); await page.screenshot({ path: out + '/town.png' });
  assert.ok(result.town.visual.sharedLook); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ contact: result.contact, recovered: result.recovered.mode, walkSpeed: speed(result.walk), runSpeed: speed(result.run), townActors: result.town.actorCount, errors }));
} finally {
  writeFileSync(out + '/result.json', JSON.stringify({ ...result, errors }, null, 2));
  await context.close(); await browser.close();
}
