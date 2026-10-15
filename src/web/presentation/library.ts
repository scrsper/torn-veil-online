import { CREATOR_BODIES, isCreatorLook } from '../actors/creatorAppearance';
import type { LookId } from '../arena/looks';
import { WEAPONS, MOVESETS, RELAXED, DODGE_BODY, READY_CLIPS, type AttackDef } from '../arena/combat';

/** Versioned presentation contract. Editing this registry changes existing bodies on the
 * next client load, in every consumer, without a save migration or a gameplay stat change.
 * The cast bodies are the provisional picks of the 2026-10-15 model review. */
export const PRESENTATION_REVISION = 'provisional-cast-2026-10-15.1';
export const CHARACTER_KITS = Object.freeze({ f: 'models/kit_f.glb', m: 'models/kit_m.glb', c: 'models/kit_c.glb' });
export type CastLook = Exclude<LookId, 'creator_male' | 'creator_female'>;
export interface CastBody { file: string; role: string; source: string; license: string; why: string }
/** Provisional cast picks (model review 2026-10-15, renders in torn-veil-build/model-review). One body per role;
 * every one is rigged with UE-mannequin bone names and gets its own retarget bake (ArenaAssets.loadHumans). */
export const CAST_BODIES: Readonly<Record<CastLook, CastBody>> = Object.freeze({
  player_m: { file: 'tv-human-male-v2.glb', role: 'player (male)', source: 'tools/ontology tv-human-male-v2 (MakeHuman/MPFB)', license: 'CC0-1.0',
    why: 'Fitted linen/leather costume, 2K PBR, jaw morph; already the creator hero, so customization keeps working.' },
  player_f: { file: 'tv-human-female-v1.glb', role: 'player (female)', source: 'tools/ontology tv-human-female-v1 (MakeHuman/MPFB)', license: 'CC0-1.0',
    why: 'Same MPFB rig and material set as the male hero; the only textured female body with a full game_engine rig.' },
  npc_m: { file: 'tv-human-male-v1.glb', role: 'resident (male)', source: 'tools/ontology tv-human-male-v1 (MakeHuman/MPFB)', license: 'CC0-1.0',
    why: 'Plain casual suit reads as a townsperson and stays visually distinct from the player.' },
  npc_f: { file: 'quaternius-peasant.glb', role: 'resident (female)', source: 'Quaternius Modular Character Outfits - Fantasy, Female_Peasant', license: 'CC0-1.0',
    why: 'Period peasant dress with hand-painted PBR (packed to 2K); 13.6k tris, cheapest textured female.' },
  warden: { file: 'quaternius-ranger.glb', role: 'warden / human foes', source: 'Quaternius Modular Character Outfits - Fantasy, Male_Ranger', license: 'CC0-1.0',
    why: 'Hood, pauldron, bracers and belts: the only armoured fantasy outfit among the candidates.' },
  imp: { file: 'quaternius-imp.glb', role: 'enemy (standard / heavy)', source: 'Quaternius Bestiary - Dungeon Monsters Kit, Imp', license: 'CC0-1.0',
    why: 'Full-size humanoid monster on a UE-named rig, so every combat clip retargets onto it.' },
  puglin: { file: 'quaternius-puglin.glb', role: 'enemy (small)', source: 'Quaternius Bestiary - Dungeon Monsters Kit, Puglin', license: 'CC0-1.0',
    why: 'Small (0.93 m) creature on the same rig family; replaces the goblins.' },
});
export const CAST_LOOKS = Object.keys(CAST_BODIES) as CastLook[];
/** Paths relative to arena base. Body/rig replacement has one mapping for world, Tower and lab. */
export function humanAssetPath(look: LookId): string {
  if (isCreatorLook(look)) return `creator/${CREATOR_BODIES[look].file}`;
  return `cast/${CAST_BODIES[look].file}`;
}

export interface MotionBinding { clip: string; contact: readonly [number, number]; end: number; }
const fromAttack = (a: AttackDef): MotionBinding => ({ clip: a.clip, contact: [...a.active], end: a.end ?? a.cancel + .2 });
export const UNARMED_MOTION: Readonly<Record<string, MotionBinding>> = Object.freeze({
  jab: fromAttack(WEAPONS.fists.combo[0]), cross: fromAttack(WEAPONS.fists.combo[1]),
  front_kick: fromAttack(WEAPONS.fists.kick!), round_kick: fromAttack(WEAPONS.fists.combo[4]),
  hook: fromAttack(WEAPONS.fists.combo[2]), uppercut: fromAttack(WEAPONS.fists.combo[3]),
  heavy: fromAttack(WEAPONS.fists.heavy![0]),
});
export const ARMED_MOTION = WEAPONS.axe.combo.map(fromAttack);
/** Existing clips selected by the actual weapon/action, never historical attack counters.
 * KayKit contacts are explicit presentation calibration and require rendered review.
 * No animation binding changes reach, damage or the canonical contact window. */
