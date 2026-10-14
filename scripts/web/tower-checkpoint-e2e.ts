/**
 * Tower expedition checkpoints, end to end in a real browser (dev server running):
 *   npx tsx scripts/web/tower-checkpoint-e2e.ts [--name checkpoint-e2e] [--seed 7]
 * A fresh, isolated browser context (never the player's profile) whose localStorage persists across reloads. Every
 * Continue / recovery choice is made by clicking the Tower's own menu cards; fighting uses real keys and mouse (the
 * tower-climb.ts approach). Three steps are forced by the harness and labelled as such: the render loop is stopped just
 * before the floor-1 reload so the lifetime baseline is an atomic snapshot (play otherwise continues into the reload),
 * the hero's death (instant kill) and walking to the Proving Hall exit (hero moved beside it). Writes .debug/arena/<name>/report.json and
 * screenshots, and exits non-zero when a check fails.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeInput } from './tower-driver';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'checkpoint-e2e'), seed = arg('seed', '7');
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const HOST = process.env.ARENA_HOST ?? 'http://127.0.0.1:5180', KEY = 'tv.tower.expedition.v1', W = 1100, H = 700;
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${W + 16},${H + 130}`] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
const page = await ctx.newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
// Storage is NOT cleared on load. Every checkpoint write is logged (floor, run) to a QA key in this isolated profile.
await page.addInitScript(([key]) => {
  (window as any).__name = (f: unknown) => f;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    if (k === key) { let f = -1, r = ''; try { const x = JSON.parse(v); f = x.floor; r = x.runId; } catch { /* corrupt fixtures */ } const log = JSON.parse(this.getItem('qa.checkpoint.writes') ?? '[]'); log.push({ floor: f, run: r }); set.call(this, 'qa.checkpoint.writes', JSON.stringify(log)); }
    return set.call(this, k, v);
  };
}, [KEY]);

