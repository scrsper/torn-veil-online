import { describe, expect, it } from 'vitest';
import { Animation, AnimationGroup, AssetContainer, Bone, Matrix, MeshBuilder, NullEngine, PBRMaterial, Scene, Skeleton, TransformNode, Vector3 } from '@babylonjs/core';
import { disposeRetargetSource } from '../src/web/arena/assets';

describe('temporary retarget source ownership', () => {
  it('disposes Babylon cloned skeletons/groups/roots while preserving reusable source assets', () => {
    const scene = new Scene(new NullEngine()), container = new AssetContainer(scene);
    const mesh = MeshBuilder.CreateBox('source', {}, scene), skeleton = new Skeleton('source-rig', 'rig', scene);
    new Bone('root', skeleton, null, Matrix.Identity()); mesh.skeleton = skeleton;
    const material = new PBRMaterial('shared-source-material', scene); mesh.material = material;
    let materialDisposed = false; material.onDisposeObservable.add(() => materialDisposed = true);
    const animation = new Animation('source-motion', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3);
    animation.setKeys([{ frame: 0, value: Vector3.Zero() }, { frame: 30, value: new Vector3(0, 1, 0) }]);
    const group = new AnimationGroup('source-motion', scene); group.addTargetedAnimation(animation, mesh);
    container.meshes.push(mesh); container.skeletons.push(skeleton); container.animationGroups.push(group); container.materials.push(material);
    container.removeAllFromScene();
    try {
      for (let i = 0; i < 3; i++) {
        const entries = container.instantiateModelsToScene(name => `bake-${i}.${name}`, false, { doNotInstantiate: true });
        const holder = new TransformNode(`bake-${i}`, scene); entries.rootNodes.forEach(node => node.parent = holder);
        const cloneSkeleton = entries.skeletons[0], cloneGroup = entries.animationGroups[0], cloneRoot = entries.rootNodes[0];
        expect(cloneSkeleton).toBeDefined(); expect(cloneSkeleton).not.toBe(skeleton);
        expect(scene.skeletons).toContain(cloneSkeleton);
        disposeRetargetSource(entries, holder);
        expect(scene.skeletons).not.toContain(cloneSkeleton);
        expect(scene.animationGroups).not.toContain(cloneGroup);
        expect(cloneRoot.isDisposed()).toBe(true); expect(holder.isDisposed()).toBe(true);
        expect(scene.skeletons).toHaveLength(0);
        expect(materialDisposed).toBe(false); expect(mesh.isDisposed()).toBe(false);
        expect(skeleton.bones).toHaveLength(1); expect(group.targetedAnimations).toHaveLength(1);
      }
    } finally { container.dispose(); scene.dispose(); }
  });
});
