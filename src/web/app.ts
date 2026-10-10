import {SharedCharacters} from './actors/sharedCast';
import { combatGymStage } from './world/combatGymStage';
import { Color3, FreeCamera, Matrix, Plane, Vector3 } from '@babylonjs/core';
import { INTERACTION_SPEC } from '../sim/physical/prediction';
import { createRenderer, attachPipeline, QUALITY, type QualityTier, type RenderContext } from './render/engine';
import { Atmosphere } from './world/atmosphere';
import { RegionManager } from './world/regionManager';
import { GrassField } from './world/grass';
import { WeatherFx } from './world/weatherFx';
import { ImpactFx } from './world/impactFx';
import { QualityGovernor } from './render/governor';
import { GameConnection, type CharacterChoice, type ClosedInfo, type GameLink } from './net/connection';
import { ReplayConnection } from './net/replay';
import { ObservatoryConnection } from './net/observatory';
import type { BodyState, DialogueProjection, InteractionTarget, SnapshotMessage, Vec3 } from './net/messages';
import { LocalPredictor } from './game/predictor';
import { CameraRig, ORBIT_EXPLORATION_PITCH, THIRD_PERSON_PITCH } from './game/cameraRig';
import type { CameraPresetName } from './game/adaptiveCamera';
import { InputManager } from './game/input';
import { PlayerController, candidatesFrom, type CombatIntent } from './game/controller';
import { DEFAULT_SETTINGS, codeLabel, loadSettings, saveSettings, type Settings } from './game/bindings';
import { describeResult, TALK_REASON, titleCase } from './game/text';
import { ActorManager, placeholderVisual, predictedTiming } from './actors/actorManager';
import { CharacterFactory, makeRealization } from './actors/characterFactory';
import { CreatureFactory } from './actors/creatureFactory';
import { add, h } from './ui/dom';
import { UiNav } from './ui/nav';
import { PortraitRenderer } from './ui/portrait';
import { GameAudio } from './audio/audio';
import { ModalHost } from './ui/modal';
import { Hud } from './ui/hud';
import { DialoguePanel } from './ui/dialoguePanel';
import { abilitiesTab, itemsTab, journalTab, type PanelServices } from './ui/menuPanels';
import { settingsTabs } from './ui/settingsPanel';
import { banner, characterScreen, deathScreen, loadingScreen, noticeScreen, titleScreen } from './ui/screens';
import { Showroom, LINEUP } from './showroom/showroom';
import { realize } from './actors/appearanceMap';
import { noteSlow, slowEvents, timed } from './game/probe';
import './ui/theme.css';

/**
 * The browser client. It renders what the server projects and sends intentions; it never steps
 * the World. Phases: title -> connecting -> playing (menus and conversation are layers over playing).
 */
type Phase = 'title' | 'connecting' | 'playing' | 'closed' | 'showroom';
const REMEMBER_KEY = 'torn-veil-web.character.v1';

export class App {
  ctx!: RenderContext; atmosphere!: Atmosphere; regions!: RegionManager; camera!: FreeCamera; rig!: CameraRig; actors!: ActorManager;
  link!: GameLink; predictor = new LocalPredictor(); input!: InputManager; nav!: UiNav; modal!: ModalHost; hud!: Hud; dialogue!: DialoguePanel; controller!: PlayerController;
  settings: Settings = loadSettings();
  phase: Phase = 'title';
  snapshot: SnapshotMessage | null = null;
  readonly params = new URLSearchParams(location.search);
  private ui!: HTMLElement; private modalLayer!: HTMLElement; private overlay!: HTMLElement;
  private screen: { remove(): void } | null = null; private conn: { remove(): void } | null = null; private loading: { set(t: string): void; remove(): void } | null = null;
  private focus: { target: InteractionTarget | null; refusal: string | null } = { target: null, refusal: null };
  private ownBodyId = '';
  private inTalk = false;
  private ignoreEscUntil = 0;
  private lastHudAt = 0;
  private titleOrbit = 0;
  private readonly frameMs: number[] = []; private lastFrame = performance.now();
  private readyFrames = 0;
  private wantedRegions: string[] = [];
  ready = false;
  private itemsProjectionKey = '';
  showroom: Showroom | null = null;
  characters = new CharacterFactory();
  sharedCharacters?: SharedCharacters;
  creatures = new CreatureFactory();
  grass!: GrassField;
  weatherFx!: WeatherFx;
  impactFx!: ImpactFx;
  portrait!: PortraitRenderer;
  audio = new GameAudio();
  private stepDist = 0; private lastStepPos: { x: number; z: number } | null = null; private nextBlip = 0;
  private choice: CharacterChoice = { kind: 'auto' };
  private closedFinal = false;
  private hintsShown = new Set<string>();
  private physTick = 0; private physAt = 0;
  private lastMove = { id: '', atMs: -1e9 };
  private moveTimer = 0;
  private lastSnapAt = 0;
  hintState = { moved: false, looked: false, interacted: false, attacked: false };

  static async start(): Promise<App> { const a = new App(); await a.init(); return a; }

