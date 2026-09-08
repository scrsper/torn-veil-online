import { defineConfig, configDefaults } from 'vitest/config';

/**
 * The Adaptive Society acceptance run, on its own (`npm run adapt:accept`).
 *
 * Its own config for the same reason Causal Society's has one — see the note in `vite.config.ts`
 * and in `vitest.accept.config.ts`. Thirty unattended world days is roughly four minutes of solid
 * CPU in a single file; the default config must therefore exclude it, and vitest's `exclude` wins
 * over a positional filter, so a config is the only way to run just this one.
 */
export default defineConfig({
  test: {
    include: ['tests/adaptive-society-longrun.test.ts'],
    exclude: [...configDefaults.exclude],
  },
});
