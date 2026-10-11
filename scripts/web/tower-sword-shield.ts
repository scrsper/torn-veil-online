/**
 * Tower sword-and-shield preview: the hero with the Tower's Veilguard in the sword-and-shield slot (F3),
 * held at fixed fractions of the idle / walk / run / guard / slash clips from four camera angles, a sheathed
 * relaxed pose, a draw from rest, and a live armed idle -> walk -> run -> guard -> slash -> idle transition strip.
 *   npm run web:dev            (other terminal; serves http://127.0.0.1:5180)
 *   npx tsx scripts/web/tower-sword-shield.ts [--name sword-shield-after] [--tower] [--video]
 * Default: the combat gym sandbox (?arena=1). --tower: the Tower runtime's Proving Hall (?arena=1&tower=1&hall=1),
 * with the Veilguard given through the Tower's own pickup path. --video records the live part (draw + strip) as .webm.
 * Writes .debug/arena/<name>/*.png and <name>/report.json (gear placement per pose, transfer checks, foot slide).
 * Gear moves between back and hands instantaneously (no licensed clip draws a one-handed sword or unslings a shield
 * from the back); the transfer checks assert each piece lands exactly on its destination at once.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'sword-shield'), towerMode = process.argv.includes('--tower'), video = process.argv.includes('--video'), body = arg('body', '');
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const SS = (n: string) => `sword_and_shield/sword and shield ${n}`;
const POSES: [string, number][] = [
  [SS('idle'), 0], [SS('idle'), .5], [SS('walk'), .25], [SS('walk'), .75], [SS('run'), .25], [SS('run'), .75],
  [SS('block idle'), .5], [SS('slash'), .35], [SS('slash'), .6], [SS('attack (4)'), .45],
  // The ready stance the hero actually plays near foes (upright body, authored weapon arms).
  ['ready/sword and shield idle', 0], ['ready/sword and shield idle', .5], ['ready/sword and shield walk', .25], ['ready/sword and shield run', .25],
];
// Camera [pitch, yaw, zoom] (hero faces +z at yaw 0; camera yaw 0.7 pi frames its back). shieldside/swordside are
// the views of the first baseline capture (kept identical for matched before/after); front-a/b are closer front views.
const VIEWS: [string, number, number, number][] = [['shieldside', .18, Math.PI * .7, 5.2], ['swordside', .18, Math.PI * 1.3, 5.2], ['front-a', .16, -Math.PI * .2, 4.4], ['front-b', .16, Math.PI * .2, 4.4],
  // Close shield-grip views: from behind the shield arm (the fist on the bar) and from the front (the face).
  ['grip-back', .1, Math.PI * .55, 2.4], ['grip-front', .1, -Math.PI * .35, 2.4]];

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=900,900'] });
const ctx = await browser.newContext({ viewport: { width: 760, height: 760 }, ...(video ? { recordVideo: { dir: out, size: { width: 760, height: 760 } } } : {}) });
const page = await ctx.newPage(), t0 = Date.now(), at = () => +((Date.now() - t0) / 1000).toFixed(2);
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { (window as unknown as { __name: (f: unknown) => unknown }).__name = f => f; });
const report: Record<string, unknown> = {};
const checks: { step: string; ok: boolean; detail?: unknown }[] = [];
const check = (step: string, ok: boolean, detail?: unknown) => { checks.push({ step, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
try {
// --tower: the real Tower runtime, in the Proving Hall (floor 0: never persistent, so no checkpoint is read or written).
// --body male|female|legacy selects the hero body (creator male v2, creator female v1, earlier MPFB ranger).
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&seed=918271${towerMode ? '&tower=1&hall=1' : ''}${body ? `&body=${body}` : ''}`);
await page.waitForFunction(() => !!(window as unknown as { __arena?: unknown }).__arena, null, { timeout: 240_000 });
if (towerMode) await page.waitForFunction(() => (window as any).__arena.tower?.plan?.kind === 'hall', null, { timeout: 120_000 });
// The Tower's representative sword-and-shield loadout: Veilguard (a Tower item) in the F3 slot, right hand.
await page.evaluate(tw => {
  const a = (window as any).__arena, w = a.world;
  if (tw) {
    // Picked up through the Tower's own loot path (the same call a floor pickup makes).
    a.tower.take({ kind: 'weapon', id: 'qa-veilguard', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 });
    w.setWeapon(w.hero, 'axe'); a.hud.showHelp(false); w.hero.pos.set(0, 0, -4);
  } else { a.hud.toggleHelp(); w.setCompanions(false); w.unlocked.add('axe'); w.weaponMesh.axe = { mesh: 'W_veilguard', hand: 'r' }; w.setWeapon(w.hero, 'axe'); }
}, towerMode);

/** Where each held item sits relative to the hero's bones (model units / 1.22 = metres), and where the shield faces. */
const probe = (p: Page) => p.evaluate(() => {
  const w = (window as any).__arena.world, h = w.hero, b = h.inst.bones;
  const P = (n: any) => { n.computeWorldMatrix(true); const v = n.getAbsolutePosition(); return [v.x, v.y, v.z]; };
  const d = (a: number[], c: number[]) => +(Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]) / 1.22).toFixed(3);
  const gear = h.extra.map((m: any) => { m.computeWorldMatrix(true); const bb = m.getBoundingInfo().boundingBox; return { name: m.name, parent: m.parent?.name, centre: [bb.centerWorld.x, bb.centerWorld.y, bb.centerWorld.z] }; });
  // Shield face = mesh local +Z (the boss side). Against the hero's frame (yaw 0 faces +z; left is -x).
  const sh = h.extra.find((m: any) => m.metadata?.shield), r3 = (v: number) => +v.toFixed(2);
  let shield = null;
  if (sh) {
    const m = sh.getWorldMatrix().m, n = [m[8], m[9], m[10]], l = Math.hypot(n[0], n[1], n[2]) || 1, o = P(sh), hl = P(b.get('lowerarm_l'));
    const yaw = h.yaw, fwd = [Math.sin(yaw), 0, Math.cos(yaw)], left = [-Math.cos(yaw), 0, Math.sin(yaw)], dot = (a: number[], c: number[]) => (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / l;
    shield = { faceFwd: r3(dot(n, fwd)), faceLeft: r3(dot(n, left)), faceUp: r3(n[1] / l), elbowSide_m: r3(dot([hl[0] - o[0], hl[1] - o[1], hl[2] - o[2]], n) / 1.22) };
  }
  return { state: h.state, gear: gear.map((g: any) => ({ name: g.name, parent: g.parent, toHandL_m: d(g.centre, P(b.get('hand_l'))), toHandR_m: d(g.centre, P(b.get('hand_r'))), toChest_m: d(g.centre, P(b.get('spine_03'))) })), shield, sheathed: h.sheathed };
});

