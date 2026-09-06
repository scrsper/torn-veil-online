// v0.8 §10: reusable browser functional harness — drives the REAL game client (the same
// index.html/main.ts a human plays) through Playwright, against a real Vite dev server, instead
// of one-off disposable scripts. `npm run test:browser` runs every spec in tests/browser/specs/.
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BrowserSpec { name: string; run: (page: Page, baseURL: string) => Promise<void>; }

// v0.9: the fixed `/opt/pw-browsers/chromium` default only exists in this project's Linux
// development sandbox. On a machine where Playwright manages its own browsers (`npx playwright
// install chromium` — the Windows dev machine, a stock CI runner), passing ANY explicit
// executablePath fails with `spawn UNKNOWN`, because Playwright's own resolution picks a
// different binary from the one `chromium.executablePath()` reports. Leaving it undefined lets
// Playwright resolve its managed install, which is the correct behaviour everywhere the fixed
// path does not exist; setting PLAYWRIGHT_CHROMIUM_PATH still pins it for the sandbox.
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

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
    browser = await chromium.launch({ ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}), headless: true });
    const specs = (await loadSpecs()).filter(s => !filter || s.name.includes(filter));
    if (!specs.length) { console.error(filter ? `No spec matches "${filter}"` : 'No browser specs found in tests/browser/specs/'); process.exitCode = 1; return; }
    console.log(`Running ${specs.length} browser spec(s)...\n`);
    for (const spec of specs) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      // `page.evaluate(fn)` ships the transpiled SOURCE of `fn` and runs it in the page. This
      // project builds specs with tsx/esbuild, whose `keepNames` rewrites any function assigned
      // to a variable — `const snap = () => ...` inside an evaluate callback — into
      // `__name(fn, "snap")`, a helper that exists in the Node module's own output and nowhere in
      // the browser. The result is `ReferenceError: __name is not defined`, thrown before the
      // callback does anything, which reads like a broken client rather than a build artefact.
      // Defining the helper as an identity function in the page makes the whole class of failure
      // go away, instead of every spec author having to remember not to name a local function.
      await context.addInitScript(() => {
        (window as unknown as { __name: <T>(fn: T) => T }).__name = <T>(fn: T): T => fn;
      });
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
