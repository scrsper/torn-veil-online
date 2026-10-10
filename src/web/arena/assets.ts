import '@babylonjs/loaders/glTF';
import { Animation, AssetContainer, Matrix, Mesh, PBRMaterial, Quaternion, SceneLoader, TransformNode, Vector3, type AbstractMesh, type AnimationGroup, type Scene } from '@babylonjs/core';
import { MIXAMO, UE, Retargeter, instantiateClips, type ClipTemplate, type Grip } from './retarget';
import type { LookId } from './looks';
import { SpringBones } from './springs';

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
  chest: TransformNode | null;
  /** Meshes parented to a hand slot or head, by original name (weapons, shields, helmets). */
  gear: Map<string, AbstractMesh>;
  /** Skeleton nodes by bone name (humans only), for IK touch-ups. */
  bones?: Map<string, TransformNode>;
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
  constructor(private readonly scene: Scene,private options:{base?:string;detailedHumans?:boolean}={}) {}
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
  private gripR!: Grip; private gripL!: Grip;

  /** Load the people (art/tools/arena/build_arena_people.py) and bake every combat clip onto their skeleton. */
  /** Clip names fighters need; null = bake and instantiate everything (measurement mode). */
  used: Set<string> | null = null;
  /** False when the local Mixamo clip file is absent and KayKit stand-ins are playing. */
  mocap = true;

  async loadHumans(looks: LookId[], progress: (t: string) => void): Promise<void> {
    let n = 0;
    await Promise.all(looks.map(async l => {
      const c = await SceneLoader.LoadAssetContainerAsync(this.base + (this.options.detailedHumans!==false&&['ranger','brann','wren','raider','raider_f','soldier','knight','archer','mystic'].includes(l)?'people/':PEOPLE_DIR), `${this.options.detailedHumans!==false&&l==='ranger'?'hero':l}.glb`, this.scene);
      // Hair, brows and lashes export as BLEND; alpha-test them so they sort with the head.
      for (const m of c.materials) if (m instanceof PBRMaterial && m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHABLEND) {
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = .45; m.backFaceCulling = false;
      }
      this.people.set(l, c); progress(`Loading people ${++n}/${looks.length}`);
    }));
    progress('Teaching the fighters to fight');
    const src = this.character('skeleton_warrior');
    const ref = this.person('ranger');
    this.refPelvis = ref.nodes.get('pelvis')!.position.length();
    const srcNodes = new Map(src.root.getChildTransformNodes(false).map(x => [x.name.slice(x.name.indexOf('.') + 1), x] as const));
    const rt = new Retargeter({ space: src.root, nodes: srcNodes }, { space: ref.holder, nodes: ref.nodes });
    const fallbacks = new Set(this.used ? [...this.used].map(kaykitFallback) : []);
    for (const [name, g] of src.anims) if (!this.used || this.used.has(name) || fallbacks.has(name)) this.clips.set(name, rt.bake(name, g));
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
    const mrt = new Retargeter({ space: mh, nodes: mNodes }, { space: ref.holder, nodes: ref.nodes }, MIXAMO);
    for (const g of me.animationGroups) { const name = g.name.slice(3); if (!this.used || this.used.has(name)) this.clips.set(name, mrt.bake(name, g)); }
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
      const urt = new Retargeter({ space: uh, nodes: uNodes }, { space: ref.holder, nodes: ref.nodes }, UE);
      for (const g of ue.animationGroups) { const name = 'unarmed/' + g.name.slice(3); if (!this.used || this.used.has(name)) this.clips.set(name, urt.bake(name, g)); }
      for (const g of ue.animationGroups) g.dispose(); uh.dispose(); uc.dispose();
    }
    // Any mocap clip that is unavailable plays its nearest KayKit equivalent.
    if (this.used) for (const n of this.used) if (!this.clips.has(n)) { const fb = this.clips.get(kaykitFallback(n)); if (fb) this.clips.set(n, fb); }
    this.gripR = handGrip(ref.holder, ref.nodes, 'r'); this.gripL = handGrip(ref.holder, ref.nodes, 'l');
    ref.dispose();
  }

  private person(look: LookId) {
    const tag = `h${this.serial++}`;
    const e = this.people.get(look)!.instantiateModelsToScene(n => `${tag}.${n}`, false, { doNotInstantiate: true });
    const holder = new TransformNode(tag, this.scene);
    for (const r of e.rootNodes) r.parent = holder;
    const nodes = new Map(holder.getChildTransformNodes(false).map(x => [x.name.slice(tag.length + 1), x] as const));
    const meshes = holder.getChildMeshes(false);
    for (const m of meshes) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    return { tag, holder, nodes, meshes, dispose: () => { for (const g of e.animationGroups) g.dispose(); for (const k of e.skeletons) k.dispose(); holder.dispose(false, false); } };
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
  private legCache: Map<string, ClipTemplate> | null = null;
  /** Lower-body-only versions of the directional walk clips (pelvis and legs). */
  legClips(): Map<string, ClipTemplate> {
    if (this.legCache) return this.legCache;
    const LEG = /^(pelvis|thigh|calf|foot|ball)/;
    this.legCache = new Map();
    for (const n of STRAFE_CLIPS) { const c = this.clips.get(n); if (c) this.legCache.set(n, { ...c, tracks: c.tracks.filter(t => LEG.test(t.bone)) }); }
    return this.legCache;
  }

  human(look: LookId, _id: string): CharacterInstance {
    const p = this.person(look);
    p.holder.scaling.setAll(HUMAN_SCALE);
    // Clips are baked on the reference rig; a body with other leg lengths (goblins, orcs, skeletons) gets its pelvis track rescaled.
    const ratio = (p.nodes.get('pelvis')?.position.length() ?? this.refPelvis) / this.refPelvis;
    const anims = instantiateClips(p.tag, this.fitted(look, ratio, this.clips, ''), p.nodes, this.scene);
    for (const [k, g] of instantiateClips(p.tag + '.legs', this.fitted(look, ratio, this.legClips(), 'legs'), p.nodes, this.scene)) anims.set(`legs:${k}`, g);
    const slot = (hand: string, g: Grip) => {
      const s = new TransformNode(`${p.tag}.slot.${hand}`, this.scene); s.parent = p.nodes.get(hand)!;
      s.rotationQuaternion = g.rot.clone(); s.position.copyFrom(g.pos); s.scaling.setAll(1 / g.scale);
      return s;
    };
    // Fingers come from the captured Mixamo grips.
    return {
      root: p.holder, anims, meshes: p.meshes, gear: new Map(), bones: p.nodes, springs: springsFor(p.nodes), chest: p.nodes.get('spine_03') ?? null,
      slotR: slot('hand_r', this.gripR), slotL: slot('hand_l', this.gripL),
      dispose: () => { for (const g of anims.values()) g.dispose(); p.dispose(); },
    };
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
