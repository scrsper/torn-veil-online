// Browser smoke for the town page and its character-model contract, against the built dist-town/.
//   npm run town:build && npm run town:characters -- dist-town --dist --fixtures && npm run town:smoke
// Serves dist-town on 127.0.0.1 only, drives local Chrome (or Edge) with real keyboard, mouse clicks, drags and
// wheel, and writes results.json + screenshots to docs/evidence/town-character/. Scenarios:
//   fixture  ?character=fixture-kaykit-skeleton-warrior: keyboard walk/run, click-to-move route street → plaza →
//            north gate, camera orbit and collision, clip weights following the simulated speed;
//   none / unknown / tampered / default: the capsule stays, with the reason reported, and movement is unchanged.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..'), root = resolve(repo, 'dist-town'), evidence = resolve(repo, 'docs/evidence/town-character');
const FIXTURE = 'fixture-kaykit-skeleton-warrior';
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]), file = normalize(resolve(root, '.' + (url.endsWith('/') ? url + 'index.html' : url)));
  if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(b); }
  catch { res.writeHead(404).end(); }
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port, origin = `http://127.0.0.1:${port}`;

// A tampered copy: schema-valid manifest whose pinned hash no longer matches the bytes.
const tamperedDir = resolve(root, 'town-characters-tampered');
await rm(tamperedDir, { recursive: true, force: true }); await cp(resolve(root, 'town-characters'), tamperedDir, { recursive: true });
const tm = JSON.parse(await readFile(resolve(tamperedDir, 'manifest.json'), 'utf8')); tm.characters[0].sha256 = tm.characters[0].sha256.replace(/^./, (c: string) => c === '0' ? '1' : '0');
await writeFile(resolve(tamperedDir, 'manifest.json'), JSON.stringify(tm));

