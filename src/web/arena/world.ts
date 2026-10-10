import {FootPlant} from './footPlant';
import { Color3, Color4, Matrix, Mesh, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type AbstractMesh, type InstancedMesh, type Scene } from '@babylonjs/core';
import type { ArenaAssets, CharacterInstance } from './assets';
import type { LookId } from './looks';
import { Animator } from './anim';
import { ALLIES, DODGES, FOES, MOVESETS, RELAXED, WEAPONS, waveRoster, type AttackDef, type FoeDef, type FoeKind, type Moveset, type WeaponId } from './combat';
import { Debris } from './debris';
import { BlobShadows, Fx, SlashTrail } from './fx';
import { mulberry } from '../render/noise';
import { reach } from './ik';
import { SIGNS, cloneSkill, type SkillDef } from './tower/skills';
import { Vfx, elementLook, type Handle } from './vfx';
import { ELEMENT_INFO, LEY_BONUS } from './magic';
import type { Element } from './tower/capability';
import { NavGrid } from './nav';
import type { Sfx } from './sfx';

/**
 * The Combat Arena simulation: a local, disposable action-combat feel lab. It is deliberately NOT
 * canonical Torn Veil simulation (no World, no bridge, no persistence): it exists to tune how
 * striking, smashing and crowds feel, the way the reference combat gym videos do.
 */
const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const turnTo = (from: number, to: number, rate: number) => { const d = wrap(to - from); return from + clamp(d, -rate, rate); };
const fwd = (yaw: number) => new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
/** Half-size of the playable floor; the perimeter walls' inner faces sit at ARENA + 1. */
export let ARENA = 34;
/** Resize the playable floor (tower floors grow every 25 levels). */
export function setArenaHalf(h: number): void { ARENA = h; }
/** Seconds a dodge lasts (clip is played to fit). */
const DODGE_TIME = .55, ROLL_TIME = .82;

export type FState = 'spawn' | 'idle' | 'move' | 'tell' | 'attack' | 'spin' | 'guard' | 'aim' | 'dodge' | 'hit' | 'down' | 'revive' | 'dead' | 'cast';
export type Role = 'hero' | 'ally' | 'foe';

export interface HeroInput {
  move: { x: number; z: number };
  aim: Vector3;
  attack: boolean; attackPressed: boolean;
  secondary: boolean;
  /** Hold to sprint (Shift / left stick click). */
  sprint: boolean;
  /** Heavy attack (RMB): press starts, hold charges, release unleashes. */
  heavyPressed: boolean; heavyReleased: boolean;
  /** Skill slot cast this frame (0-6, or -1). */
  cast: number;
  /** Read the top scroll (G; tower). */
  scroll?: boolean;
  /** Hold to guard (F). */
  guard: boolean;
  /** Drink a flask (Q). */
  flask: boolean;
  /** Cycle to the next drawn weapon (Tab). */
  cycle: boolean;
  dodgePressed: boolean;
  interact: boolean;
  weapon: WeaponId | null;
}

const POSTURE = new WeakMap<TransformNode, { pre: Quaternion; post: Quaternion }>();

export class Fighter {
  pos = new Vector3(); yaw = 0; vel = new Vector3(); y = 0; vy = 0;
  state: FState = 'idle'; st = 0;
  atk: AttackDef | null = null; atkT = 0; atkHits = new Map<object, number>(); combo = 0; queued = false; atkDir = 0;
  iframe = 0; flash = 0; lastHurt = -99; hpShown: number;
  radius = .65; alive = true; deadT = 0; reviveT = 0;
  cd = 1; target: Fighter | null = null; strafe = 1; think = 0; cancelTell: (() => void) | null = null; aimLine: Mesh | null = null;
  energy = 100; energyDelay = 0;
  /** Off hand pulled onto the grip of a two-handed weapon. */
  twoHand = false; ikW = 0;
  /** Out of combat: relaxed walk and idle, weapon slung on the back. */
  relaxed = false; sheathed = false; alertT = 0;
  /** Smoothed locomotion velocity, turn rate and body lean (presentation of weight). */
  mvel = new Vector3(); turnRate = 0; lean = 0; pitch = 0; dodgeTime = .55;
  /** Tower: per-fighter outgoing damage scale, boss identity, burning and chill. */
  dmgMul = 1; boss: { name: string } | null = null; burnT = 0; burnDps = 0; slowT = 0;
  /** Elemental statuses: soaked, frozen solid, shocked (stunned), time-slowed (with stored hits), gathered by gravity, armour shredded. */
  wetT = 0; frozenT = 0; shockT = 0; timeT = 0; ruptureHits = 0; gatherT = 0; shredT = 0;
  /** Mana (hero): spells spend it; it flows back with mana control and the floor's ley. */
  mana = 100; maxMana = 100;
  /** Height floated above the ground (the god's avatar never touches it). */
  hover = 0;
  /** A god's body: takes only this share of damage, never staggers, shrugs statuses off. */
  god = false; godArmor = 1;
  /** Status visuals currently shown on this body. */
  statusFx = new Map<string, Handle>();
  /** Heavy attacks: charging while RMB is held at the wind-up; which heavy in the chain. */
  charging = false; charge = 0; heavyIdx = -1; healT = 0; castDef: SkillDef | null = null; spellDone = false; dashHit = new Set<Fighter>();
  /** Foot planting: world-space lock per foot (l, r) and its blend weight. */
  feet = [{ lock: null as Vector3 | null, w: 0, yaw: 0 }, { lock: null as Vector3 | null, w: 0, yaw: 0 }];
  /** Standing ankle height above the fighter's ground (measured once in the rest pose). */
  ankleY = -1;
  trail: SlashTrail | null = null; extra: InstancedMesh[] = [];
  label = 'Idle';
  constructor(readonly id: number, readonly role: Role, readonly name: string, readonly inst: CharacterInstance, readonly anim: Animator,
    public hp: number, public maxHp: number, public speed: number, readonly foe?: FoeDef, readonly foeKind?: FoeKind) { this.hpShown = hp; }
  get team(): 'hero' | 'foe' { return this.role === 'foe' ? 'foe' : 'hero'; }
  get busy(): boolean { return this.state === 'attack' || this.state === 'tell' || this.state === 'dodge' || this.state === 'hit' || this.state === 'spawn' || this.state === 'revive'; }
  get standing(): boolean { return this.alive && this.state !== 'down' && this.state !== 'dead'; }
}

export interface Prop {
  key: string; mesh: InstancedMesh; pos: Vector3; yaw: number; scale: number;
  hx: number; hz: number; h: number; round: boolean;
  hp: number; broken: boolean; wobble: number; loose: boolean; on: Prop[]; blob: InstancedMesh | null;
  /** Unbreakable structure (ruin walls). */ solid?: boolean;
  /** Drops loot when broken open. */ chest?: boolean;
}
interface Shot { mesh: AbstractMesh; pos: Vector3; vel: Vector3; owner: Fighter; dmg: number; knock: number; life: number; kind: 'bolt' | 'orb'; pierce: number; hit: Set<object> }

export interface ArenaEvents {
  damage(pos: Vector3, amount: number, kind: 'hit' | 'crit' | 'block' | 'hurt' | 'heal'): void;
  kill(f: Fighter): void;
  levelUp(level: number): void;
  wave(n: number, count: number): void;
  heroDown(): void;
  sound(kind: Sfx, gain?: number): void;
  /** A reaction or status word over a body (FREEZE, ELECTROCUTE, SHATTER...). */
  word?(pos: Vector3, text: string, color: string): void;
}

const PROP_DEF: Record<string, { scale: number; hp: number; round?: boolean; inset?: number }> = {
  barrel: { scale: 0.81, hp: 2, round: true }, barrel_small: { scale: 1.17, hp: 1, round: true }, keg: { scale: 0.78, hp: 2, round: true },
  crate: { scale: 0.94, hp: 2 }, crate_small: { scale: 1.04, hp: 1 }, trunk: { scale: 1.69, hp: 1 },
  table_long: { scale: 1.17, hp: 3 }, table: { scale: 1.17, hp: 3 }, table_small: { scale: 1.17, hp: 2 },
  chair: { scale: 1.3, hp: 1 }, stool: { scale: 1.3, hp: 1 }, shelf: { scale: 1.3, hp: 1 },
  pot: { scale: 1.76, hp: 1, round: true }, jar: { scale: 1.69, hp: 1, round: true },
};

export class ArenaWorld {
  fighters: Fighter[] = [];
  hero!: Fighter;
  props: Prop[] = [];
  shots: Shot[] = [];
  readonly debris = new Debris();
  readonly fx: Fx;
  time = 0; hitstop = 0;
  combo = { hits: 0, timer: 0 };
  get comboMul(): number { return Math.min(2, 1 + Math.floor(this.combo.hits / 10) * .1); }
  xp = 0; level = 1; nextXp = 100;
  wave = 0; waveTimer = 3; kills = 0; smashed = 0;
  weapon: WeaponId = 'fists';
  companions = true;
  /** Sandbox by default (a movement/combat test bench): enemies come only when asked (N), unless auto waves are on (M). */
  autoWaves = false;
  /** Upgrades chosen on level-up. */
  mods = { damage: 1, atkSpeed: 1, move: 1, regen: 1, range: 1 };
  /** Passive multipliers from capability (affinities, emerged class); kept apart from level-up choices. */
  bonus = { damage: 1, atkSpeed: 1, move: 1, maxHpUpgrades: 1 };
  showLabels = false;
  /** Weapon slots the hero can draw (the tower starts with fists only). */
  unlocked = new Set<WeaponId>(['fists', 'greatsword', 'axe', 'bow']);
  /** Tower overrides: the mesh drawn for a slot, its damage scale, hero armour. */
  weaponMesh: Partial<Record<WeaponId, { mesh: string; hand: 'l' | 'r' }>> = {};
  weaponMul: Partial<Record<WeaponId, number>> = {};
  armor = 0;
  /** Slow out-of-combat trickle (sandbox only; the tower turns it off). */
  passiveRegen = true;
  /**
   * Skill slots (keys 1..6). The sandbox holds the four signs; the tower fills slots from what the climber
   * absorbed (essences), read (skill books) and became (class signatures). Ward pool and sigils on the floor.
   */
  skills: (SkillDef | null)[] = SIGNS.map(cloneSkill);
  skillCd: number[] = [0, 0, 0, 0, 0, 0, 0];
  wardHp = 0; wardT = 0;
  /** Gear on the hero (tower affixes): crit chance, life leech (fraction of damage), cooldown reduction, thorns. */
  gearStats = { crit: .12, leech: 0, cdr: 0, thorns: 0 };
  /** Blood Frenzy / Iron Body: timed damage and attack-speed buff. */
  frenzyT = 0; frenzyP = 0; frenzyLeech = 0;
  /** Tower hooks: a skill was cast (return true to refund its cooldown), a parry landed. */
  onCast: ((s: SkillDef) => boolean | void) | null = null;
  onParry: (() => void) | null = null;
  parries = 0;
  /** Review aids: hold foes still (lineups), switch the creature posture layer. */
  freezeFoes = false; postureOn = true;
  /** Last cursor bearing from the hero (scrolls cast toward it). */
  aimYaw = 0;
  /** Elemental effects (particles, glow, lights). */
  readonly vfx: Vfx;
  /** The floor's ley element: its spells are stronger and mana flows faster here (mechanical truth). */
  ley: Element | null = null;
  /** Weave spells and elixirs: the drawn weapon carries an element for a while; runestones set one permanently per slot. */
  imbue: { e: Element; t: number; p: number } | null = null; weaponImbue: Partial<Record<WeaponId, Element>> = {};
  private imbueFx: Handle | null = null; private imbueFxKey = '';
  /** Potion effects (seconds left). */
  potion = { haste: 0, might: 0, stone: 0, clarity: 0 };
  /** Mana control (tower capability) speeds the flow of mana back. */
  manaControl = 0;
  /** Elemental wards: the element of the active ward answers attackers; Rewind keeps a little history of health. */
  wardEl: Element | null = null; private hpHistory: number[] = []; private histT = 0; regenT = 0; veilT = 0;
  /** Lasting fields (Field spells, sigils) and magic missiles (Bolt spells). */
  fields: { x: number; z: number; r: number; t: number; p: number; e: Element; tick: number; owner: Fighter; fx: Handle }[] = [];
  private missiles: { pos: Vector3; vel: Vector3; e: Element; p: number; owner: Fighter; life: number; fx: Handle; hit: Set<Fighter>; pierce: number; dmg: number }[] = [];
  private inSkill = false;
  private wordAt = new Map<string, number>();
  /** Fighters run by a custom controller (the god's avatar) instead of the foe AI. */
  readonly customAI = new Map<Fighter, (f: Fighter, dt: number) => boolean | void>();
  /** Called instead of killing the hero (a god's trial spares the climber). */
  spareHero: (() => void) | null = null;
  private ignoreGuard = false;
  get heroMove(): number { return this.potion.haste > 0 ? 1.25 : 1; }
  get atkSpeed(): number { return this.mods.atkSpeed * this.bonus.atkSpeed * (this.frenzyT > 0 ? 1 + .2 * this.frenzyP : 1) * (this.potion.haste > 0 ? 1.25 : 1) * (this.imbue?.e === 'time' ? 1.3 : 1); }
  /** Flasks (Q): charges and max; the tower refills them per floor. */
  flasks = 3; flaskMax = 3;
  /** Foe scaling for the current floor. */
  foeHpMul = 1; foeDmgMul = 1;
  onHeroHit: ((t: Fighter, dmg: number, crit: boolean) => void) | null = null;
  onChest: ((p: Vector3) => void) | null = null;
  /** Walkable-grid navigation around ruin walls (tower floors); null when the floor is open. */
  nav: NavGrid | null = null;
  private wallSrc: Mesh | null = null; private wallMat: StandardMaterial | null = null;
  private serial = 0;
  private rnd = mulberry(918271);
  private boltMat: StandardMaterial; private orbMat: StandardMaterial; private lineMat: StandardMaterial;
  private bladeBase!: TransformNode; private bladeTip!: TransformNode;

  constructor(private readonly scene: Scene, private readonly assets: ArenaAssets, private readonly shadow: BlobShadows, private readonly ev: ArenaEvents) {
    this.fx = new Fx(scene); this.vfx = new Vfx(scene);
    this.boltMat = new StandardMaterial('bolt-glow', scene); this.boltMat.emissiveColor = new Color3(1, .85, .5); this.boltMat.disableLighting = true;
    this.orbMat = new StandardMaterial('orb', scene); this.orbMat.emissiveColor = new Color3(.75, .35, 1); this.orbMat.disableLighting = true; this.orbMat.alpha = .9;
    this.lineMat = new StandardMaterial('aim-line', scene); this.lineMat.emissiveColor = new Color3(1, .15, .1); this.lineMat.disableLighting = true; this.lineMat.alpha = .55;
  }

  // ------------------------------------------------------------------ setup
  reset(seed: number): void {
    for (const f of this.fighters) this.removeFighter(f);
    for (const p of this.props) { p.mesh.dispose(); p.blob?.dispose(); }
    for (const s of this.shots) s.mesh.dispose();
    this.fighters = []; this.props = []; this.shots = []; this.debris.clear();
    this.rnd = mulberry(seed); this.time = 0; this.combo = { hits: 0, timer: 0 };
    this.wave = 0; this.waveTimer = 2.5; this.kills = 0; this.smashed = 0;
    this.layoutProps();
    this.hero = this.spawnHero();
    if (this.companions) this.spawnCompanions();
  }

