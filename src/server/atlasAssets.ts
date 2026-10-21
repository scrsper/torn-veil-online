import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { ATLAS_ASSETS, ATLAS_REVISION } from '../sim/world/atlas';

export interface ServedAtlasAsset {
  contentHash: string; byteLength: number; path: string; eligible: boolean;
  transport?: { encoding: 'gzip'; contentHash: string; byteLength: number };
}
/** Read-only, content-addressed access to the user's installed Atlas. Neither a
 * URL nor a save can choose a source path. Model bytes never enter the journal. */
export function createAtlasAssetHandler(options: {
  root?: string; assets?: readonly ServedAtlasAsset[]; revision?: string | number;
} = {}) {
  const publicRoot = resolve(options.root ?? process.env.TV_ATLAS_ROOT ?? resolve(homedir(), 'TornVeilAtlas'), 'public');
  const assets = new Map((options.assets ?? ATLAS_ASSETS).filter(a => a.eligible).map(a => [a.contentHash, a]));
  const verified = new Map<string, string>(), pending = new Map<string, Promise<void>>();
  let served = 0, rejected = 0;
  const inside = (root: string, file: string) => {
    const rel = relative(root, file);
    return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
  };
  const json = (res: ServerResponse, code: number, value: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  async function verifiedFile(a: ServedAtlasAsset) {
    const root = await realpath(publicRoot), requested = resolve(publicRoot, a.path);
    if (!inside(publicRoot, requested)) throw Error('Atlas path is outside its catalog root');
    const file = await realpath(requested);
    if (!inside(root, file)) throw Error('Atlas model link escapes its catalog root');
    const info = await stat(file);
    if (!info.isFile() || info.size !== (a.transport?.byteLength ?? a.byteLength)) throw Error('Atlas model size changed');
    const stamp = `${file}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    // Files can be replaced within a filesystem timestamp quantum. Do not treat
    // unchanged size/mtime as proof of unchanged content on a later request.
    {
      let work = pending.get(stamp);
      if (!work) {
        work = (async () => {
          const source = createReadStream(file), rawHash = createHash('sha256'), decodedHash = createHash('sha256');
          source.on('data', bytes => rawHash.update(bytes));
          const decoded = a.transport ? source.pipe(createGunzip()) : source;
          if (a.transport) source.on('error', error => decoded.destroy(error));
          let bytes = 0;
          try {
            for await (const chunk of decoded) {
              bytes += chunk.length;
              if (bytes > a.byteLength) throw Error('Atlas decoded model exceeds its recorded size');
              decodedHash.update(chunk);
            }
            if (bytes !== a.byteLength || decodedHash.digest('hex') !== a.contentHash
              || a.transport && rawHash.digest('hex') !== a.transport.contentHash) throw Error('Atlas model hash changed');
            verified.set(a.contentHash, stamp);
          } finally { source.destroy(); decoded.destroy(); }
        })();
        pending.set(stamp, work);
        void work.finally(() => pending.delete(stamp)).catch(() => {});
      }
      await work;
    }
    return file;
  }
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith('/atlas/')) return false;
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
      || req.headers.origin && req.headers.origin !== `http://${host}`) {
      json(res, 403, { error: 'Atlas models are available only to this local game origin.' }); return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'Atlas is read-only.' }); return true; }
    if (path === '/atlas/status') {
      const rootAvailable = await stat(publicRoot).then(s => s.isDirectory(), () => false);
      json(res, 200, { revision: options.revision ?? ATLAS_REVISION, rootAvailable, eligibleModels: assets.size,
        verifiedModels: verified.size, served, rejected });
      return true;
    }
    const hash = /^\/atlas\/models\/([a-f0-9]{64})\.glb$/.exec(path)?.[1], asset = hash && assets.get(hash);
    if (!asset) { json(res, 404, { error: 'Model is not in the compatible Atlas registry.' }); return true; }
    try {
      const file = await verifiedFile(asset);
      res.setHeader('content-type', 'model/gltf-binary');
      res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('cache-control', 'private, max-age=31536000, immutable');
      res.setHeader('etag', `"${asset.contentHash}"`);
      if (asset.transport) res.setHeader('content-encoding', asset.transport.encoding);
      res.setHeader('content-length', asset.transport?.byteLength ?? asset.byteLength);
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(file), res);
      served++;
    } catch {
      rejected++;
      if (!res.headersSent) json(res, 503, { error: 'Atlas model is missing or differs from the verified catalog. Check TV_ATLAS_ROOT and recook after reviewing changes.' });
      else res.destroy();
    }
    return true;
  };
}
