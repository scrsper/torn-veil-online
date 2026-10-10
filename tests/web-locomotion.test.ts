import { describe, expect, it } from 'vitest';
import { NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { gaitForSpeed, localTravel, sampleFoot } from '../src/web/actors/locomotion';
import { solveTwoBone } from '../src/web/actors/twoBoneIK';

describe('human gait', () => {
  it.each([.7, 1, 1.2])('matches planted foot retreat to travel at stature %s', stature => {
    for (const speed of [.5, 1.5, 3, 5.5]) {
      const gait = gaitForSpeed(speed, stature), dt = .002;
      const a = sampleFoot(.1, gait), b = sampleFoot(.1 + speed * dt / gait.cycleDistance, gait);
      expect(a.planted && b.planted).toBe(true);
      expect((a.travel - b.travel) / dt).toBeCloseTo(speed, 8);
      expect(a.lift).toBe(0);
    }
  });
  it('returns continuously from toe-off to heel strike without negative ground clearance', () => {
    for (const speed of [1.5, 4.6]) {
      const gait = gaitForSpeed(speed);
      for (const boundary of [0, gait.stance, 1]) {
        const a = sampleFoot(boundary - 1e-7, gait), b = sampleFoot(boundary + 1e-7, gait);
        expect(Math.abs(a.travel - b.travel)).toBeLessThan(1e-5);
        expect(Math.abs(a.lift - b.lift)).toBeLessThan(1e-5);
      }
      for (let i = 0; i < 100; i++) expect(sampleFoot(i / 100, gait).lift).toBeGreaterThanOrEqual(0);
      expect(sampleFoot(.8, gait)).toEqual(sampleFoot(1.8, gait));
    }
  });
  it('resolves forwards, backwards and strafes in the body frame at any facing', () => {
    expect(localTravel({ x: 0, z: -2 }, 0).x).toBeCloseTo(0);
    expect(localTravel({ x: 0, z: -2 }, 0).z).toBeCloseTo(1);
    expect(localTravel({ x: 0, z: 2 }, 0).z).toBeCloseTo(-1);
    expect(localTravel({ x: -2, z: 0 }, 0).x).toBeCloseTo(1);
    expect(localTravel({ x: -2, z: 0 }, Math.PI / 2).z).toBeCloseTo(1);
    expect(localTravel({ x: 0, z: 0 }, 1)).toEqual({ x: 0, z: 0 });
  });
});

describe('visual limb placement', () => {
  function limb() {
    const engine = new NullEngine(), scene = new Scene(engine);
    const upper = new TransformNode('thigh', scene), lower = new TransformNode('calf', scene), end = new TransformNode('ankle', scene);
    lower.parent = upper; end.parent = lower;
    upper.position.y = 1; lower.position.y = -.5; end.position.y = -.5;
    for (const node of [upper, lower, end]) node.rotationQuaternion = Quaternion.Identity();
    return { upper, lower, end, scene, dispose: () => { scene.dispose(); engine.dispose(); } };
  }
  it('plants the ankle without changing body position or limb lengths', () => {
    const l = limb(), target = new Vector3(.15, .12, .3);
    solveTwoBone(l.upper, l.lower, l.end, target, new Vector3(0, .5, 2));
    l.end.computeWorldMatrix(true);
    expect(Vector3.Distance(l.end.absolutePosition, target)).toBeLessThan(1e-5);
    expect(l.upper.position.asArray()).toEqual([0, 1, 0]);
    expect(l.lower.position.length()).toBeCloseTo(.5); expect(l.end.position.length()).toBeCloseTo(.5);
    l.dispose();
  });
  it('handles opposite direction, unreachable and coincident targets without NaNs', () => {
    for (const target of [new Vector3(0, 3, 0), new Vector3(0, 1, 0), new Vector3(100, 100, 100)]) {
      const l = limb();
      solveTwoBone(l.upper, l.lower, l.end, target, target);
      l.end.computeWorldMatrix(true);
      expect(l.end.absolutePosition.asArray().every(Number.isFinite)).toBe(true);
      expect(Vector3.Distance(l.upper.absolutePosition, l.end.absolutePosition)).toBeLessThanOrEqual(1.00001);
      if (target.y === 3) expect(l.end.absolutePosition.y).toBeGreaterThan(1.9);
      l.dispose();
    }
  });
  it('preserves contact for broad and short characters under rotated, non-uniform roots', () => {
    const l = limb(), root = new TransformNode('character', l.scene);
    root.scaling.set(1.3, .7, 1.3); root.rotationQuaternion = Quaternion.RotationYawPitchRoll(.8, 0, 0);
    l.upper.parent = root; root.computeWorldMatrix(true);
    const target = Vector3.TransformCoordinates(new Vector3(.12, .12, .25), root.getWorldMatrix());
    const pole = Vector3.TransformCoordinates(new Vector3(0, .5, 2), root.getWorldMatrix());
    solveTwoBone(l.upper, l.lower, l.end, target, pole, 1, root);
    expect(Vector3.Distance(l.end.absolutePosition, target)).toBeLessThan(1e-5);
    l.dispose();
  });
});
