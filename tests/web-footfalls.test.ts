import { describe, expect, it } from 'vitest';
import { B } from '../src/sim/physical/blocks';
import { ContactFootfalls, footSurface, footfallSpatial } from '../src/web/audio/footfalls';

describe('contact-timed footfalls', () => {
  const frame = (contacts: readonly [boolean, boolean], extra = {}) => ({ contacts, dt: .16 / 2, speed: 2, active: true, position: { x: 0, y: 0, z: 0 }, ...extra });
  it('emits swing-to-support edges once and never plays an initial/spawned support', () => {
    const f = new ContactFootfalls();
    expect(f.update(frame([true, false]))).toEqual([]);
    expect(f.update(frame([true, false]))).toEqual([]);
    expect(f.update(frame([false, true]))).toEqual([1]);
    expect(f.update(frame([false, true]))).toEqual([]);
    expect(f.update(frame([true, false]))).toEqual([0]);
  });
  it('suppresses idle, actions, missing masks, large frame gaps and teleports', () => {
    for (const extra of [{ active: false }, { speed: 0 }, { contacts: undefined }, { dt: .5 }, { position: { x: 100, y: 0, z: 0 } }]) {
      const f = new ContactFootfalls(); f.update(frame([false, true]));
      expect(f.update(frame([true, false], extra))).toEqual([]);
      expect(f.update(frame([true, false]))).toEqual([]);
    }
  });
  it('bounds double support and rapid transition chatter without delaying a normal next step', () => {
    const f = new ContactFootfalls(); f.update(frame([false, false]));
    expect(f.update(frame([true, true]))).toEqual([0]);
    f.update(frame([false, false], { dt: .01 }));
    expect(f.update(frame([true, true], { dt: .01 }))).toEqual([]);
    f.update(frame([false, true]));
    expect(f.update(frame([true, false]))).toEqual([0]);
  });
  it('reset cannot replay the last support edge', () => {
    const f = new ContactFootfalls(); f.update(frame([false, true])); f.reset();
    expect(f.update(frame([true, false]))).toEqual([]);
  });
});

describe('projected footstep surface and audibility', () => {
  it('retains water, paths, wood and indoor stone instead of making every interior wooden', () => {
    expect(footSurface(B.Water)).toBe('water'); expect(footSurface(B.Path)).toBe('dirt');
    expect(footSurface(B.DarkPlanks)).toBe('wood'); expect(footSurface(B.StoneBrick, true)).toBe('stone');
    expect(footSurface(B.Grass, true)).toBe('grass'); expect(footSurface(null, true)).toBe('wood');
  });
  it('pans with the camera and culls distant steps with a continuous falloff', () => {
    const listener = { x: 0, y: 0, z: 0 }, forward = { x: 0, y: 0, z: -1 };
    expect(footfallSpatial({ x: 2, y: 0, z: 0 }, listener, forward).pan).toBe(.85);
    expect(footfallSpatial({ x: -2, y: 0, z: 0 }, listener, forward).pan).toBe(-.85);
    expect(footfallSpatial({ x: 2, y: 0, z: 0 }, listener, { x: 0, y: 0, z: 1 }).pan).toBe(-.85);
    expect(footfallSpatial({ x: 14, y: 0, z: 0 }, listener, forward).gain).toBe(0);
    expect(footfallSpatial(listener, listener, forward)).toEqual({ gain: 1, pan: 0 });
  });
});
