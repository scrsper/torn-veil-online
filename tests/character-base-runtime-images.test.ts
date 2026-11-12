import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine, Scene, SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CHARACTER_BASE_DIR, readCharacterBasePin, resolveCharacterBaseUri, stagedCharacterBaseFiles } from '../scripts/foundation/character-bases.mjs';
import { StudioCharacterBases } from '../src/web/actors/studioBases';

// The browser failure: Babylon's glTF loader rejects any image URI containing '..', and the
// source hair GLBs reference ../textures/HairPreview_*.png. NullEngine never fetches or decodes
// images, so this harness serves exactly the files the foundation build copies (the staged
// list), refuses anything else, and really inflates every PNG the loader or adapter requests.
const root = resolve('.'), dir = resolve(CHARACTER_BASE_DIR), BASE = 'http://foundation.test/private-character-bases/';
const staged = existsSync(dir) && stagedCharacterBaseFiles(root).length > 0;
if (process.env.TV_REQUIRE_CHARACTER_BASES === '1' && !staged) throw Error('Stage the pinned private character bases before running required acceptance.');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Decode the actual non-interlaced 8-bit source PNGs, including CRCs, inflation and pixel reconstruction.
 * This replaces only NullEngine's no-op texture backend, not Babylon's glTF URI/image loading. */
function decodePng(bytes: Buffer) {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('not a PNG');
  let at = 8, header: { width: number; height: number; depth: number; color: number; interlace: number } | null = null, ended = false;
  const data: Buffer[] = [];
  while (at < bytes.length && !ended) {
    if (at + 12 > bytes.length) throw Error('truncated PNG chunk');
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (at + 12 + length > bytes.length) throw Error('truncated PNG data');
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) throw Error('PNG CRC mismatch in ' + type);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    if (type === 'IDAT') data.push(body);
    if (type === 'IEND') ended = true;
    at += 12 + length;
  }
  if (!header || !ended || at !== bytes.length || header.interlace !== 0 || header.depth !== 8) throw Error('unsupported or truncated PNG');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[header.color];
  if (!channels || !header.width || !header.height) throw Error('invalid PNG header');
  const rowBytes = header.width * channels, stride = 1 + rowBytes, pixels = inflateSync(Buffer.concat(data), { maxOutputLength: stride * header.height });
  if (pixels.length !== stride * header.height) throw Error('PNG image data has the wrong size');
  const reconstructed = Buffer.alloc(rowBytes * header.height);
  for (let row = 0; row < header.height; row++) {
    const filter = pixels[row * stride];
    if (filter > 4) throw Error('PNG filter type is invalid');
    for (let column = 0; column < rowBytes; column++) {
      const at = row * rowBytes + column, left = column >= channels ? reconstructed[at - channels] : 0;
      const up = row ? reconstructed[at - rowBytes] : 0, upperLeft = row && column >= channels ? reconstructed[at - rowBytes - channels] : 0;
      const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
      const predict = [0, left, up, Math.floor((left + up) / 2), a <= b && a <= c ? left : b <= c ? up : upperLeft][filter];
      reconstructed[at] = (pixels[row * stride + column + 1] + predict) & 255;
    }
  }
  return { width: header.width, height: header.height, sha256: sha(bytes), pixelSha256: sha(reconstructed) };
}

