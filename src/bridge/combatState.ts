import { techniqueDefinition } from '../sim/core/martialDefinitions';
import type { Body } from '../sim/core/types';
import type { World } from '../sim/core/world';
import { combatPosture } from '../sim/physical/combatAction';
import { getPhysicalCapability } from '../sim/core/attributes';
/** Physical execution allowlist. Never project force, intent, hidden target, or cognition. */
export function combatState(w:World,b:Body,decidedAtMs?:number) {
  const a=b.combatAction;if(!a)return null;
  const p=w.person(b.ownerId),cap=p?getPhysicalCapability(p,w,{body:b}):null;
  return {id:a.id,commandId:a.commandId,actorBodyId:b.id,kind:a.kind,definition:a.definition,
    techniqueId:a.techniqueId,techniqueName:a.techniqueId?techniqueDefinition(w,a.techniqueId)?.name:undefined,transitionTechniqueId:a.transitionTechniqueId,motion:a.motion,
    trajectory:a.trajectory,variant:a.variant,startedAt:a.startedAt,activeAt:a.activeAt,recoveryAt:a.recoveryAt,completeAt:a.completeAt,
    phase:a.phase,outcome:a.outcome,facing:a.facing,direction:{...a.direction},distance:a.distance,
    reach:a.reach,radius:a.radius,duck:combatPosture(a,w.physicalTime),
    contact:a.contact?{bodyId:a.contact.bodyId,region:a.contact.region,position:{...a.contact.position},at:a.contact.at,eventId:a.contact.eventId,decidedAtMs}:null,
    capability:{strength:cap?.effectiveStrength??.5,dexterity:cap?.effectiveDexterity??.5,exertion:cap?.currentExertionCapacity??1}};
}
