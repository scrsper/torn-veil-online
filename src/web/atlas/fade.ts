import { MaterialPluginBase, Mesh, PBRMaterial, StandardMaterial, type Material } from '@babylonjs/core';

/** Screen-door fading preserves opaque depth and hardware instances. No material
 * or geometry clone per prop, no alpha blend ordering, and no collision effect. */
class AtlasFade extends MaterialPluginBase {
  constructor(material: Material) { super(material, 'AtlasFade', 210, { ATLAS_FADE: true }); this._enable(true); }
  getClassName() { return 'AtlasFade'; }
  getAttributes(attributes: string[]) { attributes.push('atlasFade'); }
  getCustomCode(shader: string): Record<string, string> {
    return shader === 'vertex' ? {
      CUSTOM_VERTEX_DEFINITIONS: 'varying float vAtlasFade;\n#ifdef INSTANCES\nattribute float atlasFade;\n#endif',
      CUSTOM_VERTEX_MAIN_BEGIN: 'vAtlasFade = 1.0;\n#ifdef INSTANCES\nvAtlasFade = atlasFade;\n#endif',
    } : {
      CUSTOM_FRAGMENT_DEFINITIONS: 'varying float vAtlasFade;',
      CUSTOM_FRAGMENT_MAIN_BEGIN: 'if (vAtlasFade < 0.999) { float atlasNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (atlasNoise > vAtlasFade) discard; }',
    };
  }
}

export function prepareAtlasFade(mesh: Mesh, materials: Set<Material>) {
  const material = mesh.material;
  if (!(material instanceof PBRMaterial) && !(material instanceof StandardMaterial)) return;
  if (!materials.has(material)) { new AtlasFade(material); materials.add(material); }
  mesh.registerInstancedBuffer('atlasFade', 1);
  mesh.instancedBuffers.atlasFade = 1;
}
