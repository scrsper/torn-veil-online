import type { LookId } from './looks';

/**
 * Attack and fighter data for the Combat Arena. Times are in clip seconds (speed 1); `speed` scales
 * playback, so a 1.3 s clip at speed 1.3 resolves in 1.0 s of game time.
 *
 * Motion is the user's Mixamo packs (Great Sword, Sword and Shield, Pro Longbow, Locomotion),
 * retargeted onto the MPFB people. Active windows come from the measured hand-speed peaks
 * (scripts/web/arena-clipinfo.ts -> .debug/arena/clipinfo.json), padded slightly for game feel.
 */
export interface AttackDef {
  clip: string;
  speed: number;
  /** Clip-time window in which the swing connects. */
  active: [number, number];
  /** Clip time from which a buffered follow-up starts. */
  cancel: number;
  /** Clip time at which the action ends (defaults to the clip's length). */
  end?: number;
  range: number;
  /** Half-angle of the swing arc, radians. */
  arc: number;
  damage: number;
  knock: number;
  /** Forward travel during wind-up and swing. */
  lunge: number;
  /** Re-hit interval for spinning attacks. */
  multi?: number;
  /** Breaks guards and shields, launches the dying. */
  heavy?: boolean;
  hitstop: number;
  shake: number;
  /** Movement speed allowed while the attack plays (whirlwinds). */
  move?: number;
  /** State label shown in the debug overlay. */
  label?: string;
}

/** The clips one way of fighting moves with. */
export interface Moveset { idle: string; walk: string; run: string; hit: string[]; death: string[]; block: string; guard: string; enter: string; runPace: number; walkPace?: number }
const GS = (n: string) => `great_sword/great sword ${n}`, SS = (n: string) => `sword_and_shield/sword and shield ${n}`, BOW = (n: string) => `pro_longbow/standing ${n}`;
const U = (n: string) => `unarmed/${n}`;
export const MOVESETS: Record<'fists' | 'greatsword' | 'sword' | 'bow' | 'caster', Moveset> = {
  fists: { idle: U('combat_idle'), walk: U('walk_forward'), run: U('run_sprint'), hit: [BOW('react small from front'), BOW('react small from headshot')], death: [BOW('death backward 01'), BOW('death forward 01')],
    block: U('slip_left'), guard: U('combat_idle'), enter: U('idle_neutral'), runPace: 7.4, walkPace: 1.9 },
  greatsword: { idle: GS('idle'), walk: GS('walk'), run: GS('run'), hit: [GS('impact'), GS('impact (3)'), GS('impact (5)')], death: ['great_sword/two handed sword death', 'great_sword/two handed sword death (2)'],
    block: GS('blocking'), guard: GS('idle (2)'), enter: GS('power up'), runPace: 6.2 },
  sword: { idle: SS('idle'), walk: SS('walk'), run: SS('run'), hit: [SS('impact'), SS('impact (2)'), SS('impact (3)')], death: [SS('death'), SS('death (2)')],
    block: SS('block'), guard: SS('block idle'), enter: SS('power up'), runPace: 6 },
  bow: { idle: BOW('idle 01'), walk: BOW('walk forward'), run: BOW('run forward'), hit: [BOW('react small from front'), BOW('react small from headshot')], death: [BOW('death backward 01'), BOW('death forward 01')],
    block: BOW('block'), guard: BOW('aim overdraw'), enter: BOW('equip bow'), runPace: 6.2 },
  caster: { idle: 'female_locomotion/idle', walk: 'female_locomotion/walking', run: 'female_locomotion/running', hit: [BOW('react small from front')], death: [SS('death (2)')],
    block: BOW('block'), guard: 'great_sword/spell cast', enter: 'sword_and_shield/sword and shield casting (2)', runPace: 6 },
};
/** Evasive rolls/steps for anyone, by direction relative to facing. */
/** Relaxed, unarmed-looking locomotion for when the hero is out of combat (weapon on the back). */
// The unarmed (Motifect) set, not the packed Mixamo `locomotion/*` clips: measured on the creator rig, those stand with
// ~50 deg bent knees and a forward slump even at rest (in the packed source itself, not added by the retarget), while
// idle_neutral / walk_forward / run_sprint stand and move upright. Combat stances keep their deliberate crouch.
// No licensed clip is a jog at the default pace: run_jog's measured stride is 1.4 u/s (slower than walk_forward's 1.7) and
// every run clip is 5.1-6.6 u/s, so the run nearest the jog speed (run_sprint, 5.6) covers jog and sprint.
export const RELAXED = { idle: U('idle_neutral'), walk: U('walk_forward'), run: U('run_sprint'), walkPace: 1.5 };
export const DODGES = { forward: BOW('dodge forward'), back: BOW('dodge backward'), left: BOW('dodge left'), right: BOW('dodge right'), roll: U('roll_forward') };
export type DodgeKind = keyof typeof DODGES;
/** Bodies for evasion that carry no weapon pose of their own (Motifect unarmed set). */
export const DODGE_BODY: Record<DodgeKind, string> = { forward: U('dodge_forward'), back: U('dodge_back'), left: U('dodge_left'), right: U('dodge_right'), roll: U('roll_forward') };
/**
 * The dodge a weapon set plays. The longbow dodges hold a bow in both hands, so with a sword and shield (or a great sword)
 * the blade was gripped two-handed in front and the shield left its arm; those sets play the unarmed dodge body with their
 * own idle arms (READY_CLIPS), fists the unarmed dodge itself, the bow its own.
 */
