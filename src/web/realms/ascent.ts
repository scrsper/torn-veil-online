import { FreeCamera, Vector3, Matrix, Color3, MeshBuilder, StandardMaterial, PBRMaterial, Mesh, Ray, type Material } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import { Atmosphere } from '../world/atmosphere';
import { SharedCharacters } from '../actors/sharedCast';
import { contextFor } from '../actors/canonicalActionContext';
import { Vfx } from '../arena/vfx';
import type { Element } from '../arena/tower/capability';
import { stoneSurface, tiledBox, LOOKS } from '../arena/environment';
import { loadScannedMaps, useScannedMaps } from '../render/materials';
import type { BodyVisual } from '../actors/actorManager';
import type { BodyState, InteractionCommand, SnapshotMessage } from '../net/messages';
import type { InteriorPlan } from '../../sim/world/interiors/layout';
import type { TowerController } from '../../server/towerController';
import { primaryCamera, attachOrbit, cameraRelativeMove, travelFacing, smoothYaw, groundViewYaw, walkingMove } from './thirdPerson';
import { voxelSolid, insideSolid, boxObstruction } from './cameraSolids';
import { InteriorCameraFraming } from './interiorCamera';

type Frame = NonNullable<ReturnType<TowerController['frame']>> & { serverMs: number; saveError?: string };
/** A projection of the shared body and physical floor. Only input and visual smoothing
 * run here; damage, casts, learning, ownership and floor clearance remain host-owned. */