const checks: { step: string; ok: boolean; detail?: unknown }[] = [];
const check = (step: string, ok: boolean, detail?: unknown) => { checks.push({ step, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
let shot = 0; const snapPng = (label: string) => page.screenshot({ path: join(out, `${String(shot++).padStart(2, '0')}-${label}.png`) });

const load = async (q: string) => {
  await page.goto(`${HOST}/?arena=1&tower=1&seed=${seed}${q}`);
  await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 300_000 });
};
/** On a failed wait: screenshot, the open modal's markup, the raw checkpoint and the run's state, then rethrow. */
const diagnose = async (label: string) => {
  await page.screenshot({ path: join(out, `fail-${label}.png`) }).catch(() => undefined);
  const d = await page.evaluate(key => { const a = (window as any).__arena, t = a?.tower; return { url: location.href, modalOn: !!document.querySelector('.ar-modal.on'), modalHtml: document.querySelector('.ar-modal')?.innerHTML.slice(0, 2000), hudModalOpen: a?.hud.modalOpen,
    raw: localStorage.getItem(key), writes: localStorage.getItem('qa.checkpoint.writes'), tower: t && { floor: t.floor, kind: t.plan?.kind, persistent: t.persistent, startFloor: t.startFloor, over: t.over, runId: t.runId } }; }, KEY).catch(e => ({ evalError: String(e) }));
  writeFileSync(join(out, `fail-${label}.json`), JSON.stringify(d, null, 1)); return d;
};
const waitModal = async (title: string) => {
  try { await page.waitForFunction(t => !!document.querySelector('.ar-modal.on h2') && document.querySelector('.ar-modal.on h2')!.textContent!.includes(t), title, { timeout: 60_000 }); }
  catch (e) { const d = await diagnose(title.replace(/\W+/g, '-')); throw Object.assign(new Error(`modal "${title}" never opened`), { diagnostics: d, cause: e }); }
};
const clickCard = async (i: number) => { await page.locator('.ar-modal.on .ar-card').nth(i).click(); await page.waitForTimeout(300); };
const ready = () => page.waitForFunction(() => { const t = (window as any).__arena.tower; return !!t.plan && !(window as any).__arena.hud.modalOpen; }, null, { timeout: 120_000 });

/** Everything that checkpoints, rewards and lifetime receipts are made of. */
const state = (p: Page) => p.evaluate(key => {
  const a = (window as any).__arena, t = a.tower, w = a.world, ls = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return localStorage.getItem(k); } };
  return {
    floor: t.floor, kind: t.plan?.kind, runId: t.runId, seed: t.seed, persistent: t.persistent, over: t.over, level: w.level, xp: w.xp, mods: w.mods,
    gear: Object.values(t.gear).map((g: any) => g.id).sort(), armor: t.armorItem?.id ?? null, charm: t.charm?.id ?? null, known: t.known.map((k: any) => k.id).sort(),
    earned: [...t.earned].sort(), boxes: [...t.boxes], belt: t.belt.map((b: any) => b.id), kills: t.stats.kills, historyKills: t.sheet.history.kills, door: t.doorOpen,
    checkpointRaw: localStorage.getItem(key), checkpoint: ls(key), lifetime: ls('tv.tower.achievements.v2'), codex: ls('tv.tower.codex.v1'), writes: ls('qa.checkpoint.writes') ?? [],
  };
}, KEY);
type St = Awaited<ReturnType<typeof state>>;
const savedView = (c: any) => c && { floor: c.floor, runId: c.runId, level: c.world.level, xp: c.world.xp, gear: Object.values(c.gear).map((g: any) => g.id).sort(), armor: c.armor?.id ?? null, charm: c.charm?.id ?? null, known: c.known.map((k: any) => k.id).sort(), earned: [...c.earned].sort(), boxes: c.boxes, belt: c.belt.map((b: any) => b.id), kills: c.stats.kills };
const liveView = (s: St) => ({ floor: s.floor, runId: s.runId, level: s.level, xp: s.xp, gear: s.gear, armor: s.armor, charm: s.charm, known: s.known, earned: s.earned, boxes: s.boxes, belt: s.belt, kills: s.kills });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Real-input fighting (tower-climb.ts approach): until `until(state)` holds or time runs out. Cards are taken as offered. */
const held = new Set<string>();
const hold = async (k: string, on: boolean) => { if (on && !held.has(k)) { await page.keyboard.down(k); held.add(k); } if (!on && held.has(k)) { await page.keyboard.up(k); held.delete(k); } };
const steer = async (dx: number, dz: number) => { const f = -(dx + dz) / Math.SQRT2, r = (dx - dz) / Math.SQRT2, l = Math.hypot(f, r) || 1; await hold('KeyW', f / l > .38); await hold('KeyS', f / l < -.38); await hold('KeyD', r / l > .38); await hold('KeyA', r / l < -.38); };
const fight = async (until: (s: any) => boolean, seconds: number, walkOut = false) => {
  const t0 = Date.now(); let down = false;
  await page.mouse.click(W / 2, H / 2 - 120);
  while ((Date.now() - t0) / 1000 < seconds) {
    if (await page.locator('.ar-modal.on .ar-card').count()) { await clickCard(0); continue; }
    const s = await page.evaluate(() => { const a = (window as any).__arena, t = a.tower, w = a.world; return { floor: t.floor, kills: t.stats.kills, open: t.doorOpen, hero: { x: w.hero.pos.x, z: w.hero.pos.z }, exit: t.plan.exit, xp: w.xp, level: w.level,
      foes: w.fighters.filter((f: any) => f.role === 'foe' && f.alive && f.foeKind !== 'dummy').map((f: any) => ({ x: f.pos.x, z: f.pos.z })), loot: t.pickups.map((p: any) => ({ x: p.pos.x, z: p.pos.z })) }; });
    if (until(s)) break;
    let target: { x: number; z: number } | null = null, attack = false;
    if (s.foes.length) { target = s.foes.reduce((b: any, f: any) => Math.hypot(f.x - s.hero.x, f.z - s.hero.z) < Math.hypot(b.x - s.hero.x, b.z - s.hero.z) ? f : b); attack = Math.hypot(target!.x - s.hero.x, target!.z - s.hero.z) < 3; }
    else if (s.loot.length) target = s.loot[0];
    else if (walkOut && s.open) target = s.exit;
    if (target) {
      const p = await page.evaluate(([x, z]) => (window as any).__arena.screen(x, 1, z), [target.x, target.z]); await page.mouse.move(Math.max(5, Math.min(W - 5, p.x)), Math.max(5, Math.min(H - 5, p.y)));
      const route = await routeInput(page, target.x, target.z); attack = attack && route.visible && route.distance < 2.3;
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) await hold(k, !attack && route.distance > .6 && route.keys.includes(k));
      if (attack !== down) { attack ? await page.mouse.down() : await page.mouse.up(); down = attack; }
    } else await steer(0, 0);
    await page.waitForTimeout(80);
  }
  if (down) await page.mouse.up(); for (const k of [...held]) await hold(k, false);
};

