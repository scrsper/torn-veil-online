import { AbstractMesh, Color3, MultiMaterial, PBRMaterial, Texture, TransformNode, type AssetContainer, type BaseTexture, type InstantiatedEntries, type Material, type MorphTargetManager, type Scene } from '@babylonjs/core';
import { StudioSurface } from './studioMaterials';

export type StudioSex = 'female' | 'male';
/** Covered composition order; the body owns the canonical joints. OriginalSkin is never a part. */
export const STUDIO_PARTS = ['body', 'pants', 'boots', 'head', 'hair'] as const;
export type StudioPart = typeof STUDIO_PARTS[number];

/** Game (UE-mannequin) bone names used by Retargeter, FootPlant, SharedGaze and
 * EquipmentVisual, mapped onto the studio's biped joints. Toes come from pants/boots. */
export const STUDIO_BONE_ALIASES: Readonly<Record<string, string>> = (() => {
  const a: Record<string, string> = { pelvis: 'Bip001-Pelvis', spine_01: 'Bip001-Spine', spine_02: 'Bip001-Spine1', spine_03: 'Bip001-Spine2', neck_01: 'Bip001-Neck', head: 'Bip001-Head' };
  for (const [s, S] of [['l', 'L'], ['r', 'R']] as const) {
    Object.assign(a, { [`clavicle_${s}`]: `Bip001-${S}-Clavicle`, [`upperarm_${s}`]: `Bip001-${S}-UpperArm`, [`lowerarm_${s}`]: `Bip001-${S}-Forearm`, [`hand_${s}`]: `Bip001-${S}-Hand`,
      [`thigh_${s}`]: `Bip001-${S}-Thigh`, [`calf_${s}`]: `Bip001-${S}-Calf`, [`foot_${s}`]: `Bip001-${S}-Foot`, [`ball_${s}`]: `Bip001-${S}-Toe0` });
    ['thumb', 'index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
      a[`${f}_01_${s}`] = `Bip001-${S}-Finger${i}`; a[`${f}_02_${s}`] = `Bip001-${S}-Finger${i}1`; a[`${f}_03_${s}`] = `Bip001-${S}-Finger${i}2`;
    });
  }
  return Object.freeze(a);
})();
/** Bones without which the shared motion, contact and grip paths cannot run. */
export const STUDIO_REQUIRED_BONES = Object.freeze(['pelvis', 'spine_01', 'spine_03', 'neck_01', 'head', ...['l', 'r'].flatMap(s =>
  ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball', 'index_01', 'middle_01', 'pinky_01'].map(b => `${b}_${s}`))]);

export type StudioSlotRole = 'skin' | 'cloth' | 'eye' | 'hair' | 'eye-ao' | 'eye-tear';
/** Material extras distinguish mask overlays from ordinary diffuse textures. */
export function studioSlotRole(material: Pick<Material, 'name' | 'metadata'> | null | undefined): StudioSlotRole {
  const slot: unknown = material?.metadata?.gltf?.extras?.slot, name = material?.name ?? '';
  if (slot === 'Eye_Tear' || /Eye.*Tear/i.test(name)) return 'eye-tear';
  if (slot === 'Eye_AO' || /Eye_?AO/i.test(name)) return 'eye-ao';
  if (slot === 'Eye_L' || slot === 'Eye_R' || /_Eye$/.test(name)) return 'eye';
  if (/Hair/i.test(name)) return 'hair';
  if (slot === 'Body' || slot === 'Head' || /_Head_\d+$|BaseBody$|Naked$/.test(name)) return 'skin';
  return 'cloth';
}

/** Babylon material adaptation of the imported glTF PBR. An approximation of the studio's
 * custom skin/iris/hair shaders, not an equivalent; applied once to shared container materials. */
export async function adaptStudioMaterials(container: AssetContainer, textureBase?: string): Promise<Record<StudioSlotRole, number>> {
  const counts: Record<StudioSlotRole, number> = { skin: 0, cloth: 0, eye: 0, hair: 0, 'eye-ao': 0, 'eye-tear': 0 };
  const textureLoads: Promise<void>[] = [];
  for (const m of container.materials) {
    const role = studioSlotRole(m); counts[role]++;
    if (!(m instanceof PBRMaterial)) continue;
    m.metallic = 0;
    if (role === 'hair') {
      if (textureBase) {
        const sourceName = m.metadata?.gltf?.extras?.textures?.DIRO;
        if (sourceName !== 'T_Hair_03_DIRO') throw Error('Unpinned studio hair mask: ' + sourceName);
        let loaded!: () => void, failed!: (message?: string) => void;
        textureLoads.push(new Promise<void>((resolve, reject) => { loaded = resolve; failed = message => reject(Error('Studio DIRO texture failed: ' + message)); }));
        const map = new Texture(textureBase + sourceName + '.png', container.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE, loaded, failed);
        map.gammaSpace = false; map.hasAlpha = true; map.vScale = .5;
        m.albedoTexture = map; container.textures.push(map);
      }
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = .18; m.backFaceCulling = false; m.useAlphaFromAlbedoTexture = true;
      m.albedoColor = Color3.FromHexString('#34261f').toLinearSpace(); m.roughness = .35;
    } else if (role === 'skin') {
      m.subSurface.isTranslucencyEnabled = true; m.subSurface.translucencyIntensity = .05;
      m.subSurface.minimumThickness = .005; m.subSurface.maximumThickness = .02;
    } else if (role === 'eye') {
      m.roughness = .18; m.clearCoat.isEnabled = true; m.clearCoat.intensity = .65; m.clearCoat.roughness = .12; m.indexOfRefraction = 1.336;
    } else if (role === 'eye-ao' || role === 'eye-tear') {
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; m.disableDepthWrite = true; m.roughness = role === 'eye-tear' ? .12 : .8;
    }
    if (['eye', 'eye-ao', 'eye-tear'].includes(role) && m.albedoTexture) m.albedoTexture.gammaSpace = false;
  }
  await Promise.all(textureLoads);
  return counts;
}

export interface StudioRig {
  tag: string;
  holder: TransformNode;
  /** Game bone names (STUDIO_BONE_ALIASES) onto this instance's canonical joints. */
  nodes: Map<string, TransformNode>;
  /** Every canonical joint by source name, including head-only face joints. */
  joints: Map<string, TransformNode>;
  meshes: AbstractMesh[];
  missingBones: string[];
  composition: { part: StudioPart; meshes: number; linkedBones: number; adoptedJoints: number }[];
  dispose(): void;
}

const depth = (n: TransformNode) => { let d = 0, p = n.parent; while (p) { d++; p = p.parent; } return d; };

/**
 * One independent clothed character: every part instantiated with its own nodes, skeleton
 * clones and morph managers. Later parts' bones are linked to the body's same-named joints;
 * joints only a part carries (toes, face) are adopted beneath their canonical parent.
 */
export function composeStudioRig(scene: Scene, tag: string, parts: readonly { part: StudioPart; container: AssetContainer }[]): StudioRig {
  if (parts[0]?.part !== 'body') throw Error('Studio composition requires the body first');
  const holder = new TransformNode(tag, scene), joints = new Map<string, TransformNode>(), entries: InstantiatedEntries[] = [];
  const ownedMorphs = new Set<MorphTargetManager>(), ownedMaterials = new Map<Material, Material>(), ownedTextures = new Set<BaseTexture>(), composition: StudioRig['composition'] = [];
  const ownMaterial = (source: Material | null): Material | null => {
    if (!source) return null;
    const prior = ownedMaterials.get(source); if (prior) return prior;
    const clone = source.clone(`${tag}.${source.name}`); if (!clone) throw Error('Cannot clone studio material: ' + source.name);
    clone.metadata = source.metadata;
    ownedMaterials.set(source, clone);
    // PBR clones texture wrappers (the underlying GPU image is reference counted).
    // Own/dispose those wrappers too, while leaving template/shared textures alive.
    const sourceTextures = new Set(source.getActiveTextures());
    for (const texture of clone.getActiveTextures()) if (!sourceTextures.has(texture)) ownedTextures.add(texture);
    if (clone instanceof MultiMaterial && source instanceof MultiMaterial) clone.subMaterials = source.subMaterials.map(ownMaterial);
    if (clone instanceof PBRMaterial && ['eye', 'hair', 'eye-ao', 'eye-tear'].includes(studioSlotRole(source))) new StudioSurface(clone, studioSlotRole(source));
    return clone;
  };
  for (const { part, container } of parts) {
    const prefix = `${tag}.${part}.`, strip = (name: string) => name.startsWith(prefix) ? name.slice(prefix.length) : name;
    const e = container.instantiateModelsToScene(n => prefix + n, false, { doNotInstantiate: true });
    entries.push(e); for (const r of e.rootNodes) r.parent = holder;
    for (const g of e.animationGroups) g.stop();
    const own = e.skeletons.flatMap(s => s.bones.map(b => ({ bone: b, node: b.getTransformNode() })).filter((x): x is { bone: typeof x.bone; node: TransformNode } => !!x.node));
    let linked = 0, adopted = 0;
    if (part === 'body') for (const { node } of own) joints.set(strip(node.name), node);
    else {
      const duplicates = new Set<TransformNode>();
      for (const { bone, node } of own) { const canonical = joints.get(strip(node.name)); if (canonical) { bone.linkTransformNode(canonical); duplicates.add(node); linked++; } }
      // Only joints whose parent was a duplicate need re-homing; deeper ones follow their parent.
      for (const { node } of own.filter(x => !duplicates.has(x.node)).sort((a, b) => depth(a.node) - depth(b.node))) {
        const parent = node.parent as TransformNode | null, canonicalParent = parent && duplicates.has(parent) ? joints.get(strip(parent.name)) : null;
        if (canonicalParent) node.parent = canonicalParent;
        joints.set(strip(node.name), node); adopted++;
      }
      // Deepest first; any remaining non-duplicate child is re-homed before its duplicate parent goes.
      for (const node of [...duplicates].sort((a, b) => depth(b) - depth(a))) {
        for (const child of node.getChildren()) if (child instanceof TransformNode) child.parent = joints.get(strip(node.name)) ?? holder;
        node.dispose(true);
      }
    }
    const meshes = e.rootNodes.flatMap(r => [r, ...r.getDescendants(false)]).filter((n): n is AbstractMesh => n instanceof AbstractMesh);
    for (const m of meshes) {
      m.material = ownMaterial(m.material);
      const source = container.meshes.find(s => prefix + s.name === m.name);
      if (m.morphTargetManager && (m.morphTargetManager === source?.morphTargetManager)) m.morphTargetManager = m.morphTargetManager.clone();
      if (m.morphTargetManager) ownedMorphs.add(m.morphTargetManager);
      const materials = m.material instanceof MultiMaterial ? m.material.subMaterials : [m.material];
      m.metadata = { ...m.metadata, studioNoShadow: materials.every(mat => ['hair', 'eye-ao', 'eye-tear'].includes(studioSlotRole(mat))) };
      m.isPickable = false; m.alwaysSelectAsActiveMesh = true;
    }
    composition.push({ part, meshes: meshes.filter(m => m.getTotalVertices() > 0).length, linkedBones: linked, adoptedJoints: adopted });
  }
  const nodes = new Map<string, TransformNode>(), missingBones: string[] = [];
  for (const [game, source] of Object.entries(STUDIO_BONE_ALIASES)) { const n = joints.get(source); if (n) nodes.set(game, n); else missingBones.push(game); }
  const meshes = holder.getChildMeshes(false).filter(m => m.getTotalVertices() > 0 && m.isEnabled(false));
  holder.metadata = { studioRig: { tag, composition, missingBones } };
  let disposed = false;
  return { tag, holder, nodes, joints, meshes, missingBones, composition, dispose: () => {
    if (disposed) return; disposed = true;
    for (const e of entries) { for (const g of e.animationGroups) g.dispose(); for (const k of e.skeletons) k.dispose(); }
    holder.dispose(false, false); for (const t of ownedMorphs) t.dispose();
    for (const m of ownedMaterials.values()) m.dispose(false, false);
    for (const t of ownedTextures) t.dispose();
  } };
}
