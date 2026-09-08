import type { EntityId, KnowledgeItem, Person, SkillId } from '../core/types';
import type { World } from '../core/world';
import { skillOf, techniqueKey } from '../core/skills';
import { learn } from './knowledge';
import { remember } from './memory';
import { getRel } from './relationships';

/**
 * BEING SHOWN HOW (Adaptive Society v0.5).
 *
 * The smallest teaching path this architecture can honestly support, and nothing beyond it. There
 * are no guilds, no schools, no curricula and no apprentice contracts — those are all named in
 * the milestone's own scope limit. There is one act: somebody who can do a thing shows somebody
 * who is doing it badly, standing beside them at the work.
 *
 * WHAT INSTRUCTION IS. A `technique` belief in the student's knowledge map, with the teacher on
 * its `source` — the same provenance machinery every other belief in this simulation carries, so
 * "who taught whom" is answerable years later, survives a save, decays if it is never used, and
 * can be told on to a third person exactly like any other thing somebody knows.
 *
 * WHAT INSTRUCTION IS NOT. Capability. `teach` raises no skill, and a student who is taught and
 * never works is mechanically identical to one who was never taught (see
 * `tests/adaptive-society.test.ts`'s "teaching does not instantly grant mastery"). All the belief
 * does is make real practice count for more — `core/skills.ts`'s `practiceSkill` reads it through
 * `instructionFactor`, and that is the only place in the codebase that reads it at all. A lesson
 * followed by no work is a memory of a lesson.
 *
 * This is Constitution §12 held to at the point where it is easiest to break: the tempting
 * shortcut is for a lesson to hand over a level. It does not.
 */

/** Below this, you do not know the work well enough to show anybody else how it goes. */
export const TEACH_MIN_SKILL = 0.4;
/** A lesson is only a lesson if the teacher is genuinely ahead. Two novices comparing notes is
 * not instruction, and letting it count as such is how a village bootstraps mastery out of
 * nothing. */
export const TEACH_MIN_GAP = 0.25;
/** How close you have to be standing. This is being shown, at the work — not being told about it
 * across a tavern table. */
export const TEACH_RANGE_METRES = 5;
/** How long a lesson stands before being shown again is worth a fresh event. Long enough that a
 * pair working the same shift produce a handful of canonical lessons across a season, not one per
 * batch. */
export const TEACH_RENOTICE_SECONDS = 12 * 3600;
/** A teacher who is feared or distrusted is not going to be listened to, and one who distrusts
 * the student is not going to show them the trade. Bounded and symmetric. */
export const TEACH_MIN_TRUST = -0.25;

export { techniqueKey };

/** The instruction this person has received in a trade, if any — carrying who gave it. */
export function instructionOf(p: Person, skill: SkillId): KnowledgeItem | undefined {
  const k = p.knowledge?.[techniqueKey(skill)];
  return k && k.claim.skill === skill ? k : undefined;
}
/** Every trade this person has been shown, for traces and the inspector. */
export function instructionsHeld(p: Person): KnowledgeItem[] {
  return Object.values(p.knowledge ?? {}).filter(k => k.kind === 'technique');
}

export interface TeachingOpportunity { teacher: Person; student: Person; skill: SkillId; gap: number; }

/**
 * Is this pair, standing where they are standing, a lesson? Pure — decides nothing and changes
 * nothing. The direction falls out of the skills: whoever is ahead teaches.
 */
export function teachingOpportunity(world: World, a: Person, b: Person, skill: SkillId): TeachingOpportunity | null {
  if (a.id === b.id || !a.alive || !b.alive || a.hostile || b.hostile) return null;
  const ahead = skillOf(a, skill) >= skillOf(b, skill) ? a : b;
  const behind = ahead === a ? b : a;
  if (behind.controlled) return null; // the player is taught by playing, not by a tick
  const gap = skillOf(ahead, skill) - skillOf(behind, skill);
  if (skillOf(ahead, skill) < TEACH_MIN_SKILL || gap < TEACH_MIN_GAP) return null;
  const ab = world.primaryBody(ahead.id), bb = world.primaryBody(behind.id);
  if (!ab || !bb || ab.dead || bb.dead) return null;
  if (Math.hypot(ab.pos.x - bb.pos.x, ab.pos.z - bb.pos.z) > TEACH_RANGE_METRES) return null;
  if (getRel(ahead, behind.id).trust < TEACH_MIN_TRUST || getRel(behind, ahead.id).trust < TEACH_MIN_TRUST) return null;
  return { teacher: ahead, student: behind, skill, gap };
}