let afterDeath: unknown = null, aborted: unknown = null;
try {
await load(''); await ready(); await page.evaluate(() => (window as any).__arena.hud.showHelp(false));
let s = await state(page);
check('A1 fresh climb starts on floor 1 with a floor-1 checkpoint', s.floor === 1 && s.checkpoint?.floor === 1 && s.checkpoint.runId === s.runId, { floor: s.floor, saved: s.checkpoint?.floor });
check('A2 exactly one checkpoint write so far', s.writes.length === 1, s.writes);
const run1 = s.runId, floor1Saved = savedView(s.checkpoint);
await snapPng('floor1-start');

await fight(x => x.kills >= 3 && x.loot.length === 0, 120);
const mid = await state(page);
check('B1 mid-floor progress happened', mid.kills >= 3 && (mid.xp > 0 || mid.level > 1), { kills: mid.kills, xp: mid.xp, level: mid.level, earned: mid.earned });
check('B2 mid-floor play did not write a checkpoint', mid.writes.length === 1 && mid.checkpointRaw === s.checkpointRaw, mid.writes);
await snapPng('floor1-mid');
if (mid.kills < 3) throw Error('Combat driver did not clear floor 1; later checkpoint checks cannot run.');
// Forced step (harness): the reload baseline is atomic. Play kept running after `mid` (the hero could still walk over a
// dropped essence), and a first-time award recorded in that gap failed C3 although the reload changed nothing
// (.debug/arena/checkpoint-e2e-corrected). So this page's render loop, which runs the whole game step, is stopped first and
// the lifetime record is read in the same call; the reload then starts a fresh page normally. C3 stays strict equality.
const lifetimeAfterFirstTry = await page.evaluate(() => {
  (window as any).__arena.scene.getEngine().stopRenderLoop();
  const raw = localStorage.getItem('tv.tower.achievements.v2'); return raw ? JSON.parse(raw) : null;
});
await page.reload(); await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 300_000 });
await waitModal('Tower of Chrysanthus'); await snapPng('menu-continue'); await clickCard(0); await ready();
s = await state(page);
check('C1 Continue restores the same expedition on floor 1', s.runId === run1 && s.floor === 1, { runId: s.runId, floor: s.floor });
check('C2 floor retry rolls mid-floor rewards back to the checkpoint', same(liveView(s), floor1Saved), { live: liveView(s), saved: floor1Saved });
check('C3 lifetime achievement records unchanged by the reload', same(s.lifetime, lifetimeAfterFirstTry), { before: lifetimeAfterFirstTry, after: s.lifetime });
check('C4 resuming wrote no checkpoint', s.writes.length === 1, s.writes);
// Re-earn the same run achievements on the retry: what the lifetime record already holds must not move (no double count,
// no lost receipt); a genuinely new first-time award may be added once (see C5).
await fight(x => x.kills >= 3 && x.loot.length === 0, 120);
s = await state(page);
const reEarned = mid.earned.filter((e: string) => s.earned.includes(e));
// recordEarned counts each receipt (run:achievement) once. The real-input retry may also earn something the first try did
// not (e.g. absorbing an essence): that is a genuine first-time award, one new count with one new receipt, not a double
// count. (A strict whole-record equality failed on exactly that once: .debug/arena/checkpoint-e2e-final, essence.)
{
  const b = lifetimeAfterFirstTry ?? { counts: {}, receipts: [] }, a = s.lifetime ?? { counts: {}, receipts: [] };
  const priorUnchanged = Object.entries(b.counts as Record<string, number>).every(([k, v]) => (a.counts as Record<string, number>)[k] === v) && (b.receipts as string[]).every(r => (a.receipts as string[]).includes(r));
  const newKeys = Object.keys(a.counts).filter(k => !(k in b.counts)), newReceipts = (a.receipts as string[]).filter(r => !(b.receipts as string[]).includes(r));
  const newOnce = newKeys.every(k => (a.counts as Record<string, number>)[k] === 1 && newReceipts.filter(r => r === `${s.runId}:${k}`).length === 1) && newReceipts.length === newKeys.length;
  check('C5 retry re-earns run achievements without double-counting lifetime receipts', reEarned.length > 0 && priorUnchanged && newOnce && new Set(a.receipts).size === a.receipts.length, { reEarned, newFirstTimeAwards: newKeys, before: b, after: a });
}

