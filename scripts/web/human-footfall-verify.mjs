/** Canonical keyboard movement + actual Web Audio synthesis in a disposable client. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.TV_MOTION_URL ?? 'http://127.0.0.1:7517';
const out = process.env.TV_AUDIO_OUT ?? '.debug/quality-pass/audio';
const health = await fetch(base + '/api/health').then(r => r.json());
assert.equal(health.isolation, 'Disposable town and gym; no save access');
const control = async body => {
  const response = await fetch(base + '/api/gym/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok); return response.json();
};
await control({ action: 'switch', scenario: 'gym' }); await control({ action: 'reset', seed: 918271 });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', error => errors.push(String(error)));
try {
  await page.goto(base + '/?gym=1&autoplay=1&view=third-person&renderer=webgl2');
  await page.waitForFunction(() => window.__tv?.ready && window.__tv.link.playable, null, { timeout: 180000 });
  await page.evaluate(() => {
    const app = window.__tv;
    window.__footEvidence = { phase: 'idle', calls: [], route: null };
    for (const actor of app.actors.all()) {
      const visual = actor.visual; if (!visual.footfalls) continue;
      const update = visual.footfalls.update.bind(visual.footfalls);
      visual.footfalls.update = input => { visual.__verifiedContacts = input.contacts; return update(input); };
    }
    const route = app.humanFootfall.bind(app), play = app.audio.footstep.bind(app.audio);
    app.humanFootfall = (bodyId, point, speed) => {
      const visual = app.actors.get(bodyId)?.visual;
      window.__footEvidence.route = { bodyId, own: bodyId === app.ownBodyId, speed, source: visual?.animator.contactSource(), support: visual?.__verifiedContacts, point: { x: point.x, y: point.y, z: point.z } };
      try { route(bodyId, point, speed); } finally { window.__footEvidence.route = null; }
    };
    app.audio.footstep = (surface, intensity, mix) => {
      window.__footEvidence.calls.push({ phase: window.__footEvidence.phase, at: performance.now(), surface, intensity, mix, ...window.__footEvidence.route });
      play(surface, intensity, mix);
    };
  });
  // The user gesture starts the context. Move away from the fixture dummy.
  await page.keyboard.press('ShiftLeft'); await page.waitForTimeout(900);
  await page.evaluate(() => window.__footEvidence.phase = 'walk');
  await page.keyboard.down('KeyS'); await page.waitForTimeout(2600);
  await page.evaluate(() => window.__footEvidence.phase = 'run');
  await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(2400);
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyS'); await page.waitForTimeout(700);
  await page.evaluate(() => window.__footEvidence.phase = 'stopped'); await page.waitForTimeout(1100);
  const result = await page.evaluate(() => ({ ...window.__footEvidence, running: window.__tv.audio.running,
    imported: window.__tv.actors.get(window.__tv.ownBodyId).visual.contactFootfalls }));
  assert.equal(result.imported, true); assert.equal(result.running, true);
  for (const phase of ['walk', 'run']) {
    const calls = result.calls.filter(c => c.own && c.phase === phase);
    assert.ok(calls.length >= 2, `Missing contact footfalls during ${phase}`);
    assert.ok(calls.every(c => c.support?.some(Boolean) && c.speed > .12), 'Expected an observed or baked support edge');
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= 100, 'Chattering steps');
  }
  assert.equal(result.calls.filter(c => c.own && ['idle', 'stopped'].includes(c.phase)).length, 0);
  assert.equal(result.calls.filter(c => !c.bodyId).length, 0, 'Imported body must not use the distance fallback');

  // Auditionable, deterministic-noise renders of the real synthesis method. This
  // verifies output energy/panning/headroom; it does not replace a listening review.
  const renders = await page.evaluate(async () => {
    const result = [];
    for (const surface of ['grass', 'dirt', 'stone', 'wood', 'water']) {
      const context = new OfflineAudioContext(2, 24000, 48000);
      const audio = new window.__tv.audio.constructor();
      audio.ctx = context; audio.buses = { effects: context.createGain() }; audio.buses.effects.connect(context.destination);
      audio.noise = context.createBuffer(1, 96000, 48000);
      let seed = 11, brown = 0; const noise = audio.noise.getChannelData(0);
      for (let i = 0; i < noise.length; i++) { seed = Math.imul(seed, 1664525) + 1013904223; const white = (seed >>> 0) / 2147483648 - 1; brown = .97 * brown + .03 * white; noise[i] = brown * 6 + white * .15; }
      Object.defineProperty(audio, 'running', { get: () => true });
      const random = Math.random; Math.random = () => .5;
      try { audio.footstep(surface, 1.3, { pan: .6, wet: surface === 'dirt' ? .8 : 0 }); } finally { Math.random = random; }
      const rendered = await context.startRendering();
      result.push({ surface, channels: [Array.from(rendered.getChannelData(0)), Array.from(rendered.getChannelData(1))] });
    }
    return result;
  });
  result.renders = [];
  for (const render of renders) {
    const peak = Math.max(...render.channels.flat().map(Math.abs));
    const energy = render.channels.map(channel => Math.sqrt(channel.reduce((sum, n) => sum + n * n, 0) / channel.length));
    assert.ok(peak > .01 && peak < .9, `Missing/clipped ${render.surface} sound`);
    assert.ok(energy[1] > energy[0] * 1.5, 'Right pan must be audible');
    const frames = render.channels[0].length, buffer = Buffer.alloc(44 + frames * 4);
    buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22); buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(192000, 28);
    buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(frames * 4, 40);
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) buffer.writeInt16LE(Math.round(render.channels[ch][i] * 32767), 44 + i * 4 + ch * 2);
    writeFileSync(`${out}/${render.surface}.wav`, buffer);
    result.renders.push({ surface: render.surface, peak, rms: energy });
  }
  assert.deepEqual(errors, []);
  writeFileSync(out + '/result.json', JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, calls: result.calls.length, walk: result.calls.filter(c => c.own && c.phase === 'walk').length,
    run: result.calls.filter(c => c.own && c.phase === 'run').length, renders: result.renders, errors }));
} finally { await browser.close(); }