  /** Tower floor: clear everything but the hero (and companions), then build the floor plan. */
  loadFloor(spec: { seed: number; half: number; wallColor: [number, number, number]; walls: { x: number; z: number; len: number; yaw: number }[];
    props: { key: string; x: number; z: number; yaw: number }[]; chests: { x: number; z: number; yaw: number }[]; start: { x: number; z: number };
    foes: { kind: FoeKind; x: number; z: number }[]; boss?: { kind: FoeKind; name: string; x: number; z: number; hpMul: number; dmgMul: number; scale: number } }): void {
    for (const f of this.fighters) if (f.role === 'foe') this.removeFighter(f);
    this.fighters = this.fighters.filter(f => f.role !== 'foe');
    for (const p of this.props) { p.mesh.dispose(); p.blob?.dispose(); }
    for (const sh of this.shots) sh.mesh.dispose();
    this.props = []; this.shots = []; this.debris.clear();
    setArenaHalf(spec.half); this.rnd = mulberry(spec.seed); this.wave = 0; this.combo = { hits: 0, timer: 0 };
    this.wallMaterial().diffuseColor.set(...spec.wallColor);
    for (const w of spec.walls) this.placeWall(w.x, w.z, w.len, w.yaw);
    this.nav = spec.walls.length ? new NavGrid(spec.half, this.props.filter(p => p.solid).map(p => ({ x: p.pos.x, z: p.pos.z, hx: p.hx, hz: p.hz, yaw: p.yaw }))) : null;
    for (const p of spec.props) if (PROP_DEF[p.key]) this.place(p.key, p.x, p.z, p.yaw);
    for (const c of spec.chests) { const p = this.place('trunk', c.x, c.z, c.yaw); p.chest = true; p.hp = 2; }
    const h = this.hero; h.pos.set(spec.start.x, 0, spec.start.z); h.vel.setAll(0); h.mvel.setAll(0); h.yaw = Math.PI; h.inst.springs?.reset();
    this.fighters.filter(f => f.role === 'ally').forEach((a, i) => { a.pos.set(spec.start.x + (i ? 2.5 : -2.5), 0, spec.start.z + 1.5); a.inst.springs?.reset(); });
    for (const e of spec.foes) this.spawnFoe(e.kind, e.x, e.z);
    if (spec.boss) {
      const b = spec.boss, f = this.spawnFoe(b.kind, b.x, b.z, b.kind === 'orc' ? 'orc_chief' : undefined);
      f.maxHp = f.hp = Math.round(f.hp * b.hpMul); f.hpShown = f.hp; f.dmgMul *= b.dmgMul; f.boss = { name: b.name };
      f.inst.root.scaling.scaleInPlace(b.scale); f.radius *= b.scale; f.speed *= .9;
    }
  }

  private wallMaterial(): StandardMaterial {
    if (!this.wallMat) { this.wallMat = new StandardMaterial('ruin-wall', this.scene); this.wallMat.specularColor = Color3.Black(); }
    return this.wallMat;
  }
  /** A low ruined wall segment: blocks movement and shots, cannot be smashed. */
  private placeWall(x: number, z: number, len: number, yaw: number): void {
    if (!this.wallSrc) { this.wallSrc = MeshBuilder.CreateBox('ruin-wall', { size: 1 }, this.scene); this.wallSrc.material = this.wallMaterial(); this.wallSrc.position.y = -50; this.wallSrc.isPickable = false; }
    const H = 1.5, T = .7;
    const mesh = this.wallSrc.createInstance('wall'); mesh.position.set(x, H / 2, z); mesh.rotation.y = yaw; mesh.scaling.set(T, H, len + T * .5); mesh.isPickable = false;
    this.props.push({ key: 'wall', mesh, pos: new Vector3(x, 0, z), yaw, scale: 1, hx: T / 2, hz: len / 2 + T * .25, h: H, round: false, hp: Infinity, broken: false, wobble: 0, loose: false, on: [], blob: null, solid: true });
  }

  private place(key: string, x: number, z: number, yaw: number, y = 0, loose = false): Prop {
    const src = this.assets.sources.get((loose ? 'L_' : 'P_') + key)!;
    const d = loose ? { scale: 1, hp: 1, round: true } : PROP_DEF[key];
    const mesh = src.createInstance(`${key}-${this.props.length}`);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scaling.setAll(d.scale); mesh.isPickable = false;
    const bb = src.getBoundingInfo().boundingBox;
    const p: Prop = { key, mesh, pos: new Vector3(x, y, z), yaw, scale: d.scale, hx: bb.extendSize.x * d.scale * .92, hz: bb.extendSize.z * d.scale * .92, h: bb.extendSize.y * 2 * d.scale, round: !!d.round, hp: d.hp, broken: false, wobble: 0, loose, on: [], blob: null };
    if (!loose) p.blob = this.shadow.add(Math.max(p.hx, p.hz) * (p.round ? 2.6 : 2.9), null, p.pos);
    this.props.push(p);
    return p;
  }

