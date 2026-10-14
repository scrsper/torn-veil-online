import { describe, expect, it } from 'vitest';
import { Animator } from '../src/web/arena/anim';

function group() {
  const g = {
    from: 10, to: 110, isPlaying: false, speedRatio: 1, weight: 0,
    targetedAnimations: [{ animation: { framePerSecond: 100 } }],
    animatables: [{ masterFrame: 10 }], starts: [] as number[][],
    start(loop: boolean, speed: number, from: number, to: number) { g.isPlaying = true; g.starts.push([Number(loop), speed, from, to]); },
    stop() { g.isPlaying = false; g.weight = 0; },
    goToFrame(frame: number) { g.animatables[0].masterFrame = frame; },
    setWeightForAllAnimatables(w: number) { g.weight = w; },
  };
  return g;
}
const animator = (groups: Map<string, ReturnType<typeof group>>, phases?: Map<string, number>) => new Animator(groups as never, phases);

describe('human animation transitions', () => {
  it('seeks inside the full loop range instead of looping a truncated stride', () => {
    const walk = group(), a = animator(new Map([['walk', walk]]));
    a.play('walk', { loop: true, from: .6 }); a.update(.016);
    expect(walk.starts[0].slice(2)).toEqual([10, 110]);
    expect(walk.animatables[0].masterFrame).toBeCloseTo(70);
    expect(walk.weight).toBeCloseTo(1);
  });

  it('keeps interrupted fades normalized without restarting a returning clip', () => {
    const walk = group(), idle = group(), hit = group();
    const a = animator(new Map([['walk', walk], ['idle', idle], ['hit', hit]]));
    a.play('walk'); a.update(.3);
    for (const name of ['idle', 'hit', 'walk', 'idle', 'walk']) {
      a.play(name, { fade: .2 }); a.update(.025);
      expect(walk.weight + idle.weight + hit.weight).toBeCloseTo(1, 8);
    }
    expect(walk.starts).toHaveLength(1);
    a.update(1);
    expect(walk.weight).toBe(1); expect(idle.isPlaying).toBe(false); expect(hit.isPlaying).toBe(false);
  });

  it('aligns support feet across forward, backward and the walk-run blend', () => {
    const walk = group(), back = group(), run = group();
    const a = animator(new Map([['walk', walk], ['back', back], ['run', run]]), new Map([['walk', .4], ['back', .9], ['run', .45]]));
    a.play('walk', { loop: true }); a.update(.4); walk.goToFrame(70);
    a.play('back', { loop: true });
    expect(back.animatables[0].masterFrame).toBeCloseTo(20);
    a.update(.4); back.goToFrame(40);
    a.loco('walk', 'run', .5, 1);
    expect(walk.animatables[0].masterFrame).toBeCloseTo(90);
    expect(run.animatables[0].masterFrame).toBeCloseTo(95);
  });

  it('does not restart a zero-contribution gait every frame', () => {
    const walk = group(), run = group(), a = animator(new Map([['walk', walk], ['run', run]]));
    for (let i = 0; i < 30; i++) { a.loco('walk', 'run', 0, 1); a.update(1 / 60); }
    expect(walk.starts).toHaveLength(1); expect(run.starts).toHaveLength(0);
    walk.goToFrame(60); a.loco('walk', 'run', .3, 1);
    expect(run.starts).toHaveLength(1); expect(run.animatables[0].masterFrame).toBeCloseTo(60);
  });

  it('carries support from full-body motion into guarded legs, without affecting an attack clock', () => {
    const walk = group(), back = group(), jab = group();
    const a = animator(new Map([['walk', walk], ['legs:back', back], ['jab', jab]]), new Map([['walk', .4], ['back', .9]]));
    a.play('walk', { loop: true }); a.update(.4); walk.goToFrame(70);
    a.legLayer('back');
    expect(back.animatables[0].masterFrame).toBeCloseTo(20);
    a.samplePhase('jab', .68); a.update(.016);
    expect(jab.animatables[0].masterFrame).toBeCloseTo(78);
    expect(jab.speedRatio).toBe(0);
    a.stopAll(); expect(back.isPlaying).toBe(false);
  });

  it('produces the same fade at 30 and 120 Hz', () => {
    const weightAt = (fps: number) => {
      const walk = group(), run = group(), a = animator(new Map([['walk', walk], ['run', run]]));
      a.play('walk', { fade: 0 }); a.update(.1);
      a.play('run', { fade: .4 });
      for (let i = 0; i < fps / 10; i++) a.update(1 / fps);
      return run.weight;
    };
    expect(weightAt(30)).toBeCloseTo(weightAt(120), 8);
  });

  it('crossfades guarded directions without dropping support or orphaning layers', () => {
    const forward = group(), side = group(), back = group();
    const a = animator(new Map([['legs:forward', forward], ['legs:side', side], ['legs:back', back]]));
    a.legLayer('forward'); a.update(1);
    for (const direction of ['side', 'back', 'forward', 'side']) {
      a.legLayer(null); a.legLayer(direction); a.update(.025);
      // Pose weights belong to the explicit leg pass; Babylon groups only advance clocks.
      expect(forward.weight + side.weight + back.weight).toBe(0);
      const layers = a as unknown as { legs: {w:number}|null; legsOut: {w:number}[] };
      expect((layers.legs?.w ?? 0)+layers.legsOut.reduce((sum,l)=>sum+l.w,0)).toBeCloseTo(1, 7);
    }
    expect(forward.starts).toHaveLength(1);
    a.update(1); expect(forward.isPlaying).toBe(false); expect(back.isPlaying).toBe(false);
    a.legLayer(null); a.update(1); expect(side.isPlaying).toBe(false);
    a.stopAll();
  });

  it('uses a clear travel contact source, favors moving guard legs, and avoids ambiguous blends', () => {
    const walk = group(), back = group(), guard = group();
    const a = animator(new Map([['walk', walk], ['guard', guard], ['legs:back', back]]), new Map([['walk', .4], ['back', .9]]));
    a.play('walk'); a.update(1); expect(a.contactSource()?.name).toBe('walk');
    a.play('guard', { fade: .2 }); a.update(.06); expect(a.contactSource()).toBeNull();
    a.update(1); expect(a.contactSource()).toBeNull();
    a.legLayer('back'); a.update(1); expect(a.contactSource()?.name).toBe('back');
    a.stopAll(); expect(a.contactSource()).toBeNull();
  });
});
