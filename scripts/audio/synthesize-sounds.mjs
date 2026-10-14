// Deterministic procedural sound set for the presentation layer (no recorded or purchased audio).
// Writes 16-bit mono 44.1 kHz WAVs to .debug/audio/source (outside Content, so an open editor never
// auto-imports them); unreal/scripts/import_local_sounds.py makes local SoundWaves of them.
// Same seed, same bytes: `node scripts/audio/synthesize-sounds.mjs [--out dir]`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RATE = 44100;
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : '.debug/audio/source';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** One-pole low-pass / high-pass over a buffer, in place. */
function lowpass(buf, hz) { const a = 1 - Math.exp(-2 * Math.PI * hz / RATE); let y = 0; for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; } return buf; }
function highpass(buf, hz) { const lp = lowpass(Float64Array.from(buf), hz); for (let i = 0; i < buf.length; i++) buf[i] -= lp[i]; return buf; }
function noise(n, r) { const b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = r() * 2 - 1; return b; }
function normalize(buf, peak) { let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m; return buf; }
/** Make a loop seamless: crossfade the last `fade` seconds into the start. */
function seamless(buf, fade) {
  const f = Math.floor(fade * RATE), n = buf.length - f, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[i];
  for (let i = 0; i < f; i++) { const t = i / f; out[i] = buf[i] * Math.sqrt(t) + buf[n + i] * Math.sqrt(1 - t); }
  return out;
}
function wind(seconds, r, level) {
  const n = Math.floor(seconds * RATE), b = lowpass(lowpass(noise(n, r), 380), 520);
  // Slow gusts: a sum of three incommensurate swells.
  const p = [r() * 6.28, r() * 6.28, r() * 6.28];
  for (let i = 0; i < n; i++) { const t = i / RATE; b[i] *= 0.55 + 0.25 * Math.sin(t * 0.21 + p[0]) + 0.15 * Math.sin(t * 0.53 + p[1]) + 0.05 * Math.sin(t * 1.7 + p[2]); }
  return normalize(b, level);
}
function addChirp(buf, at, r) { // a small bird: two or three rising/falling whistles
  const notes = 2 + Math.floor(r() * 2), base = 2600 + r() * 1800;
  for (let k = 0; k < notes; k++) {
    const start = Math.floor((at + k * (0.09 + r() * 0.05)) * RATE), len = Math.floor((0.05 + r() * 0.05) * RATE), sweep = (r() - 0.4) * 1400;
    let ph = 0;
    for (let i = 0; i < len && start + i < buf.length; i++) { const t = i / len, f = base + sweep * t; ph += 2 * Math.PI * f / RATE; buf[start + i] += Math.sin(ph) * Math.sin(Math.PI * t) ** 2 * 0.16; }
  }
}
function addCricket(buf, at, r) { // pulse train of a ~4.6 kHz carrier
  const f = 4400 + r() * 500, pulses = 3 + Math.floor(r() * 3);
  for (let k = 0; k < pulses; k++) {
    const start = Math.floor((at + k * 0.045) * RATE), len = Math.floor(0.022 * RATE);
    for (let i = 0; i < len && start + i < buf.length; i++) buf[start + i] += Math.sin(2 * Math.PI * f * i / RATE) * Math.sin(Math.PI * i / len) * 0.06;
  }
}
function rain(seconds, r) {
  const n = Math.floor(seconds * RATE), b = highpass(lowpass(noise(n, r), 5200), 400);
  normalize(b, 0.25);
  for (let d = 0; d < seconds * 180; d++) {
    const s = Math.floor(r() * n), f = 1800 + r() * 3000, amp = 0.05 + r() * 0.12;
    for (let i = 0; i < 400 && s + i < n; i++) b[s + i] += Math.sin(2 * Math.PI * f * i / RATE) * Math.exp(-i / 60) * amp;
  }
  return b;
}
function footstep(r) { // dry earth: a soft low thump under a short gritty scuff
  const n = Math.floor(0.16 * RATE), b = new Float64Array(n), grit = highpass(lowpass(noise(n, r), 3000 + r() * 1500), 600);
  for (let i = 0; i < n; i++) { const t = i / RATE; b[i] = Math.sin(2 * Math.PI * (70 + r() * 3) * t) * Math.exp(-t * 38) * 0.7 + grit[i] * Math.exp(-t * (26 + r() * 8)) * 0.45; }
  return normalize(b, 0.8);
}
function coins(r) {
  const n = Math.floor(0.6 * RATE), b = new Float64Array(n);
  for (let c = 0; c < 3; c++) {
    const start = Math.floor((c * 0.07 + r() * 0.03) * RATE), f = 3100 + r() * 900;
    for (let i = 0; start + i < n; i++) { const t = i / RATE; b[start + i] += (Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * f * 2.76 * t) + 0.3 * Math.sin(2 * Math.PI * f * 5.4 * t)) * Math.exp(-t * 11); }
  }
  return normalize(b, 0.5);
}
function eat(r) {
  const n = Math.floor(0.5 * RATE), b = new Float64Array(n);
  for (let k = 0; k < 4; k++) {
    const start = Math.floor((k * 0.11 + r() * 0.02) * RATE), g = highpass(lowpass(noise(3000, r), 2600), 300);
    for (let i = 0; i < g.length && start + i < n; i++) b[start + i] += g[i] * Math.exp(-i / 700);
  }
  return normalize(b, 0.45);
}

/** A one-shot must end at silence or it clicks: fade its last few milliseconds. */
function tail(buf, ms = 6) { const f = Math.floor(ms / 1000 * RATE); for (let i = 0; i < f; i++) buf[buf.length - 1 - i] *= i / f; return buf; }
function wav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(clamp(buf[i], -1, 1) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const sounds = {};
{ const r = rng(918271), b = wind(24, r, 0.35); for (let t = 0.8; t < 22; t += 1.6 + r() * 3.2) addChirp(b, t, r); sounds.SW_TV_AmbDay = seamless(b, 2); }
{ const r = rng(918272), b = wind(24, r, 0.22); for (let t = 0.3; t < 22.5; t += 0.35 + r() * 0.9) addCricket(b, t, r); sounds.SW_TV_AmbNight = seamless(b, 2); }
{ const r = rng(918273); sounds.SW_TV_AmbRain = seamless(rain(16, r), 1.5); }
for (let k = 1; k <= 4; k++) sounds[`SW_TV_Step_${k}`] = tail(footstep(rng(9100 + k)));
sounds.SW_TV_Coins = tail(coins(rng(9201)));
sounds.SW_TV_Eat = tail(eat(rng(9202)));

mkdirSync(OUT, { recursive: true });
for (const [name, buf] of Object.entries(sounds)) writeFileSync(join(OUT, `${name}.wav`), wav(buf));
console.log(JSON.stringify({ out: OUT, sounds: Object.fromEntries(Object.entries(sounds).map(([k, v]) => [k, +(v.length / RATE).toFixed(2)])) }));
