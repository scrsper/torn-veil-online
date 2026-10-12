import { CREATOR_BODIES, isCreatorLook } from '../actors/creatorAppearance';
import type { LookId } from '../arena/looks';
import { WEAPONS, MOVESETS, RELAXED, DODGE_BODY, READY_CLIPS, type AttackDef } from '../arena/combat';

/** Versioned presentation contract. Editing this registry changes existing bodies on the
 * next client load, in every consumer, without a save migration or a gameplay stat change.
 * Only the existing accepted assets are registered; the separate Opus candidate is absent. */
export const PRESENTATION_REVISION = 'authored-motion-2026-10-13.1';
export const CHARACTER_KITS = Object.freeze({ f: 'models/kit_f.glb', m: 'models/kit_m.glb', c: 'models/kit_c.glb' });
export const HUMAN_LOOKS: LookId[] = ['ranger', 'brann', 'wren', 'raider', 'raider_f', 'soldier', 'knight', 'archer', 'mystic'];
/** Paths relative to arena base. Body/rig replacement has one mapping for world, Tower and lab. */
export function humanAssetPath(look: LookId, detailed = true): string {
  if (isCreatorLook(look)) return `creator/${CREATOR_BODIES[look].file}`;
  return detailed && HUMAN_LOOKS.includes(look) ? `people/${look === 'ranger' ? 'hero' : look}.glb` : `people_flat/${look}.glb`;
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
