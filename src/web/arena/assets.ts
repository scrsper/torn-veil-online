import '@babylonjs/loaders/glTF';
import { Animation, AssetContainer, Color3, Matrix, Mesh, MultiMaterial, PBRMaterial, type Material, type MorphTargetManager, Quaternion, SceneLoader, TransformNode, Vector3, type AbstractMesh, type AnimationGroup, type Scene } from '@babylonjs/core';
import { MIXAMO, UE, Retargeter, instantiateClips, type ClipTemplate, type Grip } from './retarget';
import type { LookId } from './looks';
import { SpringBones } from './springs';
import { READY_CLIPS } from './combat';
import { CATALOG_RENDER_VARIANTS, SHIELD_GRIP_BAR_DEPTH, type PartBounds } from '../items/physicalFit';
import { CREATOR_BODIES, CREATOR_CHANNELS, creatorAppearance, isCreatorLook, type CreatorIdentity, type CreatorLook } from '../actors/creatorAppearance';
import { refineImportedHumanMaterial } from '../actors/characterMaterials';
import { humanAssetPath } from '../presentation/library';

/** Directional walks used as a legs-only layer while guarding or aiming. */
export const STRAFE_CLIPS = ['unarmed/walk_forward', 'unarmed/walk_backward', 'unarmed/walk_strafe_left', 'unarmed/walk_strafe_right'];
/** Cast folder: stylised low-poly people (art/tools/arena/build_arena_stylized.py). */
const PEOPLE_DIR = 'people_flat/';
const springsFor = (nodes: Map<string, TransformNode>) => { const s = new SpringBones(nodes, HUMAN_SCALE); return s.active ? s : undefined; };
/** MPFB people are ~1.75 m; the arena was laid out around 2.2-unit fighters, so people are scaled to match. */
export const HUMAN_SCALE = 1.22;

/**
 * Combat Arena assets: CC0 KayKit characters, weapons and dungeon props (Kay Lousberg), built by
 * scripts/web/arena/build-arena.mjs into web/public/arena. Props were pre-fractured in Blender.
 */
/** KayKit rigs: now only the animation source for the human fighters. */
export type CharacterKind = 'skeleton_warrior';


export interface CharacterInstance {
  root: TransformNode;
  anims: Map<string, AnimationGroup>;
  meshes: AbstractMesh[];
  slotR: TransformNode;
  slotL: TransformNode;
  /** Left-hand shield grip: the KayKit hand slot the CC0 shields were authored for, retargeted onto this hand. */
  slotShield?: TransformNode;
  chest: TransformNode | null;
  /** Meshes parented to a hand slot or head, by original name (weapons, shields, helmets). */
  gear: Map<string, AbstractMesh>;
  /** Skeleton nodes by bone name (humans only), for IK touch-ups. */
  bones?: Map<string, TransformNode>;
  /** Ankle heights in the unscaled bind pose, captured before clips can move the rig. */
  bindAnkleHeights?: [number, number];
  /** Coat-tail and hair secondary motion (stylised people). */
  springs?: SpringBones;
  dispose(): void;
}

export class ArenaAssets {
  private chars = new Map<CharacterKind, AssetContainer>();
  props!: AssetContainer;
  weapons!: AssetContainer;
  /** Disabled source meshes by node name (P_*, F_*, L_*, W_*). */
  readonly sources = new Map<string, Mesh>();
  /** Chunk centre relative to its prop's base, in the prop's frame. */
  readonly offsets = new Map<string, Vector3>();
  private serial = 0;
  constructor(private readonly scene: Scene,private options:{base?:string;detailedHumans?:boolean;itemsBase?:string}={}) {}
  private get base(){return this.options.base??'./arena/';}

