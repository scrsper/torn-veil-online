/**
 * Maze floors on the game's real structures (dev server running): for each floor and seed, the loaded world.props
 * (every prop's actual collision box: hx, hz, yaw, from the loaded meshes) and the game's own NavGrid.
 *   ARENA_HOST=http://127.0.0.1:5181 npx tsx scripts/web/tower-maze-check.ts --name maze-check [--floors 4,5,20,31,61,91] [--seeds 918271,7]
 * Per floor: (1) a flood fill of the walkable floor (hero radius 0.65 against every unbroken prop's collision BOX; round
 * props are therefore treated conservatively as their boxes) from the start to
 * the exit, every foe, the boss and shrine, and beside every chest; (2) NavGrid followability: from the start to the exit
 * and to each chest, and from each foe spawn to the start, stepping along world.navDir (straight when it reports a clear
 * line); every simulated step asserts the point is outside every wall box, so a route through a wall fails. The real
 * keyboard route (tower-maze-walk.ts) is what verifies actual movement collision. Console
 * errors are recorded. Writes .debug/arena/<name>/report.json and floor<N>-s<seed>-<view>.png; exits non-zero on a failure.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const name = arg('name', 'maze-check'), floors = arg('floors', '4,5,20,31,61,91').split(',').map(Number), seeds = arg('seeds', '918271,7').split(',').map(Number);
const out = join(process.cwd(), '.debug/arena', name); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const report: Record<string, unknown> = {}; let failures = 0;
for (const seed of seeds) for (const fl of floors) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 740 } }), page = await ctx.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`); });
  await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
  await page.goto(`${process.env.ARENA_HOST ?? 'http://127.0.0.1:5180'}/?arena=1&tower=1&seed=${seed}&floor=${fl}&body=male`);
  await page.waitForFunction(f => (window as any).__arena?.tower?.plan?.floor === f && (window as any).__arena.world.hero, fl, { timeout: 300_000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const a = (window as any).__arena, w = a.world, plan = a.tower.plan, half = plan.half, HERO = .65, STEP = .2, n = Math.ceil(half * 2 / STEP);
    w.freezeFoes = true; a.hud.showHelp(false); a.hud.toasts.style.display = 'none'; a.hud.banner.style.display = 'none';
    const props = w.props.filter((p: any) => !p.broken && !p.loose), walls = props.filter((p: any) => p.key === 'wall');
    const blocked = new Uint8Array(n * n), at = (k: number) => -half + (k + .5) * STEP;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = at(i), z = at(j); let b = Math.abs(x) > half - HERO || Math.abs(z) > half - HERO;
      for (const p of props) { if (b) break; const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = (x - p.pos.x) * c - (z - p.pos.z) * s, lz = (x - p.pos.x) * s + (z - p.pos.z) * c; if (Math.abs(lx) < p.hx + HERO && Math.abs(lz) < p.hz + HERO) b = true; }
      blocked[j * n + i] = b ? 1 : 0;
    }
    const cellOf = (x: number, z: number) => [Math.max(0, Math.min(n - 1, Math.floor((x + half) / STEP))), Math.max(0, Math.min(n - 1, Math.floor((z + half) / STEP)))];
    const seen = new Uint8Array(n * n), [si, sj] = cellOf(plan.start.x, plan.start.z), startOpen = !blocked[sj * n + si], q = [sj * n + si]; seen[q[0]] = 1;
    while (q.length) { const k = q.pop()!, i = k % n, j = (k / n) | 0; for (const [u, v] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (u < 0 || v < 0 || u >= n || v >= n) continue; const kk = v * n + u; if (!seen[kk] && !blocked[kk]) { seen[kk] = 1; q.push(kk); } } }
    const near = (x: number, z: number, rad: number) => { for (let dx = -rad; dx <= rad; dx += STEP) for (let dz = -rad; dz <= rad; dz += STEP) { if (dx * dx + dz * dz > rad * rad) continue; const [i, j] = cellOf(x + dx, z + dz); if (seen[j * n + i]) return true; } return false; };
    // NavGrid following: step 0.3 along navDir (or straight when it reports a clear line) until within `arrive`.
    const follow = (fx: number, fz: number, tx: number, tz: number, arrive: number) => {
      let x = fx, z = fz;
      for (let k = 0; k < 900; k++) {
        if (Math.hypot(tx - x, tz - z) < arrive) return true;
        const d = w.navDir(x, z, tx, tz) ?? (() => { const l = Math.hypot(tx - x, tz - z); return { x: (tx - x) / l, z: (tz - z) / l }; })();
        x += d.x * .3; z += d.z * .3;
        if (walls.some((p: any) => { const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = (x - p.pos.x) * c - (z - p.pos.z) * s, lz = (x - p.pos.x) * s + (z - p.pos.z) * c; return Math.abs(lx) < p.hx && Math.abs(lz) < p.hz; })) return false;
      }
      return false;
    };
    const foes = w.fighters.filter((f: any) => f.role === 'foe'), chests = props.filter((p: any) => p.chest);
    const fail: string[] = [];
    if (!startOpen) fail.push('start blocked');
    if (!near(plan.exit.x, plan.exit.z, .8)) fail.push('exit unreachable (flood)');
    if (!follow(plan.start.x, plan.start.z, plan.exit.x, plan.exit.z, 1.5)) fail.push('exit not followable (NavGrid)');
    for (const f of foes) { if (!near(f.pos.x, f.pos.z, 1.4)) fail.push(`foe ${f.foeKind} at ${f.pos.x.toFixed(1)},${f.pos.z.toFixed(1)} unreachable`); if (!follow(f.pos.x, f.pos.z, plan.start.x, plan.start.z, 2)) fail.push(`foe ${f.foeKind} at ${f.pos.x.toFixed(1)},${f.pos.z.toFixed(1)} cannot path to the start`); }
    for (const c of chests) { if (!near(c.pos.x, c.pos.z, Math.max(c.hx, c.hz) + 1.2)) fail.push(`chest at ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)} unreachable`); if (!follow(plan.start.x, plan.start.z, c.pos.x, c.pos.z, Math.max(c.hx, c.hz) + 1.4)) fail.push(`chest at ${c.pos.x.toFixed(1)},${c.pos.z.toFixed(1)} not followable`); }
    if (plan.shrine && !near(plan.shrine.x, plan.shrine.z, 2.4)) fail.push('shrine unreachable');
    return { kind: plan.kind, theme: plan.theme.name, walls: plan.walls.length, wallHeight: plan.wallHeight, rooms: plan.maze?.rooms.length ?? 0, grid: plan.maze?.n ?? 0, props: props.length, foes: foes.length, chests: chests.length, nav: !!w.nav, fail };
  });
  for (const [v, set] of [['play', [.22, -Math.PI * .25, 9]], ['wide', [.62, -Math.PI * .2, 34]]] as const) {
    await page.evaluate(([p, y, z]) => { const a = (window as any).__arena; a.view(p, y); a.zoom(z); }, set as unknown as number[]); await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `floor${fl}-s${seed}-${v}.png`) });
  }
  report[`s${seed}-f${fl}`] = { ...r, errors }; failures += r.fail.length + errors.length;
  console.log(`seed ${seed} floor ${fl} ${r.kind}: walls ${r.walls} rooms ${r.rooms} grid ${r.grid} foes ${r.foes} chests ${r.chests} props ${r.props} -> ${r.fail.length ? 'FAIL ' + r.fail.slice(0, 4).join('; ') : 'ok'}${errors.length ? ' errors ' + errors.length : ''}`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
process.exit(failures ? 1 : 0);
