import { describe, expect, it } from 'vitest';
import { hurtVolumes, strikePoint, sweepSphereContact } from '../src/sim/physical/combatGeometry';
import type { Body } from '../src/sim/core/types';

function body(overrides: Partial<Pick<Body, 'shape' | 'pos' | 'yaw'>> = {}): Pick<Body, 'shape' | 'pos' | 'yaw'> {
  return { shape: 'humanoid', pos: { x: 0, y: 0, z: 0 }, yaw: 0, ...overrides };
}

describe('realtime combat geometry', () => {
  it('derives the complete humanoid contact regions from body pose', () => {
    const regions = hurtVolumes(body()).map(volume => volume.region);
    expect(regions).toEqual(['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']);
  });

  it('lowers the upper hurt volumes while ducking and preserves left/right anatomy', () => {
    const standing = hurtVolumes(body());
    const ducked = hurtVolumes(body(), 1);
    for (const region of ['head', 'torso', 'leftArm', 'rightArm'] as const) {
      const before = standing.find(volume => volume.region === region)!;
      const after = ducked.find(volume => volume.region === region)!;
      expect(after.center.y).toBeLessThan(before.center.y);
    }
    expect(ducked.find(volume => volume.region === 'leftArm')!.center.x).toBeLessThan(0);
    expect(ducked.find(volume => volume.region === 'rightArm')!.center.x).toBeGreaterThan(0);
  });

  it('uses relative swept motion to detect contact when both endpoints miss', () => {
    expect(sweepSphereContact(
      { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, .1,
      { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }, .1,
    )).toBeCloseTo(0.4292893219);
    expect(sweepSphereContact(
      { x: -1, y: 0, z: 0 }, { x: -.8, y: 0, z: 0 }, .1,
      { x: 1, y: 0, z: 0 }, { x: 1.2, y: 0, z: 0 }, .1,
    )).toBeNull();
  });

  it('keeps strike trajectory heights distinct and deterministic', () => {
    const high = strikePoint({ x: 0, y: 0, z: 0 }, 0, 1.2, 1, 'high');
    const mid = strikePoint({ x: 0, y: 0, z: 0 }, 0, 1.2, 1, 'mid');
    const low = strikePoint({ x: 0, y: 0, z: 0 }, 0, 1.2, 1, 'low');
    expect(high.y).toBeGreaterThan(mid.y);
    expect(mid.y).toBeGreaterThan(low.y);
    expect(strikePoint({ x: 0, y: 0, z: 0 }, 0, 1.2, 1, 'high')).toEqual(high);
  });

  it('makes ducking alter high contact geometry while leaving low contact geometry available', () => {
    const high = strikePoint({ x: 0, y: 0, z: 0 }, -Math.PI / 2, 1.2, 1, 'high');
    const low = strikePoint({ x: 0, y: 0, z: 0 }, -Math.PI / 2, 1.2, 1, 'low');
    const standing = hurtVolumes(body({ pos: { x: 1.2, y: 0, z: 0 } }));
    const ducked = hurtVolumes(body({ pos: { x: 1.2, y: 0, z: 0 } }), 1);
    const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const touching = (point: typeof high, volume: (typeof standing)[number]) => distance(point, volume.center) <= .12 + volume.radius;
    expect(touching(high, standing.find(v => v.region === 'head')!)).toBe(true);
    expect(touching(high, ducked.find(v => v.region === 'head')!)).toBe(false);
    expect(touching(low, ducked.find(v => v.region === 'leftLeg')!)).toBe(true);
  });
});
