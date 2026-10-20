import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createAtlasAssetHandler, type ServedAtlasAsset } from '../../src/server/atlasAssets';

const roots: string[] = [], servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise<void>(done => { s.closeAllConnections(); s.close(() => done()); })));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function fixture(gzip = false) {
  const root = await mkdtemp(join(tmpdir(), 'tv-atlas-transport-')); roots.push(root);
  await mkdir(join(root, 'public/models'), { recursive: true });
  const bytes = Buffer.from('glTF deterministic fixture data, not a real rendered model');
  const transported = gzip ? gzipSync(bytes) : bytes, path = `models/fixture.glb${gzip ? '.gz' : ''}`;
  await writeFile(join(root, 'public', path), transported);
  const asset: ServedAtlasAsset = {
    path, contentHash: sha(bytes), byteLength: bytes.length, eligible: true,
    ...(gzip ? { transport: { encoding: 'gzip' as const, contentHash: sha(transported), byteLength: transported.length } } : {}),
  };
  const handler = createAtlasAssetHandler({ root, assets: [asset], revision: 'test' });
  const server = createServer((req, res) => { void handler(req, res).then(handled => { if (!handled) res.writeHead(404).end(); }); });
  servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { root, bytes, transported, asset, url, model: `${url}/atlas/models/${asset.contentHash}.glb` };
}
describe('read-only installed Atlas transport', () => {
  it.each([false, true])('serves verified decoded model bytes (gzip=%s)', async gzip => {
    const f = await fixture(gzip);
    const response = await fetch(f.model, { headers: { origin: f.url } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('model/gltf-binary');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(f.bytes);
    const status = await fetch(f.url + '/atlas/status').then(r => r.json());
    expect(status).toMatchObject({ rootAvailable: true, eligibleModels: 1, verifiedModels: 1, served: 1 });
  });
  it('refuses changed bytes even with the same size, including after cache verification', async () => {
    const f = await fixture();
    expect((await fetch(f.model)).status).toBe(200);
    const corrupt = Buffer.from(f.bytes); corrupt[4] ^= 4;
    await writeFile(join(f.root, 'public', f.asset.path), corrupt);
    const response = await fetch(f.model);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('differs');
  });
  it('rejects unknown/path-selected assets, writes and another origin', async () => {
    const f = await fixture();
    expect((await fetch(f.url + '/atlas/models/' + 'a'.repeat(64) + '.glb')).status).toBe(404);
    expect((await fetch(f.url + '/atlas/models/%2e%2e%2fsecret.glb')).status).toBe(404);
    expect((await fetch(f.model, { method: 'POST' })).status).toBe(405);
    expect((await fetch(f.model, { headers: { origin: 'https://example.invalid' } })).status).toBe(403);
    const wrongHost = await new Promise<number | undefined>((done, reject) => {
      const req = request(f.model, { headers: { host: 'example.invalid' } }, res => {
        res.resume(); res.on('end', () => done(res.statusCode));
      });
      req.on('error', reject); req.end();
    });
    expect(wrongHost).toBe(403);
  });
  it('returns an explicit unavailable result without fabricating substitute geometry', async () => {
    const f = await fixture(true);
    await rm(join(f.root, 'public', f.asset.path));
    expect((await fetch(f.model)).status).toBe(503);
    expect((await fetch(f.url + '/atlas/status').then(r => r.json())).rejected).toBe(1);
  });
});
