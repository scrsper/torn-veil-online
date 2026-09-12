import type { Action, Body, Person, WorldEvent } from '../core/types';
import type { World } from '../core/world';
import type { MartialMode, MartialSession, TechniqueDefinition } from '../core/martialTypes';
import { techniqueDefinition } from '../core/martialDefinitions';
import { clamp, cognitiveCapability, individualRng } from '../core/human';
import { getPhysicalCapability } from '../core/attributes';
import { instructionFactor, practiceSkill, skillOf } from '../core/skills';
import { stepPhysiology } from '../core/physiology';
import { developThroughUnderstanding } from '../core/development';
import { instructionPairAvailable, TEACH_MIN_SKILL } from './apprenticeship';
import { remember } from './memory';
import { learn } from './knowledge';
import { isExternallyControlled } from '../runtime/controllers';
import { canExecuteTechnique, definitionClaim, demonstratedClaim, instructionClaim, knowsTechnique, learnTechnique, martialState, masteryOf, techniqueKnowledge } from './martialKnowledge';

export const SOLO_MASTERY_CEILING = 0.3;
export const SOLO_FAMILY_CEILING = 0.35;
export const MARTIAL_SESSION_SECONDS = 60;

export function availableForMartial(world: World, p: Person, bodyId: string): boolean {
  const b = world.body(bodyId), phys = p.physiology;
  return p.alive && p.age >= 12 && !p.hostile && !p.custody && !!b?.present && b.ownerId === p.id && !b.dead
    && b.subduedUntil <= world.physicalTime && b.health / b.maxHealth > 0.6
    && phys.energy > 0.3 && phys.hydration > 0.3 && phys.fatigue < 0.75 && phys.sleepDebt < 8
    && !['attack', 'flee', 'confront', 'sleep'].includes(p.mind.goal?.type ?? '')
    && getPhysicalCapability(p, world, { body: b }).currentExertionCapacity > 0.25;
}
export function canTeachTechnique(world: World, teacher: Person, id: string): boolean {
  const d = techniqueDefinition(world, id);
  return !!d && canExecuteTechnique(world, teacher, id) && masteryOf(teacher, id) >= 0.45 && skillOf(teacher, d.family) >= TEACH_MIN_SKILL;
}
/** A reserving session is canonical action state, not a second NPC scheduler. */
function reservation(world: World, id: string): MartialSession | undefined {
  for (const p of world.persons()) {
    const s = p.martial?.session;
    if (s && (p.id === id || s.partnerId === id) && p.mind.plan.some(a => a.status !== 'done' && a.status !== 'failed' && a.data?.martialSessionId === s.id)) return s;
  }
  return undefined;
}
function partnerConsents(world: World, p: Person, actor: Person, bodyId: string): boolean {
  if (!availableForMartial(world, p, bodyId)) return false;
  // An ordinary idle/social peer can accept an offer; active work, obligations and
  // external player intentions cannot be commandeered by somebody else's training.
  const active = p.mind.plan.find(a => a.status === 'pending' || a.status === 'active');
  if (isExternallyControlled(p) && !(active?.data?.martial && active.targetEntity === actor.id)) return false;
  return !active || (active.data?.martial && active.targetEntity === actor.id)
    || (['wait', 'look', 'talk'].includes(active.type) && ['idle', 'socialize', 'talk', 'wander'].includes(p.mind.goal?.type ?? 'idle'));
}
function lessonTeacher(world: World, a: Person, b: Person, id: string): Person | undefined {
  const au = techniqueKnowledge(a, id)?.claim.understanding ?? 0, bu = techniqueKnowledge(b, id)?.claim.understanding ?? 0;
  if (canTeachTechnique(world, a, id) && Math.min(0.85, au) > bu + 0.01) return a;
  if (canTeachTechnique(world, b, id) && Math.min(0.85, bu) > au + 0.01) return b;
  return undefined;
}
function eligible(world: World, p: Person, s: Pick<MartialSession, 'mode' | 'techniqueId' | 'bodyId' | 'partnerId' | 'partnerBodyId'>, existing?: string): boolean {
  if (!availableForMartial(world, p, s.bodyId)) return false;
  const d = techniqueDefinition(world, s.techniqueId);
  if (!d || d.family !== 'unarmed') return false; // Vocabulary is extensible; armed execution is not implemented here.
  const busy = reservation(world, p.id); if (busy && busy.id !== existing) return false;
  if (s.mode === 'lesson' || s.mode === 'spar') {
    const q = world.person(s.partnerId), otherBusy = q && reservation(world, q.id);
    if (!q || !s.partnerBodyId || (otherBusy && otherBusy.id !== existing)
      || !partnerConsents(world, q, p, s.partnerBodyId)
      || !instructionPairAvailable(world, p, q, s.bodyId, s.partnerBodyId)) return false;
    return s.mode === 'lesson' ? !!lessonTeacher(world, p, q, s.techniqueId)
      : canExecuteTechnique(world, p, s.techniqueId) && canExecuteTechnique(world, q, s.techniqueId);
  }
  if (!canExecuteTechnique(world, p, s.techniqueId)) return false;
  return s.mode !== 'experiment' || (masteryOf(p, s.techniqueId) >= 0.45 && skillOf(p, d.family) >= 0.45
    && cognitiveCapability(p).reasoning >= 0.9 && !d.parentId && !world.martialDefinitions?.[variantId(world, p, d)]);
}