  /** A dense prop field like the reference gym: table rows, crate stacks, barrel clusters and a forest of pots. */
  private layoutProps(): void {
    const r = this.rnd;
    const jitter = (a: number) => (r() - .5) * a;
    // Feast hall: long tables with chairs and tableware.
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const x = -14 + col * 7, z = -20 + row * 7;
      const t = this.place('table_long', x, z, Math.PI / 2 + jitter(.1));
      const top = t.h;
      for (let k = -1; k <= 1; k++) {
        if (r() < .75) t.on.push(this.place(['plate_a', 'plate_b', 'bottle_a', 'bottle_b', 'candle'][Math.floor(r() * 5)], x + k * 1.2 + jitter(.3), z + jitter(.4), r() * TAU, top, true));
        if (r() < .85) this.place('chair', x + k * 1.25, z - 1.75, 0 + jitter(.4));
        if (r() < .85) this.place('chair', x + k * 1.25, z + 1.75, Math.PI + jitter(.4));
      }
    }
    // Pot forest (the reference's dark vases), north-east.
    for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) if (r() < .8) this.place(r() < .7 ? 'pot' : 'jar', 8 + i * 2 + jitter(.6), -22 + j * 2.1 + jitter(.6), r() * TAU);
    // Barrels and kegs, south-west.
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) if (r() < .85) this.place(r() < .2 ? 'keg' : r() < .35 ? 'barrel_small' : 'barrel', -24 + i * 2.6 + jitter(.5), 12 + j * 2.6 + jitter(.5), r() * TAU);
    // Crate stacks and a wall of crates, south-east.
    for (let i = 0; i < 8; i++) this.place(i % 3 ? 'crate' : 'crate_small', 10 + i * 2 + jitter(.3), 16 + jitter(.3), jitter(.3));
    for (let i = 0; i < 10; i++) this.place(r() < .5 ? 'crate' : 'crate_small', 12 + r() * 14, 20 + r() * 9, r() * TAU);
    // Scattered small stuff near the centre so the first swings always hit something.
    for (let i = 0; i < 14; i++) {
      const a = r() * TAU, d = 6 + r() * 5;
      this.place(['stool', 'barrel_small', 'pot', 'jar', 'crate_small', 'trunk'][Math.floor(r() * 6)], Math.cos(a) * d, Math.sin(a) * d, r() * TAU);
    }
  }

  private makeFighter(look: LookId, role: Role, name: string, hp: number, speed: number, foe?: FoeDef, foeKind?: FoeKind): Fighter {
    const inst = this.assets.human(look, `${role}-${this.serial + 1}`);
    this.shadow.add(2.3, inst.root);
    const f = new Fighter(++this.serial, role, name, inst, new Animator(inst.anims), hp, hp, speed, foe, foeKind);
    this.fighters.push(f);
    return f;
  }

  private equip(f: Fighter, show: string[], attach?: { r?: string; l?: string }): void {
    for (const [n, m] of f.inst.gear) m.setEnabled(show.includes(n));
    for (const e of f.extra) e.dispose(); f.extra = [];
    for (const [slot, w] of [[f.inst.slotR, attach?.r], [f.inst.slotL, attach?.l]] as const) {
      if (!w) continue;
      const src = this.assets.sources.get(w); if (!src) continue;
      const i = src.createInstance(`${w}-${f.id}`); i.parent = slot; i.isPickable = false;
      f.extra.push(i);
    }
  }

  private spawnHero(): Fighter {
    const h = this.makeFighter('ranger', 'hero', 'You', 1000, 5.4);
    h.pos.set(0, 0, 0); h.yaw = Math.PI * .75;
    this.bladeBase = new TransformNode('blade-base', this.scene); this.bladeTip = new TransformNode('blade-tip', this.scene);
    this.bladeBase.parent = h.inst.slotR; this.bladeTip.parent = h.inst.slotR;
    h.trail = new SlashTrail(this.scene, this.bladeBase, this.bladeTip, new Color3(1, .97, .9));
    this.setWeapon(h, this.weapon);
    h.anim.play(this.ms(h).idle, { loop: true, fade: 0 });
    return h;
  }

  setWeapon(h: Fighter, id: WeaponId): void {
    if (!this.unlocked.has(id)) return;
    this.weapon = id; const w = WEAPONS[id], o = this.weaponMesh[id];
    this.equip(h, [], o ? { [o.hand]: o.mesh } : w.attach);
    if (h.sheathed) { h.sheathed = false; this.sheathe(h, true); }
    this.bladeBase.position.set(0, w.trail * .3, 0); this.bladeTip.position.set(0, Math.max(.3, w.trail), 0);
    if (!h.busy) { h.state = 'idle'; h.anim.play(this.ms(h).idle, { loop: true }); }
  }

  private spawnCompanions(): void {
    const b = this.makeFighter(ALLIES.barbarian.look, 'ally', ALLIES.barbarian.name, ALLIES.barbarian.hp, ALLIES.barbarian.speed);
    this.equip(b, [], { [ALLIES.barbarian.hand]: ALLIES.barbarian.weapon }); b.pos.set(-3, 0, 2);
    const w = this.makeFighter(ALLIES.rogue.look, 'ally', ALLIES.rogue.name, ALLIES.rogue.hp, ALLIES.rogue.speed);
    this.equip(w, [], { [ALLIES.rogue.hand]: ALLIES.rogue.weapon }); w.pos.set(3, 0, 2);
    for (const f of [b, w]) f.anim.play(this.idleOf(f), { loop: true, fade: 0 });
  }

  setCompanions(on: boolean): void {
    this.companions = on;
    if (on && !this.fighters.some(f => f.role === 'ally')) this.spawnCompanions();
    if (!on) for (const f of this.fighters.filter(f => f.role === 'ally')) this.removeFighter(f);
    this.fighters = this.fighters.filter(f => on || f.role !== 'ally');
  }

  private spawnFoe(k: FoeKind, x: number, z: number, look?: LookId): Fighter {
    const d = FOES[k];
    const hp = Math.round(d.hp * (1 + Math.max(0, this.wave - 1) * .08) * this.foeHpMul);
    const f = this.makeFighter(look ?? d.looks[Math.floor(this.rnd() * d.looks.length)], 'foe', k, hp, d.speed * (.9 + this.rnd() * .2), d, k);
    this.equip(f, [], { [d.hand ?? 'r']: d.weapon }); f.dmgMul = this.foeDmgMul;
    if (d.scale) { f.inst.root.scaling.scaleInPlace(d.scale); f.radius *= d.scale; }
    f.pos.set(x, 0, z); f.yaw = Math.atan2(this.hero.pos.x - x, this.hero.pos.z - z);
    f.state = 'spawn'; f.st = 0; f.cd = .6 + this.rnd() * 1.4; f.strafe = this.rnd() < .5 ? 1 : -1;
    f.anim.play(this.ms(f).enter, { speed: 1.6, fade: 0 });
    this.fx.dustAt(new Vector3(x, .2, z), 16); this.ev.sound('spawn', .4); this.fx.ring(new Vector3(x, 0, z), 3, .6, new Color3(.85, .9, 1));
    return f;
  }

  private removeFighter(f: Fighter): void {
    f.cancelTell?.(); f.aimLine?.dispose(); f.trail?.dispose();
    for (const e of f.extra) e.dispose();
    f.inst.dispose();
  }

  /** The moveset a fighter currently moves with (the hero's follows the drawn weapon). */
  ms(f: Fighter): Moveset {
    if (f.role === 'hero') { const m = MOVESETS[WEAPONS[this.weapon].set]; return f.relaxed ? { ...m, ...RELAXED } : m; }
    if (f.role === 'ally') return MOVESETS[f.name === ALLIES.barbarian.name ? ALLIES.barbarian.set : ALLIES.rogue.set];
    return MOVESETS[f.foe!.set];
  }
  /** Directional legs (forward / back / strafe) under a held upper-body pose. */
  private strafeLegs(f: Fighter, mv: Vector3 | null, sp: number): void {
    if (!mv) { f.anim.legLayer(null); return; }
    const rel = wrap(Math.atan2(mv.x, mv.z) - f.yaw), a = Math.abs(rel);
    const clip = a < Math.PI / 4 ? 'unarmed/walk_forward' : a > Math.PI * .75 ? 'unarmed/walk_backward' : rel > 0 ? 'unarmed/walk_strafe_left' : 'unarmed/walk_strafe_right';
    const t = this.assets.clips.get(clip), pace = t?.stance ? t.stance * f.inst.root.scaling.x : 1.6;
    f.anim.legLayer(clip, Math.max(.5, sp / pace));
  }

  /** Walk/run blend paced to ground speed (stride matches travel, no hard gait switch). */
  private locoAnim(f: Fighter, sp: number): void {
    const m = this.ms(f), sc = f.inst.root.scaling.x;
    // Pace each gait from its measured stride (planted-foot speed) so travel and footfalls agree.
    const tw = this.assets.clips.get(m.walk), tr = this.assets.clips.get(m.run);
    const walkPace = tw?.stance ? tw.stance * sc : (m.walkPace ?? 1.9), runPace = tr?.stance ? tr.stance * sc : m.runPace;
    const blend = Math.max(0, Math.min(1, (sp - walkPace * 1.15) / Math.max(.5, runPace * .7 - walkPace * 1.15))), b = blend * blend * (3 - 2 * blend);
    const lw = f.anim.length(m.walk), lr = f.anim.length(m.run);
    const rate = (1 - b) * sp / (walkPace * lw) + b * sp / (runPace * lr);
    f.anim.loco(m.walk, m.run, b, rate, .25);
  }
  private pick<T>(a: T[]): T { return a[Math.floor(this.rnd() * a.length)]; }
  private idleOf(f: Fighter): string {
    return this.ms(f).idle;
  }

  // ------------------------------------------------------------------ frame
  step(dt: number, input: HeroInput): void {
    if (this.hitstop > 0) { this.hitstop -= dt; this.fx.update(dt); this.scene.animationTimeScale = 0; return; }
    this.scene.animationTimeScale = 1;
    this.time += dt;
    if (this.combo.hits && (this.combo.timer -= dt) <= 0) this.combo.hits = 0;

    this.vfx.update(dt);
    // Each body runs on its own clock: frozen solid stops it, a shock stutters it, time magic slows it.
    for (const f of this.fighters) { const k = this.bodyTime(f); f.anim.timeScale = k; }
    this.stepHero(dt * (this.hero.frozenT > 0 ? 0 : this.hero.timeT > 0 ? .5 : 1), input);
    for (const f of this.fighters) if (f.role !== 'hero') {
      const k = this.bodyTime(f), cd = dt * k;
      const ai = this.customAI.get(f);
      if (ai) { if (ai(f, dt) === false) this.stepFoe(f, cd); } else if (f.role === 'foe') { if (!this.freezeFoes) this.stepFoe(f, cd); } else this.stepAlly(f, cd);
    }
    for (const f of this.fighters) this.integrate(f, dt);
    this.stepFields(dt); this.stepMissiles(dt); this.stepStatuses(dt);
    if (this.wardHp > 0 && this.rnd() < dt * 6) this.fx.sparksAt(this.hero.pos.add(new Vector3((this.rnd() - .5) * 1.4, .4 + this.rnd() * 1.6, (this.rnd() - .5) * 1.4)), 2, new Color4(.55, .8, 1, 1));
    this.separate();
    this.stepShots(dt);
    this.stepWaves(dt);
    for (const p of this.props) if (p.wobble > 0) {
      p.wobble = Math.max(0, p.wobble - dt * 3);
      const k = Math.sin(this.time * 55) * p.wobble * .12; p.mesh.rotation.x = k; p.mesh.rotation.z = k * .6;
    }
    this.debris.step(dt);
    this.fx.update(dt);
    for (const f of this.fighters) {
      f.anim.update(dt); f.trail?.update(dt);
      if (!f.alive) { if (f.y > 0 || f.vy > 0) { f.vy -= 22 * dt; f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0) f.vy = 0; } if (f.deadT > 4.5) f.y -= dt * .7; }
      // Lean into turns and accelerations (cosmetic weight shift on the whole body).
      const prevYaw = f.inst.root.rotation.y, turn = dt > 0 ? wrap(f.yaw - prevYaw) / dt : 0;
      f.turnRate += (turn - f.turnRate) * Math.min(1, dt * 10);
      const spd = f.role === 'hero' ? f.mvel.length() : 0;
      f.lean += (Math.max(-.2, Math.min(.2, -f.turnRate * spd * .012)) - f.lean) * Math.min(1, dt * 8);
      f.inst.root.position.set(f.pos.x, f.y + f.hover, f.pos.z); f.inst.root.rotation.set(0, f.yaw, f.state === 'move' ? f.lean : 0);
      if (f.flash > 0) f.flash -= dt;
      const on = f.flash > 0;
      for (const m of f.inst.meshes) { m.renderOverlay = on; if (on) { m.overlayColor = f.role === 'hero' ? new Color3(1, .2, .15) : Color3.White(); m.overlayAlpha = .65; } }
      f.hpShown += (f.hp - f.hpShown) * Math.min(1, dt * 6);
    }
    // Remove spent foes.
    for (const f of this.fighters) if (!f.alive && f.role === 'foe' && (f.deadT += dt) > 6) { this.removeFighter(f); f.radius = -1; }
    this.fighters = this.fighters.filter(f => f.radius >= 0);
  }

  /** Foot planting on/off (for A/B measurement). */
  footLock = true;

  /** Run after animations: planted feet, coat tails and hair (springs), then two-handed grips. */
  solveGrips(dt: number): void {
    for (const f of this.fighters) this.posture(f);
    if (this.footLock && dt > 0) for (const f of this.fighters) this.plantFeet(f, dt);
    for (const f of this.fighters) f.inst.springs?.update(dt);
    for (const f of this.fighters) {
      const b = f.inst.bones; if (!b || !f.twoHand || f.sheathed) { f.ikW = 0; continue; }
      const free = f.standing && f.state !== 'dodge' && f.state !== 'hit' && f.state !== 'spawn' && f.state !== 'revive';
      f.ikW += ((free ? 1 : 0) - f.ikW) * Math.min(1, dt * 12);
      if (f.ikW < .02) continue;
      const slot = f.inst.slotR; slot.computeWorldMatrix(true);
      const target = Vector3.TransformCoordinates(new Vector3(0, -.26, 0), slot.getWorldMatrix());
      reach(b.get('upperarm_l')!, b.get('lowerarm_l')!, b.get('hand_l')!, target, f.ikW);
    }
  }

  /**
   * Creature posture, layered after animation: the spine curls forward, the neck and head lift back to the
   * horizon, the shoulders roll in. Same motion capture, a different animal.
   */
  private posture(f: Fighter): void {
    const k = f.foe?.hunch; if (!k || !f.alive || !this.postureOn) return;
    const b = f.inst.bones; if (!b) return;
    // Running clips already lean into the stride; ease the curl there so the two don't stack.
    const run = /run|sprint|jog/i.test(f.anim.dominant()?.name ?? '');
    const w = (f.standing ? k : k * .3) * (run ? .45 : 1);
    const axis = new Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    const turn = (n: string, a: number, ax = axis) => {
      const node = b.get(n), p = node?.parent as TransformNode | null; if (!node || !p) return;
      p.computeWorldMatrix(true);
      // Idempotent: when no clip rewrote this bone since last frame, bend from the animated pose, not our own output.
      const q = node.rotationQuaternion!, last = POSTURE.get(node);
      const base = last && Math.abs(Quaternion.Dot(q, last.post)) > .99999 ? last.pre : q.clone();
      const P = p.absoluteRotationQuaternion, R = Quaternion.RotationAxis(ax, a);
      const post = Quaternion.Inverse(P).multiply(R).multiply(P).multiply(base).normalize();
      node.rotationQuaternion = post; POSTURE.set(node, { pre: base, post: post.clone() });
      node.computeWorldMatrix(true);
    };
    turn('spine_01', w * .3); turn('spine_02', w * .35); turn('spine_03', w * .35);
    turn('neck_01', -w * .5); turn('head', -w * .45);
    const fwdv = new Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    turn('clavicle_l', w * .25, fwdv); turn('clavicle_r', -w * .25, fwdv);
  }

  private camProps: Prop[] = [];
  /** Camera obstruction (presentation only): standing walls and tall props near the hero, as their collision boxes. */
  refreshCameraProps(): void { const h = this.hero.pos; this.camProps = this.props.filter(p => !p.broken && !p.loose && p.h > .9 && Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 16 + Math.max(p.hx, p.hz)); }
  cameraBlocked(x: number, y: number, z: number): boolean {
    for (const p of this.camProps) {
      if (y > p.h + .15 || y < 0) continue;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = (x - p.pos.x) * c - (z - p.pos.z) * s, lz = (x - p.pos.x) * s + (z - p.pos.z) * c;
      if (Math.abs(lx) < p.hx + .12 && Math.abs(lz) < p.hz + .12) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ hero
  private stepHero(dt: number, i: HeroInput): void {
    const h = this.hero, w = WEAPONS[this.weapon];
    if (!h.alive) return;
    if (i.weapon && i.weapon !== this.weapon && !h.busy) this.setWeapon(h, i.weapon);
    if (i.cycle && !h.busy) { const order: WeaponId[] = ['fists', 'greatsword', 'axe', 'bow'].filter(x => this.unlocked.has(x as WeaponId)) as WeaponId[]; const n = order[(order.indexOf(this.weapon) + 1) % order.length]; if (n && n !== this.weapon) { this.setWeapon(h, n); this.ev.sound('whoosh', .3); } }
    for (let k = 0; k < this.skillCd.length; k++) this.skillCd[k] = Math.max(0, this.skillCd[k] - dt);
    h.mana = Math.min(h.maxMana, h.mana + (4 + this.manaControl * .6) * (this.ley ? 1.25 : 1) * dt);
    for (const k of ['haste', 'might', 'stone', 'clarity'] as const) if (this.potion[k] > 0) this.potion[k] -= dt;
    if ((this.histT += dt) > .25) { this.histT = 0; this.hpHistory.push(h.hp); if (this.hpHistory.length > 14) this.hpHistory.shift(); }
    if (this.regenT > 0) { this.regenT -= dt; h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .025 * dt); }
    if (this.veilT > 0) this.veilT -= dt;
    if (this.imbue && (this.imbue.t -= dt) <= 0) this.imbue = null;
    this.syncImbueFx(h);
    if (this.frenzyT > 0) { this.frenzyT -= dt; if (this.rnd() < dt * 10) this.fx.sparksAt(h.pos.add(new Vector3((this.rnd() - .5) * .8, .6 + this.rnd() * 1.4, (this.rnd() - .5) * .8)), 2, new Color4(1, .2, .15, 1)); }
    if (this.wardT > 0 && (this.wardT -= dt) <= 0) this.wardHp = 0;
    if (i.flask && this.flasks > 0 && h.hp < h.maxHp && h.healT <= 0) { this.flasks--; h.healT = 1.1; this.fx.ring(h.pos, 2.6, .6, new Color3(.4, 1, .55)); this.ev.sound('level', .5); }
    if (h.healT > 0) { h.healT -= dt; h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .42 / 1.1 * dt); if (this.rnd() < dt * 12) this.fx.sparksAt(h.pos.add(new Vector3(0, 1 + this.rnd(), 0)), 3, new Color4(.4, 1, .5, 1)); }
    h.st += dt; h.iframe = Math.max(0, h.iframe - dt);
    h.energyDelay -= dt;
    if (h.energyDelay <= 0) h.energy = Math.min(100, h.energy + 26 * this.mods.regen * dt);
    // No passive regeneration: health returns through flasks, potions, abilities and boons. (Sandbox keeps a slow trickle.)
    if (this.passiveRegen && h.hp < h.maxHp && this.time - h.lastHurt > 8) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .004 * dt);
    this.stepAlert(h, dt, i);
    const mv = new Vector3(i.move.x, 0, i.move.z); const moving = mv.lengthSquared() > .01;
    if (moving) mv.normalize();
    const aimYaw = Math.atan2(i.aim.x - h.pos.x, i.aim.z - h.pos.z); this.aimYaw = aimYaw;
    const speed = h.speed * (this.mods.move * this.bonus.move) * this.heroMove;

    // Revive a downed companion by holding interact beside them.
    const downed = this.fighters.find(f => f.role === 'ally' && f.state === 'down' && Vector3.Distance(f.pos, h.pos) < 2.6);
    if (downed && i.interact && !h.busy) { downed.reviveT += dt; if (downed.reviveT >= 1.6) this.revive(downed); }
    else for (const f of this.fighters) if (f.role === 'ally' && f.state === 'down') f.reviveT = Math.max(0, f.reviveT - dt * 2);

    if (i.dodgePressed && h.energy >= 18 && (!h.busy || (h.state === 'attack' && h.atk && h.atkT > h.atk.active[1]) || h.state === 'hit' && h.st > .15)) {
      this.endAttack(h);
      const dir = moving ? Math.atan2(mv.x, mv.z) : h.yaw;
      const rel = wrap(dir - h.yaw);
      const roll = Math.abs(rel) < Math.PI / 4 && moving;
      const clip = roll ? DODGES.roll : Math.abs(rel) < Math.PI / 4 ? DODGES.forward : Math.abs(rel) > Math.PI * .75 ? DODGES.back : rel > 0 ? DODGES.left : DODGES.right;
      h.dodgeTime = roll ? ROLL_TIME : DODGE_TIME; if (roll) h.yaw = dir;
      h.state = 'dodge'; h.st = 0; h.atkDir = dir; h.iframe = .4; h.energy -= 18; h.energyDelay = .6; h.label = 'Evading';
      h.anim.play(clip, { speed: h.anim.length(clip) * (roll ? .92 : .8) / h.dodgeTime, fade: .1, restart: true });
      this.fx.dustAt(h.pos.add(new Vector3(0, .1, 0)), 8);
      return;
    }

    switch (h.state) {
      case 'dodge': {
        const k = Math.min(1, h.st / h.dodgeTime);
        const v = (h.dodgeTime > DODGE_TIME ? 11 : 15) * (1 - k) * (1 - k) + 2;
        h.mvel.copyFrom(fwd(h.atkDir).scale(v * .4));
        h.pos.addInPlace(fwd(h.atkDir).scale(v * dt));
        this.debris.stir(h.pos.x, h.pos.z, 1.4, 2.5);
        if (h.st >= h.dodgeTime) this.toIdle(h);
        return;
      }
      case 'hit': if (h.st > .32) this.toIdle(h); return;
      case 'attack': {
        const a = h.atk!;
        if (h.charging) {
          // Hold at the wind-up while RMB is held (max ~1.2 s), then release with scaled power.
          const hold = a.active[0] * .8;
          if (h.atkT >= hold) {
            h.atkT = hold; h.anim.setSpeed(.035); h.charge = Math.min(1, h.charge + dt / 1.2);
            if (this.rnd() < dt * 18) this.fx.sparksAt(h.inst.slotR.getAbsolutePosition(), 3, new Color4(1, .85, .4, 1));
            if (!i.secondary || h.charge >= 1) {
              const c = h.charge; h.charging = false; h.anim.setSpeed(a.speed * this.atkSpeed);
              h.atk = { ...a, damage: a.damage * (1 + .9 * c), knock: a.knock * (1 + .6 * c), hitstop: a.hitstop + .04 * c, shake: a.shake + .2 * c, label: c > .9 ? 'Full charge' : a.label };
              if (c > .9) this.fx.flash(h.pos.add(new Vector3(0, 1.4, 0)), 2.2, new Color3(1, .8, .4));
            }
            if (h.charging) { h.yaw = turnTo(h.yaw, aimYaw, dt * 6); return; }
          }
        }
        h.atkT += dt * a.speed * this.atkSpeed;
        if (h.atkT < a.active[0]) h.yaw = turnTo(h.yaw, this.assist(h, aimYaw, a.range), dt * 14);
        if (a.lunge && h.atkT < a.active[1]) h.pos.addInPlace(fwd(h.yaw).scale(this.lungeStep(h, a, dt * a.speed * this.atkSpeed)));
        if (this.weapon === 'bow') { if (h.atkT >= a.active[0] && !h.atkHits.size) { h.atkHits.set(this, 0); this.fireBolt(h, h.state === 'attack' && i.secondary ? 1.35 : 1); } }
        else this.swing(h, a);
        if (i.attackPressed && h.atkT > a.cancel - .35) h.queued = true;
        // Heavy: finish a light combo, or chain heavy -> heavy (Witcher strong attacks / Elden Ring R2).
        if (i.heavyPressed && w.heavy && h.atkT > a.cancel - .3 && this.weapon !== 'bow') { const nx = h.heavyIdx >= 0 ? (h.heavyIdx + 1) % w.heavy.length : 0; this.startHeavy(h, nx, aimYaw, false); return; }
        if (h.heavyIdx < 0 && h.atkT >= a.cancel && (h.queued || (i.attack && this.weapon !== 'bow')) && h.combo + 1 < w.combo.length) { this.startAttack(h, w.combo[++h.combo], aimYaw); return; }
        if (this.weapon === 'bow' && h.atkT >= a.cancel && (h.queued || i.attack)) { this.startAttack(h, w.combo[0], aimYaw); return; }
        if (h.atkT >= (a.end ?? a.cancel)) { this.endAttack(h); h.combo = 0; h.heavyIdx = -1; this.toIdle(h); }
        return;
      }
      case 'cast': {
        this.stepCast(h, dt, i);
        return;
      }
      case 'spin': {
        const a = w.spin!;
        h.atkT += dt;
        h.energy -= 30 * dt; h.energyDelay = .5;
        if (Math.floor(h.atkT / .32) !== Math.floor((h.atkT - dt) / .32)) this.ev.sound('whoosh', .8);
        if (moving) { h.pos.addInPlace(mv.scale((a.move ?? 0) * dt)); }
        this.swing(h, a);
        if (!i.secondary || h.energy <= 0) { this.endAttack(h); this.toIdle(h); }
        return;
      }
      case 'guard': {
        h.yaw = turnTo(h.yaw, aimYaw, dt * 10);
        if (moving) h.pos.addInPlace(mv.scale(2.4 * dt));
        this.strafeLegs(h, moving ? mv : null, 2.4);
        if (i.attackPressed) { this.startAttack(h, w.bash ?? w.kick ?? w.combo[0], aimYaw); return; }
        if (!i.guard) this.toIdle(h);
        return;
      }
      case 'aim': {
        h.yaw = turnTo(h.yaw, aimYaw, dt * 16);
        if (moving) h.pos.addInPlace(mv.scale(2.8 * dt));
        this.strafeLegs(h, moving ? mv : null, 2.8);
        this.aimLine(h, true, i.aim);
        if (i.attackPressed || (i.heavyReleased && h.st > .35)) { this.aimLine(h, false); this.startAttack(h, w.aimed!, aimYaw); return; }
        if (!i.secondary) { this.aimLine(h, false); this.toIdle(h); }
        return;
      }
    }
    // idle / move
    if (i.attackPressed || (i.attack && h.st > .05)) { h.combo = 0; h.heavyIdx = -1; this.startAttack(h, w.combo[0], aimYaw); return; }
    if (i.cast >= 0 && this.tryCast(h, i.cast, aimYaw)) return;
    if (i.guard && this.weapon !== 'bow') { h.state = 'guard'; h.st = 0; h.label = 'Guarding'; h.anim.play(this.ms(h).guard === this.ms(h).idle ? this.ms(h).block : this.ms(h).guard, { loop: true, fade: .12 }); return; }
    if (i.heavyPressed && w.heavy && this.weapon !== 'bow' && h.energy >= 8) { h.combo = 0; this.startHeavy(h, 0, aimYaw, true); return; }
    if (i.secondary && this.weapon === 'bow') {
      if (w.secondary === 'aim') { h.state = 'aim'; h.st = 0; h.label = 'Aiming'; h.anim.play(this.ms(h).guard, { loop: true, fade: .08 }); return; }
    }
    // Weighted locomotion: velocity eases toward the stick (faster to stop than to start), the body
    // turns at a capped rate, and the clip (walk or run) is chosen and paced from actual speed so feet don't skate.
    // Default pace is a jog; Shift sprints.
    // Human pace (world units = 1.22 m): jog ~3.6 m/s, sprint ~5.8 m/s.
    const want = moving ? mv.scale(speed * (i.sprint ? 1.32 : .82)) : Vector3.Zero();
    const rate = moving ? (Vector3.Dot(want, h.mvel) < 0 ? 18 : 9) : 14;
    h.mvel.addInPlace(want.subtract(h.mvel).scaleInPlace(1 - Math.exp(-rate * dt)));
    const sp = h.mvel.length();
    h.pos.addInPlace(h.mvel.scale(dt));
    if (sp > .35) {
      h.yaw = turnTo(h.yaw, Math.atan2(h.mvel.x, h.mvel.z), dt * (sp > 4 ? 9 : 12));
      const m = this.ms(h), walk = sp < 3.6;
      if (h.state !== 'move') { h.state = 'move'; h.st = 0; }
      h.label = walk ? 'Walking' : 'Running';
      this.locoAnim(h, sp); void walk;
      this.debris.stir(h.pos.x, h.pos.z, 1.1, 1.6, h.mvel.x * .5, h.mvel.z * .5);
    } else if (h.state !== 'idle') this.toIdle(h);
  }

  /** Start a heavy attack; `charge` = may be held to charge at the wind-up. */
  private startHeavy(h: Fighter, idx: number, yaw: number, charge: boolean): void {
    const w = WEAPONS[this.weapon], a = w.heavy![idx];
    this.startAttack(h, a, yaw); h.heavyIdx = idx; h.charging = charge; h.charge = 0;
    h.energy -= 8; h.energyDelay = .6;
  }

  private tryCast(h: Fighter, k: number, yaw: number): boolean {
    const s = this.skills[k];
    if (!s) { this.ev.damage(h.pos.add(new Vector3(0, 2.4, 0)), 0, 'block'); return false; }
    if (this.skillCd[k] > 0) return false;
    if (s.mana) { const need = this.potion.clarity > 0 ? 0 : s.mana; if (h.mana < need) { this.ev.word?.(h.pos.add(new Vector3(0, 2.4, 0)), 'NO MANA', '#5aa8ff'); return false; } h.mana -= need; }
    else { if (h.energy < s.cost) return false; h.energy -= s.cost; h.energyDelay = .8; }
    this.skillCd[k] = s.cooldown * (1 - this.gearStats.cdr);
    if (this.onCast?.(s)) this.skillCd[k] = 0;
    this.beginCast(h, s, yaw); return true;
  }

  /** Cast a skill outside the slots (scrolls). False when the hero cannot act right now. */
  castNow(s: SkillDef, yaw = this.aimYaw): boolean {
    const h = this.hero;
    if (!h.alive || h.busy || h.state === 'down') return false;
    this.beginCast(h, s, yaw); return true;
  }

  private beginCast(h: Fighter, s: SkillDef, yaw: number): void {
    h.state = 'cast'; h.st = 0; h.castDef = s; h.spellDone = false; h.label = s.name; h.yaw = turnTo(h.yaw, yaw, Math.PI); h.dashHit.clear();
    s.uses++;
    const self = s.kernel === 'ward' || s.kernel === 'heal' || s.kernel === 'frenzy';
    if (s.kernel === 'dash' || s.kernel === 'blink') { h.iframe = .35; h.anim.play(DODGES.forward, { speed: 1.6, fade: .06, restart: true }); }
    else h.anim.play(self ? 'sword_and_shield/sword and shield casting (2)' : 'great_sword/spell cast', { speed: 1.7, fade: .1, restart: true });
  }

  /** One hero skill blow: power, shadow's deeper cut, bone's guard-breaking weight, then on-hit riders. */
  private skillHit(h: Fighter, t: Fighter, s: SkillDef, base: number, push: Vector3, knock: number, heavy = false): void {
    if (!t.alive || !t.standing) return;
    const r = s.riders, p = s.power;
    const dmg = base * p * (r.includes('shadow') ? 1.35 : 1);
    this.inSkill = true;
    this.damage(t, dmg, push, knock, heavy || r.includes('bone'), h);
    for (const x of r) if (x in ELEMENT_INFO) this.elementHit(h, t, x as Element, p, dmg);
    this.inSkill = false;
    for (const x of r) {
      if (x === 'blood') h.hp = Math.min(h.maxHp, h.hp + dmg * .12);
      else if (x === 'storm' && s.kernel !== 'chain') {
        const o = this.fighters.find(o => o !== t && o.team !== h.team && o.alive && o.standing && Vector3.Distance(o.pos, t.pos) < 5);
        if (o) { this.damage(o, dmg * .4, o.pos.subtract(t.pos).normalize(), 2, false, null); this.bolt(t.pos, o.pos, new Color4(.8, .7, 1, 1)); }
      }
    }
  }

  /** Tower procs (legendary powers): a burst at a point. Damage counts as the hero's. */
  blast(at: Vector3, r: number, dmg: number, knock: number, color: Color3, burn = 0): void {
    this.fx.ring(at, r * 2, .5, color); this.fx.flash(at.add(new Vector3(0, 1, 0)), r, color);
    for (const t of this.fighters) if (t.team !== this.hero.team && t.alive && t.standing && Math.hypot(t.pos.x - at.x, t.pos.z - at.z) < r + t.radius) {
      const d = t.pos.subtract(at); d.y = 0;
      this.damage(t, dmg, d.lengthSquared() > 1e-4 ? d.normalize() : new Vector3(0, 0, 1), knock, false, this.hero);
      if (burn) { t.burnT = 3; t.burnDps = Math.max(t.burnDps, burn); }
    }
  }

  /** Tower procs: lightning leaping from a foe to its neighbours. */
  procChain(from: Fighter, dmg: number, jumps: number): void {
    const hit = new Set<Fighter>([from]); let cur: Fighter = from;
    for (let n = 0; n < jumps; n++) {
      const nx = this.fighters.filter(t => !hit.has(t) && t.team !== this.hero.team && t.alive && t.standing && Vector3.Distance(t.pos, cur.pos) < 7).sort((a, b) => Vector3.Distance(a.pos, cur.pos) - Vector3.Distance(b.pos, cur.pos))[0];
      if (!nx) break;
      this.bolt(cur.pos, nx.pos, new Color4(.8, .7, 1, 1)); hit.add(nx); this.damage(nx, dmg, nx.pos.subtract(cur.pos).normalize(), 2, false, this.hero); cur = nx;
    }
  }

  /** Presentation helpers for controllers: a floating word, a sound, a screen shake, removing a body. */
  ev_word(p: Vector3, text: string, color: string): void { this.ev.word?.(p, text, color); }
  sound(kind: Sfx, gain = 1): void { this.ev.sound(kind, gain); }
  shake(k: number): void { this.fx.shake = Math.max(this.fx.shake, k); }
  removeBody(f: Fighter): void { for (const fx of f.statusFx.values()) fx.dispose(); f.statusFx.clear(); this.removeFighter(f); this.fighters = this.fighters.filter(o => o !== f); }

  /**
   * Calm or alert. A body at ease walks and stands like a person (relaxed clips, arms loose, weapon on the back);
   * a foe within reach, a blow taken or any combat input brings the weapon to hand and the fighting stance at once.
   */
  private stepAlert(h: Fighter, dt: number, i: HeroInput): void {
    const action = i.attack || i.attackPressed || i.heavyPressed || i.secondary || i.guard || i.cast >= 0 || i.dodgePressed;
    const near = this.fighters.some(f => f.role === 'foe' && f.alive && f.foeKind !== 'dummy' && Math.hypot(f.pos.x - h.pos.x, f.pos.z - h.pos.z) < 9);
    const busy = h.state !== 'idle' && h.state !== 'move';
    if (action || near || busy || this.time - h.lastHurt < 4) h.alertT = 3.5; else h.alertT -= dt;
    const relaxed = h.alertT <= 0;
    if (relaxed === h.relaxed) return;
    h.relaxed = relaxed; this.sheathe(h, relaxed);
    // Swap the stance clip now (locomotion picks its new pair on the next frame by itself).
    if (h.state === 'idle') h.anim.play(this.idleOf(h), { loop: true, fade: relaxed ? .6 : .2 });
  }

  /** Weapons to the back (sheathed) or back to the hands. */
  private sheathe(f: Fighter, on: boolean): void {
    const back = f.inst.bones?.get('spine_03'); if (!back) return;
    f.sheathed = on;
    f.extra.forEach((m, k) => {
      const inHand = m.metadata?.hand as TransformNode | undefined;
      if (on) {
        if (!inHand) m.metadata = { ...(m.metadata ?? {}), hand: m.parent };
        m.parent = back; const bow = this.weapon === 'bow';
        m.position.set(k ? -.08 : .06, bow ? .05 : .12, -.2); m.rotationQuaternion = null; m.rotation.set(0, bow ? Math.PI / 2 : 0, bow ? -Math.PI * .2 : Math.PI * .15);
      } else if (inHand) { m.parent = inHand; m.position.setAll(0); m.rotation.setAll(0); }
    });
    if (f.trail) f.trail.active = false;
    if (!on) this.vfx.flash(f.pos.add(new Vector3(0, 1.4, 0)), new Color3(1, .95, .8), .6, .12);
  }

  /** Spawn a foe of a kind (tower controllers). */
  spawnAt(k: FoeKind, x: number, z: number): Fighter { return this.spawnFoe(k, x, z); }

  /** Wind up a foe's melee blow `idx` at its target (the normal tell, telegraph and hit resolution follow). */
  foeStrike(f: Fighter, idx: number, tell?: number): void {
    const d = f.foe!, a = d.attacks[idx % d.attacks.length], t = f.target ?? this.hero, tl = tell ?? d.tell;
    const toT = Math.atan2(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
    f.state = 'tell'; f.st = 0; f.atk = a; f.atkT = 0; f.atkHits.clear(); f.yaw = toT; f.label = 'Winding up';
    f.anim.play(a.clip, { speed: Math.max(.05, a.active[0] * .55 / Math.max(tl, .01)), fade: .08, restart: true });
    f.atkT = a.active[0] * .55;
    f.cancelTell = this.fx.telegraph(() => f.standing ? f.pos : null, () => f.yaw, a.range + 1, a.range * 2.2, tl + .25);
  }

  /** A blow that ignores guard, parry and wards (only a dodge's grace avoids it). Returns false if dodged. */
  hitUnblockable(t: Fighter, amount: number, push: Vector3, knock: number, src: Fighter | null): boolean {
    if (t.iframe > 0 || t.state === 'dodge') { this.ev.word?.(t.pos.add(new Vector3(0, 2.3, 0)), 'DODGED', '#ffd76a'); return false; }
    this.ignoreGuard = true; this.damage(t, amount, push, knock, true, src); this.ignoreGuard = false; return true;
  }

  /** A body's own clock: frozen solid 0, shocked a stutter, time-slowed a third, otherwise 1. */
  bodyTime(f: Fighter): number { return f.frozenT > 0 ? 0 : f.shockT > 0 ? .12 : f.timeT > 0 ? .35 : 1; }

  /**
   * One elemental contact: leaves the element's status and resolves its reactions with what is already there.
   * Statuses are the memory of the fight, so combinations emerge: soak then shock, soak then freeze, freeze then
   * burn, gather then burst, slow then strike. `base` is the blow's damage (reactions scale from it).
   */
  elementHit(src: Fighter, t: Fighter, e: Element, p: number, base: number): void {
    if (!t.alive) return;
    const chest = t.pos.add(new Vector3(0, 1.3 * t.inst.root.scaling.x / 1.22, 0));
    // Time stored in a slowed body: three more contacts of any element rupture it.
    if (e !== 'time' && t.timeT > 0 && ++t.ruptureHits >= 3) {
      t.timeT = 0; t.ruptureHits = 0; this.vfx.clockRing(t.pos.add(new Vector3(0, .1, 0)), 2.4, .9); this.vfx.burst('time', chest, 1.4);
      this.ev.word?.(chest.add(new Vector3(0, .9, 0)), 'RUPTURE', ELEMENT_INFO.time.color);
      this.damage(t, base * 2.5, new Vector3(0, 0, 0), 2, false, src.role === 'hero' ? src : null);
    }
    const say = (w: string, el: Element = e) => { const k = `${t.id}:${w}`, last = this.wordAt.get(k) ?? -9; if (this.time - last < .9) return; this.wordAt.set(k, this.time); this.ev.word?.(chest.add(new Vector3(0, .6, 0)), w, ELEMENT_INFO[el].color); };
    const extra = (k: number, push = new Vector3(0, 0, 0), knock = 0) => this.damage(t, base * k, push, knock, false, src.role === 'hero' ? src : null);
    const resist = t.god ? .12 : t.boss ? .45 : 1;   // bosses shrug statuses off faster; gods barely notice
    const friends = (r: number) => this.fighters.filter(o => o !== t && o.team === t.team && o.alive && o.standing && Vector3.Distance(o.pos, t.pos) < r);
    switch (e) {
      case 'water':
        if (t.burnT > 0) { t.burnT = 0; say('STEAM'); this.vfx.burst('water', chest, 1); for (const o of [t, ...friends(2.6)]) { o.shockT = Math.max(o.shockT, .5); } }
        t.wetT = 7 * resist; break;
      case 'frost':
        if (t.wetT > 0 && !t.god) { t.wetT = 0; t.frozenT = 2.2 * resist; say('FREEZE'); this.vfx.burst('frost', chest, 1.1); }
        else t.slowT = Math.max(t.slowT, 2.5); break;
      case 'flame':
        if (t.frozenT > 0) { t.frozenT = 0; say('SHATTER', 'frost'); this.vfx.burst('frost', chest, 1.3); extra(2); }
        else if (t.wetT > 0) { t.wetT = 0; say('STEAM', 'water'); this.vfx.burst('water', chest, .9); t.shockT = Math.max(t.shockT, .5); }
        else { t.burnT = 3.5; t.burnDps = Math.max(t.burnDps, 9 * p); } break;
      case 'storm':
        if (t.wetT > 0) {
          say('ELECTROCUTE'); t.shockT = 1 * resist; extra(1);
          for (const o of friends(6)) if (o.wetT > 0) { this.vfx.bolt(chest, o.pos.add(new Vector3(0, 1.3, 0))); o.shockT = .7 * (o.boss ? .45 : 1); this.damage(o, base * .7, o.pos.subtract(t.pos).normalize(), 1, false, src.role === 'hero' ? src : null); }
        } else t.shockT = Math.max(t.shockT, .3 * resist);
        if (this.rnd() < .5) this.vfx.bolt(chest.add(new Vector3(0, 2.5, 0)), chest, new Color3(.85, .8, 1), .035);
        break;
      case 'swift': {
        const d = t.pos.subtract(src.pos); d.y = 0; if (d.lengthSquared() > 1e-4) t.vel.addInPlace(d.normalize().scale(6 * resist));
        if (t.burnT > 0 && this.time - (this.wordAt.get(`${t.id}:spread`) ?? -9) > 1) { this.wordAt.set(`${t.id}:spread`, this.time); say('WILDFIRE', 'flame'); for (const o of friends(4.5).slice(0, 3)) { o.burnT = 3.5; o.burnDps = Math.max(o.burnDps, t.burnDps); this.vfx.burst('flame', o.pos.add(new Vector3(0, 1, 0)), .6); } }
        break;
      }
      case 'iron':
        if (t.frozenT > 0) { t.frozenT = 0; say('SHATTER', 'frost'); this.vfx.burst('frost', chest, 1.3); extra(2); }
        t.shredT = 5; if (!t.boss) t.shockT = Math.max(t.shockT, .25); break;
      case 'shadow':
        if (t.target !== src || t.state !== 'attack') { extra(.5); if (this.rnd() < .3) say('UNSEEN'); } break;
      case 'verdance':
        src.hp = Math.min(src.maxHp, src.hp + base * .1); t.slowT = Math.max(t.slowT, 1.2); break;
      case 'gravity':
        t.gatherT = 3;
        if (friends(2.8).filter(o => o.gatherT > 0).length >= 2) { say('CRUSH'); extra(.6); this.vfx.blackhole(chest, .5, .4); }
        break;
      case 'time':
        if (t.timeT <= 0) { t.timeT = 3.5 * resist; t.ruptureHits = 0; say('SLOWED'); }
        break;
    }
  }

  /** Launch an elemental missile (Bolt spells, the god's orb). */
  launch(owner: Fighter, e: Element, from: Vector3, dir: Vector3, p: number, dmg: number, speed = 26): void {
    const fx = this.vfx.missile(e, e === 'gravity' || e === 'iron' ? 1.4 : 1); fx.node.position.copyFrom(from);
    this.missiles.push({ pos: from.clone(), vel: dir.scale(e === 'iron' ? speed * .85 : e === 'time' ? speed * .7 : speed), e, p, owner, life: 1.4, fx, hit: new Set(), pierce: e === 'frost' ? 2 : 0, dmg });
    this.vfx.flash(from, elementLook(e).light, 1.2, .1); this.ev.sound('shoot', owner.role === 'hero' ? .8 : .5);
  }

  private stepMissiles(dt: number): void {
    for (const m of this.missiles) {
      m.life -= dt; m.pos.addInPlace(m.vel.scale(dt)); m.fx.node.position.copyFrom(m.pos);
      let done = m.life <= 0 || this.cameraBlocked(m.pos.x, m.pos.y, m.pos.z);
      if (!done) for (const t of this.fighters) {
        if (t.team === m.owner.team || !t.alive || !t.standing || m.hit.has(t) || t.state === 'spawn') continue;
        if (Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) > t.radius + .4) continue;
        m.hit.add(t); this.impact(m, t);
        if (m.pierce-- <= 0) { done = true; break; }
      }
      if (done) { if (!m.hit.size) this.impact(m, null); m.fx.dispose(); m.life = -1; }
    }
    this.missiles = this.missiles.filter(m => m.life > 0);
  }

  private impact(m: { pos: Vector3; vel: Vector3; e: Element; p: number; owner: Fighter; dmg: number }, t: Fighter | null): void {
    const e = m.e, at = m.pos.clone(), dir = m.vel.clone().normalize(), src = m.owner;
    this.vfx.burst(e, at, e === 'gravity' || e === 'flame' ? 1.1 : .8);
    const asHero = src.role === 'hero';
    if (t) { if (asHero) this.inSkill = true; this.damage(t, m.dmg * m.p, dir, e === 'iron' ? 6 : 3, e === 'iron', asHero ? src : src); this.elementHit(src, t, e, m.p, m.dmg * m.p); this.inSkill = false; }
    // Area kinds: fire explodes, water splashes, gravity drags in, lightning arcs once.
    const around = (r: number) => this.fighters.filter(o => o !== t && o.team !== src.team && o.alive && o.standing && Math.hypot(o.pos.x - at.x, o.pos.z - at.z) < r);
    if (e === 'flame') for (const o of around(1.8)) { this.damage(o, m.dmg * m.p * .5, o.pos.subtract(at).normalize(), 2, false, asHero ? src : null); this.elementHit(src, o, 'flame', m.p, m.dmg * .5); }
    if (e === 'water') for (const o of around(2)) o.wetT = 7;
    if (e === 'gravity') for (const o of around(4)) { o.vel.addInPlace(at.subtract(o.pos).normalize().scale(10)); o.gatherT = 3; }
    if (e === 'storm' && t) { const o = around(6)[0]; if (o) { this.vfx.bolt(at, o.pos.add(new Vector3(0, 1.3, 0))); this.damage(o, m.dmg * m.p * .5, dir, 1, false, asHero ? src : null); this.elementHit(src, o, 'storm', m.p, m.dmg * .5); } }
    for (const pr of this.props) if (!pr.broken && !pr.solid && Vector3.Distance(pr.pos, at) < 1.6) this.hitProp(pr, pr.pos.subtract(at).normalize(), 5, 2, asHero);
  }

  private stepFields(dt: number): void {
    for (const g of this.fields) {
      g.t -= dt; g.tick -= dt;
      const c = new Vector3(g.x, 0, g.z), inside = this.fighters.filter(f => f.alive && f.standing && Math.hypot(f.pos.x - g.x, f.pos.z - g.z) < g.r + f.radius);
      const foes = inside.filter(f => f.team !== g.owner.team), friends = inside.filter(f => f.team === g.owner.team);
      // Continuous pulls: gravity and the whirlwind drag foes toward the centre.
      if (g.e === 'gravity' || g.e === 'swift' || g.e === 'water') for (const f of this.fighters) {
        if (f.team === g.owner.team || !f.alive || !f.standing) continue;
        const d = c.subtract(f.pos); d.y = 0; const dist = d.length(); if (dist > g.r * 1.5 || dist < .4) continue;
        f.vel.addInPlace(d.normalize().scale((g.e === 'gravity' ? 26 : g.e === 'swift' ? 16 : 7) * dt));
      }
      if (g.e === 'time') for (const f of foes) { f.timeT = Math.max(f.timeT, .6); }
      if (g.tick <= 0) {
        g.tick = .5;
        const asHero = g.owner.role === 'hero';
        if (g.e === 'storm') { const t = foes[Math.floor(this.rnd() * foes.length)]; if (t) { this.vfx.bolt(t.pos.add(new Vector3(0, 7, 0)), t.pos.add(new Vector3(0, 1.2, 0))); this.damage(t, 16 * g.p, new Vector3(0, 0, 0), 1, false, asHero ? g.owner : null); this.elementHit(g.owner, t, 'storm', g.p, 16 * g.p); } }
        else if (g.e === 'verdance') { for (const f of friends) f.hp = Math.min(f.maxHp, f.hp + f.maxHp * .025 * g.p); for (const f of foes) { this.damage(f, 5 * g.p, new Vector3(0, 0, 0), 0, false, asHero ? g.owner : null); f.slowT = Math.max(f.slowT, .8); } }
        else for (const f of foes) {
          const base = g.e === 'gravity' ? 8 : g.e === 'iron' ? 12 : g.e === 'time' ? 3 : 7;
          this.inSkill = asHero;
          this.damage(f, base * g.p, new Vector3(0, 0, 0), g.e === 'iron' ? 2 : 0, false, asHero ? g.owner : null);
          this.elementHit(g.owner, f, g.e, g.p, base * g.p);
          this.inSkill = false;
          if (g.e === 'iron') this.vfx.burst('iron', f.pos.add(new Vector3(0, .3, 0)), .5);
          if (g.e === 'shadow' && asHero) g.owner.hp = Math.min(g.owner.maxHp, g.owner.hp + base * g.p * .2);
        }
      }
      if (g.t <= 0) { g.fx.dispose(); if (g.e === 'gravity') { this.vfx.burst('gravity', c.add(new Vector3(0, 1, 0)), 1.6); for (const f of this.fighters.filter(f => f.team !== g.owner.team && f.alive && Math.hypot(f.pos.x - g.x, f.pos.z - g.z) < g.r)) { this.damage(f, 30 * g.p, f.pos.subtract(c).normalize(), 9, true, g.owner.role === 'hero' ? g.owner : null); } } }
    }
    this.fields = this.fields.filter(g => g.t > 0);
  }

  /** Status timers and their visuals on each body. */
  private stepStatuses(dt: number): void {
    for (const f of this.fighters) {
      const k = this.bodyTime(f) || .2;   // statuses still run down while frozen
      if (f.slowT > 0) f.slowT -= dt;
      if (f.wetT > 0) f.wetT -= dt;
      if (f.frozenT > 0) f.frozenT -= dt;
      if (f.shockT > 0) f.shockT -= dt;
      if (f.timeT > 0) f.timeT -= dt * Math.max(.5, k);
      if (f.gatherT > 0) f.gatherT -= dt;
      if (f.shredT > 0) f.shredT -= dt;
      if (f.burnT > 0 && f.standing) {
        f.burnT -= dt; f.hp -= f.burnDps * dt;
        if (f.hp <= 0) this.kill(f, new Vector3(0, 0, 0), 0, false);
      }
      const want: [string, boolean][] = [['burn', f.burnT > 0 && f.alive], ['wet', f.wetT > 0 && f.alive], ['frozen', f.frozenT > 0 && f.alive], ['shock', f.shockT > 0 && f.alive], ['time', f.timeT > 0 && f.alive], ['gravity', f.gatherT > 0 && f.alive]];
      const h = 1.75 * f.inst.root.scaling.x;
      for (const [name, on] of want) {
        const cur = f.statusFx.get(name);
        if (on && !cur) {
          const root = f.inst.root, chest = f.inst.chest ?? root;
          const fx = name === 'burn' ? this.vfx.aura('flame', chest, { rate: 70, size: 2.4, radius: .25 })
            : name === 'wet' ? this.vfx.aura('water', chest, { rate: 30, size: 1, radius: .3 })
            : name === 'frozen' ? this.vfx.iceShell(root, h / root.scaling.x)
            : name === 'shock' ? this.vfx.aura('storm', chest, { rate: 90, size: 1.2, radius: .35 })
            : name === 'time' ? this.vfx.clockAt(root, .8)
            : this.vfx.aura('gravity', chest, { rate: 40, size: 1.4, radius: .4 });
          f.statusFx.set(name, fx);
        } else if (!on && cur) { cur.dispose(); f.statusFx.delete(name); }
      }
    }
  }

  /** Weapon glow while the drawn weapon carries an element. */
  private syncImbueFx(h: Fighter): void {
    const e = this.imbue?.e ?? this.weaponImbue[this.weapon] ?? null;
    const key = e ? `${e}:${this.weapon}` : '';
    if (key === this.imbueFxKey) return;
    this.imbueFx?.dispose(); this.imbueFx = null; this.imbueFxKey = key;
    if (e) this.imbueFx = this.vfx.aura(e, this.weapon === 'bow' ? h.inst.slotL : this.bladeTip, { rate: 80, size: 1.6, radius: .12 });
  }

  /** A crackling line of sparks between two points (lightning, arrows). */
  private bolt(a: Vector3, b: Vector3, c: Color4): void {
    for (let k = 0; k <= 5; k++) { const q = Vector3.Lerp(a, b, k / 5).add(new Vector3((this.rnd() - .5) * .4, 1.2 + (this.rnd() - .5) * .4, (this.rnd() - .5) * .4)); this.fx.sparksAt(q, 5, c); }
    this.fx.flash(b.add(new Vector3(0, 1.2, 0)), 1.2, new Color3(c.r, c.g, c.b));
  }

  private stepCast(h: Fighter, dt: number, i: HeroInput): void {
    const s = h.castDef!, p = s.power, col = Color3.FromHexString(s.color), c4 = new Color4(col.r, col.g, col.b, 1);
    const self = s.kernel === 'ward' || s.kernel === 'heal' || s.kernel === 'frenzy';
    const f = fwd(h.yaw), origin = h.pos.add(new Vector3(0, 1.2, 0));
    const foes = () => this.fighters.filter(t => t.team !== h.team && t.alive && t.standing);
    const cone = (range: number, arc: number) => foes().filter(t => Vector3.Distance(t.pos, h.pos) < range + t.radius && Math.abs(wrap(Math.atan2(t.pos.x - h.pos.x, t.pos.z - h.pos.z) - h.yaw)) < arc);
    const near = (c: Vector3, r: number) => foes().filter(t => Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < r + t.radius);
    const away = (t: Fighter, from = h.pos) => { const d = t.pos.subtract(from); d.y = 0; return d.lengthSquared() > 1e-4 ? d.normalize() : f.clone(); };
    const smash = (c: Vector3, r: number, force: number, arc = Math.PI) => { for (const pr of this.props) if (!pr.broken && !pr.solid && Vector3.Distance(pr.pos, c) < r && (arc >= Math.PI || Math.abs(wrap(Math.atan2(pr.pos.x - h.pos.x, pr.pos.z - h.pos.z) - h.yaw)) < arc)) this.hitProp(pr, pr.pos.subtract(c).normalize(), force, 2, true); };
    const el = s.element ?? (s.riders.find(r => r in ELEMENT_INFO) as Element | undefined);
    const ley = el && el === this.ley ? LEY_BONUS : 1;
    if (s.kernel === 'blink') {
      // Step: through space to the cursor (stopping short of walls), with the element bursting on arrival.
      if (!h.spellDone) {
        h.spellDone = true;
        const want = Math.min(9, Math.hypot(i.aim.x - h.pos.x, i.aim.z - h.pos.z));
        let d = want; while (d > .5 && this.cameraBlocked(h.pos.x + f.x * d, .5, h.pos.z + f.z * d)) d -= .5;
        const from = h.pos.clone(); if (el) this.vfx.burst(el, from.add(new Vector3(0, 1, 0)), .8);
        h.pos.addInPlace(f.scale(d)); h.iframe = .4;
        if (el) { this.vfx.burst(el, h.pos.add(new Vector3(0, 1, 0)), 1.1); if (el === 'storm') this.vfx.bolt(from.add(new Vector3(0, 1.2, 0)), h.pos.add(new Vector3(0, 1.2, 0))); }
        for (const t of near(h.pos, 2.4)) this.skillHit(h, t, s, 18 * ley, away(t), 5);
        this.ev.sound('whoosh');
      }
      if (h.st > .3) this.toIdle(h);
      return;
    }
    if (s.kernel === 'dash') {
      // Blink Strike / Shadow Step: a fast committed dash; everything passed through is cut once.
      if (h.st < .26) {
        h.pos.addInPlace(f.scale(24 * dt));
        if (this.rnd() < .8) this.fx.sparksAt(origin.clone(), 4, c4);
        for (const t of near(h.pos, 1.5)) if (!h.dashHit.has(t)) { h.dashHit.add(t); this.skillHit(h, t, s, 26, away(t), 4); }
      }
      if (h.st > .42) this.toIdle(h);
      return;
    }
    const release = self ? .12 : .2;
    if (!h.spellDone && h.st >= release) {
      h.spellDone = true;
      const aimD = Math.min(12, Math.hypot(i.aim.x - h.pos.x, i.aim.z - h.pos.z)), at = h.pos.add(f.scale(aimD));
      if (el && s.kernel !== 'chain' && s.kernel !== 'bolt' && s.kernel !== 'cone') this.vfx.burst(el, origin.add(f.scale(.8)), .35);
      switch (s.kernel) {
        case 'bolt': {   // Bolt spells: an elemental missile at the cursor
          const dir = at.subtract(h.pos); dir.y = 0; if (dir.lengthSquared() < .01) dir.copyFrom(f); dir.normalize();
          this.launch(h, el ?? 'flame', origin.add(dir.scale(.7)), dir, p * ley, 20);
          break;
        }
        case 'field': {   // Field spells: a lasting zone at the cursor whose element ticks every half second
          const e = el ?? 'frost';
          this.fields.push({ x: at.x, z: at.z, r: e === 'gravity' ? 4.5 : 4, t: 7, p: p * ley, e, tick: 0, owner: h, fx: this.vfx.field(e, at, e === 'gravity' ? 4.5 : 4) });
          this.vfx.burst(e, at.add(new Vector3(0, .5, 0)), 1); this.ev.sound('clay', .5); break;
        }
        case 'imbue': {   // Weave spells: the drawn weapon carries the element
          this.imbue = { e: el ?? 'flame', t: 20, p: p * ley };
          this.vfx.burst(this.imbue.e, origin, .7); this.ev.word?.(origin.add(new Vector3(0, 1.2, 0)), `${ELEMENT_INFO[this.imbue.e].name.toUpperCase()} WEAVE`, ELEMENT_INFO[this.imbue.e].color); break;
        }
        case 'cone':   // Ember / Hundred Fists: a short forward cone
          for (let d = 1.2; d < 7; d += 1.1) for (const sd of [-1, 0, 1]) this.fx.sparksAt(origin.add(f.scale(d)).add(new Vector3(f.z, 0, -f.x).scale(sd * d * .35)), 10, s.riders.includes('flame') ? new Color4(1, .5 + this.rnd() * .3, .1, 1) : c4);
          this.fx.flash(origin.add(f.scale(2)), 2.6, col);
          if (el) { this.vfx.spray(el, origin.add(f.scale(.6)), f, 7, .62); this.vfx.burst(el, origin.add(f.scale(5.5)), .7); }
          for (const t of cone(7, .62)) this.skillHit(h, t, s, 22 * ley, away(t), el === 'swift' || el === 'water' ? 9 : 3);
          smash(h.pos, 6, 3, .6); this.ev.sound('heavy'); break;
        case 'wave':   // Gust / Reaving Cleave: force wave, knocks down, breaks guards and furniture
          for (let d = 1; d < 8; d += 1.6) this.fx.ring(h.pos.add(f.scale(d)), 1.8 + d * .4, .45, col);
          this.fx.dustAt(h.pos.add(f.scale(3)), 18);
          for (const t of cone(8, .7)) this.skillHit(h, t, s, 12, away(t), 16, true);
          smash(h.pos, 7.5, 12, .7); this.fx.shake = Math.max(this.fx.shake, .35); this.ev.sound('heavy'); break;
        case 'ward':
          if (el === 'time') {   // Rewind: health returns to what it was three seconds ago
            const back = this.hpHistory[0] ?? h.hp; h.hp = Math.min(h.maxHp, Math.max(h.hp, back)); this.vfx.clockRing(h.pos.add(new Vector3(0, .1, 0)), 2, 1.2); this.ev.word?.(origin.add(new Vector3(0, 1.2, 0)), 'REWIND', ELEMENT_INFO.time.color); break;
          }
          this.wardHp = Math.max(this.wardHp, 220 * p * (el === 'iron' ? 1.6 : 1)); this.wardT = 9; this.wardEl = el ?? null;
          if (el === 'verdance') this.regenT = 6;
          if (el === 'shadow') this.veilT = 5;
          if (el) this.vfx.burst(el, origin, 1); this.fx.ring(h.pos, 3.2, .7, col); this.fx.flash(origin, 2.6, col); this.ev.sound('block', .6); break;
        case 'sigil':
          this.fields.push({ x: at.x, z: at.z, r: 4, t: 7, p, e: 'frost', tick: 0, owner: h, fx: this.vfx.field('frost', at, 4) }); this.ev.sound('clay', .5); break;
        case 'nova':   // Immolate / Thunderclap / Whirlwind: a burst around the hero
          this.fx.ring(h.pos, 8.5, .55, col); this.fx.ring(h.pos, 5, .4, col); this.fx.flash(origin, 3, col);
          for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; this.fx.sparksAt(origin.add(new Vector3(Math.sin(a) * 2.6, -.4, Math.cos(a) * 2.6)), 8, c4); }
          if (el) { this.vfx.burst(el, origin, 2.2); this.vfx.ring(el, h.pos.add(new Vector3(0, .1, 0)), 4.2, .5); }
          if (el === 'verdance') { h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .12 * p); this.ev.damage(origin.add(new Vector3(0, 1, 0)), Math.round(h.maxHp * .12 * p), 'heal'); }
          if (el === 'gravity') for (const t of near(h.pos, 7)) t.vel.addInPlace(h.pos.subtract(t.pos).normalize().scale(9));
          for (const t of near(h.pos, 4.2)) this.skillHit(h, t, s, (el === 'time' ? 8 : 26) * ley, away(t), el === 'gravity' ? 0 : 7);
          smash(h.pos, 4.2, 6); this.fx.shake = Math.max(this.fx.shake, .3); this.ev.sound('heavy'); break;
        case 'chain': {   // Chain Lightning: nearest to the cursor, then leaps
          let cur = foes().filter(t => Vector3.Distance(t.pos, h.pos) < 12).sort((x, y) => Vector3.Distance(x.pos, at) - Vector3.Distance(y.pos, at))[0];
          let from = h.pos; const hit = new Set<Fighter>(); const jumps = 3 + s.riders.filter(r => r === 'storm').length * 2;
          for (let n = 0; cur && n < jumps; n++) {
            this.bolt(from, cur.pos, c4); hit.add(cur); this.skillHit(h, cur, s, 24 * (1 - n * .08), away(cur, from), 2.5);
            from = cur.pos; const last = cur;
            cur = foes().filter(t => !hit.has(t) && Vector3.Distance(t.pos, last.pos) < 7).sort((x, y) => Vector3.Distance(x.pos, last.pos) - Vector3.Distance(y.pos, last.pos))[0];
          }
          this.ev.sound('crit', .7); break;
        }
        case 'heal':
          h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .25 * p); this.fx.ring(h.pos, 3.6, .8, col); this.ev.damage(origin.add(new Vector3(0, 1, 0)), Math.round(h.maxHp * .25 * p), 'heal'); this.ev.sound('level', .6); break;
        case 'frenzy':
          this.frenzyT = 8; this.frenzyP = p; this.frenzyLeech = s.riders.includes('blood') ? .08 : 0;
          if (s.riders.includes('iron')) { this.wardHp = Math.max(this.wardHp, 120 * p); this.wardT = 8; }
          this.fx.ring(h.pos, 3.4, .6, col); this.fx.flash(origin, 2.4, col); this.ev.sound('heavy', .7); break;
        case 'spear': {   // Bone Spear / Earthsplitter: spikes erupt along a line
          const hit = new Set<Fighter>();
          for (let d = 1.4; d < 10; d += 1.15) {
            const q = h.pos.add(f.scale(d)); this.fx.dustAt(q, 8); this.fx.sparksAt(q.add(new Vector3(0, .4, 0)), 7, c4); if (el) this.vfx.burst(el, q.add(new Vector3(0, .5, 0)), .55);
            for (const t of near(q, 1.1)) if (!hit.has(t)) { hit.add(t); this.skillHit(h, t, s, 30, f.add(new Vector3(0, .6, 0)).normalize(), 9, true); }
            smash(q, 1.4, 8);
          }
          this.fx.shake = Math.max(this.fx.shake, .3); this.ev.sound('heavy'); break;
        }
        case 'volley': {   // Volley: an arrow at every foe ahead
          const ts = foes().filter(t => Vector3.Distance(t.pos, h.pos) < 16 && Math.abs(wrap(Math.atan2(t.pos.x - h.pos.x, t.pos.z - h.pos.z) - h.yaw)) < 1).slice(0, 6);
          for (const t of ts) { this.bolt(h.pos, t.pos, new Color4(1, .9, .6, 1)); this.skillHit(h, t, s, 20, away(t), 3); }
          this.ev.sound('whoosh'); break;
        }
        case 'meteor':   // Falling Star: impact at the cursor
          this.fx.ring(at, 9, .7, col); this.fx.ring(at, 5, .5, new Color3(1, 1, .8)); this.fx.flash(at.add(new Vector3(0, 1, 0)), 5, col); this.fx.dustAt(at, 30);
          for (let k = 0; k < 6; k++) this.fx.sparksAt(at.add(new Vector3(0, 6 - k, 0)), 10, c4);
          for (const t of near(at, 3.8)) this.skillHit(h, t, s, 60, away(t, at), 11, true);
          smash(at, 4, 12); this.fx.shake = Math.max(this.fx.shake, .6); this.ev.sound('heavy'); break;
        case 'cataclysm': {   // Confluence ultimates: every part's rider, a room-sized shockwave
          for (const [k, r] of [8, 11, 15].entries()) this.fx.ring(h.pos, r, .5 + k * .15, k === 1 ? new Color3(1, 1, 1) : col);
          this.fx.flash(origin, 5, col); this.fx.dustAt(h.pos, 30);
          for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; this.fx.sparksAt(h.pos.add(new Vector3(Math.sin(a) * 4.5, .5, Math.cos(a) * 4.5)), 10, c4); }
          for (const t of near(h.pos, 7)) this.skillHit(h, t, s, 55, away(t), 12, true);
          if (s.riders.includes('iron') || s.riders.includes('bone')) { this.wardHp = Math.max(this.wardHp, 160 * p); this.wardT = 9; }
          if (s.riders.includes('verdance')) h.hp = Math.min(h.maxHp, h.hp + h.maxHp * .15);
          smash(h.pos, 7, 14); this.fx.shake = Math.max(this.fx.shake, .7); this.hitstop = Math.max(this.hitstop, .08); this.ev.sound('heavy'); break;
        }
      }
    }
    if (h.st > .62) this.toIdle(h);
  }

  /** One frame of lunge: a half-sine velocity profile over the wind-up and strike, damped when a foe is already in reach. */
  private lungeStep(f: Fighter, a: AttackDef, clipDt: number): number {
    const k = Math.min(1, f.atkT / a.active[1]);
    let v = a.lunge * Math.PI / 2 * Math.sin(Math.PI * k) / a.active[1];
    for (const t of this.fighters) {
      if (t.team === f.team || !t.standing) continue;
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d < a.range * .55 + t.radius && Math.abs(wrap(Math.atan2(dx, dz) - f.yaw)) < 1) { v *= .15; break; }
    }
    return v * clipDt;
  }

  /** Soft aim assist: nudge the swing toward the nearest foe near the cursor direction. */
  private assist(h: Fighter, yaw: number, range: number): number {
    let best = yaw, bestD = Infinity;
    for (const f of this.fighters) {
      if (f.team === h.team || !f.standing) continue;
      const dx = f.pos.x - h.pos.x, dz = f.pos.z - h.pos.z, d = Math.hypot(dx, dz);
      if (d > range + 1.5) continue;
      const a = Math.atan2(dx, dz); if (Math.abs(wrap(a - yaw)) > .6) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  private toIdle(f: Fighter): void {
    f.anim.legLayer(null);
    f.state = 'idle'; f.st = 0; f.label = 'Idle'; f.atk = null;
    if (f.trail) f.trail.active = false;
    f.anim.play(this.idleOf(f), { loop: true, fade: .32 });
  }

  private startAttack(f: Fighter, a: AttackDef, yaw: number): void {
    f.state = 'attack'; f.st = 0; f.atk = a; f.atkT = 0; f.atkHits.clear(); f.queued = false; f.label = a.label ?? 'Attacking';
    f.yaw = turnTo(f.yaw, f.role === 'hero' ? this.assist(f, yaw, a.range) : yaw, Math.PI * .22);
    f.anim.play(a.clip, { speed: a.speed * (f.role === 'hero' ? this.atkSpeed : 1), fade: f.state === 'attack' ? .16 : .12, restart: true });
    if (f.role !== 'foe' && a.arc > 0) this.ev.sound(a.heavy || a.damage > 40 ? 'heavy' : 'whoosh', f.role === 'hero' ? 1 : .5);
  }

  private endAttack(f: Fighter): void { f.atk = null; if (f.trail) f.trail.active = false; f.cancelTell?.(); f.cancelTell = null; }

  // ------------------------------------------------------------------ striking
  /** Resolve a melee swing's active window against foes and props. */
  private swing(f: Fighter, a: AttackDef): void {
    const live = f.atkT >= a.active[0] && f.atkT <= a.active[1];
    if (f.trail) f.trail.active = live || f.state === 'spin';
    if (!live && f.state !== 'spin') return;
    const range = a.range * (f.role === 'hero' ? this.mods.range : 1);
    const dir = fwd(f.yaw);
    let landed = 0;
    for (const t of this.fighters) {
      if (t.team === f.team || !t.standing || t.state === 'spawn' && t.st < .5) continue;
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d > range + t.radius) continue;
      if (d > .5 && Math.abs(wrap(Math.atan2(dx, dz) - f.yaw)) > a.arc + .15) continue;
      const last = f.atkHits.get(t);
      if (last !== undefined && (!a.multi || this.time - last < a.multi)) continue;
      f.atkHits.set(t, this.time);
      const push = d > .01 ? new Vector3(dx / d, 0, dz / d) : dir;
      if (this.damage(t, a.damage, push, a.knock, !!a.heavy, f)) landed++;
    }
    for (const p of this.props) {
      if (p.broken) continue;
      const c = this.closest(p, f.pos.x, f.pos.z), dx = c.x - f.pos.x, dz = c.z - f.pos.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const ca = Math.atan2(p.pos.x - f.pos.x, p.pos.z - f.pos.z);
      if (d > .4 && Math.abs(wrap(ca - f.yaw)) > a.arc + .3) continue;
      const last = f.atkHits.get(p);
      if (last !== undefined && (!a.multi || this.time - last < a.multi * 1.5)) continue;
      f.atkHits.set(p, this.time);
      this.hitProp(p, new Vector3(p.pos.x - f.pos.x, 0, p.pos.z - f.pos.z).normalize(), a.knock, a.heavy ? 2 : 1, f.role === 'hero');
      landed++;
    }
    if (landed && f.role === 'hero') { this.hitstop = Math.max(this.hitstop, a.hitstop); this.fx.shake = Math.max(this.fx.shake, a.shake); }
  }

  /** Apply damage. Returns true if it landed (not blocked or dodged). */
  damage(t: Fighter, amount: number, push: Vector3, knock: number, heavy: boolean, src: Fighter | null): boolean {
    if (!t.standing || t.iframe > 0) return false;
    const fromYaw = Math.atan2(-push.x, -push.z);
    const facing = Math.abs(wrap(fromYaw - t.yaw)) < 1.25;
    const chest = t.pos.add(new Vector3(0, 1.3, 0));
    // Shields: the hero's guard and skeleton warriors' tower shields stop frontal blows unless heavy.
    const shieldUp = !this.ignoreGuard && ((t.state === 'guard' && facing) || (t.foe?.shield && facing && !t.busy && this.rnd() < .7));
    if (!this.ignoreGuard && t.role === 'hero' && t.state === 'guard' && facing && t.st < .25 && src) {
      // Parry: a guard raised just in time staggers the attacker and refunds stamina.
      this.endAttack(src); src.state = 'hit'; src.st = -.4; src.label = 'Parried'; src.vel.addInPlace(push.scale(-6));
      src.anim.play(this.pick(this.ms(src).hit), { speed: 1, fade: .08, restart: true });
      t.energy = Math.min(100, t.energy + 25); this.hitstop = .12; this.fx.shake = .3; this.parries++; this.onParry?.();
      this.fx.flash(chest.add(push.scale(-.5)), 2.4, new Color3(1, .95, .7)); this.fx.ring(t.pos, 3.5, .4, new Color3(1, .95, .7));
      this.ev.damage(chest, 0, 'block'); this.ev.sound('block'); return false;
    }
    if (shieldUp && !heavy) {
      this.fx.sparksAt(chest.add(push.scale(-.5)), 18, new Color4(.8, .9, 1, 1)); this.fx.flash(chest.add(push.scale(-.5)), 1, new Color3(.7, .85, 1));
      t.vel.addInPlace(push.scale(knock * .35));
      if (t.role !== 'hero' || t.state !== 'guard') { t.state = 'hit'; t.st = 0; t.label = 'Blocking'; t.anim.play(this.ms(t).block, { speed: 1.6, fade: .05, restart: true }); }
      else t.anim.play(this.ms(t).block, { speed: 1.8, fade: .04, restart: true });
      this.ev.damage(chest, 0, 'block'); this.ev.sound('block');
      if (src?.role === 'hero') { this.hitstop = Math.max(this.hitstop, .05); this.fx.shake = Math.max(this.fx.shake, .12); }
      return false;
    }
    let dmg = amount;
    if (t.role === 'hero' && src?.role === 'foe' && this.veilT > 0 && this.rnd() < .5) { this.ev.word?.(chest, 'MISS', '#9a6ad0'); return false; }
    if (t.role === 'hero' && src?.role === 'foe' && this.wardHp > 0 && this.wardEl && src.alive) this.elementHit(t, src, this.wardEl, 1, amount * .3);
    if (t.role === 'hero' && this.wardHp > 0 && !this.ignoreGuard) { const ab = Math.min(this.wardHp, dmg); this.wardHp -= ab; dmg -= ab; this.fx.sparksAt(chest, 12, new Color4(.5, .75, 1, 1)); if (dmg <= 0) { this.ev.damage(chest, 0, 'block'); this.ev.sound('block', .6); return false; } }
    let crit = false;
    if (src?.role === 'hero' || src?.role === 'ally') {
      dmg *= (src.role === 'hero' ? (this.mods.damage * this.bonus.damage) * this.comboMul * (this.frenzyT > 0 ? 1 + .25 * this.frenzyP : 1) : 1);
      crit = this.rnd() < (src.role === 'hero' ? this.gearStats.crit : .12); if (crit) dmg *= 1.8;
    }
    if (t.state === 'guard' && heavy) { dmg *= .5; }
    if (src?.role === 'hero') dmg *= this.weaponMul[this.weapon] ?? 1;
    if (src?.role === 'foe') dmg *= src.dmgMul;
    if (t.role === 'hero') dmg *= (1 - this.armor) * (this.potion.stone > 0 ? .6 : 1);
    if (src?.role === 'hero') dmg *= (this.potion.might > 0 ? 1.3 : 1) * (t.shredT > 0 ? 1.2 : 1);
    if (t.frozenT > 0 && src?.role === 'hero' && (heavy || crit) && !this.inSkill) { dmg *= 2.5; t.frozenT = 0; this.ev.word?.(chest, 'SHATTER', ELEMENT_INFO.frost.color); this.vfx.burst('frost', chest, 1.4); }
    if (t.foe && !t.god) dmg *= 1 - t.foe.armor * (heavy ? .3 : 1) * .5;
    if (t.god) dmg *= t.godArmor;
    dmg = Math.max(1, Math.round(dmg * (.9 + this.rnd() * .2)));
    t.hp -= dmg; t.lastHurt = this.time; t.flash = .09;
    if (src?.role === 'hero') { const leech = this.gearStats.leech + (this.frenzyT > 0 ? this.frenzyLeech : 0); if (leech > 0) src.hp = Math.min(src.maxHp, src.hp + dmg * leech); }
    if (t.role === 'hero' && src?.role === 'foe' && src.alive && this.gearStats.thorns > 0) { src.hp -= dmg * this.gearStats.thorns; src.flash = .09; if (src.hp <= 0) this.kill(src, push.scale(-1), 1, false); }
    this.fx.sparksAt(chest.add(push.scale(-.3)), crit ? 40 : 24);
    this.fx.sparksAt(chest.add(push.scale(-.2)), crit ? 30 : 16, new Color4(.7, .04, .03, 1));
    this.fx.flash(chest.add(push.scale(-.3)), crit ? 2 : 1.3);
    this.fx.ring(t.pos, heavy ? 3.2 : 2.2, .35);
    this.ev.damage(chest, dmg, t.role === 'hero' ? 'hurt' : crit ? 'crit' : 'hit');
    this.ev.sound(t.role === 'hero' ? 'hurt' : crit ? 'crit' : 'hit', t.role === 'ally' ? .5 : 1);
    if (src?.role === 'hero') { this.combo.hits++; this.combo.timer = 3.5; this.onHeroHit?.(t, dmg, crit); }
    if (src?.role === 'hero' && !this.inSkill && t.timeT > 0 && t.alive && ++t.ruptureHits >= 3) { t.timeT = 0; t.ruptureHits = 0; this.vfx.clockRing(t.pos.add(new Vector3(0, .1, 0)), 2.4, .9); this.ev.word?.(chest.add(new Vector3(0, .9, 0)), 'RUPTURE', ELEMENT_INFO.time.color); this.inSkill = true; this.damage(t, dmg * 2.5, push, 2, false, src); this.inSkill = false; }
    // Imbued weapons: ordinary blows (melee and arrows) carry the element.
    if (src?.role === 'hero' && !this.inSkill && t.alive) {
      const e = this.imbue?.e ?? this.weaponImbue[this.weapon];
      if (e) { this.inSkill = true; this.elementHit(src, t, e, this.imbue?.p ?? .7, dmg * .35); this.inSkill = false; }
    }
    if (t.role === 'hero') { t.iframe = .45; this.fx.shake = Math.max(this.fx.shake, .45); }
    const kb = knock * (t.role === 'hero' ? .5 : 1) * (t.foe ? 1 - t.foe.armor * .5 : 1);
    t.vel.addInPlace(push.scale(kb));
    if (t.hp <= 0 && t.role === 'hero' && this.spareHero) { t.hp = 1; this.spareHero(); return false; }
    if (t.hp <= 0) { this.kill(t, push, knock, heavy || crit); return true; }
    if (t.god) return false;   // a god does not stagger
    const poise = t.boss ? .8 : t.foe?.armor ?? 0;
    const stagger = t.role !== 'foe' ? t.state !== 'attack' || heavy : (!poise || (heavy && !t.boss) || this.rnd() > poise) && (t.state !== 'attack' || !t.boss);
    if (stagger && t.state !== 'spin') {
      this.endAttack(t); t.aimLine && this.aimLine(t, false);
      t.state = 'hit'; t.st = 0; t.label = 'Hit';
      t.anim.play(this.pick(this.ms(t).hit), { speed: 1.3, fade: .09, restart: true });
      if (t.role === 'foe') t.cd = Math.max(t.cd, .6 + this.rnd() * .6);
    }
    return true;
  }

  /**
   * Keep planted feet still on the ground: when the clip says a foot is in contact, its world position is
   * locked and the leg is solved (two-bone IK, knee plane from the animation) to stay on it while the body
   * moves over it; the foot keeps its animated orientation. Locks release as the clip lifts the foot, and
   * re-plant if the body has drifted too far (that becomes a step instead of a skate).
   */
  private plants=new WeakMap<Fighter,FootPlant>();
  private plantFeet(f:Fighter,dt:number):void {
    let plant=this.plants.get(f);if(!plant){plant=new FootPlant(f.inst);this.plants.set(f,plant);}
    plant.update(dt,f.y,f.yaw,f.alive&&f.state!=='down'&&f.state!=='dodge'&&f.y<=.05);
  }

  /** Walkable direction around walls toward a point, or null when the straight line is clear. */
  navDir(x: number, z: number, tx: number, tz: number): { x: number; z: number } | null { return this.nav ? this.nav.dir(x, z, tx, tz, this.time) : null; }

  /** Tower effects: damage from the hero's power without a weapon swing. */
  effectDamage(t: Fighter, amount: number, push: Vector3, knock = 2): boolean { return this.damage(t, amount, push, knock, false, null); }

  private kill(t: Fighter, push: Vector3, knock: number, violent: boolean): void {
    this.endAttack(t); this.aimLine(t, false);
    if (t.role === 'ally') { t.state = 'down'; t.st = 0; t.hp = 0; t.label = 'Down'; t.reviveT = 0; t.anim.play(this.pick(this.ms(t).death), { speed: 1.2, fade: .06 }); return; }
    if (t.role === 'hero') { t.alive = false; t.state = 'dead'; t.hp = 0; t.label = 'Dead'; t.anim.play(this.pick(this.ms(t).death), { fade: .05 }); this.ev.heroDown(); return; }
    t.alive = false; t.state = 'dead'; t.hp = 0; t.label = 'Dead'; this.kills++;
    // The dead come apart: a burst of bone shards and grave dust.
    if (t.foeKind?.startsWith('skeleton')) { const c = t.pos.add(new Vector3(0, 1.1, 0)); this.fx.sparksAt(c, 34, new Color4(.9, .86, .74, 1)); this.fx.dustAt(t.pos, 22, new Color4(.75, .72, .64, 1)); this.ev.sound('clay', .7); }
    this.ev.kill(t);
    this.gainXp(t.foe!.xp);
    // Violent kills throw the body; the rest fall where they stand. Bodies stay a while, then sink away.
    t.anim.play(this.pick(this.ms(t).death), { speed: 1.25, fade: .05 });
    t.vel.addInPlace(push.scale(violent ? knock * 1.5 + 6 : knock * .6));
    if (violent) { t.vy = 5 + this.rnd() * 3; this.fx.dustAt(t.pos.add(new Vector3(0, .3, 0)), 8); }
  }

  private hitProp(p: Prop, dir: Vector3, knock: number, dmg: number, byHero: boolean): void {
    if (p.broken) return;
    const top = p.pos.add(new Vector3(0, p.h * .6, 0));
    if (p.solid) { this.fx.sparksAt(top, 8, new Color4(.8, .8, .8, 1)); return; }
    if (byHero) { this.combo.hits++; this.combo.timer = 3.5; }
    if (p.loose) { this.launchLoose(p, dir.scale(4 + knock * .6)); return; }
    p.hp -= dmg;
    this.fx.sparksAt(top, 10, new Color4(1, .85, .55, 1));
    if (p.hp > 0) { p.wobble = 1; this.fx.dustAt(top, 6); this.ev.sound(p.key === 'pot' || p.key === 'jar' ? 'clay' : 'wood', .45); return; }
    this.breakProp(p, dir, 3 + knock * .7);
  }

  private breakProp(p: Prop, dir: Vector3, power: number): void {
    p.broken = true; this.smashed++;
    if (p.chest) this.onChest?.(p.pos.clone());
    const rot = Quaternion.RotationYawPitchRoll(p.yaw, 0, 0);
    const centre = p.pos.add(new Vector3(0, p.h * .5, 0));
    const clay = p.key === 'pot' || p.key === 'jar';
    this.ev.sound(clay ? 'clay' : 'wood');
    for (const src of this.assets.fragmentsOf(p.key)) {
      const off = this.assets.offsets.get(src.name)!.scale(p.scale);
      const wp = p.pos.add(off.applyRotationQuaternion(rot));
      const inst = src.createInstance(`${src.name}-x`); inst.scaling.setAll(p.scale); inst.rotationQuaternion = rot.clone(); inst.position.copyFrom(wp); inst.isPickable = false;
      const out = wp.subtract(centre); out.y = Math.max(0, out.y); const ol = out.length() || 1;
      const v = out.scale((clay ? 4 : 2.5) / ol * (.6 + this.rnd() * .8)).addInPlace(dir.scale(power * (.5 + this.rnd() * .7)));
      v.y += (clay ? 3 : 2) + this.rnd() * 4;
      const e = src.getBoundingInfo().boundingBox.extendSize;
      this.debris.add(inst, wp, v, new Vector3((this.rnd() - .5) * 18, (this.rnd() - .5) * 18, (this.rnd() - .5) * 18), Math.min(e.x, e.y, e.z) * p.scale + .01, clay ? .25 : .35);
    }
    for (const l of p.on) if (!l.broken) this.launchLoose(l, dir.scale(power * .8).add(new Vector3(0, 3, 0)));
    // Pots sometimes hide coins, as in the reference ("money drop").
    if (clay && this.rnd() < .35) for (let i = 0; i < 3; i++) {
      const c = this.assets.sources.get('L_coin')!.createInstance('coin'); c.isPickable = false;
      this.debris.add(c, centre, new Vector3((this.rnd() - .5) * 5, 5 + this.rnd() * 3, (this.rnd() - .5) * 5), new Vector3(this.rnd() * 20, 0, this.rnd() * 20), .04, .5);
    }
    this.fx.dustAt(centre, clay ? 14 : 22, clay ? new Color4(.6, .4, .3, .55) : undefined);
    this.fx.ring(p.pos, p.h * 1.6 + 1, .4, new Color3(1, .95, .85));
    this.debris.stir(p.pos.x, p.pos.z, 2.5, 4);
    p.mesh.dispose(); p.blob?.dispose(); p.blob = null;
  }

  private launchLoose(p: Prop, v: Vector3): void {
    p.broken = true;
    const m = p.mesh; m.rotationQuaternion = Quaternion.FromEulerAngles(0, p.yaw, 0);
    this.debris.add(m, m.position.clone(), v.add(new Vector3((this.rnd() - .5) * 2, 2 + this.rnd() * 3, (this.rnd() - .5) * 2)), new Vector3((this.rnd() - .5) * 14, (this.rnd() - .5) * 8, (this.rnd() - .5) * 14), .06, .45);
  }

  private closest(p: Prop, x: number, z: number): { x: number; z: number } {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const lx = (x - p.pos.x) * c - (z - p.pos.z) * s, lz = (x - p.pos.x) * s + (z - p.pos.z) * c;
    const cx = clamp(lx, -p.hx, p.hx), cz = clamp(lz, -p.hz, p.hz);
    return { x: p.pos.x + cx * c + cz * s, z: p.pos.z - cx * s + cz * c };
  }

  // ------------------------------------------------------------------ ranged
  private fireBolt(f: Fighter, power = 1, orb = false): void {
    const dir = fwd(f.yaw);
    if (f.target && f.role !== 'hero') { const d = f.target.pos.subtract(f.pos); d.y = 0; dir.copyFrom(d.normalize()); }
    const start = f.pos.add(dir.scale(.9)).add(new Vector3(0, 1.35, 0));
    let mesh: AbstractMesh;
    if (orb) { mesh = MeshBuilder.CreateSphere('orb', { diameter: .55, segments: 8 }, this.scene); mesh.material = this.orbMat; }
    else {
      const src = this.assets.sources.get(f.role === 'foe' ? 'W_sk_arrow' : 'W_arrow')!;
      mesh = src.createInstance('bolt'); mesh.scaling.setAll(1.3);
      mesh.rotationQuaternion = Quaternion.FromLookDirectionRH(dir, Vector3.Up()).multiply(Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2));
    }
    mesh.isPickable = false; mesh.position.copyFrom(start);
    const a = f.atk ?? f.foe?.attacks[0];
    this.shots.push({ mesh, pos: start, vel: dir.scale(orb ? 13 : 42), owner: f, dmg: (a?.damage ?? 30) * power, knock: a?.knock ?? 4, life: orb ? 2.4 : 1.2, kind: orb ? 'orb' : 'bolt', pierce: f.role === 'hero' ? 2 : 0, hit: new Set() });
    this.fx.flash(start, .7, orb ? new Color3(.8, .4, 1) : new Color3(1, .9, .6));
    this.ev.sound('shoot', f.role === 'hero' ? 1 : .5);
  }

  private stepShots(dt: number): void {
    for (const s of this.shots) {
      s.life -= dt; s.pos.addInPlace(s.vel.scale(dt)); s.mesh.position.copyFrom(s.pos);
      if (s.kind === 'orb') { s.mesh.scaling.setAll(1 + Math.sin(this.time * 30) * .15); }
      const team = s.owner.team;
      for (const t of this.fighters) {
        if (t.team === team || !t.standing || s.hit.has(t) || t.state === 'spawn') continue;
        if (Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > t.radius + .35) continue;
        s.hit.add(t);
        this.damage(t, s.dmg, s.vel.clone().normalize(), s.knock, s.kind === 'orb', s.owner);
        if (s.owner.role === 'hero') { this.hitstop = Math.max(this.hitstop, .035); this.fx.shake = Math.max(this.fx.shake, .1); }
        if (s.pierce-- <= 0) s.life = 0;
        if (s.kind === 'orb') this.burst(s);
      }
      if (s.life > 0) for (const p of this.props) {
        if (p.broken || p.loose) continue;
        const c = this.closest(p, s.pos.x, s.pos.z);
        if (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > .2 || s.pos.y > p.h + .2) continue;
        this.hitProp(p, s.vel.clone().normalize(), s.knock, s.kind === 'orb' ? 3 : 1, s.owner.role === 'hero');
        s.life = 0; if (s.kind === 'orb') this.burst(s);
        break;
      }
      if (Math.abs(s.pos.x) > ARENA + 4 || Math.abs(s.pos.z) > ARENA + 4) s.life = 0;
      if (s.life <= 0) s.mesh.dispose();
    }
    this.shots = this.shots.filter(s => s.life > 0);
  }

  private burst(s: Shot): void {
    this.fx.flash(s.pos, 3, new Color3(.8, .4, 1)); this.fx.ring(s.pos, 4, .5, new Color3(.8, .45, 1));
    this.fx.sparksAt(s.pos, 30, new Color4(.8, .5, 1, 1));
    for (const p of this.props) if (!p.broken && Vector3.Distance(p.pos, s.pos) < 2.2) this.hitProp(p, p.pos.subtract(s.pos).normalize(), 6, 3, false);
  }

  private aimLine(f: Fighter, on: boolean, at?: Vector3): void {
    if (!on) { f.aimLine?.setEnabled(false); return; }
    if (!f.aimLine) {
      f.aimLine = MeshBuilder.CreateBox('aim', { width: .06, height: .02, depth: 1 }, this.scene);
      f.aimLine.material = this.lineMat; f.aimLine.isPickable = false;
    }
    const to = at ?? f.target?.pos ?? f.pos.add(fwd(f.yaw).scale(10));
    const d = Math.min(26, Math.hypot(to.x - f.pos.x, to.z - f.pos.z) + 6);
    const y = Math.atan2(to.x - f.pos.x, to.z - f.pos.z);
    f.aimLine.setEnabled(true); f.aimLine.scaling.z = d; f.aimLine.rotation.y = y;
    f.aimLine.position.set(f.pos.x + Math.sin(y) * d / 2, 1.3, f.pos.z + Math.cos(y) * d / 2);
  }

  // ------------------------------------------------------------------ AI
  private nearest(f: Fighter, team: 'hero' | 'foe', bias = (t: Fighter) => 1): Fighter | null {
    let best: Fighter | null = null, bd = Infinity;
    for (const t of this.fighters) {
      if (t.team !== team || !t.standing || t.state === 'spawn') continue;
      const d = Vector3.Distance(t.pos, f.pos) * bias(t);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  private stepFoe(f: Fighter, dt: number): void {
    if (!f.alive) {
      return;
    }
    const d = f.foe!;
    f.st += dt; f.cd -= dt; f.think -= dt;
    if (f.state === 'spawn') { if (f.st > .85) this.toIdle(f); return; }
    if (f.state === 'hit') { if (f.st > .42) this.toIdle(f); return; }
    if (f.think <= 0 || !f.target?.standing) { f.target = this.nearest(f, 'hero', t => t.role === 'hero' ? .8 : 1); f.think = .4 + this.rnd() * .3; }
    const t = f.target;
    if (!t) { if (f.state !== 'idle') this.toIdle(f); return; }
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, dist = Math.hypot(dx, dz), toT = Math.atan2(dx, dz);

    if (f.state === 'tell') {
      f.yaw = turnTo(f.yaw, toT, dt * (d.ranged ? 6 : 3));
      if (d.ranged) this.aimLine(f, true);
      if (f.st >= d.tell) { this.aimLine(f, false); f.state = 'attack'; f.st = 0; f.anim.setSpeed(f.atk!.speed); }
      return;
    }
    if (f.state === 'attack') {
      const a = f.atk!;
      f.atkT += dt * a.speed;
      if (d.ranged) { if (f.atkT >= a.active[0] && !f.atkHits.size) { f.atkHits.set(this, 0); this.fireBolt(f, 1, d.ranged === 'orb'); } }
      else {
        if (a.lunge && f.atkT < a.active[1]) f.pos.addInPlace(fwd(f.yaw).scale(this.lungeStep(f, a, dt * a.speed)));
        if (f.atkT >= a.active[0]) { f.cancelTell?.(); f.cancelTell = null; }
        this.swing(f, a);
        if (f.atkT >= a.active[0] && f.atkT <= a.active[1] && f.atkHits.size) this.fx.shake = Math.max(this.fx.shake, t.role === 'hero' && f.atkHits.has(t) ? a.shake : 0);
      }
      if (f.atkT >= (a.end ?? 1)) { this.endAttack(f); f.cd = d.cooldown[0] + this.rnd() * (d.cooldown[1] - d.cooldown[0]); this.toIdle(f); }
      return;
    }
    // Approach, hold a ring, or wind up. A few attack tokens per target keep crowds fair.
    const attackers = this.fighters.filter(o => o.role === 'foe' && o.target === t && (o.state === 'tell' || o.state === 'attack')).length;
    const tokens = (t.role === 'hero' ? 3 : 2) + (d.tokens ? d.tokens - 2 : 0);
    const want = d.ranged ? 9 : d.reach * .85;
    if (f.cd <= 0 && attackers < tokens && dist <= (d.ranged ? d.reach : d.reach + .4) && (!d.ranged || dist > 3)) {
      const a = d.attacks[Math.floor(this.rnd() * d.attacks.length)];
      f.state = 'tell'; f.st = 0; f.atk = a; f.atkT = 0; f.atkHits.clear(); f.yaw = turnTo(f.yaw, toT, 1); f.label = 'Winding up';
      // Play the wind-up slowly so the swing lands right after the warning ends.
      f.anim.play(a.clip, { speed: Math.max(.05, a.active[0] * .55 / Math.max(d.tell, .01)), fade: .08, restart: true });
      f.atkT = a.active[0] * .55;
      if (!d.ranged) f.cancelTell = this.fx.telegraph(() => f.standing ? f.pos : null, () => f.yaw, a.range + 1, a.range * 2.2 * Math.max(.6, Math.sin(Math.min(a.arc, 1.4)) * 1.6), d.tell + .25);
      return;
    }
    let mx = 0, mz = 0, sp = f.speed * (f.slowT > 0 ? .55 : 1);
    if (dist > want + .6) { const nd = this.navDir(f.pos.x, f.pos.z, t.pos.x, t.pos.z); mx = nd ? nd.x : dx / dist; mz = nd ? nd.z : dz / dist; }
    else if (d.ranged && dist < want - 3) { mx = -dx / dist; mz = -dz / dist; sp *= .7; }
    else { mx = (-dz / dist) * f.strafe * .6; mz = (dx / dist) * f.strafe * .6; sp *= .45; if (this.rnd() < dt * .3) f.strafe *= -1; }
    if (attackers >= tokens && !d.ranged && dist < 4.5) { mx = -dx / dist * .5 + (-dz / dist) * f.strafe * .5; mz = -dz / dist * .5 + (dx / dist) * f.strafe * .5; sp *= .5; }
    if (mx || mz) {
      f.pos.x += mx * sp * dt; f.pos.z += mz * sp * dt;
      f.yaw = turnTo(f.yaw, dist < 7 ? toT : Math.atan2(mx, mz), dt * 8);
      f.state = 'move'; f.label = 'Moving';
      const fast = sp > 3.5;
      this.locoAnim(f, sp); void fast;
      this.debris.stir(f.pos.x, f.pos.z, .9, 1);
    } else if (f.state !== 'idle') this.toIdle(f);
    else f.yaw = turnTo(f.yaw, toT, dt * 6);
  }

  private stepAlly(f: Fighter, dt: number): void {
    f.st += dt; f.cd -= dt; f.think -= dt;
    if (f.state === 'down' || f.state === 'dead') return;
    if (f.state === 'revive') { if (f.st > 1.4) this.toIdle(f); return; }
    if (f.state === 'hit') { if (f.st > .35) this.toIdle(f); return; }
    const ranged = f.name === ALLIES.rogue.name;
    const defs = ranged ? ALLIES.rogue.attacks : ALLIES.barbarian.attacks;
    if (f.state === 'attack') {
      const a = f.atk!;
      f.atkT += dt * a.speed;
      if (ranged) { if (f.atkT >= a.active[0] && !f.atkHits.size) { f.atkHits.set(this, 0); this.fireBolt(f); } }
      else { if (a.lunge && f.atkT < a.active[1]) f.pos.addInPlace(fwd(f.yaw).scale(this.lungeStep(f, a, dt * a.speed))); this.swing(f, a); }
      if (f.atkT >= (a.end ?? 1)) { this.endAttack(f); f.cd = ranged ? .9 + this.rnd() * .5 : .5 + this.rnd() * .6; this.toIdle(f); }
      return;
    }
    if (f.think <= 0 || !f.target?.standing) { f.target = this.nearest(f, 'foe', t => (t.target === this.hero ? .7 : 1)); f.think = .5; }
    const t = f.target;
    const hd = Vector3.Distance(f.pos, this.hero.pos);
    let goal: Vector3 | null = null, face: number | null = null, run = true;
    if (t && Vector3.Distance(t.pos, this.hero.pos) < 18) {
      const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z, dist = Math.hypot(dx, dz), toT = Math.atan2(dx, dz);
      face = toT;
      const reach = ranged ? 11 : 2.9;
      if (dist <= reach && f.cd <= 0 && (!ranged || dist > 2.5)) { f.target = t; this.startAttack(f, defs[Math.floor(this.rnd() * defs.length)], toT); return; }
      if (dist > reach * .85) goal = t.pos; else if (ranged && dist < 5) goal = f.pos.add(f.pos.subtract(t.pos).normalize().scale(3));
    } else if (hd > 4.5) { goal = this.hero.pos.add(new Vector3(f.name === ALLIES.rogue.name ? 2.5 : -2.5, 0, 1.5)); run = hd > 7; }
    if (goal) {
      const dx = goal.x - f.pos.x, dz = goal.z - f.pos.z, dist = Math.hypot(dx, dz);
      if (dist > .3) {
        const sp = run ? f.speed : 2.4;
        const nd = this.navDir(f.pos.x, f.pos.z, goal.x, goal.z);
        f.pos.x += (nd ? nd.x : dx / dist) * sp * dt; f.pos.z += (nd ? nd.z : dz / dist) * sp * dt;
        f.yaw = turnTo(f.yaw, face ?? Math.atan2(dx, dz), dt * 9);
        f.state = 'move'; f.label = 'Moving';
        this.locoAnim(f, sp);
        this.debris.stir(f.pos.x, f.pos.z, 1, 1.2);
        return;
      }
    }
    if (face !== null) f.yaw = turnTo(f.yaw, face, dt * 8);
    if (f.state !== 'idle') this.toIdle(f);
  }

  private revive(f: Fighter): void {
    f.state = 'revive'; f.st = 0; f.hp = f.maxHp * .5; f.reviveT = 0; f.label = 'Reviving';
    f.anim.play('Lie_StandUp', { speed: 1.7, fade: .1 });
    this.fx.ring(f.pos, 3.5, .6, new Color3(.5, 1, .6)); this.ev.damage(f.pos.add(new Vector3(0, 2, 0)), Math.round(f.maxHp * .5), 'heal');
  }

  // ------------------------------------------------------------------ physics & waves
  private integrate(f: Fighter, dt: number): void {
    if (f.radius < 0) return;
    f.pos.addInPlace(f.vel.scale(dt));
    const sp = f.vel.length();
    // Bodies thrown hard into furniture smash it.
    if (sp > 5) for (const p of this.props) {
      if (p.broken || p.loose || p.solid) continue;
      const c = this.closest(p, f.pos.x, f.pos.z);
      if (Math.hypot(c.x - f.pos.x, c.z - f.pos.z) < f.radius + .1) this.hitProp(p, f.vel.clone().normalize(), sp * .5, p.hp, false);
    }
    f.vel.scaleInPlace(Math.max(0, 1 - dt * 7));
    f.pos.x = clamp(f.pos.x, -ARENA, ARENA); f.pos.z = clamp(f.pos.z, -ARENA, ARENA); f.pos.y = 0;
    if (!f.standing) return;
    for (const p of this.props) {
      if (p.broken || p.loose) continue;
      if (p.round) {
        const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z, d = Math.hypot(dx, dz), min = f.radius + p.hx;
        if (d < min && d > 1e-4) { f.pos.x = p.pos.x + dx / d * min; f.pos.z = p.pos.z + dz / d * min; }
        continue;
      }
      const c = this.closest(p, f.pos.x, f.pos.z), dx = f.pos.x - c.x, dz = f.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d < f.radius) { if (d > 1e-4) { f.pos.x = c.x + dx / d * f.radius; f.pos.z = c.z + dz / d * f.radius; } else { f.pos.x += f.radius; } }
    }
  }

  private separate(): void {
    const list = this.fighters.filter(f => f.standing && f.radius > 0 && f.state !== 'dodge');
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / d;
      const wa = a.role === 'hero' ? .2 : .5, wb = b.role === 'hero' ? .2 : .5, s = wa + wb;
      a.pos.x -= dx * push * wa / s; a.pos.z -= dz * push * wa / s;
      b.pos.x += dx * push * wb / s; b.pos.z += dz * push * wb / s;
    }
  }

  private stepWaves(dt: number): void {
    if (!this.autoWaves) return;
    const alive = this.fighters.filter(f => f.role === 'foe' && f.alive).length;
    if (alive > 0 || !this.hero.alive) return;
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.wave++;
    const roster = waveRoster(this.wave, this.rnd);
    for (const k of roster) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 12; tries++) {
        const a = this.rnd() * TAU, d = 9 + this.rnd() * 12;
        x = clamp(this.hero.pos.x + Math.cos(a) * d, -ARENA + 2, ARENA - 2); z = clamp(this.hero.pos.z + Math.sin(a) * d, -ARENA + 2, ARENA - 2);
        if (!this.props.some(p => !p.broken && !p.loose && Math.hypot(p.pos.x - x, p.pos.z - z) < Math.max(p.hx, p.hz) + 1)) break;
      }
      this.spawnFoe(k, x, z);
    }
    this.waveTimer = 3;
    this.ev.wave(this.wave, roster.length);
  }

  /** Throw six more foes at the hero right now (repeatable crowd testing). */
  spawnNow(): void {
    if (!this.wave) this.wave = 1;
    for (const k of waveRoster(Math.max(1, this.wave), this.rnd).slice(0, 6)) { const a = this.rnd() * TAU; this.spawnFoe(k, clamp(this.hero.pos.x + Math.cos(a) * 11, -ARENA + 2, ARENA - 2), clamp(this.hero.pos.z + Math.sin(a) * 11, -ARENA + 2, ARENA - 2)); }
  }

  private gainXp(n: number): void {
    this.xp += n;
    while (this.xp >= this.nextXp) { this.xp -= this.nextXp; this.level++; this.nextXp = Math.round(100 * Math.pow(this.level, 1.35)); this.ev.levelUp(this.level); }
  }

  respawnHero(): void {
    const h = this.hero; h.alive = true; h.hp = h.maxHp; h.state = 'idle'; h.iframe = 1.5; h.energy = 100;
    for (const f of this.fighters) if (f.role === 'foe' && f.alive && Vector3.Distance(f.pos, h.pos) < 6) f.vel.addInPlace(f.pos.subtract(h.pos).normalize().scale(14));
    this.fx.ring(h.pos, 7, .7, new Color3(1, .95, .7)); this.toIdle(h);
  }
}
