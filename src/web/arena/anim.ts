import type { AnimationGroup } from '@babylonjs/core';

/**
 * Apply the per-body clock to a clip's authored playback rate. Keeping this as
 * one small function is important because full-body and leg-only layers must
 * obey the same freeze/slow/stutter effects.
 */
export const effectiveAnimationSpeed = (base: number, timeScale: number): number =>
  base * Math.max(0, timeScale);

/** Seconds of a clip at speed 1. */
export const clipLength = (g: AnimationGroup) => {
  const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
  return (g.to - g.from) / fps;
};

/**
 * Cross-fading clip player for one character. Every clip is an AnimationGroup on the same rig;
 * blending is done with group weights, so a fade is just two weights ramping in opposite directions.
 */
export class Animator {
  current = '';
  private active = new Map<string, { g: AnimationGroup; w: number; target: number; rate: number; base: number }>();
  /** Per-body time: time magic slows a body's whole motion, frost freezes it (0), lightning stutters it. */
  timeScale = 1;
  constructor(private readonly groups: Map<string, AnimationGroup>) {}

  has(name: string): boolean { return this.groups.has(name); }
  length(name: string): number { const g = this.groups.get(name); return g ? clipLength(g) : 1; }

  /** Sample an observed canonical phase without a second free-running action clock. */
  sample(name: string, progress: number, fade = .08): void {
    this.play(name, { speed: 0, fade });
    const g = this.groups.get(name);
    g?.goToFrame(g.from + Math.max(0, Math.min(1, progress)) * (g.to - g.from));
  }

