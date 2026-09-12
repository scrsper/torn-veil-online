import type { Action, Goal, Person } from '../core/types';
import type { World } from '../core/world';
import { cognitiveCapability } from '../core/human';
import { skillOf } from '../core/skills';
import { availableForMartial, canTeachTechnique, SOLO_MASTERY_CEILING } from './martialPractice';
import { canExecuteTechnique, knowsTechnique, masteryOf } from './martialKnowledge';
import { recordPlan } from './records';
import { instructionPairAvailable, TEACH_RENOTICE_SECONDS } from './apprenticeship';

/** Ordinary work/study goal proposals. The central G() function applies the existing
 * shared motivation bridge, needs, hysteresis and commitment policy exactly once.
 * No scheduler and no extra hidden motivation bonuses live here. */
export function martialGoals(world: World, p: Person): Partial<Goal>[] {
  const body = p.bodies.map(id => world.body(id)).find(b => b && availableForMartial(world, p, b.id));
  if (!body) return [];
  const goals: Partial<Goal>[] = [];
  // The existing recordGoals provider already proposes reading/writing/copying these
  // physical records. Do not propose those same goals a second time here.
  const known = Object.values(p.knowledge).filter(k => k.kind === 'technique' && typeof k.claim.martialTechnique === 'string').sort((a, b) => a.key.localeCompare(b.key));
  // Perception supplies candidates, never a global search of other people's knowledge.
  const peers = p.mind.percepts.filter(v => v.how === 'saw' && world.now - v.tick <= 60 && v.tick <= world.now)
    .map(v => ({ p: world.person(v.entityId), body: world.body(v.bodyId) }))
    .filter(q => q.p && q.body && instructionPairAvailable(world, p, q.p, body.id, q.body.id))
    .sort((a, b) => a.p!.id.localeCompare(b.p!.id));
  const proposal = (martial: string, k: typeof known[number], utility: number, peer?: typeof peers[number]) => {
    const id = k.claim.martialTechnique;
    goals.push({ type: 'work', utility, targetEntity: peer?.p!.id,
      data: { martial, techniqueId: id, bodyId: body.id, partnerBodyId: peer?.body!.id,
        needKey: `martial:${martial}:${id}:${peer?.p!.id ?? p.id}` },
      causeEvent: k.source.viaEvent, reasons: [`${martial} a locally known martial technique`, 'curiosity and social interest compete with ordinary needs and work'] });
  };
  for (const k of known) {
    const id = k.claim.martialTechnique, mastered = masteryOf(p, id);
    if (canExecuteTechnique(world, p, id) && mastered < SOLO_MASTERY_CEILING)
      proposal('practice', k, 0.18 + p.traits.curiosity * 0.25 + (SOLO_MASTERY_CEILING - mastered) * 0.2);
    for (const peer of peers) {
      const witnessedTeacher = k.source.from === peer.p!.id || k.claim.teacherId === peer.p!.id;
      if (witnessedTeacher && !knowsTechnique(p, id)) proposal('lesson', k, 0.28 + p.traits.curiosity * 0.3, peer);
      if (witnessedTeacher && canExecuteTechnique(world, p, id)) proposal('spar', k, 0.2 + p.traits.sociability * 0.2 + p.traits.curiosity * 0.12, peer);
      const previous = p.knowledge[`martial-lesson:${peer.p!.id}:${id}`];
      if (canTeachTechnique(world, p, id) && (!previous || world.now - previous.claim.tick > TEACH_RENOTICE_SECONDS))
        proposal('lesson', k, 0.18 + p.traits.sociability * 0.3, peer);
    }
    if (mastered >= 0.45 && skillOf(p, k.claim.family) >= 0.45 && cognitiveCapability(p).reasoning >= 0.9 && !k.claim.parentId
      && !known.some(other => other.claim.parentId === id && other.claim.creatorId === p.id))
      proposal('experiment', k, 0.15 + p.traits.curiosity * 0.35);
  }
  return goals;
}
/** This goes before the generic work branch in plan(). Saveable plain Action records. */
export function martialPlan(world: World, goal: Goal): Action[] | undefined {
  if (goal.type === 'study_record' && goal.targetEntity && world.item(goal.targetEntity)?.record?.knowledge.claim.martialTechnique) return recordPlan(world, goal);
  if (!goal.data?.martial) return undefined;
  return [{ type: 'work', status: 'pending', targetEntity: goal.targetEntity, data: { ...goal.data } }];
}
