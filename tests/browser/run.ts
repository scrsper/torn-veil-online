// v0.8 §10: reusable browser functional harness — drives the REAL game client (the same
// index.html/main.ts a human plays) through Playwright, against a real Vite dev server, instead
// of one-off disposable scripts. `npm run test:browser` runs every spec in tests/browser/specs/.
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BrowserSpec { name: string; run: (page: Page, baseURL: string) => Promise<void>; }

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

async function loadSpecs(): Promise<BrowserSpec[]> {
  const dir = join(import.meta.dirname, 'specs');
  const files = readdirSync(dir).filter(f => f.endsWith('.spec.ts'));
  const specs: BrowserSpec[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    for (const v of Object.values(mod)) if (v && typeof v === 'object' && 'name' in v && 'run' in v) specs.push(v as BrowserSpec);
  }
  return specs;
}

async function main(): Promise<void> {
  const filter = process.argv[2];
  console.log('Starting Vite dev server for the browser functional harness...');
  const server: ViteDevServer = await createServer({ server: { port: 5183, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5183;
  const baseURL = `http://localhost:${port}`;
  console.log(`Dev server ready at ${baseURL}`);

  let browser: Browser | null = null;
  const results: { name: string; ok: boolean; error?: string; ms: number }[] = [];
  try {
    browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
    const specs = (await loadSpecs()).filter(s => !filter || s.name.includes(filter));
    if (!specs.length) { console.error(filter ? `No spec matches "${filter}"` : 'No browser specs found in tests/browser/specs/'); process.exitCode = 1; return; }
    console.log(`Running ${specs.length} browser spec(s)...\n`);
    for (const spec of specs) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const t0 = Date.now();
      try {
        await spec.run(page, baseURL);
        results.push({ name: spec.name, ok: true, ms: Date.now() - t0 });
        console.log(`  PASS  ${spec.name} (${Date.now() - t0}ms)`);
      } catch (err) {
        results.push({ name: spec.name, ok: false, error: err instanceof Error ? err.stack ?? err.message : String(err), ms: Date.now() - t0 });
        console.log(`  FAIL  ${spec.name} (${Date.now() - t0}ms)`);
        console.log(`        ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) { console.log('Failed: ' + failed.map(f => f.name).join(', ')); process.exitCode = 1; }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