export function dodgeClip(set: keyof typeof MOVESETS, kind: DodgeKind): string {
  return set === 'sword' ? `ready/sword and shield dodge ${kind}` : set === 'greatsword' ? `ready/great sword dodge ${kind}` : set === 'bow' ? DODGES[kind] : DODGE_BODY[kind];
}
/**
 * Ready-stance clips (hero, sword and shield), composed at load by assets.ts layeredClip: [upright body source, weapon-arm
 * source]. The packed sword-and-shield idle/walk/run carry a deep crouch and forward spine (measured on the creator rig:
 * 22-51 deg trunk lean). The body (pelvis, spine, neck, head, legs) comes from the upright unarmed set; clavicles, arms,
 * hands and fingers keep the authored sword-and-shield grips. Guard and attack clips are untouched.
 */
export const READY_CLIPS: Record<string, [string, string]> = {
  'ready/sword and shield idle': [U('idle_neutral'), SS('idle')],
  'ready/sword and shield walk': [U('walk_forward'), SS('walk')],
  'ready/sword and shield jog': [U('run_jog'), SS('run')],
  'ready/sword and shield run': [U('run_sprint'), SS('run')],
  ...Object.fromEntries((Object.keys(DODGE_BODY) as DodgeKind[]).flatMap(k => [
    [`ready/sword and shield dodge ${k}`, [DODGE_BODY[k], SS('idle')]],
    [`ready/great sword dodge ${k}`, [DODGE_BODY[k], GS('idle')]],
  ])),
};

export type WeaponId = 'fists' | 'greatsword' | 'axe' | 'bow';
export interface WeaponDef {
  id: WeaponId; name: string; key: string; set: keyof typeof MOVESETS;
  combo: AttackDef[];
  /** Held secondary: whirlwind, guard, or aimed shot. */
  secondary: 'spin' | 'guard' | 'aim' | 'kick';
  kick?: AttackDef;
  spin?: AttackDef;
  bash?: AttackDef;
  aimed?: AttackDef;
  /** Heavy attacks (RMB): slower, chargeable by holding, chain into each other and finish light combos. */
  heavy?: AttackDef[];
  attach?: { r?: string; l?: string };
  /**
   * Presentation only: carried on the left forearm with a right-hand weapon (the sword-and-shield clips hold one).
   * A project catalog item (`I_<catalog id>`, or a recorded render variant of one, loaded by ArenaAssets.loadCatalogItems).
   */
  offhand?: string;
  trail: number;
}