  private async init(): Promise<void> {
    document.documentElement.dataset.motion = this.settings.reducedMotion ? 'reduced' : 'normal';
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = document.getElementById('ui') as HTMLElement;
    const view = this.params.get('view');
    if (view === 'isometric' || view === 'third-person' || view === 'orbit') this.settings.viewMode = view;
    this.applyUiSettings();
    window.addEventListener('resize', () => this.applyUiSettings());
    const q = this.params.get('quality') as QualityTier | null;
    const tier: QualityTier | undefined = q && q in QUALITY ? q : this.settings.quality !== 'auto' ? this.settings.quality : undefined;
    this.ctx = await createRenderer(canvas, { prefer: this.params.get('renderer') === 'webgl2' ? 'webgl2' : undefined, quality: tier });
    this.atmosphere = new Atmosphere(this.ctx);
    for (const kv of (this.params.get('look') ?? '').split(',')) { const [k, v] = kv.split(':'); if (k in this.atmosphere.look && Number.isFinite(Number(v))) (this.atmosphere.look as Record<string, number>)[k] = Number(v); }
    this.regions = new RegionManager(this.ctx, this.atmosphere);
    const gq = { high: { radius: 42, capacity: 90000 }, balanced: { radius: 30, capacity: 60000 }, low: { radius: 14, capacity: 16000 } }[this.ctx.quality.tier];
    this.grass = new GrassField(this.ctx.scene, this.regions, gq); this.regions.onOriginChange = () => this.grass.invalidate();
    this.impactFx = new ImpactFx(this.ctx.scene);
    this.weatherFx = new WeatherFx(this.ctx.scene, this.ctx.quality.tier === 'low' ? 900 : 2600);
    this.camera = new FreeCamera('camera', new Vector3(0, 30, 0), this.ctx.scene);
    attachPipeline(this.ctx, this.camera);
    this.rig = new CameraRig(this.camera, () => this.settings, {
      blocked: (x, y, z) => { const sx = x + this.regions.origin.x, sy = y + this.regions.origin.y, sz = z + this.regions.origin.z; return this.regions.cameraStructureAt(sx, sy, sz, this.rig?.orbit ? this.predictor.predicted?.pos ?? null : null) || (!this.pivotInPlant && this.regions.plantAt(sx, sy, sz)); },
      ground: (x, z) => { const g = this.regions.groundAt(x + this.regions.origin.x, z + this.regions.origin.z); return g === null ? null : g - this.regions.origin.y; },
    });
    this.actors = new ActorManager(this.ctx, this.atmosphere, this.regions);
    this.actors.env = {
      physicalNow: () => this.physTick + (performance.now() - this.physAt) / 1000, speakerBodyId: () => (this.dialogue.isOpen ? this.dialogue.speaker : null), playerBodyId: () => this.ownBodyId,
      playerLook: () => { const t = this.controller.lockedBodyId; return t ? this.actors.headPoint(t, new Vector3()) : null; },
      onContact: (pos, onPlayer) => this.impactFx.burst(this.regions.toRender(pos), onPlayer),
      onHit: (id, own) => { if (own) { this.rig.impact(0.8); this.input.vibrate(0.6, 0.3, 160); this.audio.combat('hurt'); } else this.audio.combat('hit'); },
    };
    this.actors.factory = (ctx, atmos, a) => (a.kind === 'person' ? (a.body?this.sharedCharacters?.create(a.body,atmos):null) ?? this.characters.create(ctx.scene, atmos, a.body?.bodyId ?? 'x', makeRealization(a.body, a.body?.bodyId ?? 'x')) : a.wildlife ? this.creatures.create(ctx.scene, atmos, a.wildlife) : null) ?? placeholderVisual(ctx, atmos, a);
    this.input = new InputManager(canvas, () => this.settings);
    this.nav = new UiNav(this.input);
    this.overlay = h('div', { class: 'tv-layer', style: 'pointer-events:none' }); this.modalLayer = h('div', { class: 'tv-layer', style: 'pointer-events:none' });
    this.hud = new Hud(this.ui); this.hud.onInteract = () => { if (this.phase === 'playing' && !this.modal.isOpen && !this.dialogue.isOpen) void this.doInteract(); }; this.ui.append(this.overlay, this.modalLayer);
    this.modal = new ModalHost(this.modalLayer, this.nav);
    this.portrait = new PortraitRenderer(this.ctx.scene, this.actors);
    this.dialogue = new DialoguePanel(this.overlay, {
      choose: async (id, label) => { this.audio.ui('confirm'); const r = await this.link.intent({ type: 'dialogue_option', optionId: id }); void label; return { result: r.result }; },
      speak: (text, revision) => this.link.intent({ type: 'dialogue_text', text, revision }, 5000),
      close: () => void this.link.intent({ type: 'dialogue_close' }),
      portrait: this.portrait,
      keyLabel: n => String(n), toast: (t, tone) => this.hud.toast(t, tone), describe: r => describeResult(r).text, silver: () => Math.round(this.own()?.wealth ?? 0),
    });
    this.link = (this.params.has('observatory') || this.params.has('gym')) ? new ObservatoryConnection() : this.params.get('replay') ? new ReplayConnection(this.params.get('replay')!) : new GameConnection();
    this.controller = new PlayerController(this.link, this.predictor, this.input, this.rig, () => this.settings, {
      canAct: () => (!(this.link instanceof ObservatoryConnection) || this.link.playable) && this.phase === 'playing' && !this.modal.isOpen && !this.dialogue.isOpen && !this.own()?.dead && this.predictor.hasState,
      conversationPartner: () => (this.dialogue.isOpen ? this.speakerPos() : null),
      onCombatCommand: c => this.onCombatCommand(c), onLockChange: id => this.onLock(id),
    }, () => this.candidates(), () => this.predictor.predicted?.pos ?? null);
    this.wireLink();
    const wake = () => { this.audio.start(); this.audio.setVolumes({ master: this.settings.masterVolume, music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume, voice: this.settings.voiceVolume }); };
    window.addEventListener('pointerdown', wake, { once: true }); window.addEventListener('keydown', wake, { once: true });
    this.input.onLockChange = locked => { if (!locked && this.phase === 'playing' && !this.modal.isOpen && !this.dialogue.isOpen && !this.own()?.dead) { this.ignoreEscUntil = performance.now() + 300; this.openPause(); } };
    canvas.addEventListener('click', () => { if (this.phase === 'playing' && !this.modal.isOpen && this.input.device === 'keyboard') this.input.requestLock(); });
    (window as unknown as { __tv: unknown }).__tv = this;
    this.ctx.engine.runRenderLoop(() => this.frame());
    const boot = loadingScreen(this.overlay, 'Preparing the people…'); this.screen = boot as { remove(): void };
    await this.characters.load(this.ctx.scene, (d, t) => boot.set(`Preparing the people… ${d}/${t}`));
    if(!this.params.has('legacy-characters')&&!this.params.has('showroom')){this.sharedCharacters=new SharedCharacters(this.ctx.scene);try{await this.sharedCharacters.load(text=>boot.set(text));}catch(e){console.warn('[shared cast] Legacy fallback',e);}}
    boot.set('Preparing the wildlife…'); await this.creatures.load(this.ctx.scene);
    if (!this.params.has('showroom') && !this.params.has('replay') && !this.params.has('observatory')) { boot.set('Warming the renderer…'); await this.warmUp(); }
    this.clearScreen();
    if (this.params.has('showroom')) { this.phase = 'showroom'; this.showroom = new Showroom(this); await this.showroom.init(this.params.get('showroom') || 'kit_f'); this.ready = true; return; }
    if (this.params.has('gym')) this.setupGym();
    this.showTitle();
    if (this.params.get('autoplay') || this.params.get('replay')) this.play(this.params.get('name') ? { kind: 'new', name: this.params.get('name')!, sex: 'f' } : { kind: 'auto' });
  }

