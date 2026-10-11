/** Actual browser/input journey. No actor teleports, forced kills or floor unlocks.
 * The only fixture is an unrelated legacy localStorage sentinel in an isolated profile. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.env.TV_REALMS_URL ?? 'http://127.0.0.1:7510';
const out = resolve(process.env.TV_REALMS_EVIDENCE ?? '.debug/realms/combined-journey');
const save = resolve(process.env.TV_REALMS_SAVE ?? '.debug/realms/combined-world.json');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1440,1000'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
const page = await context.newPage(), errors = [], checks = [], screenshots = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await page.addInitScript(() => { if (!localStorage.getItem('qa.realm.sentinel')) { localStorage.setItem('tv.tower.expedition.v1', '{"legacy-sentinel":true}'); localStorage.setItem('qa.realm.sentinel', 'set'); } });
const read = () => page.evaluate(() => window.tvRealms?.inspect());
const wait = (fn, arg = null, timeout = 90000) => page.waitForFunction(fn, arg, { timeout });
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const shot = async name => { await page.screenshot({ path: resolve(out, `${name}.png`) }); screenshots.push(name); console.log(`CAPTURE ${name}`); };
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name); };
const towerState = () => page.evaluate(() => { const a = window.__arena, t = a?.tower; return t && { floor: t.floor, runId: t.runId, climberId: t.climberId, seed: t.seed, binding: a.realmBinding, hp: a.world.hero.hp, kills: t.stats.kills, over: t.over, savedLocal: localStorage.getItem('tv.tower.expedition.v1'), metadata: a.world.hero.inst.root.metadata, gear: Object.values(t.gear).map(g => g.id) }; });
const realmReady = () => wait(() => window.tvRealms?.ready);
const towerReady = () => wait(() => window.__arena?.tower?.floor > 0 && !window.__arena.realmBinding?.busy, null, 240000);
const enter = async () => {
  const r = (await read()).state.realm, offset = r === 'aether' ? 0 : 8192;
  await page.locator('#rv-tower').click();
  await wait(x => Math.hypot(window.tvRealms.state.body.pos.x - x, window.tvRealms.state.body.pos.z - 3120.5) < .6, offset + 3120.5);
  if ((await read()).state.prompt.includes('Open Tower')) await page.keyboard.press('KeyE');
  await hold('KeyW', 2700); await wait(() => window.tvRealms.state.tower);
  await page.locator('#rv-ascend').click(); await towerReady();
};
const leave = async () => { await page.locator('#realm-tower-return').click(); await realmReady(); };
const held = new Set();
const key = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
async function fightToSecondFloor() {
  // Close the ordinary help panel through its visible close control.
  const help = page.locator('.ar-help .x'); if (await help.isVisible()) await help.click();
  let attacking = false;
  const deadline = Date.now() + 180000;
  try {
    while (Date.now() < deadline) {
      const cards = page.locator('.ar-modal.on .ar-card'); if (await cards.count()) { await cards.first().click(); continue; }
      const s = await page.evaluate(() => {
        const a = window.__arena, t = a.tower, w = a.world, h = w.hero;
        const foes = w.fighters.filter(f => f.role === 'foe' && f.alive && f.foeKind !== 'dummy');
        const target = foes.sort((l, r) => Math.hypot(l.pos.x-h.pos.x,l.pos.z-h.pos.z)-Math.hypot(r.pos.x-h.pos.x,r.pos.z-h.pos.z))[0]?.pos
          ?? t.pickups[0]?.pos ?? (t.doorOpen ? t.plan.exit : null);
        if (!target) return { floor: t.floor, over: t.over, busy: a.realmBinding.busy };
        const tx = target.x, tz = target.z, dx = tx-h.pos.x, dz = tz-h.pos.z, distance = Math.hypot(dx,dz);
        const d = w.navDir(h.pos.x,h.pos.z,tx,tz) ?? { x: dx/(distance||1), z: dz/(distance||1) };
        const yaw = a.cam.yaw, f = -d.x*Math.sin(yaw)-d.z*Math.cos(yaw), r = d.x*Math.cos(yaw)-d.z*Math.sin(yaw);
        let visible = true; for (let n=1; n<Math.ceil(distance/.3); n++) { const ratio=n/Math.ceil(distance/.3); if(w.cameraBlocked(h.pos.x+dx*ratio,1.4,h.pos.z+dz*ratio)){visible=false;break;} }
        return { floor: t.floor, over: t.over, busy: a.realmBinding.busy, hp: h.hp/h.maxHp, flasks: w.flasks, target: a.screen(tx,1,tz), attack: foes.length>0 && distance<2.3 && visible,
          keys: distance>.6 ? [f>.38?'KeyW':f<-.38?'KeyS':'',r>.38?'KeyD':r<-.38?'KeyA':''].filter(Boolean) : [] };
      });
      if (s.floor >= 2) return;
      if (s.over) throw Error('The real-input climber fell before reaching floor two.');
      const attack = !!s.attack && !s.busy;
      for (const k of ['KeyW','KeyS','KeyA','KeyD']) await key(k, !attack && !s.busy && (s.keys ?? []).includes(k));
      if (s.target) await page.mouse.move(Math.max(5,Math.min(1435,s.target.x)),Math.max(5,Math.min(895,s.target.y)));
      if (attack !== attacking) { attack ? await page.mouse.down() : await page.mouse.up(); attacking=attack; }
      if (s.hp < .45 && s.flasks > 0) await page.keyboard.press('KeyQ');
      await page.waitForTimeout(80);
    }
    throw Error('Real-input floor-two traversal timed out.');
  } finally { await page.mouse.up(); for (const k of [...held]) await key(k,false); }
}
let result = 'failed';
try {
  await page.goto(`${base}/?realms`); await realmReady();
  const initial = (await read()).state;
  check('starts with canonical realm character', !initial.expedition?.active, initial.person);
  await shot('01-world-before-ascent'); await enter();
  const first = await towerState();
  assert.equal(first.floor, 1, 'This combat journey requires a fresh isolated save; choose a new TV_REALMS_SAVE path instead of reusing an old climb.');
  check('Tower uses world person and body identities', first.climberId === initial.person.id && first.binding.bodyId === initial.body.id && first.metadata.worldBodyId === initial.body.id, first);
  check('world-linked mode retains standalone checkpoint', first.savedLocal === '{"legacy-sentinel":true}');
  await shot('02-bound-tower-floor-one'); await fightToSecondFloor(); await towerReady();
  const second = await towerState(), saved = JSON.parse(readFileSync(save,'utf8'));
  check('real input advances and durably checkpoints floor two', second.floor === 2 && saved.realmExpedition.checkpoint.floor === 2, second);
  await shot('03-real-combat-floor-two');
  await page.reload(); await towerReady(); const reloaded = await towerState();
  check('reload restores same expedition and equipment', reloaded.runId === first.runId && reloaded.floor === 2 && JSON.stringify(reloaded.gear) === JSON.stringify(Object.values(saved.realmExpedition.checkpoint.gear).map(g => g.id)), reloaded);
  await page.keyboard.press('KeyR'); await page.waitForTimeout(300);
  check('restart key cannot replace bound character', (await towerState()).runId === first.runId);
  await leave(); const returned = (await read()).state;
  check('actual return retains identity inventory rank and body', JSON.stringify(returned.person) === JSON.stringify(initial.person) && returned.body.id === initial.body.id && returned.tower, returned);
  await shot('04-returned-to-world-atrium');
  await page.locator('#rv-portal').click(); await wait(() => window.tvRealms.state.prompt.includes('Cross the Veil'));
  await page.keyboard.press('KeyE'); await page.locator('#rv-cancel').click(); await wait(() => !window.tvRealms.state.pending);
  check('portal cancellation remains in original realm', (await read()).state.realm === initial.realm);
  await page.keyboard.press('KeyE'); await page.locator('#rv-cross').click();
  await wait(() => window.tvRealms?.ready && window.tvRealms.state.realm === 'brass');
  await shot('05-other-realm-after-expedition'); await enter();
  const other = await towerState();
  check('other realm Tower resumes the same run and floor', other.runId === first.runId && other.floor === 2 && other.climberId === first.climberId, other);
  await leave(); await page.reload(); await realmReady(); const final = (await read()).state;
  check('repeated return and reload preserves world progression', JSON.stringify(final.person) === JSON.stringify(initial.person) && final.body.id === initial.body.id && final.realm === 'brass');
  await shot('06-returned-cinderveil-atrium');
  check('no browser errors', errors.length === 0, errors);
  result = 'passed';
} catch (e) { errors.push(String(e)); console.error(String(e)); await shot('failure').catch(()=>{}); }
finally {
  writeFileSync(resolve(out,'report.json'),JSON.stringify({result,checks,errors,screenshots,note:'Observed headed Chrome journey, ordinary keys/buttons and read-only navigation queries. One isolated legacy-storage sentinel fixture; no teleports, forced kills or generated floor completion. Shared machine, not a controlled performance benchmark.'},null,2));
  const video=page.video(); await context.close(); if(video)await video.saveAs(resolve(out,'traversal.webm')); await browser.close();
}
if(result!=='passed')process.exitCode=1;
