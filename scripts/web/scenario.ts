import { chromium, type Page } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * A targeted, ordinary-input scenario: find a person, talk, read the options, buy or decline with the
 * confirmation, open Items / Abilities / Journal, save, reconnect, and check the same person returned with
 * the same purse and belongings. Real headed Chrome, the production bundle, the isolated preview world,
 * trusted keyboard and mouse events only. It records what happened at each step; a step that could not
 * be done (nobody nearby, nothing for sale) is reported as such, not skipped silently.
 *
 *   tsx scripts/web/scenario.ts --out .debug/web/scenario [--size 1920x1080] [--renderer webgpu|webgl2]
 *
 * Automated input: evidence for the ordinary input path, not a human playtest.
 */
const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const [w, h] = flag('size', '1920x1080').split('x').map(Number);
const renderer = flag('renderer', 'webgpu');
const gotoFlag = flag('goto', '');   // "x,z": where to head when no settlement is resident yet (the preview world's village is at about 12038,20011)
const newName = flag('name', '');   // begin a new life in the preview world (arrives at the spawn point, beside the village) instead of continuing the current one
const out = resolve(flag('out', '.debug/web/scenario')); mkdirSync(out, { recursive: true });

const st = JSON.parse(readFileSync(join(homedir(), 'TornVeilAlpha', process.env.TV_GW_DIR ?? 'web-gateway', 'gateway.json'), 'utf8')) as { origin: string; operator: string };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(st.origin)) throw new Error('gateway must be loopback');
const args = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--window-size=${w + 16},${h + 130}`];
if (renderer === 'webgpu') args.push('--enable-unsafe-webgpu', '--ignore-gpu-blocklist');
const browser = await chromium.launch({ channel: 'chrome', headless: false, args });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.addInitScript('window.__name = (f) => f;');
const errors: string[] = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push(`pageerror ${String(e).slice(0, 240)}`));
const report: { step: string; ok: boolean | null; detail?: unknown }[] = [];
const note = (step: string, ok: boolean | null, detail?: unknown) => { report.push({ step, ok, detail }); console.log(`${ok === null ? '..' : ok ? 'ok' : 'NO'} ${step}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 220) : ''}`); };
const shot = (n: string) => page.screenshot({ path: join(out, `${n}.png`) });

async function start(): Promise<void> {
  const { url } = await (await fetch(`${st.origin}/api/operator/launch`, { method: 'POST', headers: { 'x-torn-veil-gateway-operator': st.operator } })).json() as { url: string };
  await page.goto(url);
  await page.goto(`${st.origin}/?autoplay=1${newName ? `&name=${encodeURIComponent(newName)}` : ''}${renderer === 'webgl2' ? '&renderer=webgl2' : ''}`);
  await page.waitForFunction(() => (window as any).__tv?.ready === true, undefined, { timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.mouse.move(w / 2, h / 2); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(300);
}
const own = () => page.evaluate(() => { const tv = (window as any).__tv, b = tv.own(); return b ? { id: b.bodyId, name: b.name, wealth: b.wealth, health: b.health, carried: (tv.snapshot?.carried ?? []).map((c: any) => `${c.name}${c.quantity > 1 ? ' x' + c.quantity : ''}`), pos: [+b.pos.x.toFixed(1), +b.pos.z.toFixed(1)] } : null; });
const state = () => page.evaluate(() => { const tv = (window as any).__tv; return { dialogue: !!tv.dialogue.isOpen, modal: !!tv.modal.isOpen, target: tv.focus?.target ? { kind: tv.focus.target.kind, label: tv.focus.target.label ?? tv.focus.target.name ?? null } : null, screen: !!tv.screen, phase: tv.phase }; });

/**
 * Steer toward a simulation position with the ordinary movement keys only. Movement is camera-relative, so the
 * best of the eight key combinations toward the target is held and re-chosen every few hundred milliseconds
 * (no mouse turning: synthetic mouse deltas in pointer lock are relative to the last synthetic position and
 * cannot be recentred without also turning). Returns the remaining distance in metres.
 */
const held = new Set<string>();
async function setKeys(want: string[]): Promise<void> {
  for (const k of [...held]) if (!want.includes(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
async function steerStep(x: number, z: number, sprint: boolean): Promise<number> {
  const r = await page.evaluate(([tx, tz]) => { const tv = (window as any).__tv, p = tv.predictor.predicted.pos, y = tv.rig.yaw; const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz) || 1; const ux = dx / d, uz = dz / d; return { d, fwd: ux * -Math.sin(y) + uz * -Math.cos(y), right: ux * Math.cos(y) + uz * -Math.sin(y) }; }, [x, z]);
  const keys: string[] = [];
  if (r.fwd > 0.38) keys.push('KeyW'); else if (r.fwd < -0.38) keys.push('KeyS');
  if (r.right > 0.38) keys.push('KeyD'); else if (r.right < -0.38) keys.push('KeyA');
  if (sprint && keys.length) keys.push('ShiftLeft');
  await setKeys(keys);
  return r.d;
}
async function releaseKeys(): Promise<void> { await setKeys([]); }
type Goal = { x: number; z: number; label: string };
const people = (): Promise<Goal[]> => page.evaluate(() => { const tv = (window as any).__tv, s = tv.snapshot, me = tv.own(); if (!s || !me) return []; return s.bodies.filter((b: any) => b.bodyId !== me.bodyId && !b.dead && !b.incapacitated).map((b: any) => ({ x: b.pos.x, z: b.pos.z, label: b.name })).sort((a: any, b: any) => Math.hypot(a.x - me.pos.x, a.z - me.pos.z) - Math.hypot(b.x - me.pos.x, b.z - me.pos.z)); });
const settlements = (): Promise<Goal[]> => page.evaluate(() => { const tv = (window as any).__tv, me = tv.own(), out: any[] = []; for (const r of tv.regions.regions.values()) for (const s of r.projection.settlements ?? []) { const b = s.bounds; out.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, label: s.name ?? s.id }); } return out.sort((a, b) => Math.hypot(a.x - me.pos.x, a.z - me.pos.z) - Math.hypot(b.x - me.pos.x, b.z - me.pos.z)); });
async function walkTo(g: Goal, stopAt: number, maxMs: number, sprint = true): Promise<boolean> {
  const end = Date.now() + maxMs; let arrived = false;
  try { while (Date.now() < end) { const d = await steerStep(g.x, g.z, sprint); if (d < stopAt) { arrived = true; break; } await page.waitForTimeout(350); } } finally { await releaseKeys(); }
  return arrived;
}
const dialogueText = () => page.evaluate(() => ({ title: document.querySelector('.tv-talk .tv-h2')?.textContent ?? '', lines: [...document.querySelectorAll('.tv-talk .tv-line')].map(e => e.textContent), options: [...document.querySelectorAll('.tv-talk button.tv-opt')].map(e => e.textContent) }));

await start();
const resources = () => page.evaluate(() => { const sc = (window as any).__tv.ctx.scene; return { materials: sc.materials.length, textures: sc.textures.length, meshes: sc.meshes.length, heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null }; });
const before = await own();
const res0 = await resources();
note('entered the world with the existing character', !!before, before);
await shot('01-start');

let bought = false;
let target: Goal | undefined = (await people())[0];
for (let attempt = 0; !target && attempt < 6; attempt++) {
  const s = (await settlements())[0] ?? (gotoFlag ? { x: Number(gotoFlag.split(',')[0]), z: Number(gotoFlag.split(',')[1]), label: 'the given place' } : undefined);
  if (!s) { note('no settlement is resident near the character', false); break; }
  note(`walking toward ${s.label}`, null, { x: Math.round(s.x), z: Math.round(s.z) });
  await walkTo(s, 20, 70_000);
  target = (await people())[0];
}
if (target) {
  const d0 = await (async () => { const m = await own(); return Math.hypot(target!.x - m!.pos[0], target!.z - m!.pos[1]); })();
  note('someone is in view', true, { who: target.label, metres: Math.round(d0) });
  let close = false;
  for (let i = 0; i < 12 && !close; i++) {
    const p = (await people()).find(x => x.label === target!.label) ?? (await people())[0]; if (!p) break; target = p;
    close = await walkTo(p, 2.2, 12_000, false);
  }
  // Several things can be within reach (a chest, a person): the prompt follows what is nearest and best framed. Close the last metre on the person.
  for (let i = 0; i < 4 && (await state()).target?.kind !== 'person'; i++) {
    const p = (await people()).find(x => x.label === target!.label) ?? (await people())[0]; if (!p) break; target = p;
    await walkTo(p, 0.9, 4_000, false);
  }
  await shot('02-approached');
  const s1 = await state();
  note('a talk prompt is offered when standing next to them', s1.target?.kind === 'person', s1.target);
  await page.keyboard.press('KeyE'); await page.waitForTimeout(1200);
  const s2 = await state();
  note('pressing E opens the conversation panel', s2.dialogue);
  if (s2.dialogue) {
    await page.waitForTimeout(800); await shot('03-conversation');
    const d1 = await dialogueText();
    note('conversation shows a name, their line(s) and grouped options', d1.title.length > 0 && d1.options.length > 0, { title: d1.title, lines: d1.lines.slice(0, 2), options: d1.options.slice(0, 8) });
    // First harmless option: the number key 1 (an ask/intro), then look again.
    await page.keyboard.press('1'); await page.waitForTimeout(1600);
    const d2 = await dialogueText(); await shot('04-after-first-choice');
    note('choosing an option by number key advances the transcript', d2.lines.length > d1.lines.length, { lines: d2.lines.slice(-3) });
    // Trade, if the person offers it.
    const tradeIdx = d2.options.findIndex(o => /^trade|^buy |^more goods/i.test(String(o).replace(/^\d+/, '').trim()));
    if (tradeIdx >= 0 && tradeIdx < 9) { await page.keyboard.press(String(tradeIdx + 1)); await page.waitForTimeout(1500); await shot('05-trade-list'); }
    const d3 = await dialogueText();
    const isBuy = (o: unknown) => /^\d*\s*Buy .*\d+ silver/i.test(String(o).trim());
    const buyIdx = (() => { const food = d3.options.findIndex(o => isBuy(o) && /bread|cheese|meal|stew|pie|meat|ale/i.test(String(o))); return food >= 0 ? food : d3.options.findIndex(isBuy); })();   // prefer something that can be eaten, so the next step can use it   // the panel lifts the price into its own column, so read the rendered text
    const walletBefore = (await own())?.wealth;
    if (buyIdx >= 0 && buyIdx < 9) {
      await page.keyboard.press(String(buyIdx + 1)); await page.waitForTimeout(700); await shot('06-confirm');
      const confirmShown = await page.evaluate(() => !!document.querySelector('.tv-talk .tv-confirm'));
      note('a purchase asks for confirmation before spending', confirmShown, { option: d3.options[buyIdx] });
      if (confirmShown) { await page.keyboard.press('Enter'); await page.waitForTimeout(1800); }
      const walletAfter = (await own())?.wealth;
      note('the purchase is reflected in the purse', typeof walletBefore === 'number' && typeof walletAfter === 'number' ? walletAfter < walletBefore : null, { before: walletBefore, after: walletAfter });
      bought = typeof walletBefore === 'number' && typeof walletAfter === 'number' && walletAfter < walletBefore;
    } else note('nothing was offered for sale right now', null, { options: d3.options.slice(0, 10) });
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    note('Escape leaves the conversation', !(await state()).dialogue);
  }
} else note('could not find anyone to talk to', false);

// 3b. Use what was bought: Items -> Eat / Drink, if it offers one.
if (bought) {
  const beforeItems = (await own())?.carried ?? [];
  await page.keyboard.press('KeyI'); await page.waitForTimeout(900); await shot('07a-items-with-purchase');
  const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('.tv-dialog button')].find(x => /^(eat|drink)/i.test(x.textContent?.trim() ?? '') && !(x as HTMLButtonElement).disabled) as HTMLElement | undefined; if (b) { b.click(); return b.textContent?.trim() ?? ''; } return ''; });
  await page.waitForTimeout(1800);
  const afterItems = (await own())?.carried ?? [];
  note('the bought item is in the Items list and can be used from there', beforeItems.length > 0 && !!clicked, { carried: beforeItems, clicked });
  note('using it consumes it', clicked ? JSON.stringify(afterItems) !== JSON.stringify(beforeItems) : null, { before: beforeItems, after: afterItems });
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  await page.mouse.move(w / 2, h / 2); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(300);
}

for (const [key, name] of [['KeyI', 'items'], ['Tab', 'abilities'], ['KeyJ', 'journal']] as const) {
  await page.keyboard.press(key); await page.waitForTimeout(900);
  const open = (await state()).modal; await shot(`07-${name}`);
  const text = open ? await page.evaluate(() => (document.querySelector('.tv-dialog') as HTMLElement | null)?.innerText?.slice(0, 260) ?? '') : '';
  note(`${name} menu opens with content`, open && text.length > 20, text.replace(/\s+/g, ' ').slice(0, 160));
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  if ((await state()).modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
}
await page.mouse.move(w / 2, h / 2); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(300);

const preSave = await own();
await page.keyboard.press('Escape'); await page.waitForTimeout(900); await shot('08-pause');
const clickText = async (t: string) => page.evaluate((txt: string) => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === txt) as HTMLElement | undefined; if (b) { b.click(); return true; } return false; }, t);
note('the pause menu offers Save', await clickText('Save the world now'));
await page.waitForTimeout(2500); await shot('09-saved');
const toast = await page.evaluate(() => [...document.querySelectorAll('.tv-toasts > *')].map(e => e.textContent).join(' | '));
note('saving reports a result', /saved/i.test(toast), toast.slice(0, 120));
if (!(await state()).modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(900); }
note('the pause menu offers Reconnect', await clickText('Reconnect'));
try { await page.waitForFunction(() => { const tv = (window as any).__tv; return tv.phase === 'playing' && tv.predictor.hasState; }, undefined, { timeout: 60000 }); await page.waitForTimeout(2500); } catch { /* checked below */ }
const post = await own(); await shot('10-after-reconnect');
note('the same person returns after reconnect', !!post && !!preSave && post.id === preSave.id, { before: preSave?.name, after: post?.name });
note('purse and belongings are unchanged across reconnect', !!post && !!preSave && post.wealth === preSave.wealth && JSON.stringify(post.carried) === JSON.stringify(preSave.carried), { before: preSave && { w: preSave.wealth, c: preSave.carried }, after: post && { w: post.wealth, c: post.carried } });

const res1 = await resources();
note('scene objects after the whole scenario (materials/textures/meshes)', null, { start: res0, end: res1 });
writeFileSync(join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), renderer, size: `${w}x${h}`, report, errors: errors.slice(0, 20), note: 'Automated ordinary-input scenario against the isolated preview world. Not a human playtest.' }, null, 1));
console.log(JSON.stringify({ steps: report.length, ok: report.filter(r => r.ok === true).length, failed: report.filter(r => r.ok === false).length, unknown: report.filter(r => r.ok === null).length, errors: errors.length }));
await browser.close();
