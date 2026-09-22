import { mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config';
import { profilePlugin } from './instrumentation';
export default mergeConfig(base, { plugins: process.env.FOOD_PERF_INSTRUMENT === '1' ? [profilePlugin()] : [], test: { setupFiles: [fileURLToPath(new URL('./setup.ts', import.meta.url))] } });
