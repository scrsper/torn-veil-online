import type { EventId, Person } from './types';
import type { World } from './world';
import { IRON_FOUNDATION, ironEligible } from './human';

export type AdvancementStage = 'Normal' | 'Iron' | 'Bronze' | 'Silver' | 'Gold';
export interface AdvancementAssessment { stage: AdvancementStage; eligible: boolean; reasons: string[]; evidenceEventIds: EventId[]; }

/** Only Normal→Iron is implemented. Higher stages remain blocked contracts pending metaphysics. */
export function assessAdvancement(world: World, p: Person, path: AdvancementStage[] = ['Normal', 'Iron']): AdvancementAssessment {
  const reasons: string[] = [], evidence: EventId[] = [];
  if (!p.alive) reasons.push('a living person is required');
  if (p.ontology.stage !== 'Normal') reasons.push('only Normal→Iron is implemented');
  if (path.length !== 2 || path[0] !== 'Normal' || path[1] !== 'Iron') reasons.push('requested stage path is blocked pending metaphysics');
  if (!ironEligible(p)) reasons.push(`all seven attributes must reach ${IRON_FOUNDATION}`);
  const qualifying = Object.entries(p.capability?.bySkill ?? {}).filter(([skill, value]) => value.effectiveSeconds >= 8 * 3600 && (p.skills[skill as keyof typeof p.skills] ?? 0) >= 0.55);
  if (!qualifying.length) reasons.push('a relevant capability needs sustained successful practice');
  for (const [, value] of qualifying) evidence.push(...value.sourceEventIds);
  const hasTechnique = Object.values(p.knowledge).some(k => k.kind === 'technique' && typeof k.source.viaEvent === 'string'
    && !!world.event(k.source.viaEvent) && (k.confidence ?? 0) >= 0.4 && qualifying.some(([skill]) => k.claim.skill === skill));
  if (!hasTechnique) reasons.push('provenance-bearing technique knowledge is required');
  const bodies = p.bodies.map(id => world.body(id)).filter(b => b && b.present && !b.dead && b.health >= b.maxHealth * 0.8 && !['sleep', 'downed'].includes(b.pose));
  if (!bodies.length) reasons.push('a present, recovered body is required');
  if (bodies.some(b => Object.values(b!.injuries ?? {}).some(v => v > 0.25))) reasons.push('serious wounds prevent advancement');
  if (p.physiology.fatigue > 0.35 || p.physiology.sleepDebt > 8 || Math.min(p.physiology.energy, p.physiology.hydration) < 0.55) reasons.push('recovery state is insufficient');
  const refs = evidence.map(id => world.event(id));
  if (refs.some(e => !e || !Number.isFinite(e.tick) || e.tick > world.now || e.actor !== p.id || !(e.data.capabilityCredits?.[p.id] > 0))) reasons.push('all practice evidence must remain in canonical history');
  const days = new Set(refs.filter((e): e is NonNullable<typeof e> => !!e).map(e => Math.floor(e.tick / 86400)));
  if (days.size < 3) reasons.push('evidence must span at least three days');
  return { stage: p.ontology.stage as AdvancementStage, eligible: reasons.length === 0, reasons, evidenceEventIds: [...new Set(evidence)] };
}

/** Explicit Normal→Iron action with real physiological cost and causal provenance. */
export function advanceToIron(world: World, p: Person, evidenceEventIds?: EventId[]): boolean {
  const assessment = assessAdvancement(world, p);
  if (!assessment.eligible) return false;
  const ids = assessment.evidenceEventIds;
  if (evidenceEventIds?.some(id => !ids.includes(id))) return false;
  const technique = Object.values(p.knowledge).find(k => k.kind === 'technique' && k.claim.skill === 'crafting' && k.confidence >= 0.4 && k.source.viaEvent && world.event(k.source.viaEvent));
  if (technique?.source.viaEvent) ids.push(technique.source.viaEvent);
  const event = world.emit('ontological_advancement', { actor: p.id, category: 'history', significance: 1, causes: ids,
    data: { from: 'Normal', to: 'Iron', adaptation: 'embodied capability' }, summary: `${p.name} advanced from Normal to Iron` });
  p.physiology.energy = Math.max(0, p.physiology.energy - 0.2); p.physiology.hydration = Math.max(0, p.physiology.hydration - 0.2); p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.35);
  p.physiologyTraits.conditioning = Math.max(p.physiologyTraits.conditioning, Math.min(1.25, p.physiologyTraits.conditioning + 0.05));
  p.ontology = { stage: 'Iron', breakthroughEventId: event.id }; return true;
}
export function advancementBlocked(stage: AdvancementStage): boolean { return stage === 'Bronze' || stage === 'Silver' || stage === 'Gold'; }
