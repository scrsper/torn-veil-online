import { Color3, Color4, DirectionalLight, Engine, FreeCamera, HemisphericLight, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import type { PlanetDescriptor } from '../../sim/world/universe/generation';
import { terrainHeight } from '../../sim/world/universe/generation';
import type { UniverseSnapshot as Snapshot } from '../../server/universeRuntime';
import type { CanonicalUniverseView } from '../../server/canonicalUniverse';
import type { UniverseCommand as Command } from '../../sim/world/universe/travel';
import type { V3 } from '../../sim/world/planet/planet';
import { UniverseTerrain } from './terrain';
import './universe.css';

// Type-only wire imports are erased. Host advancement never enters the browser bundle.
const vec = (p: V3) => new Vector3(p.x, p.y, p.z);
const distance = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const units = (n: number) => Math.abs(n) < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`;

/** A continuous camera-relative view of the host's expedition. No local movement prediction. */
export async function startUniverse() {
  const campaignMode = new URLSearchParams(location.search).has('campaign');
  document.title = 'Torn Veil · The Astral Sea';
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui')!;
  const root = document.createElement('div'); root.className = 'astral-ui';
  root.dataset.boarding = String(campaignMode);
  root.innerHTML = `
    <header class="astral-brand"><span class="astral-sigil">✧</span><div><small>TORN VEIL</small><h1>The Astral Sea</h1></div></header>
    <div class="astral-status"><span class="astral-dot"></span><span data-link>Connecting to expedition…</span></div>
    <section class="astral-location"><small data-system>EXPEDITION</small><h2 data-place>Finding your vessel</h2><p data-phase>Waiting for host</p></section>
    <button class="astral-chart-toggle" data-chart-toggle aria-expanded="true">Star chart <kbd>M</kbd></button>
    <aside class="astral-chart"><div class="astral-chart-heading"><span>WORLDS IN REACH</span><span data-count></span></div><div data-planets></div><div class="astral-warp"><label for="astral-system">System address</label><input id="astral-system" type="number" min="0" max="65535" value="1"><button data-warp>Cross the veil</button></div><p class="astral-note">Warp requires open space. Your expedition is saved by the host.</p></aside>
    <div class="astral-reticle" aria-hidden="true">＋</div><div class="astral-target" data-target hidden></div>
    <div class="astral-toast" role="status" aria-live="polite" hidden></div>
    <footer class="astral-flight"><div class="astral-readouts"><div><small>ALTITUDE</small><strong data-altitude>—</strong></div><div><small>VELOCITY</small><strong data-speed>—</strong></div><div><small>VISITED</small><strong data-visited>—</strong></div></div><div class="astral-actions"><button data-launch>Launch <kbd>F</kbd></button><button data-cruise>Sail to target <kbd>C</kbd></button><button data-brake>Brake <kbd>Space</kbd></button><button data-help aria-expanded="false">Controls <kbd>?</kbd></button></div></footer>
    <section class="astral-help" hidden><h3>Across the veil</h3><p>On the surface: <b>W / S</b> walk, <b>A / D</b> sidestep, <b>← / →</b> turn. Return to your vessel to launch.</p><p>In flight: <b>W / S</b> thrust, <b>arrows</b> steer, <b>Q / E</b> descend / rise, <b>Space</b> brake. Drag the sky to steer.</p><p>Choose a world, then <b>Sail to target</b> for continuous assisted flight. <b>F</b> launches or lands when near safe ground. Manual thrust cancels navigation.</p><p><b>M</b> folds the chart. <b>Esc</b> brakes and releases input. Reload to continue your saved expedition.</p><p class="astral-note">Expedition v1 · Saved vessel and discoveries. The town and Tower character campaign is separate.</p><button data-close-help>Return to the sky</button><a href="?world">Open the existing world survey</a></section>`;
  const campaignPanel = document.createElement('section'); campaignPanel.className = 'astral-boarding'; campaignPanel.hidden = !campaignMode;
  campaignPanel.innerHTML = '<small>YOUR SAVED JOURNEY</small><h2>Opening the Astral Sea</h2><p data-boarding-detail>Connecting to your character…</p><button data-board disabled>Board the astral vessel</button><button data-town>Back to town</button>';
  root.append(campaignPanel);
  const campaignReturn = document.createElement('button'); campaignReturn.dataset.campaignReturn = ''; campaignReturn.hidden = true; campaignReturn.textContent = 'Return to town';
  root.querySelector('.astral-actions')!.append(campaignReturn);
  ui.append(root);
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const launch = el<HTMLButtonElement>('[data-launch]'), cruise = el<HTMLButtonElement>('[data-cruise]');
  const toast = el('.astral-toast'); let toastUntil = 0;
  const say = (message: string, error = false) => { toast.textContent = message; toast.hidden = false; toast.classList.toggle('error', error); toastUntil = performance.now() + 6500; };
  type Campaign = CanonicalUniverseView['campaign'];
  let campaign: Campaign | null = null, controllerToken = '', campaignSocket: WebSocket | null = null, leaving = false, reconnect: ReturnType<typeof setTimeout> | undefined;
  const endpoint = campaignMode ? '/realms/universe' : '/api/universe';
  const headers = () => ({ 'content-type': 'application/json', ...(campaignMode ? { 'x-realms-controller': controllerToken } : {}) });
  if (campaignMode) {
    el('.astral-help .astral-note').textContent = 'Your saved character, injuries and belongings remain part of the same journey. Land at the home vessel to return to town.';
    el('.astral-chart .astral-note').textContent = 'Warp requires open space. Your character and discoveries share the town save.';
    const link = el<HTMLAnchorElement>('.astral-help a'); link.textContent = 'Return to the saved town view'; link.href = '?realms';
  }
  let snapshot: Snapshot | null = null, seq = 0, connected = false, disposed = false, lastReply = 0, busy = false, polling = false, requestId = 0, acceptedRequest = 0;
  const queue: Command[] = [];
  const accept = (next: Snapshot, request: number) => {
    if (request < acceptedRequest) return;
    if (snapshot && next.sessionId === snapshot.sessionId && next.revision < snapshot.revision) return;
    acceptedRequest = request;
    if (!snapshot || next.sessionId !== snapshot.sessionId) { seq = next.lastSeq ?? 0; queue.length = 0; }
    seq = Math.max(seq, next.lastSeq ?? 0); snapshot = next; connected = true; lastReply = performance.now();
  };
  const acceptView = (result: { snapshot: Snapshot | null; campaign: Campaign }, request: number) => {
    if (request < acceptedRequest) return;
    campaign = result.campaign;
    if (result.snapshot) accept(result.snapshot, request);
    else { acceptedRequest = request; snapshot = null; connected = true; lastReply = performance.now(); }
    campaignPanel.hidden = !!campaign?.active; campaignReturn.hidden = !campaign?.active;
    root.dataset.boarding = String(!campaign?.active);
    campaignReturn.disabled = !campaign?.canReturn;
    campaignReturn.title = campaign?.message ?? '';
    if (campaign) {
      campaignPanel.querySelector('h2')!.textContent = `${campaign.name} · ${campaign.rank}`;
      el('[data-boarding-detail]').textContent = `${campaign.health.toFixed(0)} / ${campaign.maxHealth} vitality · ${campaign.inventory.length} carried items. ${campaign.message}`;
      el<HTMLButtonElement>('[data-board]').disabled = !campaign.canEnter;
    }
  };
  async function poll() {
    if (disposed || busy || polling || campaignMode && !controllerToken) return;
    polling = true;
    const request = ++requestId;
    try { const response = await fetch(endpoint, { cache: 'no-store', headers: headers(), signal: AbortSignal.timeout(2500) }); if (!response.ok) throw Error(`Host ${response.status}`); const result = await response.json(); if (campaignMode) acceptView(result, request); else accept(result, request); }
    catch { if (request >= acceptedRequest) connected = false; }
    finally { polling = false; }
  }
  async function flush() {
    if (busy || !snapshot || !queue.length || disposed) return;
    busy = true; const command = queue.shift()!, request = ++requestId;
    try {
      const response = await fetch(`${endpoint}/command`, { method: 'POST', headers: headers(), body: JSON.stringify({ sessionId: snapshot.sessionId, seq: ++seq, command }), signal: AbortSignal.timeout(2500) });
      const result = await response.json(); if (campaignMode && result.campaign) acceptView(result, request); else if (result.snapshot) accept(result.snapshot, request);
      if (response.status >= 500) { connected = false; queue.length = 0; }
      if (!result.ok) say(result.error ?? 'The host refused that action.', true);
    } catch { connected = false; say('Connection interrupted. Controls pause until the host returns.', true); queue.length = 0; }
    finally { busy = false; }
  }
  const send = (command: Command) => { if (campaignMode && !campaign?.active) return; if (!connected) return say(campaignMode ? 'Saved world host is offline. Reconnect before continuing.' : 'Expedition host is offline. Start Play Torn Veil Universe.cmd.', true); if (command.type === 'input') { const old = queue.findIndex(c => c.type === 'input'); if (old >= 0) queue.splice(old, 1); } queue.push(command); void flush(); };
  const goTown = async () => {
    if (leaving) return; leaving = true; queue.length = 0;
    if (campaignSocket && campaignSocket.readyState !== WebSocket.CLOSED) await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 1500); campaignSocket!.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true }); campaignSocket!.close();
    });
    location.assign('?realms');
  };
  const transition = async (type: 'enter' | 'return') => {
    if (!campaign || busy || !controllerToken) return;
    busy = true; queue.length = 0; const request = ++requestId;
    try {
      const response = await fetch(`${endpoint}/transition`, { method: 'POST', headers: headers(), body: JSON.stringify({ id: crypto.randomUUID(), type, revision: campaign.revision }), signal: AbortSignal.timeout(15000) });
      const result = await response.json(); if (result.campaign) acceptView(result, request);
      if (!response.ok || result.error) throw Error(result.error ?? 'The crossing was refused.');
      if (type === 'return') await goTown();
    } catch (error) { say(String(error), true); }
    finally { busy = false; }
  };
  el('[data-board]').onclick = () => void transition('enter'); el('[data-town]').onclick = () => void goTown(); campaignReturn.onclick = () => void transition('return');
  const connectCampaign = () => {
    if (disposed || leaving) return;
    campaignSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realms/universe/socket`);
    campaignSocket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.type === 'controller') { controllerToken = message.token; seq = 0; queue.length = 0; void poll(); }
    });
    campaignSocket.addEventListener('close', event => {
      controllerToken = ''; connected = false; queue.length = 0;
      if (leaving || disposed) return;
      say(event.reason || 'World connection interrupted. Reconnecting…', true);
      if (event.code !== 4001) reconnect = setTimeout(connectCampaign, 2000);
    });
  };
  if (campaignMode) connectCampaign();
  await poll();
  if (!snapshot && !campaignMode) say('Start Play Torn Veil Universe.cmd, then this page will reconnect automatically.', true);

  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
  const scene = new Scene(engine); scene.useRightHandedSystem = true; scene.clearColor = new Color4(.003, .006, .018, 1);
  scene.ambientColor = new Color3(.3, .34, .45);
  const camera = new FreeCamera('astral-camera', new Vector3(0, 0, 0), scene); camera.inputs.clear(); camera.minZ = .15; camera.maxZ = 350000; camera.fov = .95;
  const sun = new DirectionalLight('astral-sun', new Vector3(-.45, -.6, .3), scene); sun.intensity = 1.75; sun.diffuse = new Color3(1, .89, .73);
  const fill = new HemisphericLight('astral-fill', Vector3.Up(), scene); fill.intensity = .7; fill.groundColor = new Color3(.1, .13, .2);
  const ship = buildVessel(scene);
  ship.setEnabled(false);
  const starfield = buildStars(scene); starfield.isPickable = false;
  let terrain: UniverseTerrain | null = null, systemId = '', rendered: Vector3 | null = null, facing = new Vector3(0, 0, 1), up = Vector3.Up(), drawTick = 0;
  let planetButtons = new Map<string, HTMLButtonElement>();
  const keys = new Set<string>(); let drag = false, dragX = 0, dragY = 0, lookPitch = 0;
  const zeroInput = (): Command => ({ type: 'input', input: { throttle: 0, yaw: 0, pitch: 0, strafe: 0, lift: 0, brake: true } });
  const brake = () => { keys.clear(); dragX = dragY = 0; send({ type: 'cruise', enabled: false }); send(zeroInput()); };
  const toggleChart = () => { const chart = el('.astral-chart'); chart.hidden = !chart.hidden; el('[data-chart-toggle]').setAttribute('aria-expanded', String(!chart.hidden)); };
  const toggleHelp = () => { const help = el('.astral-help'); help.hidden = !help.hidden; el('[data-help]').setAttribute('aria-expanded', String(!help.hidden)); if (!help.hidden) brake(); };
  const doLaunch = () => { if (snapshot) send({ type: snapshot.state.mode === 'surface' ? 'launch' : 'land' }); };
  const doCruise = () => { if (snapshot?.state.cruise) send({ type: 'cruise', enabled: false }); else if (snapshot?.state.targetPlanetId) send({ type: 'navigate', planetId: snapshot.state.targetPlanetId }); else say('Choose a world in the star chart.'); };
  launch.onclick = doLaunch; cruise.onclick = doCruise;
  el('[data-brake]').onclick = brake; el('[data-chart-toggle]').onclick = toggleChart;
  el('[data-help]').onclick = toggleHelp; el('[data-close-help]').onclick = toggleHelp;
  el('[data-warp]').onclick = () => { const value = Number(el<HTMLInputElement>('#astral-system').value); if (Number.isInteger(value) && value >= 0 && value <= 65535) send({ type: 'warp', systemIndex: value }); else say('Use a system address from 0 to 65535.', true); };
  const isTyping = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  const down = (event: KeyboardEvent) => {
    if (isTyping(event.target)) return;
    if (!campaignPanel.hidden) return;
    if (!el('.astral-help').hidden) {
      if (event.code === 'Escape' || event.key === '?') { event.preventDefault(); if (!event.repeat) toggleHelp(); }
      return;
    }
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE'].includes(event.code)) { event.preventDefault(); if (el('.astral-help').hidden) keys.add(event.code); }
    if (event.repeat) return;
    if (event.code === 'KeyF') doLaunch(); if (event.code === 'KeyC') doCruise(); if (event.code === 'KeyM') toggleChart();
    if (event.key === '?') toggleHelp(); if (event.code === 'Escape') { brake(); el('.astral-help').hidden = true; }
  };
  const keyup = (event: KeyboardEvent) => keys.delete(event.code);
  const release = () => { if (keys.size || drag || snapshot?.state.cruise) brake(); keys.clear(); drag = false; };
  const pointerDown = (event: PointerEvent) => { if (!campaignPanel.hidden || !el('.astral-help').hidden) return; drag = true; canvas.setPointerCapture(event.pointerId); canvas.focus(); };
  const pointerMove = (event: PointerEvent) => { if (drag) { dragX += event.movementX * .025; dragY += event.movementY * .025; } };
  const pointerUp = () => { drag = false; dragX = dragY = 0; };
  window.addEventListener('keydown', down); window.addEventListener('keyup', keyup); window.addEventListener('blur', release);
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
  const visibility = () => { if (document.hidden) release(); }; document.addEventListener('visibilitychange', visibility);
  let previousInput = false;
  const network = setInterval(() => {
    if (disposed) return;
    const axis = (a: string, b: string) => Number(keys.has(a)) - Number(keys.has(b));
    const input = { throttle: axis('KeyW','KeyS'), yaw: Math.max(-1, Math.min(1, axis('ArrowLeft','ArrowRight') - dragX)), pitch: Math.max(-1, Math.min(1, axis('ArrowUp','ArrowDown') - dragY)), strafe: axis('KeyD','KeyA'), lift: axis('KeyE','KeyQ'), brake: keys.has('Space') };
    if (snapshot?.state.mode === 'surface') lookPitch = Math.max(-1.25, Math.min(1.25, lookPitch + input.pitch * .1)); else lookPitch = 0;
    dragX = dragY = 0;
    const active = !!(input.throttle || input.yaw || input.pitch || input.strafe || input.lift || input.brake);
    if (active || previousInput) send({ type: 'input', input }); previousInput = active;
    if (queue.length) void flush(); else void poll();
  }, 100);
  const resize = () => engine.resize(); window.addEventListener('resize', resize);
  engine.runRenderLoop(() => {
    if (disposed) return;
    const now = performance.now(), dt = Math.min(engine.getDeltaTime() / 1000, .1);
    const live = connected && now - lastReply < 3000;
    el('[data-link]').textContent = live ? campaignMode && campaign ? `${campaign.name} · shared journey saved` : 'Host connected · autosave on' : 'Host offline · reconnecting';
    el('.astral-status').classList.toggle('offline', !live);
    if (toastUntil && now > toastUntil) toast.hidden = true;
    if (!snapshot) { scene.render(); return; }
    const s = snapshot.state;
    if (systemId !== snapshot.system.id) {
      terrain?.dispose(); terrain = new UniverseTerrain(scene, snapshot.system, new URLSearchParams(location.search).has('lite'));
      terrain.setSunDirection(sun.direction.scale(-1));
      systemId = snapshot.system.id; rendered = vec(s.position); facing = vec(s.forward); up = vec(s.up);
      planetButtons.clear(); el('[data-planets]').replaceChildren();
      snapshot.system.planets.forEach((planet: PlanetDescriptor) => {
        const button = document.createElement('button'); button.className = 'astral-world'; button.style.setProperty('--world-color', planet.palette.land);
        button.innerHTML = '<i></i><span><b></b><small></small></span><em></em>'; button.querySelector('b')!.textContent = planet.name;
        button.onclick = () => send({ type: 'target', planetId: planet.id });
        el('[data-planets]').append(button); planetButtons.set(planet.id, button);
      });
    }
    const desired = vec(s.position), blend = 1 - Math.exp(-dt * 14);
    if (!rendered || Vector3.Distance(rendered, desired) > 2000) rendered = desired; else rendered = Vector3.Lerp(rendered, desired, blend);
    facing = Vector3.Lerp(facing, vec(s.forward), blend).normalize(); up = Vector3.Lerp(up, vec(s.up), blend).normalize();
    // Rebase only presentation. The host's saved system coordinates never change.
    terrain!.update(rendered, rendered); starfield.position.set(0, 0, 0);
    const isFlight = s.mode === 'flight';
    camera.upVector.copyFrom(up); camera.position.copyFrom(isFlight ? facing.scale(-19).add(up.scale(6)) : up.scale(-1.35));
    // A chase camera must not cut through the surface during vertical takeoff.
    const nearCamera = snapshot.system.planets.find(p => p.id === snapshot!.status.nearestPlanetId) ?? snapshot.system.planets[0];
    const cameraRelative = rendered.add(camera.position).subtract(vec(nearCamera.center));
    const cameraDirection = cameraRelative.normalizeToNew();
    const cameraFloor = nearCamera.radius + Math.max(0, terrainHeight(nearCamera, cameraDirection)) + 1.6;
    if (cameraRelative.length() < cameraFloor) camera.position.addInPlace(cameraDirection.scale(cameraFloor - cameraRelative.length()));
    const look = isFlight ? facing : facing.scale(Math.cos(lookPitch)).add(up.scale(Math.sin(lookPitch)));
    camera.setTarget(camera.position.add(look.scale(60)));
    const parked = s.landedVesselPosition ? vec(s.landedVesselPosition).subtract(rendered) : Vector3.Zero();
    ship.position.copyFrom(isFlight ? Vector3.Zero() : parked);
    if (isFlight) ship.rotationQuaternion = Quaternion.FromLookDirectionRH(facing, up);
    else {
      const planet = snapshot.system.planets.find(p => p.id === s.landedPlanetId)!;
      const vertical = vec(s.landedVesselPosition!).subtract(vec(planet.center)).normalize();
      let east = Vector3.Cross(Vector3.Up(), vertical); if (east.lengthSquared() < .00001) east = Vector3.Right(); east.normalize();
      ship.rotationQuaternion = Quaternion.FromLookDirectionRH(Vector3.Cross(vertical, east).normalize(), vertical);
    }
    ship.setEnabled(isFlight || parked.length() > 4); ship.scaling.setAll(isFlight ? 1 : .8);
    const nearby = snapshot.system.planets.find(p => p.id === snapshot!.status.nearestPlanetId) ?? snapshot.system.planets[0];
    const air = Math.max(0, Math.min(1, 1 - snapshot.status.altitude / Math.max(1, nearby.atmosphere)));
    const sky = Color3.FromHexString(nearby.palette.sky); scene.clearColor = new Color4(sky.r * air * .35 + .003, sky.g * air * .35 + .006, sky.b * air * .35 + .018, 1);
    scene.fogMode = air > .02 ? Scene.FOGMODE_EXP2 : Scene.FOGMODE_NONE; scene.fogDensity = .00018 * air; scene.fogColor.copyFrom(sky.scale(.6));
    fill.direction.copyFrom(up); fill.intensity = .55 + .25 * air;
    if ((drawTick++ % 5) === 0) {
      el('[data-system]').textContent = `${snapshot.system.name} / SYSTEM ${s.systemIndex.toString().padStart(4, '0')}`;
      el('[data-place]').textContent = isFlight && snapshot.status.altitude > nearby.atmosphere ? 'Between worlds' : nearby.name;
      el('[data-phase]').textContent = s.landing ? 'Descending to the surface' : s.cruise ? 'Aether sail engaged · assisted passage' : !isFlight ? snapshot.status.message : snapshot.status.altitude < nearby.atmosphere ? 'Atmospheric flight' : 'Free flight';
      el('[data-count]').textContent = String(snapshot.system.planets.length).padStart(2, '0');
      el('[data-altitude]').textContent = units(snapshot.status.altitude); el('[data-speed]').textContent = `${Math.round(snapshot.status.speed)} m/s`; el('[data-visited]').textContent = `${s.discoveries.length} worlds`;
      launch.innerHTML = `${s.landing ? 'Landing…' : isFlight ? 'Land' : 'Launch'} <kbd>F</kbd>`; launch.disabled = !live || s.landing || (isFlight ? !snapshot.status.canLand : snapshot.status.canLaunch === false);
      cruise.innerHTML = `${s.cruise ? 'Stop sail' : 'Sail to target'} <kbd>C</kbd>`; cruise.disabled = !live || !isFlight || !s.targetPlanetId;
      for (const p of snapshot.system.planets) { const b = planetButtons.get(p.id)!; const visited = s.discoveries.some(d => d.planetId === p.id); b.classList.toggle('selected', p.id === s.targetPlanetId); b.setAttribute('aria-pressed', String(p.id === s.targetPlanetId)); b.querySelector('small')!.textContent = `${p.kind} · ${visited ? 'visited' : 'uncharted surface'}`; b.querySelector('em')!.textContent = units(Math.max(0, distance(s.position, p.center) - p.radius)); }
      const target = snapshot.system.planets.find(p => p.id === s.targetPlanetId); const targetEl = el('[data-target]'); targetEl.hidden = !target;
      if (target) targetEl.textContent = `${target.name} · ${units(Math.max(0, distance(s.position, target.center) - target.radius))}${snapshot.status.canLand && target.id === snapshot.status.nearestPlanetId ? ' · landing available' : ''}`;
      if (campaignMode && campaign) campaignReturn.disabled = !live || !campaign.canReturn || busy;
      root.dataset.mode = s.mode;
    }
    scene.render();
  });
  // Read-only diagnostic surface for bounded browser verification.
  Object.defineProperty(window, '__tvUniverse', { configurable: true, value: { get snapshot() { return snapshot; }, get campaign() { return campaign; }, get stats() { return terrain?.stats(); }, get ready() { return !!snapshot && !!terrain; } } });
  const cleanup = () => { if (disposed) return; disposed = true; clearInterval(network); clearTimeout(reconnect); campaignSocket?.close(); keys.clear(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp); terrain?.dispose(); scene.dispose(); engine.dispose(); root.remove(); };
  window.addEventListener('pagehide', cleanup, { once: true });
}

