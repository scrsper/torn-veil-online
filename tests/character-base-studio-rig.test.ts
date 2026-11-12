import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Animation, NullEngine, Quaternion, Scene, SceneLoader, TransformNode, Vector3, type AbstractMesh, type AssetContainer } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { CHARACTER_BASE_DIR, stagedCharacterBaseFiles } from '../scripts/foundation/character-bases.mjs';
import { STUDIO_PARTS, STUDIO_REQUIRED_BONES, composeStudioRig, studioSlotRole, type StudioPart, type StudioSex } from '../src/web/actors/studioBaseRig';
import { parseStudioManifest } from '../src/web/actors/studioBases';
import { Retargeter, UAL, KAYKIT } from '../src/web/arena/retarget';
import { normalizeCharacterMetres } from '../src/web/actors/characterScale';
import { measureFootSoles } from '../src/web/arena/footGeometry';
import type { CharacterInstance } from '../src/web/arena/assets';

const dir = resolve(CHARACTER_BASE_DIR), ual = 'web/public/arena/motion/ual-standard.glb', kaykit = 'web/public/arena/skeleton_warrior.glb';
// A clean checkout has no private bases and reports a skip. A present but invalid
// staging is a failure (stagedCharacterBaseFiles throws), never a silent skip.
const staged = existsSync(dir) && stagedCharacterBaseFiles(resolve('.')).length > 0;
if (process.env.TV_REQUIRE_CHARACTER_BASES === '1' && !staged) throw Error('Stage the pinned private character bases before running required acceptance.');