/** Execution profile for the future contact layer. Attributes shape force/control and
 * reading, while learned control separately shapes timing uncertainty. No damage bonus. */
export function techniqueExecutionProfile(world: World, p: Person, bodyId: string, id: string) {
  if (!canExecuteTechnique(world, p, id)) return null;
  const b = world.body(bodyId); if (!b?.present || b.ownerId !== p.id || b.dead) return null;
  const d = techniqueDefinition(world, id)!, cap = getPhysicalCapability(p, world, { body: b }), cognition = cognitiveCapability(p);
  const proficiency = skillOf(p, d.family), mastery = masteryOf(p, id);
  const control = (0.15 + proficiency * 0.35 + mastery * 0.5) * cap.effectiveDexterity;
  return { forceCapacity: cap.effectiveStrength, coordination: control,
    timingUncertaintySeconds: 0.3 / Math.max(0.1, cognition.observation * (0.5 + control)),
    sustainedEffort: cap.currentExertionCapacity / cap.fatigueMultiplier,
    composure: cognition.persistence, mastery, proficiency };
}

/** Bounded learning from effort AND useful feedback. Unchanging solo feedback has a
 * competence ceiling; neither endless dummy hits nor no-op/rejected reports can master it. */
export function learningValue(seconds: number, effort: number, feedback: number, challenge: number): number {
  if (![seconds, effort, feedback, challenge].every(Number.isFinite) || seconds <= 0 || seconds > 60
    || effort < 0.1 || effort > 1 || feedback <= 0 || feedback > 1 || challenge <= 0 || challenge > 1) return 0;
  return seconds / 60 * effort * feedback * Math.sqrt(challenge);
}
function credit(world: World, p: Person, id: string, seconds: number, effort: number, feedback: number, challenge: number, ceiling: number, eventId: string): number {
  const d = techniqueDefinition(world, id); if (!d || !canExecuteTechnique(world, p, id)) return 0;
  const value = learningValue(seconds, effort, feedback, challenge);
  if (!value) return 0;
  const state = martialState(p), m = state.mastery[id] ??= { value: 0, seconds: 0 };
  const before = m.value, understanding = techniqueKnowledge(p, id)!.claim.understanding;
  const instruction = 1 + 0.3 * clamp(understanding, 0, 1);
  m.value = Math.max(before, Math.min(ceiling, before + 0.025 * value * instruction * (1 - before)));
  m.seconds += seconds; m.lastEventId = eventId;
  const familyCeiling = ceiling <= SOLO_MASTERY_CEILING ? SOLO_FAMILY_CEILING : 1;
  const familyBefore = skillOf(p, d.family);
  if (familyBefore < familyCeiling) {
    // Cap the credited amount before calling the shared curve, not by undoing earned skill.
    const amount = Math.min(value * instruction, (familyCeiling - familyBefore) / (0.015 * instructionFactor(p, d.family) * (1 - familyBefore)));
    practiceSkill(p, d.family, amount, world);
  }
  return m.value - before;
}

