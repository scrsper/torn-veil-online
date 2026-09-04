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
  p.skills[id] = clamp01(cur + BASE_GAIN * amount * (1 - cur));
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
  farmer: { hauling: 0.3 },
  apprentice: { construction: 0.2, hauling: 0.25 },
  vagrant: { hauling: 0.2 },
  hunter: { hauling: 0.2 },
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