await fight(x => x.floor === 2, 240, true);
await page.waitForFunction(() => (window as any).__arena.tower.floor === 2 && (window as any).__arena.tower.plan?.kind, null, { timeout: 30_000 });
await page.waitForTimeout(1500);
const f2 = await state(page);
const f2Writes = f2.writes.filter((x: any) => x.floor === 2);
check('D1 advancing writes the floor-2 checkpoint exactly once', f2Writes.length === 1 && f2.checkpoint?.floor === 2 && f2.checkpoint.runId === run1, f2.writes);
check('D2 floor-2 checkpoint carries floor-1 gains', same(savedView(f2.checkpoint), liveView(f2)), { saved: savedView(f2.checkpoint), live: liveView(f2) });
await snapPng('floor2-start');

await fight(x => x.kills >= f2.kills + 1, 60);
const lifetimeF2 = (await state(page)).lifetime;
await page.reload(); await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 300_000 });
await waitModal('Tower of Chrysanthus'); await clickCard(0); await ready();
s = await state(page);
check('E1 Continue on floor 2 equals the floor-2 checkpoint exactly (no reward re-run, no loss)', same(liveView(s), savedView(f2.checkpoint)), { live: liveView(s), saved: savedView(f2.checkpoint) });
check('E2 no extra checkpoint write on resume', s.writes.length === f2.writes.length, s.writes);
check('E3 lifetime records unchanged by the floor-2 reload', same(s.lifetime, lifetimeF2), { before: lifetimeF2, after: s.lifetime });

// ---- F. Practice isolation: the Proving Hall never writes; leaving it offers Continue, and practice gains are discarded.
const beforeHall = await state(page);
await load('&hall=1'); await page.waitForFunction(() => (window as any).__arena.tower.plan?.kind === 'hall', null, { timeout: 120_000 }); await page.waitForTimeout(1500);
s = await state(page);
check('F1 Proving Hall leaves the expedition checkpoint byte-identical', s.checkpointRaw === beforeHall.checkpointRaw && s.writes.length === beforeHall.writes.length && s.persistent === false, { writes: s.writes.length, persistent: s.persistent });
await page.evaluate(() => (window as any).__arena.tower.take({ kind: 'weapon', id: 'qa-practice-blade', name: 'Practice Blade', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 99 }));
await page.evaluate(() => { const a = (window as any).__arena, t = a.tower, h = a.world.hero; h.pos.set(t.plan.exit.x, 0, t.plan.exit.z - 1); }); // HARNESS-FORCED: placed at the hall exit
await waitModal('Tower of Chrysanthus'); await snapPng('hall-exit-menu'); await clickCard(0); await ready();
s = await state(page);
check('F2 leaving practice continues the real expedition with no practice gains', same(liveView(s), savedView(beforeHall.checkpoint)) && !s.gear.includes('qa-practice-blade') && s.persistent, { live: liveView(s), saved: savedView(beforeHall.checkpoint) });
check('F3 practice wrote nothing', s.writes.length === beforeHall.writes.length && s.checkpointRaw === beforeHall.checkpointRaw, s.writes.length);

