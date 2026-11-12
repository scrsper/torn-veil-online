import { resolve } from 'node:path';
import base from '../../vite.web.config.ts';

const root = resolve(import.meta.dirname, '../..');
if (!process.env.TV_FOUNDATION_PUBLIC) throw Error('Use npm run foundation:build to stage the explicit foundation asset allowlist.');
export default {
  ...base,
  publicDir: process.env.TV_FOUNDATION_PUBLIC,
  build: { ...base.build, outDir: resolve(root, 'dist-foundation'), emptyOutDir: true },
};