// Live part (before any pose freezes the game): real keys and mouse, frames at fixed times.
// Tower: the Proving Hall's dummies stand behind the spawn point, so look from the side they are not on.
await page.evaluate(tw => { const a = (window as any).__arena; a.view(.2, tw ? -Math.PI * .2 : Math.PI * .75); a.zoom(tw ? 5.5 : 6.5); }, towerMode);
// Stance-foot slide per hero state over the strip: horizontal speed of the lower foot while it stays the lower foot
// (it should be ~0 when planted). Metres per second, lower is better.
await page.evaluate(() => {
  const a = (window as any).__arena, w = a.world, sk: any = (window as any).__sk = { by: {}, prev: [null, null] };
  a.scene.onAfterRenderObservable.add(() => {
    const h = w.hero, dt = a.scene.getEngine().getDeltaTime() / 1000; if (!dt || !h.inst.bones) return;
    // The stance foot is the lower one; while the same foot stays lowest it should not travel over the ground.
    const ps = ['foot_l', 'foot_r'].map(n => h.inst.bones.get(n).getAbsolutePosition().clone()), k = ps[0].y <= ps[1].y ? 0 : 1, p = ps[k], prev = sk.prev[k];
    if (prev && sk.last === k) { const s = sk.by[`${h.state}${h.sheathed ? ' (relaxed)' : ' (armed)'}`] ??= { sum: 0, n: 0, max: 0 }, v = Math.hypot(p.x - prev.x, p.z - prev.z) / dt / 1.22; s.sum += v; s.n++; s.max = Math.max(s.max, v); }
    sk.prev = [ps[0], ps[1]]; sk.last = k;
  });
});
await page.mouse.move(380, 200);
// Normal -> combat: wait until the hero is at ease (gear slung), then attack from rest; a burst of live frames.
await page.waitForFunction(() => (window as any).__arena.world.hero.sheathed, null, { timeout: 15_000 });
await page.waitForTimeout(700);
const liveStart = at();
await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();
for (let k = 0; k < 8; k++) {
  const file = `draw-${k}.png`; await page.screenshot({ path: join(out, file) });
  report[file] = { ...(await probe(page)), t: k };
  await page.waitForTimeout(40);
}
await page.waitForTimeout(1200);
// Armed strip: a guard tap draws the gear, and the alert is held so the walk and run use the armed clips throughout.
await page.keyboard.press('KeyF'); await page.keyboard.up('KeyF'); await page.waitForTimeout(400);
await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; });
const strip: [string, () => Promise<void>, number][] = [
  ['1-idle', async () => {}, 400],
  ['2-walk', async () => { await page.keyboard.down('KeyW'); }, 350],
  ['3-run', async () => { await page.keyboard.down('ShiftLeft'); }, 900],
  ['4-stop', async () => { await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); }, 180],
  ['5-guard', async () => { await page.keyboard.down('KeyF'); }, 350],
  ['6-unguard', async () => { await page.keyboard.up('KeyF'); }, 150],
  ['7-slash', async () => { await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); }, 280],
  ['8-settle', async () => {}, 900],
];
for (const [label, act, wait] of strip) {
  await act(); await page.waitForTimeout(wait);
  const file = `strip-${label}.png`; await page.screenshot({ path: join(out, file) });
  report[file] = { ...(await probe(page)), clip: await page.evaluate(() => (window as any).__arena.world.hero.anim.dominant()?.name ?? '') };
}
const stripRows = strip.map(([l]) => report[`strip-${l}.png`] as any);
check('strip stays armed (gear in hand) through idle, walk, run, guard and slash', stripRows.every(r => !r.sheathed && r.gear.every((g: any) => /slot\.hand_/.test(g.parent))), stripRows.map(r => ({ sheathed: r.sheathed, clip: r.clip })));
report.footSlide = await page.evaluate(() => Object.fromEntries(Object.entries((window as any).__sk.by).map(([k, s]: [string, any]) => [k, { samples: s.n, mean_m_per_s: +(s.sum / s.n).toFixed(3), max_m_per_s: +s.max.toFixed(2) }])));
// Seconds into the recording (it starts with the page) where the live draw + armed strip begins and ends.
if (video) { const v = page.video(); report.video = v ? await v.path() : null; report.videoWindow = { start: liveStart - 1, end: at() + .3 }; }

