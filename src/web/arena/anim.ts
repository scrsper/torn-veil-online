import { Quaternion, Vector3, type AnimationGroup } from '@babylonjs/core';
import { HumanGait } from './humanGait';
import type { CharacterInstance } from './assets';
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
interface LegLayer { name: string; g: AnimationGroup; w: number; target: number; t: number; speed: number; velocity: number }

export class Animator {
  current = '';
  private active = new Map<string, { g: AnimationGroup; w: number; velocity: number; target: number; rate: number; base: number }>();
  /** Per-body time: time magic slows a body's whole motion, frost freezes it (0), lightning stutters it. */
  timeScale = 1;
  private gait: HumanGait | null;
  private readonly phases: ReadonlyMap<string, number>;
  constructor(private readonly groups: Map<string, AnimationGroup>, rigOrPhases?: Pick<CharacterInstance, 'root' | 'bones'> | ReadonlyMap<string, number>, phases: ReadonlyMap<string, number> = new Map()) {
    const rig = rigOrPhases && 'root' in rigOrPhases ? rigOrPhases : undefined;
    this.phases = rig ? phases : rigOrPhases as ReadonlyMap<string, number> | undefined ?? phases;
    this.gait = rig?.bones ? new HumanGait(rig) : null;
  }
  motion(speed: number, forward: number, crouch: number, yaw: number): void { this.gait?.motion(speed, forward, crouch, yaw); }
  get gaitState() { return this.gait?.inspect() ?? null; }
  get gaitContacts() { return this.gait?.contacts; }


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
    this.seekWeighted(g, g.from + wrapPhase(phase + (this.phases.get(name) ?? 0)) * (g.to - g.from));
  }
  private seekWeighted(g: AnimationGroup, frame: number): void {
    if (g.animatables?.length && g.animatables.every(a => typeof a.goToFrame === 'function')) {
      for (const a of g.animatables) a.goToFrame(frame, true);
    } else if (typeof g.goToFrame === 'function') g.goToFrame(frame);
  }

  has(name: string): boolean { return this.groups.has(name); }
  length(name: string): number { const g = this.groups.get(name); return g ? clipLength(g) : 1; }

  /** Explicit normalized phase adapter for observed action/reaction phases. */
  samplePhase(name: string, progress: number, fade = .08): void {
    const g = this.groups.get(name); if (!g) return;
    this.sample(name, Math.max(0, Math.min(1, progress)) * clipLength(g), fade);
  }

  /** Authored seconds from the canonical action clock; pose only, with no gameplay callbacks. */
  sample(name: string, seconds: number, fade = .06): void {
    const g = this.groups.get(name); if (!g) return;
    this.play(name, { speed: 0, fade });
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    this.seekWeighted(g, Math.max(g.from, Math.min(g.to - .001, g.from + seconds * fps)));
  }

  play(name: string, o: { loop?: boolean; speed?: number; fade?: number; restart?: boolean; from?: number } = {}): void {
    this.gait?.stop(!/idle/i.test(name) || /guard|block|defend/i.test(name));
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
      if (o.from !== undefined) this.seekWeighted(g, g.from + Math.max(0, Math.min(1, o.from)) * (g.to - g.from));
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
    this.gait?.locomotion(blend, rate, !/ready\/|sword|shield|bow|axe|hammer/i.test(walk), () => {
      const g = blend >= .5 && gr.isPlaying ? gr : gw.isPlaying ? gw : gr.isPlaying ? gr : null;
      if (!g?.animatables.length) return null;
      return wrapPhase((g.animatables[0].masterFrame - g.from) / Math.max(1e-3, g.to - g.from));
    });
    const phase = this.travelPhase() ?? (gw.isPlaying ? this.phase(walk, gw) : gr.isPlaying ? this.phase(run, gr) : 0);
    const fadeRate = 1 / Math.max(fade, 1e-3);
    for (const [n, a] of this.active) if (n !== walk && n !== run) { a.target = 0; a.rate = fadeRate; }
    for (const [name, g, w] of [[walk, gw, 1 - blend], [run, gr, blend]] as const) {
      let a = this.active.get(name);
      if (!a && w <= 0) continue;
      if (!a || !g.isPlaying) {
        if (!a) { a = { g, w: 0, velocity: 0, target: w, rate: fadeRate, base: 1 }; this.active.set(name, a); }
        a.base = Math.max(.05, rate * clipLength(g));
        g.stop(); g.start(true, effectiveAnimationSpeed(a.base, this.timeScale), g.from, g.to);
        g.setWeightForAllAnimatables(a.w); this.seekPhase(name, g, phase);
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

  /** Clear travel source only: ambiguous direction fades use geometric support. */
  contactSource(): { name: string; frame: number } | null {
    const legs = [...this.legsOut, ...(this.legs ? [this.legs] : [])];
    const legWeight = legs.reduce((sum, layer) => sum + layer.w, 0);
    const layers = legWeight > .5 ? legs.map(layer => [layer.name, layer] as const) : [...this.active.entries()];
    const total = layers.reduce((sum, [, layer]) => sum + layer.w, 0);
    for (const [name, layer] of layers) {
      const frame = layer.g.animatables?.[0]?.masterFrame;
      if (total > 0 && layer.w / total >= .65 && this.phases.has(name) && frame !== undefined) return { name, frame: frame - layer.g.from };
    }
    return null;
  }

  /**
   * Legs-only layer (strafe / backpedal under a held upper-body pose while guarding or aiming). It is not a weighted
   * Babylon group: animatable weights clamp to [0, 1], so a legs group could only ever average 50/50 with the main clip's
   * legs (short, skating steps). Instead applyLegs() blends the leg bones from the main pose toward the legs clip by the
   * layer weight after Babylon animates. A replaced layer keeps fading out on its own and is dropped at zero.
   */
  private legs: LegLayer | null = null;
  private legsOut: LegLayer[] = [];
  /** True while a legs-only layer is driving (or fading out of) the leg bones. */
  get legLayered(): boolean { return !!this.legs || this.legsOut.length > 0; }
  legLayer(name: string | null, speed = 1): void {
    if (name) this.gait?.stop(true);
    if (name && this.legs?.name !== name) {
      const g = this.groups.get(`legs:${name}`); if (!g) return;
      const phase = this.legs ? this.phase(this.legs.name, this.legs.g) : this.travelPhase() ?? 0;
      if (this.legs) { this.legs.target = 0; this.legs.velocity = Math.min(0,this.legs.velocity); this.legsOut.push(this.legs); }
      // A layer coming back while it still fades out resumes from its weight and phase.
      const back = this.legsOut.findIndex(o => o.name === name);
      if (back >= 0) { this.legs = this.legsOut.splice(back, 1)[0]; this.legs.target = 1; this.legs.speed = speed; this.legs.velocity = Math.max(0,this.legs.velocity); return; }
      g.stop();
      g.start(true, effectiveAnimationSpeed(speed, this.timeScale), g.from, g.to);
      g.setWeightForAllAnimatables(0); this.seekPhase(name, g, phase);
      this.legs = { name, g, w: 0, target: 1, t: 0, speed, velocity: 0 };
    } else if (name && this.legs) { this.legs.target = 1; this.legs.speed = speed; }
    else if (!name && this.legs) { this.legs.target = 0; this.legs.velocity = Math.min(0,this.legs.velocity); }
  }
  /** Blend the leg bones toward the active legs layers (call after animations, before foot solving). */
  applyLegs(): void {
    this.gait?.apply();
    for (const L of [...this.legsOut, ...(this.legs ? [this.legs] : [])]) {
      if (L.w <= 0) continue;
      const k = L.w * L.w * (3 - 2 * L.w);
      const frame = L.g.animatables?.[0]?.masterFrame ?? L.g.from;
      // These groups advance clocks at weight zero; the explicit pass owns legs.
      for (const ta of L.g.targetedAnimations) {
        const n = ta.target as { rotationQuaternion?: Quaternion | null; position?: Vector3 }, v = ta.animation.evaluate(frame);
        if (ta.animation.targetProperty === 'rotationQuaternion' && n.rotationQuaternion) Quaternion.SlerpToRef(n.rotationQuaternion, v as Quaternion, k, n.rotationQuaternion);
        else if (ta.animation.targetProperty === 'position' && n.position) Vector3.LerpToRef(n.position, v as Vector3, k, n.position);
      }
    }
  }

  setSpeed(speed: number): void { const a = this.active.get(this.current); if (a) { a.base = speed; a.g.speedRatio = effectiveAnimationSpeed(speed, this.timeScale); } }

  update(dt: number): void {
    dt = Math.max(0, dt);
    this.gait?.update(dt * Math.max(0, this.timeScale));
    for (const L of [...this.legsOut, ...(this.legs ? [this.legs] : [])]) {
      const omega = 14, delta = L.w - L.target, c = L.velocity + omega * delta, decay = Math.exp(-omega * dt);
      L.w = Math.max(0, Math.min(1, L.target + (delta + c * dt) * decay));
      L.velocity = (L.velocity - omega * c * dt) * decay;
      if (Math.abs(L.w - L.target) < .001 && Math.abs(L.velocity) < .02) { L.w = L.target; L.velocity = 0; }
      L.g.speedRatio = effectiveAnimationSpeed(L.speed, this.timeScale);
      L.g.setWeightForAllAnimatables(0);
      if (L.w === 0 && L.target === 0) L.g.stop();
    }
    // Direction changes keep one unit of pose ownership once fully acquired.
    // Interrupted returning layers may have a different weight velocity.
    const layers=[...this.legsOut,...(this.legs?[this.legs]:[])], sum=layers.reduce((n,L)=>n+L.w,0);
    if(this.legs?.target&&this.legsOut.length&&sum>0)for(const L of layers)L.w/=sum;
    this.legsOut = this.legsOut.filter(L => L.w > 0);
    if (this.legs?.w === 0 && this.legs.target === 0) this.legs = null;
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
    this.gait?.stop(true);
    for (const layer of [...this.legsOut, ...(this.legs ? [this.legs] : [])]) layer.g.stop();
    this.active.clear(); this.legsOut = []; this.legs = null; this.current = '';
  }
}
