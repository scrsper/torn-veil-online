import { FreeCamera, Vector3, Color3 } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import { Atmosphere } from '../world/atmosphere';
import { combatGymStage } from '../world/combatGymStage';
import { SharedCharacters } from '../actors/sharedCast';
import type { BodyVisual } from '../actors/actorManager';
import type { BodyState, CombatActionState, InteractionCommand } from '../net/messages';
import { contextFor } from '../actors/canonicalActionContext';

/** Acceptance surface for the existing shared renderer and canonical bridge. No World,
 * Fighter, HP, hit validation, cooldown or progression is simulated in this browser. */
export async function startMotionReview() {
  const canvas = document.getElementById('game') as HTMLCanvasElement, ui = document.getElementById('ui')!;
  const ctx = await createRenderer(canvas, { quality: 'balanced' }), camera = new FreeCamera('motion-camera', new Vector3(25, 9, 32), ctx.scene);
  camera.minZ = .1; camera.maxZ = 120; camera.fov = .8;
  const atmosphere = new Atmosphere(ctx); attachPipeline(ctx, camera); combatGymStage(ctx, atmosphere);
  atmosphere.look.fill = 1.1; atmosphere.look.key = 1.1; atmosphere.look.exposure = 1;
  const people = new SharedCharacters(ctx.scene);
  ui.innerHTML = `<div style="position:absolute;left:24px;top:20px;color:#172333;font:14px system-ui;pointer-events:auto;background:#f4f7fae8;padding:16px 20px;border-radius:9px;max-width:380px">
    <strong style="font-size:19px">Torn Veil · shared motion review</strong><p>Isolated canonical combat fixture · no player save</p>
    <button id="motion-single">Single partner</button> <button id="motion-incoming">Incoming attack</button> <button id="motion-crowd">Five partners</button>
    <p>WASD move · Shift run / C crouch · J strike · K heavy · L low<br>Space dodge · G guard · Tab retarget · Esc release</p><p id="motion-status">Loading shared people and existing licensed motion…</p></div>`;
  const status = document.getElementById('motion-status')!;
  await people.load(t => { status.textContent = t; });
  const ws = new WebSocket(`ws://${location.host}/motion/socket`);
  let binding: any = null, frame: any = null, receivedAt = 0, sequence = 0, targetId = '', last = performance.now(), inputAccum = 0, ready = false;
  const keys = new Set<string>(), visuals = new Map<string, { visual: BodyVisual; body: BodyState; hitSeq: number; hit: number }>();
  const frameTimes: number[] = [], commands: any[] = [], serverTimes: number[] = [];
  const send = (command: InteractionCommand) => {
    if (!binding || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ version: 2, type: 'command', ...binding, commandId: `review-${sequence}`, sequence: sequence++, clientTimeMs: performance.now(), command }));
  };
  const strike = (weight: 'light' | 'heavy' = 'light', trajectory: 'high' | 'low' = 'high') => send({ type: 'attack', weight, trajectory, targetBodyId: targetId || undefined });
  const release = () => { keys.clear(); send({ type: 'move', x: 0, z: 0, sprint: false }); send({ type: 'guard', held: false }); send({ type: 'crouch', held: false }); };
  for (const name of ['single', 'incoming', 'crowd']) document.getElementById(`motion-${name}`)!.onclick = () => { release(); ws.send(JSON.stringify({ type: 'fixture', name })); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'binding') { binding = m.interaction; sequence = 0; targetId = ''; for (const v of visuals.values()) v.visual.dispose(); visuals.clear(); ready = false; }
    if (m.type === 'frame') {
      frame = m; receivedAt = performance.now(); serverTimes.push(m.serverMs); if (serverTimes.length > 1800) serverTimes.shift();
      const bodies = m.snapshot.bodies as BodyState[];
      targetId ||= bodies.find(b => b.bodyId !== binding.bodyId && !b.dead)?.bodyId ?? '';
      const present = new Set(bodies.map(b => b.bodyId));
      for (const [id, v] of visuals) if (!present.has(id)) { v.visual.dispose(); visuals.delete(id); }
      for (const body of bodies) {
        let v = visuals.get(body.bodyId);
        if (!v) { const visual = people.create(body, atmosphere); if (!visual) continue; visual.root.position.set(body.pos.x, body.pos.y, body.pos.z); v = { visual, body, hitSeq: body.hitSeq, hit: 0 }; visuals.set(body.bodyId, v); }
        if (body.hitSeq > v.hitSeq) v.hit = 1;
        v.hitSeq = body.hitSeq; v.body = body;
      }
      ready = visuals.has(binding.bodyId);
    }
    if (m.type === 'command_receipt' && m.status !== 'received') { commands.push(m); if (commands.length > 500) commands.shift(); }
  };
  ws.onclose = () => { ready = false; status.textContent = 'Review disconnected. Reload to reconnect.'; };
  window.addEventListener('keydown', e => {
    if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
    keys.add(e.code); if (e.repeat) return;
    if (e.code === 'KeyC') send({ type: 'crouch', held: true });
    if (e.code === 'KeyJ') strike(); if (e.code === 'KeyK') strike('heavy'); if (e.code === 'KeyL') strike('light', 'low');
    if (e.code === 'Space') { const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0); send({ type: 'defend', kind: x ? 'sidestep' : 'backstep', direction: { x, z: z || (x ? 0 : 1) } }); }
    if (e.code === 'Tab' && frame) { const ids = (frame.snapshot.bodies as BodyState[]).filter(b => b.bodyId !== binding.bodyId && !b.dead).map(b => b.bodyId); targetId = ids[(ids.indexOf(targetId) + 1) % ids.length] ?? ''; }
    if (e.code === 'Escape') release();
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyG') send({ type: 'guard', held: false }); if (e.code === 'KeyC') send({ type: 'crouch', held: false }); }); window.addEventListener('blur', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) strike(); if (e.button === 2) keys.add('KeyG'); });
  window.addEventListener('pointerup', e => { if (e.button === 2) keys.delete('KeyG'); });
  ctx.engine.runRenderLoop(() => {
    const now = performance.now(), ms = now - last, dt = Math.min(.1, ms / 1000); last = now;
    if (ready && !document.hidden) { frameTimes.push(ms); if (frameTimes.length > 3600) frameTimes.shift(); }
    if (frame && binding) {
      const own = frame.snapshot.bodies.find((b: BodyState) => b.bodyId === binding.bodyId) as BodyState;
      const target = frame.snapshot.bodies.find((b: BodyState) => b.bodyId === targetId) as BodyState | undefined;
      inputAccum += dt;
      if (inputAccum >= 1 / 60) {
        inputAccum = 0;
        const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0), m = Math.max(1, Math.hypot(x, z));
        const facing = keys.has('KeyG') && target ? Math.atan2(own.pos.x - target.pos.x, own.pos.z - target.pos.z) : undefined;
        send({ type: 'move', x: x / m, z: z / m, sprint: keys.has('ShiftLeft'), crouch: keys.has('KeyC'), facing });
        if (keys.has('KeyG')) send({ type: 'guard', held: true });
      }
      const age = Math.min(.075, Math.max(0, (now - receivedAt) / 1000)), time = frame.snapshot.tick + age;
      for (const v of visuals.values()) {
        const b = v.body, root = v.visual.root, extrapolate = new Vector3(b.pos.x + b.velocity.x * age, b.pos.y, b.pos.z + b.velocity.z * age);
        root.position.copyFrom(Vector3.Lerp(root.position, extrapolate, 1 - Math.exp(-20 * dt)));
        root.rotation.y = b.yaw; v.hit *= Math.exp(-dt * 8);
        v.visual.update(dt, { bodyId: b.bodyId, own: b.bodyId === binding.bodyId, kind: 'person', body: b, speed: Math.hypot(b.velocity.x, b.velocity.z), velocity: b.velocity, yaw: b.yaw, crouch: b.crouch ?? 0, age, combat: contextFor(b.combatAction, time, b.yaw), hit: v.hit, guard: b.guarding });
      }
      const root = visuals.get(binding.bodyId)?.visual.root;
      if (root) { const pivot = root.position.add(new Vector3(0, .9, 0)); camera.position.copyFrom(Vector3.Lerp(camera.position, pivot.add(new Vector3(3.2, 4.6, 6)), 1 - Math.exp(-6 * dt))); camera.setTarget(pivot); }
      status.textContent = `${frame.fixture} · ${visuals.size - 1} partners · ${own.combatAction?.phase ?? 'ready'} · HP ${Math.round((own as any).health ?? 0)} · target ${targetId}`;
    }
    atmosphere.follow(camera.position); atmosphere.update(10, { kind: 'clear', intensity: 0, wind: .2 }, dt); ctx.scene.fogColor = new Color3(.84, .86, .88); ctx.scene.render();
  });
  Object.defineProperty(window, 'tvMotion', { value: { get ready() { return ready; }, get frame() { return frame; }, inspect: () => ({ frames: [...frameTimes], serverMs: [...serverTimes], commands: [...commands], meshes: ctx.scene.meshes.length, materials: ctx.scene.materials.length, textures: ctx.scene.textures.length, people: visuals.size, mocap: people.assets.mocap, looks: [...visuals.values()].map(v => v.visual.root.metadata), heap: (performance as any).memory?.usedJSHeapSize ?? null }) } });
  window.addEventListener('resize', () => ctx.engine.resize());
}