  async load(kinds: CharacterKind[], progress: (t: string) => void): Promise<void> {
    const load = (file: string) => SceneLoader.LoadAssetContainerAsync(this.base, file, this.scene);
    progress('Loading props');
    [this.props, this.weapons] = await Promise.all([load('props.glb'), load('weapons.glb')]);
    for (const c of [this.props, this.weapons]) {
      c.addAllToScene();
      for (const m of c.meshes) {
        if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
        // Bake the glTF root conversion into each source so instances can be parented freely.
        const world = m.computeWorldMatrix(true).clone();
        m.setParent(null); m.position.setAll(0); m.rotationQuaternion = null; m.rotation.setAll(0); m.scaling.setAll(1);
        m.bakeTransformIntoVertices(world);
        if (m.name.startsWith('F_')) {
          // Chunks pivot about their own centre; remember where that centre sits relative to the prop base.
          m.refreshBoundingInfo(); const c = m.getBoundingInfo().boundingBox.center.clone();
          m.bakeTransformIntoVertices(Matrix.Translation(-c.x, -c.y, -c.z));
          this.offsets.set(m.name, c);
        }
        m.refreshBoundingInfo();
        m.setEnabled(false); m.isPickable = false;
        this.sources.set(m.name, m);
      }
      for (const n of c.transformNodes) n.dispose();
      for (const m of c.meshes) if (!this.sources.has(m.name) && m.name === '__root__') m.dispose();
    }
    let i = 0;
    for (const k of kinds) {
      progress(`Loading fighters ${++i}/${kinds.length}`);
      this.chars.set(k, await load(`${k}.glb`));
    }
  }

  // ---- Realistic MPFB people driven by retargeted KayKit combat clips -----------------------
  private people = new Map<LookId, AssetContainer>();
  readonly clips = new Map<string, ClipTemplate>();
  private gripR!: Grip; private gripL!: Grip; private gripShield: Grip | null = null;

  /** Load the people (art/tools/arena/build_arena_people.py) and bake every combat clip onto their skeleton. */
  /** Clip names fighters need; null = bake and instantiate everything (measurement mode). */
  used: Set<string> | null = null;
  /** False when the local Mixamo clip file is absent and KayKit stand-ins are playing. */
  mocap = true;

  /** Per creator look: loaded, or why not (explicit; never replaced by another look). */
  readonly creatorStatus = new Map<CreatorLook, { loaded: boolean; reason: string; ownBake?: boolean; maxRestDeltaRad?: number }>();
  /** Clip sets baked on a creator rig whose rest pose differs from the reference rig. */
  private lookClips = new Map<LookId, Map<string, ClipTemplate>>();
  private lookGrips = new Map<LookId, { r: Grip; l: Grip; shield: Grip | null }>();

