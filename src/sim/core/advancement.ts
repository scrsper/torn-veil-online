import type { AttributeId, EventId, Person, SkillId } from './types';
import type { World } from './world';
import { ATTRIBUTE_IDS, IRON_FOUNDATION, IRON_SUPPORT } from './human';
import { ironFoundationsFor } from './development';
import type { PracticedSkillId } from './martialTypes';
import { earnedStanding, onBreakthrough } from '../progression/experience';
import { EMBODIED_TRIALS, isLeveledRank, nextRank, rankOfLevel, type LeveledRank } from '../progression/levels';

export type AdvancementStage = 'Normal' | 'Iron' | 'Bronze' | 'Silver' | 'Gold' | 'Diamond';
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
 * This embodied-practice path implements Normal to Iron. Source-integrated arcane
 * transformation is a separate evidenced physical path in physical/arcana/growth.
 *
 * Iron is anchored on one practiced capability (a path): the foundations that practice most
 * demands must reach IRON_FOUNDATION, and every other foundation must be sound (IRON_SUPPORT).
 * A person may qualify through different capabilities; the first whose whole assessment passes
 * is used, otherwise the strongest candidate's reasons are reported.
 */
export function assessAdvancement(world: World, p: Person, path: AdvancementStage[] = ['Normal', 'Iron']): AdvancementAssessment {
  const general: string[] = [];
  if (!p.alive) general.push('a living person is required');
  if (p.ontology.stage !== 'Normal') general.push('this assessment is Normal→Iron; later ranks use assessRankBreakthrough');
  if (path.length !== 2 || path[0] !== 'Normal' || path[1] !== 'Iron') general.push('requested stage path is blocked pending metaphysics');
  general.push(...bodilyReadiness(world, p));

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

/** A breakthrough remakes the body; it is attempted only from a present, recovered one. */
function bodilyReadiness(world: World, p: Person): string[] {
  const out: string[] = [];
  const bodies = p.bodies.map(id => world.body(id)).filter(b => b && b.present && !b.dead && b.health >= b.maxHealth * 0.8 && !['sleep', 'downed'].includes(b.pose));
  if (!bodies.length) out.push('a present, recovered body is required');
  if (bodies.some(b => Object.values(b!.injuries ?? {}).some(v => v > 0.25))) out.push('serious wounds prevent advancement');
  if (p.physiology.fatigue > 0.35 || p.physiology.sleepDebt > 8 || Math.min(p.physiology.energy, p.physiology.hydration) < 0.55) out.push('recovery state is insufficient');
  return out;
}
function foundationReasons(p: Person, core: AttributeId[], coreNeed = IRON_FOUNDATION, supportNeed = IRON_SUPPORT): string[] {
  const out: string[] = [];
  for (const id of ATTRIBUTE_IDS) {
    const need = core.includes(id) ? coreNeed : supportNeed;
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
  p.ontology = { stage: 'Iron', breakthroughEventId: event.id }; onBreakthrough(world, p, event); return true;
}
/** Whether any implemented path leads on from this stage. Every leveled rank below Diamond
 * has one; Diamond is the summit of the leveled ladder, and godhood is an ontological
 * transition rather than a numeric advancement (Constitution §15), so it stays blocked. */
export function advancementBlocked(stage: string): boolean { return !isLeveledRank(stage) || stage === 'Diamond'; }

export interface RankBreakthroughAssessment {
  stage: string; next: LeveledRank | null; eligible: boolean; reasons: string[];
  evidenceEventIds: EventId[]; featEventIds: EventId[]; path?: { skill: SkillId; core: AttributeId[] };
}
/**
 * Embodied breakthroughs beyond Iron (Bronze, Silver, Gold, Diamond). The DotF bottleneck:
 * the current rank's level track must be full. The HWFWM demand: distinct opposed victories
 * over opponents whose effective level reaches the current rank's band. As at Iron, one
 * practiced capability anchors the path: its core foundations at the trial's core demand,
 * every other foundation at its support demand, provenance-bearing technique and sustained
 * skilled practice. Thresholds are levels.EMBODIED_TRIALS; each fits inside the current vessel.
 */
export function assessRankBreakthrough(world: World, p: Person): RankBreakthroughAssessment {
  const stage = p.ontology.stage, reasons: string[] = [];
  const blocked = (why: string): RankBreakthroughAssessment => ({ stage, next: null, eligible: false, reasons: [why], evidenceEventIds: [], featEventIds: [] });
  if (!isLeveledRank(stage)) return blocked('levels end at Diamond; godhood is an ontological transition, not a numeric advancement');
  if (stage === 'Normal') return blocked('the Iron breakthrough comes first');
  const next = nextRank(stage);
  if (!next || next === 'Normal' || next === 'Iron') return blocked('Diamond is the summit of the leveled ladder');
  const trial = EMBODIED_TRIALS[next];
  if (!p.alive) reasons.push('a living person is required');
  reasons.push(...bodilyReadiness(world, p));
  const s = earnedStanding(p)!;
  if (!s.peak) reasons.push(`peak ${stage} is required (now ${s.label}, ${Math.floor(s.rankXp)}/${s.peakXp} experience)`);
  const feats = (p.experience?.feats ?? []).filter(f => f.level >= trial.featLevel && world.event(f.eventId)?.type === 'attack');
  if (feats.length < trial.feats) reasons.push(`${feats.length}/${trial.feats} opposed victories over ${rankOfLevel(trial.featLevel)}-band threats (level ${trial.featLevel}+)`);
  const featEventIds = feats.map(f => f.eventId);
  const candidates = (Object.entries(p.capability?.bySkill ?? {}) as [SkillId, { effectiveSeconds: number; sourceEventIds: EventId[] }][])
    .filter(([skill, value]) => value.effectiveSeconds >= trial.practiceHours * 3600 && (p.skills[skill] ?? 0) >= trial.skill)
    .sort((a, b) => b[1].effectiveSeconds - a[1].effectiveSeconds || a[0].localeCompare(b[0]));
  if (!candidates.length) return { stage, next, eligible: false, evidenceEventIds: [], featEventIds,
    reasons: [...reasons, `a relevant capability needs ${trial.practiceHours} hours of meaningful practice at ${Math.round(trial.skill * 100)}% proficiency`, ...foundationReasons(p, [], trial.core, trial.support)] };
  let first: RankBreakthroughAssessment | undefined;
  for (const [skill, value] of candidates) {
    const core = ironFoundationsFor(skill as PracticedSkillId), own = [...reasons, ...foundationReasons(p, core, trial.core, trial.support)];
    if (!pathTechnique(world, p, skill)) own.push(`provenance-bearing ${skill} technique knowledge is required`);
    const evidence = [...new Set(value.sourceEventIds)].filter(id => world.event(id));
    const a: RankBreakthroughAssessment = { stage, next, eligible: own.length === 0, reasons: own, evidenceEventIds: evidence, featEventIds, path: { skill, core } };
    if (a.eligible) return a;
    first ??= a;
  }
  return first!;
}
/** Explicit embodied breakthrough beyond Iron, with a larger real physiological cost. */
export function advanceRank(world: World, p: Person): boolean {
  const a = assessRankBreakthrough(world, p);
  if (!a.eligible || !a.next || !a.path) return false;
  const technique = pathTechnique(world, p, a.path.skill), from = p.ontology.stage;
  const causes = [...new Set([...a.featEventIds, ...a.evidenceEventIds, ...(technique?.source.viaEvent ? [technique.source.viaEvent] : [])])];
  const event = world.emit('ontological_advancement', { actor: p.id, category: 'history', significance: 1, causes,
    data: { from, to: a.next, adaptation: 'embodied capability', path: a.path.skill, core: a.path.core, feats: a.featEventIds, peak: true },
    summary: `${p.name} advanced from ${from} to ${a.next}` });
  p.physiology.energy = Math.max(0, p.physiology.energy - 0.25); p.physiology.hydration = Math.max(0, p.physiology.hydration - 0.25); p.physiology.fatigue = Math.min(1, p.physiology.fatigue + 0.4);
  p.ontology = { stage: a.next, breakthroughEventId: event.id }; onBreakthrough(world, p, event); return true;
}
/** The shared breakthrough intent for players and NPCs: Iron from Normal, then the rank trials. */
export function assessBreakthrough(world: World, p: Person): { eligible: boolean; next: string | null; reasons: string[]; path: { skill: SkillId; core: AttributeId[] } | null } {
  if (p.ontology.stage === 'Normal') { const a = assessAdvancement(world, p); return { eligible: a.eligible, next: 'Iron', reasons: a.reasons, path: a.path ?? null }; }
  const a = assessRankBreakthrough(world, p); return { eligible: a.eligible, next: a.next, reasons: a.reasons, path: a.path ?? null };
}
export function attemptBreakthrough(world: World, p: Person): boolean {
  return p.ontology.stage === 'Normal' ? advanceToIron(world, p) : advanceRank(world, p);
}