/** Called by setGoal/cancel before replacing an in-flight plan at final integration. */
export function cancelMartial(world: World, p: Person, reason: string): void {
  const s = p.martial?.session; if (!s) return;
  world.emit('work_shift', { actor: p.id, target: s.partnerId, pos: world.body(s.bodyId)?.pos, category: 'social',
    visibility: 5, significance: 0.3, causes: [s.originEventId],
    data: { martial: s.mode, phase: 'interrupted', techniqueId: s.techniqueId, seconds: s.seconds, reason },
    summary: `${p.name} stopped martial ${s.mode}` });
  delete p.martial!.session;
}

/** Shared physiology classifier hook covers both the initiator and a consenting peer.
 * Use before idle/sleep pose fallbacks; a cancelled plan immediately releases its peer. */
export function martialActivityLevel(world: World, p: Person): 'craft' | 'chop' | undefined {
  const s = reservation(world, p.id);
  return s ? s.mode === 'lesson' ? 'craft' : 'chop' : undefined;
}

/** Canonical planner/command entry. Caller advances world.physicalTime; repeated calls at
 * one instant do nothing. Sessions cannot bank idle gaps (one call covers at most 60s).
 * Standalone driver owns physiology; live scheduler must pass physiology:'scheduler' and
 * classify these actions as craft (lessons) / chop (practice), charging its usual world dt. */
export function actOnMartial(world: World, p: Person, action: Action, seconds: number, options: { physiology?: 'owned' | 'scheduler' } = {}): boolean {
  const mode = action.data?.martial as MartialMode | undefined;
  if (!mode || !['practice', 'spar', 'lesson', 'experiment'].includes(mode)) return false;
  if (action.status === 'done' || action.status === 'failed') return true;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 || p.mind.plan.find(a => a.status === 'pending' || a.status === 'active') !== action) { action.status = 'failed'; return true; }
  const state = martialState(p);
  let s = state.session;
  if (!s || action.data!.martialSessionId !== s.id) {
    if (s && !reservation(world, p.id)) { cancelMartial(world, p, 'the previous plan ended'); s = undefined; }
    const candidate = { mode, techniqueId: action.data!.techniqueId, bodyId: action.data!.bodyId,
      partnerId: action.targetEntity, partnerBodyId: action.data!.partnerBodyId };
    if (!eligible(world, p, candidate)) { action.status = 'failed'; return true; }
    const ev = world.emit('work_shift', { actor: p.id, target: candidate.partnerId, category: 'social', pos: world.body(candidate.bodyId)!.pos,
      visibility: 5, loudness: 2, significance: 0.3, data: { martial: mode, phase: 'started', techniqueId: candidate.techniqueId },
      causes: [techniqueKnowledge(p, candidate.techniqueId)?.source.viaEvent].filter((x): x is string => !!x), summary: `${p.name} began martial ${mode}` });
    s = state.session = { ...candidate, id: ev.id, originEventId: ev.id, startedAt: world.physicalTime, lastPhysicalAt: world.physicalTime,
      requiredSeconds: MARTIAL_SESSION_SECONDS, seconds: 0, effort: 0 };
    action.data!.martialSessionId = s.id; action.status = 'active';
    return true;
  }
  const elapsed = world.physicalTime - s.lastPhysicalAt;
  if (elapsed <= 0) return true;
  if (elapsed > seconds + 1e-7 || !eligible(world, p, s, s.id)) {
    action.status = 'failed'; cancelMartial(world, p, elapsed > seconds + 1e-7 ? 'uncredited time gap' : 'opportunity ended'); return true;
  }
  const q = world.person(s.partnerId);
  if (state.creditedThrough > s.lastPhysicalAt + 1e-7 || (q && martialState(q).creditedThrough > s.lastPhysicalAt + 1e-7)) {
    action.status = 'failed'; cancelMartial(world, p, 'overlapping physical effort'); return true;
  }
  const spent = Math.min(elapsed, s.requiredSeconds - s.seconds);
  const participants: [Person, Body][] = [[p, world.body(s.bodyId)!]];
  if (q) participants.push([q, world.body(s.partnerBodyId)!]);
  let effort = 1;
  for (const [person, body] of participants) {
    const cap = getPhysicalCapability(person, world, { body });
    effort = Math.min(effort, cap.currentExertionCapacity);
    martialState(person).creditedThrough = world.physicalTime;
    if (options.physiology !== 'scheduler') stepPhysiology(world, person, spent * world.clock.timeScale / 3600,
      s.mode === 'lesson' ? 'craft' : 'chop', { indoor: world.isIndoors(body.pos), daylight: 0.7 });
  }
  s.seconds += spent; s.effort += spent * effort; s.lastPhysicalAt = world.physicalTime;
  if (s.seconds + 1e-7 < s.requiredSeconds) return true;
  finish(world, p, s, q);
  delete state.session; action.status = 'done';
  return true;
}

