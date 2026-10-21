import { Color3, MaterialPluginBase, Mesh, PBRMaterial, RawTexture, Texture, VertexData, type AbstractEngine, type Material, type Scene, type SubMesh, type UniformBuffer } from '@babylonjs/core';
import { loadScannedMaps } from '../render/materials';
import { terrainHeight, type TownLayout } from '../../sim/town/layout';
import type { GroundMask } from '../../sim/town/groundMask';

/** Splat plugin: grass, worn earth and cobbles (CC0 scans) blended by the town's ground mask in
 * world space, with large-scale tonal variation so the meadow never reads as one flat tile.
 * Cobbles also bend the shading normal. Runs before lighting, so shadows and fog apply as usual. */
class TownSplat extends MaterialPluginBase {
  constructor(material: Material, private maps: { grass: Texture; dirt: Texture; cobble: Texture; cobbleN: Texture; mask: Texture }, private rect: [number, number, number, number]) {
    super(material, 'TownSplat', 200, { TOWNSPLAT: false }); this._enable(true);
  }
  override prepareDefines(defines: Record<string, unknown>) { defines.TOWNSPLAT = true; }
  override getClassName() { return 'TownSplat'; }
  override getSamplers(samplers: string[]) { samplers.push('splatGrass', 'splatDirt', 'splatCobble', 'splatCobbleN', 'splatMask'); }
  override getUniforms() { return { ubo: [{ name: 'splatRect', size: 4, type: 'vec4' }], fragment: '#ifdef TOWNSPLAT\nuniform vec4 splatRect;\n#endif' }; }
  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _sub: SubMesh) {
    ubo.updateFloat4('splatRect', ...this.rect);
    ubo.setTexture('splatGrass', this.maps.grass); ubo.setTexture('splatDirt', this.maps.dirt); ubo.setTexture('splatCobble', this.maps.cobble); ubo.setTexture('splatCobbleN', this.maps.cobbleN); ubo.setTexture('splatMask', this.maps.mask);
  }
  override getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TOWNSPLAT
uniform sampler2D splatGrass, splatDirt, splatCobble, splatCobbleN, splatMask;
#endif`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `#ifdef TOWNSPLAT
{
  vec2 wp = vPositionW.xz;
  vec4 m = texture2D(splatMask, (wp - splatRect.xy) / splatRect.zw);
  vec3 g1 = toLinearSpace(texture2D(splatGrass, wp / 2.6).rgb), g2 = toLinearSpace(texture2D(splatGrass, wp / 7.3 + .37).rgb);
  vec3 grass = mix(g1, g2, .35);
  float macro = toLinearSpace(texture2D(splatDirt, wp / 61.).rgb).g;
  grass *= mix(vec3(1.08, 1.0, .82), vec3(.72, .86, .62), m.b) * (.82 + macro * 1.1);
  vec3 dirt = toLinearSpace(texture2D(splatDirt, wp / 3.1).rgb) * vec3(1.05, .98, .9);
  vec3 cob = toLinearSpace(texture2D(splatCobble, wp / 2.4).rgb) * vec3(1.06, 1.0, .94);
  float d = m.r, c = m.g;
  vec3 base = mix(grass, dirt, smoothstep(.15, .85, d + (g1.g - .2) * .6));
  surfaceAlbedo = mix(base, cob, smoothstep(.35, .65, c)) * surfaceAlbedo;
  vec3 cn = texture2D(splatCobbleN, wp / 2.4).rgb * 2. - 1.;
  normalW = normalize(mix(normalW, normalize(vec3(cn.x, cn.z * 1.4, cn.y)), smoothstep(.35, .65, c) * .7));
}
#endif`,
    };
  }
}
export function buildGround(scene: Scene, layout: TownLayout, mask: GroundMask, opts: { extent: number; cell: number }): Mesh {
  const n = Math.round(opts.extent / opts.cell), half = opts.extent / 2, cx = layout.bounds.x, cz = layout.bounds.z + 60;
  const positions: number[] = [], indices: number[] = [], colours: number[] = [];
  for (let k = 0; k <= n; k++) for (let i = 0; i <= n; i++) {
    const x = cx - half + i * opts.cell, z = cz - half + k * opts.cell, y = terrainHeight(x, z);
    positions.push(x, y, z);
    // Rim hills fade toward a cooler, darker tone (forest floor under the pines) — aerial depth.
    const r = Math.hypot(x - layout.bounds.x, z - layout.bounds.z), far = Math.min(1, Math.max(0, (r - layout.bounds.r + 30) / 80));
    colours.push(1 - far * .25, 1 - far * .18, 1 - far * .22, 1);
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) { const a = k * (n + 1) + i; indices.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1); }
  const mesh = new Mesh('town-ground', scene), vd = new VertexData(), normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: true });
  Object.assign(vd, { positions, indices, normals, colors: colours }); vd.applyToMesh(mesh);
  const grass = loadScannedMaps(scene, 'grass_ground'), dirt = loadScannedMaps(scene, 'brown_mud'), cobble = loadScannedMaps(scene, 'cobblestone_floor_08');
  const maskTex = RawTexture.CreateRGBATexture(mask.data, mask.n, mask.n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  maskTex.wrapU = maskTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const m = new PBRMaterial('town-ground', scene);
  m.albedoColor = Color3.White(); m.metallic = 0; m.roughness = .95; m.environmentIntensity = .55;
  m.bumpTexture = grass.normal; m.bumpTexture.level = .8; m.invertNormalMapY = true;
  // Ground UVs are world metres (u = x, v = z) so the grass normal tiles at the scan's scale.
  const uv: number[] = []; for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] / 2.6, positions[i + 2] / 2.6);
  mesh.setVerticesData('uv', uv);
  new TownSplat(m, { grass: grass.albedo, dirt: dirt.albedo, cobble: cobble.albedo, cobbleN: cobble.normal, mask: maskTex }, [mask.x0, mask.z0, mask.size, mask.size]);
  grass.arm.dispose(); dirt.normal.dispose(); dirt.arm.dispose(); cobble.arm.dispose();
  mesh.material = m; mesh.receiveShadows = true; mesh.isPickable = true; mesh.metadata = { ground: true };
  mesh.freezeWorldMatrix();
  return mesh;
}