await mkdir(evidence, { recursive: true });
let browser: Browser | null = null, channel = '';
for (const ch of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel: ch, headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=d3d11'] }); channel = ch; break; } catch (e) { console.warn(`[smoke] ${ch} unavailable: ${String(e).split('\n')[0]}`); } }
if (!browser) throw Error('no local Chrome or Edge');
const version = browser.version();
type Check = { name: string; pass: boolean; detail: unknown };
const results: { scenario: string; url: string; checks: Check[]; console: string[]; failedRequests: string[]; character?: unknown; shots: string[] }[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Town = { ready: boolean; player(): { x: number; z: number; y: number; yaw: number; speed: number; target: unknown }; character(): any; orbit(): { yaw: number; pitch: number; zoom: number; boom: number }; project(x: number, z: number): { x: number; y: number; z: number }; view(x: number, z: number, yaw: number, pitch?: number, zoom?: number): void; status: Record<string, string>; fps(): number; hero(): { capsule: boolean; modelMeshes: number } };
const T = <R>(page: Page, f: (t: Town) => R) => page.evaluate(`(${f.toString()})(window.__town)`) as Promise<Awaited<R>>;

async function open(scenario: string, query: string) {
  const page = await browser!.newPage({ viewport: { width: 1280, height: 720 } });
  const r = { scenario, url: `/${query}`, checks: [] as Check[], console: [] as string[], failedRequests: [] as string[], shots: [] as string[] as string[], character: undefined as unknown };
  page.on('console', m => { if (['error', 'warning', 'info'].includes(m.type()) || /\[town\]/.test(m.text())) r.console.push(`${m.type()}: ${m.text().slice(0, 300)}${m.location().url ? ` @ ${m.location().url.replace(origin, '')}` : ''}`); });
  page.on('pageerror', e => r.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('requestfailed', q => r.failedRequests.push(`${q.url().replace(origin, '')} ${q.failure()?.errorText}`));
  page.on('response', s => { if (s.status() >= 400) r.failedRequests.push(`${s.url().replace(origin, '')} HTTP ${s.status()}`); });
  const t0 = Date.now();
  await page.goto(origin + r.url, { waitUntil: 'load' });
  await page.waitForFunction('window.__town && window.__town.ready', null, { timeout: 300_000 });
  check(r, 'town ready', true, { seconds: (Date.now() - t0) / 1000 });
  r.character = await T(page, t => t.character());
  results.push(r); return { page, r };
}
function check(r: { checks: Check[] }, name: string, pass: boolean, detail: unknown) { r.checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); }
async function shot(page: Page, r: { shots: string[] }, name: string) { const p = resolve(evidence, `${name}.png`); await page.screenshot({ path: p }); r.shots.push(p); }
async function hold(page: Page, keys: string[], ms: number) { for (const k of keys) await page.keyboard.down(k); await sleep(ms); for (const k of [...keys].reverse()) await page.keyboard.up(k); }
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Walk 2 s forward on the keyboard from spawn; returns displacement (movement must not depend on the character model). */
async function keyboardWalk(page: Page) { const a = await T(page, t => t.player()); await hold(page, ['KeyW'], 2000); await sleep(600); const b = await T(page, t => t.player()); return { from: a, to: b, metres: dist(a, b) }; }

try {
  // 1. Fixture: model, animation, controls, route.
  {
    const { page, r } = await open('fixture', `?character=${FIXTURE}`);
    const c = r.character as any;
    check(r, 'fixture model loaded (labelled test fixture)', c.state === 'model' && c.kind === 'test-fixture' && /test fixture/i.test(c.label), c);
    const vis = await T(page, t => t.hero());
    check(r, 'model visible, capsule hidden', !vis.capsule && vis.modelMeshes > 0, vis);
    check(r, 'idle/walk/run clips bound', JSON.stringify(c.clips) === JSON.stringify(['Idle', 'Walking_A', 'Running_A']) && c.missingClips.length === 0, { clips: c.clips, missing: c.missingClips });
    check(r, 'library GLBs all loaded', Object.values(await T(page, t => t.status)).every(v => v === 'glb'), await T(page, t => t.status));
    const sp = await T(page, t => t.player());
    await T(page, t => { const p = t.player(); t.view(p.x, p.z, p.yaw, .05, 3.2); }); await sleep(1500);
    await shot(page, r, '01-fixture-spawn-player-height');
    const idleW = (await T(page, t => t.character())).weights;
    check(r, 'standing plays idle', idleW.idle > .95, idleW);
    // Keyboard walk, sampling clip weights mid-stride.
    await page.keyboard.down('KeyW'); await sleep(1200);
    const walkW = (await T(page, t => t.character())).weights, walkP = await T(page, t => t.player());
    await shot(page, r, '02-fixture-walking-keyboard');
    await page.keyboard.down('ShiftLeft'); await sleep(1500);
    const runW = (await T(page, t => t.character())).weights, runP = await T(page, t => t.player());
    await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW'); await sleep(800);
    const after = await T(page, t => t.player());
    check(r, 'keyboard walk moves and blends to walk', walkP.speed > 2.5 && walkW.walk > .8, { speed: walkP.speed, weights: walkW });
    check(r, 'shift runs and blends to run', runP.speed > 5.5 && runW.run > .7, { speed: runP.speed, weights: runW });
    check(r, 'keyboard leg displacement', dist(sp, after) > 8, { from: sp, to: after, metres: dist(sp, after) });
    check(r, 'stops and returns to idle', after.speed < .2 && (await T(page, t => t.character())).weights.idle > .8, { speed: after.speed });
    // Camera orbit by drag and zoom by wheel.
    const o0 = await T(page, t => t.orbit());
    await page.mouse.move(640, 300); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 24, 300 + i * 4); await page.mouse.up(); await sleep(300);
    const o1 = await T(page, t => t.orbit());
    check(r, 'drag orbits the camera', Math.abs(o1.yaw - o0.yaw) > .3 && Math.abs(o1.pitch - o0.pitch) > .01, { before: o0, after: o1 });
    // Camera collision: swing the boom side-on into the street frontage, zoom out fully, and read the boom.
    await page.mouse.move(640, 360); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(640 + i * 30, 360); await page.mouse.up();
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 400); await sleep(40); }
    await sleep(1500);
    const oc = await T(page, t => t.orbit());
    await shot(page, r, '03-fixture-camera-collision');
    check(r, 'camera boom shortened by collision at full zoom', oc.boom < oc.zoom - .5, oc);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -300); await sleep(40); }
    // Re-centre the camera behind the player facing north, then click-to-move along the route.
    { const p = await T(page, t => t.player()); await T(page, t => { const q = t.player(); t.view(q.x, q.z, 0, .32, 6); }); check(r, 're-centre hook keeps position', dist(p, await T(page, t => t.player())) < 1e-6, p); }
    await sleep(800);
    const route = [{ x: 0, z: -46, name: 'main street past the lane block' }, { x: 0, z: -30, name: 'street end' }, { x: -9, z: -14, name: 'plaza south-west' }, { x: -10, z: 6, name: 'plaza west' }, { x: 0, z: 20, name: 'plaza north rim' }, { x: 0, z: 38, name: 'north street' }, { x: 0, z: 49, name: 'north gate' }];
    const reached: unknown[] = [], detours: unknown[] = []; let clicks = 0, blocked: unknown = null;
    for (const w of route) {
      let tries = 0, side = 0;
      while (dist(await T(page, t => t.player()), w) > 1.6 && tries < 14) {
        tries++;
        const p = await T(page, t => t.player()), d = dist(p, w), k = Math.min(1, 16 / d);
        // After a stall, steer around the obstacle like a player would: a point 3.5 m to one side of the line.
        const aim = side ? { x: p.x + (w.x - p.x) * k + (w.z - p.z) / d * 3.5 * side, z: p.z + (w.z - p.z) * k - (w.x - p.x) / d * 3.5 * side } : { x: p.x + (w.x - p.x) * k, z: p.z + (w.z - p.z) * k };
        if (side) detours.push({ from: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, aim, side });
        blocked = null;
        const yaw = Math.atan2(w.x - p.x, w.z - p.z); await T(page, new Function('t', `t.view(t.player().x, t.player().z, ${yaw}, .42, 6)`) as (t: Town) => void); await sleep(250);
        const s = await page.evaluate(`window.__town.project(${aim.x}, ${aim.z})`) as { x: number; y: number; z: number };
        if (!(s.z > 0 && s.z < 1 && s.x > 0 && s.x < 1280 && s.y > 0 && s.y < 720)) { blocked = { at: p, waypoint: w, reason: 'click point off screen', s }; break; }
        await page.mouse.click(s.x, s.y); clicks++;
        await sleep(200);
        const set = await T(page, t => t.player());
        if (!set.target) { blocked = { at: p, waypoint: w, reason: 'click did not set a target (blocked ground?)', aim }; }
        const t0 = Date.now(); while (Date.now() - t0 < 9000) { await sleep(250); const q = await T(page, t => t.player()); if (!q.target) break; }
        const q = await T(page, t => t.player());
        if (dist(q, p) < .3) { blocked = { at: q, waypoint: w, reason: 'no progress' }; if (side === -1) break; side = side === 0 ? 1 : -1; }
        else if (side) side = 0;
      }
      const p = await T(page, t => t.player()); reached.push({ waypoint: w.name, target: w, at: { x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, ok: dist(p, w) <= 1.6, tries });
      if (w.name === 'plaza west') { await T(page, t => { const q = t.player(); t.view(q.x, q.z, 1.2, .12, 5); }); await sleep(1200); await shot(page, r, '04-fixture-plaza'); }
      if (dist(p, w) > 1.6) break;
    }
    const end = await T(page, t => t.player());
    check(r, 'click-to-move route street → plaza → north gate', (reached as { ok: boolean }[]).every(x => x.ok) && reached.length === route.length, { clicks, reached, detours, blocked });
    await T(page, t => { const q = t.player(); t.view(q.x, q.z, 0, .1, 4.5); }); await sleep(1500);
    await shot(page, r, '05-fixture-north-gate-player-height');
    check(r, 'reached north gate', end.z > 46, end);
    r.character = await T(page, t => t.character());
    check(r, 'no page errors', !r.console.some(l => l.startsWith('pageerror') || l.startsWith('error')), r.console.filter(l => l.startsWith('pageerror') || l.startsWith('error')));
    await page.close();
  }
  // 2–5. Capsule cases: honest status and unchanged movement.
  const capsule: Record<string, number> = {};
  for (const [scenario, query, expectState, expectReason] of [
    ['none', '?character=none', 'capsule', /\?character=none/],
    ['default', '', 'capsule', /no default character/],
    ['unknown', '?character=studio-missing', 'fallback', /not staged/],
    ['tampered', `?character=${FIXTURE}&characterBase=/town-characters-tampered/`, 'fallback', /hash/],
  ] as const) {
    const { page, r } = await open(scenario, query), c = r.character as any;
    check(r, `${scenario}: capsule shown with reason`, c.state === expectState && expectReason.test(c.reason ?? ''), c);
    const vis = await T(page, t => t.hero());
    check(r, `${scenario}: capsule visible, no model meshes`, vis.capsule && vis.modelMeshes === 0, vis);
    if (scenario === 'tampered' || scenario === 'none') await shot(page, r, `06-${scenario}-capsule`);
    const k = await keyboardWalk(page); capsule[scenario] = k.metres;
    check(r, `${scenario}: keyboard movement works`, k.metres > 3, k);
    check(r, `${scenario}: no page errors`, !r.console.some(l => l.startsWith('pageerror') || l.startsWith('error')), r.console.filter(l => l.startsWith('pageerror') || l.startsWith('error')));
    await page.close();
  }
  // Same 2 s keyboard walk with the model: displacement must match the capsule runs (movement is sim-owned).
  {
    const { page, r } = await open('fixture-movement-parity', `?character=${FIXTURE}`);
    const k = await keyboardWalk(page), base = capsule.none;
    check(r, 'model does not change movement (2 s walk vs capsule)', Math.abs(k.metres - base) < .35, { model: k.metres, capsule: base });
    await page.close();
  }
} finally {
  await browser.close(); server.close();
  await rm(tamperedDir, { recursive: true, force: true });
  const all = results.flatMap(r => r.checks), failed = all.filter(c => !c.pass);
  await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ when: new Date().toISOString(), browser: `${channel} ${version}`, origin: '127.0.0.1 (ephemeral port)', passed: all.length - failed.length, failed: failed.length, results }, null, 1));
  console.log(`${all.length - failed.length}/${all.length} checks passed; evidence in ${evidence}`);
  if (failed.length) process.exitCode = 1;
}
