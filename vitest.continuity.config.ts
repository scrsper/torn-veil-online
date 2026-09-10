import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/capability-continuity-longrun.test.ts'], exclude: [...configDefaults.exclude], pool: 'forks', maxWorkers: 1 } });
