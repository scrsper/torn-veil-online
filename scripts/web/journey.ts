import { chromium } from 'playwright';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * A long, scripted, ordinary-input session in real Chrome against the production bundle and the isolated
 * preview world. It is a soak and a smoke: it walks, sprints, turns, talks to whoever it stands next to,
 * opens menus, strikes, guards and dodges, and every 30 s records what a long session could get wrong
 * (heap, scene object counts, resident regions, frame-time tail, prediction corrections, latency, errors).
 *
 *   tsx scripts/web/journey.ts --minutes 45 --out .debug/web/journey
 *
 * Input is automated and seeded. It is evidence of stability and of the ordinary input path; it is NOT a
 * human playtest and says nothing about feel or enjoyment.
 */
const argv = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const minutes = Number(flag('minutes', '45'));
const [w, h] = flag('size', '1920x1080').split('x').map(Number);
const out = resolve(flag('out', '.debug/web/journey')); mkdirSync(out, { recursive: true });
const sampleEvery = Number(flag('sample', '30')) * 1000;

let seed = Number(flag('seed', '918271')) >>> 0;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const st = JSON.parse(readFileSync(join(homedir(), 'TornVeilAlpha', 'web-gateway', 'gateway.json'), 'utf8')) as { origin: string; operator: string };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(st.origin)) throw new Error('gateway must be loopback');
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', `--window-size=${w + 16},${h + 130}`, '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.addInitScript('window.__name = (f) => f;');
const errors: string[] = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`${new Date().toISOString()} ${m.text().slice(0, 200)}`); });
page.on('pageerror', e => errors.push(`${new Date().toISOString()} pageerror ${String(e).slice(0, 240)}`));
const { url: launch } = await (await fetch(`${st.origin}/api/operator/launch`, { method: 'POST', headers: { 'x-torn-veil-gateway-operator': st.operator } })).json() as { url: string };
await page.goto(launch);
await page.goto(`${st.origin}/?autoplay=1`);
await page.waitForFunction(() => (window as any).__tv?.ready === true, undefined, { timeout: 120000 });
await page.waitForTimeout(2500);
await page.mouse.move(w / 2, h / 2); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();

const counts = { travel: 0, walk: 0, sprint: 0, turn: 0, talk: 0, options: 0, menus: 0, attacks: 0, guards: 0, dodges: 0, interactAttempts: 0, reconnects: 0 };
const sample = () => page.evaluate(() => {
  const tv = (window as any).__tv, sc = tv.ctx.scene, mem = (performance as any).memory;
  const a = (tv.frameMs as number[]).slice().sort((x, y) => x - y), q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
  tv.perfReset();
  const p = tv.predictor.predicted;
  return {
    heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null, meshes: sc.meshes.length, materials: sc.materials.length, textures: sc.textures.length, skeletons: sc.skeletons.length, lights: sc.lights.length,
    regions: tv.regions.regions.size, actors: [...tv.actors.all()].length, medianMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2), p99Ms: +q(0.99).toFixed(2), maxMs: +(a[a.length - 1] ?? 0).toFixed(1), frames: a.length,
    corrections: tv.predictor.corrections, rttMs: tv.link.rttMs ?? null, link: tv.link.status, phase: tv.phase, pos: p ? [+p.pos.x.toFixed(1), +p.pos.z.toFixed(1)] : null,
    dialogueOpen: !!tv.dialogue.isOpen, modalOpen: !!tv.modal.isOpen, hp: tv.hud?.lastHealth ?? null,
  };
});
const state = () => page.evaluate(() => { const tv = (window as any).__tv; return { dialogue: !!tv.dialogue.isOpen, modal: !!tv.modal.isOpen, target: tv.focus?.target?.kind ?? null, dead: !!tv.own?.()?.dead, screen: !!tv.screen }; });