/**
 * One lesson. Returns the student's belief when this was a fresh lesson worth a canonical event,
 * and null when they were shown the same thing recently (in which case the standing belief is
 * reconfirmed in place — being shown again makes you surer of it, not newly taught).
 *
 * Note what does NOT happen here: no call to `practiceSkill`, no write to `student.skills`, no
 * write to `teacher.skills`. That absence is the invariant.
 */
export function teach(world: World, teacher: Person, student: Person, skill: SkillId): KnowledgeItem | null {
  const key = techniqueKey(skill);
  const existing = instructionOf(student, skill);
  if (existing && world.now - existing.learnedAt < TEACH_RENOTICE_SECONDS) {
    existing.lastConfirmedAt = world.now;
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    return null;
  }
  const body = world.primaryBody(student.id);
  const ev = world.emit('work_taught', {
    actor: teacher.id, target: student.id, category: 'social',
    pos: body ? { ...body.pos } : undefined,
    placeId: body ? world.placeAt(body.pos)?.id : undefined,
    significance: 0.35, visibility: 8,
    data: { skill, teacherSkill: Math.round(skillOf(teacher, skill) * 100) / 100, studentSkill: Math.round(skillOf(student, skill) * 100) / 100 },
    summary: `${teacher.name} showed ${student.name} how ${skill} is done`,
  });
  const claim = { type: 'technique', skill, teacherId: teacher.id, tick: world.now, significance: 0.35, eventId: ev.id };
  // Refreshed in place rather than re-learned, for the same reason a standing shortage is: `learn`
  // reads a new `eventId` on a held key as a bare correction and would leave the belief pointing
  // at a stale lesson. Confidence is capped below 1 — you can be shown a trade; you cannot be
  // shown it perfectly.
  let belief: KnowledgeItem | undefined = existing;
  if (belief) {
    belief.claim = { ...belief.claim, ...claim };
    belief.confidence = Math.min(0.95, belief.confidence + 0.15);
    belief.source = { type: 'told', from: teacher.id, viaEvent: ev.id };
    belief.hops = 1;
    belief.learnedAt = world.now;
    belief.lastConfirmedAt = world.now;
  } else {
    belief = learn(world, student, {
      key, kind: 'technique', claim,
      confidence: 0.7, hops: 1,
      source: { type: 'told', from: teacher.id, viaEvent: ev.id },
      cause: ev.id,
      summary: `${teacher.name} showed me how ${skill} is done`,
    }) ?? undefined;
  }
  if (belief) {
    remember(world, student, {
      type: 'work_taught', summary: `${teacher.name} showed me how ${skill} is done`,
      eventId: ev.id, entities: [teacher.id], significance: 0.35, valence: 0.3,
      source: { type: 'told', from: teacher.id, viaEvent: ev.id },
      placeId: body ? world.placeAt(body.pos)?.id : undefined,
    });
  }
  return belief ?? null;
}

/**
 * The one call site the simulation makes: whoever is working here, is anybody ALSO working here
 * worth showing (or worth being shown by)? Run on the batch cadence, so a lesson costs nothing
 * per physical step, and rate-limited by the student's own standing belief above.
 *
 * `placeId` is what makes this an apprenticeship rather than a lecture, and it was added because
 * the first version did not have it: without it, every villager who happened to walk past the
 * bakery while the baker was at the oven was "taught baking" — 28 lessons across a 22-day
 * unattended run, to a priest, a smith, a child and the village elder, not one of whom ever went
 * near an oven again. Instruction with no work behind it is not instruction; it is an event log
 * of proximity. So the student has to be at the work too: their current goal is this place's
 * work, or they already have an open stint here.
 *
 * Candidates are scanned deterministically by id.
 */
export function maybeTeachAt(world: World, worker: Person, skill: SkillId, placeId: EntityId): KnowledgeItem | null {
  const wb = world.primaryBody(worker.id);
  if (!wb) return null;
  const atTheWork = (q: Person): boolean =>
    (q.mind.goal?.type === 'work' && q.mind.goal.targetPlace === placeId)
    || world.workStints.some(s => s.personId === q.id && s.placeId === placeId && !s.endedAt);
  if (!atTheWork(worker) && !world.place(placeId)?.workers.includes(worker.id)) return null;
  const near = world.persons()
    .filter(q => q.id !== worker.id && q.alive && !q.hostile && atTheWork(q))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const other of near) {
    const opp = teachingOpportunity(world, worker, other, skill);
    if (!opp) continue;
    const taught = teach(world, opp.teacher, opp.student, skill);
    if (taught) return taught;
  }
  return null;
}