const beforeDeath = await state(page);
await page.evaluate(() => { const w = (window as any).__arena.world; w.kill(w.hero, w.hero.pos.scale(0), 0, false); });
await page.waitForSelector('.ar-modal.on .ar-btn', { timeout: 10_000 }); await snapPng('fallen');
s = await state(page);
check('G1 death removes this expedition checkpoint', s.checkpointRaw === null, s.checkpointRaw?.slice(0, 80));
check('G2 death keeps lifetime achievements and Codex', same(s.lifetime, beforeDeath.lifetime) && same(s.codex, beforeDeath.codex));
await page.locator('.ar-modal.on .ar-btn').click(); await ready(); await page.waitForTimeout(500);
s = await state(page);
check('G3 "Begin a new climb" starts a new expedition (new run, new seed) with a floor-1 checkpoint', s.runId !== run1 && s.seed !== beforeDeath.seed && s.floor === 1 && s.checkpoint?.runId === s.runId && s.checkpoint.floor === 1, { run: s.runId, seed: s.seed, floor: s.floor });
// Recorded, not asserted: what a new climb after death carries (existing behaviour predates checkpoints).
afterDeath = { level: s.level, xp: s.xp, mods: s.mods, gear: s.gear, known: s.known, beforeDeath: { level: beforeDeath.level, xp: beforeDeath.xp, mods: beforeDeath.mods } };

await page.evaluate(key => { localStorage.setItem(key, '{broken'); localStorage.setItem('legacy-world-save', 'keep'); }, KEY);
// The page is still on the &hall=1 URL from F (leaving the hall does not change it), and the hall never reads the
// expedition checkpoint, so navigate to the canonical persistent climb URL. Storage is retained.
await load('');
await waitModal('Expedition recovery'); await snapPng('recovery-corrupt');
const dl = page.waitForEvent('download', { timeout: 10_000 }); await clickCard(0); const file = await dl; const saved = join(out, 'recovered-checkpoint.json'); await file.saveAs(saved);
const raw = await page.evaluate(key => localStorage.getItem(key), KEY);
check('H1 Download recovers the corrupt data and leaves it stored', raw === '{broken' && (await import('node:fs')).readFileSync(saved, 'utf8') === '{broken');
await waitModal('Expedition recovery'); await clickCard(1); await ready();
s = await state(page);
check('H2 explicit New climb replaces it with a valid checkpoint; other saves untouched', s.checkpoint?.floor === 1 && s.checkpoint.runId === s.runId && (await page.evaluate(() => localStorage.getItem('legacy-world-save'))) === 'keep');
await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 7, floor: 3 })), KEY);
await page.reload(); await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 300_000 });
await waitModal('Expedition recovery');
const sub = await page.locator('.ar-modal.on .sub').first().textContent();
check('H3 incompatible version is identified and kept', /different version/i.test(sub ?? '') && (await page.evaluate(key => localStorage.getItem(key), KEY)) === JSON.stringify({ version: 7, floor: 3 }), sub);
await snapPng('recovery-incompatible');
} catch (e) {
  aborted = { message: String((e as Error).message), diagnostics: (e as { diagnostics?: unknown }).diagnostics ?? await diagnose('aborted') };
  check('harness completed every step', false, aborted);
}
const report = { seed, checks, afterDeath, aborted, errors, passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length, harnessForced: ['B/C: render loop stopped before the reload baseline is read (atomic snapshot; the reloaded page renders normally)', 'G: instant death via world.kill', 'F: hero placed at the Proving Hall exit'] };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${report.passed}/${checks.length} checks passed; ${errors.length} page errors -> ${out}`);
await ctx.close().catch(() => undefined); await browser.close().catch(() => undefined);
process.exit(report.failed || errors.length ? 1 : 0);