describe('actual studio character bases on the game rig', () => {
  it.skipIf(!staged)('composes clothed independent instances, follows the canonical joints and bakes CC0 UAL motion', async () => {
    const manifest = parseStudioManifest(JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')));
    if (!manifest.ok) throw Error(manifest.reason);
    const engine = new NullEngine(), scene = new Scene(engine); scene.useRightHandedSystem = true;
    const observer = SceneLoader.OnPluginActivatedObservable.add(plugin => { if (plugin.name === 'gltf') (plugin as unknown as { skipMaterials: boolean }).skipMaterials = true; });
    const load = (path: string) => SceneLoader.LoadAssetContainerAsync('', new Uint8Array(readFileSync(path)), scene, undefined, '.glb');
    try {
      // Material roles come from the real glTF material JSON (textures are not decoded under NullEngine).
      for (const sex of ['female', 'male'] as const) {
        const head = readFileSync(resolve(dir, manifest.manifest.parts[sex].head)), json = JSON.parse(head.subarray(20, 20 + head.readUInt32LE(12)).toString('utf8'));
        const roles = json.materials.map((m: { name: string; extras?: unknown }) => studioSlotRole({ name: m.name, metadata: { gltf: { extras: m.extras } } }));
        expect(roles).toEqual(expect.arrayContaining(['skin', 'eye', 'eye-ao', 'eye-tear']));
      }
      const src = await load(ual), se = src.instantiateModelsToScene(n => 'cc.' + n, false, { doNotInstantiate: true }), space = new TransformNode('cc', scene);
      se.rootNodes.forEach(n => n.parent = space); se.animationGroups.forEach(g => g.stop());
      const srcRig = { space, nodes: new Map(space.getChildTransformNodes(false).map(n => [n.name.slice(3), n] as const)) };
      for (const sex of ['female', 'male'] as StudioSex[]) {
        const parts: { part: StudioPart; container: AssetContainer }[] = [];
        for (const part of STUDIO_PARTS) parts.push({ part, container: await load(resolve(dir, manifest.manifest.parts[sex][part])) });
        const a = composeStudioRig(scene, `${sex}-a`, parts), b = composeStudioRig(scene, `${sex}-b`, parts);
        expect(a.missingBones).toEqual([]);
        for (const bone of STUDIO_REQUIRED_BONES) expect(a.nodes.has(bone), bone).toBe(true);
        const by = Object.fromEntries(a.composition.map(c => [c.part, c]));
        expect(Object.keys(by)).toEqual([...STUDIO_PARTS]);
        for (const part of ['pants', 'boots', 'head', 'hair'] as const) expect(by[part].linkedBones, part).toBeGreaterThan(5);
        expect(a.joints.has('Bip001-L-Toe0') && a.joints.has('b_L_Eye')).toBe(true);
        // Toes come from pants and are shared by boots; face joints sit under the canonical head.
        let n: TransformNode | null = a.joints.get('b_L_Eye')!; while (n && n !== a.nodes.get('head')) n = n.parent as TransformNode | null;
        expect(n).toBe(a.nodes.get('head'));
        expect(a.joints.get('Bip001-L-Toe0')!.parent).toBe(a.nodes.get('foot_l'));
        // Independence: every skinned part of A is driven only by A's nodes.
        const owner = (node: TransformNode | null) => { while (node && node !== a.holder && node !== b.holder) node = node.parent as TransformNode | null; return node; };
        const skinned = a.meshes.filter(m => m.skeleton);
        expect(skinned.length).toBeGreaterThanOrEqual(5);
        for (const m of skinned) {
          expect(m.numBoneInfluencers, m.name).toBe(8);
          expect(m.getVerticesData('matricesIndicesExtra')?.length, m.name).toBeGreaterThan(0);
        }
        for (const m of skinned) for (const bone of m.skeleton!.bones) { const t = bone.getTransformNode(); if (t) expect(owner(t)).toBe(a.holder); }
        expect(new Set(a.meshes).size).toBe(a.meshes.length); expect(a.meshes.some(m => b.meshes.includes(m))).toBe(false);
        const ma = a.meshes.find(m => m.morphTargetManager)?.morphTargetManager;
        const mb = b.meshes.find(m => m.morphTargetManager)?.morphTargetManager;
        expect(ma).toBeTruthy(); expect(mb).toBeTruthy(); expect(ma).not.toBe(mb);
        ma!.getTarget(0).influence = .7; expect(mb!.getTarget(0).influence).toBe(0);
        // Boots soles are measured through the composed foot joints.
        const sole = measureFootSoles({ root: a.holder, meshes: a.meshes, bones: a.nodes } as unknown as CharacterInstance);
        expect(sole[0]?.points.length).toBeGreaterThan(2); expect(sole[0]!.points.every(p => /Boots/.test(p.mesh.name))).toBe(true);
        // Moving A's canonical thigh moves A's boots skin, never B's.
        const boots = (r: typeof a) => r.meshes.find(m => /BaseBoots/.test(m.name))! as AbstractMesh;
        const sample = (m: AbstractMesh) => { m.skeleton!.prepare(true); const p = m.getPositionData(true, true)!; return new Vector3(p[0], p[1], p[2]); };
        const restA = sample(boots(a)), restB = sample(boots(b));
        a.nodes.get('thigh_l')!.rotationQuaternion = a.nodes.get('thigh_l')!.rotationQuaternion!.multiply(Quaternion.RotationAxis(Vector3.Forward(), .6));
        a.nodes.get('thigh_r')!.rotationQuaternion = a.nodes.get('thigh_r')!.rotationQuaternion!.multiply(Quaternion.RotationAxis(Vector3.Forward(), .6));
        a.holder.getChildTransformNodes(false).forEach(t => t.computeWorldMatrix(true));
        expect(Vector3.Distance(sample(boots(a)), restA)).toBeGreaterThan(.05);
        expect(Vector3.Distance(sample(boots(b)), restB)).toBeLessThan(1e-6);
        a.dispose();
        // Metre import: about adult height, feet at the origin after normalisation.
        const metric = normalizeCharacterMetres(b.holder, b.meshes, 1);
        expect(metric.sourceHeight).toBeGreaterThan(1.45); expect(metric.sourceHeight).toBeLessThan(2.0);
        b.holder.scaling.setAll(1); b.holder.position.setAll(0);
        // CC0 UAL locomotion and the KayKit combat fallback retarget onto this own rig.
        const rt = new Retargeter(srcRig, { space: b.holder, nodes: b.nodes }, UAL);
        const rest = [...b.joints.values()].map(node => ({ node, position: node.position.clone(), rotation: node.rotationQuaternion!.clone() }));
        for (const name of ['Idle_Loop', 'Walk_Loop']) {
          const clip = rt.bake(name, se.animationGroups.find(g => g.name === 'cc.' + name)!);
          for (const bone of ['pelvis', 'thigh_l', 'calf_r', 'foot_l', 'upperarm_r', 'spine_03']) expect(clip.tracks.some(t => t.bone === bone), `${name} ${bone}`).toBe(true);
          for (const t of clip.tracks) for (const k of t.anim.getKeys()) expect(Number.isFinite(t.anim.dataType === Animation.ANIMATIONTYPE_QUATERNION ? (k.value as Quaternion).w : (k.value as Vector3).y)).toBe(true);
          expect(clip.contact).not.toBeNull();
          // Actual sampled poses, beyond finite keys: a neutral upright torso stays
          // upright on this differently oriented biped rig. Restore before baking again.
          for (const frame of [0, clip.frames / 2]) {
            for (const { bone, anim } of clip.tracks) {
              const node = b.nodes.get(bone)!;
              if (anim.targetProperty === 'rotationQuaternion') node.rotationQuaternion = (anim.evaluate(frame) as Quaternion).clone();
              if (anim.targetProperty === 'position') node.position.copyFrom(anim.evaluate(frame) as Vector3);
            }
            b.holder.getChildTransformNodes(false).forEach(t => t.computeWorldMatrix(true));
            const spine = b.nodes.get('spine_03')!.getAbsolutePosition().subtract(b.nodes.get('pelvis')!.getAbsolutePosition()).normalize();
            expect(spine.y, `${sex} ${name} upright`).toBeGreaterThan(Math.cos(Math.PI / 7));
            expect(b.nodes.get('head')!.getAbsolutePosition().y - b.nodes.get('pelvis')!.getAbsolutePosition().y).toBeGreaterThan(.4);
          }
          for (const { node, position, rotation } of rest) { node.position.copyFrom(position); node.rotationQuaternion = rotation.clone(); }
          b.holder.getChildTransformNodes(false).forEach(t => t.computeWorldMatrix(true));
          if (name === 'Walk_Loop') { expect(clip.stance).toBeGreaterThan(.3); expect(clip.stance).toBeLessThan(3); expect(clip.contact![0].some(v => v === 0)).toBe(true); }
        }
        if (existsSync(kaykit)) {
          const kc = await load(kaykit), ke = kc.instantiateModelsToScene(n => 'kk.' + n, false, { doNotInstantiate: true }), ks = new TransformNode('kk', scene);
          ke.rootNodes.forEach(r => r.parent = ks); ke.animationGroups.forEach(g => g.stop());
          const kr = new Retargeter({ space: ks, nodes: new Map(ks.getChildTransformNodes(false).map(x => [x.name.slice(3), x] as const)) }, { space: b.holder, nodes: b.nodes }, KAYKIT);
          for (const name of ['Hit_A', 'Blocking', '1H_Melee_Attack_Slice_Diagonal', 'Death_A']) {
            const clip = kr.bake(name, ke.animationGroups.find(g => g.name === 'kk.' + name)!);
            expect(clip.tracks.length).toBeGreaterThan(10);
            for (const track of clip.tracks) for (const key of track.anim.getKeys()) expect(key.value.asArray().every(Number.isFinite), name).toBe(true);
          }
          ke.dispose(); ks.dispose(); kc.dispose();
        }
        const tag = b.tag; b.dispose();
        expect(scene.skeletons.some(s => s.name.startsWith(tag))).toBe(false);
        expect(parts.every(p => !p.container.meshes.some(m => m.isDisposed()))).toBe(true);
        for (const p of parts) p.container.dispose();
      }
      se.dispose(); space.dispose(); src.dispose();
    } finally { SceneLoader.OnPluginActivatedObservable.remove(observer); scene.dispose(); engine.dispose(); }
  }, 120000);
});
