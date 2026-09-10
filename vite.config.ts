import { defineConfig, configDefaults } from 'vitest/config';
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
  // tests/browser/**/*.spec.ts are the v0.8 §10 Playwright browser functional harness (run via
  // `npm run test:browser`, not vitest) — they have no describe/it suites, they're plain async
  // functions driven by tests/browser/run.ts against a real browser + dev server.
  // tests/causal-society-longrun.test.ts is the Causal Society ACCEPTANCE run (`npm run
  // causal:accept`), not a unit test: it simulates 17 unattended world days, which is ~2 minutes
  // of solid CPU in a single file. Left in the default suite it does not merely make the suite
  // slower — it starves the other workers, and a neighbour with a tight per-test budget then
  // fails for want of a core rather than for want of correctness (measured: embodied-economy's
  // 5 s currency-conservation test takes 1.35 s alone and 5.2 s beside it). Widening that
  // neighbour's budget would have hidden the cause; running the acceptance separately removes
  // it. Same treatment, and the same reason, as `world:soak` and `test:browser`.
  // tests/adaptive-society-longrun.test.ts is Adaptive Society's acceptance run (`npm run
  // adapt:accept`), excluded for exactly the same reason and at a larger scale: 30 unattended
  // world days, ~4 minutes of solid CPU. It is longer than the causal one because the chain it
  // has to contain is longer — the loss, the fortnight of flour the bakery had in hand, the
  // stand-in taking the work up, and the recovery working its way back down to the bakery.
  // CPU-bound simulations exceed their unchanged timeouts when every core competes at once.
  // The agency frontier keeps controlled Persons perceiving too. Profiling and the full
  // checkpoint showed competing long simulations exceeding existing budgets; one worker
  // avoids that contention without widening timeouts or weakening assertions.
  test: { maxWorkers: 1, exclude: [...configDefaults.exclude, 'tests/browser/**', 'tests/causal-society-longrun.test.ts', 'tests/adaptive-society-longrun.test.ts', 'tests/epoch-continuity-longrun.test.ts', 'tests/settlement-worldlab-longrun.test.ts', 'tests/capability-continuity-longrun.test.ts'] },
});
