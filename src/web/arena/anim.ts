import type { AnimationGroup } from '@babylonjs/core';
import { wrapPhase } from './gaitPhase';

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
 * Contact-aligned cycles and normalized weights preserve support through interrupted fades.
 */
export class Animator {
  current = '';
  private active = new Map<string, { g: AnimationGroup; w: number; velocity: number; target: number; rate: number; base: number }>();
  /** Per-body time: time magic slows a body's whole motion, frost freezes it (0), lightning stutters it. */
  timeScale = 1;
  constructor(private readonly groups: Map<string, AnimationGroup>, private readonly phases: ReadonlyMap<string, number> = new Map()) {}

  private phase(name: string, g: AnimationGroup): number {
    const frame = g.animatables?.[0]?.masterFrame ?? g.from;
    return wrapPhase((frame - g.from) / Math.max(1e-3, g.to - g.from) - (this.phases.get(name) ?? 0));
  }
  private travelPhase(): number | undefined {
    if (this.legs && this.legs.w > 0 && this.phases.has(this.legs.name)) return this.phase(this.legs.name, this.legs.g);
    let weight = -1, phase: number | undefined;
    for (const [name, a] of this.active) if (this.phases.has(name) && a.g.isPlaying && a.w > weight) {
      weight = a.w; phase = this.phase(name, a.g);
    }
    return phase;
  }
  private seekPhase(name: string, g: AnimationGroup, phase: number): void {
    g.goToFrame(g.from + wrapPhase(phase + (this.phases.get(name) ?? 0)) * (g.to - g.from));
  }

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
    if (name === this.current && !o.restart && o.from === undefined) { const c = this.active.get(name); if (c) c.base = speed; g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); return; }
    const phase = o.loop && this.phases.has(name) ? this.travelPhase() : undefined;
    for (const [n, a] of this.active) if (n !== name) { a.target = 0; a.rate = 1 / Math.max(fade, 1e-3); }
    let a = this.active.get(name);
    if (!a) { a = { g, w: fade <= 0 ? 1 : 0, velocity: 0, target: 1, rate: 1 / Math.max(fade, 1e-3), base: speed }; this.active.set(name, a); }
    a.target = 1; a.rate = 1 / Math.max(fade, 1e-3); a.base = speed;
    if (!g.isPlaying || o.restart || o.from !== undefined) {
      g.stop();
      // Seeking must not shorten the range subsequently looped by Babylon.
      g.start(o.loop ?? false, effectiveAnimationSpeed(speed, this.timeScale), g.from, g.to);
      if (o.from !== undefined) g.goToFrame(g.from + Math.max(0, Math.min(1, o.from)) * (g.to - g.from));
    }
    if (o.from === undefined && phase !== undefined && !o.restart) this.seekPhase(name, g, phase);
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
    const phase = this.travelPhase() ?? (gw.isPlaying ? this.phase(walk, gw) : gr.isPlaying ? this.phase(run, gr) : 0);
    const fadeRate = 1 / Math.max(fade, 1e-3);
    for (const [n, a] of this.active) if (n !== walk && n !== run) { a.target = 0; a.rate = fadeRate; }
    for (const [name, g, w] of [[walk, gw, 1 - blend], [run, gr, blend]] as const) {
      let a = this.active.get(name);
      if (!a && w <= 0) continue;
      if (!a || !g.isPlaying) {
        if (!a) { a = { g, w: 0, velocity: 0, target: w, rate: fadeRate, base: 1 }; this.active.set(name, a); }
        g.stop(); g.start(true, 1, g.from, g.to); this.seekPhase(name, g, phase); g.setWeightForAllAnimatables(a.w);
      } else if (this.current !== 'loco') {
        this.seekPhase(name, g, phase);
      }
      a.target = Math.max(0, Math.min(1, w)); a.rate = fadeRate;
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

  /** A clear travel leader only; mixed fades fall back to geometric contact detection. */
  contactSource(): { name: string; frame: number } | null {
    const legs = [...this.legLayers.values()];
    const legWeight = legs.reduce((sum, layer) => sum + layer.w, 0);
    const layers = legWeight > 1 ? legs.map(layer => [layer.name, layer] as const) : [...this.active.entries()];
    const total = layers.reduce((sum, [, layer]) => sum + layer.w, 0);
    for (const [name, layer] of layers) {
      const frame = layer.g.animatables?.[0]?.masterFrame;
      if (total > 0 && layer.w / total >= .65 && this.phases.has(name) && frame !== undefined) return { name, frame: frame - layer.g.from };
    }
    return null;
  }

  private legs: { name: string; g: AnimationGroup; w: number; velocity: number; target: number; base: number } | null = null;
  private legLayers = new Map<string, NonNullable<Animator['legs']>>();
  /**
   * A legs-only layer over whatever is playing (strafe/backpedal while guarding or aiming). Its weight is
   * high so it dominates the leg bones; the upper body keeps the main clip. `null` fades it out.
   */
  legLayer(name: string | null, speed = 1): void {
    for (const layer of this.legLayers.values()) layer.target = 0;
    if (name && this.legs?.name !== name) {
      const g = this.groups.get(`legs:${name}`); if (!g) return;
      // Direction changes should preserve the outgoing gait's normalized phase;
      // restarting at frame 0 is a visible foot pop when strafe/backpedal is
      // requested during an otherwise continuous move.
      const old = this.legs;
      const phase = old ? this.phase(old.name, old.g) : this.travelPhase() ?? 0;
      // Retain ownership of outgoing layers until their fade finishes. Stopping
      // immediately would expose the guard's static legs during every turn.
      let layer = this.legLayers.get(name);
      if (!layer) {
        g.stop(); g.start(true, effectiveAnimationSpeed(speed, this.timeScale), g.from, g.to);
        g.setWeightForAllAnimatables(0);
        layer = { name, g, w: 0, velocity: 0, target: 6, base: speed };
        this.legLayers.set(name, layer);
      }
      if (typeof g.goToFrame === 'function') this.seekPhase(name, g, phase);
      layer.target = 6; layer.base = speed; this.legs = layer;
    } else if (name && this.legs) { this.legs.target = 6; this.legs.base = speed; this.legs.g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); }
    else if (!name && this.legs) this.legs.target = 0;
  }

  setSpeed(speed: number): void { const a = this.active.get(this.current); if (a) { a.base = speed; a.g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); } }

  update(dt: number): void {
    dt = Math.max(0, dt);
    for (const [name, L] of this.legLayers) {
      const omega = 40, delta = L.w - L.target, c = L.velocity + omega * delta, decay = Math.exp(-omega * dt);
      L.w = Math.max(0, Math.min(6, L.target + (delta + c * dt) * decay));
      L.velocity = (L.velocity - omega * c * dt) * decay;
      if (Math.abs(L.w - L.target) < 1e-4 && Math.abs(L.velocity) < 1e-3) { L.w = L.target; L.velocity = 0; }
      if (L.w <= 0 && L.target === 0) {
        L.g.stop(); this.legLayers.delete(name); if (this.legs === L) this.legs = null;
      } else {
        L.g.setWeightForAllAnimatables(L.w);
        L.g.speedRatio = effectiveAnimationSpeed(L.base, this.timeScale);
      }
    }
    let total = 0;
    for (const [n, a] of this.active) {
      // Exact critically damped response: preserves weight velocity on interruption,
      // and behaves the same at 30/60/120 Hz for a fixed target.
      const omega = 6 * a.rate, delta = a.w - a.target, c = a.velocity + omega * delta, decay = Math.exp(-omega * dt);
      a.w = Math.max(0, Math.min(1, a.target + (delta + c * dt) * decay));
      a.velocity = (a.velocity - omega * c * dt) * decay;
      if (Math.abs(a.w - a.target) < 1e-4 && Math.abs(a.velocity) < 1e-3) { a.w = a.target; a.velocity = 0; }
      if (a.w <= 0 && a.target === 0) { a.g.stop(); this.active.delete(n); continue; }
      total += a.w;
    }
    for (const a of this.active.values()) {
      // Partial interrupted fades otherwise expose the skeleton's bind pose.
      a.g.setWeightForAllAnimatables(total > 1e-8 ? a.w / total : 0);
      a.g.speedRatio = effectiveAnimationSpeed(a.base, this.timeScale);
    }
  }

  stopAll(): void {
    for (const a of this.active.values()) a.g.stop();
    for (const layer of this.legLayers.values()) layer.g.stop();
    this.active.clear(); this.legLayers.clear(); this.legs = null; this.current = '';
  }
}
