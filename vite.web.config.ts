import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAtlasAssetHandler } from './src/server/atlasAssets';

const gatewayPort = process.env.TV_WEB_GATEWAY_PORT ?? '7491';
const universePort = process.env.TORN_VEIL_UNIVERSE_PORT ?? '7526';

/**
 * Babylon.js browser client. Separate from the legacy Three.js client (root vite.config.ts):
 * its own entry, its own output (`dist-web`), and it may import only browser-safe modules. That
 * boundary is enforced by tests/web-boundary.test.ts against the real bundle graph.
 */
const replays = (): Plugin => ({
  name: 'tv-dev-replays',
  apply: 'serve',
  configureServer(server) {
    // Recorded observer streams live in ignored local state (.debug/web/streams); only the dev server exposes them.
    server.middlewares.use('/replays', (req, res, next) => {
      const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
      if (!/^[\w.-]+\.json$/.test(name)) return next();
      const file = resolve(__dirname, '.debug/web/streams', name);
      if (!existsSync(file)) return next();
      res.setHeader('content-type', 'application/json'); createReadStream(file).pipe(res);
    });
  },
});
const atlas = (): Plugin => ({
  name: 'tv-local-atlas',
  apply: 'serve',
  configureServer(server) {
    const handle = createAtlasAssetHandler();
    server.middlewares.use((req, res, next) => {
      void handle(req, res).then(handled => { if (!handled) next(); }, next);
    });
  },
});

export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: './',
  publicDir: resolve(__dirname, 'web/public'),
  plugins: [replays(), atlas()],
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { babylon: ['@babylonjs/core'] } } },
  },
  // In development the page is served by Vite; the session, health and socket routes are the gateway's, proxied so one origin serves both.
  server: { port: 5180, host: '127.0.0.1', strictPort: true, proxy: { '/api/universe': { target: `http://127.0.0.1:${universePort}`, changeOrigin: true }, '/ws': { target: `ws://127.0.0.1:${gatewayPort}`, ws: true, changeOrigin: true }, '/api': { target: `http://127.0.0.1:${gatewayPort}`, changeOrigin: true }, '/launch': { target: `http://127.0.0.1:${gatewayPort}`, changeOrigin: true } } },
  esbuild: { legalComments: 'none' },
});