function harness(corruptImage?: string) {
  const served = new Set(stagedCharacterBaseFiles(root)), requests: { url: string; status: number }[] = [];
  const serve = (url: string): Buffer | null => {
    let status = 404, bytes: Buffer | null = null;
    if (url.startsWith(BASE)) {
      const path = decodeURIComponent(url.slice(BASE.length));
      if (served.has(path)) { bytes = readFileSync(resolve(dir, path)); status = 200; }
    }
    requests.push({ url, status });
    return bytes;
  };
  class StagedRequest extends EventTarget {
    static DONE = 4;
    readyState = 0; status = 0; statusText = ''; responseType = ''; responseURL = ''; response: ArrayBuffer | null = null; onprogress = null; private url = '';
    get responseText() { return ''; }
    open(_method: string, url: string) { this.url = url; this.readyState = 1; }
    setRequestHeader() {} getResponseHeader() { return null; } abort() {}
    send() {
      setTimeout(() => {
        const bytes = serve(this.url);
        this.status = bytes ? 200 : 404; this.statusText = bytes ? 'OK' : 'Not Found'; this.responseURL = this.url;
        this.response = bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : null;
        this.readyState = 4; this.dispatchEvent(new Event('readystatechange')); this.dispatchEvent(new Event('loadend'));
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', StagedRequest);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const bytes = serve(new URL(url, BASE).href);
    return new Response(bytes, { status: bytes ? 200 : 404, headers: { 'content-type': 'application/json' } });
  }));
  const engine = new NullEngine(), scene = new Scene(engine), decoded: { url: string; width: number; height: number; sha256: string }[] = [], failures: string[] = [], internal: string[] = [];
  scene.useRightHandedSystem = true;
  // NullEngine also makes release a no-op. Match the real engine's cache eviction on disposal,
  // otherwise a failed PNG could be reused as an already-ready fake texture on the next sex.
  vi.spyOn(engine, '_releaseTexture').mockImplementation(texture => {
    const cache = engine.getLoadedTexturesCache(), index = cache.indexOf(texture);
    if (index >= 0) cache.splice(index, 1);
  });
  const create = engine.createTexture.bind(engine);
  vi.spyOn(engine, 'createTexture').mockImplementation((...args: Parameters<typeof engine.createTexture>) => {
    const url = String(args[0]), onLoad = args[5], onError = args[6], buffer = args[7] as ArrayBufferView | ArrayBuffer | null;
    // glTF images arrive as data:<rootUrl><uri> plus bytes; Babylon's own lookup textures are not foundation files.
    if (!url.includes('foundation.test/')) { internal.push(url); return create(...args); }
    args[5] = null; args[6] = null;
    const texture = create(...args);
    texture.isReady = false;
    setTimeout(() => {
      try {
        const bytes = buffer ? (ArrayBuffer.isView(buffer) ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength) : Buffer.from(buffer)) : serve(url);
        if (!bytes) throw Error('404 ' + url);
        const input = Buffer.from(bytes);
        if (url.includes(corruptImage ?? '\0')) input[Math.floor(input.length / 2)] ^= 1;
        decoded.push({ url, ...decodePng(input) }); texture.isReady = true;
        onLoad?.(texture); texture.onLoadedObservable.notifyObservers(texture); texture.onLoadedObservable.clear();
      } catch (error) {
        failures.push(url + ': ' + String(error)); onError?.(String(error), error);
        texture.onErrorObservable.notifyObservers({ message: String(error), exception: error });
      }
    });
    return texture;
  });
  return { engine, scene, decoded, failures, requests, internal };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('actual studio GLB image paths through the Babylon glTF loader', () => {
  it.skipIf(!staged)('reproduces the source hair rejection: parent-relative image URIs are invalid to the loader', async () => {
    const { engine, scene } = harness(), pin = readCharacterBasePin(root)!;
    try {
      for (const hair of [pin.parts.female.hair, pin.parts.male.hair]) {
        const source = readFileSync(resolve(dir, hair));
        expect(sha(source)).toBe(pin.files.find(f => f.path === hair)!.sha256);
        const slash = hair.lastIndexOf('/');
        await expect(SceneLoader.LoadAssetContainerAsync(BASE + hair.slice(0, slash + 1), hair.slice(slash + 1), scene))
          .rejects.toThrow(/\/images\/0\/uri: '\.\.\/textures\/HairPreview_5861b9f16735\.png' is invalid/);
      }
    } finally { scene.dispose(); engine.dispose(); }
  }, 60000);

  it.skipIf(!staged)('loads both actual clothed bases with every glTF and DIRO image resolved inside the served root and decoded', async () => {
    const { engine, scene, decoded, failures, requests, internal } = harness(), pin = readCharacterBasePin(root)!;
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
    for (const sex of ['female', 'male'] as const) {
      const source = readFileSync(resolve(dir, pin.parts[sex].hair)), runtime = readFileSync(resolve(dir, manifest.parts[sex].hair));
      const sourceJson = JSON.parse(source.subarray(20, 20 + source.readUInt32LE(12)).toString());
      const runtimeJson = JSON.parse(runtime.subarray(20, 20 + runtime.readUInt32LE(12)).toString());
      // Only image storage and the appended buffer metadata may differ, never mesh/rig/material data.
      const { images: sourceImages, buffers: sourceBuffers, bufferViews: sourceViews, ...sourceScene } = sourceJson;
      const { images: runtimeImages, buffers: runtimeBuffers, bufferViews: runtimeViews, ...runtimeScene } = runtimeJson;
      expect(runtimeScene).toEqual(sourceScene);
      expect(runtimeViews.slice(0, sourceViews.length)).toEqual(sourceViews);
      const sourceBin = 28 + source.readUInt32LE(12), runtimeBin = 28 + runtime.readUInt32LE(12);
      expect(runtime.subarray(runtimeBin, runtimeBin + sourceBuffers[0].byteLength)).toEqual(source.subarray(sourceBin, sourceBin + sourceBuffers[0].byteLength));
      expect(runtime.readUInt32LE(8)).toBe(runtime.length);
      expect(runtimeBuffers[0].byteLength).toBeGreaterThan(sourceBuffers[0].byteLength);
      expect(runtimeImages).toHaveLength(sourceImages.length);
      for (const [index, image] of runtimeImages.entries()) {
        expect(image.uri).toBeUndefined(); expect(image.mimeType).toBe('image/png');
        const view = runtimeViews[image.bufferView];
        const original = readFileSync(resolve(dir, resolveCharacterBaseUri(pin.parts[sex].hair, sourceImages[index].uri)));
        expect(sha(runtime.subarray(runtimeBin + view.byteOffset, runtimeBin + view.byteOffset + view.byteLength))).toBe(sha(original));
      }
    }
    const bases = new StudioCharacterBases(scene, BASE);
    try {
      const status = await bases.load();
      expect(failures).toEqual([]);
      expect(internal.every(url => /^data:EnvironmentBRDFTexture/.test(url)), internal.join()).toBe(true);
      expect(status.reason).toBe('loaded');
      expect(status.available).toEqual(['female', 'male']);
      for (const sex of ['female', 'male'] as const) expect(status.materials[sex]?.hair).toBeGreaterThan(0);
      expect(requests.filter(r => r.status !== 200)).toEqual([]);
      // The hair preview the source referenced as ../textures/... is the exact pinned image, decoded once per sex.
      const pinned = (path: string) => pin.files.find(f => f.path === path)!.sha256;
      expect(decoded.filter(d => d.sha256 === pinned('textures/HairPreview_5861b9f16735.png'))).toHaveLength(2);
      const diro = decoded.filter(d => d.url === BASE + 'textures/T_Hair_03_DIRO.png');
      // Both materials await the same successfully decoded, cached DIRO image.
      expect(diro).toHaveLength(1); expect(diro[0].sha256).toBe(pinned('textures/T_Hair_03_DIRO.png'));
      // Every decoded image is byte-identical to a pinned source texture; nothing was fabricated.
      const pinnedImages = new Set(pin.files.filter(f => f.path.endsWith('.png')).map(f => f.sha256));
      expect(decoded.every(d => pinnedImages.has(d.sha256) && d.width > 0 && d.height > 0)).toBe(true);
      // Require every actual material texture, not an arbitrary decode count (Babylon shares images).
      // Unreferenced images in a GLB's image table are not material dependencies.
      const expectedImages = new Set([pinned('textures/T_Hair_03_DIRO.png')]);
      for (const parts of Object.values(pin.parts)) for (const path of Object.values(parts)) {
        const bytes = readFileSync(resolve(dir, path)), gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
        const visit = (value: unknown) => {
          if (!value || typeof value !== 'object') return;
          for (const [key, entry] of Object.entries(value)) {
            if (key.endsWith('Texture') && entry && typeof entry === 'object' && 'index' in entry) {
              const source = gltf.textures[(entry as { index: number }).index].source;
              expectedImages.add(pinned(resolveCharacterBaseUri(path, gltf.images[source].uri)));
            } else visit(entry);
          }
        };
        visit(gltf.materials);
      }
      expect(new Set(decoded.map(d => d.sha256))).toEqual(expectedImages);
      const rig = bases.rig('male');
      expect(rig.missingBones).toEqual([]);
      rig.dispose();
    } finally { bases.dispose(); scene.dispose(); engine.dispose(); }
  }, 240000);

  it.skipIf(!staged)('reports an actual PNG decode failure instead of accepting either base', async () => {
    const { engine, scene, failures } = harness('T_Hair_03_DIRO.png'), bases = new StudioCharacterBases(scene, BASE);
    try {
      const status = await bases.load();
      expect(status.available).toEqual([]);
      expect(status.reason).toContain('DIRO texture failed');
      expect(failures).toHaveLength(2);
      expect(failures.every(f => f.includes('PNG CRC mismatch'))).toBe(true);
    } finally { bases.dispose(); scene.dispose(); engine.dispose(); }
  }, 240000);
});
