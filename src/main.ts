import * as THREE from 'three';
import { World } from './sim/core/world';
import { Simulation } from './sim/mind/agent';
import { DialogueSystem } from './sim/mind/dialogue';
import { load, save, newWorld, hasSave, clearSave } from './sim/persist/save';
import { VoxelRenderer } from './game/voxel/mesher';
import { Atmosphere } from './game/render/scene';
import { ActorRenderer } from './game/actors/actors';
import { ConstructionRenderer } from './game/presentation/constructionRenderer';
import { ExtractionEffectsController } from './game/presentation/extractionEffects';
import { PlayerController } from './game/player/controller';
import { Interaction } from './game/player/interaction';
import { HUD } from './game/ui/hud';
import { DialogueUI } from './game/ui/dialogue';
import { EventFeed } from './game/ui/events';
import { Inspector } from './game/ui/inspector';
import { Observer } from './game/ui/observer';
import { AudioSys } from './game/audio/audio';
import { TelemetryRecorder, MemorySink } from './sim/telemetry/recorder';
import { flushBrowserSession } from './sim/telemetry/browserSessionSink';
import type { Person } from './sim/core/types';

declare global { interface Window { game?: Game } }

const app = document.getElementById('app')!;
const startEl = document.getElementById('start')!; const loading = document.getElementById('loading')!;
(document.getElementById('btn-continue') as HTMLButtonElement).disabled = !hasSave();
document.getElementById('btn-continue')!.onclick = () => boot(false);
document.getElementById('btn-new')!.onclick = () => { clearSave(); boot(true); };

let game: Game | null = null;
/** §10 reusable browser functional harness: `?seed=NNNN` lets a test (or a developer) boot a
 * specific deterministic village instead of the default 1337, without touching an existing save.
 * Only applies to a fresh world — "Continue" always resumes whatever was actually saved. */
