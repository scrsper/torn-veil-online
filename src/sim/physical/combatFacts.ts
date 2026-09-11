import type { Body, Person, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { getPhysicalCapability } from '../core/attributes';
import { combatWeapon, type CombatAttackResult } from './combat';

/** Immutable execution facts on the causal event, not an animation request or a mind read.
 * Optional on old events/saves. There is no canonical combat proficiency/technique yet. */
export interface CombatActionFacts {
  actionId?:string;
  seq: number;
  physicalTime: number;
  actorBodyId: string;
  targetBodyId: string | null;
  actorPosition: Vec3;
  targetPosition: Vec3 | null;
  targetVelocity: Vec3 | null;
  actorYaw: number;
  weaponType: string;
  weaponId: string | null;
  action: 'strike';
  outcome: 'hit' | 'miss';
  attackSeq: number;
  hitSeq: number;
  capability: { strength: number; dexterity: number; exertion: number };
}

export function combatActionFacts(w: World, p: Person, ab: Body, tb: Body | null,
  outcome: 'hit' | 'miss', combat?: CombatAttackResult): CombatActionFacts {
  const weapon = combat ? (combat.weaponId ? w.item(combat.weaponId) : null) : combatWeapon(w, p);
  const cap = getPhysicalCapability(p, w, { body: ab });
  return {
    actionId:combat?.actionId,
    seq: Number(w.nextId('combat').slice(7)), physicalTime: w.physicalTime,
    actorBodyId: ab.id, targetBodyId: tb?.id ?? null,
    actorPosition: { ...ab.pos }, targetPosition: tb ? { ...tb.pos } : null,
    targetVelocity: tb ? { ...tb.vel } : null, actorYaw: ab.yaw,
    weaponType: weapon?.type ?? 'unarmed', weaponId: weapon?.id ?? null,
    action: 'strike', outcome, attackSeq: ab.attackSeq, hitSeq: tb?.hitSeq ?? 0,
    capability: { strength: cap.effectiveStrength, dexterity: cap.effectiveDexterity, exertion: cap.currentExertionCapacity },
  };
}