const D = Math.PI / 180;
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: {
    id: 'fists', name: 'Bare hands', key: 'F1', set: 'fists', secondary: 'kick', trail: 0,
    combo: [
      { clip: U('jab_left'), speed: 1.7, active: [0.48, 0.68], cancel: 0.7, end: 0.95, range: 2.4, arc: 40 * D, damage: 14, knock: 1.5, lunge: .6, hitstop: .045, shake: .08, label: 'Jab' },
      { clip: U('cross_right'), speed: 1.7, active: [0.36, 0.62], cancel: 0.66, end: 0.95, range: 2.5, arc: 40 * D, damage: 18, knock: 2.5, lunge: .8, hitstop: .05, shake: .12, label: 'Cross' },
      { clip: U('hook_left'), speed: 1.6, active: [0.44, 0.7], cancel: 0.74, end: 1.0, range: 2.4, arc: 70 * D, damage: 20, knock: 3, lunge: .7, hitstop: .055, shake: .14, label: 'Hook' },
      { clip: U('uppercut_right'), speed: 1.55, active: [0.28, 0.5], cancel: 0.56, end: 0.9, range: 2.3, arc: 45 * D, damage: 24, knock: 4, lunge: .6, hitstop: .07, shake: .2, label: 'Uppercut' },
      { clip: U('roundhouse_right'), speed: 1.45, active: [0.2, 0.56], cancel: 0.9, end: 1.1, range: 2.9, arc: 110 * D, damage: 34, knock: 9, lunge: 1, heavy: true, hitstop: .09, shake: .35, label: 'Roundhouse' },
    ],
    heavy: [
      { clip: U('heavy_cross'), speed: 1.25, active: [0.5, 0.84], cancel: 0.92, end: 1.3, range: 2.7, arc: 45 * D, damage: 32, knock: 8, lunge: 1.1, heavy: true, hitstop: .09, shake: .3, label: 'Heavy cross' },
      { clip: U('side_kick'), speed: 1.3, active: [0.12, 0.54], cancel: 0.9, end: 1.1, range: 3, arc: 40 * D, damage: 34, knock: 13, lunge: 1.2, heavy: true, hitstop: .1, shake: .38, label: 'Side kick' },
    ],
    kick: { clip: U('side_kick'), speed: 1.45, active: [0.12, 0.54], cancel: 0.85, end: 1.05, range: 3, arc: 40 * D, damage: 30, knock: 12, lunge: 1.2, heavy: true, hitstop: .09, shake: .35, label: 'Side kick' },
  },
  greatsword: {
    id: 'greatsword', name: 'Oathbreaker', key: 'F2', set: 'greatsword', secondary: 'spin', attach: { r: 'W_oathbreaker' }, trail: 1.75,
    combo: [
      { clip: GS('slash'), speed: 1.3, active: [0.42, 0.84], cancel: 0.86, end: 1.12, range: 3.6, arc: 95 * D, damage: 32, knock: 4, lunge: 1.2, hitstop: .06, shake: .2, label: 'Attacking' },
      { clip: GS('slash (4)'), speed: 1.4, active: [0.26, 0.86], cancel: 0.9, end: 1.3, range: 3.6, arc: 100 * D, damage: 36, knock: 5, lunge: 1.4, hitstop: .065, shake: .25, label: 'Attacking' },
      { clip: GS('slash (3)'), speed: 1.4, active: [0.64, 1.2], cancel: 1.24, end: 1.55, range: 3.8, arc: 60 * D, damage: 50, knock: 7, lunge: 1.8, hitstop: .085, shake: .38, label: 'Attacking' },
      { clip: GS('high spin attack'), speed: 1.3, active: [0.78, 1.42], cancel: 1.6, end: 1.85, range: 3.8, arc: 180 * D, damage: 30, knock: 8, lunge: 2.2, multi: .22, heavy: true, hitstop: .08, shake: .4, label: 'Spin finisher' },
    ],
    heavy: [
      { clip: GS('attack'), speed: 1.0, active: [0.36, 0.64], cancel: 0.84, end: 1.2, range: 3.9, arc: 60 * D, damage: 58, knock: 9, lunge: 1.5, heavy: true, hitstop: .11, shake: .45, label: 'Heavy cleave' },
      { clip: GS('jump attack'), speed: 1.1, active: [0.9, 1.9], cancel: 1.95, end: 2.15, range: 4.1, arc: 70 * D, damage: 72, knock: 12, lunge: 3.2, heavy: true, hitstop: .13, shake: .55, label: 'Leaping slam' },
    ],
    // Held whirlwind: the KayKit spin loop (no looping spin exists in the Mixamo packs).
    spin: { clip: '2H_Melee_Attack_Spinning', speed: 1.25, active: [0, 99], cancel: 0, range: 3.5, arc: 180 * D, damage: 15, knock: 5, lunge: 0, multi: .19, heavy: true, hitstop: .03, shake: .14, move: 4.2, label: 'Whirlwind' },
  },
  axe: {
    id: 'axe', name: 'Widow Cleaver', key: 'F3', set: 'sword', secondary: 'guard', attach: { r: 'W_widow-cleaver' }, offhand: 'I_TV-081v', trail: 1.1,
    combo: [
      { clip: SS('slash'), speed: 1.35, active: [0.48, 0.76], cancel: 0.8, end: 1.05, range: 3, arc: 80 * D, damage: 24, knock: 2.5, lunge: 1, hitstop: .05, shake: .12, label: 'Attacking' },
      { clip: SS('attack (4)'), speed: 1.25, active: [0.36, 0.6], cancel: 0.64, end: 0.9, range: 3, arc: 90 * D, damage: 26, knock: 3, lunge: 1, hitstop: .05, shake: .14, label: 'Attacking' },
      { clip: SS('slash (5)'), speed: 1.35, active: [0.44, 0.76], cancel: 0.82, end: 1.1, range: 3.1, arc: 70 * D, damage: 30, knock: 4.5, lunge: 1.2, hitstop: .07, shake: .25, label: 'Attacking' },
    ],
    heavy: [
      { clip: SS('attack (2)'), speed: 1.15, active: [0.3, 0.78], cancel: 1.0, end: 1.3, range: 3.5, arc: 60 * D, damage: 46, knock: 9, lunge: 2.2, heavy: true, hitstop: .1, shake: .45, label: 'Heavy cleave' },
      { clip: SS('slash (4)'), speed: 1.25, active: [1.22, 1.62], cancel: 1.9, end: 2.2, range: 3.4, arc: 95 * D, damage: 54, knock: 10, lunge: 1.6, heavy: true, hitstop: .11, shake: .45, label: 'Reaping arc' },
    ],
    bash: { clip: SS('kick'), speed: 1.4, active: [0.08, 0.34], cancel: .7, end: .95, range: 2.6, arc: 60 * D, damage: 12, knock: 11, lunge: 1.2, heavy: true, hitstop: .08, shake: .3, label: 'Kick' },
  },
  bow: {
    id: 'bow', name: 'Ashwood Sentinel', key: 'F4', set: 'bow', secondary: 'aim', attach: { l: 'W_ashwood-sentinel' }, trail: 0,
    combo: [
      { clip: BOW('draw arrow'), speed: 1.5, active: [0.8, 0.81], cancel: 0.95, end: 1.05, range: 40, arc: 0, damage: 34, knock: 4, lunge: 0, hitstop: .03, shake: .08, label: 'Shooting' },
    ],
    aimed: { clip: BOW('aim recoil'), speed: 1.4, active: [0.2, 0.21], cancel: 0.5, end: 0.7, range: 40, arc: 0, damage: 52, knock: 6, lunge: 0, hitstop: .04, shake: .12, label: 'Loosing' },
  },
};

