import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { combatPose, type CombatContext } from '../src/web/actors/combatPose';

function sample(moveId: string, age: number, heavy = false) {
  const bones = new Map<string, Quaternion>();
  const pose = { pelvis: new Vector3(), clear() { bones.clear(); }, set(name: string, q: Quaternion) { bones.set(name, q); } };
  const context: CombatContext = { moveId, age, prep: heavy ? .39 : .26, active: .15, recovery: heavy ? .405 : .27, weight: heavy ? 'heavy' : 'light' };
  return { ...combatPose(pose, context, 1), bones, context };
}

describe('combat presentation phase alignment', () => {
  for (const move of ['jab', 'cross']) for (const heavy of [false, true]) {
    it(`${move} ${heavy ? 'heavy' : 'light'} reaches the contact pose at the first active tick`, () => {
      const start = sample(move, 0, heavy), prep = start.context.prep;
      const before = sample(move, prep - .00001, heavy), active = sample(move, prep, heavy);
      const arm = move === 'jab' ? 'lowerarm_l' : 'lowerarm_r';
      expect(Quaternion.Dot(before.bones.get(arm)!, active.bones.get(arm)!)).toBeGreaterThan(.999999);
      const expected = Quaternion.RotationAxis(Vector3.Right(), -.15);
      expect(Math.abs(Quaternion.Dot(active.bones.get(arm)!, expected))).toBeCloseTo(1, 6);
      expect(active.weight).toBe(1);
      const recoveryAt = prep + active.context.active;
      const lastActive = sample(move, recoveryAt - .00001, heavy), recovery = sample(move, recoveryAt, heavy);
      expect(Quaternion.Dot(lastActive.bones.get(arm)!, recovery.bones.get(arm)!)).toBeGreaterThan(.999999);
    });
  }
  for (const move of ['jab', 'cross', 'front_kick', 'round_kick', 'sidestep', 'backstep', 'duck']) {
    it(`${move} body offset fades to zero at action boundaries`, () => {
      const start = sample(move, 0), c = start.context, end = c.prep + c.active + c.recovery;
      expect(start.pelvis.length()).toBe(0);
      expect(sample(move, end).pelvis.length()).toBe(0);
      expect(sample(move, end - .001).pelvis.length()).toBeLessThan(.0001);
    });
  }
});
