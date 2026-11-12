import { MaterialPluginBase, type PBRMaterial } from '@babylonjs/core';

/** Source-aware WebGL PBR adapter. Equations follow the supplied studio's eyeMaterial,
 * eyeOverlay and DIRO hair shading; skin lighting remains Babylon PBR, not Three parity.
 * Install on each owned clone. Textures are immutable shared resources.
 */
export class StudioSurface extends MaterialPluginBase {
  constructor(material: PBRMaterial, role: string) {
    super(material, 'StudioSurface', 200, {
      STUDIO_EYE: role === 'eye', STUDIO_HAIR: role === 'hair',
      STUDIO_EYE_AO: role === 'eye-ao', STUDIO_TEAR: role === 'eye-tear',
    }, true, true);
    this.doNotSerialize = true;
  }
  override getClassName(): string { return 'StudioSurface'; }
  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    return { CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
#ifdef ALBEDO
#ifdef STUDIO_EYE
vec2 studioIrisUV = (vAlbedoUV - vec2(0.5)) / 0.40 + vec2(0.5);
float studioRadius = length(studioIrisUV - vec2(0.5));
vec3 studioMask = texture2D(albedoSampler, studioIrisUV).rgb;
float studioGrain = clamp(studioMask.g * 0.8 + studioMask.r * 0.2, 0.0, 1.0);
vec3 studioIris = mix(vec3(0.035, 0.018, 0.009), vec3(0.28, 0.15, 0.055), studioGrain);
studioIris = mix(vec3(0.002), studioIris, smoothstep(0.095, 0.115, studioRadius));
surfaceAlbedo = vAlbedoColor.rgb * mix(studioIris, vec3(0.82, 0.79, 0.74), smoothstep(0.44, 0.48, studioRadius));
#endif
#ifdef STUDIO_HAIR
// The imported KHR_texture_transform already halves V. Do not halve it twice.
surfaceAlbedo = mix(vAlbedoColor.rgb, vec3(0.14, 0.065, 0.028), clamp(albedoTexture.b, 0.0, 1.0)) * mix(0.65, 1.35, clamp(albedoTexture.g, 0.0, 1.0));
alpha = vAlbedoColor.a * clamp(pow(max(albedoTexture.a, 0.0), 0.66), 0.0, 1.0);
#endif
#ifdef STUDIO_EYE_AO
surfaceAlbedo = vec3(0.0);
alpha = vAlbedoColor.a * clamp(max(albedoTexture.r * 0.4, max(albedoTexture.g * 0.7, albedoTexture.b * 0.7)), 0.0, 1.0);
#endif
#ifdef STUDIO_TEAR
surfaceAlbedo = vec3(1.0, 0.908761, 0.747839);
alpha = vAlbedoColor.a * albedoTexture.b * 0.4;
#endif
#endif
` };
  }
}