const t0 = Date.now(); let nextSample = t0 + sampleEvery, nextShot = t0 + 240_000, shots = 0;
const log = join(out, 'samples.jsonl'); writeFileSync(log, '');
async function look(dx: number) { const n = Math.max(1, Math.ceil(Math.abs(dx) / 30)); for (let i = 0; i < n; i++) { await page.mouse.move(w / 2 + Math.random() * 0, h / 2); await page.mouse.move(w / 2 + (dx / n), h / 2); } }
async function tryTalk() {
  counts.interactAttempts++;
  await page.keyboard.press('KeyE'); await page.waitForTimeout(900);
  const s = await state();
  if (!s.dialogue) return;
  counts.talk++;
  for (let i = 0; i < 3 + Math.floor(rnd() * 3); i++) { await page.keyboard.press('Enter'); counts.options++; await page.waitForTimeout(1500); if (!(await state()).dialogue) break; }
  if ((await state()).dialogue) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
}
async function menus() {
  counts.menus++;
  for (const k of ['KeyI', 'KeyJ', 'Tab']) { await page.keyboard.press(k); await page.waitForTimeout(700); await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(600);
  if ((await state()).modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
  await page.mouse.move(w / 2, h / 2); await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(300);   // re-capture the pointer like a player would
}
async function combat() {
  for (let i = 0; i < 3; i++) {
    const r = rnd();
    if (r < 0.4) { await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); counts.attacks++; await page.waitForTimeout(450); }
    else if (r < 0.6) { await page.keyboard.press('KeyG'); counts.attacks++; await page.waitForTimeout(700); }
    else if (r < 0.8) { await page.mouse.down({ button: 'right' }); await page.waitForTimeout(500); await page.mouse.up({ button: 'right' }); counts.guards++; }
    else { await page.keyboard.down(pick(['KeyA', 'KeyD', 'KeyS'])); await page.keyboard.press('Space'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyS'); counts.dodges++; await page.waitForTimeout(500); }
  }
}
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
async function settlementCentres(): Promise<{ x: number; z: number; name: string }[]> {
  return page.evaluate(() => { const tv = (window as any).__tv, out: any[] = []; for (const r of tv.regions.regions.values()) for (const st of r.projection.settlements ?? []) { const b = st.bounds; out.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, name: st.name ?? st.id ?? 'settlement' }); } return out; });
}
async function travel(): Promise<void> {
  const here = await page.evaluate(() => { const p = (window as any).__tv.predictor.predicted.pos; return { x: p.x, z: p.z }; });
  const cs = (await settlementCentres()).sort((a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z));
  if (!cs.length) { await move(8, true); return; }
  const c = cs[0]; counts.travel++;
  const end = Date.now() + 60_000;
  try { while (Date.now() < end) { const d = await steerStep(c.x, c.z, true); if (d < 14) break; await page.waitForTimeout(400); } } finally { await releaseKeys(); }
}
async function move(seconds: number, sprint: boolean) {
  if (sprint) await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { await look((rnd() - 0.5) * 240); await page.waitForTimeout(500 + rnd() * 900); if (rnd() < 0.08) { await page.keyboard.up('KeyW'); await page.waitForTimeout(150); await page.keyboard.down('KeyW'); } }
  await page.keyboard.up('KeyW'); if (sprint) await page.keyboard.up('ShiftLeft');
  sprint ? counts.sprint++ : counts.walk++;
}

const deadline = t0 + minutes * 60_000;
while (Date.now() < deadline) {
  const s = await state();
  if (s.dead) { errors.push(`${new Date().toISOString()} character died; journey ends`); break; }
  if (s.screen) { errors.push(`${new Date().toISOString()} a blocking screen is up (connection or notice); journey ends`); break; }
  if (s.dialogue || s.modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }
  const r = rnd();
  if (r < 0.22) await travel();
  else if (r < 0.40) await move(6 + rnd() * 10, false);
  else if (r < 0.52) await move(5 + rnd() * 8, true);
  else if (r < 0.60) { await look((rnd() - 0.5) * 1200); counts.turn++; }
  else if (r < 0.86) await tryTalk();
  else if (r < 0.93) await menus();
  else await combat();
  if (Date.now() >= nextSample) { nextSample += sampleEvery; const smp = await sample(); appendFileSync(log, JSON.stringify({ tMin: +((Date.now() - t0) / 60000).toFixed(2), ...smp, counts: { ...counts }, errors: errors.length }) + '\n'); }
  if (Date.now() >= nextShot) { nextShot += 240_000; await page.screenshot({ path: join(out, `shot-${String(++shots).padStart(2, '0')}.png`) }); }
}
const final = await sample();
writeFileSync(join(out, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), minutesRequested: minutes, minutesRun: +((Date.now() - t0) / 60000).toFixed(1), size: `${w}x${h}`, counts, final, errors: errors.slice(0, 40), note: 'Automated seeded ordinary-input session against the isolated preview world (dev environment). Not a human playtest.' }, null, 1));
await page.screenshot({ path: join(out, 'final.png') });
console.log(JSON.stringify({ minutesRun: +((Date.now() - t0) / 60000).toFixed(1), counts, final, errors: errors.length }, null, 1));
await browser.close();
