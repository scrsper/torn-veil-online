import { defineConfig, configDefaults } from 'vitest/config';

/**
 * The Causal Society acceptance run, on its own (`npm run causal:accept`).
 *
 * It lives outside the default suite for a measured reason — see the note in `vite.config.ts`:
 * simulating 17 unattended world days is ~2 minutes of solid CPU in one file, and run beside the
 * unit tests it starves their workers until a neighbour with a tight per-test budget fails for
 * want of a core rather than for want of correctness. Since the default config must therefore
 * exclude it, and vitest's `exclude` wins over a positional filter, the acceptance needs a config
 * of its own rather than a pile of `--exclude` flags in a package script.
 */
export default defineConfig({
  test: {
    include: ['tests/causal-society-longrun.test.ts'],
    exclude: [...configDefaults.exclude],
  },
});
