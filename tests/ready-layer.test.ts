import { describe, it, expect } from 'vitest';
import { Animation, Quaternion, Vector3 } from '@babylonjs/core';
import { layeredClip } from '../src/web/arena/assets';
import type { ClipTemplate } from '../src/web/arena/retarget';

/** A quaternion track rotating about x from 0 to `end` radians over `frames` keys. */
const track = (bone: string, frames: number, fps: number, end: number) => {
  const a = new Animation(`${bone}`, 'rotationQuaternion', fps, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
  a.setKeys(Array.from({ length: frames }, (_, i) => ({ frame: i, value: Quaternion.RotationAxis(Vector3.Right(), end * i / (frames - 1)) })));
  return { bone, anim: a };
};
const clip = (name: string, frames: number, fps: number, tracks: ClipTemplate['tracks'], stance: number): ClipTemplate =>
  ({ name, frames, fps, tracks, swing: Array.from({ length: frames }, (_, i) => i), contact: [Uint8Array.from({ length: frames }, (_, i) => i % 2), Uint8Array.from({ length: frames }, () => 1)], stance });
const angle = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

describe('ready-stance layered clips', () => {
  it('resamples arm tracks onto the body cycle and keeps body timing, contacts and stride', () => {
    const body = clip('body', 31, 30, [track('pelvis', 31, 30, .2), track('thigh_l', 31, 30, .4), track('upperarm_l', 31, 30, 9)], 1.7);
    const arms = clip('arms', 49, 24, [track('upperarm_l', 49, 24, 1.2), track('hand_r', 49, 24, .6), track('index_01_r', 49, 24, .3), track('spine_02', 49, 24, 2)], 0);
    const before = arms.tracks.map(t => t.anim.getKeys().length);
    const r = layeredClip('ready/test', body, arms);
    expect(r.frames).toBe(31); expect(r.fps).toBe(30); expect(r.stance).toBe(1.7); expect(r.contact).toBe(body.contact);
    // Body bones from the body clip (its own upperarm is replaced), arm bones (fingers included) from the arm clip.
    expect(r.tracks.map(t => t.bone).sort()).toEqual(['hand_r', 'index_01_r', 'pelvis', 'thigh_l', 'upperarm_l']);
    expect(r.tracks.find(t => t.bone === 'pelvis')!.anim).toBe(body.tracks[0].anim);
    for (const bone of ['upperarm_l', 'hand_r', 'index_01_r']) {
      const a = r.tracks.find(t => t.bone === bone)!.anim, src = arms.tracks.find(t => t.bone === bone)!.anim;
      expect(a.framePerSecond).toBe(30); expect(a.getKeys()).toHaveLength(31);
      // Same normalised phase: first, middle and last keys match the source at 0, 50% and 100% of its cycle.
      for (const [i, p] of [[0, 0], [15, .5], [30, 1]] as const) expect(Math.abs(angle(a.getKeys()[i].value) - angle(src.evaluate(p * 48)))).toBeLessThan(1e-6);
    }
    // Originals untouched.
    expect(arms.tracks.map(t => t.anim.getKeys().length)).toEqual(before);
    expect(r.swing).toHaveLength(31); expect(r.swing[30]).toBe(48);
  });
});
