import { defineConfig, configDefaults } from 'vitest/config';
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
  // tests/browser/**/*.spec.ts are the v0.8 §10 Playwright browser functional harness (run via
  // `npm run test:browser`, not vitest) — they have no describe/it suites, they're plain async
  // functions driven by tests/browser/run.ts against a real browser + dev server.
  test: { exclude: [...configDefaults.exclude, 'tests/browser/**'] },
});
