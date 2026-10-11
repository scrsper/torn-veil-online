/**
 * Visual motion review (dev server running): real key/mouse input in a headed browser, a fixed review camera, labelled
 * segments, and the SOURCE clip drawn as a skeleton beside the hero at the hero's own phase, so the retargeted motion can be
 * judged against what the licensed clip actually does. Automation input, not human play.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-motion-review.ts --name review-before [--body male|female]
 * Segments: idle, walk (CapsLock toggle + W), jog (W), gait boundaries (walk > jog > sprint > jog without stopping), sprint (W+Shift), turn (W -> D -> S), stop, ready idle, guard strafe (F + A / D), ready jog,
 * attack combo (3 clicks), heavy (hold RMB), dodge (Space), roll (W+Space), recovery. The overlay shows the segment, the
 * keys held, ground speed and the hero's dominant clip; report.json records per segment the clips played, speed and the
 * source clip shown. Footage: frames/review-<body>.mp4 (CDP screencast + system ffmpeg).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startScreencast } from './screencast';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'motion-review'), body = arg('body', 'male'), quick = process.argv.includes('--quick');
const out = join(process.cwd(), '.debug/arena', `${name}-${body}`); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 720 } })).newPage();
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`); });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&hall=1&seed=918271&body=${body}`);
await page.waitForFunction(() => (window as any).__arena?.tower?.plan?.kind === 'hall', null, { timeout: 300_000 });
await page.evaluate(async () => {
  const a = (window as any).__arena, w = a.world, h = w.hero, s = a.scene, B = a.B;
  a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
  a.tower.take({ kind: 'weapon', id: 'qa-veilguard', name: 'Veilguard', base: 'Veilguard', slot: 'axe', mesh: 'W_veilguard', hand: 'r', style: 'blade', item: 1, rarity: 0, affixes: [], score: 1 });
  w.setWeapon(h, 'axe'); w.freezeFoes = true;
  for (const f of w.fighters) if (f.role === 'foe') f.pos.set(f.pos.x, 0, f.pos.z - 30);
  h.pos.set(0, 0, 10); h.yaw = Math.PI;
  // Overlay label.
  const lab = document.createElement('div'); lab.id = 'qa-label';
  lab.style.cssText = 'position:fixed;left:50%;top:92px;transform:translateX(-50%);z-index:99;font:700 18px Segoe UI,sans-serif;color:#fff;background:#000a;padding:6px 14px;border-radius:4px;text-align:center;pointer-events:none';
  document.body.append(lab); (window as any).__seg = 'setup'; (window as any).__keys = '';
  // Source skeletons (no meshes in the clip GLBs): lines between each animated node and its parent.
  const load = (f: string) => B.SceneLoader.LoadAssetContainerAsync('/arena/', f, s);
  const src: Record<string, any> = {};
  for (const [tag, file] of [['ua', 'unarmed_clips.glb'], ['mx', 'mixamo_clips.glb']] as const) {
    const c = await load(file), e = c.instantiateModelsToScene((n: string) => `${tag}.${n}`, false, { doNotInstantiate: true });
    const holder = new B.TransformNode(`src-${tag}`, s); for (const r of e.rootNodes) r.parent = holder; for (const g of e.animationGroups) g.stop();
    const nodes: any[] = holder.getChildTransformNodes(false); for (const n of nodes) n.rotationQuaternion ??= B.Quaternion.FromEulerVector(n.rotation);
    const rest = new Map(nodes.map((n: any) => [n, { r: n.rotationQuaternion.clone(), p: n.position.clone() }]));
    const pairs = nodes.filter((n: any) => n.parent && nodes.includes(n.parent));
    holder.computeWorldMatrix(true); for (const n of nodes) n.computeWorldMatrix(true);
    const ys = nodes.map((n: any) => n.getAbsolutePosition().y), height = Math.max(...ys) - Math.min(...ys);
    src[tag] = { holder, nodes, rest, pairs, groups: new Map(e.animationGroups.map((g: any) => [g.name.slice(tag.length + 1), g])), height, minY: Math.min(...ys), lines: null as any };
    holder.setEnabled(false);
  }
  const mat = new B.StandardMaterial('qa-src', s); mat.emissiveColor = new B.Color3(.3, .9, 1); mat.disableLighting = true;
  const READY = a.READY_CLIPS ?? {};
  (window as any).__srcFor = (clip: string): [string, string] | null => {
    if (!clip) return null; if (clip.startsWith('ready/')) clip = READY[clip]?.[0] ?? clip;
    if (clip.startsWith('legs:')) clip = clip.slice(5);
    if (clip.startsWith('unarmed/')) return ['ua', clip.slice(8)];
    return src.mx.groups.has(clip) ? ['mx', clip] : null;
  };
  let shown: any = null, lastSeg = '';
  const rows: any[] = (window as any).__rows = []; let last: any = null;
  s.onAfterRenderObservable.add(() => {
    const d = h.anim.dominant(), legs = (h.anim as any).legs?.name, pick = (window as any).__srcFor(legs ? 'legs:' + legs : d?.name ?? '');
    // Observed ground speed; the per-segment reset teleport is not travel (last is cleared when the segment changes).
    if ((window as any).__seg !== lastSeg) { last = null; lastSeg = (window as any).__seg; }
    const sp = last ? Math.hypot(h.pos.x - last.x, h.pos.z - last.z) / Math.max(1e-3, s.getEngine().getDeltaTime() / 1000) : 0; last = { x: h.pos.x, z: h.pos.z };
    lab.textContent = `${(window as any).__seg}  ·  keys: ${(window as any).__keys || '-'}  ·  ${sp.toFixed(1)} u/s  ·  ${d?.name ?? '-'}${legs ? ' + legs ' + legs : ''}`;
    rows.push({ seg: (window as any).__seg, t: w.time, sp, state: h.state, clip: d?.name ?? '', legs: legs ?? '', src: pick ? pick.join(':') : '' });
    for (const k of Object.keys(src)) { src[k].holder.setEnabled(false); src[k].lines?.setEnabled(false); }
    if (!pick) return;
    const S = src[pick[0]], g = S.groups.get(pick[1]); if (!g) return;
    // Pose the source at the hero's phase (owned copies, so the clip's keys are never aliased).
    // Phase: a legs layer runs on its own clock (anim.ts applyLegs: legs.t); a main clip from its group's masterFrame.
    const L = (h.anim as any).legs, hg = d && (h.anim as any).groups.get(legs ? `legs:${legs}` : d.name);
    const span = hg ? Math.max(1e-3, hg.to - hg.from) : 1, fps = hg?.targetedAnimations[0]?.animation.framePerSecond ?? 30, m = hg?.animatables[0]?.masterFrame;
    const ph = legs && L && typeof L.t === 'number' ? ((L.t * fps) % span) / span : hg && m !== undefined ? ((m - hg.from) / span) % 1 : 0;
    for (const [n, r] of S.rest) { n.rotationQuaternion.copyFrom(r.r); n.position.copyFrom(r.p); }
    const f = g.from + ph * (g.to - g.from);
    for (const ta of g.targetedAnimations) { const v = ta.animation.evaluate(f); ta.target[ta.animation.targetProperty] = typeof v?.clone === 'function' ? v.clone() : v; }
    S.holder.setEnabled(true);
    // Beside the hero (to the camera's right), the hero's height, facing the hero's yaw; root travel removed.
    const k = 2.15 / Math.max(.1, S.height); S.holder.scaling.setAll(k);
    const right = new B.Vector3(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
    S.holder.position.set(h.pos.x + right.x * 1.6, -S.minY * k, h.pos.z + right.z * 1.6); S.holder.rotation.set(0, h.yaw + ((window as any).__srcYaw?.[pick[0]] ?? 0), 0);
    S.holder.computeWorldMatrix(true); for (const n of S.nodes) n.computeWorldMatrix(true);
    const hips = S.nodes.find((n: any) => /pelvis|Hips/i.test(n.name)); const off = hips ? new B.Vector3(hips.getAbsolutePosition().x - S.holder.position.x, 0, hips.getAbsolutePosition().z - S.holder.position.z) : B.Vector3.Zero();
    const lines = S.pairs.map((n: any) => [n.parent.getAbsolutePosition().subtract(off), n.getAbsolutePosition().subtract(off)]);
    // One persistent updatable line system per skeleton, updated in place (recreating it every frame never got drawn).
    if (!S.lines) { S.lines = B.MeshBuilder.CreateLineSystem(`qa-src-lines-${pick[0]}`, { lines, updatable: true }, s); S.lines.color = new B.Color3(.3, .9, 1); S.lines.isPickable = false; S.lines.alwaysSelectAsActiveMesh = true; }
    else B.MeshBuilder.CreateLineSystem(`qa-src-lines-${pick[0]}`, { lines, instance: S.lines });
    S.lines.setEnabled(true); shown = S.lines;
    // Debug: how far apart the source feet are (rest ~ constant; a moving clip varies).
    const ft = S.nodes.filter((n: any) => /foot_l|foot_r|LeftFoot|RightFoot/.test(n.name)); if (ft.length === 2) (window as any).__srcSpread = +ft[0].getAbsolutePosition().subtract(ft[1].getAbsolutePosition()).length().toFixed(3);
    rows[rows.length - 1].spread = (window as any).__srcSpread;
    S.holder.setEnabled(false);
  });
});
// Review camera: behind-right, the same every run.
await page.evaluate(() => { const a = (window as any).__arena; a.view(.2, -Math.PI * .3); a.zoom(7); });
await page.mouse.move(550, 200);
const cast = await startScreencast(page, join(out, 'frames'));
// Every segment starts from the same open spot, facing away from the camera (so walls never frame the shot).
const seg = (x: string, keys = '') => page.evaluate(([s, k]) => { const a = (window as any).__arena, h = a.world.hero; (window as any).__seg = s; (window as any).__keys = k; if (!/stop|recovery|ready idle/.test(s)) { h.pos.set(0, 0, 8); h.vel.setAll(0); h.mvel.setAll(0); } }, [x, keys]);
const hold = async (keys: string[], ms: number, label: string, shown = keys.join('+')) => { await seg(label, shown); for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); };
const wait = async (ms: number, label: string) => { await seg(label); await page.waitForTimeout(ms); };
await page.waitForFunction(() => (window as any).__arena.world.hero.relaxed, null, { timeout: 20_000 });
await wait(1500, '01 idle (calm)');
await seg('02a walk (CapsLock walk toggle + W)', 'CapsLock, W'); await page.keyboard.press('CapsLock'); await page.keyboard.down('KeyW'); await page.waitForTimeout(2400); await page.keyboard.up('KeyW'); await page.keyboard.press('CapsLock');
await wait(700, '02b stop');
await hold(['KeyW'], 2200, '02 jog (W)');
await wait(900, '03 stop');
await hold(['KeyW', 'ShiftLeft'], 2200, '04 sprint (W+Shift)');
if (quick) {
  // --quick: a short probe of the overlay and the source skeleton (screenshots mid-jog and mid-sprint), no full review.
  await seg('q jog', 'KeyW'); await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.screenshot({ path: join(out, 'quick-jog.png') }); await page.keyboard.up('KeyW');
  console.log('SRCDBG', JSON.stringify(await page.evaluate(() => { const a = (window as any).__arena, m = a.scene.meshes.find((x: any) => x.name.startsWith('qa-src-lines') && x.isEnabled()), h = a.world.hero; if (!m) return { mesh: false }; m.refreshBoundingInfo(); m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; return { name: m.name, verts: m.getTotalVertices(), min: b.minimumWorld.asArray().map((v: number) => +v.toFixed(2)), max: b.maximumWorld.asArray().map((v: number) => +v.toFixed(2)), hero: [h.pos.x, h.pos.z].map((v: number) => +v.toFixed(2)), inFrustum: a.scene.activeCamera.isInFrustum(m), ready: m.isReady(true) }; })));
}
else {
await wait(900, '05 stop');
await seg('05b gait boundaries (walk > jog > sprint > jog, no stop)', 'CapsLock+W > W > W+Shift > W'); await page.keyboard.press('CapsLock'); await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.press('CapsLock'); await page.waitForTimeout(1000); await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(1000); await page.keyboard.up('ShiftLeft'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
await wait(700, '05c stop');
await seg('06 turn (W, W+D, D, S)', 'W..D..S'); await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyD'); await page.keyboard.down('KeyS'); await page.waitForTimeout(800); await page.keyboard.up('KeyS');
await wait(800, '07 stop');
await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; }); await page.keyboard.press('KeyF'); await page.waitForTimeout(150); await page.evaluate(() => { (window as any).__arena.world.hero.alertT = 1e9; });
await wait(1400, '08 ready idle (weapon drawn)');
await seg('09 guard strafe (F held + A, then D)', 'F+A / F+D'); await page.keyboard.down('KeyF'); await page.keyboard.down('KeyA'); await page.waitForTimeout(1100); await page.keyboard.up('KeyA'); await page.keyboard.down('KeyD'); await page.waitForTimeout(1100); await page.keyboard.up('KeyD'); await page.keyboard.up('KeyF');
await page.waitForTimeout(300);
await hold(['KeyW'], 1800, '10 ready jog (W)');
await wait(800, '11 stop');
await seg('12 attack combo (3 clicks)', 'LMB x3'); for (let i = 0; i < 3; i++) { await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(380); }
await wait(1200, '13 recovery');
await seg('14 heavy (hold RMB)', 'RMB hold'); await page.mouse.down({ button: 'right' }); await page.waitForTimeout(700); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(1400);
await seg('15 dodge (Space)', 'Space'); await page.keyboard.press('Space'); await page.waitForTimeout(1100);
await seg('16 roll (W+Space)', 'W+Space'); await page.keyboard.down('KeyW'); await page.keyboard.press('Space'); await page.waitForTimeout(500); await page.keyboard.up('KeyW'); await page.waitForTimeout(900);
await wait(1200, '17 recovery');
}
const rows: any[] = await page.evaluate(() => (window as any).__rows);
const footage = await cast.stop(`review-${body}.mp4`);
const segs: Record<string, any> = {};
for (const r of rows) { const S = segs[r.seg] ??= { frames: 0, clips: {}, legs: {}, src: {}, speed: [], spread: [] }; if (r.spread !== undefined) S.spread.push(r.spread); S.frames++; S.clips[r.clip] = (S.clips[r.clip] ?? 0) + 1; if (r.legs) S.legs[r.legs] = (S.legs[r.legs] ?? 0) + 1; if (r.src) S.src[r.src] = (S.src[r.src] ?? 0) + 1; S.speed.push(r.sp); }
for (const S of Object.values(segs)) { const v = [...S.speed].sort((a: number, b: number) => a - b); S.speed = { median: +v[v.length >> 1].toFixed(2), max: +v[v.length - 1].toFixed(2) }; S.spread = S.spread.length ? [Math.min(...S.spread), Math.max(...S.spread)] : null; }
writeFileSync(join(out, 'report.json'), JSON.stringify({ body, footage, errors, segments: segs }, null, 1));
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows));
console.log(JSON.stringify({ footage, errors: errors.length, segments: Object.fromEntries(Object.entries(segs).map(([k, v]: [string, any]) => [k, `${v.speed.median} u/s | ${Object.entries(v.clips).sort((a: any, b: any) => b[1] - a[1]).slice(0, 2).map(([c, n]) => `${c}:${n}`).join(', ')}${Object.keys(v.legs).length ? ' | legs ' + Object.keys(v.legs).join(',') : ''} | src ${Object.keys(v.src).join(',')}`])) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
