import '@babylonjs/loaders/glTF';
import { LoadAssetContainerAsync, type AssetContainer, type Scene } from '@babylonjs/core';
import type { AtlasAsset } from '../../sim/world/atlas/types';

export interface AtlasLoader {
  fetch?: typeof fetch;
  parse?: (bytes: Uint8Array, scene: Scene) => Promise<AssetContainer>;
}

/** Reject external resources before the loader can issue secondary requests. */
export function inspectAtlasGlb(bytes: ArrayBuffer): void {
  const view = new DataView(bytes);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a)
    throw Error('Atlas model has an invalid GLB header');
  const jsonLength = view.getUint32(12, true);
  if (jsonLength > bytes.byteLength - 20) throw Error('Atlas GLB JSON exceeds its buffer');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (resource.uri && !/^data:/i.test(resource.uri)) throw Error('Atlas GLBs must contain their resources');
  }
  // These decoders otherwise fetch executable code from a public CDN. The cooked
  // pack ships ordinary embedded GLB geometry; add a local decoder before allowing it.
  if ((json.extensionsRequired ?? []).some((name: string) =>
    ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(name)))
    throw Error('Atlas model requires an unstaged decoder');
}

/** The HTTP stack decodes Content-Encoding:gzip before this decoded-byte hash. */
export async function loadVerifiedAtlasAsset(asset: AtlasAsset, scene: Scene, signal: AbortSignal, loader: AtlasLoader = {}): Promise<AssetContainer> {
  if (!/^[0-9a-f]{64}$/.test(asset.contentHash) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 20)
    throw Error('Invalid Atlas model identity');
  const response = await (loader.fetch ?? fetch)(`/atlas/models/${asset.contentHash}.glb`, { signal, cache: 'force-cache' });
  if (!response.ok) throw Error(`Atlas model HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > asset.byteLength) { await reader.cancel(); throw Error('Atlas model exceeds its cooked byte length'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  } else {
    const chunk = new Uint8Array(await response.arrayBuffer()); size = chunk.byteLength; chunks.push(chunk);
  }
  if (size !== asset.byteLength) throw Error('Atlas model byte length differs from the registry');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.contentHash) throw Error('Atlas model hash differs from the registry');
  signal.throwIfAborted();
  inspectAtlasGlb(bytes.buffer);
  const container = await (loader.parse ?? ((data, target) =>
    LoadAssetContainerAsync(data, target, { pluginExtension: '.glb', name: `${asset.contentHash}.glb` })))(bytes, scene);
  if (signal.aborted || scene.isDisposed) { container.dispose(); throw Error('Atlas model load cancelled'); }
  for (const animation of container.animationGroups) animation.stop();
  return container;
}
