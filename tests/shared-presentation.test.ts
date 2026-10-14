import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Animation, AnimationGroup, TransformNode, Vector3, MeshBuilder } from '@babylonjs/core';
import { humanAssetPath, motionSampleSeconds, UNARMED_MOTION, SHARED_MOTION } from '../src/web/presentation/library';
import { Animator } from '../src/web/arena/anim';
import { SharedVisual } from '../src/web/actors/sharedCast';
import { RELAXED, MOVESETS } from '../src/web/arena/combat';
import type { BodyState } from '../src/web/net/messages';
import type { ActorState } from '../src/web/actors/actorManager';
import type { Atmosphere } from '../src/web/world/atmosphere';
import { RealmSession } from '../src/sim/world/realms/session';
import { makeItem } from '../src/sim/world/factory';
import { changeEquipment } from '../src/sim/physical/equipment';
import { normalizeCharacterMetres } from '../src/web/actors/characterScale';

describe('shared presentation replacement contract', () => {
  it('uses existing body assets consistently and does not introduce an unapproved character', () => {
    expect(humanAssetPath('ranger')).toBe('people/hero.glb');
    expect(humanAssetPath('ranger', false)).toBe('people_flat/ranger.glb');
    expect(humanAssetPath('creator_male')).toBe('creator/tv-human-male-v2.glb');
    expect(humanAssetPath('creator_female')).toBe('creator/tv-human-female-v1.glb');
    expect(SHARED_MOTION.has('unarmed/side_kick')).toBe(true);
    expect(SHARED_MOTION.has('unarmed/dodge_left')).toBe(true);
  });
  it('retimes arbitrary replacement contacts to fixed canonical phases without modifying them', () => {
    const timing = { age: 0, prep: .26, active: .15, recovery: .27 };
    const replacement = { clip: 'replacement', contact: [1.2, 1.5] as const, end: 2.3 };
    for (const binding of [UNARMED_MOTION.jab, replacement]) {
      expect(motionSampleSeconds(timing, binding)).toBe(0);
      expect(motionSampleSeconds({ ...timing, age: .26 }, binding)).toBeCloseTo(binding.contact[0]);
      expect(motionSampleSeconds({ ...timing, age: .41 }, binding)).toBeCloseTo(binding.contact[1]);
      expect(motionSampleSeconds({ ...timing, age: .68 }, binding)).toBeCloseTo(binding.end);
      expect(motionSampleSeconds({ ...timing, age: 99 }, binding)).toBe(binding.end);
    }
    expect(timing).toEqual({ age: 0, prep: .26, active: .15, recovery: .27 });
  });
  it('samples authored pose without moving the actor root or firing gameplay callbacks', () => {
    const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('body', scene), hand = new TransformNode('hand', scene); hand.parent = root;
    root.position.set(12, 1, 20);
    const animation = new Animation('pose', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3);
    animation.setKeys([{ frame: 0, value: Vector3.Zero() }, { frame: 30, value: new Vector3(0, 1, 1) }]);
    const group = new AnimationGroup('jab', scene); group.addTargetedAnimation(animation, hand); group.normalize(0, 30);
    const animator = new Animator(new Map([['jab', group]]));
    animator.sample('jab', .5, 0); animator.update(1 / 60);
    expect(root.position.asArray()).toEqual([12, 1, 20]); expect(group.speedRatio).toBe(0);
    expect(group.animatables[0].masterFrame).toBeCloseTo(15);
    animator.stopAll(); scene.dispose(); engine.dispose();
  });
  it('restores locomotion after a retained action, selects each strike and releases pins for moving feet', () => {
    const engine = new NullEngine(), scene = new Scene(engine), root = new TransformNode('asset', scene), hand = new TransformNode('hand', scene); hand.parent = root;
    // SharedCharacters.create calibrates the import before constructing SharedVisual.
    // Exercise the same real metre adapter instead of a metadata-free mock import.
    const mesh = MeshBuilder.CreateBox('body-metric-fixture', { height: 1.6 }, scene);
    mesh.parent = root; mesh.position.y = .8;
    root.metadata = { metricImport: normalizeCharacterMetres(root, [mesh], 1) };
    const names = [RELAXED.idle, RELAXED.walk, RELAXED.run, 'unarmed/run_jog', UNARMED_MOTION.jab.clip, UNARMED_MOTION.cross.clip, ...MOVESETS.fists.hit];
    const groups = new Map(names.map(name => {
      const animation = new Animation(name, 'position', 30, Animation.ANIMATIONTYPE_VECTOR3);
      animation.setKeys([{ frame: 0, value: Vector3.Zero() }, { frame: 90, value: new Vector3(0, 1, 1) }]);
      const g = new AnimationGroup(name, scene); g.addTargetedAnimation(animation, hand); g.normalize(0, 90); return [name, g];
    }));
    const body = { bodyId: 'b_review', hitSeq: 0, attackSeq: 1, equipment: [], dead: false,
      pose: 'stand', combatAction: { phase: 'complete' } } as unknown as BodyState;
    const visual = new SharedVisual({ root, meshes: [mesh], anims: groups, slotR: hand, slotL: hand, chest: null, gear: new Map(), dispose() { root.dispose(); } },
      body, { addCaster() {}, removeCaster() {} } as unknown as Atmosphere, new Map());
    expect(visual.bodyHeight).toBeCloseTo(1.75);
    visual.root.position.set(4, 1, 8);
    const state: ActorState = { bodyId: body.bodyId, body, own: true, kind: 'person', speed: 2, velocity: { x: 0, y: 0, z: -2 }, yaw: 0, crouch: 0, age: 0, combat: null };
    visual.update(.02, state); expect(visual.root.metadata.motion.clip).toBe('loco'); expect(visual.root.metadata.motion.planted).toBe(true);
    expect(visual.root.metadata.motion.policy).toBe('authored-in-place');expect(visual.root.metadata.motion.gait).toBeNull();
    for (const move of ['jab', 'cross']) {
      state.combat = { moveId: move, age: .3, prep: .2, active: .15, recovery: .3, weight: 'light' };
      visual.update(.02, state); expect(visual.root.metadata.motion.clip).toBe(UNARMED_MOTION[move].clip);
    }
    state.combat = null; visual.update(.02, state); expect(visual.root.metadata.motion.clip).toBe('loco');
    expect(visual.root.position.asArray()).toEqual([4, 1, 8]); expect(root.rotation.y).toBe(Math.PI);
    body.hitSeq++; visual.update(.02, state); expect(visual.root.metadata.motion.hit).toBe(true);
    visual.update(.4, state); expect(visual.root.metadata.motion.clip).toBe('loco');
    visual.dispose(); scene.dispose(); engine.dispose();
  });
});