function finish(world: World, p: Person, s: MartialSession, q?: Person) {
  const id = s.techniqueId, d = techniqueDefinition(world, id)!, effort = s.effort / s.seconds;
  const teacher = s.mode === 'lesson' && q ? lessonTeacher(world, p, q, id) : undefined;
  const ev = world.emit(teacher ? 'work_taught' : 'work_shift', { actor: teacher?.id ?? p.id,
    target: teacher ? (teacher.id === p.id ? q!.id : p.id) : q?.id, category: 'social', pos: world.body(s.bodyId)!.pos,
    visibility: 5, loudness: 2, significance: 0.45, causes: [s.originEventId, ...(teacher ? [techniqueKnowledge(teacher, id)?.source.viaEvent].filter((x): x is string => !!x) : [])],
    data: { martial: s.mode, phase: 'completed', techniqueId: id, seconds: s.seconds, effort,
      feedback: s.mode === 'practice' ? 0.6 : 0.9, martialDemonstration: demonstratedClaim(teacher ?? p, id) }, summary: `${p.name} completed martial ${s.mode}` });
  if (teacher) {
    const student = teacher.id === p.id ? q! : p, source = { type: 'told' as const, from: teacher.id, viaEvent: ev.id };
    const k = techniqueKnowledge(teacher, id)!;
    const claim = instructionClaim(teacher, id, ev)!;
    const previous = techniqueKnowledge(student, id)?.claim.understanding ?? 0;
    const comprehension = clamp(cognitiveCapability(student).reasoning / Math.sqrt(d.complexity), 0.25, 1);
    claim.understanding = previous + (claim.understanding - previous) * comprehension;
    learnTechnique(world, student, claim, Math.min(0.85, k.confidence), source, k.hops + 1);
    learn(world, teacher, { key: `martial-lesson:${student.id}:${id}`, kind: 'fact',
      claim: { martialLesson: id, studentId: student.id, eventId: ev.id, tick: world.now, significance: 0.4 },
      confidence: 0.9, source: { type: 'self', viaEvent: ev.id }, cause: ev.id });
    developThroughUnderstanding(world, student, `martial:${id}`, d.complexity, s.seconds, ev.id);
    remember(world, student, { type: 'work_taught', eventId: ev.id, entities: [teacher.id], significance: 0.55, valence: 0.3, source, summary: `${teacher.name} taught ${id}` });
  } else if (s.mode === 'experiment') discover(world, p, d, s, ev);
  else if (s.mode === 'spar' && q) {
    const pm = masteryOf(p, id), qm = masteryOf(q, id);
    credit(world, p, id, s.seconds, effort, 0.9, clamp(0.4 + qm - pm, 0.15, 1), Math.min(0.95, Math.max(0.35, qm + 0.2)), ev.id);
    credit(world, q, id, s.seconds, effort, 0.9, clamp(0.4 + pm - qm, 0.15, 1), Math.min(0.95, Math.max(0.35, pm + 0.2)), ev.id);
  } else credit(world, p, id, s.seconds, effort, 0.6, 0.35, SOLO_MASTERY_CEILING, ev.id);
}

