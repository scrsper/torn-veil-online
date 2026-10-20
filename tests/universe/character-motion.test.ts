import { describe, expect, it } from 'vitest';
import { Matrix, NullEngine, PBRMaterial, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { flightPresentation, FlightPose, groundedFlightPresentation } from '../../src/web/actors/flightPose';
import { importedHumanMaterialRole, refineImportedHumanMaterial } from '../../src/web/actors/characterMaterials';
import { avatarRotation } from '../../src/web/universe/avatar';
import { UAL } from '../../src/web/arena/retarget';
import { UAL_CLIPS, verifyHumanMotion } from '../../src/web/arena/humanMotion';
import type { CharacterInstance } from '../../src/web/arena/assets';
import { spineTiltDegrees } from '../../src/web/actors/sharedCast';

describe('shared character flight presentation', () => {
  it('retains heading when steering vertically, including a rotated radial frame', () => {
    for (const up of [Vector3.Up(), Vector3.Right(), new Vector3(.2, .6, -.4).normalize()]) {
      const heading = Vector3.Cross(up, new Vector3(.2, .3, .9)).normalize();
      for (const direction of [up, up.scale(-1), up.add(heading.scale(.001)).normalize(), up.subtract(heading.scale(.001)).normalize()]) {
        const q = avatarRotation(direction, up, heading);
        expect(Vector3.Dot(Vector3.Forward(true).applyRotationQuaternion(q), heading)).toBeCloseTo(1, 6);
        expect(Vector3.Dot(Vector3.Up().applyRotationQuaternion(q), up)).toBeCloseTo(1, 6);
      }
    }
  });

  it('smooths launch, hover, cruise and landing and bounds high-speed offsets', () => {
    let state = groundedFlightPresentation();
    state = flightPresentation(state, { airborne: true, velocity: { x: 0, y: 3, z: 0 } }, 1 / 60);
    expect(state.phase).toBe('launch'); expect(state.weight).toBeLessThan(.2);
    for (let i = 0; i < 120; i++) state = flightPresentation(state, { airborne: true, velocity: { x: 0, y: 0, z: 0 } }, 1 / 60);
    expect(state.phase).toBe('hover'); expect(state.pitch).toBeCloseTo(0);
    for (let i = 0; i < 120; i++) state = flightPresentation(state, { airborne: true, velocity: { x: 100, y: 0, z: -1000 } }, 1 / 60);
    expect(state.phase).toBe('cruise'); expect(state.pitch).toBeGreaterThan(1.2); expect(state.pitch).toBeLessThanOrEqual(1.3);
    expect(Math.abs(state.bank)).toBeLessThanOrEqual(.24);
    state = flightPresentation(state, { airborne: false, velocity: { x: 0, y: 0, z: 0 } }, 1 / 60);
    expect(state.phase).toBe('landing'); expect(state.pitch).toBeGreaterThan(.5);
    for (let i = 0; i < 240; i++) state = flightPresentation(state, undefined, 1 / 60);
    expect(state.phase).toBe('ground'); expect(state.weight).toBe(0); expect(state.pitch).toBeCloseTo(0, 7);
  });

  it('distinguishes ascent, descent and braking without inferring magical power', () => {
    const hover = { ...groundedFlightPresentation(), weight: 1 };
    expect(flightPresentation(hover, { airborne: true, velocity: { x: 0, y: 40, z: 0 } }, .05).phase).toBe('ascent');
    expect(flightPresentation(hover, { airborne: true, velocity: { x: 0, y: -40, z: 0 } }, .05).phase).toBe('descent');
    expect(flightPresentation({ ...hover, speed: 50, totalSpeed: 50 }, { airborne: true, velocity: { x: 0, y: 0, z: -20 } }, .05).phase).toBe('brake');
    const invalid = flightPresentation(hover, { airborne: true, velocity: { x: NaN, y: 0, z: 0 } }, Infinity);
    expect(Object.values(invalid).filter(v => typeof v === 'number').every(Number.isFinite)).toBe(true);
  });

  it('does not mistake a rotating radial frame for braking during constant-speed passage', () => {
    let state = { ...groundedFlightPresentation(), weight: 1, speed: 850, totalSpeed: 850 };
    for (let i = 0; i <= 120; i++) {
      const angle = i / 120 * Math.PI;
      state = flightPresentation(state, { airborne: true, velocity: {
        x: Math.sin(angle) * 850, y: Math.cos(angle) * 850, z: 0,
      } }, 1 / 60);
      expect(state.phase).not.toBe('brake');
      expect(state.totalSpeed).toBeCloseTo(850, 8);
    }
    // Real deceleration is still detected, including a vertical trajectory
    // where the horizontal component is zero.
    state = flightPresentation(state, { airborne: true, velocity: { x: 0, y: -400, z: 0 } }, .05);
    expect(state.phase).toBe('brake');
  });

  it('reaches into actual ascent/forward velocity while keeping backward and feet-first travel open', () => {
    const settled = (velocity: Vector3, dt = 1 / 60) => {
      let state = groundedFlightPresentation();
      for (let i = 0; i < Math.round(2 / dt); i++) state = flightPresentation(state, { airborne: true, velocity }, dt);
      return state;
    };
    const ascent = settled(new Vector3(0, 154, 0)), cruise = settled(new Vector3(0, 0, -850));
    expect(ascent.phase).toBe('ascent'); expect(ascent.reach).toBeGreaterThan(.99); expect(ascent.pitch).toBe(0);
    expect(cruise.pitch).toBeGreaterThan(1.29); expect(cruise.reach).toBeGreaterThan(.99);
    for (const velocity of [new Vector3(0, -154, 0), new Vector3(0, 0, 80), new Vector3(80, 0, 0)]) {
      const state = settled(velocity);
      expect(state.reach).toBe(0); expect(Math.abs(state.pitch)).toBeLessThanOrEqual(.18);
    }
    // Same elapsed time yields the same pose at common presentation rates.
    for (const dt of [1 / 30, 1 / 120]) {
      const other = settled(new Vector3(0, 0, -850), dt);
      for (const key of ['pitch', 'bank', 'reach', 'weight'] as const) expect(other[key]).toBeCloseTo(cruise[key], 10);
    }
  });

  it('places reaching hands above the head or ahead of cruise on imported rigs at rotated latitudes', () => {
    const engine = new NullEngine(), scene = new Scene(engine);
    try {
      for (const radial of [Vector3.Up(), new Vector3(.2, -.7, .5).normalize()]) {
        for (const velocity of [new Vector3(0, 154, 0), new Vector3(0, 0, -850)]) {
          const parent = new TransformNode('actor', scene), root = new TransformNode('import +Z', scene);
          parent.position.set(12, -7, 30); parent.rotationQuaternion = avatarRotation(Vector3.Forward(true), radial);
          root.parent = parent; root.rotation.y = Math.PI;
          const bones = new Map<string, TransformNode>();
          const bone = (name: string, p: TransformNode, point: Vector3) => {
            const node = new TransformNode(name, scene); node.parent = p; node.position.copyFrom(point);
            node.rotationQuaternion = Quaternion.Identity(); bones.set(name, node); return node;
          };
          // Fresh authored idle: upper arms hang about 25 degrees off down.
          for (const [side, sign] of [['l', 1], ['r', -1]] as const) {
            const upper = bone(`upperarm_${side}`, root, new Vector3(sign * .19, 1.4, 0));
            const lower = bone(`lowerarm_${side}`, upper, new Vector3(sign * .14, -.3, .02));
            bone(`hand_${side}`, lower, new Vector3(sign * .04, -.26, .01));
          }
          const head = bone('head', root, new Vector3(0, 1.7, 0));
          const actorBefore = parent.computeWorldMatrix(true).clone(), inverse = Matrix.Invert(actorBefore);
          const pose = new FlightPose({ root, bones } as CharacterInstance, parent, 1.75);
          for (let i = 0; i < 120; i++) pose.update({ airborne: true, velocity }, 1 / 60);
          pose.apply();
          const local = (node: TransformNode) => { node.computeWorldMatrix(true); return Vector3.TransformCoordinates(node.getAbsolutePosition(), inverse); };
          const headPoint = local(head), hands = ['l', 'r'].map(side => local(bones.get(`hand_${side}`)!));
          for (const hand of hands) {
            if (velocity.y > 0) expect(hand.y).toBeGreaterThan(headPoint.y + .15);
            else expect(hand.z).toBeLessThan(headPoint.z - .15);
          }
          expect(Vector3.Distance(hands[0], hands[1])).toBeGreaterThan(.35);
          expect(parent.getWorldMatrix().asArray()).toEqual(actorBefore.asArray());
          const first = hands.map(p => p.clone()); pose.apply();
          ['l', 'r'].forEach((side, i) => expect(Vector3.Distance(local(bones.get(`hand_${side}`)!), first[i])).toBeLessThan(1e-5));
          pose.restore();
          for (const node of bones.values()) expect(Math.abs(Quaternion.Dot(node.rotationQuaternion!, Quaternion.Identity()))).toBeCloseTo(1, 6);
          parent.dispose();
        }
      }
    } finally { scene.dispose(); engine.dispose(); }
  });

  it('measures anatomical spine tilt against the actor radial frame at every latitude', () => {
    const scene = new Scene(new NullEngine()), sphere = new TransformNode('sphere-frame', scene), actor = new TransformNode('actor', scene);
    actor.parent = sphere; actor.position.set(3, 7, -9); actor.rotation.y = .8;
    try {
      for (const up of [Vector3.Up(), Vector3.Down(), new Vector3(0, .3216, .9469).normalize(), Vector3.Right()]) {
        sphere.rotationQuaternion = avatarRotation(new Vector3(0, 0, -1), up);
        const matrix = actor.computeWorldMatrix(true);
        const hip = Vector3.TransformCoordinates(new Vector3(0, 1, 0), matrix);
        const aligned = Vector3.TransformCoordinates(new Vector3(0, 1.5, 0), matrix);
        expect(spineTiltDegrees(actor, hip.asArray(), aligned.asArray())).toBeCloseTo(0, 4);
        const angle = Math.PI / 8;
        const leaned = Vector3.TransformCoordinates(new Vector3(0, 1 + Math.cos(angle) * .5, Math.sin(angle) * .5), matrix);
        expect(spineTiltDegrees(actor, hip.asArray(), leaned.asArray())).toBeCloseTo(22.5, 4);
      }
    } finally { scene.dispose(); }
  });

  it('preserves grounded transforms, restores fresh joint poses, and never accumulates the flight overlay', () => {
    const scene = new Scene(new NullEngine()), parent = new TransformNode('actor', scene), root = new TransformNode('import', scene);
    root.parent = parent; root.rotation.y = Math.PI; root.position.y = .04; root.scaling.setAll(1.22);
    const bones = new Map<string, TransformNode>();
    const bone = (name: string, p: TransformNode, x: number, y: number, z: number) => {
      const n = new TransformNode(name, scene); n.parent = p; n.position.set(x, y, z); n.rotationQuaternion = Quaternion.Identity(); bones.set(name, n); return n;
    };
    const arm = bone('upperarm_l', root, .2, 1.4, 0), lower = bone('lowerarm_l', arm, .22, -.22, 0);
    bone('hand_l', lower, .2, -.2, 0);
    const before = root.computeWorldMatrix(true).clone();
    const pose = new FlightPose({ root, bones } as CharacterInstance, parent, 1.75);
    for (let i = 0; i < 16; i++) expect(root.computeWorldMatrix(true).asArray()[i]).toBeCloseTo(before.asArray()[i], 6);
    const original = arm.rotationQuaternion!.clone();
    for (let i = 0; i < 120; i++) pose.update({ airborne: true, velocity: { x: 0, y: 0, z: -80 } }, 1 / 60);
    pose.apply(); const first = arm.rotationQuaternion!.clone();
    expect(Math.abs(Quaternion.Dot(first, original))).toBeLessThan(.999);
    pose.apply(); expect(Math.abs(Quaternion.Dot(first, arm.rotationQuaternion!))).toBeCloseTo(1, 6);
    pose.restore(); expect(arm.rotationQuaternion!.asArray()).toEqual(original.asArray());
    for (let i = 0; i < 240; i++) pose.update(undefined, 1 / 60);
    pose.apply();
    const after = root.computeWorldMatrix(true);
    for (let i = 0; i < 16; i++) expect(after.asArray()[i]).toBeCloseTo(before.asArray()[i], 6);
    expect(parent.position.asArray()).toEqual([0, 0, 0]);
    scene.dispose();
  });
});

describe('audited human sources and optical roles', () => {
  it('maps the actual UAL Head and full fingers without grouped UE finger assumptions', () => {
    expect(UAL.map.find(p => p[1] === 'head')?.[0]).toBe('Head');
    expect(UAL.map.find(p => p[1] === 'pinky_03_l')?.[0]).toBe('pinky_03_l');
    expect(UAL.map.some(p => /fingers_/.test(p[0]))).toBe(false);
    expect(UAL_CLIPS['unarmed/idle_neutral']).toBe('Idle_Loop');
  });
  it('refuses an HTTP HTML fallback as animation bytes', async () => {
    await expect(verifyHumanMotion(new TextEncoder().encode('<!doctype html>'))).rejects.toThrow('size');
  });
  it('treats verified skin and eyes differently while preserving authored texture colour', () => {
    const scene = new Scene(new NullEngine());
    try {
      const skin = new PBRMaterial('Human.body', scene), eye = new PBRMaterial('Human.low-poly', scene);
      const unknown = new PBRMaterial('somebody-armour', scene), old = unknown.roughness;
      const color = skin.albedoColor.asArray();
      refineImportedHumanMaterial(skin, scene); refineImportedHumanMaterial(eye, scene); refineImportedHumanMaterial(unknown, scene);
      expect(skin.roughness).toBe(.53); expect(eye.roughness).toBe(.18); expect(unknown.roughness).toBe(old);
      expect(skin.albedoColor.asArray()).toEqual(color);
      expect(importedHumanMaterialRole('Human.elvs_french_braid_variation')).toBe('hair');
      expect(importedHumanMaterialRole('Human.mindfront_lusekofta')).toBe('cloth');
      expect(importedHumanMaterialRole('Human.body-armour')).toBeNull();
    } finally { scene.dispose(); }
  });
});
