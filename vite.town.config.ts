import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** The starting town as its own small static page: web/town.html → dist-town/. The dev server
 * serves web/public as usual; the production build copies no public directory at all —
 * scripts/town/stage-assets.mjs adds exactly the textures and hash-verified GLBs it uses. */
export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'web'),
  base: '/',
  publicDir: command === 'serve' ? resolve(__dirname, 'web/public') : false,
  build: {
    outDir: resolve(__dirname, 'dist-town'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
    rollupOptions: { input: { index: resolve(__dirname, 'web/town.html') }, output: { manualChunks: { babylon: ['@babylonjs/core'] } } },
  },
  server: { port: 5190, host: '127.0.0.1', strictPort: true },
  esbuild: { legalComments: 'none' },
}));
