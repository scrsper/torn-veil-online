import { describe, expect, it } from 'vitest';
import { Animation, AnimationGroup, NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { Retargeter, type RigMap } from '../src/web/arena/retarget';

const map: RigMap = {
  hips: 'hips', handR: 'hand', handL: 'hand',
  map: [['hips', 'pelvis', 'chest', 'spine_03'], ['chest', 'spine_03', 'head', 'head'],
    ['head', 'head', null, null], ['arm', 'upperarm_r', 'hand', 'hand_r'], ['hand', 'hand_r', null, null]],
  blend: [], follow: [],
  preserveRest: ['pelvis', 'spine_03', 'head'],
};
const near = (a: Quaternion, b: Quaternion) => Math.abs(Quaternion.Dot(a, b));

function fixture() {
  const scene = new Scene(new NullEngine()); scene.useRightHandedSystem = true;
  const rig = (prefix: string, source: boolean) => {
    const space = new TransformNode(prefix, scene), nodes = new Map<string, TransformNode>();
    const node = (name: string, parent: TransformNode, p: Vector3) => {
      const n = new TransformNode(prefix + name, scene); n.parent = parent; n.position.copyFrom(p); n.rotationQuaternion = Quaternion.Identity(); nodes.set(name, n); return n;
    };
    const hips = node(source ? 'hips' : 'pelvis', space, new Vector3(0, 1, 0));
    const chest = node(source ? 'chest' : 'spine_03', hips, new Vector3(0, .4, source ? .2 : 0));
    node('head', chest, new Vector3(0, .4, source ? .2 : .04));
    const arm = node(source ? 'arm' : 'upperarm_r', chest, new Vector3(.15, 0, 0));
    node(source ? 'hand' : 'hand_r', arm, source ? new Vector3(.4, 0, 0) : new Vector3(.3, -.3, 0));
    return { space, nodes };
  };
  const src = rig('source', true), target = rig('target', false);
  const animation = new Animation('torso motion', 'rotationQuaternion', 30, Animation.ANIMATIONTYPE_QUATERNION);
  const turn = Quaternion.RotationAxis(Vector3.Right(), .22);
  animation.setKeys([{ frame: 0, value: Quaternion.Identity() }, { frame: 30, value: turn }]);
  const group = new AnimationGroup('motion', scene); group.addTargetedAnimation(animation, src.nodes.get('chest')!);
  return { scene, src, target, group, turn };
}

describe('retargeting neutral torso and deliberate motion', () => {
  it('retains existing rest-direction conversion for source maps that do not opt into neutral-trunk transfer', () => {
    const x = fixture();
    try {
      const clip = new Retargeter(x.src, x.target, { ...map, preserveRest: undefined }).bake('existing mapped combat', x.group);
      const chest = clip.tracks.find(t => t.bone === 'spine_03')!.anim.evaluate(0) as Quaternion;
      expect(near(chest, Quaternion.Identity())).toBeLessThan(.999);
    } finally { x.scene.dispose(); }
  });
  it('preserves target torso rest while retaining arm rest conversion and source motion', () => {
    const x = fixture();
    try {
      const clip = new Retargeter(x.src, x.target, map).bake('motion', x.group);
      const rotation = (name: string, frame: number) => clip.tracks.find(t => t.bone === name && t.anim.targetProperty === 'rotationQuaternion')!.anim.evaluate(frame) as Quaternion;
      expect(near(rotation('pelvis', 0), Quaternion.Identity())).toBeGreaterThan(.99999);
      expect(near(rotation('spine_03', 0), Quaternion.Identity())).toBeGreaterThan(.99999);
      expect(near(rotation('head', 0), Quaternion.Identity())).toBeGreaterThan(.99999);
      expect(near(rotation('upperarm_r', 0), Quaternion.Identity())).toBeLessThan(.99);
      expect(near(rotation('spine_03', 30), x.turn)).toBeGreaterThan(.99999);
      expect(rotation('spine_03', 30).length()).toBeCloseTo(1, 6);
      expect(x.target.space.position.asArray()).toEqual([0, 0, 0]);
      // Baking does not leave the target in its last sampled pose.
      expect(near(x.target.nodes.get('spine_03')!.rotationQuaternion!, Quaternion.Identity())).toBeGreaterThan(.99999);
    } finally { x.scene.dispose(); }
  });
});
