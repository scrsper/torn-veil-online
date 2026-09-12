import type { LocalizedInjury, ConflictIntent, EntityId, Item, ItemType, Person } from '../core/types';
import type { World } from '../core/world';
import { getPhysicalCapability } from '../core/attributes';
import { combatTransitionAt } from './combatTransitions';

export interface WeaponProperties { reach: number; impact: number; handling: number; }
// Reach is body-origin distance in metres; impact is the base health-scale impulse.
// Handling (0..1) expresses ease of delivering that impulse, not learned mastery.
export const UNARMED: Readonly<WeaponProperties> = { reach: 1.2, impact: 7, handling: 1 };
const WEAPONS: Partial<Record<ItemType, WeaponProperties>> = {
  dagger: { reach: 2.4, impact: 14, handling: 0.95 },
  sword: { reach: 3.2, impact: 26, handling: 0.8 },
  axe: { reach: 2.7, impact: 22, handling: 0.65 },
  hammer: { reach: 2.4, impact: 20, handling: 0.6 },
  stoneaxe: { reach: 2.5, impact: 14, handling: 0.55 },
};
export function weaponProperties(item: Item): WeaponProperties | null {
  const profile = WEAPONS[item.type];
  return profile ? { ...profile, impact: item.damage } : null;
}
/** The prototype has carried items, no equipment slots. Omitted weapon selects the best
 * usable carried weapon; explicit null means fists. Never use an item held by someone else. */
export function combatWeapon(w: World, p: Person): Item | null {
  let best: Item | null = null;
  for (const id of p.inventory) {
    const item = w.item(id);
    if (item && item.holderId === p.id && item.quantity > 0 && item.condition !== 0 && weaponProperties(item)
      && item.damage > (best?.damage ?? 0)) best = item;
  }
  return best;
}
export function combatReach(w: World, p: Person): number {
  const item = combatWeapon(w, p);
  return item ? weaponProperties(item)!.reach : UNARMED.reach;
}
export const ATTACK_COOLDOWN = 0.55;
export interface CombatAttackIntent {
  attackerId: EntityId;
  attackerBodyId: EntityId;
  targetBodyId: EntityId;
  attackMode: 'strike';
  weaponId?: EntityId | null;
  intent?: ConflictIntent;
  trajectory?: 'high' | 'mid' | 'low';
}
export type AttackRejection = 'invalid_attacker' | 'invalid_target' | 'self_target' | 'incapacitated' | 'cooldown' | 'invalid_weapon' | 'invalid_mode' | 'out_of_reach' | 'obstructed' | 'protected_target' | 'exhausted';
export interface CombatAttackResult extends CombatAttackIntent {
  actionId?: string;
  contactRegion?: import('./combatGeometry').ContactRegion;
  targetId: EntityId | null;
  weaponId: EntityId | null;
  distance: number | null;
  reach: number;
  attempted: boolean;
  rejection: AttackRejection | null;
  hit: boolean;
  impact: number;
  exertionCost: number;
  injury: LocalizedInjury | null;
}
/** Attempt validation. Only a legal attempt consumes one draw from the supplied canonical
 * RNG. No client flags or primary-body assumptions: the intent names a manifestation. */
export function resolveCombatAttack(w: World, intent: CombatAttackIntent, rng: { next(): number }): CombatAttackResult {
  const p = w.person(intent.attackerId), ab = w.body(intent.attackerBodyId), tb = w.body(intent.targetBodyId);
  const result: CombatAttackResult = { ...intent, targetId: tb?.ownerId ?? null, weaponId: intent.weaponId ?? null,
    distance: ab && tb ? Math.hypot(ab.pos.x - tb.pos.x, ab.pos.y - tb.pos.y, ab.pos.z - tb.pos.z) : null,
    reach: 0, attempted: false, rejection: null, hit: false, impact: 0, exertionCost: 0, injury: null };
  const reject = (reason: AttackRejection) => { result.rejection = reason; return result; };
  if (!p || !ab || ab.ownerId !== p.id || !p.bodies.includes(ab.id)) return reject('invalid_attacker');
  if (!p.alive || !ab.present || ab.dead || ab.health <= 0 || ab.pose === 'downed' || ab.pose === 'sleep'
    || ab.subduedUntil > w.physicalTime || p.surrender || p.custody?.active) return reject('incapacitated');
  // Selection assists bounded aiming only. An absent, stale, distant or obstructed selection
  // cannot suppress a capable body's swing; active swept contact validates each actual body.
  if (intent.attackMode !== 'strike' || (intent.trajectory !== undefined && !['high','mid','low'].includes(intent.trajectory))) return reject('invalid_mode');
  if (ab.combatAction ? w.physicalTime + 1e-9 < combatTransitionAt(ab.combatAction,'attack')
    : w.physicalTime - ab.lastAttackAt < ATTACK_COOLDOWN) return reject('cooldown');
  const item = intent.weaponId === undefined ? combatWeapon(w, p) : intent.weaponId === null ? null : w.item(intent.weaponId);
  if (intent.weaponId && !item) return reject('invalid_weapon');
  if (item && (!p.inventory.includes(item.id) || item.holderId !== p.id || item.quantity <= 0 || item.condition === 0 || !weaponProperties(item))) return reject('invalid_weapon');
  const weapon = item ? weaponProperties(item)! : UNARMED;
  result.weaponId = item?.id ?? null; result.reach = weapon.reach;
  const cap = getPhysicalCapability(p, w, { body: ab });
  if (p.physiology.fatigue >= .97 || cap.currentExertionCapacity <= .03) return reject('exhausted');
  result.attempted = true;
  // Acceptance freezes potential force, never a hit or an anatomical region.
  const roll = rng.next();
  result.impact = weapon.impact * (0.5 + cap.effectiveStrength) * (0.7 + Math.min(1, cap.effectiveDexterity) * 0.3)
    * (0.8 + weapon.handling * 0.2) * (0.8 + roll * 0.4);
  result.exertionCost = Math.min(1 - p.physiology.fatigue, 0.025 * (2 - weapon.handling) * cap.fatigueMultiplier);
  return result;
}
export function combatTrace(r: CombatAttackResult): string {
  return `${r.attackerId} attacks ${r.targetId ?? r.targetBodyId} weapon:${r.weaponId ?? 'fists'} distance:${r.distance?.toFixed(2) ?? '?'} range:${r.reach} result:${r.rejection ?? (r.hit?'hit':'accepted')} impact:${r.impact.toFixed(2)} exertion:${r.exertionCost.toFixed(4)}`;
}
