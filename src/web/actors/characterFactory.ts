import { AbstractMesh, Material, Mesh, MultiMaterial, Node, PBRMaterial, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { Atmosphere } from '../world/atmosphere';
import type { ActorState, BodyVisual } from './actorManager';
import { CharacterRig, KitAsset } from './characterRig';
import { CharacterMaterials } from './characterMaterials';
import { realize, type KitId, type Realization } from './appearanceMap';
import type { AppearanceDescription, BodyState, ProjectedAppearance } from '../net/messages';
import { Animator } from './animator';
import { CHARACTER_KITS } from '../presentation/library';

/**
 * Loads the three body kits once and turns a realised appearance into a posed, lit, shadow-casting
 * character: only the parts the appearance calls for are cloned from the kit, materials are built
 * for that person, face morphs are blended, and stature/build scale the model. The visual it returns
 * plugs into ActorManager as a BodyVisual; its Animator poses bones from server state.
 */
const KIT_FILES: Record<KitId, string> = CHARACTER_KITS;
const TOP_PREFIX = /^(G_|Foot_|Hair_|Hat_|Ornament_|Accessory_|Hero_)/;
const baseName = (n: string) => n.replace(/_primitive\d+$/, '');

export class CharacterFactory {
  private readonly kits = new Map<KitId, KitAsset>();
  private counter = 0;
  async load(scene: Scene, onProgress?: (done: number, total: number) => void, only?: KitId[]): Promise<void> {
    const ids = (only ?? (Object.keys(KIT_FILES) as KitId[]));
    let done = 0;
    await Promise.all(ids.map(async id => { try { this.kits.set(id, await KitAsset.load(scene, KIT_FILES[id], `kit_${id}`)); } catch (e) { console.warn(`[tv] kit ${id} failed to load`, e); } finally { onProgress?.(++done, ids.length); } }));
  }
  get ready(): boolean { return this.kits.size > 0; }
  has(kit: KitId): boolean { return this.kits.has(kit); }

  create(scene: Scene, atmosphere: Atmosphere, id: string, r: Realization, opts: { own?: boolean; hero?: boolean } = {}): CharacterVisual | null {
    const kit = this.kits.get(r.kit) ?? this.kits.get('f') ?? [...this.kits.values()][0];
    if (!kit) return null;
    const name = `ch${++this.counter}`;
    const keep = new Set(r.parts);
    const rig = new CharacterRig(kit, scene, name, entity => {
      if (!(entity instanceof Node)) return true;
      const n = baseName((entity.name ?? '').replace(/^.*?\./, ''));
      if (TOP_PREFIX.test(n)) return keep.has(n);
      return true;
    });
    const mats = new CharacterMaterials(scene, name, r.materials);
    const orphans = new Set<Material>();   // the kit's per-instance material clones, replaced below and never used again
    for (const p of rig.parts) {
      const m = p.mesh as Mesh; m.receiveShadows = true; m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.material && this.reskin(m, mats, orphans);
      if (!/^Hair_|^Hat_|^Accessory_|^Ornament_|^EyeL|^EyeR/.test(p.name) || /^Hair_/.test(p.name)) atmosphere.addCaster(m);
    }
    for (const o of orphans) o.dispose(false, false);
    for (const [k, v] of Object.entries(r.morphs)) rig.setMorph(k, v);
    rig.root.scaling.set(r.heightScale * r.buildScale, r.heightScale, r.heightScale * r.buildScale);
    return new CharacterVisual(rig, mats, r, atmosphere, kit === this.kits.get('c') ? 1.22 * r.heightScale : (r.kit === 'm' ? 1.78 : 1.66) * r.heightScale);
  }

  private reskin(mesh: Mesh, mats: CharacterMaterials, orphans: Set<Material>): void {
    const mat = mesh.material;
    if (mat instanceof MultiMaterial) {
      const multi = new MultiMaterial(`${mesh.name}.multi`, mesh.getScene());
      for (const sub of mat.subMaterials) { const rep = sub ? mats.bySlot.get(baseSlot(sub.name)) : undefined; multi.subMaterials.push(sub ? rep ?? sub : null); if (sub && rep) orphans.add(sub); else if (sub instanceof PBRMaterial) mats.adaptImported(sub); }
      mesh.material = multi; orphans.add(mat);
    } else if (mat) { const rep = mats.bySlot.get(baseSlot(mat.name)); if (rep) { mesh.material = rep; orphans.add(mat); } else if (mat instanceof PBRMaterial) mats.adaptImported(mat); }
  }
}
const baseSlot = (n: string) => { const m = /TV_[A-Za-z]+/.exec(n); return m ? m[0] : n; };

export class CharacterVisual implements BodyVisual {
  readonly root: TransformNode;
  readonly animator: Animator;
  headHeight: number;
  /** Height of the eyes above the feet (portrait and look-at framing). */
  readonly eyeHeight: number; readonly bodyHeight: number;
  constructor(readonly rig: CharacterRig, readonly mats: CharacterMaterials, readonly realization: Realization, private readonly atmosphere: Atmosphere, height: number) {
    this.root = rig.root; this.headHeight = height + 0.18; this.eyeHeight = height * 0.925; this.bodyHeight = height;
    this.animator = new Animator(rig, realization);
  }
  update(dt: number, s: ActorState): void { this.animator.update(dt, s); }
  dispose(): void {
    for (const p of this.rig.parts) this.atmosphere.removeCaster(p.mesh);
    this.rig.dispose(); this.mats.dispose();
  }
}

export function makeRealization(body: BodyState | undefined, id: string): Realization {
  const app = body?.appearance as ProjectedAppearance | undefined;
  const desc = (body?.embodiment?.appearance?.description ?? app?.description) as AppearanceDescription | undefined;
  return realize(id, desc, app);
}
export { Vector3, AbstractMesh, PBRMaterial };