// Transfer checks: each piece must be exactly at its destination right after the call (no settling time).
const gearNow = () => page.evaluate(() => {
  const h = (window as any).__arena.world.hero;
  return { sheathed: h.sheathed, gear: h.extra.map((m: any) => ({ name: m.name, disposed: m.isDisposed(), parent: m.parent?.name, shield: !!m.metadata?.shield, pos: +m.position.length().toFixed(6), quat: m.rotationQuaternion ? 'set' : null, rot: +m.rotation.length().toFixed(6), scale: [m.scaling.x, m.scaling.y, m.scaling.z].map((v: number) => +v.toFixed(6)),
    // The physical fit recorded at equip time: the drawn piece must sit exactly at it.
    fitScale: +(m.metadata?.fit?.scale ?? 1).toFixed(6), fitStatus: m.metadata?.fit?.status ?? null,
    posVec: [m.position.x, m.position.y, m.position.z], fitPosVec: m.metadata?.fitPos ? [m.metadata.fitPos.x, m.metadata.fitPos.y, m.metadata.fitPos.z] : [0, 0, 0],
    quatVec: m.rotationQuaternion ? [m.rotationQuaternion.x, m.rotationQuaternion.y, m.rotationQuaternion.z, m.rotationQuaternion.w] : null,
    fitQuatVec: m.metadata?.fitQuat ? [m.metadata.fitQuat.x, m.metadata.fitQuat.y, m.metadata.fitQuat.z, m.metadata.fitQuat.w] : null })) };
});
const samePos = (x: { posVec: number[]; fitPosVec: number[] }) => x.posVec.every((v, k) => Math.abs(v - x.fitPosVec[k]) < 1e-6);
// Drawn rotation equals the recorded mount (none for items whose authored origin is the grip).
const sameQuat = (x: { quatVec: number[] | null; fitQuatVec: number[] | null }) => x.fitQuatVec === null ? x.quatVec === null : !!x.quatVec && x.quatVec.every((v, k) => Math.abs(v - x.fitQuatVec![k]) < 1e-6);
const inHands = (g: Awaited<ReturnType<typeof gearNow>>) => !g.sheathed && g.gear.length === 2 && g.gear.every(x => !x.disposed && x.parent?.endsWith(x.shield ? '.slot.hand_l' : '.slot.hand_r') && samePos(x) && sameQuat(x) && x.rot === 0 && x.scale.every(v => v === x.fitScale));
const onBack = (g: Awaited<ReturnType<typeof gearNow>>) => g.sheathed && g.gear.length === 2 && g.gear.every(x => !x.disposed && x.parent?.endsWith('.spine_03') && x.scale.every(v => v === x.fitScale));
await page.evaluate(() => { const w = (window as any).__arena.world, h = w.hero; h.alertT = 1e9; h.relaxed = false; w.sheathe(h, true); });
const stowed = await gearNow(); check('stow: both pieces on the back at once', onBack(stowed), stowed);
await page.evaluate(() => { const w = (window as any).__arena.world; w.sheathe(w.hero, false); });
const drawn = await gearNow(); check('draw: both pieces exactly on their hand grips at once', inHands(drawn), drawn);
await page.evaluate(() => { const w = (window as any).__arena.world; w.sheathe(w.hero, true); w.sheathe(w.hero, false); });
const reversal = await gearNow(); check('rapid stow -> draw lands exactly in the hands', inHands(reversal), reversal);
// Instance names are reused per fighter, so the swap is checked by object identity, not by name.
await page.evaluate(() => { const w = (window as any).__arena.world; (window as any).__oldGear = [...w.hero.extra]; w.sheathe(w.hero, true); w.setWeapon(w.hero, 'fists'); w.setWeapon(w.hero, 'axe'); });
const swapped = await gearNow();
const oldRefs = await page.evaluate(() => { const old: any[] = (window as any).__oldGear, now: any[] = (window as any).__arena.world.hero.extra; return { count: old.length, allDisposed: old.every(m => m.isDisposed()), reused: old.some(m => now.includes(m)) }; });
check('weapon swap while stowed: fresh pieces stay on the back, the old ones are disposed', onBack(swapped) && oldRefs.count === 2 && oldRefs.allDisposed && !oldRefs.reused, { swapped, oldRefs });
await page.evaluate(() => { const w = (window as any).__arena.world; w.sheathe(w.hero, false); });
const redrawn = await gearNow(); check('draw after the swap lands exactly in the hands', inHands(redrawn), redrawn);
report.transfer = { stowed, drawn, reversal, swapped, redrawn };