  async loadHumans(looks: LookId[], progress: (t: string) => void): Promise<void> {
    let n = 0;
    await Promise.all(looks.map(async l => {
      let c: AssetContainer;
      if (isCreatorLook(l)) {
        // Staged byte-for-byte from tools/ontology by `npm run web:creator` (hash-checked; see creator/creator.json).
        try { c = await SceneLoader.LoadAssetContainerAsync(this.base, humanAssetPath(l), this.scene); }
        catch (e) { this.creatorStatus.set(l, { loaded: false, reason: `creator/${CREATOR_BODIES[l].file} not staged (npm run web:creator): ${String(e).slice(0, 120)}` }); console.warn('[arena] creator body missing', l); progress(`Loading people ${++n}/${looks.length}`); return; }
        this.creatorStatus.set(l, { loaded: true, reason: `${CREATOR_BODIES[l].assetId} (${CREATOR_BODIES[l].sex}, ${CREATOR_BODIES[l].nativeHeightM} m)` });
      } else c = await SceneLoader.LoadAssetContainerAsync(this.base, humanAssetPath(l, this.options.detailedHumans !== false), this.scene);
      // Hair, brows and lashes export as BLEND; alpha-test them so they sort with the head.
      for (const m of c.materials) if (m instanceof PBRMaterial && m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHABLEND) {
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = .45; m.backFaceCulling = false;
      }
      for (const material of c.materials) if (material instanceof PBRMaterial) refineImportedHumanMaterial(material, this.scene);
      this.people.set(l, c); progress(`Loading people ${++n}/${looks.length}`);
    }));
    progress('Teaching the fighters to fight');
    const ref = this.person('ranger');
    this.refPelvis = ref.nodes.get('pelvis')!.position.length();
    // Bake targets: the reference rig, plus each loaded creator rig, always with its own bake and grips from the same
    // existing clips. Equal local rest rotations would not prove equal bone directions, lengths or hip height, so the
    // reference templates are never reused for them. The rest delta is kept only as a diagnostic.
    type Target = { look: LookId | null; rig: ReturnType<ArenaAssets['person']>; clips: Map<string, ClipTemplate> };
    const targets: Target[] = [{ look: null, rig: ref, clips: this.clips }];
    for (const l of looks) if (isCreatorLook(l) && this.people.has(l)) {
      const rig = this.person(l), st = this.creatorStatus.get(l)!;
      st.maxRestDeltaRad = +restDelta(ref.nodes, rig.nodes).toFixed(4); st.ownBake = true;
      const clips = new Map<string, ClipTemplate>(); targets.push({ look: l, rig, clips }); this.lookClips.set(l, clips);
    }
    const fallbacks = new Set(this.used ? [...this.used].map(kaykitFallback) : []);
    const src = this.character('skeleton_warrior');
    const srcNodes = new Map(src.root.getChildTransformNodes(false).map(x => [x.name.slice(x.name.indexOf('.') + 1), x] as const));
    for (const t of targets) {
      const rt = new Retargeter({ space: src.root, nodes: srcNodes }, { space: t.rig.holder, nodes: t.rig.nodes });
      for (const [name, g] of src.anims) if (!this.used || this.used.has(name) || fallbacks.has(name)) t.clips.set(name, rt.bake(name, g));
      // KayKit shields keep their grip at the origin of the rig's hand slot; map that slot onto the human hand.
      const shield = srcNodes.has('handslot.l') && srcNodes.has('hand.l') ? shieldGrip(rt.grip('wrist.l', 'handslot.l', 'hand_l', 'middle_01_l')) : null;
      const grips = { r: handGrip(t.rig.holder, t.rig.nodes, 'r'), l: handGrip(t.rig.holder, t.rig.nodes, 'l'), shield };
      if (t.look) this.lookGrips.set(t.look, grips); else { this.gripR = grips.r; this.gripL = grips.l; this.gripShield = grips.shield; }
    }
    src.dispose();
    // Real motion capture: the user's Mixamo packs (art/tools/arena/build_mixamo_clips.py -> mixamo_clips.glb).
    progress('Learning motion capture');
    let mc: AssetContainer | null = null;
    try { mc = await SceneLoader.LoadAssetContainerAsync(this.base, 'mixamo_clips.glb', this.scene); }
    catch { console.warn('[arena] mixamo_clips.glb missing: using KayKit stand-in motion (see docs/COMBAT_ARENA.md)'); this.mocap = false; }
    if (mc) {
      const me = mc.instantiateModelsToScene(n => `mx.${n}`, false, { doNotInstantiate: true });
      const mh = new TransformNode('mx', this.scene); for (const r of me.rootNodes) r.parent = mh;
      for (const g of me.animationGroups) g.stop();
      const mNodes = new Map(mh.getChildTransformNodes(false).map(x => [x.name.slice(3), x] as const));
      for (const t of targets) {
        const mrt = new Retargeter({ space: mh, nodes: mNodes }, { space: t.rig.holder, nodes: t.rig.nodes }, MIXAMO);
        for (const g of me.animationGroups) { const name = g.name.slice(3); if (!this.used || this.used.has(name)) t.clips.set(name, mrt.bake(name, g)); }
      }
      for (const g of me.animationGroups) g.dispose(); mh.dispose(); mc.dispose();
    }
    // Unarmed brawling set (Motifect via the TRELLIS review rig): build_unarmed_clips.py -> unarmed_clips.glb.
    progress('Learning to brawl');
    let uc: AssetContainer | null = null;
    try { uc = await SceneLoader.LoadAssetContainerAsync(this.base, 'unarmed_clips.glb', this.scene); } catch { console.warn('[arena] unarmed_clips.glb missing: unarmed moves use stand-ins'); }
    if (uc) {
      const ue = uc.instantiateModelsToScene(n => `ua.${n}`, false, { doNotInstantiate: true });
      const uh = new TransformNode('ua', this.scene); for (const r of ue.rootNodes) r.parent = uh;
      for (const g of ue.animationGroups) g.stop();
      const uNodes = new Map(uh.getChildTransformNodes(false).map(x => [x.name.slice(3), x] as const));
      for (const t of targets) {
        const urt = new Retargeter({ space: uh, nodes: uNodes }, { space: t.rig.holder, nodes: t.rig.nodes }, UE);
        for (const g of ue.animationGroups) { const name = 'unarmed/' + g.name.slice(3); if (!this.used || this.used.has(name)) t.clips.set(name, urt.bake(name, g)); }
      }
      for (const g of ue.animationGroups) g.dispose(); uh.dispose(); uc.dispose();
    }
    // Any mocap clip that is unavailable plays its nearest KayKit equivalent.
    for (const t of targets) if (this.used) for (const n of this.used) if (!t.clips.has(n)) { const fb = t.clips.get(kaykitFallback(n)); if (fb) t.clips.set(n, fb); }
    // Ready stance: an upright body with the authored weapon arms and grips (see READY_CLIPS).
    for (const t of targets) for (const [name, [body, arms]] of Object.entries(READY_CLIPS)) {
      const b = t.clips.get(body), a = t.clips.get(arms); if (b && a) t.clips.set(name, layeredClip(name, b, a));
    }
    for (const t of targets) t.rig.dispose();
  }