  play(name: string, o: { loop?: boolean; speed?: number; fade?: number; restart?: boolean; from?: number } = {}): void {
    const g = this.groups.get(name); if (!g) { console.warn('[arena] missing clip', name); return; }
    const fade = o.fade ?? 0.12, speed = o.speed ?? 1;
    if (name === this.current && !o.restart) { const c = this.active.get(name); if (c) c.base = speed; g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); return; }
    for (const [n, a] of this.active) if (n !== name) { a.target = 0; a.rate = 1 / Math.max(fade, 1e-3); }
    let a = this.active.get(name);
    if (!a) { a = { g, w: fade <= 0 ? 1 : 0, target: 1, rate: 1 / Math.max(fade, 1e-3), base: speed }; this.active.set(name, a); }
    a.target = 1; a.rate = 1 / Math.max(fade, 1e-3); a.base = speed;
    g.stop();
    g.start(o.loop ?? false, speed * this.timeScale, g.from + (o.from ?? 0) * (g.to - g.from), g.to);
    g.setWeightForAllAnimatables(a.w);
    this.current = name;
  }

  /**
   * Locomotion blend space: walk and run play together, phase-locked (same normalised cycle time),
   * weighted by `blend` (0 walk .. 1 run) and paced to `rate` gait cycles per second, so stride
   * matches ground speed through the whole walk-jog-run range instead of hard-switching clips.
   */
  loco(walk: string, run: string, blend: number, rate: number, fade = .25): void {
    const gw = this.groups.get(walk), gr = this.groups.get(run); if (!gw || !gr) return;
    const phaseOf = (g: AnimationGroup) => { const m = g.animatables[0]?.masterFrame; return m === undefined ? 0 : ((m - g.from) / Math.max(1e-3, g.to - g.from)) % 1; };
    const lead = this.active.get(walk)?.g.isPlaying ? gw : this.active.get(run)?.g.isPlaying ? gr : null;
    const phase = lead ? phaseOf(lead) : 0;
    for (const [n, a] of this.active) if (n !== walk && n !== run) { a.target = 0; a.rate = 1 / fade; }
    for (const [name, g, w] of [[walk, gw, 1 - blend], [run, gr, blend]] as const) {
      let a = this.active.get(name);
      if (!a || !g.isPlaying) {
        if (!a) { a = { g, w: 0, target: w, rate: 1 / fade, base: 1 }; this.active.set(name, a); }
        g.stop(); g.start(true, 1, g.from, g.to); g.goToFrame(g.from + phase * (g.to - g.from)); g.setWeightForAllAnimatables(a.w);
      }
      a.target = Math.max(0, Math.min(1, w)); a.rate = 1 / fade;
      a.base = Math.max(.05, rate * clipLength(g)); g.speedRatio = effectiveAnimationSpeed(a.base, this.timeScale);
    }
    this.current = 'loco';
  }

  /** The most heavily weighted playing clip and its current frame offset (for foot-contact lookup). */
  dominant(): { name: string; frame: number } | null {
    let best: { name: string; frame: number } | null = null, bw = 0;
    for (const [n, a] of this.active) {
      const m = a.g.animatables[0]?.masterFrame; if (m === undefined || a.w <= bw) continue;
      bw = a.w; best = { name: n, frame: m - a.g.from };
    }
    return best;
  }

  private legs: { name: string; g: AnimationGroup; w: number; target: number; base: number } | null = null;
  /**
   * A legs-only layer over whatever is playing (strafe/backpedal while guarding or aiming). Its weight is
   * high so it dominates the leg bones; the upper body keeps the main clip. `null` fades it out.
   */
  legLayer(name: string | null, speed = 1): void {
    if (name && this.legs?.name !== name) {
      const g = this.groups.get(`legs:${name}`); if (!g) return;
      // Direction changes should preserve the outgoing gait's normalized phase;
      // restarting at frame 0 is a visible foot pop when strafe/backpedal is
      // requested during an otherwise continuous move.
      const old = this.legs;
      const oldFrame = old?.g.animatables[0]?.masterFrame;
      const phase = oldFrame === undefined || !old ? 0 : ((((oldFrame - old.g.from) / Math.max(1e-3, old.g.to - old.g.from)) % 1) + 1) % 1;
      // Animator owns one leg overlay slot. Stop the outgoing group here
      // rather than leaving it orphaned when the slot is replaced; the new
      // layer starts at zero weight and fades in over subsequent updates.
      if (old) { old.target = 0; old.g.stop(); }
      g.stop(); g.start(true, effectiveAnimationSpeed(speed, this.timeScale), g.from, g.to);
      if (phase > 0 && typeof g.goToFrame === 'function') g.goToFrame(g.from + phase * (g.to - g.from));
      g.setWeightForAllAnimatables(0);
      this.legs = { name, g, w: 0, target: 6, base: speed };
    } else if (name && this.legs) { this.legs.target = 6; this.legs.base = speed; this.legs.g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); }
    else if (!name && this.legs) this.legs.target = 0;
  }

  setSpeed(speed: number): void { const a = this.active.get(this.current); if (a) { a.base = speed; a.g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); } }

  update(dt: number): void {
    if (this.legs) {
      const L = this.legs; L.w += Math.sign(L.target - L.w) * Math.min(Math.abs(L.target - L.w), dt * 12);
      if (L.w <= 0 && L.target === 0) { L.g.stop(); this.legs = null; } else {
        L.g.setWeightForAllAnimatables(L.w);
        L.g.speedRatio = effectiveAnimationSpeed(L.base, this.timeScale);
      }
    }
    for (const [n, a] of this.active) {
      a.w = a.target > a.w ? Math.min(a.target, a.w + a.rate * dt) : Math.max(a.target, a.w - a.rate * dt);
      if (a.w <= 0 && a.target === 0) { a.g.stop(); this.active.delete(n); continue; }
      a.g.setWeightForAllAnimatables(a.w);
      a.g.speedRatio = effectiveAnimationSpeed(a.base, this.timeScale);
    }
  }

  stopAll(): void {
    for (const a of this.active.values()) a.g.stop();
    if (this.legs) this.legs.g.stop();
    this.active.clear(); this.legs = null; this.current = '';
  }
}