function requestedSeed(): number | null {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
async function boot(fresh: boolean): Promise<void> {
  loading.textContent = 'Generating Ashford Vale…'; await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now();
  const res = (!fresh && load()) || newWorld(requestedSeed() ?? 1337);
  loading.textContent = `World ready in ${Math.round(performance.now() - t0)} ms. Building meshes…`; await new Promise(r => setTimeout(r, 30));
  game = new Game(res.world); window.game = game;
  startEl.style.display = 'none'; game.start();
}

class Game {
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera; sim: Simulation; voxels: VoxelRenderer; atmo: Atmosphere; actors: ActorRenderer; ctrl: PlayerController; inter: Interaction; hud: HUD; dialogue: DialogueUI; feed: EventFeed; inspector: Inspector; observer: Observer; audio = new AudioSys(); construction: ConstructionRenderer; extractionEffects: ExtractionEffectsController;
  modeBadge = document.getElementById('modebadge')!;
  speedMult = 1; paused = false; lastFrame = performance.now(); autosaveTimer = 0; followId: string | null = null; hitParticles: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  // v0.2 Part 18: automatic play-session logging — no manual "press F8" step. `sessionId` names
  // the localStorage entry this session's telemetry flushes to (see browserSessionSink.ts).
  telemetry = new MemorySink(); telemetryRecorder: TelemetryRecorder; sessionId = String(Date.now());
  constructor(public world: World) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.setSize(innerWidth, innerHeight); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05; this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.localClippingEnabled = true;
    app.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 500);
    window.addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); });
    this.sim = new Simulation(world);
    this.telemetryRecorder = new TelemetryRecorder(world, [this.telemetry]);
    this.telemetryRecorder.runStart({ seed: world.seed, mode: 'browser', sessionId: this.sessionId });
    this.voxels = new VoxelRenderer(world.grid); this.voxels.buildAll(); this.scene.add(this.voxels.group);
    this.atmo = new Atmosphere(this.scene, world);
    this.actors = new ActorRenderer(world); this.scene.add(this.actors.group);
    this.construction = new ConstructionRenderer(world); this.scene.add(this.construction.group);
    this.extractionEffects = new ExtractionEffectsController(world); this.scene.add(this.extractionEffects.group);
    this.ctrl = new PlayerController(world, this.camera, this.renderer.domElement);
    this.inter = new Interaction(world, this.sim, this.ctrl, this.renderer.domElement);
    this.hud = new HUD(world, this.camera); this.dialogue = new DialogueUI(new DialogueSystem(world, this.sim)); this.feed = new EventFeed(world); this.inspector = new Inspector(world); this.observer = new Observer(world);
    // wiring
    this.inter.onMessage = (s) => this.hud.message(s);
    this.inter.onTalk = (p) => this.openDialogue(p);
    this.inter.onInspect = (p) => { this.inspector.toggle(true); this.inspector.select(p.id); this.hud.selected = p.id; };
    this.inter.onSwing = () => this.audio.sfx('swing'); this.inter.onPickup = () => this.audio.sfx('pickup');
    this.ctrl.onStep = () => this.audio.sfx('step');
    this.sim.onHit = (b, pos) => { this.audio.sfx(b.ownerId === world.playerId ? 'hurt' : 'hit'); this.spawnHitParticles(pos); };
    this.sim.onSpeech = (p, t) => { const b = world.primaryBody(p.id); const pb = world.primaryBody(world.playerId)!; if (b && Math.hypot(b.pos.x - pb.pos.x, b.pos.z - pb.pos.z) < 12) this.audio.sfx('talk'); };
    this.dialogue.onClose = () => { this.inter.enabled = true; this.ctrl.enabled = true; if (!document.pointerLockElement) void this.renderer.domElement.requestPointerLock().catch(() => { /* embedded clients may reject pointer lock */ }); };
    this.dialogue.onOption = () => this.audio.sfx('talk');
    this.inspector.onFollow = (id) => { this.followId = id; if (id) { this.ctrl.thirdPerson = true; } };
    this.inspector.onVisit = (id) => {
      const target = world.primaryBody(id); if (!target) { this.hud.message(`${world.nameOf(id)} has no present body.`); return; }
      const offsets: Array<readonly [number, number]> = [];
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const distance = Math.hypot(dx, dz); if (distance >= 1.4 && distance <= 3.1) offsets.push([dx, dz]);
      }
      offsets.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
      const destination = offsets.map(([dx, dz]) => {
        const x = Math.floor(target.pos.x + dx), z = Math.floor(target.pos.z + dz), y = world.nav.floorY(x, z);
        return { x, y, z };
      }).find(p => p.y >= 0 && world.nav.isWalkable(p.x, p.z) && world.grid.lineOfSight(
        { x: p.x + 0.5, y: p.y + this.ctrl.eyeHeight, z: p.z + 0.5 },
        { x: target.pos.x, y: target.pos.y + 0.9, z: target.pos.z }, 4.2,
      ));
      if (!destination) { this.hud.message(`No safe position near ${world.nameOf(id)}.`); return; }
      const pos = { x: destination.x + 0.5, y: destination.y, z: destination.z + 0.5 };
      this.followId = null; this.inspector.follow = false; this.ctrl.thirdPerson = false; this.ctrl.teleport(pos);
      this.ctrl.yaw = Math.atan2(-(target.pos.x - pos.x), -(target.pos.z - pos.z));
      this.inspector.toggle(false); this.hud.message(`Moved near ${world.nameOf(id)}. This is an inspector test aid.`);
    };
    this.inspector.onShowChain = (id) => { if (!this.feed.open) this.feed.toggle(); this.feed.showChain(id); };
    // ---- v0.10 Part V/VI/VII: the elevated presentation + observer mode.
    //
    // Everything here is wiring between EXISTING pieces. The camera is the same camera, the
    // scene is the same scene, the simulation is untouched, and the observer's follow is a
    // camera decision only — `ctrl.followPos` moves where the boom points and parks the player,
    // and nothing anywhere reaches into the followed person. Time control reuses the same
    // `speedMult`/`paused` the T and P keys already drive; there is no second time model.
    this.observer.onFollow = (id) => { this.followId = id; this.hud.selected = id; if (!id) this.ctrl.followPos = null; };
    this.observer.onSpeed = (mult) => { this.paused = false; this.speedMult = mult; this.world.clock.speedMultiplier = mult; this.hud.message(`Time ×${mult}`); };
    this.observer.onPause = () => { this.paused = !this.paused; this.hud.message(this.paused ? 'Paused' : 'Resumed'); };
    this.observer.onOpenInspector = (id) => { this.inspector.toggle(true); this.inspector.select(id); };
    // While the observer overlay is open, the primary click SELECTS whoever is under the cursor
    // rather than swinging — a microscope's click should not start a fight. Attacking is still
    // available on X, unchanged, through the identical canonical path.
    this.inter.onPrimaryClick = () => {
      if (!this.observer.open || this.ctrl.mode !== 'arpg') return false;
      const picked = this.inter.pickPersonUnderCursor();
      if (!picked) return false;
      this.observer.select(picked.id);
      this.hud.selected = picked.id;
      return true;
    };
    this.inspector.onFocusEvents = (id) => { if (!this.feed.open) this.feed.toggle(); this.feed.setFocus(id); };
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'F2') { e.preventDefault(); this.setCameraMode(this.ctrl.mode === 'arpg' ? 'first' : 'arpg'); }
      if (e.code === 'F6') {
        e.preventDefault();
        this.observer.toggle();
        // The overlay is only usable from the elevated camera (it needs a free cursor and a view
        // of more than one person), so asking for it asks for that view too.
        if (this.observer.open && this.ctrl.mode !== 'arpg') this.setCameraMode('arpg');
        if (this.observer.open && !this.observer.sel && this.inter.target?.kind === 'body' && this.inter.target.person) this.observer.select(this.inter.target.person.id);
      }
      if (e.code === 'F3') { e.preventDefault(); this.inspector.toggle(); if (this.inspector.open && this.inter.target?.kind === 'body' && this.inter.target.person) this.inspector.select(this.inter.target.person.id); }
      if (e.code === 'F4') { e.preventDefault(); this.feed.toggle(); }
      if (e.code === 'F5') { e.preventDefault(); this.doSave(); }
      if (e.code === 'KeyT') { this.speedMult = this.speedMult === 1 ? 4 : this.speedMult === 4 ? 16 : 1; this.world.clock.speedMultiplier = this.speedMult; this.hud.message(`Time ×${this.speedMult}`); }
      if (e.code === 'KeyP') { this.paused = !this.paused; this.hud.message(this.paused ? 'Paused' : 'Resumed'); }
      if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
    });
    window.addEventListener('beforeunload', () => { this.doSave(true); this.flushTelemetry(); });
    this.renderer.domElement.addEventListener('click', () => this.audio.init(), { once: true });
    world.emit('player_spawn', { actor: world.playerId!, pos: world.primaryBody(world.playerId)!.pos, significance: 0.3, summary: 'the Traveler arrived on the west road' });
  }
  /** v0.10 Part V: switch which camera is presenting the one canonical world. Not a game mode —
   * no simulation state changes here, and the player can act identically either way. */
  setCameraMode(mode: 'first' | 'third' | 'arpg'): void {
    this.ctrl.setMode(mode);
    if (mode !== 'arpg') { this.followId = null; this.observer.toggle(false); this.ctrl.roofCutY = null; this.voxels.setRoofCut(null); }
    this.modeBadge.classList.toggle('on', mode === 'arpg');
    // The crosshair means "you are aiming down your own nose". In the elevated view the cursor
    // is doing that job, so the crosshair would just be a dot in the middle of the screen.
    (document.getElementById('crosshair') as HTMLElement).style.display = mode === 'arpg' ? 'none' : '';
    this.hud.message(mode === 'arpg' ? 'Elevated view. Wheel to zoom, middle-drag to turn, F6 for the observer overlay.' : 'Immersive view.');
  }
  /** Advance the simulation without rendering (used for tests and for skipping time). */
  stepSim(seconds: number, sub = 0.05): void { const w = this.world; let t = 0; while (t < seconds) { const worldDt = w.clock.advance(sub); w.physicalTime += sub; this.sim.step(sub, worldDt); this.sim.flushSpeech(); t += sub; } }
  start(): void { this.lastFrame = performance.now(); requestAnimationFrame(() => this.frame()); }
  openDialogue(p: Person): void { if (!p.alive) return; this.inter.enabled = false; this.ctrl.enabled = false; document.exitPointerLock(); const b = this.world.primaryBody(p.id); const pb = this.ctrl.body; if (b) { b.yaw = Math.atan2(-(pb.pos.x - b.pos.x), -(pb.pos.z - b.pos.z)); b.pose = 'talk'; b.poseUntil = this.world.physicalTime + 3; } this.dialogue.start(p, this.world.person(this.world.playerId)!); }
  doSave(quiet = false): void { if (save(this.world) && !quiet) this.hud.message('World saved.'); }
  /** v0.2 Part 18: called on unload and piggy-backed on the existing 30s autosave cadence, so a
   * dev session's trace exists automatically — inspect it later via
   * readBrowserTelemetrySession(listBrowserTelemetrySessions().at(-1)) in the devtools console. */
  flushTelemetry(): void { flushBrowserSession(this.sessionId, this.telemetry); }
  spawnHitParticles(pos: { x: number; y: number; z: number }): void { for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff4030 : 0xa02020 })); m.position.set(pos.x, pos.y, pos.z); this.scene.add(m); this.hitParticles.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5), life: 0.7 }); } }
  frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now(); let dt = Math.min(0.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
    const w = this.world; const paused = this.paused || this.dialogue.open;
    // player always moves in real time (unless paused)
    if (!this.paused) this.ctrl.update(dt);
    if (!paused) {
      const physDt = dt * this.speedMult; const steps = Math.max(1, Math.ceil(physDt / 0.06)); const sub = physDt / steps;
      for (let i = 0; i < steps; i++) { const worldDt = w.clock.advance(sub); w.physicalTime += sub; this.sim.step(sub, worldDt); }
      this.sim.flushSpeech();
      this.checkPlayerDeath();
    }
    // follow camera. In the elevated mode the follow target is handed to the controller, which
    // owns the camera for that mode (`ctrl.followPos`); the pre-existing orbit-follow below is
    // what the immersive Inspector's own "follow" button has always done, and is unchanged.
    if (this.ctrl.mode === 'arpg') {
      const b = this.followId ? w.primaryBody(this.followId) : null;
      this.ctrl.followPos = b ? { ...b.pos } : null;
      // Indoors, take the roof off rather than shoving the camera into the subject's face —
      // see `VoxelRenderer.setRoofCut`. The cut sits just above head height at the focus, so the
      // walls of the room stay, which is what makes it readable rather than disorienting.
      const focus = this.ctrl.followPos ?? this.ctrl.body.pos;
      this.ctrl.roofCutY = w.isIndoors(focus) ? focus.y + 2.6 : null;
      this.voxels.setRoofCut(this.ctrl.roofCutY);
    } else if (this.followId) { const b = w.primaryBody(this.followId); if (b) { const target = new THREE.Vector3(b.pos.x, b.pos.y + 1.4, b.pos.z); const off = new THREE.Vector3(Math.sin(now * 0.0002) * 6, 3.5, Math.cos(now * 0.0002) * 6); this.camera.position.lerp(target.clone().add(off), 0.08); this.camera.lookAt(target); } }
    this.inter.update();
    this.voxels.update(); this.voxels.setTime(w.physicalTime);
    // The player's own body is hidden only when the camera is literally inside their head.
    this.actors.sync(dt, w.physicalTime, this.ctrl.mode === 'first' && !this.ctrl.thirdPerson && !this.followId);
    this.construction.update(); this.extractionEffects.update(dt);
    const pb = this.ctrl.body; const ppos = new THREE.Vector3(pb.pos.x, pb.pos.y, pb.pos.z);
    this.atmo.update(dt, w.clock.dayFraction, ppos, this.camera.position);
    for (let i = this.hitParticles.length - 1; i >= 0; i--) { const p = this.hitParticles[i]; p.life -= dt; p.v.y -= 12 * dt; p.m.position.addScaledVector(p.v, dt); if (p.life <= 0) { this.scene.remove(p.m); this.hitParticles.splice(i, 1); } }
    this.audio.update(dt, w.clock.dayFraction, w.weather.kind === 'rain' || w.weather.kind === 'storm' ? w.weather.intensity : 0, w.isIndoors(pb.pos), w.weather.wind);
    this.hud.selected = this.observer.open ? this.observer.sel : this.inspector.open ? this.inspector.sel : null;
    this.hud.update(this.inter.target, this.speedMult, this.paused); this.feed.update(); this.inspector.update(); this.observer.update(this.speedMult, this.paused);
    this.autosaveTimer += dt; if (this.autosaveTimer > 30) { this.autosaveTimer = 0; this.doSave(true); this.flushTelemetry(); }
    this.renderer.render(this.scene, this.camera);
  }
  checkPlayerDeath(): void {
    const w = this.world; const pb = this.ctrl.body; const player = w.person(w.playerId)!;
    if (pb.health <= 0 && !pb.dead) { pb.dead = true; pb.pose = 'dead'; w.emit('player_death', { actor: player.id, pos: pb.pos, significance: 0.8, summary: 'the Traveler fell' }); this.hud.message('You fall. Darkness... then bells.');
      setTimeout(() => { const chapel = w.places().find(p => p.type === 'chapel')!; const d = chapel.door!; pb.dead = false; pb.health = pb.maxHealth * 0.5; pb.pose = 'stand'; this.ctrl.teleport({ x: d.x + 0.5, y: d.y, z: d.z + 2.5 }); w.emit('heal', { actor: w.persons().find(p => p.occupation === 'priest')?.id, target: player.id, pos: pb.pos, significance: 0.5, summary: 'Father Aldous tended the Traveler\'s wounds at the chapel' }); this.hud.message('You wake at the chapel. Father Aldous has bound your wounds.'); }, 3000); }
  }
}