export const WEAPON_MOTION: Readonly<Record<string, Readonly<Record<string, MotionBinding>>>> = Object.freeze({
  dagger: { high: { clip: '1H_Melee_Attack_Slice_Diagonal', contact: [.3, .58], end: 1 },
    mid: { clip: '1H_Melee_Attack_Stab', contact: [.48, .85], end: 1.6 },
    low: { clip: '1H_Melee_Attack_Slice_Horizontal', contact: [.3, .62], end: 1.067 } },
  sword: { high: fromAttack(WEAPONS.axe.combo[0]), mid: fromAttack(WEAPONS.axe.combo[1]),
    low: fromAttack(WEAPONS.axe.combo[2]), heavy: fromAttack(WEAPONS.axe.heavy![0]) },
  axe: { high: { clip: '1H_Melee_Attack_Chop', contact: [.3, .62], end: 1.067 },
    mid: fromAttack(WEAPONS.axe.combo[1]), low: fromAttack(WEAPONS.axe.combo[2]), heavy: fromAttack(WEAPONS.axe.heavy![0]) },
  hammer: { high: { clip: '1H_Melee_Attack_Chop', contact: [.3, .62], end: 1.067 },
    mid: { clip: '1H_Melee_Attack_Slice_Horizontal', contact: [.3, .62], end: 1.067 },
    low: { clip: '1H_Melee_Attack_Slice_Diagonal', contact: [.3, .58], end: 1 },
    heavy: { clip: '1H_Melee_Attack_Chop', contact: [.3, .62], end: 1.067 } },
});
export function weaponMotionBinding(action: { moveId: string; weight: string; definition?: string; trajectory?: string }, heldWeapon: string): MotionBinding {
  const definition = action.definition ?? action.moveId;
  const kind = Object.keys(WEAPON_MOTION).find(k => definition.startsWith(k + '_')) ?? heldWeapon;
  const family = WEAPON_MOTION[kind] ?? WEAPON_MOTION.sword;
  const trajectory = action.trajectory ?? (definition.endsWith('_low') ? 'low' : definition.endsWith('_mid') ? 'mid' : 'high');
  return (action.weight === 'heavy' ? family.heavy : undefined) ?? family[trajectory] ?? family.high;
}
export interface PhaseTiming { age: number; prep: number; active: number; recovery: number; }
/** Piecewise mapping: a replacement clip's contact frames land in the existing canonical
 * active interval. Neither clip duration nor frame rate can move the hit-validation window. */
export function motionSampleSeconds(t: PhaseTiming, motion: MotionBinding): number {
  const age = Math.max(0, t.age), p = Math.max(0, t.prep), a = Math.max(.001, t.active), r = Math.max(.001, t.recovery);
  if (age < p) return motion.contact[0] * age / Math.max(.001, p);
  if (age < p + a) return motion.contact[0] + (motion.contact[1] - motion.contact[0]) * (age - p) / a;
  return motion.contact[1] + (motion.end - motion.contact[1]) * Math.min(1, (age - p - a) / r);
}
export const STRAFE_MOTION = ['unarmed/walk_forward', 'unarmed/walk_backward', 'unarmed/walk_strafe_left', 'unarmed/walk_strafe_right'];
export const SHARED_MOTION = new Set([
  ...[MOVESETS.fists, MOVESETS.sword].flatMap(s => [s.idle, s.walk, s.run, s.guard, ...s.hit, ...s.death]),
  RELAXED.idle, RELAXED.walk, RELAXED.run, 'unarmed/run_jog', ...STRAFE_MOTION,
  ...Object.values(UNARMED_MOTION).map(m => m.clip), ...ARMED_MOTION.map(m => m.clip),
  ...Object.values(WEAPON_MOTION).flatMap(f => Object.values(f).map(m => m.clip)),
  ...Object.values(DODGE_BODY), 'unarmed/slip_left', 'unarmed/slip_right',
  // Composed ready clips need their two existing source clips available at bake time.
  ...Object.keys(READY_CLIPS), ...Object.values(READY_CLIPS).flat(),
]);