  /**
   * Compile every shader variant the first person, animal or strike would otherwise compile in the middle of play:
   * a WebGPU pipeline built on first use can stall a frame for hundreds of milliseconds. One of each kind of person
   * and animal is drawn for a few frames behind the loading screen, then discarded. Cosmetic only.
   */
  private setupGym(): void {
    const gym = this.params.get('scenario') !== 'town';
    if (gym) combatGymStage(this.ctx, this.atmosphere);
    const panel = h('div', { style: 'position:fixed;top:12px;left:12px;z-index:30;background:#f5f7f9ee;color:#26313c;padding:12px;border:1px solid #b9c2cc;border-radius:6px;font:14px sans-serif;pointer-events:auto;max-width:330px' });
    const control = async (action: string, extras: Record<string, unknown> = {}) => {
      this.controller.release(); this.input.exitLock();
      if (action !== 'pause' && action !== 'ai') this.link.disconnect();
      const r = await fetch('/api/gym/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extras }) });
      const result = await r.json();
      if (!r.ok) { this.hud.toast(result.error, 'bad'); return; }
      if (action === 'pause' || action === 'ai') { this.hud.toast(action === 'pause' ? (extras.paused ? 'Simulation paused.' : 'Simulation resumed.') : (extras.enabled ? 'Partner AI enabled.' : 'Partner AI paused.'), 'info'); return; }
      const q = new URLSearchParams(location.search); q.set('scenario', result.scenario); q.set('seed', String(result.seed)); q.set('autoplay', '1'); location.search = q.toString();
    };
    panel.append(h('strong', { style: 'display:block;margin-bottom:6px', text: gym ? 'Combat Gym · seed ' + (this.params.get('seed') ?? '918271') : 'Town · disposable reference world' }));
    panel.append(h('small', { style: 'display:block;margin-bottom:6px', text: 'Separate in-memory worlds. Existing town saves are never opened. Town state stays here until this launcher closes.' }));
    const button = (text: string, fn: () => void) => h('button', { type: 'button', style: 'margin:3px;padding:6px;color:#26313c;background:white;border:1px solid #a8b3be;border-radius:3px', on: { click: fn } }, text);
    panel.append(button(gym ? 'Switch to Town' : 'Switch to Combat Gym', () => void control('switch', { scenario: gym ? 'town' : 'gym' })));
    // The local action-combat feel lab (src/web/arena): smashable props, crowds, combos. Not canonical simulation.
    panel.append(button('Open Action Arena', () => { location.search = '?arena=1'; }));
    panel.append(button('Enter the Tower of Chrysanthus', () => { location.search = '?arena=1&tower=1'; }));
    panel.append(button('Enter the Proving Hall (all magic)', () => { location.search = '?arena=1&tower=1&hall=1'; }));
    if (gym) {
      const seed = h('input', { type: 'number', value: this.params.get('seed') ?? '918271', min: 0, max: 2147483647, style: 'width:90px;color:#26313c;background:white', aria: { label: 'Gym seed' } });
      panel.append(seed, button('Reset seed', () => void control('reset', { seed: Number(seed.value) })));
      let paused = false; const pause = button('Pause simulation', () => { paused = !paused; pause.textContent = paused ? 'Resume simulation' : 'Pause simulation'; void control('pause', { paused }); }); panel.append(pause);
      panel.append(button('Enable partner AI', () => void control('ai', { enabled: true })));
      panel.append(button('Pause partner AI', () => void control('ai', { enabled: false })));
    }
    panel.append(h('p', { text: 'WASD move · Shift sprint · Space dodge · LMB strike · RMB guard · E interact · F target · Esc menu. Click arena to play.' }));
    panel.append(h('small', { text: 'Dummy is a passive human body: real health and contact. Chest and loose items use canonical interactions. Furniture is static; breakable pottery/debris is unavailable.' }));
    document.body.append(panel);
  }
  private async warmUp(): Promise<void> {
    const scene = this.ctx.scene, made: { root: { position: Vector3 }; dispose(): void }[] = [];
    try {
      const fwd = this.camera.getForwardRay(1).direction, base = this.camera.position.add(fwd.scale(4));
      LINEUP.forEach((p, i) => { const v = this.characters.create(scene, this.atmosphere, `warm-${i}`, realize(`warm-${i}`, p.desc, undefined)); if (v) { v.root.position.copyFrom(base.add(new Vector3((i % 6 - 2.5) * 0.9, -1.6, Math.floor(i / 6) * 1.2))); made.push(v); } });
      for (const species of ['roe_deer', 'woodland_boar', 'field_hare']) {
        const c = this.creatures.create(scene, this.atmosphere, { speciesId: species, creatureId: `warm-${species}`, bodyPlan: { heightM: 1 }, scale: 1, ageClass: 'adult' } as never);
        if (c) { c.root.position.copyFrom(base.add(new Vector3(0, -1.6, 3))); made.push(c); }
      }
      this.impactFx.burst(base, false);
      await scene.whenReadyAsync();
      // The engine's render loop owns begin/endFrame and the WebGPU swap texture.
      // Rendering here between frames submits a texture the browser has already retired.
      for (let i = 0; i < 3; i++) await new Promise<void>(r => requestAnimationFrame(() => r()));
    } catch (e) { console.warn('renderer warm-up skipped', e); }
    finally { for (const v of made) { try { v.dispose(); } catch { /* already gone */ } } }
  }

  // ── settings ─────────────────────────────────────────────────────────────────────────────────
  applyUiSettings(): void {
    this.ui.dataset.view = this.settings.viewMode;
    const s = this.settings, h1 = window.innerHeight, base = 17 * Math.max(1, Math.min(1.6, h1 / 1080)) * s.uiScale * (s.textSize === 'large' ? 1.15 : 1);
    document.documentElement.style.setProperty('--root-size', `${base.toFixed(2)}px`);
    document.documentElement.dataset.contrast = s.highContrast ? 'high' : 'normal';
    document.documentElement.dataset.motion = s.reducedMotion ? 'reduced' : 'normal';
    document.getElementById('game')?.style.setProperty('filter', s.colorAssist === 'off' ? '' : `url(#tv-cb-${s.colorAssist})`);
  }
  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch }; saveSettings(this.settings); this.applyUiSettings();
    if (patch.viewMode) { this.controller.release(); this.rig.aimYaw = null; if (patch.viewMode === 'isometric' || patch.viewMode === 'orbit') this.input.exitLock(); }
    if (patch.quality) { this.governor.reset(performance.now()); const t = patch.quality === 'auto' ? 'balanced' : patch.quality; this.ctx.setQuality(t); this.regions.lights.setSize(this.ctx.quality.maxLights); }
    this.audio.setVolumes({ master: this.settings.masterVolume, music: this.settings.musicVolume, effects: this.settings.effectsVolume, ambience: this.settings.ambienceVolume, voice: this.settings.voiceVolume });
    if (patch.resolutionScale !== undefined) this.ctx.engine.setHardwareScalingLevel(1 / patch.resolutionScale);
  }

  // ── screens ──────────────────────────────────────────────────────────────────────────────────
  private clearScreen(): void { this.screen?.remove(); this.screen = null; }
  private remembered(): { name: string } | null { try { const v = localStorage.getItem(REMEMBER_KEY); return v ? JSON.parse(v) : null; } catch { return null; } }
  private remember(name: string): void { try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name })); } catch { /* storage unavailable */ } }
  private forget(): void { try { localStorage.removeItem(REMEMBER_KEY); } catch { /* storage unavailable */ } }

  showTitle(): void {
    this.clearScreen(); this.phase = 'title'; this.hud.show(false); this.input.exitLock(); this.dialogue.update(null); this.modal.close(false);
    const replay = !!this.params.get('replay');
    const t = titleScreen(this.overlay, {
      session: 'checking', serverNote: 'Checking the game server…', remembered: this.remembered(), replay,
      onPlay: () => this.play(this.remembered() ? { kind: 'auto' } : { kind: 'auto' }), onNewCharacter: () => this.showCharacter(), onSettings: () => this.openSettings('video'), onControls: () => this.openSettings('controls'),
      onShowroom: () => { this.hud.toast('The art showroom is opened with ?showroom in the address.', 'info'); }, onAbout: () => this.openAbout(), hint: () => undefined,
    });
    this.screen = t; (t.el.style as CSSStyleDeclaration).pointerEvents = 'auto';
    void this.preflight().then(r => t.setSession(r.ok ? 'ok' : 'none', r.note));
  }
  private async preflight(): Promise<{ ok: boolean; note: string }> {
    if (this.params.get('replay')) return { ok: true, note: 'Recorded session (nothing is sent to any server).' };
    try {
      const r = await fetch('/api/session', { cache: 'no-store' });
      if (!r.ok) return { ok: false, note: 'No game session. Open this from “Play Torn Veil Web” so the launcher can check your server first.' };
      const u = await fetch('/api/upstream-health', { cache: 'no-store' }).then(x => x.json()).catch(() => null) as { reachable?: boolean; health?: { state?: string; release?: string; env?: string } } | null;
      if (!u?.reachable) return { ok: false, note: 'The game server is not reachable. Nothing has been started for you; use the launcher to see its state.' };
      if (u.health?.state && u.health.state !== 'ready') return { ok: false, note: `The server is ${u.health.state}. Try again in a moment.` };
      return { ok: true, note: u.health?.env === 'dev' ? 'Isolated development world · your progress is saved here' : `Connected to ${u.health?.env ?? 'the'} world` };
    } catch { return { ok: false, note: 'Could not reach the local game gateway.' }; }
  }
  showCharacter(error?: string): void {
    this.clearScreen();
    this.screen = characterScreen(this.overlay, { error, onBack: () => this.showTitle(), onCreate: (name, sex) => this.play({ kind: 'new', name, sex }) });
  }
  private openAbout(): void {
    const hello = this.link.hello;
    this.modal.open({ title: 'About this build', render: b => add(b,
      h('p', { text: 'Torn Veil Online, browser client. It draws the same living world the Unreal client does and sends the same kinds of intentions; it never simulates the world itself.' }),
      h('dl', { class: 'tv-kv' }, h('dt', { text: 'Renderer' }), h('dd', { text: `${this.ctx.kind === 'webgpu' ? 'WebGPU' : 'WebGL 2 (reduced effects)'}${this.ctx.fallbackReason ? ` — ${this.ctx.fallbackReason}` : ''}` }),
        h('dt', { text: 'Quality' }), h('dd', { text: this.ctx.quality.tier }), h('dt', { text: 'Server' }), h('dd', { text: hello ? hello.release : 'not connected' }), h('dt', { text: 'World' }), h('dd', { text: hello?.worldId ?? '—' }))),
      onClose: () => undefined, footer: f => f.append(h('button', { class: 'tv-btn', type: 'button', on: { click: () => this.modal.close() } }, 'Close')) });
  }

  // ── connection ───────────────────────────────────────────────────────────────────────────────
  play(choice: CharacterChoice): void {
    this.clearScreen(); this.phase = 'connecting'; this.closedFinal = false; this.choice = choice; this.snapshot = null; this.wantedRegions = []; this.predictor.reset(); this.actors.clear();
    this.loading = loadingScreen(this.overlay, choice.kind === 'new' ? 'Being born…' : 'Entering the world…'); this.screen = this.loading as { remove(): void };
    this.link.connect(choice);
  }
  private wireLink(): void {
    const l = this.link;
    l.on('hello', m => { this.ownBodyId = m.interaction?.bodyId ?? ''; if (!this.params.has('gym')) this.remember(m.character.name); this.loading?.set('Loading the land…'); });
    l.on('scene', s => { this.regions.regionSize = s.geography?.regionSize ?? 256; this.regions.setOrigin(s.origin); });
    l.on('regions_state', s => { this.wantedRegions = s.resident; this.regions.setOrigin(s.origin); for (const id of s.unload) this.regions.unload(id); });
    l.on('presentation', p => this.regions.applyPresentation(p.payload, () => requestAnimationFrame(() => requestAnimationFrame(() => p.applied()))));
    l.on('local_state', s => { this.predictor.applyLocalState(s); if (s.bodyId) this.ownBodyId = s.bodyId; this.physTick = s.tick; this.physAt = performance.now(); });
    l.on('receipt', r => { this.predictor.applyReceipt(r); if (r.status === 'rejected' || r.status === 'cancelled') this.actors.cancelPredicted(this.ownBodyId, r.commandId); });
    l.on('combat_frame', f => { void f; });
    l.on('snapshot', s => this.onSnapshot(s));
    l.on('maintenance', m => this.hud.toast(`Server maintenance in ${Math.round(m.inMs / 1000)} s: ${m.message}`, 'bad', 9000));
    l.on('status', st => this.onStatus(st));
    l.on('closed', info => this.onClosed(info));
  }
  private onStatus(st: string): void {
    if (st === 'live') { this.conn?.remove(); this.conn = null; }
    else if (st === 'reconnecting' && this.phase === 'playing') { this.conn ??= banner(this.overlay, 'Connection lost. Reconnecting…'); }
  }
  private onClosed(info: ClosedInfo): void {
    if (!info.final) { if (this.phase === 'playing') { this.conn ??= banner(this.overlay, `${info.reason || 'Connection lost'}. Reconnecting…`); } return; }
    this.closedFinal = true; this.phase = 'closed'; this.controller.release(); this.input.exitLock(); this.dialogue.update(null); this.modal.close(false); this.conn?.remove(); this.conn = null; this.clearScreen();
    if (info.kind === 'no-character') { this.showCharacter(this.remembered() ? info.reason : undefined); return; }
    const titles: Record<string, string> = { superseded: 'Signed in elsewhere', auth: 'Sign-in failed', forbidden: 'Not allowed', character: 'Character unavailable', incompatible: 'Update needed', 'no-session': 'No game session', rate: 'Slow down' };
    const actions = [{ label: 'Return to title', primary: true, run: () => { this.link.disconnect(); this.showTitle(); } }];
    if (info.kind === 'superseded') actions.unshift({ label: 'Take the game back here', primary: true, run: () => this.play({ kind: 'auto' }) });
    if (info.kind === 'character' && /died/i.test(info.reason)) { this.forget(); actions.unshift({ label: 'Begin a new life', primary: true, run: () => this.showCharacter() }); }
    this.screen = noticeScreen(this.overlay, titles[info.kind] ?? 'Disconnected', info.reason || 'The connection closed.', actions);
  }

  // ── snapshot handling ────────────────────────────────────────────────────────────────────────
  own(): BodyState | null { const s = this.snapshot; return s ? s.bodies.find(b => b.bodyId === s.controlledBodyId) ?? null : null; }
  private camPrev: { x: number; z: number } | null = null; private camVel = { x: 0, z: 0 };
  /** What the camera should know about the surroundings (presentation only; read from the snapshot). */
  private cameraSituation(dt: number, pos: { x: number; y: number; z: number }) {
    if (this.camPrev && dt > 0) { const k = Math.min(1, dt * 8); this.camVel.x += ((pos.x - this.camPrev.x) / dt - this.camVel.x) * k; this.camVel.z += ((pos.z - this.camPrev.z) / dt - this.camVel.z) * k; }
    this.camPrev = { x: pos.x, z: pos.z };
    const engaged = this.rig.mode === 'combat';
    let threats = 0, largest = 0; const head = new Vector3();
    for (const c of this.candidates()) {
      if (c.dead) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (engaged && d < 12 && (c.hostile || d < 7)) threats++;
      if (d < 20 && c.kind === 'wildlife' && this.actors.headPoint(c.bodyId, head)) largest = Math.max(largest, head.y + this.regions.origin.y - c.pos.y);
    }
    return { velocity: { x: this.camVel.x, z: this.camVel.z }, threats, engaged, largest: largest >= 2.6 ? largest : 0 };
  }
  private candidates() { const s = this.snapshot; return s ? candidatesFrom(s.bodies, s.wildlife.bodies, s.controlledBodyId) : []; }
  private speakerPos(): Vec3 | null { const s = this.snapshot; if (!s?.dialogue?.speakerBodyId) return null; return s.bodies.find(b => b.bodyId === s.dialogue!.speakerBodyId)?.pos ?? null; }

  private onSnapshot(s: SnapshotMessage): void {
    this.snapshot = s; this.ownBodyId = s.controlledBodyId; this.lastSnapAt = performance.now();
    this.actors.sync(s, s.controlledBodyId, performance.now());
    const wasTalking = this.dialogue.isOpen;
    this.dialogue.update(s.dialogue as DialogueProjection | null);
    if (!wasTalking && this.dialogue.isOpen) {
      // The speaker's projection opens the conversation. Release gameplay input only after
      // opening it, so pointer-lock exit cannot accidentally open Pause over the dialogue.
      this.controller.release(); this.input.exitLock();
    } else if (wasTalking && !this.dialogue.isOpen) {
      this.input.releaseAll(); this.afterModal();
    }
    this.computeFocus(s);
    if(this.modal.isOpen&&this.modal.currentTab==='items'){
      // Preserve actual click targets between 10 Hz snapshots. Only relevant projections
      // rebuild the inventory, rather than replacing its buttons on every world tick.
      const key=JSON.stringify([s.carried,s.container,s.interactions,s.mobility?.restriction,s.mobility?.knownLoadKg,Math.round((s.mobility?.fatigue??0)*100),Math.round(s.mobility?.safeCarryKg??0),s.bodies.find(b=>b.bodyId===s.controlledBodyId)?.wealth]);
      if(key!==this.itemsProjectionKey){this.itemsProjectionKey=key;this.modal.refresh();}
    }else if(this.modal.isOpen&&this.modal.currentTab&&['abilities','journal'].includes(this.modal.currentTab))this.modal.refresh();
    const own = this.own();
    if (own?.dead && this.phase === 'playing' && !this.screen) { this.controller.release(); this.input.exitLock(); this.modal.close(false); this.screen = deathScreen(this.overlay, own.name, { onNew: () => { this.forget(); this.link.disconnect(); this.showCharacter(); }, onQuit: () => { this.link.disconnect(); this.showTitle(); } }); }
  }
  /** Wait for the nearby streamed scenery too: a region boundary must not reveal a void on entry. */
  private tryEnter(): void {
    const p = this.predictor.predicted;
    if (!this.snapshot || !p || this.regions.groundAt(p.pos.x, p.pos.z) === null) return;
    const size = this.regions.regionSize;
    const nearby = this.wantedRegions.filter(id => {
      const [x, z] = id.split(',').map(Number);
      return x*size < p.pos.x+90 && (x+1)*size > p.pos.x-90 && z*size < p.pos.z+90 && (z+1)*size > p.pos.z-90;
    });
    if (nearby.every(id => this.regions.regions.has(id))) this.enterGame();
  }
  private enterGame(): void {
    this.phase = 'playing'; this.clearScreen(); this.loading = null; this.hud.show(true);
    const p = this.predictor.predicted; if (p) this.rig.yaw = this.params.has('gym') && this.params.get('scenario') !== 'town' ? -Math.PI / 4 : p.yaw; this.rig.pitch = this.rig.orbit ? ORBIT_EXPLORATION_PITCH : THIRD_PERSON_PITCH; this.rig.adaptive.snap();
    const cam = this.params.get('cam'); if (cam) this.rig.preset(cam as CameraPresetName);
    this.hud.toast(`Welcome, ${this.link.hello?.character.name ?? 'traveller'}.`, 'info', 5000);
    if (this.input.device === 'keyboard') this.input.requestLock();
    this.updateHints();
  }

  private computeFocus(s: SnapshotMessage): void {
    const p = this.predictor.predicted?.pos; if (!p) { this.focus = { target: null, refusal: null }; return; }
    const yaw = this.rig.isometric ? (this.predictor.predicted?.yaw ?? this.rig.moveYaw) : this.rig.moveYaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: InteractionTarget | null = null, bestScore = Infinity;
    for (const t of s.interactionTargets) {
      const dx = t.pos.x - p.x, dz = t.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > 3.4) continue;
      const cos = d > 0.05 ? (dx * fx + dz * fz) / d : 1;
      // A locked target the player is already attending to wins; people are preferred over things at similar range.
      const locked = this.controller.lockedBodyId !== null && t.targetId === this.controller.lockedBodyId ? 4 : 0;
      let hovered = false;
      if (this.rig.isometric && this.input.pointer.active) {
        const rect = this.ctx.canvas.getBoundingClientRect();
        const projected = Vector3.Project(this.regions.toRender(t.pos), Matrix.Identity(), this.ctx.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.ctx.engine.getRenderWidth(), this.ctx.engine.getRenderHeight()));
        const px = projected.x * rect.width / this.ctx.engine.getRenderWidth() + rect.left, py = projected.y * rect.height / this.ctx.engine.getRenderHeight() + rect.top;
        hovered = projected.z >= 0 && projected.z <= 1 && Math.hypot(px - this.input.pointer.x, py - this.input.pointer.y) < 55;
      }
      const score = d + (1 - cos) * 1.4 - (hovered ? 5 : 0) - (this.focus.target?.actionId === t.actionId ? 0.45 : 0) - (t.kind === 'person' ? 0.35 : 0) - locked;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    let refusal: string | null = null;
    if (!best) { const r = s.talkRefusals[0]; if (r && r.distance < 3.2) refusal = `${r.name} is ${TALK_REASON[r.reason] ?? r.reason}`; }
    this.focus = { target: best, refusal };
  }

  // ── actions ──────────────────────────────────────────────────────────────────────────────────
  async act(request: Record<string, unknown>, label: string): Promise<void> {
    const r = await this.link.intent(request); const d = describeResult(r.result);
    this.hud.toast(r.result === 'accepted' ? `${label}.` : d.text, r.result === 'accepted' ? 'good' : d.tone === 'info' ? 'bad' : d.tone);
  }
  private async doInteract(): Promise<void> {
    // Pointer input can change between server snapshots; choose from the latest projection at activation.
    if (this.rig.isometric && this.snapshot) this.computeFocus(this.snapshot);
    const t = this.focus.target; if (!t) return;
    this.hintState.interacted = true;
    if (t.kind === 'person') { const r = await this.link.intent({ type: 'talk', targetBodyId: t.targetId }); if (r.result !== 'accepted') { const d = describeResult(r.result); this.hud.toast(d.text, 'bad'); } return; }
    const r = await this.link.intent({ type: 'interact', interactionId: t.actionId });
    const d = describeResult(r.result); this.hud.toast(r.result === 'accepted' ? t.label : d.text, r.result === 'accepted' ? 'good' : 'bad');
  }
  private async doHush(): Promise<void> {
    const t = this.controller.aimTarget(); if (!t) { this.hud.toast('Nothing to hush.', 'bad'); return; }
    const r = await this.link.intent({ type: 'hush', targetBodyId: t.bodyId }); const d = describeResult(r.result); this.hud.toast(d.text, d.tone === 'info' ? 'info' : d.tone);
  }
  private onCombatCommand(c: CombatIntent): void {
    this.audio.combat(c.kind === 'attack' ? (c.weight === 'heavy' ? 'heavy' : 'swing') : 'dodge');
    this.hintState.attacked = true; this.rig.setMode('combat'); const now = performance.now(); this.combatUntil = now + 5000;
    // Anticipation begins on this very frame; the server's own action (same command id) takes over once it exists.
    let moveId: string, weight: 'light' | 'heavy' = c.weight ?? 'light';
    if (c.kind === 'attack') {
      const chained = now - this.lastMove.atMs < 900;
      moveId = weight === 'heavy' ? (chained && this.lastMove.id === 'front_kick' ? 'round_kick' : 'front_kick') : (chained && this.lastMove.id === 'jab' ? 'cross' : 'jab');
      this.lastMove = { id: moveId, atMs: now };
    } else moveId = c.defend ?? 'sidestep';
    const t = predictedTiming(moveId, weight === 'heavy' && c.kind === 'attack');
    const own = this.actors.get(this.ownBodyId); const yaw = this.predictor.predicted?.yaw ?? 0;
    let dirLocal: { x: number; z: number } | undefined;
    if (c.direction) { const fx = -Math.sin(yaw), fz = -Math.cos(yaw), lx = -Math.cos(yaw), lz = Math.sin(yaw); dirLocal = { x: c.direction.x * lx + c.direction.z * lz, z: c.direction.x * fx + c.direction.z * fz }; }
    const defTotal = 0.24 + 0.12;
    this.actors.predict(this.ownBodyId, { commandId: c.commandId, moveId, weight, startedAtMs: now, kind: c.kind, ...(c.kind === 'attack' ? t : { prep: 0.06, active: defTotal - 0.06 - 0.12, recovery: 0.12 }), dirLocal, side: c.side });
    void own;
  }
  private pivotInPlant = false;
  private readonly governor = new QualityGovernor(); private governorAt = 0;
  private combatUntil = 0;
  private onLock(id: string | null): void { this.rig.setLock(null); void id; }

  private panelServices(): PanelServices {
    return {
      snapshot: () => this.snapshot, ownBody: () => this.own(),
      act: (r, l) => this.act(r, l),
      transfer: async (cid, iid, dir) => { const r = await this.link.intent({ type: 'container_transfer', containerId: cid, itemId: iid, direction: dir }); const d = describeResult(r.result); if (r.result !== 'accepted') this.hud.toast(d.text, 'bad'); },
      interact: async (id, label) => { const r = await this.link.intent({ type: 'interact', interactionId: id }); if (r.result === 'accepted') this.hud.toast(label, 'good'); else this.hud.toast(describeResult(r.result).text, 'bad'); },
      crouch: { get: () => this.controller.crouchToggled, toggle: () => { this.controller.crouchToggled = !this.controller.crouchToggled; } },
      practice: m => { this.link.sendCommand({ type: 'practice', mode: m }); this.hud.toast(`Practice: ${m}.`, 'info'); },
      close: () => this.modal.close(),
    };
  }
  openMenu(tab: 'items' | 'abilities' | 'journal'): void {
    this.audio.ui('open');
    if (this.phase !== 'playing') return;
    this.controller.release(); this.input.exitLock();
    const svc = this.panelServices();
    this.modal.open({ title: this.own()?.name ?? 'You', tabs: [itemsTab(svc), abilitiesTab(svc), journalTab(svc)], initialTab: tab,
      hints: [{ key: codeLabel('Tab', 'keyboard'), text: 'Abilities' }, { key: 'Esc', text: 'Close' }], onClose: () => this.afterModal(),
      footer: f => f.append(h('button', { class: 'tv-btn', type: 'button', on: { click: () => this.modal.close() } }, 'Close')) });
  }
  openPause(): void {
    this.audio.ui('open');
    if (this.phase !== 'playing' || this.modal.isOpen) return;
    this.controller.release(); this.input.exitLock();
    const rerender = () => this.modal.refresh();
    const pauseTab = { id: 'pause', label: 'Pause', render: (b: HTMLElement) => add(b,
      h('p', { class: 'tv-sub', text: 'The world does not pause. People go on with their day around you.' }),
      h('div', { class: 'tv-menu' },
        h('button', { class: 'tv-btn primary', type: 'button', 'data-autofocus': '1', on: { click: () => this.modal.close() } }, 'Resume'),
        h('button', { class: 'tv-btn', type: 'button', on: { click: () => void this.saveNow() } }, 'Save the world now'),
        h('button', { class: 'tv-btn', type: 'button', on: { click: () => { this.modal.close(false); this.link.disconnect(); this.link.connect(this.link.hello ? { kind: 'existing', personId: this.link.hello.playerId } : { kind: 'auto' }); this.phase = 'connecting'; this.loading = loadingScreen(this.overlay, 'Reconnecting…'); this.screen = this.loading as { remove(): void }; this.regions.regions.forEach((_, id) => this.regions.unload(id)); this.actors.clear(); this.predictor.reset(); } } }, 'Reconnect'),
        h('button', { class: 'tv-btn', type: 'button', on: { click: () => this.openAbout() } }, 'About this build'),
        h('button', { class: 'tv-btn danger', type: 'button', on: { click: () => { this.modal.close(false); this.link.disconnect(); this.showTitle(); } } }, 'Return to title'))) };
    const svc = { get: () => this.settings, update: (p: Partial<Settings>) => this.updateSettings(p), input: this.input, rendererName: () => this.ctx.kind === 'webgpu' ? 'WebGPU' : 'WebGL 2 (reduced effects)', reset: () => { this.settings = structuredClone(DEFAULT_SETTINGS); saveSettings(this.settings); this.applyUiSettings(); } };
    this.modal.open({ title: 'Paused', tabs: [pauseTab, ...settingsTabs(svc, rerender)], initialTab: 'pause', onClose: () => this.afterModal(), hints: [{ key: 'Q / E', text: 'Switch tab' }, { key: 'Esc', text: 'Resume' }] });
  }
  openSettings(tab: string): void {
    if (this.modal.isOpen) return;
    const rerender = () => this.modal.refresh();
    const svc = { get: () => this.settings, update: (p: Partial<Settings>) => this.updateSettings(p), input: this.input, rendererName: () => this.ctx.kind === 'webgpu' ? 'WebGPU' : 'WebGL 2 (reduced effects)', reset: () => { this.settings = structuredClone(DEFAULT_SETTINGS); saveSettings(this.settings); this.applyUiSettings(); } };
    this.modal.open({ title: 'Settings', tabs: settingsTabs(svc, rerender), initialTab: tab, onClose: () => undefined, hints: [{ key: 'Q / E', text: 'Switch tab' }, { key: 'Esc', text: 'Back' }] });
  }
  private async saveNow(): Promise<void> { const r = await this.link.requestSave(); this.hud.toast(r.result === 'saved' || r.result === 'accepted' ? 'The world is saved.' : describeResult(r.result).text, r.result === 'saved' || r.result === 'accepted' ? 'good' : 'bad'); }
  private afterModal(): void { this.ignoreEscUntil = performance.now() + 250; if (this.phase === 'playing' && this.input.device === 'keyboard' && !this.dialogue.isOpen) queueMicrotask(() => this.input.requestLock()); }

  // ── hints ────────────────────────────────────────────────────────────────────────────────────
  private updateHints(): void {
    if (!this.settings.showHints || this.phase !== 'playing') { this.hud.setHints([]); return; }
    const k = (a: Parameters<InputManager['promptCode']>[0]) => codeLabel(this.input.promptCode(a), this.input.device);
    const lines: { key: string; text: string }[] = [];
    if (!this.hintState.moved) lines.push({ key: this.input.device === 'keyboard' ? 'WASD' : 'Left stick', text: 'Move' });
    if (this.rig.orbit) lines.push({ key: 'Middle drag', text: 'Orbit / tilt · Wheel zoom · F target · H strike · Space dodge' });
    if (this.rig.isometric) lines.push({ key: 'Wheel', text: 'Zoom · F target · E interact · H strike · B guard · Space dodge' });
    if (!this.rig.cutaway && !this.hintState.looked) lines.push({ key: this.input.device === 'keyboard' ? 'Mouse' : 'Right stick', text: 'Look around' });
    if (this.focus.target && !this.hintState.interacted) lines.push({ key: k('interact'), text: 'Interact' });
    if (this.hintState.moved && this.hintState.looked && this.hintState.interacted && !this.hintState.attacked) lines.push({ key: k('journal'), text: 'Journal' });
    this.hud.setHints(lines.slice(0, 3));
  }

  // ── frame ────────────────────────────────────────────────────────────────────────────────────
  private frame(): void {
    const now = performance.now(), dtRaw = (now - this.lastFrame) / 1000; this.lastFrame = now; this.frameMs.push(dtRaw * 1000); noteSlow('frame gap', dtRaw * 1000, 45); if (this.frameMs.length > 4000) this.frameMs.shift();
    const dt = Math.min(0.1, dtRaw);
    this.input.beginFrame(dt);
    this.regions.pump(this.phase === 'playing' ? 6 : 40);
    if (this.phase === 'playing' && this.settings.quality === 'auto' && now - this.governorAt > 2000) { this.governorAt = now; this.runGovernor(now); } // stream regions in slices; a long load is fine behind the loading screen, in play it must not hitch
    const wasOpen = this.modal.isOpen;
    if (this.nav.open) this.nav.update();
    if (this.phase === 'connecting') this.tryEnter();
    if (this.showroom) { this.showroom.update(dt); this.ctx.scene.render(); return; }
    if (this.phase === 'playing') { this.gameFrame(dt, now, wasOpen); this.portrait.update(dt); }
    else this.backdropFrame(dt);
    timed('render', () => this.ctx.scene.render(), 12);
    if (!this.ready && this.phase === 'playing' && this.regions.regions.size >= (this.params.has('gym')||this.params.has('observatory') ? 1 : 5) && this.regions.pendingBuilds === 0 && ++this.readyFrames > 30) this.ready = true;
    if (this.params.get('replay') && !this.ready && this.regions.regions.size >= (this.params.has('gym')||this.params.has('observatory') ? 1 : 5) && this.snapshot && ++this.readyFrames > 30) this.ready = true;
  }
  private backdropFrame(dt: number): void {
    // Title/loading backdrop: a slow orbit over whatever is loaded, at golden hour.
    this.titleOrbit += dt * 0.05;
    const p = this.predictor.predicted?.pos;
    if (p) { const pivot = { x: p.x - this.regions.origin.x, y: p.y + 2.2, z: p.z - this.regions.origin.z }; this.rig.yaw = this.titleOrbit; this.rig.pitch = 0.22; this.rig.distance = 16; this.rig.update(dt, pivot, 0); }
    else { this.camera.position.set(0, 60, 0); this.camera.setTarget(new Vector3(0, 55, -100)); }
    this.atmosphere.update(this.params.get('hour') ? Number(this.params.get('hour')) : 17.6, this.regions.weather, dt);
    this.atmosphere.follow(this.camera.position);
    this.regions.update(dt, this.camera.position, this.camera.getForwardRay(1).direction, 1 - this.atmosphere.daylight);
    this.actors.update(dt, performance.now(), null);
  }
  private gameFrame(dt: number, now: number, wasOpen: boolean): void {
    const inp = this.input, s = this.snapshot, own = this.own();
    // Global actions.
    const menuFree = !this.modal.isOpen && !wasOpen && !this.screen;
    if (menuFree && !this.dialogue.isOpen) {
      if (inp.pressed('pause') && now > this.ignoreEscUntil) this.openPause();
      else if (inp.pressed('abilities')) this.openMenu('abilities');
      else if (inp.pressed('items')) this.openMenu('items');
      else if (inp.pressed('journal')) this.openMenu('journal');
    } else if (menuFree && this.dialogue.isOpen) {
      if ((inp.pressed('pause') && now > this.ignoreEscUntil) || inp.pressed('uiBack')) this.dialogue.requestClose();
    }
    const acting = menuFree && !this.dialogue.isOpen && !own?.dead;
    if (acting) {
      if (inp.pressed('interact')) void this.doInteract();
      if (inp.pressed('hush')) void this.doHush();
      if (inp.pressed('quickItem')) this.openMenu('items');
      if (this.dialogue.isOpen === false && (inp.look.x || inp.look.y)) { this.rig.addLook(inp.look.x, inp.look.y); this.hintState.looked = true; }
      if (inp.wheel) this.rig.zoom(inp.wheel);
    }
    // Talk camera.
    const partner = this.speakerPos();
    if (this.dialogue.isOpen && partner) { this.rig.setMode('talk'); this.rig.setTalk({ x: partner.x - this.regions.origin.x, y: partner.y - this.regions.origin.y + 1.5, z: partner.z - this.regions.origin.z }); }
    else if (now < this.combatUntil || this.controller.guardHeld || this.controller.lockedBodyId) { this.rig.setMode('combat'); this.rig.setTalk(null); }
    else { this.rig.setMode('explore'); this.rig.setTalk(null); }
    // Movement, prediction and commands.
    if (this.rig.isometric && this.input.pointer.active && this.predictor.predicted) {
      const rect = this.ctx.canvas.getBoundingClientRect(), p = this.predictor.predicted.pos;
      const ray = this.ctx.scene.createPickingRay((inp.pointer.x - rect.left) * this.ctx.engine.getRenderWidth() / rect.width, (inp.pointer.y - rect.top) * this.ctx.engine.getRenderHeight() / rect.height, Matrix.Identity(), this.camera);
      const distance = ray.intersectsPlane(new Plane(0, 1, 0, -(p.y - this.regions.origin.y)));
      if (distance !== null && distance >= 0) { const at = ray.origin.add(ray.direction.scale(distance)); this.rig.aimYaw = Math.atan2(-(at.x + this.regions.origin.x - p.x), -(at.z + this.regions.origin.z - p.z)); }
    }
    this.controller.update(dt);
    if (this.controller.moving) this.hintState.moved = true;
    // Own body.
    const vis = this.predictor.visual();
    const lock = this.controller.lockedBodyId ? this.candidates().find(c => c.bodyId === this.controller.lockedBodyId) : undefined;
    this.rig.setLock(lock ? { x: lock.pos.x - this.regions.origin.x, y: lock.pos.y + 1.2 - this.regions.origin.y, z: lock.pos.z - this.regions.origin.z } : null);
    this.actors.update(dt, now, vis && this.ownBodyId ? { bodyId: this.ownBodyId, pos: vis.pos, yaw: vis.yaw, crouch: vis.crouch } : null);
    // Camera.
    if (vis) {
      const eye = own?.embodiment?.activity.posture === 'sit' ? 1.05 : own?.embodiment?.activity.posture === 'lie' ? 0.5 : 1.55;
      this.rig.pivotDrop = (INTERACTION_SPEC.height - INTERACTION_SPEC.duckHeight) * vis.crouch * 0.9;
      // Decorative plants are not collision in the simulation, so the player can stand inside one; the camera then ignores plants this frame instead of collapsing onto the head.
      this.pivotInPlant = this.regions.plantAt(vis.pos.x, vis.pos.y + 0.5, vis.pos.z) || this.regions.plantAt(vis.pos.x, vis.pos.y + eye, vis.pos.z);
      this.rig.situation = this.cameraSituation(dt, vis.pos);
      this.rig.update(dt, { x: vis.pos.x - this.regions.origin.x, y: vis.pos.y - this.regions.origin.y + eye, z: vis.pos.z - this.regions.origin.z }, vis.yaw);
    }
    this.regions.updateCutaway(this.rig.cutaway ? vis?.pos ?? null : null, this.camera.position);
    // World.
    const hour = this.params.get('hour') ? Number(this.params.get('hour')) : ((this.regions.worldTime / 3600) % 24 + 24) % 24;
    this.atmosphere.update(hour, this.regions.weather, dt); this.atmosphere.follow(this.camera.position);
    if (this.params.has('gym') && this.params.get('scenario') !== 'town') { this.atmosphere.setStage(new Color3(.84, .86, .88)); this.atmosphere.key.diffuse = Color3.White(); this.atmosphere.fill.diffuse = Color3.White(); this.atmosphere.fill.groundColor = new Color3(.45, .45, .45); }
    this.grass.tint(this.atmosphere.daylight);
    this.grass.animate(dt, this.regions.weather.wind, this.settings.reducedMotion);
    this.grass.update(this.camera.position.x + this.regions.origin.x, this.camera.position.z + this.regions.origin.z);
    this.regions.update(dt, this.camera.position, this.rig.forward, 1 - this.atmosphere.daylight);
    if (this.controller.lockedBodyId === null && now > this.combatUntil && this.rig.mode === 'combat') this.rig.setMode('explore');
    this.weatherFx.update(this.camera.position, this.regions.weather.kind, this.regions.weather.intensity);
    this.audioFrame(dt, now);
    // HUD (10 Hz).
    if (now - this.lastHudAt > 100 && s) { this.lastHudAt = now; this.updateHud(s, own); }
  }
  private audioFrame(dt: number, now: number): void {
    const vis = this.predictor.predicted; if (!vis) return;
    const place = this.regions.placeAt(vis.pos.x, vis.pos.y, vis.pos.z), indoor = place.kind === 'building';
    const fires = (this.regions as unknown as { fireCountNear?: (x: number, z: number) => number }).fireCountNear?.(vis.pos.x, vis.pos.z) ?? 0;
    const hour = ((this.regions.worldTime / 3600) % 24 + 24) % 24, w = this.regions.weather;
    // Footfalls by distance travelled: one per stride.
    const cur = { x: vis.pos.x, z: vis.pos.z };
    if (this.lastStepPos) { const d = Math.hypot(cur.x - this.lastStepPos.x, cur.z - this.lastStepPos.z); if (d < 3) this.stepDist += d; }
    this.lastStepPos = cur;
    const running = this.controller.sprintHeld, stride = running ? 1.5 : 0.85;
    const g = this.regions.groundAt(cur.x, cur.z) !== null ? this.regions.blockAt?.(cur.x, cur.z) ?? 1 : 1;
    const near: 'grass' | 'stone' | 'wood' | 'dirt' | 'water' = indoor ? 'wood' : g === 3 || g === 4 ? 'stone' : g === 2 || g === 15 ? 'dirt' : 'grass';
    if (this.stepDist >= stride) { this.stepDist = 0; this.audio.footstep(near, running ? 1.3 : 0.8); }
    this.audio.update(dt, { hour, weather: w.kind, wind: w.wind, indoor, fires, near });
    if (this.dialogue.isOpen && now > this.nextBlip) { this.audio.speechBlip(170 + (this.speakerPos() ? 40 : 0)); this.nextBlip = now + 140 + Math.random() * 120; }
  }
  private updateHud(s: SnapshotMessage, own: BodyState | null): void {
    if (!own) return;
    const cond = s.journal.condition;
    this.hud.setVitals({ health: own.health ?? 1, maxHealth: own.maxHealth ?? 1, effort: 1 - cond.fatigue, hunger: own.needs?.hunger ?? 0, thirst: own.needs?.thirst ?? 0, tiredness: own.needs?.energy ?? 0, wealth: own.wealth ?? 0 });
    const place = this.regions.placeAt(own.pos.x, own.pos.y, own.pos.z);
    this.hud.setPlace(place.kind === 'building' ? titleCase(place.type) : place.kind === 'settlement' ? 'Settlement' : 'Open country', s.worldTime, this.regions.weather.kind);
    const rtt = (this.link as GameLink).rttMs; this.hud.setNet(this.link.status === 'live' ? rtt > 250 ? 'Connection delayed' : '' : 'Reconnecting…', this.link.status !== 'live' || rtt > 250);
    const t = this.focus.target, k = codeLabel(this.input.promptCode('interact'), this.input.device);
    if (this.dialogue.isOpen || this.modal.isOpen) this.hud.setPrompt(null);
    else if (t) this.hud.setPrompt({ keyLabel: k, text: t.label });
    else if (this.focus.refusal) this.hud.setPrompt({ keyLabel: '', text: this.focus.refusal });
    else this.hud.setPrompt(null);
    const lock = this.controller.lockedBodyId ? this.candidates().find(c => c.bodyId === this.controller.lockedBodyId) : undefined;
    this.hud.setTarget(lock ? { name: titleCase(lock.name), note: lock.hostile ? 'On guard' : undefined } : null);
    this.updateHints();
    void this.moveTimer;
  }

  // ── evidence helpers ─────────────────────────────────────────────────────────────────────────
  get slowEvents() { return slowEvents(); }
  /** With quality on auto: sustained slow frames step the renderer down a tier (or its scale). Never steps up. */
  private runGovernor(now: number): void {
    const recent = this.frameMs.slice(-120); if (recent.length < 60 || document.hidden || this.regions.pendingBuilds || !this.ready || this.params.has('quality')) return;
    const a = [...recent].sort((x, y) => x - y), median = a[a.length >> 1], p95 = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
    const act = this.governor.evaluate(median, p95, now, this.ctx.quality.tier);
    if (!act) return;
    if ('tier' in act) { this.ctx.setQuality(act.tier); this.regions.lights.setSize(this.ctx.quality.maxLights); this.hud.toast(`Frame rate was low, so graphics were lowered to "${act.tier}". You can change this in Settings.`, 'info', 6000); }
    else { this.ctx.engine.setHardwareScalingLevel(1 / act.scale); this.hud.toast('Frame rate was low, so the render resolution was lowered. You can change this in Settings.', 'info', 6000); }
  }
  perfReset(): void { this.frameMs.length = 0; }
  perfReport(): { frames: number; medianMs: number; p95Ms: number; p99Ms: number; maxMs: number; fpsMedian: number } {
    const a = [...this.frameMs].sort((x, y) => x - y), q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    return { frames: a.length, medianMs: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: a[a.length - 1] ?? 0, fpsMedian: a.length ? 1000 / q(0.5) : 0 };
  }
}
void Color3;
