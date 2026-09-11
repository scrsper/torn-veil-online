import type { World } from '../core/world';
import type { Body, Person } from '../core/types';
import { getPhysicalCapability } from '../core/attributes';

/** A narrow perceptual reflex, offered to the ordinary action queue. It sees posture,
 * facing and distance, never reads a contact, a future outcome or hidden target intention. */
export function observeCombatPreparation(w:World):void {
  const incoming=w.activeBodies().filter(b=>b.combatAction?.kind==='attack'&&b.combatAction.phase==='preparation'&&w.physicalTime<b.combatAction.activeAt);
  if(!incoming.length)return;
  for(const p of w.livingPersons()) {
    for(const id of p.bodies) {
      const b=w.body(id);if(!b||!b.present||b.dead||b.pose==='sleep'||b.pose==='downed')continue;
      for(const other of incoming) {
        if(other.ownerId===p.id)continue;
        const a=other.combatAction!;
        if(p.mind.combatCue?.actionId===a.id)continue;
        const dx=b.pos.x-other.pos.x,dz=b.pos.z-other.pos.z,d=Math.hypot(dx,dz);
        if(d>3.5||d<.01||(-Math.sin(a.facing)*dx-Math.cos(a.facing)*dz)/d<.8)continue;
        const view=(Math.sin(b.yaw)*dx+Math.cos(b.yaw)*dz)/d;
        if(view<.1||!w.grid.lineOfSight({...b.pos,y:b.pos.y+1.5},{...other.pos,y:other.pos.y+1.3},4))continue;
        const evidence=w.emit('perceived',{actor:p.id,target:other.ownerId,causes:[a.eventId],
          data:{how:'saw',eventType:'combat_action',eventId:a.eventId,actionId:a.id},summary:`${p.name} saw a strike preparing in their direction`});
        const source=w.eventIndex.get(a.eventId);if(source&&!source.perceivedBy.some(x=>x.who===p.id))source.perceivedBy.push({who:p.id,how:'saw',tick:w.now});
        // A current sensory cue is bounded working memory, not one gossipable belief for
        // every phase notification. Contact/miss consequences use ordinary event memory.
        // Controlled minds receive the same cue; only autonomous planning offers a defense.
        const cap=getPhysicalCapability(p,w,{body:b});
        p.mind.combatCue={actionId:a.id,actorBodyId:other.id,defenderBodyId:b.id,observedAt:w.physicalTime,
          reactAt:w.physicalTime+.10+.10*(1-Math.min(1,cap.effectiveDexterity)),evidenceId:evidence.id,
          position:{...other.pos},facing:a.facing,trajectory:a.trajectory,responded:false};
        break;
      }
    }
  }
}
export function offerCombatDefense(w:World,p:Person,b:Body):void {
  const cue=p.mind.combatCue;
  if(!cue||cue.defenderBodyId!==b.id||cue.responded||w.physicalTime<cue.reactAt||w.physicalTime-cue.observedAt>.8)return;
  // Existing commitments can prevent responding; a reflex is not an automatic escape.
  if(b.combatAction&&b.combatAction.completeAt>w.physicalTime)return;
  cue.responded=true;
  p.mind.plan.unshift({type:'defend',status:'pending',data:{kind:'sidestep',side:1,evidenceEvent:cue.evidenceId}});
}