export type FoeKind = 'minion' | 'warrior' | 'rogue' | 'mage' | 'goblin' | 'goblin_archer' | 'orc' | 'skeleton' | 'skeleton_mage' | 'skeleton_brute' | 'dummy' | 'chrysanthus';
export interface FoeDef {
  looks: LookId[]; set: keyof typeof MOVESETS; hp: number; speed: number; xp: number; reach: number;
  attacks: AttackDef[]; shield?: string; weapon?: string; hand?: 'l' | 'r'; ranged?: 'bolt' | 'orb';
  /** Creature posture: forward spine curl (radians) layered after animation. */
  hunch?: number;
  /** Seconds of red-crescent warning before a melee swing lands. */
  tell: number; cooldown: [number, number]; armor: number;
  /** Body scale (goblins are small, orcs huge) and how many attack one target at once. */
  scale?: number; tokens?: number;
}
export const FOES: Record<FoeKind, FoeDef> = {
  minion: {
    looks: ['raider', 'raider_f'], set: 'sword', hp: 55, speed: 4.4, xp: 10, reach: 2.4, weapon: 'W_serpent-tooth', tell: .45, cooldown: [1.3, 2.4], armor: 0,
    attacks: [{ clip: SS('slash'), speed: 1.15, active: [0.5, 0.74], cancel: 9, end: 1.15, range: 2.8, arc: 60 * D, damage: 45, knock: 3, lunge: .9, hitstop: .04, shake: .25 },
      { clip: SS('attack (4)'), speed: 1.1, active: [0.38, 0.56], cancel: 9, end: 0.95, range: 2.8, arc: 70 * D, damage: 50, knock: 4, lunge: .9, hitstop: .04, shake: .3 }],
  },
  warrior: {
    looks: ['soldier', 'knight'], set: 'greatsword', hp: 130, speed: 3.4, xp: 25, reach: 2.6, weapon: 'W_bell-of-ruin', shield: 'parry', tell: .65, cooldown: [1.8, 3], armor: .35,
    attacks: [{ clip: GS('attack'), speed: 1.05, active: [0.38, 0.6], cancel: 9, end: 1.2, range: 3.2, arc: 55 * D, damage: 85, knock: 6, lunge: 1.1, heavy: true, hitstop: .05, shake: .4 },
      { clip: GS('slash'), speed: 1.1, active: [0.44, 0.82], cancel: 9, end: 1.25, range: 3.2, arc: 85 * D, damage: 70, knock: 5, lunge: 1, hitstop: .05, shake: .35 }],
  },
  rogue: {
    looks: ['archer'], set: 'bow', hp: 60, speed: 4.2, xp: 15, reach: 16, weapon: 'W_briar-whisper', hand: 'l', ranged: 'bolt', tell: .9, cooldown: [2.2, 3.4], armor: 0,
    attacks: [{ clip: BOW('draw arrow'), speed: 1.25, active: [0.8, 0.81], cancel: 9, end: 1.05, range: 30, arc: 0, damage: 70, knock: 4, lunge: 0, hitstop: .02, shake: .2 }],
  },
  // Goblins: small, quick, cowardly in ones and dangerous in packs; they dart in and out.
  goblin: {
    looks: ['goblin'], set: 'sword', hp: 34, speed: 5.4, xp: 6, reach: 2.1, weapon: 'W_night-thorn', tell: .35, cooldown: [.9, 1.8], armor: 0, scale: .82, tokens: 4, hunch: .55,
    attacks: [{ clip: SS('attack (4)'), speed: 1.35, active: [0.38, 0.56], cancel: 9, end: .9, range: 2.3, arc: 70 * D, damage: 28, knock: 2, lunge: 1.1, hitstop: .03, shake: .15 },
      { clip: SS('slash'), speed: 1.4, active: [0.5, 0.74], cancel: 9, end: 1.05, range: 2.3, arc: 60 * D, damage: 24, knock: 2, lunge: 1, hitstop: .03, shake: .15 }],
  },
  goblin_archer: {
    looks: ['goblin_archer'], set: 'bow', hp: 28, speed: 5, xp: 7, reach: 14, weapon: 'W_briar-whisper', hand: 'l', ranged: 'bolt', tell: .7, cooldown: [1.8, 2.8], armor: 0, scale: .82, hunch: .4,
    attacks: [{ clip: BOW('draw arrow'), speed: 1.4, active: [0.8, 0.81], cancel: 9, end: 1.05, range: 26, arc: 0, damage: 40, knock: 3, lunge: 0, hitstop: .02, shake: .15 }],
  },
  // Orcs: huge, slow to start, crushing two-handed blows that break guards; they shrug off light hits.
  orc: {
    looks: ['orc'], set: 'greatsword', hp: 210, speed: 3.6, xp: 32, reach: 3, weapon: 'W_execution-standard', tell: .75, cooldown: [1.6, 2.8], armor: .45, scale: 1.08, tokens: 2, hunch: .4,
    attacks: [{ clip: GS('attack'), speed: 1, active: [0.36, 0.64], cancel: 9, end: 1.2, range: 3.6, arc: 60 * D, damage: 110, knock: 9, lunge: 1.3, heavy: true, hitstop: .06, shake: .5 },
      { clip: GS('slash'), speed: 1.05, active: [0.42, 0.84], cancel: 9, end: 1.25, range: 3.6, arc: 90 * D, damage: 90, knock: 7, lunge: 1.2, heavy: true, hitstop: .05, shake: .45 }],
  },
  // Skeletons: the dead in ranks. Brittle (low hp, no poise against heavies), relentless, and they keep coming.
  // A training dummy (the Proving Hall): stands, takes everything, mends itself.
  dummy: {
    looks: ['soldier'], set: 'sword', hp: 4000, speed: 0, xp: 0, reach: 0, tell: 9, cooldown: [99, 99], armor: 0,
    attacks: [{ clip: SS('slash'), speed: 1, active: [0.5, 0.74], cancel: 9, end: 1.15, range: 0, arc: 0, damage: 0, knock: 0, lunge: 0, hitstop: 0, shake: 0 }],
  },
  // Chrysanthus's avatar: driven by its own controller (tower/chrysanthus.ts), these are its sword blows.
  chrysanthus: {
    looks: ['chrysanthus'], set: 'sword', hp: 60000, speed: 7.5, xp: 400, reach: 2.8, weapon: 'W_veilguard', tell: .55, cooldown: [.8, 1.6], armor: .9, scale: 1.08,
    attacks: [{ clip: SS('slash'), speed: 1.35, active: [0.5, 0.74], cancel: 9, end: 1.1, range: 3.2, arc: 80 * D, damage: 70, knock: 6, lunge: 1.4, hitstop: .05, shake: .35 },
      { clip: SS('attack (4)'), speed: 1.4, active: [0.38, 0.56], cancel: 9, end: 0.95, range: 3.2, arc: 70 * D, damage: 60, knock: 5, lunge: 1.4, hitstop: .05, shake: .3 }],
  },
  skeleton: {
    looks: ['skeleton'], set: 'sword', hp: 48, speed: 4, xp: 8, reach: 2.4, weapon: 'W_serpent-tooth', tell: .5, cooldown: [1.2, 2.2], armor: .1, tokens: 3, hunch: .12,
    attacks: [{ clip: SS('slash'), speed: 1.05, active: [0.5, 0.74], cancel: 9, end: 1.15, range: 2.7, arc: 60 * D, damage: 40, knock: 3, lunge: .8, hitstop: .04, shake: .2 },
      { clip: SS('attack (4)'), speed: 1.05, active: [0.38, 0.56], cancel: 9, end: 0.95, range: 2.7, arc: 70 * D, damage: 44, knock: 3, lunge: .8, hitstop: .04, shake: .25 }],
  },
  skeleton_mage: {
    looks: ['skeleton_mage'], set: 'caster', hp: 55, speed: 3.4, xp: 18, reach: 13, weapon: 'W_elderroot', ranged: 'orb', tell: 1.1, cooldown: [3, 4.4], armor: 0, hunch: .22,
    attacks: [{ clip: 'great_sword/spell cast', speed: .95, active: [0.3, 0.31], cancel: 9, end: 1.15, range: 28, arc: 0, damage: 80, knock: 6, lunge: 0, hitstop: .02, shake: .3 }],
  },
  skeleton_brute: {
    looks: ['skeleton_brute'], set: 'greatsword', hp: 170, speed: 3.3, xp: 28, reach: 3, weapon: 'W_bell-of-ruin', tell: .8, cooldown: [1.8, 3], armor: .3, scale: 1.12, tokens: 2, hunch: .28,
    attacks: [{ clip: GS('attack'), speed: .95, active: [0.38, 0.6], cancel: 9, end: 1.2, range: 3.5, arc: 55 * D, damage: 100, knock: 8, lunge: 1.2, heavy: true, hitstop: .06, shake: .45 },
      { clip: GS('slash'), speed: 1, active: [0.44, 0.82], cancel: 9, end: 1.25, range: 3.5, arc: 85 * D, damage: 85, knock: 6, lunge: 1.1, heavy: true, hitstop: .05, shake: .4 }],
  },
  mage: {
    looks: ['mystic'], set: 'caster', hp: 70, speed: 3.6, xp: 20, reach: 14, weapon: 'W_elderroot', ranged: 'orb', tell: 1.0, cooldown: [2.8, 4], armor: 0,
    attacks: [{ clip: 'great_sword/spell cast', speed: 1, active: [0.3, 0.31], cancel: 9, end: 1.15, range: 30, arc: 0, damage: 95, knock: 7, lunge: 0, hitstop: .02, shake: .3 }],
  },
};

