import { describe, expect, it } from 'vitest';
import { contactHints, supportPhase, wrapPhase } from '../src/web/arena/gaitPhase';
import { sharedTravelClip } from '../src/web/actors/sharedMotion';

describe('contact-derived gait phase', () => {
  it('finds opposite authored support phases, ignoring double support and the duplicate endpoint', () => {
    const left = Uint8Array.from([0, 1, 1, 1, 0, 0, 0, 0, 0]);
    const right = Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 1, 0]);
    expect(supportPhase([left, right])).toBeCloseTo(.25);
    expect(supportPhase([right, left])).toBeCloseTo(.75);
    left[0] = right[0] = left[8] = right[8] = 1;
    expect(supportPhase([left, right])).toBeCloseTo(.25);
    expect(wrapPhase(-.25)).toBe(.75);
  });
  it('has a stable fallback when no alternating support can be inferred', () => {
    expect(supportPhase(null)).toBe(0);
    expect(supportPhase([new Uint8Array(10).fill(1), new Uint8Array(10).fill(1)])).toBe(0);
  });
  it('samples per-foot source support and preserves the geometric fallback for missing clips', () => {
    const clips = new Map([['walk', { contact: [Uint8Array.from([1, 0, 1]), Uint8Array.from([0, 1, 0])] }]]) as never;
    expect(contactHints({ name: 'walk', frame: 1.7 }, clips)).toEqual([false, true]);
    expect(contactHints({ name: 'walk', frame: 99 }, clips)).toEqual([true, false]);
    expect(contactHints({ name: 'missing', frame: 0 }, clips)).toBeUndefined();
    expect(contactHints(null, clips)).toBeUndefined();
  });
  it('holds direction near a diagonal but changes once travel clearly favors the new axis', () => {
    const moving = (x: number, z: number) => ({ velocity: { x, y: 0, z }, yaw: 0 });
    const forward = 'unarmed/walk_forward', side = 'unarmed/walk_strafe_right';
    expect(sharedTravelClip(moving(1.03, -1), forward)).toBe(forward);
    expect(sharedTravelClip(moving(.97, -1), side)).toBe(side);
    expect(sharedTravelClip(moving(1.3, -1), forward)).toBe(side);
    expect(sharedTravelClip(moving(.7, -1), side)).toBe(forward);
    expect(sharedTravelClip(moving(0, 1), forward)).toBe('unarmed/walk_backward');
  });
});
