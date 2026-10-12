import { Engine, FreeCamera, Vector3, Matrix } from '@babylonjs/core';
import { createRenderer, attachPipeline } from '../render/engine';
import { Atmosphere } from '../world/atmosphere';
import { CharacterFactory } from '../actors/characterFactory';
import {SharedCharacters} from '../actors/sharedCast';
import type {BodyVisual} from '../actors/actorManager';
import {contextFor} from '../actors/canonicalActionContext';
import { realize } from '../actors/appearanceMap';
import { RealmRenderer } from './render';
import type { RealmSnapshot } from '../../sim/world/realms/session';
import type { InteractionCommand } from '../net/messages';
import { marchObstruction } from '../game/adaptiveCamera';
import { primaryCamera, attachOrbit, cameraRelativeMove, travelFacing, smoothYaw, groundViewYaw, walkingMove, cameraPivotHeight,PRIMARY_CAMERA_PROFILES } from './thirdPerson';
import './style.css';
import {Vfx} from '../arena/vfx';
import {ObservedArcaneEffects} from '../actors/arcaneEffects';
import {contactGrounding} from './contactGrounding';

/** Existing Babylon shell, shared renderer/atmosphere/body kits. The browser sends
 * intentions and projects server state; it never creates or steps a canonical World. */
export async function startRealms(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement, ui = document.getElementById('ui')!;
  const params = new URLSearchParams(location.search);
  const ctx = await createRenderer(canvas, { quality: params.get('quality') === 'low' ? 'low' : 'balanced' });
  const camera = new FreeCamera('realm-camera', new Vector3(48.5, 2.65, 20.5), ctx.scene);
  camera.minZ = .1; camera.maxZ = 2000;
  const view = primaryCamera('realm');
  let movementYaw = view.camera.yaw;
  const atmosphere = new Atmosphere(ctx); attachPipeline(ctx, camera);
  // City canyons need a readable sky fill. Keep the shared clock/sun direction and
  // restrained exposure; never brighten the walls by changing canonical daylight.
  atmosphere.look.fill = 1.35; atmosphere.look.key = 1.08; atmosphere.look.exposure = 1.08;
  atmosphere.shadow.setDarkness(.32);
  const grounding=contactGrounding(ctx.scene);
  // The shared rural sky uses large illustrated discs. City street views use a
  // restrained apparent sun/moon size behind the layered building silhouettes.
  for (const name of ['sun-disc', 'moon-disc']) ctx.scene.getMeshByName(name)?.scaling.setAll(.16);
  const renderer = new RealmRenderer(ctx, atmosphere), factory = new CharacterFactory();
  const legacyObstruction=marchObstruction((x,y,z)=>renderer.cameraBlocked(x,y,z));
  const obstruction:typeof legacyObstruction=(from,dir,max,single)=>renderer.focused.obstruction(from,dir,max)??legacyObstruction(from,dir,max,single);
  const people=new SharedCharacters(ctx.scene);
  const residents = new Map<string, BodyVisual>();
  const vfx=new Vfx(ctx.scene),effects=new ObservedArcaneEffects(vfx);
  void factory.load(ctx.scene, undefined, ['f', 'm']);
  ui.innerHTML = `<div class="rv-shell">
    <header class="rv-heading"><nav><a href="/">Home</a> · <a href="/observatory">Observatory</a></nav><div class="rv-kicker">TORN VEIL <span>CONNECTED REALMS</span></div><h1 id="rv-title">Opening the Veil</h1><p id="rv-district">Restoring your journey…</p></header>
    <details class="rv-card rv-wayfinder"><summary>Travel & journal</summary><small>THRESHOLD SQUARE</small><b id="rv-destination">Aether Reach ↔ Cinderveil</b><button id="rv-portal">Walk to portal</button><button id="rv-tower">Walk to Tower</button><button id="rv-canonical" hidden>Enter shared Tower trial</button><button id="rv-ascend" hidden>Historical score-based Tower lab</button><button id="rv-journal">Character & journey</button><label class="rv-camera-choice">Camera <select id="rv-camera"><option value="close">Close</option><option value="elevated">Elevated</option><option value="wide">Wide</option></select></label></details>
    <div class="rv-reticle">·</div><div class="rv-toast" id="rv-toast" aria-live="polite"></div>
    <div class="rv-prompt" id="rv-prompt">Loading nearby streets…</div>
    <footer><span>WASD move · X walk · MMB orbit · wheel zoom · J/K/L strike · G guard · Space dodge · E interact · I journal</span><span id="rv-stream"></span></footer>
    <section class="rv-modal" id="rv-choice" hidden><small>THE VEIL</small><h2 id="rv-choice-title"></h2><p>Your identity, possessions and development travel with you.</p><button id="rv-cross">Cross threshold</button><button id="rv-cancel">Stay here</button></section>
    <section class="rv-modal rv-journal" id="rv-sheet" hidden><small>YOUR JOURNEY</small><h2 id="rv-name"></h2><div id="rv-character"></div><p class="rv-note">The shared Tower trial carries this body, its injuries and belongings. Historical score-based expeditions are comparison evidence and do not define current progression.</p><button id="rv-save">Save journey</button><button id="rv-close">Return to world</button></section>
    <section class="rv-modal" id="rv-expedition" hidden><small>THE TOWER</small><h2>Your expedition awaits</h2><p>Continue from the last saved floor start, or return to your atrium landing.</p><button id="rv-resume">Continue expedition</button><button id="rv-return">Return to atrium</button></section>
    <div class="rv-loading" id="rv-loading">Preparing nearby streets…</div>
  </div>`;
  await people.load(text=>{document.getElementById('rv-loading')!.textContent=text;});
  const el = (id: string) => document.getElementById(id)!;
  const keys = new Set<string>(), frames: number[] = [], streamingFrames: number[] = [], serverSamples: number[] = [], journeys: { realm: string; at: number; readyAt?: number }[] = [];
  let state: RealmSnapshot | null = null, avatar: BodyVisual | null = null, timer = 0, last = performance.now(), lastRealm = '', lastStateAt = 0, journal = false, connected = false;
  let controllerToken = '', transitioning = false, binding: any = null, sequence = 0, mouseGuard = false, targetId = '', guideStarted = false;
  const receipts: any[] = [];
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realms/socket`);
  const send = (value: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const command = (value: InteractionCommand) => { if(binding)send({version:2,type:'command',...binding,sequence:sequence++,commandId:`realm-${sequence}`,clientTimeMs:performance.now(),command:value}); };
  const release = () => { keys.clear(); mouseGuard=false; command({type:'move',x:0,z:0,sprint:false}); command({type:'guard',held:false}); command({type:'crouch',held:false}); };
  const toast = (text: string) => { el('rv-toast').textContent = text; clearTimeout(timer); timer = window.setTimeout(() => { el('rv-toast').textContent = ''; }, 4500); };
  socket.addEventListener('open', () => { connected = true; });
  socket.addEventListener('close', e => { connected = false; el('rv-loading').hidden = false; el('rv-loading').textContent = e.reason || 'Connection closed. Reload to return to your saved journey.'; });
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.type === 'controller') controllerToken = m.token;
    if (m.type === 'binding') { binding=m.interaction; sequence=0; keys.clear(); }
    if (m.type === 'command_receipt' && m.status !== 'received') { receipts.push(m); if(receipts.length>300)receipts.shift(); if(m.status==='rejected'&&!['cooldown','incapacitated','expired','committed'].includes(m.result))toast(String(m.result).replaceAll('_',' ')); }
    if (m.type === 'regions') renderer.reconcile(m.wanted, m.chunks);
    if (m.type === 'notice') toast(m.message);
    if (m.type !== 'state') return;
    state = m.state; const s = state!; lastStateAt = performance.now();
    renderer.reconcileFocused(s.focusedAssets,s.body.pos);
    serverSamples.push(m.serverMs); if (serverSamples.length > 600) serverSamples.shift();
    if (lastRealm !== s.realm) {
      lastRealm = s.realm; view.camera.snap();
      avatar?.root.position.set(s.body.pos.x - renderer.origin.x, s.body.pos.y, s.body.pos.z - renderer.origin.z);
      journeys.push({ realm: s.realm, at: performance.now() });
      for (const r of residents.values()) r.root.setEnabled(false);
    }
    el('rv-title').textContent = s.tower ? 'Tower of Chrysanthus' : s.realmName;
    el('rv-district').textContent = s.tower ? 'THE ATRIUM · WALK BACK THROUGH THE GATE TO RETURN' : s.subtitle;
    el('rv-prompt').textContent = s.prompt;
    el('rv-prompt').hidden=s.prompt.startsWith('WASD');
    el('rv-ascend').hidden = !params.has('historical-lab') || !s.tower || !!s.expedition?.active || !!s.canonicalTower?.active;
    el('rv-canonical').hidden = !s.tower || !!s.expedition?.active;
    if (s.canonicalTower?.active && !transitioning) void openAscent();
    el('rv-expedition').hidden = !s.expedition?.active;
    el('rv-choice').hidden = !s.pending;
    if (s.pending) el('rv-choice-title').textContent = `Enter ${s.pending.destination}?`;
    el('rv-name').textContent = s.person.name;
    const contents = el('rv-character'); contents.replaceChildren();
    for (const line of [`${s.person.rank} · ${s.body.hp.toFixed(0)} / ${s.body.maxHp} vitality`, ...s.person.inventory.map(i => `${i.name} × ${i.quantity}`),
      `${s.growth.victories} distinct opposed victories · ${s.growth.forms} demonstrated forms · ${s.growth.essences} learned essences`,
      s.development.recognisedClass?`Recognised vocation: ${s.development.recognisedClass.name} · ${s.development.recognisedClass.evidence.join('; ')}`:'Your actions and practice shape a recognised vocation.',
      ...Object.entries(s.development.skills).filter(([,value])=>value>0).map(([id,value])=>`${id}: ${(value*100).toFixed(1)}% proficiency`),
      `${s.growth.next??'Further transformation'}: ${s.growth.eligible?'Ready to integrate':s.growth.reasons.join(' · ')}`,
      `Intrinsic force ${s.growth.intrinsicCapacity.amplitude} / reach ${s.growth.intrinsicCapacity.aperture}; with equipment ${s.growth.capacity.amplitude} / ${s.growth.capacity.aperture}`]) { const p = document.createElement('p'); p.textContent = line; contents.append(p); }
    const actionButton=(label:string,action:InteractionCommand)=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>command(action);contents.append(b);};
    if(s.growth.eligible)actionButton(`Integrate sources — ${s.growth.next}`,{type:'integrate_arcana'});
    for(const source of s.growth.sources.filter(i=>!s.growth.learned.some(l=>l.id===i.abilityId)))actionButton(`Study ${source.name}`,{type:'learn_arcana',itemId:source.id});
    for(const action of s.interactions.filter(a=>a.slot!=='nearby'))actionButton(action.label,{type:'interact',interactionId:action.id});
    if(params.has('character')&&!journal) { journal=true; el('rv-sheet').hidden=false; }
    if(params.get('destination')==='tower'&&!guideStarted) { guideStarted=true;send({type:'navigate',target:'tower'}); }
    renderer.setDoors(s.doors);
    effects.show(s.casts,s.time,renderer.origin);
    if (m.saveError) toast('Saving is unavailable. Keep this tab open and inspect the local host log.');
  });
  const toggleJournal = () => { params.delete('character'); journal = !journal; el('rv-sheet').hidden = !journal; release(); };
  const expedition = async (type: 'enter' | 'return') => {
    if (transitioning || !state) return false;
    transitioning = true; release();
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
  const closeTravel=()=>{(ui.querySelector('.rv-wayfinder') as HTMLDetailsElement).open=false;};
  el('rv-portal').onclick = () => {send({ type: 'navigate', target: 'portal' });closeTravel();};
  el('rv-tower').onclick = () => {send({ type: 'navigate', target: 'tower' });closeTravel();};
  (el('rv-camera') as HTMLSelectElement).value='elevated';
  el('rv-camera').onchange=()=>{const value=(el('rv-camera') as HTMLSelectElement).value as keyof typeof PRIMARY_CAMERA_PROFILES,profile=PRIMARY_CAMERA_PROFILES[value]??PRIMARY_CAMERA_PROFILES.elevated;view.camera.preferred=profile.distance;view.camera.pitch=profile.pitch*Math.PI/180;view.persist();closeTravel();};
  el('rv-cross').onclick = () => { send({ type: 'confirm', id: state?.pending?.id }); keys.clear(); };
  el('rv-cancel').onclick = () => send({ type: 'cancel' });
  el('rv-prompt').onclick = () => send({ type: 'interact' });
  window.addEventListener('keydown', e => {
    if (['KeyW','KeyA','KeyS','KeyD','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Tab'].includes(e.code)) e.preventDefault();
    if (!e.repeat && e.code === 'KeyE' && !journal) send({ type: 'interact' });
    if (!e.repeat && e.code === 'KeyI') toggleJournal();
    if(!e.repeat&&!journal&&!transitioning){
      if(e.code==='Tab'&&state){const ids=state.residents.filter(r=>!r.visual.dead&&!r.visual.incapacitated).map(r=>r.visual.bodyId);targetId=ids[(ids.indexOf(targetId)+1)%ids.length]??'';toast(state.residents.find(r=>r.visual.bodyId===targetId)?.name??'No visible target');}
      if(['KeyJ','KeyK','KeyL'].includes(e.code))command({type:'attack',targetBodyId:targetId||undefined,weight:e.code==='KeyK'?'heavy':'light',trajectory:e.code==='KeyL'?'low':'high'});
      if(e.code==='Space')command({type:'defend',kind:keys.has('KeyA')||keys.has('KeyD')?'sidestep':'backstep',direction:cameraRelativeMove(Number(keys.has('KeyD'))-Number(keys.has('KeyA')),-1,movementYaw)});
      if(e.code==='KeyC')command({type:'crouch',held:true});
      if(/^Digit[1-6]$/.test(e.code)&&state){const ability=state.growth.learned[Number(e.code.slice(-1))-1],target=state.residents.find(r=>r.visual.bodyId===targetId);if(ability)command({type:'cast',abilityId:ability.id,target:target?{...target.pos,y:target.pos.y+1}:undefined});}
    }
    if (e.code === 'Escape') { release(); send({ type: 'cancel' });command({type:'cancel'}); if (journal) toggleJournal(); }
    keys.add(e.code);
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); if(e.code==='KeyG')command({type:'guard',held:mouseGuard});if(e.code==='KeyC')command({type:'crouch',held:false});if (e.code.startsWith('Arrow')) view.persist(); });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  window.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(journal||transitioning)return;if(e.button===0)command({type:'attack',targetBodyId:targetId||undefined,trajectory:'high',weight:'light'});else if(e.button===2){mouseGuard=true;command({type:'guard',held:true});e.preventDefault();}});
  window.addEventListener('pointerup',e=>{if(e.button===2){mouseGuard=false;command({type:'guard',held:keys.has('KeyG')});}});
  attachOrbit(canvas, view.camera, view.persist);
  ui.querySelector<HTMLElement>('.rv-reticle')!.hidden = true;
  let inputAccumulator = 0, hudAccumulator = 0, inputWasActive = false;
  ctx.engine.runRenderLoop(() => {
    const now = performance.now(), ms = now - last, dt = Math.min(.1, ms / 1000); last = now;
    if (!document.hidden && state && renderer.pending === 0) { frames.push(ms); if (frames.length > 3600) frames.shift(); }
    if (!document.hidden && state && renderer.pending > 0) { streamingFrames.push(ms); if (streamingFrames.length > 1200) streamingFrames.shift(); }
    renderer.upload(); if (state) renderer.setDoors(state.doors);
    if (!renderer.pending && journeys.length && !journeys[journeys.length - 1].readyAt) journeys[journeys.length - 1].readyAt = performance.now();
    el('rv-loading').hidden = connected && !!state && !renderer.focused.pending&&!renderer.focused.error&&(renderer.loaded.size >= 9 || !!state.expedition?.active);
    if(renderer.focused.error)el('rv-loading').textContent=renderer.focused.error;
    const s = state;
    if (s) {
      inputAccumulator += dt; hudAccumulator += dt;
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (keys.has('ArrowLeft')) view.camera.addLook(-dt * 1.3, 0); if (keys.has('ArrowRight')) view.camera.addLook(dt * 1.3, 0);
      if (keys.has('ArrowUp')) view.camera.addLook(0, -dt); if (keys.has('ArrowDown')) view.camera.addLook(0, dt);
      if (inputAccumulator >= .05 && !transitioning && !s.expedition?.active) {
        inputAccumulator = 0;
        const move = walkingMove(cameraRelativeMove(journal || s.pending ? 0 : right, journal || s.pending ? 0 : forward, movementYaw),keys.has('KeyX'),keys.has('ShiftLeft')||keys.has('ShiftRight'));
        const target=s.residents.find(r=>r.visual.bodyId===targetId),face=keys.has('KeyQ')||keys.has('KeyG')||mouseGuard;
        const active=!!(move.x||move.z||face||keys.has('KeyC'));
        if(active||inputWasActive)command({ type: 'move', ...move, facing: face ? target?Math.atan2(s.body.pos.x-target.pos.x,s.body.pos.z-target.pos.z):view.camera.renderedYaw : travelFacing(move), sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),crouch:keys.has('KeyC') });
        inputWasActive=active;
        if(!journal&&(keys.has('KeyG')||mouseGuard))command({type:'guard',held:true});
      }
      if (!avatar) {
        avatar = people.create(s.avatar, atmosphere, undefined, 'player') ?? (factory.ready ? factory.create(ctx.scene, atmosphere, s.body.id, realize(s.person.id, s.avatar.appearance?.description, undefined)) : null);
        avatar?.root.position.set(s.body.pos.x - renderer.origin.x, s.body.pos.y, s.body.pos.z - renderer.origin.z);
        if (avatar) avatar.root.rotation.y = s.body.yaw;
      }
      if (avatar) {
        grounding.update(s.body.pos.x-renderer.origin.x,s.body.pos.y,s.body.pos.z-renderer.origin.z,s.body.yaw);
        const age = Math.min(.075, Math.max(0, (now - lastStateAt) / 1000)), velocity = s.avatar.velocity;
        avatar.root.position.copyFrom(Vector3.Lerp(avatar.root.position, new Vector3(s.body.pos.x + velocity.x * age - renderer.origin.x, s.body.pos.y, s.body.pos.z + velocity.z * age - renderer.origin.z), 1 - Math.exp(-20 * dt)));
        avatar.root.rotation.y = smoothYaw(avatar.root.rotation.y, s.body.yaw, dt);
        avatar.update(dt, { bodyId: s.body.id, body: s.avatar, combat: contextFor(s.avatar.combatAction, s.time + age, s.body.yaw), guard: s.avatar.guarding, own: true, kind: 'person', speed: Math.hypot(velocity.x, velocity.z), velocity, yaw: avatar.root.rotation.y, crouch: s.avatar.crouch ?? 0, age });
        const pivot = avatar.root.position.add(new Vector3(0, cameraPivotHeight(avatar.bodyHeight,s.avatar.crouch??0), 0));
        const pose = view.camera.update(dt, { pivot, velocity }, obstruction, () => 1);
        movementYaw = groundViewYaw(pose.position, pose.target);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z); camera.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z)); camera.fov = pose.fov;
        renderer.focused.cutaway(camera.position,avatar.root.position);
      }
      const authoredTown=s.realm==='brass'&&!!s.focusedAssets;
      atmosphere.look.fill=authoredTown?1.06:.98;atmosphere.look.key=authoredTown?1.16:1.24;atmosphere.look.exposure=authoredTown?1.04:1.16;atmosphere.shadow.setDarkness(authoredTown?.45:.32);
      atmosphere.update((s.worldTime / 3600 + (s.realm === 'aether' ? 9.866 : authoredTown?1.5:9.066)) % 24, { kind: 'clear', intensity: 0, wind: .25 }, dt);
      ctx.scene.fogDensity = s.realm === 'aether' ? .0026 : authoredTown?.0048:.0017;
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
    vfx.update(dt);ctx.scene.render();
  });
  // Observations only: the harness drives ordinary keys/buttons, never mutates the world.
  Object.defineProperty(window, 'tvRealms', { value: { get state() { return state; }, get ready() { return !!state && !!avatar && !renderer.pending&&!renderer.focused.error; },
    inspect: () => ({ receipts:[...receipts],binding,targetId, frames: [...frames], streamingFrames: [...streamingFrames], uploads: [...renderer.uploads], serverSamples: [...serverSamples], journeys: [...journeys], loaded: renderer.loaded.size, pending: renderer.pending,
      focused:{instances:renderer.focused.count,pending:renderer.focused.pending,error:renderer.focused.error,forests:renderer.focused.forestDetails},meshes: ctx.scene.meshes.length, textures: ctx.scene.textures.length, materials: ctx.scene.materials.length, lights: ctx.scene.lights.length,
      towerDoors: [...renderer.loaded.values()].flatMap(c=>c.doors.filter(d=>d.mesh.name.includes(':tower:')).map(d=>({name:d.mesh.name,enabled:d.mesh.isEnabled(),panels:d.mesh.getChildMeshes().map(m=>m.isEnabled())}))),
      residentLooks:[...residents.values()].map(v=>v.root.metadata), renderer: ctx.kind, staleMs: performance.now() - lastStateAt,
      characterScale: (avatar as BodyVisual & {measureScale?:()=>unknown}|null)?.measureScale?.(),
      controlledLook: avatar?.root.metadata, controlledBody: avatar ? { id: state?.body.id, enabled: avatar.root.isEnabled(), position: { x: avatar.root.position.x, y: avatar.root.position.y, z: avatar.root.position.z }, yaw: avatar.root.rotation.y,
        screen: (() => { const p = Vector3.Project(avatar.root.position.add(new Vector3(0, .85, 0)), Matrix.Identity(), ctx.scene.getTransformMatrix(), camera.viewport.toGlobal(ctx.engine.getRenderWidth(), ctx.engine.getRenderHeight())); return { x: p.x, y: p.y, z: p.z }; })() } : null,
      camera: { mode: 'third-person', yaw: view.camera.yaw, renderedYaw: view.camera.renderedYaw, movementYaw, pitch: view.camera.pitch, preferred: view.camera.preferred, blocked: renderer.cameraBlocked(camera.position.x,camera.position.y,camera.position.z), position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, ...view.camera.debug },
      width: ctx.engine.getRenderWidth(), height: ctx.engine.getRenderHeight(), hardware: ctx.engine instanceof Engine ? ctx.engine.getGlInfo() : null,
      heap: (() => { const m = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory; return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize } : null; })(), state }) } });
}