  private person(look: LookId) {
    const tag = `h${this.serial++}`, creator = isCreatorLook(look);
    // Creator bodies vary per identity (morph and palette), so each gets its own materials and morph managers.
    const e = this.people.get(look)!.instantiateModelsToScene(n => `${tag}.${n}`, creator, { doNotInstantiate: true });
    const holder = new TransformNode(tag, this.scene);
    for (const r of e.rootNodes) r.parent = holder;
    const nodes = new Map(holder.getChildTransformNodes(false).map(x => [x.name.slice(tag.length + 1), x] as const));
    const meshes = holder.getChildMeshes(false);
    // Owned per actor (creator looks only): the cloned materials and morph managers, disposed with the actor. Textures
    // stay shared with the source container and are never disposed here.
    const ownedMaterials = new Set<Material>(), ownedMorphs = new Set<MorphTargetManager>();
    if (creator) {
      const src = this.people.get(look)!, sharedMorphs = new Set(src.meshes.map(m => m.morphTargetManager).filter(Boolean)), sharedMats = new Set<Material>(src.materials);
      for (const m of meshes) {
        if (m.morphTargetManager && sharedMorphs.has(m.morphTargetManager)) m.morphTargetManager = m.morphTargetManager.clone();
        if (m.morphTargetManager) ownedMorphs.add(m.morphTargetManager);
        const mats = m.material instanceof MultiMaterial ? [m.material, ...m.material.subMaterials] : [m.material];
        for (const mat of mats) if (mat && !sharedMats.has(mat)) ownedMaterials.add(mat);
      }
    }
    holder.metadata = { look, owned: { materials: ownedMaterials, morphs: ownedMorphs } };
    for (const m of meshes) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    return { tag, holder, nodes, meshes, dispose: () => {
      for (const g of e.animationGroups) g.dispose(); for (const k of e.skeletons) k.dispose(); holder.dispose(false, false);
      for (const m of ownedMaterials) m.dispose(false, false); for (const t of ownedMorphs) t.dispose();
    } };
  }

