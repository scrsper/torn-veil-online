import { describe, expect, it } from 'vitest';
import { Animator, effectiveAnimationSpeed } from '../src/web/arena/anim';
import { footContact } from '../src/web/arena/footPlant';

describe('arena human motion clocks', () => {
  it('uses retargeted ankle contact hysteresis without locking a high swing', () => {
    expect(footContact(.18, .086, 1.22, false)).toBe(false);
    expect(footContact(.16, .086, 1.22, false)).toBe(true);
    expect(footContact(.21, .086, 1.22, true)).toBe(true);
    expect(footContact(.23, .086, 1.22, true)).toBe(false);
  });

  it('scales authored clip speed by the body clock and clamps frozen bodies', () => {
    expect(effectiveAnimationSpeed(1.4, 0)).toBe(0);
    expect(effectiveAnimationSpeed(1.4, .5)).toBeCloseTo(.7);
    expect(effectiveAnimationSpeed(1.4, 1)).toBeCloseTo(1.4);
    expect(effectiveAnimationSpeed(1.4, -1)).toBe(0);
  });

  it('applies the body clock to the leg-only locomotion layer', () => {
    const calls: number[] = [];
    const leg = {
      from: 0, to: 30, isPlaying: false, speedRatio: 0,
      stop: () => { leg.isPlaying = false; },
      start: (_loop: boolean, speed: number) => { leg.isPlaying = true; calls.push(speed); },
      setWeightForAllAnimatables: () => undefined,
    } as any;
    const animator = new Animator(new Map([['legs:walk', leg]]));
    animator.timeScale = 0;
    animator.legLayer('walk', 1.25);
    expect(calls.at(-1)).toBe(0);
    animator.timeScale = .4;
    animator.update(.1);
    expect(leg.speedRatio).toBeCloseTo(.5);
  });

  it('stops and clears a leg layer with the rest of the animator', () => {
    let stopped = 0;
    const leg = {
      from: 0, to: 30, isPlaying: false, speedRatio: 1,
      stop: () => { stopped++; }, start: () => undefined,
      setWeightForAllAnimatables: () => undefined,
    } as any;
    const animator = new Animator(new Map([['legs:walk', leg]]));
    animator.legLayer('walk');
    animator.stopAll();
    expect(stopped).toBe(2);
    animator.update(.1);
    expect(stopped).toBe(2);
  });

  it('carries normalized gait phase across a directional leg change', () => {
    const frames: number[] = [];
    const stops: number[] = [];
    const makeLeg = (phaseFrame: number | undefined, id: number) => {
      const g = {
        from: 10, to: 50, isPlaying: false, speedRatio: 1,
        animatables: phaseFrame === undefined ? [] : [{ masterFrame: phaseFrame }],
        stop: () => { g.isPlaying = false; stops.push(id); },
        start: () => { g.isPlaying = true; },
        goToFrame: (frame: number) => frames.push(frame),
        setWeightForAllAnimatables: () => undefined,
      } as any;
      return g;
    };
    const forward = makeLeg(30, 1);
    const strafe = makeLeg(undefined, 2);
    const animator = new Animator(new Map([['legs:forward', forward], ['legs:strafe', strafe]]));
    animator.legLayer('forward');
    // Replace the start-time mock frame with the active outgoing frame.
    forward.animatables = [{ masterFrame: 30 }];
    animator.legLayer('strafe');
    expect(frames.at(-1)).toBeCloseTo(30);
    expect(stops).toEqual([1, 1, 2]); // initial reset, owned outgoing stop, replacement reset
  });
});
