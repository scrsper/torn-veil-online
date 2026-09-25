import type { AttributeId, EventId, Person, SkillId } from './types';
import type { World } from './world';
import { ATTRIBUTE_IDS, IRON_FOUNDATION, IRON_SUPPORT } from './human';
import { ironFoundationsFor } from './development';
import type { PracticedSkillId } from './martialTypes';

export type AdvancementStage = 'Normal' | 'Iron' | 'Bronze' | 'Silver' | 'Gold';
export interface AdvancementAssessment {
  stage: AdvancementStage; eligible: boolean; reasons: string[]; evidenceEventIds: EventId[];
  /** The practiced capability the assessment is anchored on, and the foundations it demands at Iron. */
  path?: { skill: SkillId; core: AttributeId[] };
}

// First-rank history is quality/repetition weighted; foundations and demonstrated skill
// remain independent readiness gates. No credits are granted by this calibration.
export const IRON_PRACTICE_SECONDS = 2 * 3600;
const MIN_SKILL = 0.55;

/** Capabilities with sustained, successful, proven practice, strongest first. */
function qualifyingCapabilities(p: Person): [SkillId, { effectiveSeconds: number; sourceEventIds: EventId[] }][] {
  return (Object.entries(p.capability?.bySkill ?? {}) as [SkillId, { effectiveSeconds: number; sourceEventIds: EventId[] }][])
    .filter(([skill, value]) => value.effectiveSeconds >= IRON_PRACTICE_SECONDS && (p.skills[skill] ?? 0) >= MIN_SKILL)
    .sort((a, b) => b[1].effectiveSeconds - a[1].effectiveSeconds || a[0].localeCompare(b[0]));
}

/**
 * Only Normal→Iron is implemented. Higher stages remain blocked contracts pending metaphysics.
 *
 * Iron is anchored on one practiced capability (a path): the foundations that practice most
 * demands must reach IRON_FOUNDATION, and every other foundation must be sound (IRON_SUPPORT).
 * A person may qualify through different capabilities; the first whose whole assessment passes
 * is used, otherwise the strongest candidate's reasons are reported.
 */
export function assessAdvancement(world: World, p: Person, path: AdvancementStage[] = ['Normal', 'Iron']): AdvancementAssessment {
  const general: string[] = [];
  if (!p.alive) general.push('a living person is required');
  if (p.ontology.stage !== 'Normal') general.push('only Normal→Iron is implemented');
  if (path.length !== 2 || path[0] !== 'Normal' || path[1] !== 'Iron') general.push('requested stage path is blocked pending metaphysics');
  const bodies = p.bodies.map(id => world.body(id)).filter(b => b && b.present && !b.dead && b.health >= b.maxHealth * 0.8 && !['sleep', 'downed'].includes(b.pose));
  if (!bodies.length) general.push('a present, recovered body is required');
  if (bodies.some(b => Object.values(b!.injuries ?? {}).some(v => v > 0.25))) general.push('serious wounds prevent advancement');
  if (p.physiology.fatigue > 0.35 || p.physiology.sleepDebt > 8 || Math.min(p.physiology.energy, p.physiology.hydration) < 0.55) general.push('recovery state is insufficient');

  const candidates = qualifyingCapabilities(p);
  if (!candidates.length) {
    return { stage: p.ontology.stage as AdvancementStage, eligible: false, evidenceEventIds: [],
      reasons: [...general, `a relevant capability needs ${IRON_PRACTICE_SECONDS / 3600} hours of meaningful practice and skilled proficiency`, ...foundationReasons(p, [])] };
  }
  let first: AdvancementAssessment | undefined;
  for (const [skill, value] of candidates) {
    const reasons = [...general], core = ironFoundationsFor(skill as PracticedSkillId);
    reasons.push(...foundationReasons(p, core));
    if (!pathTechnique(world, p, skill)) reasons.push(`provenance-bearing ${skill} technique knowledge is required`);
    const evidence = [...new Set(value.sourceEventIds)];
    const refs = evidence.map(id => world.event(id));
    // Credit on the source event proves this person's part in it (a sparring partner included).
    if (refs.some(e => !e || !Number.isFinite(e.tick) || e.tick > world.now || !(e.data.capabilityCredits?.[p.id] > 0))) reasons.push('all practice evidence must remain in canonical history');
    const days = new Set(refs.filter((e): e is NonNullable<typeof e> => !!e).map(e => Math.floor(e.tick / 86400)));
    if (days.size < 3) reasons.push('evidence must span at least three days');
    const assessment: AdvancementAssessment = { stage: p.ontology.stage as AdvancementStage, eligible: reasons.length === 0, reasons, evidenceEventIds: evidence, path: { skill, core } };
    if (assessment.eligible) return assessment;
    first ??= assessment;
  }
  return first!;
}

/** Technique knowledge for a path that is still backed by the event it came from. A trade lesson
 * names its `skill`; martial knowledge (lesson, observation, experiment) names its `family`. */
function pathTechnique(world: World, p: Person, skill: SkillId) {
  return Object.values(p.knowledge).find(k => k.kind === 'technique' && (k.claim.skill ?? k.claim.family) === skill
    && (k.confidence ?? 0) >= 0.4 && typeof k.source.viaEvent === 'string' && !!world.event(k.source.viaEvent));
}

function foundationReasons(p: Person, core: AttributeId[]): string[] {
  const out: string[] = [];
  for (const id of ATTRIBUTE_IDS) {
    const need = core.includes(id) ? IRON_FOUNDATION : IRON_SUPPORT;
    if (p.attributes[id] < need) out.push(`${id} ${p.attributes[id]} must reach ${need}${core.includes(id) ? ' (core of this path)' : ''}`);
  }
  return out;
}

/** Explicit Normal→Iron action with real physiological cost and causal provenance. */
export function advanceToIron(world: World, p: Person, evidenceEventIds?: EventId[]): boolean {
  const assessment = assessAdvancement(world, p);
  if (!assessment.eligible || !assessment.path) return false;
  const ids = assessment.evidenceEventIds;
  if (evidenceEventIds?.some(id => !ids.includes(id))) return false;
  const skill = assessment.path.skill;
  const technique = pathTechnique(world, p, skill);
  const causes = technique?.source.viaEvent ? [...ids, technique.source.viaEvent] : [...ids];
  const event = world.emit('ontological_advancement', { actor: p.id, category: 'history', significance: 1, causes,
    data: { from: 'Normal', to: 'Iron', adaptation: 'embodied capability', path: skill, core: assessment.path.core }, summary: `${p.name} advanced from Normal to Iron` });
  p.physiology.energy = Math.max(0, p.physiology.energy - 0.2); p.physiology.hydration = Math.max(0, p.physiology.hydration - 0.2); p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.35);
  p.physiologyTraits.conditioning = Math.max(p.physiologyTraits.conditioning, Math.min(1.25, p.physiologyTraits.conditioning + 0.05));
  p.ontology = { stage: 'Iron', breakthroughEventId: event.id }; return true;
}
export function advancementBlocked(stage: AdvancementStage): boolean { return stage === 'Bronze' || stage === 'Silver' || stage === 'Gold'; }