  /** Per merged item, each material's loader-baked bounds (after the glTF root conversion), for part-referenced grips. */
  readonly partBounds = new Map<string, Record<string, PartBounds>>();
  /**
   * Project catalog items (web/public/items/v1.1/glb/<id>.glb, metric, tracked in the repo): each merged into one
   * source mesh I_<id> with its authored origin; per-material bounds are recorded before merging.
   */
  async loadCatalogItems(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async key => {
      // A key is I_<catalog id>, or a recorded render variant of one (physicalFit.ts CATALOG_RENDER_VARIANTS).
      const variant = CATALOG_RENDER_VARIANTS[key], id = variant?.sourceId ?? key.replace(/^I_/, '');
      const c = await SceneLoader.LoadAssetContainerAsync(this.options.itemsBase ?? './items/v1.1/glb/', `${id}.glb`, this.scene);
      c.addAllToScene();
      const parts: Mesh[] = [], bounds: Record<string, PartBounds> = {};
      for (const m of c.meshes) {
        if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
        const w = m.computeWorldMatrix(true).clone();
        m.setParent(null); m.position.setAll(0); m.rotationQuaternion = null; m.rotation.setAll(0); m.scaling.setAll(1);
        m.bakeTransformIntoVertices(w); m.refreshBoundingInfo(); parts.push(m);
        const name = m.material?.name ?? m.name, rot = variant?.rotatePart;
        if (rot && name === rot.material) {
          // Turn this part only, about its own bounds centre (in memory; the GLB is untouched).
          const c0 = m.getBoundingInfo().boundingBox.center.clone(), axis = rot.axis === 'x' ? Vector3.Right() : rot.axis === 'y' ? Vector3.Up() : Vector3.Forward();
          m.bakeTransformIntoVertices(Matrix.Translation(-c0.x, -c0.y, -c0.z).multiply(Matrix.RotationAxis(axis, rot.angle)).multiply(Matrix.Translation(c0.x, c0.y, c0.z)));
          m.refreshBoundingInfo();
        }
        const bb = m.getBoundingInfo().boundingBox;
        bounds[name] = { min: [bb.minimum.x, bb.minimum.y, bb.minimum.z], max: [bb.maximum.x, bb.maximum.y, bb.maximum.z] };
      }
      if (variant && !bounds[variant.rotatePart.material]) console.warn(`[arena] render variant ${key}: part ${variant.rotatePart.material} not found in ${id}`);
      const common = parts.map(p => new Set(p.getVerticesDataKinds())).reduce((a, b) => new Set([...a].filter(k => b.has(k))));
      for (const p of parts) for (const kind of p.getVerticesDataKinds()) if (!common.has(kind)) p.removeVerticesData(kind);
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
      merged.name = key.startsWith('I_') ? key : `I_${key}`; merged.setEnabled(false); merged.isPickable = false; merged.refreshBoundingInfo();
      this.sources.set(merged.name, merged); this.partBounds.set(merged.name, bounds);
      for (const n of c.transformNodes) n.dispose();
      for (const m of c.meshes) if (m !== merged && !m.isDisposed()) m.dispose();
    }));
  }

  /** Your arsenal (web/public/arena/arsenal): each multi-part weapon merged into one source mesh W_<key>. */
  async loadArsenal(keys: string[]): Promise<void> {
    await Promise.all(keys.map(async k => {
      const c = await SceneLoader.LoadAssetContainerAsync(this.base + 'arsenal/', `${k}.glb`, this.scene);
      c.addAllToScene();
      const parts: Mesh[] = [];
      for (const m of c.meshes) {
        if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
        const w = m.computeWorldMatrix(true).clone();
        m.setParent(null); m.position.setAll(0); m.rotationQuaternion = null; m.rotation.setAll(0); m.scaling.setAll(1);
        m.bakeTransformIntoVertices(w); parts.push(m);
      }
      // Parts differ in attributes (some carry UVs/tangents, some not); merge on the shared set.
      const common = parts.map(p => new Set(p.getVerticesDataKinds())).reduce((a, b) => new Set([...a].filter(k => b.has(k))));
      for (const p of parts) for (const kind of p.getVerticesDataKinds()) if (!common.has(kind)) p.removeVerticesData(kind);
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
      merged.name = `W_${k}`; merged.setEnabled(false); merged.isPickable = false; merged.refreshBoundingInfo();
      this.sources.set(merged.name, merged);
      for (const n of c.transformNodes) n.dispose();
      for (const m of c.meshes) if (m !== merged && !m.isDisposed()) m.dispose();
    }));
  }

  private refPelvis = 1;
  private fitCache = new Map<string, Map<string, ClipTemplate>>();
  private fitted(look: string, ratio: number, clips: Map<string, ClipTemplate>, kind: string): Map<string, ClipTemplate> {
    if (Math.abs(ratio - 1) < .015) return clips;
    const key = `${look}:${kind}`; let m = this.fitCache.get(key);
    if (!m) {
      m = new Map();
      for (const [n, c] of clips) m.set(n, { ...c, tracks: c.tracks.map(t => {
        if (t.bone !== 'pelvis' || t.anim.dataType !== Animation.ANIMATIONTYPE_VECTOR3) return t;
        const a = t.anim.clone(); a.setKeys(t.anim.getKeys().map(k => ({ ...k, value: (k.value as Vector3).scale(ratio) }))); return { ...t, anim: a };
      }) });
      this.fitCache.set(key, m);
    }
    return m;
  }
  /** The clip templates a look actually plays: a creator rig's own bake, otherwise the reference bake. */
  clipsFor(look: string | undefined): Map<string, ClipTemplate> { return (look && this.lookClips.get(look as LookId)) || this.clips; }
  private legCache = new Map<Map<string, ClipTemplate>, Map<string, ClipTemplate>>();
  /** Lower-body-only versions of the directional walk clips (pelvis and legs), per baked clip set. */
  legClips(clips: Map<string, ClipTemplate> = this.clips): Map<string, ClipTemplate> {
    let legs = this.legCache.get(clips); if (legs) return legs;
    const LEG = /^(pelvis|thigh|calf|foot|ball)/;
    legs = new Map(); this.legCache.set(clips, legs);
    for (const n of STRAFE_CLIPS) { const c = clips.get(n); if (c) legs.set(n, { ...c, tracks: c.tracks.filter(t => LEG.test(t.bone)) }); }
    return legs;
  }

  human(look: LookId, _id: string): CharacterInstance {
    const p = this.person(look);
    p.holder.scaling.setAll(HUMAN_SCALE);
    const bindAnkleHeights = ['l', 'r'].map(side => {
      const foot = p.nodes.get(`foot_${side}`);
      foot?.computeWorldMatrix(true);
      return foot ? Vector3.TransformCoordinates(foot.getAbsolutePosition(), Matrix.Invert(p.holder.computeWorldMatrix(true))).y : .06;
    }) as [number, number];
    // Clips are baked on the reference rig; a body with other leg lengths (goblins, orcs, skeletons) gets its pelvis
    // track rescaled. A creator rig with its own rest pose has its own bake, so it needs no rescale.
    const own = this.lookClips.get(look), clips = own ?? this.clips;
    const ratio = own ? 1 : (p.nodes.get('pelvis')?.position.length() ?? this.refPelvis) / this.refPelvis;
    const anims = instantiateClips(p.tag, this.fitted(look, ratio, clips, ''), p.nodes, this.scene);
    for (const [k, g] of instantiateClips(p.tag + '.legs', this.fitted(look, ratio, this.legClips(clips), 'legs'), p.nodes, this.scene)) anims.set(`legs:${k}`, g);
    const grips = this.lookGrips.get(look) ?? { r: this.gripR, l: this.gripL, shield: this.gripShield };
    const slot = (hand: string, g: Grip) => {
      const s = new TransformNode(`${p.tag}.slot.${hand}`, this.scene); s.parent = p.nodes.get(hand)!;
      s.rotationQuaternion = g.rot.clone(); s.position.copyFrom(g.pos); s.scaling.setAll(1 / g.scale);
      return s;
    };
    // Fingers come from the captured Mixamo grips.
    return {
      root: p.holder, anims, meshes: p.meshes, gear: new Map(), bones: p.nodes, bindAnkleHeights, springs: springsFor(p.nodes), chest: p.nodes.get('spine_03') ?? null,
      slotR: slot('hand_r', grips.r), slotL: slot('hand_l', grips.l), slotShield: grips.shield ? slot('hand_l', grips.shield) : undefined,
      dispose: () => { for (const g of anims.values()) g.dispose(); p.dispose(); },
    };
  }

  /**
   * The ontology creator's seeded appearance on one actor, exactly as its editor viewport applies it
   * (tools/ontology/src/rendering/viewport.ts): the jaw morph and the linen/leather palettes, on this actor's own
   * cloned morph managers and materials only. Bodies without authored variants get nothing, and that is reported.
   */
  applyCreatorAppearance(inst: CharacterInstance, look: CreatorLook, identity: CreatorIdentity, opts: { jaw?: number | null; hair?: boolean } = {}): string[] {
    const body = CREATOR_BODIES[look], plan = creatorAppearance(identity, body), applied: string[] = [];
    // The body's own hair mesh (every primitive of it), shown or hidden.
    if (opts.hair !== undefined) {
      const hair = inst.meshes.filter(m => m.name.includes(`.${body.hairMesh}`));
      for (const m of hair) m.setEnabled(opts.hair);
      applied.push(hair.length ? `hair ${opts.hair ? 'shown' : 'hidden'} (${hair.length} mesh)` : `hair mesh ${body.hairMesh} not found`);
    }
    if (!plan.supported) return [...applied, `${body.assetId}: no authored appearance variants (unsupported, nothing applied)`];
    const jaw = opts.jaw ?? plan.jaw;
    for (const m of inst.meshes) {
      const mgr = m.morphTargetManager; if (mgr) for (let i = 0; i < mgr.numTargets; i++) { const t = mgr.getTarget(i); if (t.name === CREATOR_CHANNELS.jawMorph) { t.influence = jaw; applied.push(`${t.name}=${jaw.toFixed(3)}${opts.jaw != null ? ' (chosen)' : ' (seeded)'}`); } }
      const mats = m.material instanceof MultiMaterial ? m.material.subMaterials : [m.material];
      for (const mat of mats) if (mat instanceof PBRMaterial) {
        if (mat.name.endsWith(CREATOR_CHANNELS.linenMaterial)) { mat.albedoColor = Color3.FromArray(plan.linen); applied.push('linen palette'); }
        if (mat.name.endsWith(CREATOR_CHANNELS.leatherMaterial)) { mat.albedoColor = Color3.FromArray(plan.leather); applied.push('leather palette'); }
      }
    }
    return [...new Set(applied)];
  }

  /** Dispose reference containers after baking editor motion; instances own their rig clones. */
  dispose(){for(const c of [...this.chars.values(),...this.people.values(),this.props,this.weapons])c?.dispose();}

  /** Bounding-box-free fragment offset: sources were exported at their position relative to the prop base. */
  fragmentsOf(key: string): Mesh[] {
    const out: Mesh[] = [];
    for (let n = 0; ; n++) { const m = this.sources.get(`F_${key}_${n}`); if (!m) break; out.push(m); }
    return out;
  }

  character(kind: CharacterKind): CharacterInstance {
    const c = this.chars.get(kind)!;
    const tag = `${kind}#${this.serial++}`;
    const e = c.instantiateModelsToScene(n => `${tag}.${n}`, false, { doNotInstantiate: true });
    const holder = new TransformNode(tag, this.scene);
    for (const r of e.rootNodes) r.parent = holder;
    const anims = new Map<string, AnimationGroup>();
    for (const g of e.animationGroups) { g.stop(); anims.set(g.name.slice(tag.length + 1), g); }
    const nodes = holder.getChildTransformNodes(false);
    const find = (n: string) => nodes.find(x => x.name === `${tag}.${n}`) ?? null;
    const meshes = holder.getChildMeshes(false);
    const gear = new Map<string, AbstractMesh>();
    for (const m of meshes) { m.isPickable = false; const p = m.parent?.name ?? ''; if (/handslot|head$|chest$/.test(p)) gear.set(m.name.slice(tag.length + 1), m); }
    return {
      root: holder, anims, meshes, gear,
      slotR: find('handslot.r')!, slotL: find('handslot.l')!, chest: find('chest'),
      dispose: () => { for (const g of e.animationGroups) g.dispose(); holder.dispose(false, false); },
    };
  }
}

