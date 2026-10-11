/**
 * Controller check: plugs a virtual DualSense (standard Gamepad API mapping, the way Chrome presents a real one) into
 * the arena and drives every mapped input through the game's real pad path, asserting the result of each, plus
 * relaxed-vs-combat stance screenshots. Not a physical-controller test; the mapping and handling are what it proves.
 *   npx tsx scripts/web/arena-pad.ts [--name pad] [--host http://127.0.0.1:5180]
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = join(process.cwd(), '.debug/arena', arg('name', 'pad')); mkdirSync(out, { recursive: true });
const host = arg('host', 'http://127.0.0.1:5180');
const W = 1400, H = 800;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W + 16},${H + 130}`] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
await page.addInitScript(() => {
  (window as any).__name = (f: unknown) => f;
  const st = { axes: [0, 0, 0, 0], buttons: new Array(18).fill(0) as number[] }, rumbles: unknown[] = [];
  (window as any).__pad = st; (window as any).__rumbles = rumbles;
  const pad = () => ({ id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: [...st.axes], buttons: st.buttons.map(v => ({ pressed: v > .5, value: v, touched: v > 0 })),
    vibrationActuator: { type: 'dual-rumble', playEffect: (_t: string, o: unknown) => { rumbles.push(o); return Promise.resolve('complete'); } } });
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad(), null, null, null] });
});
await page.goto(`${host}/?arena=1&seed=4`);
await page.waitForFunction(() => !!(window as any).__arena, null, { timeout: 240_000 });
await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleHelp(); a.world.setCompanions(false); a.world.hero.maxHp = a.world.hero.hp = 1e6; });
await page.waitForTimeout(800);
const B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, touch: 17 };
const set = (p: Page, b: number, v: number) => p.evaluate(([b, v]) => { (window as any).__pad.buttons[b] = v; }, [b, v]);
const axes = (p: Page, a: number[]) => p.evaluate(a => { (window as any).__pad.axes = a; }, a);
const press = async (b: number, ms = 90) => { await set(page, b, 1); await page.waitForTimeout(ms); await set(page, b, 0); await page.waitForTimeout(90); };
const S = () => page.evaluate(() => { const a = (window as any).__arena, w = a.world, h = w.hero; return { x: +h.pos.x.toFixed(2), z: +h.pos.z.toFixed(2), state: h.state, yaw: +h.yaw.toFixed(2), camYaw: +a.cam.yaw.toFixed(2), weapon: w.weapon, relaxed: h.relaxed, sheathed: h.sheathed, idle: h.anim.current, flasks: w.flasks, padMode: a.hud.padMode, charging: h.charging }; });
const checks: { name: string; ok: boolean; detail: unknown }[] = [];
const check = (name: string, ok: boolean, detail: unknown) => { checks.push({ name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); };

// Draw the greatsword with the D-pad (weapon step), then stand at ease.
await press(B.right); await page.waitForTimeout(300);
let s = await S(); check('D-pad → next weapon', s.weapon !== 'fists', s);
check('controller glyph mode on', s.padMode, s.padMode);
await page.waitForTimeout(4500); s = await S();
check('calm: relaxed stance, weapon on back', s.relaxed && s.sheathed && s.idle === 'locomotion/idle', s);
await page.screenshot({ path: join(out, '1-relaxed-idle.png') });
// Left stick forward walks camera-forward.
const s0 = await S(); await axes(page, [0, -1, 0, 0]); await page.waitForTimeout(1400); await page.screenshot({ path: join(out, '2-relaxed-walk.png') });
const s1 = await S(); await axes(page, [0, 0, 0, 0]);
const fwdx = -Math.sin(s0.camYaw), fwdz = -Math.cos(s0.camYaw), dot = (s1.x - s0.x) * fwdx + (s1.z - s0.z) * fwdz;
check('left stick ↑ moves camera-forward', dot > 2, { moved: dot.toFixed(2) });
// Hold circle while moving: sprint (faster than the walk above).
await axes(page, [0, -1, 0, 0]); await set(page, B.circle, 1); await page.waitForTimeout(400); const a0 = await S(); await page.waitForTimeout(1000); const a1 = await S(); await set(page, B.circle, 0); await axes(page, [0, 0, 0, 0]);
check('hold ○ sprints', Math.hypot(a1.x - a0.x, a1.z - a0.z) > dot / 1.4 * .9, { sprint: Math.hypot(a1.x - a0.x, a1.z - a0.z).toFixed(2), walk: (dot / 1.4).toFixed(2) });
await page.waitForTimeout(300);
// Tap circle: dodge.
await press(B.circle, 80); await page.waitForTimeout(40); s = await S(); check('tap ○ dodges', s.state === 'dodge', s.state);
await page.waitForTimeout(900);
// Right stick orbits the camera.
const c0 = (await S()).camYaw; await axes(page, [0, 0, 1, 0]); await page.waitForTimeout(600); await axes(page, [0, 0, 0, 0]); const c1 = (await S()).camYaw;
check('right stick orbits camera', Math.abs(c1 - c0) > .5, { from: c0, to: c1 });
await press(B.r3); s = await S(); check('R3 recentres behind hero', Math.abs(Math.atan2(Math.sin(s.camYaw - s.yaw - Math.PI), Math.cos(s.camYaw - s.yaw - Math.PI))) < .05, s);
// R1 light attack (draws the weapon at once).
await press(B.r1, 60); await page.waitForTimeout(60); s = await S(); check('R1 light attack (and draws)', s.state === 'attack' && !s.sheathed, s);
await page.waitForTimeout(1200);
// R2 hold charges a heavy, release unleashes.
await set(page, B.r2, 1); await page.waitForTimeout(500); const r2h = await S(); await set(page, B.r2, 0); await page.waitForTimeout(80); const r2r = await S();
check('R2 hold charges heavy', r2h.state === 'attack' && r2h.charging, r2h); check('R2 release unleashes', !r2r.charging, r2r);
await page.waitForTimeout(1500);
// L1 guard.
await set(page, B.l1, 1); await page.waitForTimeout(250); s = await S(); await set(page, B.l1, 0); check('L1 guards', s.state === 'guard', s.state);
await page.waitForTimeout(400);
// L2 + square casts skill 1 (sandbox: Ember).
await set(page, B.l2, 1); await page.waitForTimeout(80); await press(B.square, 80); s = await S(); await set(page, B.l2, 0);
check('L2+□ casts skill 1', s.state === 'cast', s.state);
await page.waitForTimeout(900);
// Square alone drinks a flask (hurt the hero first).
await page.evaluate(() => { const h = (window as any).__arena.world.hero; h.hp = h.maxHp * .5; });
const f0 = (await S()).flasks; await press(B.square); const f1 = (await S()).flasks; check('□ drinks a flask', f1 === f0 - 1, { f0, f1 });
await page.evaluate(() => { const h = (window as any).__arena.world.hero; h.hp = h.maxHp; });
// Triangle cycles weapon.
const w0 = (await S()).weapon; await press(B.triangle); await page.waitForTimeout(200); const w1 = (await S()).weapon; check('△ cycles weapon', w0 !== w1, { w0, w1 });
// Back to the greatsword for the combat stance; spawn foes (keyboard N) -> alert stance.
while ((await S()).weapon !== 'greatsword') { await press(B.right); await page.waitForTimeout(150); }
await page.keyboard.press('KeyN'); await set(page, B.cross, 0); await page.waitForTimeout(1600); s = await S();
check('foes near → combat stance, weapon in hand', !s.relaxed && !s.sheathed, s);
await page.screenshot({ path: join(out, '3-combat-stance.png') });
// Rumble on being hit.
await page.evaluate(() => { const a = (window as any).__arena; a.world.hero.iframe = 0; a.world.effectDamage(a.world.hero, 20, new (a.camera.position.constructor)(0, 0, 1), 1); });
await page.waitForTimeout(100); const rumbles = await page.evaluate(() => (window as any).__rumbles.length); check('rumble when hurt', rumbles > 0, rumbles);
// Options pauses (and shows controls); again resumes.
await press(B.options); let paused = await page.evaluate(() => (window as any).__arena.world.time); await page.waitForTimeout(400); const pausedHold = await page.evaluate(() => (window as any).__arena.world.time);
check('Options pauses', Math.abs(pausedHold - paused) < .05, { paused, pausedHold }); await page.screenshot({ path: join(out, '4-paused-controls.png') }); await press(B.options);
// Menu navigation: a three-card choice resolved with the D-pad and cross.
const pick = page.evaluate(() => (window as any).__arena.hud.choose('Pad test', 'choose with the D-pad', [{ icon: '1', name: 'One', text: '' }, { icon: '2', name: 'Two', text: '' }, { icon: '3', name: 'Three', text: '' }]));
await page.waitForTimeout(250); await press(B.right); await press(B.right); await page.screenshot({ path: join(out, '5-menu-focus.png') }); await press(B.cross);
check('menus: D-pad + ✕ chooses', (await pick) === 1, await pick);
writeFileSync(join(out, 'report.json'), JSON.stringify({ checks, errors }, null, 1));
console.log(JSON.stringify({ passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).map(c => c.name), errors: errors.slice(0, 5) }));
await browser.close();
