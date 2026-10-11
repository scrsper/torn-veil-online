import { Engine, FreeCamera, Vector3 } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import { Atmosphere } from '../world/atmosphere';
import { CharacterFactory } from '../actors/characterFactory';
import {SharedCharacters} from '../actors/sharedCast';
import type {BodyVisual} from '../actors/actorManager';
import {contextFor} from '../actors/canonicalActionContext';
import { realize } from '../actors/appearanceMap';
import { RealmRenderer } from './render';
import type { RealmSnapshot } from '../../sim/world/realms/session';
import './style.css';

/** Existing Babylon shell, shared renderer/atmosphere/body kits. The browser sends
 * intentions and projects server state; it never creates or steps a canonical World. */
export async function startRealms(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement, ui = document.getElementById('ui')!;
  const params = new URLSearchParams(location.search);
  const ctx = await createRenderer(canvas, { quality: params.get('quality') === 'low' ? 'low' : 'balanced' });
  const camera = new FreeCamera('realm-camera', new Vector3(48.5, 2.65, 20.5), ctx.scene);
  camera.minZ = .1; camera.maxZ = 2000; camera.fov = 1.12;
  const atmosphere = new Atmosphere(ctx); attachPipeline(ctx, camera);
  // City canyons need a readable sky fill. Keep the shared clock/sun direction and
  // restrained exposure; never brighten the walls by changing canonical daylight.
  atmosphere.look.fill = 1.35; atmosphere.look.key = 1.08; atmosphere.look.exposure = 1.08;
  atmosphere.shadow.setDarkness(.32);
  // The shared rural sky uses large illustrated discs. City street views use a
  // restrained apparent sun/moon size behind the layered building silhouettes.
  for (const name of ['sun-disc', 'moon-disc']) ctx.scene.getMeshByName(name)?.scaling.setAll(.16);
  const renderer = new RealmRenderer(ctx, atmosphere), factory = new CharacterFactory();
  const people=new SharedCharacters(ctx.scene);
  const residents = new Map<string, BodyVisual>();
  void factory.load(ctx.scene, undefined, ['f', 'm']);
  ui.innerHTML = `<div class="rv-shell">
    <header class="rv-heading"><div class="rv-kicker">TORN VEIL <span>CONNECTED REALMS</span></div><h1 id="rv-title">Opening the Veil</h1><p id="rv-district">Restoring your journey…</p></header>
    <div class="rv-card rv-wayfinder"><small>THRESHOLD SQUARE</small><b id="rv-destination">Aether Reach ↔ Cinderveil</b><p>The Tower anchors both sides of the Veil.</p><button id="rv-portal">Walk to portal</button><button id="rv-tower">Walk to Tower</button><button id="rv-canonical" hidden>Enter shared Tower trial</button><button id="rv-ascend" hidden>Historical score-based Tower lab</button><button id="rv-journal">Character & journey</button></div>
    <div class="rv-reticle">·</div><div class="rv-toast" id="rv-toast" aria-live="polite"></div>
    <div class="rv-prompt" id="rv-prompt">Loading nearby streets…</div>
    <footer><span>WASD move · drag to look · Shift run · E interact · I journal</span><span id="rv-stream"></span></footer>
    <section class="rv-modal" id="rv-choice" hidden><small>THE VEIL</small><h2 id="rv-choice-title"></h2><p>Your identity, possessions and development travel with you.</p><button id="rv-cross">Cross threshold</button><button id="rv-cancel">Stay here</button></section>
    <section class="rv-modal rv-journal" id="rv-sheet" hidden><small>YOUR JOURNEY</small><h2 id="rv-name"></h2><div id="rv-character"></div><p class="rv-note">The shared Tower trial carries this body, its injuries and belongings. Historical score-based expeditions are comparison evidence and do not define current progression.</p><button id="rv-save">Save journey</button><button id="rv-close">Return to world</button></section>
    <section class="rv-modal" id="rv-expedition" hidden><small>THE TOWER</small><h2>Your expedition awaits</h2><p>Continue from the last saved floor start, or return to your atrium landing.</p><button id="rv-resume">Continue expedition</button><button id="rv-return">Return to atrium</button></section>
    <div class="rv-loading" id="rv-loading">Preparing nearby streets…</div>
  </div>`;
  await people.load(text=>{document.getElementById('rv-loading')!.textContent=text;});
  const el = (id: string) => document.getElementById(id)!;
  const keys = new Set<string>(), frames: number[] = [], streamingFrames: number[] = [], serverSamples: number[] = [], journeys: { realm: string; at: number; readyAt?: number }[] = [];
  let state: RealmSnapshot | null = null, yaw = 0, pitch = .2, dragging = false, timer = 0, last = performance.now(), lastRealm = '', lastStateAt = 0, journal = false, connected = false;
  let controllerToken = '', transitioning = false;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realms/socket`);
  const send = (value: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const toast = (text: string) => { el('rv-toast').textContent = text; clearTimeout(timer); timer = window.setTimeout(() => { el('rv-toast').textContent = ''; }, 4500); };
  socket.addEventListener('open', () => { connected = true; });
  socket.addEventListener('close', e => { connected = false; el('rv-loading').hidden = false; el('rv-loading').textContent = e.reason || 'Connection closed. Reload to return to your saved journey.'; });
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.type === 'controller') controllerToken = m.token;
    if (m.type === 'regions') renderer.reconcile(m.wanted, m.chunks);
    if (m.type === 'notice') toast(m.message);
    if (m.type !== 'state') return;
    state = m.state; const s = state!; lastStateAt = performance.now();
    serverSamples.push(m.serverMs); if (serverSamples.length > 600) serverSamples.shift();
    if (lastRealm !== s.realm) {
      lastRealm = s.realm; camera.position.set(s.body.pos.x - renderer.origin.x, s.body.pos.y + 1.65, s.body.pos.z - renderer.origin.z);
      yaw = 0; journeys.push({ realm: s.realm, at: performance.now() });
      for (const r of residents.values()) r.root.setEnabled(false);
    }
    el('rv-title').textContent = s.tower ? 'Tower of Chrysanthus' : s.realmName;
    el('rv-district').textContent = s.tower ? 'THE ATRIUM · WALK BACK THROUGH THE GATE TO RETURN' : s.subtitle;
    el('rv-prompt').textContent = s.prompt;
    el('rv-ascend').hidden = !params.has('historical-lab') || !s.tower || !!s.expedition?.active || !!s.canonicalTower?.active;
    el('rv-canonical').hidden = !s.tower || !!s.expedition?.active;
    if (s.canonicalTower?.active && !transitioning) void openAscent();
    el('rv-expedition').hidden = !s.expedition?.active;
    el('rv-choice').hidden = !s.pending;
    if (s.pending) el('rv-choice-title').textContent = `Enter ${s.pending.destination}?`;
    el('rv-name').textContent = s.person.name;
    const contents = el('rv-character'); contents.replaceChildren();
    for (const line of [`${s.person.rank} · ${s.body.hp.toFixed(0)} / ${s.body.maxHp} vitality`, ...s.person.inventory.map(i => `${i.name} × ${i.quantity}`)]) { const p = document.createElement('p'); p.textContent = line; contents.append(p); }
    renderer.setDoors(s.doors);
    if (m.saveError) toast('Saving is unavailable. Keep this tab open and inspect the local host log.');
  });
  const toggleJournal = () => { journal = !journal; el('rv-sheet').hidden = !journal; keys.clear(); send({ type: 'move', input: { x: 0, z: 0, sprint: false } }); };
  const expedition = async (type: 'enter' | 'return') => {
    if (transitioning || !state) return false;
    transitioning = true; keys.clear(); send({ type: 'move', input: { x: 0, z: 0, sprint: false } });
    try {
      const response = await fetch('/realms/expedition', { method: 'POST', headers: { 'content-type': 'application/json', 'x-realms-controller': controllerToken },
        body: JSON.stringify({ id: crypto.randomUUID(), type, revision: state.expedition?.revision ?? 0, runId: state.expedition?.runId }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      return true;
    } catch (e) { toast(String(e)); return false; } finally { transitioning = false; }
  };
  const openExpedition = async () => {
    transitioning = true; keys.clear();
    await new Promise<void>(resolve => { socket.addEventListener('close', () => resolve(), { once: true }); socket.close(); if (socket.readyState === WebSocket.CLOSED) resolve(); });
    location.assign('/?arena=1&tower=1&world=1&quality=balanced');
  };
  const openAscent = async () => {
    if (transitioning) return; transitioning = true; keys.clear();
    await new Promise<void>(resolve => { socket.addEventListener('close', () => resolve(), { once: true }); socket.close(); if (socket.readyState === WebSocket.CLOSED) resolve(); });
    location.assign('/?ascent');
  };
  el('rv-canonical').onclick = async () => {
    if (!state || transitioning) return; transitioning = true; keys.clear();
    try {
      const response = await fetch('/realms/ascent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-realms-controller': controllerToken },
        body: JSON.stringify({ id: crypto.randomUUID(), type: 'enter', revision: state.canonicalTower?.revision ?? 0, runId: state.canonicalTower?.runId }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      transitioning = false; await openAscent();
    } catch (e) { transitioning = false; toast(String(e)); }
  };
  el('rv-ascend').onclick = () => { void expedition('enter').then(ok => { if (ok) void openExpedition(); }); };
  el('rv-resume').onclick = () => { void openExpedition(); };
  el('rv-return').onclick = () => { void expedition('return'); };
  el('rv-journal').onclick = toggleJournal; el('rv-close').onclick = toggleJournal;
  el('rv-save').onclick = () => send({ type: 'save' });
  el('rv-portal').onclick = () => send({ type: 'navigate', target: 'portal' });
  el('rv-tower').onclick = () => send({ type: 'navigate', target: 'tower' });
  el('rv-cross').onclick = () => { send({ type: 'confirm', id: state?.pending?.id }); keys.clear(); };
  el('rv-cancel').onclick = () => send({ type: 'cancel' });
  el('rv-prompt').onclick = () => send({ type: 'interact' });
  window.addEventListener('keydown', e => {
    if (['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Tab'].includes(e.code)) e.preventDefault();
    if (!e.repeat && e.code === 'KeyE' && !journal) send({ type: 'interact' });
    if (!e.repeat && e.code === 'KeyI') toggleJournal();
    if (e.code === 'Escape') { keys.clear(); send({ type: 'cancel' }); if (journal) toggleJournal(); }
    keys.add(e.code);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); dragging = false; send({ type: 'move', input: { x: 0, z: 0, sprint: false } }); });
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointermove', e => { if (dragging) { yaw -= e.movementX * .003; pitch = Math.max(-1.1, Math.min(1.1, pitch - e.movementY * .003)); } });
  let inputAccumulator = 0, hudAccumulator = 0;
  ctx.engine.runRenderLoop(() => {
    const now = performance.now(), ms = now - last, dt = Math.min(.1, ms / 1000); last = now;
    if (!document.hidden && state && renderer.pending === 0) { frames.push(ms); if (frames.length > 3600) frames.shift(); }
    if (!document.hidden && state && renderer.pending > 0) { streamingFrames.push(ms); if (streamingFrames.length > 1200) streamingFrames.shift(); }
    renderer.upload(); if (state) renderer.setDoors(state.doors);
    if (!renderer.pending && journeys.length && !journeys[journeys.length - 1].readyAt) journeys[journeys.length - 1].readyAt = performance.now();
    el('rv-loading').hidden = connected && !!state && (renderer.loaded.size >= 9 || !!state.expedition?.active);
    const s = state;
    if (s) {
      inputAccumulator += dt; hudAccumulator += dt;
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (keys.has('ArrowLeft')) yaw += dt * 1.3; if (keys.has('ArrowRight')) yaw -= dt * 1.3;
      if (keys.has('ArrowUp')) pitch = Math.min(1.1, pitch + dt); if (keys.has('ArrowDown')) pitch = Math.max(-1.1, pitch - dt);
      if (inputAccumulator >= .05 && !transitioning && !s.expedition?.active) {
        inputAccumulator = 0;
        const x = Math.sin(yaw) * forward - Math.cos(yaw) * right, z = Math.cos(yaw) * forward + Math.sin(yaw) * right, magnitude = Math.max(1, Math.hypot(x, z));
        send({ type: 'move', input: { x: journal ? 0 : x / magnitude, z: journal ? 0 : z / magnitude, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') } });
      }
      const target = new Vector3(s.body.pos.x - renderer.origin.x, s.body.pos.y + 1.65, s.body.pos.z - renderer.origin.z);
      camera.position = Vector3.Lerp(camera.position, target, 1 - Math.exp(-16 * dt));
      camera.setTarget(camera.position.add(new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))));
      atmosphere.update((s.worldTime / 3600 + (s.realm === 'aether' ? 9.866 : 9.066)) % 24, { kind: 'clear', intensity: 0, wind: .25 }, dt);
      ctx.scene.fogDensity = s.realm === 'aether' ? .0026 : .0017;
      if (hudAccumulator > .3) { hudAccumulator = 0; el('rv-stream').textContent = params.has('debug') ? `${renderer.loaded.size} chunks resident · ${renderer.pending} loading` : `${s.person.rank} · ${s.realmName}`; }
      for (const r of residents.values()) r.root.setEnabled(false);
      if (people.ready||factory.ready) for (const n of s.residents) {
        let v = residents.get(n.visual.bodyId);
        if (!v) {
          if (residents.size >= 16) { const oldest = residents.keys().next().value!; residents.get(oldest)!.dispose(); residents.delete(oldest); }
          const r=people.create(n.visual,atmosphere)??factory.create(ctx.scene,atmosphere,n.visual.bodyId,realize(n.id,n.appearance.description,undefined)); if (r) { v = r; residents.set(n.visual.bodyId, r); }
        }
        if (v) {
          v.root.setEnabled(true);
          v.root.position.set(n.pos.x - renderer.origin.x, n.pos.y, n.pos.z - renderer.origin.z); v.root.rotation.y = n.yaw;
          v.update(dt, { bodyId: n.visual.bodyId, body:n.visual, combat:contextFor(n.visual.combatAction,s.time,n.yaw), guard:n.visual.guarding, own: false, kind: 'person', speed: Math.hypot(n.vel.x, n.vel.z), velocity: n.vel, yaw: n.yaw, crouch: 0, age: 0 });
        }
      }
    }
    ctx.scene.render();
  });
  // Observations only: the harness drives ordinary keys/buttons, never mutates the world.
  Object.defineProperty(window, 'tvRealms', { value: { get state() { return state; }, get ready() { return !!state && !renderer.pending; },
    inspect: () => ({ frames: [...frames], streamingFrames: [...streamingFrames], uploads: [...renderer.uploads], serverSamples: [...serverSamples], journeys: [...journeys], loaded: renderer.loaded.size, pending: renderer.pending,
      meshes: ctx.scene.meshes.length, textures: ctx.scene.textures.length, materials: ctx.scene.materials.length, lights: ctx.scene.lights.length,
      towerDoors: [...renderer.loaded.values()].flatMap(c=>c.doors.filter(d=>d.mesh.name.includes(':tower:')).map(d=>({name:d.mesh.name,enabled:d.mesh.isEnabled(),panels:d.mesh.getChildMeshes().map(m=>m.isEnabled())}))),
      residentLooks:[...residents.values()].map(v=>v.root.metadata), renderer: ctx.kind, staleMs: performance.now() - lastStateAt,
      width: ctx.engine.getRenderWidth(), height: ctx.engine.getRenderHeight(), hardware: ctx.engine instanceof Engine ? ctx.engine.getGlInfo() : null,
      heap: (() => { const m = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory; return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null; })(), state }) } });
}
