/** Offline-cooked Atlas measurements. Native glTF coordinates are Y-up metres;
 * placement applies yaw/translation and groundOffset, never implicit rescaling. */
export interface AtlasVector { x: number; y: number; z: number }
export interface AtlasBounds { min: AtlasVector; max: AtlasVector }
export type AtlasRole = 'scene' | 'module' | 'prop' | 'nature' | 'mob-draft';
export type AtlasSource = 'architecture' | 'nature' | 'mobs' | 'rebuild' | 'local';
export interface AtlasProxy {
  /** Conservative canonical proxies, cooked independently of runtime render loading. */
  kind: 'none' | 'bounds' | 'boxes';
  boxes: AtlasBounds[];
}
export interface AtlasAsset {
  id: string;
  name: string;
  source: AtlasSource;
  sourceId: string;
  sourceProvenance: string;
  readiness: string;
  role: AtlasRole;
  /** Static data compatibility, not approval of a living NPC or arbitrary placement. */
  eligible: boolean;
  exclusions: string[];
  tags: string[];
  biomes: string[];
  /** Atlas/public-relative source path; .gz remains a transport detail. */
  path: string;
  contentHash: string;
  byteLength: number;
  transport?: { encoding: 'gzip'; contentHash: string; byteLength: number };
  triangleCount: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  textureBytes: number;
  nodeNames: string[];
  bounds: AtlasBounds;
  footprintRadius: number;
  height: number;
  groundOffset: number;
  proxy: AtlasProxy;
}
export interface AtlasExclusion {
  id: string;
  name: string;
  source: AtlasSource;
  sourceId: string;
  role: AtlasRole | 'still-only' | 'duplicate' | 'source-only';
  reason: string;
  path?: string;
  duplicateOf?: string;
}
export interface AtlasCatalog {
  version: 1;
  revision: string;
  coordinateSystem: 'Y-up metres; native scale 1';
  assets: AtlasAsset[];
  excluded: AtlasExclusion[];
  summary: {
    sourceEntries: number;
    uniqueModels: number;
    compatibleModels: number;
    bySource: Record<string, number>;
    byRole: Record<string, number>;
    exclusions: Record<string, number>;
  };
}