/**
 * A fist grip from the hand's own geometry (Mixamo clips carry no weapon slot): the haft runs from
 * the little-finger knuckle to the index knuckle, the blade edge follows the knuckles, and the grip
 * sits in the palm. Returned in the hand bone's local frame.
 */
function handGrip(space: TransformNode, nodes: Map<string, TransformNode>, side: 'l' | 'r'): Grip {
  space.computeWorldMatrix(true);
  const inv = space.getWorldMatrix().clone().invert();
  const P = (n: string) => { const x = nodes.get(n)!; x.computeWorldMatrix(true); return Vector3.TransformCoordinates(x.getAbsolutePosition(), inv); };
  const hand = P(`hand_${side}`), mid = P(`middle_01_${side}`), idx = P(`index_01_${side}`), pky = P(`pinky_01_${side}`);
  const y = idx.subtract(pky).normalize();
  const k = mid.subtract(hand); const x = k.subtract(y.scale(Vector3.Dot(k, y))).normalize();
  const z = Vector3.Cross(x, y).normalize();
  const palm = side === 'r' ? -1 : 1;
  const pos = hand.add(mid.subtract(hand).scale(GRIP_ALONG)).add(z.scale(GRIP_PALM * palm));
  const m = Matrix.Identity(); Matrix.FromXYZAxesToRef(x, y, z, m);
  const q = Quaternion.FromRotationMatrix(m);
  const hn = nodes.get(`hand_${side}`)!;
  const handModel = hn.getWorldMatrix().multiply(inv);
  const hq = new Quaternion(), hs = new Vector3(); handModel.decompose(hs, hq);
  const local = Vector3.TransformCoordinates(pos, Matrix.Invert(handModel));
  return { rot: Quaternion.Inverse(hq).multiply(q).normalize(), pos: local, scale: hs.x };
}
/**
 * The retargeted KayKit slot faces the shield (boss at local +Z) toward the foe but puts the board plane in the fist;
 * the handle bar sits behind it. Move the board forward so the fist closes on the handle (KayKit units; checked with
 * scripts/web/tower-sword-shield.ts).
 */