/** Ally fighters (companions). They use the same rules as everyone else. */
export const ALLIES = {
  barbarian: { look: 'brann' as LookId, name: 'Brann', hp: 900, speed: 5.4, weapon: 'W_execution-standard', hand: 'r' as const, set: 'greatsword' as const,
    attacks: [WEAPONS.greatsword.combo[0], WEAPONS.greatsword.combo[2]].map(a => ({ ...a, damage: a.damage * .8 })) },
  rogue: { look: 'wren' as LookId, name: 'Wren', hp: 650, speed: 5.8, weapon: 'W_briar-whisper', hand: 'l' as const, set: 'bow' as const,
    attacks: [{ ...WEAPONS.bow.combo[0], speed: 1.4, damage: 28 }] },
};

/** Wave composition: grows without bound so the arena can be replayed indefinitely. */
export function waveRoster(n: number, rnd: () => number): FoeKind[] {
  const out: FoeKind[] = [];
  const total = Math.min(30, 5 + n * 3);
  for (let i = 0; i < total; i++) {
    const r = rnd();
    out.push(n >= 3 && r < .08 ? 'mage' : n >= 2 && r < .16 ? 'rogue' : r < .28 ? 'goblin' : n >= 2 && r < .36 ? 'goblin_archer' : n >= 3 && r < .44 ? 'orc' : r < .58 ? 'skeleton' : n >= 3 && r < .63 ? 'skeleton_mage' : n >= 4 && r < .68 ? 'skeleton_brute' : r < .68 + Math.min(.2, n * .04) ? 'warrior' : 'minion');
  }
  return out;
}

