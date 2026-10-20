import data from './catalog.json';
import type { AtlasAsset, AtlasCatalog } from './types';
export type { AtlasAsset, AtlasBounds, AtlasCatalog, AtlasExclusion, AtlasProxy, AtlasRole, AtlasSource, AtlasVector } from './types';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export const ATLAS_CATALOG = freeze(data as AtlasCatalog);
export const ATLAS_REVISION: string = ATLAS_CATALOG.revision;
export const ATLAS_ASSETS: readonly AtlasAsset[] = ATLAS_CATALOG.assets;
export const eligibleAtlasAssets: readonly AtlasAsset[] = Object.freeze(ATLAS_ASSETS.filter(asset => asset.eligible));
const byId = new Map(ATLAS_ASSETS.map(asset => [asset.id, asset]));
export const getAtlasAsset = (id: string): AtlasAsset | undefined => byId.get(id);
