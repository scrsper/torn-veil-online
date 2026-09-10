import type { Occupation, Person, SkillId } from './types';
import type { ToolAction } from './tools';

/**
 * Learned capability (v0.6 §V) — see `SkillId`'s doc comment in core/types.ts for what this is
 * and is not. Deliberately small: one skill per materially different kind of work the
 * simulation actually has, a bounded 0..1 proficiency, and a single diminishing-returns
 * learning curve. No event is emitted per practice (Constitution v0.6 §V.9 — a skill gain on
 * every batch/swing/labour-slice would be exactly the kind of per-tick spam the rest of this
 * codebase's event log deliberately avoids); proficiency is inspectable directly instead.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 0 (complete novice) if the person has never practiced this skill — the same as every
 * pre-v0.6 person, since `getPhysicalCapability`'s skill terms are identity multipliers at 0. */
export function skillOf(p: Person, id: SkillId): number { return p.skills?.[id] ?? 0; }

/**
 * How much a bare unit of real, successful work (one extraction, one batch, one credited
 * minute of labour, one load/unload cycle) advances proficiency. Diminishing as proficiency
 * rises (Constitution v0.6 §V.9 "progression should slow as proficiency increases") — a novice
 * improves quickly from their first real jobs; a seasoned worker needs much more accumulated
 * work for the same further gain. Reaching high mastery (~0.8) from scratch takes roughly a
 * hundred such units — real, accumulated practice, not a same-afternoon grind.
 */
const BASE_GAIN = 0.015;

/** Only called at the point a real, successful unit of work has already happened (a batch that
 * produced something, a swing that extracted material, a credited labour-slice, a completed
 * haul cycle) — never for standing at a workplace or a failed/no-op attempt, so neither can
 * train a skill (Constitution v0.6 §V.9). `amount` is in the same "one unit" terms as the base
 * gain above (a fractional amount for a partial slice, e.g. minutes of build labour / 1 minute). */
export function practiceSkill(p: Person, id: SkillId, amount = 1): void {
  if (amount <= 0) return;
  const cur = skillOf(p, id);
  if (cur >= 1) return;
  p.skills = p.skills ?? {};
  p.skills[id] = clamp01(cur + BASE_GAIN * amount * instructionFactor(p, id) * (1 - cur));
}

// ---------------------------------------------------------------- Adaptive Society (v0.5)
/**
 * INSTRUCTION IS NOT CAPABILITY.
 *
 * Being shown how a trade is done leaves a `technique` belief in the student's head, with the
 * teacher named on it (see mind/apprenticeship.ts). That belief is worth exactly one thing: real
 * practice afterwards counts for more. It grants no proficiency of its own, it unlocks nothing,
 * and a person who has been taught and never worked is indistinguishable, mechanically, from one
 * who was never taught at all — which is the whole point. A lesson followed by no work is a
 * memory of a lesson.
 *
 * Kept here rather than in `mind/` so `practiceSkill` — which every trade calls from
 * `world/metabolism.ts` — can consult it without the world layer reaching into cognition.
 */
export function techniqueKey(id: SkillId): string { return `technique:${id}`; }
/** How much more a taught novice gets out of the same batch. Deliberately modest: instruction
 * shortens the road, it does not replace walking it. A taught novice still needs dozens of real
 * batches to reach a working proficiency. */
export const INSTRUCTION_PRACTICE_BONUS = 0.6;
export function instructionFactor(p: Person, id: SkillId): number {
  const k = p.knowledge?.[techniqueKey(id)];
  if (!k || k.claim.skill !== id) return 1;
  // A half-remembered lesson helps less than a fresh one — the belief's own confidence carries
  // that, for free, through the ordinary knowledge machinery.
  return 1 + INSTRUCTION_PRACTICE_BONUS * clamp01(k.confidence);
}

