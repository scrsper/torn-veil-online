/**
 * All sound is synthesised in the browser with Web Audio: no downloaded or third-party samples, so there
 * is nothing to license. Buses: music, effects, ambience, voice (each with its own volume, under a master).
 * The context starts on the first user gesture (autoplay policy). Everything here is presentation: it
 * listens to what the client already knows (weather, time, footfalls, combat phases) and never feeds back.
 */
import type { FootSurface } from './footfalls';

export interface AudioVolumes { master: number; music: number; effects: number; ambience: number; voice: number }
export interface FootstepMix { gain?: number; pan?: number; wet?: number }
export interface AmbienceState { hour: number; weather: string; wind: number; indoor: boolean; fires: number; near: 'grass' | 'stone' | 'wood' | 'dirt' | 'water' }

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<'music' | 'effects' | 'ambience' | 'voice', GainNode>;
  private noise!: AudioBuffer;
  private wind: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private rain: { gain: GainNode } | null = null;
  private fire: { gain: GainNode } | null = null;
  private padGain!: GainNode;
  private nextBird = 0; private nextCricket = 0; private nextNote = 0; private t = 0;
  volumes: AudioVolumes = { master: 0.8, music: 0.6, effects: 0.9, ambience: 0.8, voice: 0.9 };
  muted = false;

  /** Call from any user gesture handler. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; this.master.connect(comp); comp.connect(ctx.destination);
    this.buses = { music: ctx.createGain(), effects: ctx.createGain(), ambience: ctx.createGain(), voice: ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let b0 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = b0 * 6 + w * 0.15; }
    this.noise = buf;
    const loop = (): AudioBufferSourceNode => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; };
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.6; const wg = ctx.createGain(); wg.gain.value = 0;
    loop().connect(wf).connect(wg).connect(this.buses.ambience); this.wind = { filter: wf, gain: wg };
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2500; const rg = ctx.createGain(); rg.gain.value = 0; loop().connect(rf).connect(rg).connect(this.buses.ambience); this.rain = { gain: rg };
    const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 1400; ff.Q.value = 0.8; const fg = ctx.createGain(); fg.gain.value = 0; loop().connect(ff).connect(fg).connect(this.buses.ambience); this.fire = { gain: fg };
    // Music: a slow drone of detuned partials in D dorian; single notes are added sparsely in update().
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0; this.padGain.connect(this.buses.music);
    for (const [f, dt] of [[73.42, 0], [110, 3], [146.83, -4], [220, 2]] as const) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = dt; const g = ctx.createGain(); g.gain.value = 0.05; o.connect(g).connect(this.padGain); o.start(); }
    this.applyVolumes();
  }
  setVolumes(v: Partial<AudioVolumes>): void { Object.assign(this.volumes, v); this.applyVolumes(); }
  private applyVolumes(): void {
    if (!this.ctx) return; const v = this.volumes, now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v.master, now, 0.05);
    this.buses.music.gain.setTargetAtTime(v.music * 0.5, now, 0.05); this.buses.effects.gain.setTargetAtTime(v.effects, now, 0.05);
    this.buses.ambience.gain.setTargetAtTime(v.ambience, now, 0.05); this.buses.voice.gain.setTargetAtTime(v.voice, now, 0.05);
  }
  get running(): boolean { return this.ctx?.state === 'running'; }

  update(dt: number, s: AmbienceState): void {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return; this.t += dt; const now = ctx.currentTime;
    const day = s.hour > 6 && s.hour < 19.5, gust = 0.5 + 0.5 * Math.sin(this.t * 0.23) * Math.sin(this.t * 0.11 + 1);
    const windLevel = (0.05 + 0.25 * s.wind + 0.12 * gust) * (s.indoor ? 0.25 : 1) * (s.weather === 'storm' ? 2 : 1);
    this.wind!.gain.gain.setTargetAtTime(windLevel * 0.35, now, 0.4); this.wind!.filter.frequency.setTargetAtTime(300 + 500 * s.wind + 300 * gust, now, 0.5);
    const wet = s.weather === 'rain' ? 0.5 : s.weather === 'storm' ? 0.9 : 0; this.rain!.gain.gain.setTargetAtTime(wet * 0.16 * (s.indoor ? 0.4 : 1), now, 0.6);
    this.fire!.gain.gain.setTargetAtTime(Math.min(1, s.fires) * 0.07 * (0.7 + 0.3 * Math.sin(this.t * 13)), now, 0.2);
    this.padGain.gain.setTargetAtTime(0.18 + 0.06 * Math.sin(this.t * 0.07), now, 2);
    if (day && !s.indoor && wet === 0 && this.t > this.nextBird) { this.chirp(); this.nextBird = this.t + 2 + Math.random() * 7; }
    if (!day && !s.indoor && wet === 0 && this.t > this.nextCricket) { this.cricket(); this.nextCricket = this.t + 0.35 + Math.random() * 0.6; }
    if (this.t > this.nextNote) { this.note(); this.nextNote = this.t + 5 + Math.random() * 9; }
  }
  private env(g: GainNode, a: number, peak: number, d: number): void { const n = this.ctx!.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(0.0001, n); g.gain.linearRampToValueAtTime(peak, n + a); g.gain.exponentialRampToValueAtTime(0.0001, n + a + d); }
  private chirp(): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; const f = 2400 + Math.random() * 1800, n = c.currentTime;
    o.frequency.setValueAtTime(f, n); o.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.5), n + 0.08); o.frequency.exponentialRampToValueAtTime(f * 0.9, n + 0.17);
    o.connect(g).connect(this.buses.ambience); this.env(g, 0.01, 0.05, 0.16); o.start(); o.stop(n + 0.3);
    if (Math.random() < 0.6) setTimeout(() => this.ctx && this.chirp(), 120 + Math.random() * 120);
  }
  private cricket(): void { const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = 4200 + Math.random() * 300; o.connect(g).connect(this.buses.ambience); this.env(g, 0.005, 0.012, 0.06); o.start(); o.stop(c.currentTime + 0.12); }
  private note(): void {
    const c = this.ctx!, scale = [0, 2, 3, 5, 7, 9, 10], f = 293.66 * Math.pow(2, scale[Math.floor(Math.random() * 7)] / 12) * (Math.random() < 0.3 ? 2 : 1);
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g).connect(this.buses.music); this.env(g, 1.2, 0.09, 4.5); o.start(); o.stop(c.currentTime + 6.5);
  }
  private burst(bus: GainNode, freq: number, q: number, peak: number, dur: number, type: BiquadFilterType = 'bandpass', at = 0): AudioBufferSourceNode {
    const c = this.ctx!, s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain();
    s.connect(f).connect(g).connect(bus); const n = c.currentTime + at; g.gain.setValueAtTime(0.0001, n); g.gain.linearRampToValueAtTime(peak, n + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, n + dur); s.start(n, Math.random()); s.stop(n + dur + 0.05);
    s.onended = () => { s.disconnect(); f.disconnect(); g.disconnect(); };
    return s;
  }
  /** Layer weight, sole contact and ground texture at the visible support edge. */
  footstep(surface: FootSurface, intensity: number, mix: FootstepMix = {}): void {
    if (!this.running || !Number.isFinite(intensity)) return;
    const c = this.ctx!, level = Math.max(0, Math.min(1.6, intensity));
    const gain = Math.max(0, Math.min(1, mix.gain ?? 1)); if (gain < .005 || level === 0) return;
    const wet = Math.max(0, Math.min(1, mix.wet ?? 0));
    const output = c.createGain(), pan = c.createStereoPanner();
    output.gain.value = gain; pan.pan.value = Math.max(-1, Math.min(1, mix.pan ?? 0));
    output.connect(pan).connect(this.buses.effects);
    const variation = .92 + Math.random() * .16;
    this.burst(output, (surface === 'stone' ? 240 : 160) * variation, .7, .12 * level, .09, 'lowpass');
    this.tone((surface === 'wood' ? 145 : 80) * variation, .075, .045 * level, output);
    const texture = { grass: [2200, .20, .07], dirt: [850, .14, .09], stone: [2100, .065, .12], wood: [950, .095, .11], water: [1450, .23, .12] }[surface];
    // This longest layer also owns cleanup of the per-foot stereo route.
    const tail = this.burst(output, texture[0] * variation, surface === 'stone' ? 2 : .7,
      texture[2] * level * (1 - wet * .35), .25, surface === 'grass' ? 'highpass' : 'bandpass');
    this.burst(output, texture[0] * variation, 1, texture[2] * level * .5, texture[1]);
    if (wet > .05 && surface !== 'water') this.burst(output, 1700 * variation, .6, .07 * level * wet, .18);
    const cleanup = tail.onended;
    tail.onended = event => { cleanup?.call(tail, event); output.disconnect(); pan.disconnect(); };
  }
  private tone(f: number, dur: number, peak: number, bus: GainNode | null = null, type: OscillatorType = 'sine'): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; o.connect(g).connect(bus ?? this.buses.effects); this.env(g, 0.004, peak, dur); o.start(); o.stop(c.currentTime + dur + 0.05);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  ui(kind: 'move' | 'confirm' | 'back' | 'open' | 'error'): void {
    if (!this.running) return;
    const p = { move: [880, 0.03, 0.03], confirm: [1320, 0.08, 0.05], back: [660, 0.06, 0.04], open: [990, 0.12, 0.05], error: [220, 0.14, 0.06] }[kind] as [number, number, number];
    this.tone(p[0], p[1], p[2], null, 'triangle'); if (kind === 'confirm') this.tone(1760, 0.1, 0.03, null, 'sine');
  }
  /** Strike whoosh, contact thud, guard ring, parry ring, dodge rush. */
  combat(kind: 'swing' | 'heavy' | 'hit' | 'block' | 'parry' | 'dodge' | 'hurt'): void {
    if (!this.running) return; const e = this.buses.effects;
    switch (kind) {
      case 'swing': this.burst(e, 1800, 1.4, 0.12, 0.16, 'bandpass'); break;
      case 'heavy': this.burst(e, 900, 1.0, 0.18, 0.3, 'bandpass'); break;
      case 'hit': this.burst(e, 240, 0.8, 0.3, 0.14, 'lowpass'); this.tone(90, 0.16, 0.2); break;
      case 'hurt': this.burst(e, 320, 0.8, 0.28, 0.18, 'lowpass'); this.tone(70, 0.24, 0.22, this.buses.voice); break;
      case 'block': this.burst(e, 1200, 2.5, 0.16, 0.12, 'bandpass'); this.tone(420, 0.15, 0.08, null, 'triangle'); break;
      case 'parry': this.tone(1568, 0.5, 0.11, null, 'sine'); this.tone(2349, 0.4, 0.06, null, 'sine'); this.burst(e, 3200, 3, 0.1, 0.06, 'bandpass'); break;
      case 'dodge': this.burst(e, 700, 0.7, 0.1, 0.22, 'highpass'); break;
    }
  }
  /** Soft voiced babble while someone talks: pitch contour and rhythm only, never words. */
  speechBlip(pitch: number): void {
    if (!this.running) return; const c = this.ctx!, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = pitch * (0.9 + Math.random() * 0.25);
    f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 900; f.Q.value = 3; o.connect(f).connect(g).connect(this.buses.voice); this.env(g, 0.01, 0.05, 0.07 + Math.random() * 0.05); o.start(); o.stop(c.currentTime + 0.2);
  }
  door(open: boolean): void { if (!this.running) return; this.burst(this.buses.effects, open ? 300 : 220, 1.2, 0.2, 0.22, 'lowpass'); this.tone(open ? 140 : 100, 0.2, 0.08); }
  pickup(): void { if (!this.running) return; this.tone(1200, 0.06, 0.05); this.burst(this.buses.effects, 2400, 2, 0.04, 0.05); }
}