function shieldGrip(g: Grip): Grip {
  return { rot: g.rot, pos: g.pos.add(new Vector3(0, 0, SHIELD_GRIP_BAR_DEPTH / g.scale).applyRotationQuaternion(g.rot)), scale: g.scale };
}
const ARM_BONE = /^(clavicle|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
/**
 * Body tracks from one clip, arm/hand tracks from another. Timing, contacts and stride follow the body source; each arm
 * track is resampled (new Animation, originals untouched) onto the body's frames at the same normalised cycle phase, so
 * both loop together whatever their source lengths and rates.
 */
export function layeredClip(name: string, body: ClipTemplate, arms: ClipTemplate): ClipTemplate {
  const n = body.frames, span = Math.max(1, arms.frames - 1);
  const armTracks = arms.tracks.filter(t => ARM_BONE.test(t.bone)).map(t => {
    const a = new Animation(`${name}.${t.bone}`, t.anim.targetProperty, body.fps, t.anim.dataType, Animation.ANIMATIONLOOPMODE_CYCLE);
    // Owned copies: evaluate can hand back a key's own value object.
    a.setKeys(Array.from({ length: n }, (_, i) => { const v = t.anim.evaluate(n > 1 ? i / (n - 1) * span : 0); return { frame: i, value: typeof v?.clone === 'function' ? v.clone() : v }; }));
    return { bone: t.bone, anim: a };
  });
  const swing = Array.from({ length: n }, (_, i) => arms.swing[Math.min(arms.swing.length - 1, Math.round(n > 1 ? i / (n - 1) * span : 0))] ?? 0);
  return { ...body, name, tracks: [...body.tracks.filter(t => !ARM_BONE.test(t.bone)), ...armTracks], swing };
}
/** Largest angle between two rigs' local rest rotations over the bones they share (diagnostic only). */
function restDelta(a: Map<string, TransformNode>, b: Map<string, TransformNode>): number {
  let worst = 0;
  for (const [name, na] of a) {
    const nb = b.get(name); if (!nb) continue;
    const qa = na.rotationQuaternion ?? Quaternion.FromEulerVector(na.rotation), qb = nb.rotationQuaternion ?? Quaternion.FromEulerVector(nb.rotation);
    const d = Math.min(1, Math.abs(Quaternion.Dot(qa, qb))); worst = Math.max(worst, 2 * Math.acos(d));
  }
  return worst;
}
/** Grip placement along wrist->middle knuckle, and toward the palm (model metres); tuned on pose sheets. */
const GRIP_ALONG = .55, GRIP_PALM = .028;

/** Nearest KayKit clip for a Mixamo clip name (used when mixamo_clips.glb has not been built locally). */
export function kaykitFallback(n: string): string {
  if (!n.includes('/')) return n;
  const k = n.toLowerCase();
  if (/jab|cross|hook|uppercut/.test(k)) return 'Unarmed_Melee_Attack_Punch_A';
  if (k.includes('roundhouse')) return 'Unarmed_Melee_Attack_Kick';
  if (k.includes('slip')) return k.includes('right') ? 'Dodge_Right' : 'Dodge_Left';
  if (k.includes('walk_backward')) return 'Walking_Backwards';
  if (k.includes('walk_strafe')) return k.includes('left') ? 'Running_Strafe_Left' : 'Running_Strafe_Right';
  if (k === 'locomotion/idle' || k === 'unarmed/idle_neutral') return 'Idle';
  if (k.includes('dodge')) return k.includes('back') ? 'Dodge_Backward' : k.includes('left') ? 'Dodge_Left' : k.includes('right') ? 'Dodge_Right' : 'Dodge_Forward';
  if (k.includes('death')) return k.includes('(2)') || k.includes('forward') ? 'Death_B' : 'Death_A';
  if (k.includes('impact') || k.includes('react')) return k.includes('(3)') ? 'Hit_B' : 'Hit_A';
  if (k.includes('block idle') || k.includes('overdraw') || k.includes('idle (2)')) return k.includes('overdraw') ? '2H_Ranged_Aiming' : 'Blocking';
  if (k.includes('block')) return 'Block_Hit';
  if (k.includes('power up') || k.includes('equip') || k.includes('casting')) return 'Taunt';
  if (k.includes('spell')) return 'Spellcast_Shoot';
  if (k.includes('draw arrow') || k.includes('recoil')) return '2H_Ranged_Shoot';
  if (k.includes('kick')) return 'Unarmed_Melee_Attack_Kick';
  if (k.includes('spin')) return '2H_Melee_Attack_Spin';
  if (k.includes('slash') || k.includes('attack')) return k.startsWith('great') ? (k.includes('(3)') || k.endsWith('attack') ? '2H_Melee_Attack_Chop' : '2H_Melee_Attack_Slice') : (k.includes('(2)') ? '1H_Melee_Attack_Chop' : '1H_Melee_Attack_Slice_Diagonal');
  if (k.includes('run')) return 'Running_A';
  if (k.includes('walk')) return 'Walking_A';
  return 'Idle_Combat';
}
