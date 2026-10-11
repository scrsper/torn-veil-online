import { Color3, PBRMaterial, RawTexture, Scene, Texture, type Nullable } from '@babylonjs/core';
import { paintTexture, type PaintedTexture, type TextureKind } from './textures';
import { GroundCover } from './groundCover';

/**
 * Shared materials for the world. Each is a PBR material over procedural texture detail, tinted
 * from the reference palette (weathered stone, ivory plaster, dark timber, slate and terracotta
 * roofs, pale-gold metal). UVs are world-space metres, so `metres` says how big one texture tile is.
 */
export type MatName =
  | 'plaster' | 'planks' | 'darkwood' | 'log' | 'stone' | 'cobble' | 'moss' | 'roofTile' | 'roofSlate' | 'thatch' | 'cloth' | 'clothRed' | 'clothBlue'
  | 'terrain' | 'path' | 'glass' | 'iron' | 'gold' | 'hay' | 'water' | 'bark' | 'leaf' | 'leafDark' | 'rock' | 'farmland' | 'wood' | 'props';
interface Spec { texture: TextureKind; tint: [number, number, number]; metres: number; roughness?: number; metallic?: number; bump?: number; alpha?: number; emissive?: [number, number, number] }
interface WeatherProfile { dryColor: Color3; dryRoughness: number; wetRoughness: number; darken: number }
const WEATHER_TARGETS: Partial<Record<MatName, { roughness: number; darken: number }>> = {
  terrain: { roughness: .65, darken: .15 }, path: { roughness: .45, darken: .2 },
  roofTile: { roughness: .4, darken: .2 }, roofSlate: { roughness: .4, darken: .18 },
  thatch: { roughness: .88, darken: .15 }, cobble: { roughness: .62, darken: .18 },
  rock: { roughness: .68, darken: .18 }, bark: { roughness: .58, darken: .2 },
};

// A restrained family of scanned stone, timber, plaster and ground. Colour remains a material
// property; region vertex colours supply local dampness and wear without duplicating textures.
const SURFACES: Partial<Record<MatName, string>> = {
  plaster: 'plastered_wall', planks: 'weathered_planks', darkwood: 'weathered_planks', wood: 'weathered_planks', log: 'weathered_planks',
  stone: 'rock_wall_08', moss: 'rock_wall_08', rock: 'mossy_rock', cobble: 'cobblestone_floor_08', bark: 'bark_brown_02',
  roofSlate: 'roof_slates_02', roofTile: 'roof_slates_02', thatch: 'reed_roof_04', hay: 'reed_roof_04',
  terrain: 'forest_ground_04', path: 'brown_mud', farmland: 'brown_mud',
};

const c = (hex: number): [number, number, number] => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const SPECS: Record<MatName, Spec> = {
  plaster: { texture: 'plaster', tint: c(0xe9e0cb), metres: 2.5 },
  planks: { texture: 'planks', tint: c(0xc39a68), metres: 2 },
  darkwood: { texture: 'darkwood', tint: c(0x9a7454), metres: 2 },
  wood: { texture: 'planks', tint: c(0x9a7248), metres: 2 },
  log: { texture: 'log', tint: c(0x9a7248), metres: 2 },
  stone: { texture: 'stonebrick', tint: c(0xc4c0b4), metres: 2, bump: 1.3 },
  cobble: { texture: 'cobble', tint: c(0x8f8b83), metres: 2, bump: 1.3 },
  moss: { texture: 'stonebrick', tint: c(0x7f9070), metres: 2, bump: 1.3 },
  roofTile: { texture: 'roofTile', tint: c(0xc26a55), metres: 4.5 },
  roofSlate: { texture: 'roofTile', tint: c(0x6a7286), metres: 4.5 },
  thatch: { texture: 'thatch', tint: c(0xe2bf72), metres: 2.5, roughness: 0.98 },
  cloth: { texture: 'cloth', tint: c(0xd8d1bd), metres: 1 },
  clothRed: { texture: 'cloth', tint: c(0x9a2c34), metres: 1 },
  clothBlue: { texture: 'cloth', tint: c(0x3f5f9a), metres: 1 },
  terrain: { texture: 'ground', tint: [1, 1, 1], metres: 3, roughness: 0.96, bump: 0.8 },
  path: { texture: 'ground', tint: [1, 1, 1], metres: 2, roughness: 0.97, bump: 1 },
  farmland: { texture: 'ground', tint: [1, 1, 1], metres: 1.5, roughness: 0.98, bump: 1.4 },
  glass: { texture: 'water', tint: c(0x7f9fb8), metres: 1, roughness: 0.04, metallic: 0.0, alpha: 0.32, emissive: [0, 0, 0] },
  iron: { texture: 'ground', tint: c(0x3a3d45), metres: 1, roughness: 0.5, metallic: 0.85 },
  gold: { texture: 'ground', tint: c(0xd6b25e), metres: 1, roughness: 0.35, metallic: 0.9 },
  hay: { texture: 'thatch', tint: c(0xd9b85c), metres: 1.5, roughness: 0.98 },
  water: { texture: 'water', tint: c(0x2b5a72), metres: 6, roughness: 0.05, alpha: 0.74, bump: 0.5 },
  bark: { texture: 'bark', tint: c(0x6b4c33), metres: 1.5 },
  leaf: { texture: 'leaf', tint: c(0x5d8a45), metres: 1.5, roughness: 0.75 },
  leafDark: { texture: 'leaf', tint: c(0x3c5c33), metres: 1.5, roughness: 0.75 },
  rock: { texture: 'cobble', tint: c(0x8d8a86), metres: 2, roughness: 0.93, bump: 1.4 },
  /** Small props colour themselves through vertex colours; this supplies grain, roughness and normal detail. */
  props: { texture: 'ground', tint: [1, 1, 1], metres: 0.6, roughness: 0.78, bump: 0.5 },
};

