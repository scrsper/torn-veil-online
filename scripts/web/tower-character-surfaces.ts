/** Matched native Babylon renders of the actual playable bodies, without image compositing.
 * Isolated Hall, fixed source idle pose and fixed cameras. Pose/foe setup is explicitly forced.
 * Run before and after a presentation change with different --name values.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const i = process.argv.indexOf('--name'), name = i >= 0 ? process.argv[i + 1] : 'character-surfaces';
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const report: unknown[] = [], errors: string[] = [];
try {
  for (const body of ['male', 'female']) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } }), page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
    await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5181'}/?arena=1&tower=1&hall=1&body=${body}&seed=918271`);
    await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 180000 });
    await page.evaluate(() => {
      const a = (window as any).__arena, h = a.world.hero;
      a.world.freezeFoes = true; for (const f of a.world.fighters) if (f.role === 'foe') f.pos.set(500, 0, 500);
      h.pos.set(0, 0, 8); a.world.applyHeroAppearance({ id: 'matched-character-review', appearanceSeed: 0 });
      h.inst.root.position.copyFrom(h.pos); h.inst.root.computeWorldMatrix(true);
      a.pose('unarmed/idle_neutral', .2, Math.PI); a.hud.showHelp(false);
      a.hud.banner.style.display = 'none'; a.hud.toasts.style.display = 'none';
      const state = (window as any).__reviewCamera = { x: 0, y: 1.15, z: -4.4, ty: 1.05 };
      a.scene.onBeforeRenderObservable.add(() => { a.camera.position.set(h.pos.x + state.x, state.y, h.pos.z + state.z); a.camera.setTarget(new a.B.Vector3(h.pos.x, state.ty, h.pos.z)); });
    });
    for (const [view, camera] of Object.entries({ body: { x: 0, y: 1.15, z: -4.4, ty: 1.05 }, face: { x: .2, y: 1.95, z: -1.5, ty: 1.87 }, quarter: { x: 2.7, y: 1.4, z: -3.4, ty: 1.15 } })) {
      await page.evaluate(c => Object.assign((window as any).__reviewCamera, c), camera);
      await page.waitForTimeout(600); await page.screenshot({ path: join(out, `${body}-${view}.png`) });
    }
    report.push(await page.evaluate(body => { const a = (window as any).__arena; return { body, hero: a.world.heroBody,
      materials: a.world.hero.inst.meshes.flatMap((m: any) => m.material?.subMaterials ?? [m.material]).filter(Boolean).map((m: any) => ({ name: m.name, roughness: m.roughness, metallic: m.metallic, alpha: m.alphaCutOff })) }; }, body));
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'report.json'), JSON.stringify({ report, errors, forced: ['Hall preview', 'frozen off-floor foes', 'fixed authored idle pose', 'fixed review cameras and identity'] }, null, 2));
if (errors.length) throw Error(errors.join('\n'));
console.log(`Saved matched male/female views to ${out}; page errors: ${errors.length}`);