function buildVessel(scene: Scene): TransformNode {
  const root = new TransformNode('aether-skiff', scene);
  const metal = new StandardMaterial('skiff-ceramic', scene); metal.diffuseColor = Color3.FromHexString('#263a48'); metal.specularColor = Color3.FromHexString('#b5c8c9'); metal.specularPower = 70;
  const trim = new StandardMaterial('skiff-brass', scene); trim.diffuseColor = Color3.FromHexString('#c4a466'); trim.specularColor = Color3.FromHexString('#ffe7ad');
  const glow = new StandardMaterial('aether-crystal', scene); glow.diffuseColor = Color3.FromHexString('#6de3dc'); glow.emissiveColor = Color3.FromHexString('#3abbbb');
  const hull = MeshBuilder.CreateSphere('skiff-hull', { diameter: 3, segments: 12 }, scene); hull.scaling.set(.65, .32, 1.8); hull.parent = root; hull.material = metal;
  for (const side of [-1, 1]) {
    const wing = MeshBuilder.CreateBox('skiff-outrigger', { width: 4.8, height: .18, depth: 1.4 }, scene); wing.position.set(side * 2.9, -.2, -.3); wing.rotation.z = side * -.16; wing.rotation.y = side * -.3; wing.parent = root; wing.material = trim;
    const engine = MeshBuilder.CreatePolyhedron('skiff-sail-stone', { type: 1, size: .65 }, scene); engine.scaling.set(.55, .6, 2.2); engine.position.set(side * 4.8, 0, .6); engine.parent = root; engine.material = glow;
  }
  const canopy = MeshBuilder.CreateSphere('skiff-canopy', { diameter: 1.6, segments: 12 }, scene); canopy.scaling.set(.7, .45, 1.7); canopy.position.set(0, .45, -.3); canopy.parent = root; canopy.material = glow;
  return root;
}

function buildStars(scene: Scene): Mesh {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i < 1500; i++) { const y = 1 - (i + .5) / 750, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653, b = .45 + (i % 7) / 13; positions.push(Math.cos(a) * r * 180000, y * 180000, Math.sin(a) * r * 180000); colors.push(b * .8, b * .9, b, 1); indices.push(i); }
  const mesh = new Mesh('astral-stars', scene), data = new VertexData(); data.positions = positions; data.colors = colors; data.indices = indices; data.applyToMesh(mesh);
  const mat = new StandardMaterial('star-light', scene); mat.disableLighting = true; mat.emissiveColor = Color3.White(); mat.pointsCloud = true; mat.pointSize = 1.6; mesh.material = mat; mesh.alwaysSelectAsActiveMesh = true; return mesh;
}