// Posed frames show the drawn loadout: hold the alert so the idle timer cannot sling the gear onto the back.
await page.evaluate(() => { const w = (window as any).__arena.world, h = w.hero; h.alertT = 1e9; if (h.sheathed) w.sheathe(h, false); h.relaxed = false; });
for (const [view, pitch, yaw, zoom] of VIEWS) {
  await page.evaluate(([p, y, z]) => { const a = (window as any).__arena; a.view(p, y); a.zoom(z); }, [pitch, yaw, zoom]);
  for (const [clip, f] of POSES) {
    const ok = await page.evaluate(([c, f]) => (window as any).__arena.pose(c, f, 0), [clip, f] as const);
    if (!ok) { console.log('missing', clip); continue; }
    await page.waitForTimeout(300);
    // Full clip path in the name, so ready/... and sword_and_shield/... views never overwrite each other.
    const file = `${view}-${clip.replace(/[^a-z0-9]+/gi, '_')}-${String(f).replace('.', '')}.png`;
    await page.screenshot({ path: join(out, file) });
    report[file] = await probe(page);
  }
}
// Sheathed: the relaxed idle with the gear slung on the back, seen from behind and the side.
await page.evaluate(() => { const w = (window as any).__arena.world; w.sheathe(w.hero, true); w.hero.relaxed = true; });
for (const [view, yaw] of [['back', Math.PI], ['side', Math.PI * .5]] as const) {
  await page.evaluate(([y]) => { const a = (window as any).__arena; a.view(.18, y); a.zoom(5.2); a.pose('locomotion/idle', .3, 0); }, [yaw]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `sheathed-${view}.png`) });
  report[`sheathed-${view}.png`] = await probe(page);
}
// Stow -> draw round trip: the redrawn guard must match the guard captured before stowing.
await page.evaluate(() => { const a = (window as any).__arena, w = a.world; w.sheathe(w.hero, false); w.hero.relaxed = false; a.view(.18, Math.PI * .7); a.zoom(5.2); a.pose('sword_and_shield/sword and shield block idle', .5, 0); });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'redrawn-shieldside-block_idle-05.png') });
report['redrawn-shieldside-block_idle-05.png'] = await probe(page);
} catch (e) {
  await page.screenshot({ path: join(out, 'fail-aborted.png') }).catch(() => undefined);
  check('harness completed every step', false, String((e as Error).message));
}
report.heroBody = await page.evaluate(() => { const w = (window as any).__arena?.world; return w ? { ...w.heroBody, creator: Object.fromEntries(w.assets.creatorStatus ?? []) } : null; }).catch(() => null);
report.fits = await page.evaluate(() => Object.fromEntries((window as any).__arena?.world?.fitReports ?? [])).catch(() => null);
report.partBounds = await page.evaluate(() => Object.fromEntries((window as any).__arena?.world?.assets?.partBounds ?? [])).catch(() => null);
report.checks = checks; report.errors = errors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await ctx.close().catch(() => undefined); await browser.close().catch(() => undefined);
console.log(`sword-and-shield preview -> ${out} (${checks.filter(c => c.ok).length}/${checks.length} checks, ${errors.length} page errors)`);
process.exit(checks.every(c => c.ok) && !errors.length ? 0 : 1);