/** Witcher-style signs on 1-4 (Diablo skill slots). Power scales with the matching affinity in the tower. */
export const SPELL_CLIPS = ['great_sword/spell cast', 'sword_and_shield/sword and shield casting (2)'];

/** Every clip name referenced by weapons, foes, allies and movesets: only these are baked and instantiated. */
export function usedClips(): Set<string> {
  const out = new Set<string>(['Lie_StandUp', RELAXED.idle, RELAXED.walk, RELAXED.run, 'great_sword/great sword casting', 'great_sword/spell cast', 'sword_and_shield/sword and shield casting (2)', 'sword_and_shield/sword and shield power up', 'sword_and_shield/sword and shield idle', ...Object.values(DODGES), 'unarmed/walk_forward', 'unarmed/walk_backward', 'unarmed/walk_strafe_left', 'unarmed/walk_strafe_right']);
  const add = (a?: AttackDef) => a && out.add(a.clip);
  for (const m of Object.values(MOVESETS)) for (const c of [m.idle, m.walk, m.run, m.block, m.guard, m.enter, ...m.hit, ...m.death]) out.add(c);
  for (const w of Object.values(WEAPONS)) { w.combo.forEach(add); w.heavy?.forEach(add); add(w.spin); add(w.bash); add(w.aimed); add(w.kick); }
  for (const c of SPELL_CLIPS) out.add(c);
  for (const [body, arms] of Object.values(READY_CLIPS)) { out.add(body); out.add(arms); }
  for (const f of Object.values(FOES)) f.attacks.forEach(add);
  for (const a of Object.values(ALLIES)) a.attacks.forEach(add);
  return out;
}
