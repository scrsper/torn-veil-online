// Manual visual inspection of the elevated/observer client (v0.10 Part XI: "real client
// inspection of ARPG mode"). Boots the actual dev server + client, drives it the way a developer
// would, and writes screenshots. Not a test — a look with human eyes.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'tests/browser/artifacts';
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${port}/?seed=918271`);
  await page.click('#btn-new');
  await page.waitForFunction(() => !!(window as any).game?.world?.playerId, undefined, { timeout: 20000 });
  await page.evaluate(() => { const g = (window as any).game; g.stepSim((3600 * 10) / g.world.clock.timeScale, 2); });

  // 1. elevated view over the village, from a wide boom
  await page.keyboard.press('F2');
  await page.evaluate(() => { const g = (window as any).game; g.ctrl.arpg.distance = 30; g.ctrl.arpg.pitch = 0.55; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'manual-1-village.png') });

  // 2. observer overlay on whoever holds the most pressing purpose
  await page.keyboard.press('F6');
  const who = await page.evaluate(() => {
    const w = (window as any).game.world; let best: any = null;
    for (const p of w.persons()) for (const pu of (p.mind.pursuits ?? [])) if (pu.status === 'active' && (!best || pu.priority > best.pu.priority)) best = { p, pu };
    if (best) (window as any).game.observer.select(best.p.id);
    return best ? `${best.p.name} — ${best.pu.kind} @${best.pu.priority.toFixed(2)}` : 'nobody';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'manual-2-observer.png') });

  // 3. follow them, and let the world run so the camera has to keep up
  await page.click('#observer [data-a=follow]');
  await page.evaluate(() => { const g = (window as any).game; g.stepSim((3600 * 3) / g.world.clock.timeScale, 2); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'manual-3-following.png') });

  // 4. the indoor case: follow somebody who is inside a building, to check the roof cut
  const indoor = await page.evaluate(() => {
    const g = (window as any).game; const w = g.world;
    const inside = w.persons().find((p: any) => { const b = w.primaryBody(p.id); return p.alive && !p.controlled && b && w.isIndoors(b.pos); });
    if (inside) { g.observer.select(inside.id); g.observer.setFollow(true); }
    return inside ? `${inside.name} in ${w.placeAt(w.primaryBody(inside.id).pos)?.name}` : 'nobody indoors';
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'manual-4-indoors.png') });

  // 5. back to normal play
  await page.evaluate(() => { (window as any).game.observer.setFollow(false); });
  await page.keyboard.press('F2');
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'manual-5-immersive.png') });

  console.log(`watched: ${who}\nindoors: ${indoor}\nscreenshots in ${OUT}`);
  await browser.close();
  await server.close();
}
main().catch(e => { console.error(e); process.exitCode = 1; });
