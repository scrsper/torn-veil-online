/**
 * Floor-change resource plateau (dev server running): enter the same floors repeatedly and record scene resources after
 * each entry. Counts must stop growing after the first cycle (shared surfaces and scans are created once and kept).
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-resources.ts [--floors 4,10,20]
 * Also checks that a VFX flash light is enabled only while live, and records console errors.
 * Exits non-zero when any count grows between the 2nd and last cycle, the flash check fails or an error is logged.
 */
import { chromium } from 'playwright';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const floors = arg('floors', '4,20').split(',').map(Number), cycles = 5;
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
// Shader/WebGL failures only reach the console.
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&floor=${floors[0]}&seed=918271&body=male`);
await page.waitForFunction(f => (window as any).__arena?.tower?.plan?.floor === f, floors[0], { timeout: 300_000 });
const rows: Record<string, number>[] = [];
for (let c = 0; c < cycles; c++) for (const f of floors) {
  rows.push(await page.evaluate(async fl => {
    const a = (window as any).__arena, s = a.scene; a.tower.enter(fl);
    await new Promise(r => setTimeout(r, 400));
    return { floor: fl, materials: s.materials.length, textures: s.textures.length, lights: s.lights.length, meshes: s.meshes.length, transformNodes: s.transformNodes.length, beforeRender: s.onBeforeRenderObservable.observers.length };
  }, f));
}
// Pooled VFX flash lights: enabled only while a flash is live, then disabled again (they must not hold a light slot).
const flash = await page.evaluate(async () => {
  const a = (window as any).__arena, v = a.world.vfx, h = a.world.hero, on = () => v.lights.map((L: any) => L.l.isEnabled());
  const before = on(); v.flash(h.pos.add(new (h.pos.constructor)(0, 1, 0)), h.inst.root.getScene().lights[0].diffuse, 2.5, .25);
  await new Promise(r => requestAnimationFrame(() => r(0))); const during = on();
  await new Promise(r => setTimeout(r, 600)); return { before, during, after: on() };
});
const flashOk = flash.before.every((x: boolean) => !x) && flash.during.some((x: boolean) => x) && flash.after.every((x: boolean) => !x);
const keys = ['materials', 'textures', 'lights', 'meshes', 'transformNodes', 'beforeRender'];
const per = floors.length, second = rows.slice(per, per * 2), last = rows.slice(-per);
const growth = keys.flatMap(k => second.map((r, i) => ({ k, floor: r.floor, from: r[k], to: last[i][k] })).filter(g => g.to > g.from));
console.log(rows.map(r => JSON.stringify(r)).join('\n'));
console.log(JSON.stringify({ growth, flash, flashOk, errors }, null, 1));
await browser.close();
process.exit(growth.length || errors.length || !flashOk ? 1 : 0);