/**
 * THE PROFICIENCY A SETTLED TRADESMAN HAS.
 *
 * Ashford's baker, miller, cook and herbalist all begin around here (`STARTING_SKILLS` below) —
 * not because the number is issued to them by their occupation, but because a person who has
 * ground grain for twenty years IS this good at it. It is read as a REFERENCE POINT, never as a
 * cap or a permission: the only thing it decides is what "working at the ordinary pace of the
 * trade" means, so that somebody below it is measurably a novice and somebody above it is not
 * rewarded twice for the same mastery.
 *
 * Sizing it at exactly the seeded professional proficiency is deliberate: it means the existing
 * village works precisely as it did before this milestone, and every penalty below is paid only
 * by people who genuinely have not learned the work yet.
 */
export const TRADE_BASELINE = 0.6;
/** 1 at total novice, 0 at (or above) a settled tradesman's proficiency. */
export function noviceShortfall(skill: number): number {
  return clamp01((TRADE_BASELINE - skill) / TRADE_BASELINE);
}
/** How much longer a batch takes for someone still learning. A complete novice at the mill spends
 * close to twice as long on one batch as Hobb did — real time, and therefore real energy and real
 * hours not spent on anything else, without inventing a separate exhaustion rule for novices. */
export const NOVICE_TIME_PENALTY = 0.75;
/** How much of a batch a novice spoils. A complete novice gets half the flour out of the same
 * grain; the grain is consumed either way, because badly ground meal is still ground. Never below
 * one unit — a batch that produced literally nothing would be a failed batch, not a poor one, and
 * would (wrongly) read to the rest of the simulation as a material shortage. */
export const NOVICE_YIELD_PENALTY = 0.5;

export function tradeBatchSeconds(base: number, skill: number): number {
  return base * (1 + noviceShortfall(skill) * NOVICE_TIME_PENALTY);
}
export function tradeYield(full: number, skill: number): number {
  return Math.max(1, Math.round(full * (1 - noviceShortfall(skill) * NOVICE_YIELD_PENALTY)));
}

/** Which skill (if any) a given tool action draws on — lets `getPhysicalCapability` (core/
 * attributes.ts) resolve skill automatically from the action already being passed in, with no
 * change needed at any of chop/quarry/saw/construct's existing call sites. Hauling has no
 * `ToolAction` (no tool governs raw carrying) so it is resolved explicitly at its own call site
 * (logistics/haul.ts's `personalCarryUnits`) instead of through this table. */
export const SKILL_FOR_TOOL_ACTION: Partial<Record<ToolAction, SkillId>> = {
  chop: 'woodcutting', quarry: 'quarrying', saw: 'sawing', construct: 'construction',
};

/**
 * Plausible starting proficiency by profession (Constitution v0.6 §V.10 — "people with existing
 * professions should not begin as total novices"). World-generation background, exactly like a
 * profession's starting knowledge/tools — never a magical permission, just a head start on the
 * SAME learning curve everyone else uses. Occupations absent from this table (merchant, priest,
 * guard, child, ...) start every skill at 0, same as pre-v0.6 — nothing about them changes.
 */
const STARTING_SKILLS: Partial<Record<Occupation, Partial<Record<SkillId, number>>>> = {
  woodcutter: { woodcutting: 0.55, sawing: 0.4, hauling: 0.25 },
  baker: { baking: 0.6 },
  // Adaptive Society (v0.5): milling became a real learned capability this milestone, so the man
  // who has run Ashford's mill for years needs the proficiency to match — at exactly
  // `TRADE_BASELINE`, so nothing about how the working village behaves changes, and every novice
  // penalty falls only on people who have genuinely not learned the trade.
  miller: { milling: 0.6, hauling: 0.25 },
  farmer: { hauling: 0.3 },
  apprentice: { construction: 0.2, hauling: 0.25 },
  vagrant: { hauling: 0.2 },
  hunter: { hauling: 0.2, hunting: 0.6 },
  smith: { construction: 0.15 },
  // v0.8: plausible starting proficiency by profession — Old Wyn already has "found things at
  // the old shrine that others have lost" and lives off the woods; Edda already cooks at the
  // tavern.
  herbalist: { herbalism: 0.65 },
  cook: { cooking: 0.55 },
};

export function seedStartingSkills(p: Person): void {
  const starting = STARTING_SKILLS[p.occupation];
  if (starting) p.skills = { ...p.skills, ...starting };
}
