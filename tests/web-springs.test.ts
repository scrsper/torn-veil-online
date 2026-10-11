import { describe, expect, it } from 'vitest';
import { NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { SpringBones } from '../src/web/arena/springs';

function rig() {
  const engine = new NullEngine(), scene = new Scene(engine);
  const root = new TransformNode('root', scene);
  const hair1 = new TransformNode('hair_1', scene), hair2 = new TransformNode('hair_2', scene);
  hair1.parent = root; hair2.parent = hair1;
  hair1.position.y = .12; hair2.position.y = .10;
  hair1.rotationQuaternion = Quaternion.Identity(); hair2.rotationQuaternion = Quaternion.Identity();
  root.computeWorldMatrix(true);
  return { engine, scene, root, hair1, hair2, springs: new SpringBones(new Map([['hair_1', hair1], ['hair_2', hair2]]), 1) };
}

function run(frame: number) {
  const r = rig();
  r.springs.update(0); r.springs.update(frame);
  for (let t = frame; t < 1 - 1e-8; t += frame) {
    r.root.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.sin(t * 3) * .25);
    r.root.computeWorldMatrix(true); r.springs.update(Math.min(frame, 1 - t));
  }
  const q = r.hair1.rotationQuaternion!.clone();
  r.scene.dispose(); r.engine.dispose();
  return q;
}

function runFixedPose(frame: number) {
  const r = rig();
  r.root.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), .5);
  r.root.computeWorldMatrix(true); r.springs.update(frame);
  for (let t = frame; t < .5 - 1e-8; t += frame) r.springs.update(Math.min(frame, .5 - t));
  const q = r.hair1.rotationQuaternion!.clone();
  r.scene.dispose(); r.engine.dispose();
  return q;
}

function angularDistance(a: Quaternion, b: Quaternion): number {
  const dot = Math.abs(Quaternion.Dot(a, b));
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

describe('arena spring bones', () => {
  it('is frame-rate invariant for an identical anchored pose', () => {
    const a = runFixedPose(1 / 30), b = runFixedPose(1 / 120);
    expect(angularDistance(a, b)).toBeLessThan(1e-4);
  });

  it('is stable across render rates over the same elapsed time', () => {
    const a = run(1 / 30), b = run(1 / 120);
    expect(a.asArray().every(Number.isFinite)).toBe(true); expect(b.asArray().every(Number.isFinite)).toBe(true);
    // Compare the full orientation; x/y-only comparisons are vacuous for a
    // chain whose visible bend is primarily around the z axis.
    expect(angularDistance(a, b)).toBeLessThan(0.02);
  });

  it('snaps safely after a teleport instead of producing non-finite rotations', () => {
    const r = rig();
    r.springs.update(1 / 60); r.root.position.x = 100; r.root.computeWorldMatrix(true); r.springs.update(1 / 60);
    const q = r.hair1.rotationQuaternion!;
    expect(q.asArray().every(Number.isFinite)).toBe(true);
    // A teleport must settle to the rest direction immediately, rather than
    // carrying a displacement impulse from the old world position.
    expect(angularDistance(q, Quaternion.Identity())).toBeLessThan(0.05);
    r.scene.dispose(); r.engine.dispose();
  });
});