export async function startCanonicalAscent() {
  const canvas = document.getElementById('game') as HTMLCanvasElement, ui = document.getElementById('ui')!;
  const ctx = await createRenderer(canvas, { quality: 'balanced' }), camera = new FreeCamera('ascent-camera', new Vector3(0, 7, 8), ctx.scene);
  camera.minZ = .15; camera.maxZ = 180; camera.fov = .83;
  const view = primaryCamera('tower');
  const framing = new InteriorCameraFraming();
  let movementYaw = view.camera.yaw;
  const atmosphere = new Atmosphere(ctx); attachPipeline(ctx, camera);
  atmosphere.look.fill = 1.1; atmosphere.look.key = 1.05; atmosphere.look.exposure = 1;
  const people = new SharedCharacters(ctx.scene), visuals = new Map<string, { visual: BodyVisual; body: BodyState; hitSeq: number; hit: number }>();
  const geometry: Mesh[] = [], objects = new Map<string, Mesh>(), keys = new Set<string>();
  let walls: InteriorPlan['solids'] = [];
  const vfx = new Vfx(ctx.scene), seenCasts = new Set<string>();
  let binding: any = null, frame: Frame | null = null, plan: InteriorPlan | null = null, token = '', sequence = 0, targetId = '', receivedAt = 0,
    last = performance.now(), inputAccum = 0, hudAccum = 0, ready = false, movingPage = false, resetView = true, inputWasActive = false;
  const frames: number[] = [], serverTimes: number[] = [], receipts: any[] = [];
  const material = (name: string, color: string, emissive = false) => {
    const m = new StandardMaterial(name, ctx.scene); m.diffuseColor = Color3.FromHexString(color); m.specularColor = Color3.FromHexString('#25272a');
    if (emissive) m.emissiveColor = m.diffuseColor.scale(.55); return m;
  };
  const stone = stoneSurface(ctx.scene, LOOKS.Normal).mat, floorMat = new PBRMaterial('physical trial paving', ctx.scene), brass = material('trial brass', '#b99a59'),
    blue = material('return threshold', '#82d5e5', true), gold = material('ascent threshold', '#e0be74', true), bookMat = material('source tome', '#903f46');
  useScannedMaps(floorMat, loadScannedMaps(ctx.scene, 'cobblestone_floor_08')); floorMat.roughness = .94; floorMat.metallic = 0;
  floorMat.environmentIntensity = .35; floorMat.albedoColor = new Color3(.7, .65, .55);
  const targetRing = MeshBuilder.CreateTorus('selected visible opponent', { diameter: 1.1, thickness: .045, tessellation: 32 }, ctx.scene);
  targetRing.material = gold; targetRing.isPickable = false; targetRing.setEnabled(false);
  function box(id: string, x: number, y: number, z: number, w: number, h: number, d: number, m: Material) {
    const mesh = tiledBox(id, w, h, d, 2.8, ctx.scene); mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
    mesh.material = m; mesh.receiveShadows = true; return mesh;
  }
  function drawFloor(p: InteriorPlan) {
    for (const mesh of geometry) mesh.dispose(); geometry.length = 0; plan = p;
    geometry.push(box('physical floor', p.origin.x - p.half - 1, 0, p.origin.z - p.half - 1, p.half * 2 + 2, 1, p.half * 2 + 2, floorMat));
    const solids = p.solids.map(voxelSolid); walls = solids.filter(s => s.kind === 'wall');
    for (const s of solids) { const mesh = box(s.id, s.x, s.y, s.z, s.w, s.h, s.d, s.kind === 'bench' ? brass : stone); mesh.metadata = { wall: s.kind === 'wall' }; geometry.push(mesh); }
    // Thin inlays and threshold discs decorate existing walkable surfaces; they do not
    // invent doors, new rooms or invisible collision geometry.
    for (const [i, point] of [p.start, p.exit].entries()) {
      const ring = MeshBuilder.CreateTorus(i ? 'ascent ring' : 'return ring', { diameter: 3.2, thickness: .09, tessellation: 48 }, ctx.scene);
      ring.position.set(point.x, 1.06, point.z); ring.material = i ? gold : blue; geometry.push(ring);
    }
    for (const room of p.rooms) for (const side of [0, 1]) geometry.push(box(`${room.id}-inlay-${side}`, room.x + .15, 1.012, room.z + (side ? room.d - .2 : .15), room.w - .3, .015, .045, brass));
    for (const mesh of geometry) mesh.computeWorldMatrix(true);
    view.camera.snap(); framing.reset(); resetView = true;
  }
  ui.innerHTML = `<style>
    .ascent{font:14px system-ui;color:#f0eade;pointer-events:none}.ascent header,.ascent aside,.ascent footer{position:absolute;background:#14171eea;border:1px solid #7d705644;border-radius:8px;padding:15px;pointer-events:auto}
    .ascent header{left:18px;top:16px;width:270px;padding:12px;background:#14171ed9}.ascent h1{font:20px Georgia;margin:5px 0}.ascent small{letter-spacing:2px;color:#d7bb80}.ascent p{line-height:1.5;margin:7px 0;font-size:12px}.ascent #as-status{white-space:pre-line}.ascent #as-panel[hidden]{display:none}.ascent a{color:#d7bb80}.ascent #as-notice:empty{display:none}.ascent footer{font-size:12px}.ascent #as-target{color:#efce89;margin-left:20px}
    .ascent aside{right:18px;top:18px;width:240px;max-height:75vh;overflow:auto}.ascent button{display:inline-block;color:#f5ebd3;background:#343a43;border:1px solid #bba47766;border-radius:4px;padding:7px 10px;margin:3px;cursor:pointer}.ascent button:hover{background:#505563}.ascent footer{bottom:18px;left:20px;right:20px;display:flex;justify-content:space-between}.ascent #as-notice{color:#f2c786;min-height:20px}.ascent #as-loading{position:absolute;inset:0;display:grid;place-items:center;background:#111620e8;font-size:21px}.ascent #as-loading[hidden]{display:none}
  </style><div class="ascent"><header><small>CHRYSANTHUS</small><h1 id="as-title">Entering the Tower</h1><p id="as-status">Restoring your journey.</p><button id="as-journal">Journey · I</button><div id="as-notice"></div></header><aside id="as-panel" hidden><small>YOUR JOURNEY</small><p id="as-detail"></p><details><summary>Controls</summary><p>WASD move · Shift run · J strike · K heavy · L low<br>Space dodge · G guard · Tab target · Q face<br>E take / open · 1-6 cast · F threshold<br>MMB orbit · wheel zoom · Esc close</p></details><div id="as-sources"></div><div id="as-actions"></div><div id="as-spells"></div><button id="as-return">Return at blue threshold</button><button id="as-next">Ascend at gold threshold</button><button id="as-save">Save</button><a href="/">Home</a></aside><footer><span id="as-goal">Defeat the wardens.</span><span id="as-target"></span></footer><div id="as-loading">Loading existing shared characters.</div></div>`;
  const el = (id: string) => document.getElementById(id)!, notice = (text: string) => { el('as-notice').textContent = text; };
  await people.load(text => { el('as-loading').textContent = text; });
  const ws = new WebSocket(`ws://${location.host}/realms/ascent/socket`);
  function send(command: InteractionCommand) {
    if (binding && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ version: 2, type: 'command', ...binding,
      commandId: `ascent-${sequence}`, sequence: sequence++, clientTimeMs: performance.now(), command }));
  }
  el('as-journal').onclick=()=>toggleJournal();
  let mouseGuard=false;
  let journalOpen=false;
  const toggleJournal=()=>{journalOpen=!journalOpen;el('as-panel').hidden=!journalOpen;release();};
  const release = () => { keys.clear(); mouseGuard=false; inputWasActive = false; send({ type: 'move', x: 0, z: 0, sprint: false }); send({ type: 'guard', held: false }); send({ type: 'crouch', held: false }); };
  async function leaveView() {
    if (movingPage) return; movingPage = true; release();
    await new Promise<void>(resolve => { ws.addEventListener('close', () => resolve(), { once: true }); ws.close(); if (ws.readyState === WebSocket.CLOSED) resolve(); });
    location.assign('/?realms');
  }
  async function transition(type: 'ascend' | 'return') {
    if (!frame || movingPage) return; release();
    try {
      const r = await fetch('/realms/ascent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-realms-controller': token },
        body: JSON.stringify({ id: crypto.randomUUID(), type, revision: frame.tower.revision, runId: frame.tower.id }) });
      const data = await r.json(); if (!r.ok) throw Error(data.error);
      if (type === 'return') await leaveView();
    } catch (e) { notice(String(e)); }
  }
  function cast(index: number) {
    const spell = frame?.own.learned[index], target = frame?.snapshot.bodies.find(b => b.bodyId === targetId);
    if (spell) send({ type: 'cast', abilityId: spell.id, target: target ? { ...target.pos, y: target.pos.y + 1 } : undefined });
  }
  function nearestHand() {
    const a = frame?.snapshot.interactions.find(a => a.kind === 'take') ?? frame?.snapshot.interactions.find(a => a.slot === 'nearby');
    if (a) send({ type: 'interact', interactionId: a.id });
  }
  function button(parent: HTMLElement, label: string, action: () => void) { const b = document.createElement('button'); b.textContent = label; b.onclick = action; parent.append(b); }
  function refreshHud() {
    if (!frame) return;
    const { own, tower } = frame;
    el('as-title').textContent = `Floor ${tower.floor} · ${tower.clear ? 'Trial cleared' : tower.defeated+'/'+tower.opponents+' wardens'}`;
    el('as-status').textContent = `${own.name} · ${own.rank}\nVitality ${Math.ceil(own.health)}/${own.maxHealth} · Mana ${Math.floor(own.mana)}/${own.capacity.reserve}`;
    el('as-detail').textContent = `${own.name} · ${own.rank} · Vitality ${Math.ceil(own.health)} / ${own.maxHealth} · Mana ${Math.floor(own.mana)} / ${own.capacity.reserve} · Breath ${Math.round(own.breath * 100)}% · Fatigue ${Math.round(own.fatigue * 100)}% · Food ${Math.round(own.food * 100)}% · Water ${Math.round(own.water * 100)}% · ${tower.defeated}/${tower.opponents} wardens`;
    el('as-goal').textContent = tower.floor===100&&tower.clear?'Summit recognition · Journey for requirements':tower.clear?'Open award chest · E take · F ascend':'Defeat the wardens · G guard · Space dodge';
    const a = el('as-actions'); a.replaceChildren();
    const rest = frame.snapshot.abilities.find(a => a.id === 'rest' || a.id === 'wake');
    if (rest?.available) button(a, rest.label, () => { release(); send({ type: rest.id as 'rest' | 'wake' }); });
    for (const action of frame.snapshot.interactions) button(a, action.label, () => send({ type: 'interact', interactionId: action.id }));
    const container = frame.snapshot.container as SnapshotMessage['container'] as { id: string; items: { id: string; name: string }[] } | null;
    for (const i of container?.items ?? []) button(a, `Take ${i.name}`, () => send({ type: 'container_transfer', containerId: container!.id, itemId: i.id, direction: 'out' }));
    const sources = el('as-sources'); sources.replaceChildren();
    if (own.growth.next) {
      const status = document.createElement('p'); status.textContent = `${own.growth.next}: ${own.growth.eligible ? 'Ready to integrate earned sources' : own.growth.reasons.join(' · ')}`; sources.append(status);
      if (own.growth.eligible) button(sources, `Integrate sources — ${own.growth.next}`, () => { release(); send({ type: 'integrate_arcana' }); });
    }
    for (const i of own.sources.filter(i => !own.learned.some(s => s.id === i.abilityId))) button(sources, `Study ${i.name}`, () => send({ type: 'learn_arcana', itemId: i.id }));
    const spells = el('as-spells'); spells.replaceChildren();
    own.learned.forEach((s, i) => button(spells, `${i + 1} · ${s.name}`, () => cast(i)));
  }
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'controller') token = m.token;
    if (m.type === 'binding') { binding = m.interaction; sequence = 0; keys.clear(); }
    if (m.type === 'tower_geometry') drawFloor(m.plan);
    if (m.type === 'tower_returned') void leaveView();
    if (m.type === 'notice') notice(m.message);
    if (m.type === 'command_receipt' && m.status !== 'received') { receipts.push(m); if (receipts.length > 600) receipts.shift(); if (m.status === 'rejected' && !['cooldown', 'incapacitated', 'expired','committed'].includes(m.result)) notice(String(m.result).replaceAll('_',' ')); }
    if (m.type !== 'tower_frame' || !binding) return;
    const observed = m as Frame; frame = observed; receivedAt = performance.now(); serverTimes.push(m.serverMs); if (serverTimes.length > 2400) serverTimes.shift();
    // Draw only host-observed cast phases. Effects never choose targets, apply hits,
    // or persist gameplay; missed/cancelled casts cannot invent impact feedback.
    for (const cast of observed.casts) {
      const phase = cast.resolved ? 'resolved' : 'windup', key = `${cast.id}:${phase}`;
      if (cast.cancelled || seenCasts.has(key)) continue;
      seenCasts.add(key); if (seenCasts.size > 128) seenCasts.delete(seenCasts.values().next().value!);
      const elements = ['flame', 'frost', 'storm', 'swift', 'iron', 'shadow', 'verdance', 'water', 'gravity', 'time'];
      const element = (cast.riders.find(r => elements.includes(r)) ?? 'iron') as Element;
      const from = new Vector3(cast.origin.x, cast.origin.y + 1.2, cast.origin.z), to = new Vector3(cast.target.x, cast.origin.y + 1.2, cast.target.z);
      if (!cast.resolved) vfx.core(element, from, .2, Math.max(.05, cast.activeAt - observed.snapshot.tick));
      else if (cast.kernel === 'cone' || cast.kernel === 'wave') vfx.spray(element, from, to.subtract(from).normalize(), cast.range, .65);
      else vfx.core(element, ['heal', 'ward', 'frenzy', 'imbue'].includes(cast.kernel) ? from : to, .6, .35);
    }
    const bodies = m.snapshot.bodies as BodyState[], present = new Set(bodies.map(b => b.bodyId));
    if (!bodies.some(b => b.bodyId === targetId && !b.dead && !b.incapacitated && !frame!.tower.retiredBodyIds.includes(b.bodyId))) targetId = bodies.find(b => b.bodyId !== binding.bodyId && !b.dead && !b.incapacitated && !frame!.tower.retiredBodyIds.includes(b.bodyId))?.bodyId ?? '';
    for (const [id, v] of visuals) if (!present.has(id)) { v.visual.dispose(); visuals.delete(id); }
    for (const body of bodies) {
      let v = visuals.get(body.bodyId);
      if (!v) { const visual = people.create(body, atmosphere, undefined, body.bodyId===binding.bodyId?'player':'resident'); if (!visual) continue; visual.root.position.set(body.pos.x, body.pos.y, body.pos.z); v = { visual, body, hitSeq: body.hitSeq, hit: 0 }; visuals.set(body.bodyId, v); }
      if (body.hitSeq > v.hitSeq) v.hit = 1; v.hitSeq = body.hitSeq; v.body = body;
    }
    const things = [...m.waterSources.map((i: any) => ({ ...i, water: true })), ...m.items.map((i: any) => ({ ...i, chest: false })), ...m.containers.map((i: any) => ({ ...i, chest: true }))], wanted = new Set(things.map(i => i.id));
    for (const [id, mesh] of objects) if (!wanted.has(id)) { mesh.dispose(); objects.delete(id); }
    for (const i of things) if (!objects.has(i.id)) objects.set(i.id, box(i.id, i.pos.x - .25, i.pos.y, i.pos.z - .18, i.water ? .8 : i.chest ? .8 : .5, i.water ? .025 : i.chest ? .7 : .12, i.water ? .8 : i.chest ? .5 : .36, i.water ? (i.remaining > 0 ? blue : stone) : i.chest ? brass : bookMat));
    for (const i of m.waterSources) { const mesh = objects.get(i.id); if (mesh) mesh.material = i.remaining > 0 ? blue : stone; }
    ready = !!plan && visuals.has(binding.bodyId); el('as-loading').hidden = ready;
    if (ready) refreshHud();
    if (m.saveError) notice('Saving failed. Keep this tab open.');
  };
  ws.onclose = e => { ready = false; if (!movingPage) { el('as-loading').hidden = false; el('as-loading').textContent = e.reason || 'Disconnected. Reload to resume the saved world.'; } };
  el('as-return').onclick = () => void transition('return'); el('as-next').onclick = () => void transition('ascend');
  el('as-save').onclick = () => ws.send(JSON.stringify({ type: 'save' }));
  window.addEventListener('keydown', e => {
    if(e.code==='KeyI'&&!e.repeat){toggleJournal();return;}
    if(e.code==='Escape'&&journalOpen){toggleJournal();return;}
    if(journalOpen)return;
    if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault(); keys.add(e.code); if (e.repeat) return;
    if (e.code === 'KeyC') send({ type: 'crouch', held: true });
    if (['KeyJ', 'KeyK', 'KeyL'].includes(e.code)) send({ type: 'attack', targetBodyId: targetId || undefined, weight: e.code === 'KeyK' ? 'heavy' : 'light', trajectory: e.code === 'KeyL' ? 'low' : 'high' });
    if (e.code === 'Space') { const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')); send({ type: 'defend', kind: x ? 'sidestep' : 'backstep', direction: cameraRelativeMove(x, x ? 0 : -1, movementYaw) }); }
    if (e.code === 'KeyE') nearestHand();
    if (/^Digit[1-6]$/.test(e.code)) cast(Number(e.code.slice(-1)) - 1);
    if (e.code === 'KeyF' && frame) { const own = frame.snapshot.bodies.find(b => b.bodyId === binding.bodyId)!; void transition(Math.hypot(own.pos.x - frame.tower.start.x, own.pos.z - frame.tower.start.z) < 2.4 ? 'return' : 'ascend'); }
    if (e.code === 'Tab' && frame) { const ids = frame.snapshot.bodies.filter(b => b.bodyId !== binding.bodyId && !b.dead && !b.incapacitated && !frame!.tower.retiredBodyIds.includes(b.bodyId)).map(b => b.bodyId); targetId = ids[(ids.indexOf(targetId) + 1) % ids.length] ?? ''; }
    if (e.code === 'Escape') { release(); send({ type: 'cancel' }); }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyG') send({ type: 'guard', held: mouseGuard }); if (e.code === 'KeyC') send({ type: 'crouch', held: false }); });
  window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  attachOrbit(canvas, view.camera, view.persist);
  canvas.oncontextmenu=e=>e.preventDefault();
  canvas.onpointerdown = e => {
    if(journalOpen)return;
    if(e.button===0)send({type:'attack',targetBodyId:targetId||undefined,weight:'light',trajectory:'high'});
    else if(e.button===2){mouseGuard=true;send({type:'guard',held:true});e.preventDefault();}
  };
  window.addEventListener('pointerup',e=>{if(e.button===2){mouseGuard=false;send({type:'guard',held:keys.has('KeyG')});}});
  window.addEventListener('pointercancel',release);
  const cameraPointBlocked = (x: number, y: number, z: number) => walls.some(s => insideSolid(s, { x, y, z }));
  const obstruction = boxObstruction(() => walls);
  ctx.engine.runRenderLoop(() => {
    const now = performance.now(), ms = now - last, dt = Math.min(.1, ms / 1000); last = now;
    if (ready && !document.hidden) { frames.push(ms); if (frames.length > 7200) frames.shift(); }
    if (frame && binding && ready) {
      const own = frame.snapshot.bodies.find(b => b.bodyId === binding.bodyId)!, target = frame.snapshot.bodies.find(b => b.bodyId === targetId);
      inputAccum += dt; hudAccum += dt;
      if (inputAccum >= 1 / 60) {
        inputAccum = 0; const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA')), forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
        const move = walkingMove(cameraRelativeMove(right, forward, movementYaw),keys.has('AltLeft')||keys.has('AltRight'),keys.has('ShiftLeft')||keys.has('ShiftRight'));
        const faceTarget = keys.has('KeyG') || mouseGuard || keys.has('KeyQ');
        const active = !!(right || forward || keys.has('KeyC') || faceTarget);
        // Do not fill a stalled connection with idle or obsolete state samples.
        // A live held movement still buys at most one canonical step per sample.
        if (now - receivedAt < 500 && ws.bufferedAmount < 32768) {
          if (active || inputWasActive) send({ type: 'move', ...move, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'), crouch: keys.has('KeyC'), facing: faceTarget ? target ? Math.atan2(own.pos.x - target.pos.x, own.pos.z - target.pos.z) : view.camera.renderedYaw : travelFacing(move) });
          if (keys.has('KeyG')||mouseGuard) send({ type: 'guard', held: true });
          inputWasActive = active;
        }
      }
      if (hudAccum > .3) { hudAccum = 0; refreshHud(); }
      const age = Math.min(.075, Math.max(0, (now - receivedAt) / 1000)), time = frame.snapshot.tick + age;
      for (const v of visuals.values()) {
        const b = v.body, root = v.visual.root;
        const desired = new Vector3(b.pos.x + b.velocity.x * age, b.pos.y, b.pos.z + b.velocity.z * age);
        if (cameraPointBlocked(desired.x, desired.y + 1.3, desired.z)) desired.set(b.pos.x, b.pos.y, b.pos.z);
        if (resetView && b.bodyId === binding.bodyId) root.position.copyFrom(desired);
        else {
          const next = Vector3.Lerp(root.position, desired, 1 - Math.exp(-20 * dt));
          // Interpolation must not cut the visible body through a physical corner.
          root.position.copyFrom(cameraPointBlocked(next.x, next.y + 1.3, next.z) ? new Vector3(b.pos.x, b.pos.y, b.pos.z) : next);
        }
        root.rotation.y = smoothYaw(root.rotation.y, b.yaw, dt); v.hit *= Math.exp(-dt * 8);
        v.visual.update(dt, { bodyId: b.bodyId, own: b.bodyId === binding.bodyId, kind: 'person', body: b, speed: Math.hypot(b.velocity.x, b.velocity.z), velocity: b.velocity, yaw: root.rotation.y, crouch: b.crouch ?? 0, age, combat: contextFor(b.combatAction, time, b.yaw), hit: v.hit, guard: b.guarding });
      }
      const root = visuals.get(binding.bodyId)?.visual.root;
      if (root) {
        const pivot = root.position.add(new Vector3(0, 1.3, 0));
        const engaged = keys.has('KeyQ') || keys.has('KeyG') || mouseGuard || !!own.combatAction && own.combatAction.completeAt > time;
        const rawPose = view.camera.update(dt, { pivot, velocity: own.velocity, engaged,
          threats: engaged ? frame.snapshot.bodies.filter(b => b.bodyId !== binding.bodyId && !b.dead && !b.incapacitated && Math.hypot(b.pos.x-own.pos.x,b.pos.z-own.pos.z)<12).length : 0,
          focus: target && (keys.has('KeyQ') || keys.has('KeyG') || mouseGuard) ? { point: { ...target.pos, y: target.pos.y + 1.2 }, weight: .2 } : null }, obstruction, () => 1);
        const pose = framing.update(rawPose,pivot,walls,{yaw:view.camera.renderedYaw,pitch:view.camera.debug.pitchDeg*Math.PI/180,want:view.camera.debug.want,limit:view.camera.debug.limit},dt);
        movementYaw = groundViewYaw(pose.position, pose.target);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z); camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z)); camera.fov = pose.fov; resetView = false;
        // Fade a wall obscuring any part of the owned body, including hips and feet.
        // A clear chest ray alone can leave the lower body hidden behind a low wall.
        const rays = [.2, .85, 1.6].map(height => { const point = root.position.add(new Vector3(0, height, 0)), delta = camera.position.subtract(point); return new Ray(point, delta.normalizeToNew(), delta.length()); });
        for (const mesh of geometry) if (mesh.metadata?.wall) mesh.visibility = rays.some(ray => ray.intersectsBoxMinMax(mesh.getBoundingInfo().boundingBox.minimumWorld, mesh.getBoundingInfo().boundingBox.maximumWorld)) ? .08 : 1;
      }
      el('as-target').textContent = target ? `Target · ${target.name}` : 'No visible opponent';
      targetRing.setEnabled(!!target);
      if (target) targetRing.position.set(target.pos.x, target.pos.y + .04, target.pos.z);
    }
    vfx.update(dt); atmosphere.follow(camera.position); atmosphere.update(10, { kind: 'clear', intensity: 0, wind: .15 }, dt); ctx.scene.fogColor = Color3.FromHexString('#79808e'); ctx.scene.render();
  });
  Object.defineProperty(window, 'tvAscent', { value: { get ready() { return ready; }, get frame() { return frame; }, get plan() { return plan; }, get targetId() { return targetId; },
    inspect: () => ({ frames: [...frames], serverMs: [...serverTimes], receipts: [...receipts], meshes: ctx.scene.meshes.length, people: visuals.size, looks: [...visuals.values()].map(v => v.visual.root.metadata),
      camera: { mode: 'third-person', yaw: view.camera.yaw, renderedYaw: view.camera.renderedYaw, movementYaw, pitch: view.camera.pitch, preferred: view.camera.preferred, blocked: cameraPointBlocked(camera.position.x,camera.position.y,camera.position.z), position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, ...view.camera.debug, ...framing.debug },
      cutawayWalls: geometry.filter(m => m.metadata?.wall && m.visibility < 1).length,
      cameraSolids: walls,
      controlledBody: (() => { const root = binding && visuals.get(binding.bodyId)?.visual.root; const project = (height:number) => { if(!root)return null; const p=Vector3.Project(root.position.add(new Vector3(0,height,0)),Matrix.Identity(),ctx.scene.getTransformMatrix(),camera.viewport.toGlobal(ctx.engine.getRenderWidth(),ctx.engine.getRenderHeight()));return {x:p.x,y:p.y,z:p.z}; }; return root ? { id: binding.bodyId, enabled: root.isEnabled(), position: { x: root.position.x, y: root.position.y, z: root.position.z }, yaw: root.rotation.y, blocked: cameraPointBlocked(root.position.x, root.position.y + 1.3, root.position.z),screen:{feet:project(.05),head:project(1.7)} } : null; })(),
      facingMode: keys.has('KeyQ') || keys.has('KeyG') || mouseGuard ? 'target' : 'travel', heap: (performance as any).memory?.usedJSHeapSize ?? null }) } });
  window.addEventListener('resize', () => ctx.engine.resize());
}
