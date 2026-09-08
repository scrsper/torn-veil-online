import { defineConfig, configDefaults } from 'vitest/config';

/** Long, CPU-bound one/quarter-century acceptance; kept out of the ordinary unit suite. */
export default defineConfig({
  test: {
    include: ['tests/epoch-continuity-longrun.test.ts'],
    exclude: [...configDefaults.exclude],
    pool: 'forks',
    maxWorkers: 1,
  },
});

