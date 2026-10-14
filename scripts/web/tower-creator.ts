/**
 * Ontology creator bodies in the Tower, end to end (dev server running):
 *   npx tsx scripts/web/tower-creator.ts [--name tower-creator]
 * A fresh, isolated browser context; storage persists across its reloads only.
 * A. Two creator-male actors with different identities at once: independent jaw morph and palettes, and disposal of one
 *    frees only its own cloned materials and morph managers (the source container and the other actor are untouched).
 * B. The female body reports "no authored appearance variants" instead of an imitation.
 * C. Body choice through the real Codex panel (K, then the Female button), then a real new climb (R, "New climb"
 *    card) draws the female creator body; a reload keeps the choice.
 * Writes .debug/arena/<name>/report.json and screenshots; exits non-zero on a failed check or page error.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'tower-creator'), out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } }), page = await ctx.newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
const checks: { step: string; ok: boolean; detail?: unknown }[] = [];
const check = (step: string, ok: boolean, detail?: unknown) => { checks.push({ step, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${ok ? '' : ' ' + JSON.stringify(detail)}`); };
const ready = () => page.waitForFunction(() => { const a = (window as any).__arena; return !!a?.tower?.plan && !a.hud.modalOpen; }, null, { timeout: 300_000 });
const report: Record<string, unknown> = {};
try {
  // ---- A/B: identities and ownership, on the Proving Hall (never persistent).
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=male`);
  await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
  const iso = await page.evaluate(() => {
    const a = (window as any).__arena, as = a.world.assets, sc = a.scene;
    const look = (inst: any) => {
      let jaw: number | null = null; const mats: Record<string, number[]> = {};
      for (const m of inst.meshes) {
        const mg = m.morphTargetManager; if (mg) for (let i = 0; i < mg.numTargets; i++) if (mg.getTarget(i).name === 'TV_JawWidth') jaw = mg.getTarget(i).influence;
        const list = m.material?.subMaterials ?? [m.material]; for (const x of list) if (x && /linen shirt|brown leather/.test(x.name)) mats[x.name.replace(/^.*\.(TV )/, '$1')] = [x.albedoColor.r, x.albedoColor.g, x.albedoColor.b];
      }
      return { jaw, mats };
    };
    const p = as.human('creator_male', 'qa-a'), q = as.human('creator_male', 'qa-b');
    const ap = as.applyCreatorAppearance(p, 'creator_male', { id: 'climber-a', appearanceSeed: 0 }), aq = as.applyCreatorAppearance(q, 'creator_male', { id: 'climber-b', appearanceSeed: 0 });
    const A = look(p), Bq = look(q);
    const ownedP = p.root.metadata.owned, ownedQ = q.root.metadata.owned;
    const srcMats = new Set(as.people.get('creator_male').materials), srcMorphs = new Set(as.people.get('creator_male').meshes.map((m: any) => m.morphTargetManager).filter(Boolean));
    const shareMat = [...ownedP.materials].some((m: any) => ownedQ.materials.has(m) || srcMats.has(m)), shareMorph = [...ownedP.morphs].some((m: any) => ownedQ.morphs.has(m) || srcMorphs.has(m));
    const pMats = [...ownedP.materials], pMorphs = [...ownedP.morphs];
    const before = { materials: sc.materials.length, morphs: sc.morphTargetManagers?.length ?? null };
    p.dispose();
    const after = { materials: sc.materials.length, morphs: sc.morphTargetManagers?.length ?? null };
    const freed = pMats.every((m: any) => !sc.materials.includes(m)), morphsFreed = pMorphs.every((m: any) => !(sc.morphTargetManagers ?? []).includes(m));
    // The source container (never added to the scene) stays usable: its textures keep their GPU data, its morph
    // managers keep their targets, and a fresh actor made after the disposal gets the jaw morph and textured clones.
    const qStill = look(q);
    const texLive = (m: any) => (m.getActiveTextures?.() ?? []).every((t: any) => !!t.getInternalTexture?.());
    const r = as.human('creator_male', 'qa-c'), rLook = look(r);
    const rTextured = r.meshes.some((m: any) => (m.material?.getActiveTextures?.() ?? []).some((t: any) => !!t.getInternalTexture?.()));
    const srcIntact = { textures: [...srcMats].every(texLive), morphs: [...srcMorphs].every((g: any) => g.numTargets > 0), freshActor: rLook.jaw !== null && rTextured };
    r.dispose();
    const fem = as.human('creator_female', 'qa-f'), af = as.applyCreatorAppearance(fem, 'creator_female', { id: 'climber-a', appearanceSeed: 0 });
    q.dispose(); fem.dispose();
    return { applied: { a: ap, b: aq, female: af }, A, B: Bq, shareMat, shareMorph, owned: { materials: pMats.length, morphs: pMorphs.length }, before, after, freed, morphsFreed, qAfterPDisposed: qStill, srcIntact };
  });
  report.isolation = iso;
  check('A1 two creator identities get different jaw and palettes', iso.A.jaw !== null && iso.A.jaw !== iso.B.jaw && JSON.stringify(iso.A.mats) !== JSON.stringify(iso.B.mats), iso);
  check('A2 each actor owns its materials and morph managers (none shared with the other or the source)', !iso.shareMat && !iso.shareMorph && iso.owned.materials > 0 && iso.owned.morphs > 0, iso.owned);
  check('A3 disposing one actor frees only its owned objects; the other keeps its appearance', iso.freed && iso.morphsFreed && JSON.stringify(iso.qAfterPDisposed) === JSON.stringify(iso.B) && iso.srcIntact.textures && iso.srcIntact.morphs && iso.srcIntact.freshActor, { before: iso.before, after: iso.after, srcIntact: iso.srcIntact });
  check('B1 the female body reports no authored variants and gets nothing applied', iso.applied.female.length === 1 && /unsupported/.test(iso.applied.female[0]), iso.applied.female);
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&seed=918271`);
  await ready();
  const bodyNow = () => page.evaluate(() => { const w = (window as any).__arena.world; return { look: w.hero.inst.root.metadata?.look, heroBody: w.heroBody, meshes: w.hero.inst.meshes.slice(0, 3).map((m: any) => m.name) }; });
  const first = await bodyNow();
  check('C1 default climb draws the creator male body', first.look === 'creator_male' && first.heroBody?.drawn === 'creator_male', first);
  await page.mouse.click(550, 200); await page.keyboard.press('KeyK');
  await page.waitForSelector('[data-body="female"]', { timeout: 10_000 });
  await page.screenshot({ path: join(out, 'codex-body-choice.png') });
  await page.locator('[data-body="female"]').click();
  const still = await bodyNow();
  check('C2 the choice is deferred: the current hero keeps its body', still.look === 'creator_male', still);
  await page.locator('#codex-close').click();
  await page.keyboard.press('KeyR');
  await page.waitForSelector('.ar-modal.on .ar-card', { timeout: 30_000 });
  await page.locator('.ar-modal.on .ar-card').nth(1).click();
  await ready(); await page.waitForTimeout(500);
  const next = await bodyNow();
  check('C3 the next climb draws the chosen creator female body', next.look === 'creator_female' && next.heroBody?.drawn === 'creator_female', next);
  await page.screenshot({ path: join(out, 'new-climb-female.png') });
  await page.reload(); await page.waitForFunction(() => !!(window as any).__arena?.tower, null, { timeout: 300_000 });
  if (await page.locator('.ar-modal.on .ar-card').count()) await page.locator('.ar-modal.on .ar-card').first().click();
  await ready();
  const reloaded = await bodyNow();
  check('C4 a reload keeps the chosen body', reloaded.look === 'creator_female', reloaded);
  // ---- D: customization through the real Codex controls, on each body, in the Proving Hall (never persistent).
  for (const body of ['male', 'female'] as const) {
    await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=${body}`);
    await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
    await page.evaluate(() => { const a = (window as any).__arena, w = a.world, h = w.hero; a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
      a.tower.take({ kind: 'weapon', id: 'qa', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 }); w.setWeapon(h, 'axe'); h.alertT = 1e9; w.freezeFoes = true; });
    const state = () => page.evaluate(() => {
      const w = (window as any).__arena.world, h = w.hero; let jaw: number | null = null, linen: number[] | null = null; const hair: boolean[] = [];
      for (const m of h.inst.meshes) { const mg = m.morphTargetManager; if (mg) for (let i = 0; i < mg.numTargets; i++) if (mg.getTarget(i).name === 'TV_JawWidth') jaw = mg.getTarget(i).influence;
        if (/\.(short02|braid01)/.test(m.name)) hair.push(m.isEnabled());
        for (const x of (m.material?.subMaterials ?? [m.material])) if (x && /linen shirt/.test(x.name)) linen = [x.albedoColor.r, x.albedoColor.g, x.albedoColor.b].map((v: number) => +v.toFixed(4)); }
      const gear = h.extra.map((m: any) => { m.computeWorldMatrix(true); const s = h.pos.constructor.Zero(); m.getWorldMatrix().decompose(s); return +s.y.toFixed(4); });
      return { look: h.inst.root.metadata?.look, scale: +h.inst.root.scaling.y.toFixed(4), jaw, linen, hair, gearWorldScale: gear, custom: w.heroCustom, appearance: w.heroBody?.appearance };
    });
    const ui = async (sel: string, value: string | boolean) => page.evaluate(([s, v]) => { const el = document.querySelector<HTMLInputElement>(s)!; if (typeof v === 'boolean') { el.checked = v; el.dispatchEvent(new Event('change')); } else { el.value = v; el.dispatchEvent(new Event('input')); } }, [sel, value] as const);
    const closeUp = async (label: string) => { await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleCodex([]); a.view(.08, -Math.PI * .15); a.zoom(2.6); a.pose('ready/sword and shield idle', .3, 0); }); await page.waitForTimeout(500); await page.screenshot({ path: join(out, `custom-${body}-${label}.png`) }); await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleCodex([]); }); };
    await page.keyboard.press('KeyK'); await page.waitForSelector('#cc-height', { timeout: 10_000 });
    const s0 = await state();
    check(`D1 ${body}: Codex shows live controls for the drawn ${body} body`, s0.look === `creator_${body}`, s0.look);
    await ui('#cc-height', '95'); const sLow = await state(); await closeUp('height95-hair');
    await ui('#cc-height', '105'); const sHigh = await state(); await closeUp('height105-hair');
    check(`D2 ${body}: height 95% and 105% rescale the body and its held gear together`, Math.abs(sLow.scale - 1.22 * .95) < 1e-3 && Math.abs(sHigh.scale - 1.22 * 1.05) < 1e-3 && sHigh.gearWorldScale.length === 2 && sHigh.gearWorldScale.every((g: number, i: number) => Math.abs(g / sLow.gearWorldScale[i] - 1.05 / .95) < 1e-3), { sLow, sHigh });
    await ui('#cc-hair', false); const sBald = await state(); await closeUp('height105-nohair');
    check(`D3 ${body}: hair off hides the body's own hair mesh`, sBald.hair.length > 0 && sBald.hair.every((v: boolean) => !v), sBald.hair);
    if (body === 'male') {
      // Face close-ups for the jaw extremes (hair back on), same camera.
      await ui('#cc-hair', true);
      const faceUp = async (label: string) => { await page.evaluate(() => { const a = (window as any).__arena, h = a.world.hero; a.hud.toggleCodex([]); a.pose('unarmed/idle_neutral', .3, 0); a.view(.02, -Math.PI * .2); a.zoom(1.4); void h; }); await page.waitForTimeout(700); await page.screenshot({ path: join(out, `custom-${body}-${label}.png`) }); await page.evaluate(() => { const a = (window as any).__arena; a.hud.toggleCodex([]); }); };
      await ui('#cc-jaw', '0'); const j0 = await state(); await faceUp('jaw0-face');
      await ui('#cc-jaw', '100'); const j1 = await state(); await faceUp('jaw100-face');
      check('D4 male: jaw 0% and 100% set the TV_JawWidth morph', j0.jaw === 0 && j1.jaw === 1, { j0: j0.jaw, j1: j1.jaw });
      const before = await state(); await page.locator('#cc-reroll').click(); const after = await state();
      check('D5 male: re-roll changes the seed and the cloth colours, and returns the jaw to seeded', after.custom.seed === before.custom.seed + 1 && JSON.stringify(after.linen) !== JSON.stringify(before.linen) && after.custom.jaw === null, { before: before.linen, after: after.linen });
    } else {
      const txt = await page.locator('#cc-character').textContent();
      check('D4 female: jaw and re-roll are shown as not available, with the reason', /not available on the female body/.test(txt ?? '') && !(await page.locator('#cc-jaw').count()) && !(await page.locator('#cc-reroll').count()), txt);
    }
    // Persistence across a reload (same body via ?body, saved height/hair/jaw/seed).
    const saved = (await state()).custom;
    await page.reload(); await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
    const sR = await state();
    check(`D6 ${body}: a reload restores the saved choices on the hero`, JSON.stringify({ ...sR.custom, body: null }) === JSON.stringify({ ...saved, body: null }) && Math.abs(sR.scale - 1.22 * saved.height) < 1e-3 && sR.hair.every((v: boolean) => v === saved.hair), { saved, restored: sR.custom, scale: sR.scale });
    report[`custom-${body}`] = { s0, sLow, sHigh, sBald, sR };
    // Back to defaults for the next body.
    await page.evaluate(k => localStorage.removeItem(k), 'tv.tower.appearance.v1');
  }
} catch (e) {
  await page.screenshot({ path: join(out, 'fail-aborted.png') }).catch(() => undefined);
  check('harness completed every step', false, String((e as Error).message));
}
report.checks = checks; report.errors = errors;
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
await ctx.close().catch(() => undefined); await browser.close().catch(() => undefined);
console.log(`tower creator -> ${out} (${checks.filter(c => c.ok).length}/${checks.length} checks, ${errors.length} page errors)`);
process.exit(checks.every(c => c.ok) && !errors.length ? 0 : 1);