function variantId(world: World, p: Person, d: TechniqueDefinition): string {
  return `${d.techniqueId}:variant:${individualRng(world.seed, `${p.id}:${d.techniqueId}`).state().toString(16)}`;
}
function discover(world: World, p: Person, parent: TechniqueDefinition, session: MartialSession, ev: WorldEvent) {
  const techniqueId = variantId(world, p, parent);
  if (world.martialDefinitions?.[techniqueId]) return;
  // One modest variation per person/root, selected by stable seed/identity; no random rerolls.
  const compact = individualRng(world.seed, techniqueId).next() < 0.5;
  const understood = techniqueKnowledge(p, parent.techniqueId)!;
  const d: TechniqueDefinition = { ...structuredClone(parent), techniqueId, name: `${compact ? 'Compact' : 'Measured'} ${parent.name.toLowerCase()}`,
    parentId: parent.techniqueId, creatorId: p.id, originEventId: ev.id, complexity: parent.complexity + 1,
    // Experiments compose the motions this person actually understands, including mistakes;
    // canonical parent metadata is not a back door to missing instructional content.
    components: [...(understood.claim.components ?? []), compact ? 'compact-recovery' : 'measured-transition'],
    prerequisites: { proficiency: Math.max(0.25, parent.prerequisites.proficiency), techniques: [parent.techniqueId] } };
  (world.martialDefinitions ??= {})[techniqueId] = d;
  ev.data.discovery = structuredClone(d);
  learnTechnique(world, p, definitionClaim(d, 0.7), 0.7, { type: 'self', from: p.id, viaEvent: ev.id });
  developThroughUnderstanding(world, p, `martial:${techniqueId}`, d.complexity, session.seconds, ev.id);
}

/** Contact integration contract: only the canonical combat producer may attach this
 * evidence to its terminal combat_action event after it has paid the physical effort.
 * No client quality/XP field is accepted. A failed hit can teach if it had real feedback. */
export interface TechniqueUseEvidence {
  techniqueId: string; bodyId: string; startPhysicalAt: number; endPhysicalAt: number;
  effort: number; feedback: number; challenge: number; targetBodyId?: string;
}
export function submitTechniqueUse(world: World, p: Person, eventId: string): number {
  const ev = world.event(eventId), use = ev?.data.techniqueUse as TechniqueUseEvidence | undefined;
  if (!ev || ev.type !== 'combat_action' || ev.actor !== p.id || !['complete', 'missed', 'interrupted'].includes(ev.data.phase) || !use || !p.alive) return 0;
  const body = world.body(use.bodyId), state = martialState(p);
  if (!body?.present || body.ownerId !== p.id || body.dead || ev.data.actorBodyId !== body.id || !Number.isFinite(use.startPhysicalAt) || !Number.isFinite(use.endPhysicalAt)
    || use.endPhysicalAt > world.physicalTime || use.startPhysicalAt < state.creditedThrough || use.endPhysicalAt <= use.startPhysicalAt
    || !canExecuteTechnique(world, p, use.techniqueId)) return 0;
  const value = learningValue(use.endPhysicalAt - use.startPhysicalAt, use.effort, use.feedback, use.challenge);
  if (!value) return 0;
  const target = world.body(use.targetBodyId);
  // A living, moving opponent is needed to exceed bounded solo feedback. The event records
  // its canonical responsive-target assessment, so delayed consumption never reads new motion.
  const responsive = !!target && target.ownerId !== p.id && ev.data.responsiveTarget === true;
  state.creditedThrough = use.endPhysicalAt;
  return credit(world, p, use.techniqueId, use.endPhysicalAt - use.startPhysicalAt, use.effort, use.feedback, use.challenge,
    responsive ? 0.95 : SOLO_MASTERY_CEILING, ev.id);
}
