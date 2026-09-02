/** Procedural WebAudio ambience and effects. No assets required. */
export class AudioSys {
  ctx: AudioContext | null = null; master!: GainNode; wind!: GainNode; rain!: GainNode; crickets!: GainNode; birdsTimer = 0; ready = false;
  init(): void {
    if (this.ready) return; try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx; this.master = c.createGain(); this.master.gain.value = 0.5; this.master.connect(c.destination);
    const noise = (): AudioBufferSourceNode => { const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.start(); return s; };
    const windF = c.createBiquadFilter(); windF.type = 'lowpass'; windF.frequency.value = 300; this.wind = c.createGain(); this.wind.gain.value = 0.05; noise().connect(windF); windF.connect(this.wind); this.wind.connect(this.master);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.15; const lfoG = c.createGain(); lfoG.gain.value = 150; lfo.connect(lfoG); lfoG.connect(windF.frequency); lfo.start();
    const rainF = c.createBiquadFilter(); rainF.type = 'bandpass'; rainF.frequency.value = 2500; rainF.Q.value = 0.5; this.rain = c.createGain(); this.rain.gain.value = 0; noise().connect(rainF); rainF.connect(this.rain); this.rain.connect(this.master);
    const cr = c.createOscillator(); cr.type = 'square'; cr.frequency.value = 4200; const crG = c.createGain(); crG.gain.value = 0; const crLfo = c.createOscillator(); crLfo.frequency.value = 14; const crLfoG = c.createGain(); crLfoG.gain.value = 0.5; crLfo.connect(crLfoG); crLfoG.connect(crG.gain); cr.connect(crG); this.crickets = c.createGain(); this.crickets.gain.value = 0; crG.connect(this.crickets); this.crickets.connect(this.master); cr.start(); crLfo.start();
    this.ready = true;
  }
  update(dt: number, dayF: number, raining: number, indoors: boolean, windAmt: number): void {
    if (!this.ready || !this.ctx) return; const t = this.ctx.currentTime;
    const night = dayF < 0.22 || dayF > 0.82; const k = indoors ? 0.35 : 1;
    this.wind.gain.setTargetAtTime((0.04 + windAmt * 0.08) * k, t, 0.5); this.rain.gain.setTargetAtTime(raining * 0.25 * k, t, 0.5); this.crickets.gain.setTargetAtTime(night && raining < 0.3 ? 0.012 * k : 0, t, 1);
    this.birdsTimer -= dt; if (this.birdsTimer <= 0) { this.birdsTimer = 1.5 + Math.random() * 5; if (!night && raining < 0.3 && Math.random() < 0.7) this.bird(); }
  }
  private bird(): void { const c = this.ctx!; const o = c.createOscillator(); const g = c.createGain(); o.type = 'sine'; const t = c.currentTime; const f = 2200 + Math.random() * 1500; o.frequency.setValueAtTime(f, t); for (let i = 0; i < 3 + Math.random() * 3; i++) { o.frequency.exponentialRampToValueAtTime(f * (1 + Math.random() * 0.4), t + i * 0.12 + 0.06); o.frequency.exponentialRampToValueAtTime(f, t + i * 0.12 + 0.12); } g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + 0.03); g.gain.setTargetAtTime(0, t + 0.6, 0.1); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1); }
  sfx(kind: 'swing' | 'hit' | 'step' | 'pickup' | 'talk' | 'hurt'): void {
    if (!this.ready || !this.ctx) return; const c = this.ctx; const t = c.currentTime; const g = c.createGain(); g.connect(this.master);
    if (kind === 'swing') { const b = c.createBufferSource(); const buf = c.createBuffer(1, c.sampleRate * 0.25, c.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); b.buffer = buf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.15); b.connect(f); f.connect(g); g.gain.value = 0.25; b.start(t); }
    else if (kind === 'hit' || kind === 'hurt') { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(kind === 'hit' ? 160 : 110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); o.start(t); o.stop(t + 0.3); const b = c.createBufferSource(); const buf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); b.buffer = buf; const g2 = c.createGain(); g2.gain.value = 0.3; b.connect(g2); g2.connect(this.master); b.start(t); }
    else if (kind === 'step') { const b = c.createBufferSource(); const buf = c.createBuffer(1, c.sampleRate * 0.08, c.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); b.buffer = buf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500 + Math.random() * 300; b.connect(f); f.connect(g); g.gain.value = 0.12; b.start(t); }
    else if (kind === 'pickup') { const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.07); g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); o.start(t); o.stop(t + 0.3); }
    else if (kind === 'talk') { const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(440, t); o.frequency.setValueAtTime(520, t + 0.06); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(g); o.start(t); o.stop(t + 0.2); }
  }
}