/** The CC0 scan set for a surface (web/public/textures/world/<surface>-albedo|normal|arm.jpg): sRGB albedo, linear normal and ARM. */
export function loadScannedMaps(scene: Scene, surface: string): { albedo: Texture; normal: Texture; arm: Texture } {
  const texture = (slot: string, srgb: boolean) => {
    const tx = new Texture(`/textures/world/${surface}-${slot}.jpg`, scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    tx.gammaSpace = srgb; tx.anisotropicFilteringLevel = 8;
    tx.wrapU = Texture.WRAP_ADDRESSMODE; tx.wrapV = Texture.WRAP_ADDRESSMODE;
    return tx;
  };
  return { albedo: texture('albedo', true), normal: texture('normal', false), arm: texture('arm', false) };
}
/** Bind a scan set to a PBR material: albedo, OpenGL-style normal (Y inverted), AO / roughness / metal from ARM's R / G / B. */
export function useScannedMaps(m: PBRMaterial, maps: { albedo: Texture; normal: Texture; arm: Texture }): void {
  m.albedoTexture = maps.albedo;
  m.bumpTexture = maps.normal; m.invertNormalMapY = true;
  m.metallicTexture = maps.arm; m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true; m.useRoughnessFromMetallicTextureAlpha = false; m.useMetallnessFromMetallicTextureBlue = true;
  m.ambientTextureStrength = .8;
}

export class MaterialLibrary {
  private readonly cache = new Map<MatName, PBRMaterial>();
  private readonly weatherMaterials = new Map<PBRMaterial, WeatherProfile>();
  private readonly clones = new Set<PBRMaterial>();
  private weatherWetness = 0;
  private readonly textures = new Map<TextureKind, { albedo: RawTexture; normal: RawTexture; roughness: number }>();
  private readonly scanned = new Map<string, { albedo: Texture; normal: Texture; arm: Texture }>();
  private readonly foliage = new Map<string, Texture>();
  constructor(private readonly scene: Scene) {}

  get wetness(): number { return this.weatherWetness; }

  private tex(kind: TextureKind) {
    let t = this.textures.get(kind);
    if (!t) {
      const p: PaintedTexture = paintTexture(kind, kind.length * 131 + 7);
      const make = (data: Uint8ClampedArray, srgb: boolean): RawTexture => {
        const rt = RawTexture.CreateRGBATexture(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), p.size, p.size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
        rt.wrapU = Texture.WRAP_ADDRESSMODE; rt.wrapV = Texture.WRAP_ADDRESSMODE; rt.anisotropicFilteringLevel = 8;
        void srgb; return rt;
      };
      t = { albedo: make(p.albedo, true), normal: make(p.normal, false), roughness: p.roughness };
      this.textures.set(kind, t);
    }
    return t;
  }
  /** World-space UV scale (tiles per metre) for a material. */
  tilesPerMetre(name: MatName): number { return 1 / SPECS[name].metres; }

  get(name: MatName): PBRMaterial {
    let m = this.cache.get(name);
    if (m) return m;
    const s = SPECS[name], t = this.tex(s.texture);
    m = new PBRMaterial(`mat-${name}`, this.scene);
    const surface = SURFACES[name];
    if (surface) {
      let maps = this.scanned.get(surface);
      if (!maps) { maps = loadScannedMaps(this.scene, surface); this.scanned.set(surface, maps); }
      useScannedMaps(m, maps);
      // The scans already contain the wood colour. The former brown tint multiplied it
      // a second time, losing the grain entirely on the shaded side of buildings.
      m.albedoColor = name === 'darkwood' ? new Color3(1.2, 1.06, .87) : ['planks', 'wood', 'log'].includes(name) ? new Color3(1.6, 1.5, 1.35) : name === 'roofSlate' ? new Color3(.65, .78, .92) : name === 'roofTile' ? new Color3(1.3,.72,.46) : name === 'thatch' ? new Color3(1.12,.91,.62) : name === 'plaster' ? new Color3(1.05,1,.89) : Color3.White();
    } else {
      m.albedoTexture = t.albedo; m.albedoColor = new Color3(...s.tint);
      m.bumpTexture = t.normal; m.invertNormalMapY = true;
    }
    m.metallic = s.metallic ?? 0; m.roughness = s.roughness ?? t.roughness;
    m.environmentIntensity = 0.8; m.directIntensity = 1;
    m.specularIntensity = 0.5;
    if (s.alpha !== undefined) { m.alpha = s.alpha; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; m.backFaceCulling = false; m.needDepthPrePass = false; }
    if (s.emissive) m.emissiveColor = new Color3(...s.emissive);
    if (name === 'leaf' || name === 'leafDark') {
      const path = name === 'leafDark' ? '/textures/world/foliage-pine.png' : '/textures/world/foliage-branch.png';
      let foliage = this.foliage.get(path);
      if (!foliage) { foliage = new Texture(path, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE); this.foliage.set(path, foliage); }
      foliage.hasAlpha = true; foliage.anisotropicFilteringLevel = 8;
      m.albedoTexture = foliage; m.albedoColor = new Color3(.9, 1.05, .72); m.bumpTexture = null;
      m.useAlphaFromAlbedoTexture = true; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = .42;
      m.backFaceCulling = false; m.twoSidedLighting = true; m.roughness = .85;
      m.subSurface.isTranslucencyEnabled = true; m.subSurface.translucencyIntensity = .12;
      m.subSurface.tintColor = new Color3(.75, .9, .45);
      m.specularIntensity = .12; m.environmentIntensity = .6;
    }
    if ((name === 'roofTile' || name === 'roofSlate') && m.bumpTexture) m.bumpTexture.level = .55;
    m.maxSimultaneousLights = 8;
    if (name === 'terrain') {
      // Keep scanned ground detail without overpowering actor silhouettes at gameplay distance.
      if (m.bumpTexture) m.bumpTexture.level = .55;
      new GroundCover(m);
    }
    // The sky irradiance, pooled lights and weather change throughout gameplay.
    // Frozen PBR uniform buffers retain first-bind environment values across those changes.
    this.cache.set(name, m);
    this.registerWeatherMaterial(name, m);
    return m;
  }

  /** Clone a material while retaining its original dry profile for weather updates. */
  clone(name: MatName, label: string): PBRMaterial {
    const source = this.get(name), clone = source.clone(label)!;
    const profile = this.weatherMaterials.get(source);
    if (profile) {
      clone.albedoColor.copyFrom(profile.dryColor); clone.roughness = profile.dryRoughness;
      this.registerWeatherProfile(clone, profile); this.clones.add(clone);
      this.applyWeather(clone, profile);
    }
    return clone;
  }

  /** Smooth projected rain/storm wetness and apply it reversibly to exposed surfaces. */
  updateWeather(kind: string, intensity: number, dt: number): void {
    const i = Math.max(0, Math.min(1, intensity));
    const target = kind === 'storm' ? Math.min(1, i * 1.1) : kind === 'rain' ? i : 0;
    const delta = target - this.weatherWetness;
    if (Math.abs(delta) < 1e-5) return;
    const rate = delta > 0 ? 1.5 : .2;
    this.weatherWetness += delta * (1 - Math.exp(-Math.max(0, dt) * rate));
    if (target === 0 && Math.abs(this.weatherWetness) < 1e-3) this.weatherWetness = 0;
    for (const [material, profile] of this.weatherMaterials) this.applyWeather(material, profile);
  }

  private registerWeatherMaterial(name: MatName, material: PBRMaterial): void {
    const target = WEATHER_TARGETS[name]; if (!target) return;
    const profile: WeatherProfile = { dryColor: material.albedoColor.clone(), dryRoughness: material.roughness ?? .5, wetRoughness: target.roughness, darken: target.darken };
    this.registerWeatherProfile(material, profile); this.applyWeather(material, profile);
  }

  private registerWeatherProfile(material: PBRMaterial, profile: WeatherProfile): void {
    this.weatherMaterials.set(material, profile);
    material.onDisposeObservable.add(() => { this.weatherMaterials.delete(material); this.clones.delete(material); });
  }

  private applyWeather(material: PBRMaterial, profile: WeatherProfile): void {
    material.albedoColor.copyFrom(profile.dryColor).scaleInPlace(1 - profile.darken * this.weatherWetness);
    material.roughness = profile.dryRoughness + (profile.wetRoughness - profile.dryRoughness) * this.weatherWetness;
  }

  /** A per-mesh tinted variant is done through vertex colours; this returns the shared material. */
  dispose(): void {
    const cached = new Set(this.cache.values());
    for (const m of this.cache.values()) m.dispose();
    for (const m of this.clones) if (!cached.has(m)) m.dispose();
    for (const t of this.textures.values()) { t.albedo.dispose(); t.normal.dispose(); }
    for (const t of this.scanned.values()) { t.albedo.dispose(); t.normal.dispose(); t.arm.dispose(); }
    for (const t of this.foliage.values()) t.dispose();
    this.weatherMaterials.clear(); this.clones.clear(); this.foliage.clear(); this.scanned.clear(); this.cache.clear(); this.textures.clear();
  }
  tintOf(name: MatName): [number, number, number] { return SPECS[name].tint; }
  water(): Nullable<PBRMaterial> { return this.cache.get('water') ?? null; }
}
