import type { AtlasAsset, AtlasCatalog, AtlasExclusion } from '../../src/sim/world/atlas/types';
export function sha256(bytes: string | Uint8Array): string;
export function inspectGlb(bytes: Buffer): Pick<AtlasAsset, 'triangleCount' | 'nodeCount' | 'meshCount' | 'primitiveCount'
  | 'materialCount' | 'textureCount' | 'textureBytes' | 'nodeNames' | 'bounds' | 'footprintRadius' | 'height' | 'groundOffset' | 'proxy'> & { animated: boolean };
export function deduplicateAssets(assets: AtlasAsset[]): { assets: AtlasAsset[]; excluded: AtlasExclusion[] };
export function cookAtlas(root: string): AtlasCatalog;
