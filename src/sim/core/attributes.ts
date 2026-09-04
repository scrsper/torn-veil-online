import type { Attributes, Item, Person } from './types';
import type { World } from './world';
import { heatBand } from './physiology';
import { bestToolFor, toolWorkMultiplier, type ToolAction } from './tools';
import { physiologyProfileFor } from './species';

/**
 * The centralized physical-capability layer (v0.4 §3). Every action that cares "how strong/
 * skilled/capable is this person right now" reads `getPhysicalCapability` instead of touching
 * `person.attributes` directly — this is the one extension point future systems (fatigue
 * tuning, injury, magic, ontological advancement) can widen without editing every job handler
 * (Constitution v0.4 §16-17: physical law must be modifiable through rules, not hardcoded per
 * action). Inputs today: base attributes, fatigue, sleep debt, caloric energy, hydration, heat,
 * and an optional tool for the action at hand. All outputs are continuous — nothing here is a
 * hard binary gate.
 */
export interface PhysicalCapability {
  effectiveStrength: number;
  effectiveDexterity: number;
  /** Mass (kg) this person can safely carry for a haul right now. */
  safeCarryMassKg: number;
  /** General work-rate multiplier (1 = an unencumbered, rested, averagely-attributed adult
   * with no tool). Folds in dexterity/strength, fatigue, heat and (when an action is given) a
   * tool multiplier. Multiply a base action duration/output by this. */
  workRate: number;
  /** Multiplies the BASE energy-cost rate for the activity (core/physiology.ts). A weaker or
   * already-depleted person spends relatively more of their reserve on the same nominal work. */
  energyCostMultiplier: number;
  /** Multiplies the base fatigue-gain rate. */
  fatigueMultiplier: number;
  /** 0..1 — how well this person resists heat's work penalty (a future high-tier body would
   * push this toward 1: unaffected). 1 today for every ordinary human. */
  heatTolerance: number;
  /** 0..1 gate on whether heavy work is even worth attempting right now — starving, exhausted,
   * or overheated people have little left to give. Goal utility (mind/agent.ts) reads this
   * rather than re-deriving "am I too tired" per goal type. */
  currentExertionCapacity: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** kg an averagely-strong (0.5), unencumbered adult can safely carry. Strength scales this
 * continuously (Constitution v0.4 §2: "prefer continuous effects" over a hard carry limit). */
const BASE_CARRY_KG = 16;
const CARRY_PER_STRENGTH_KG = 44; // strength 1.0 adds this much on top of BASE_CARRY_KG

export function getPhysicalCapability(p: Person, _world: World, ctx: { action?: ToolAction; tool?: Item | null } = {}): PhysicalCapability {
  const attrs: Attributes = p.attributes;
  const phys = p.physiology;
  // Being tired, starving or overheated saps the attributes you can actually bring to bear —
  // the attribute itself (a trait of the body) is unchanged; what's "effective" right now isn't.
  const fatiguePenalty = 1 - phys.fatigue * 0.5;
  const hungerPenalty = 1 - Math.max(0, 0.5 - phys.energy) * 0.9;
  const heatPenalty = phys.bodyHeat > 0.4 ? Math.max(0.25, 1 - (phys.bodyHeat - 0.4) * 1.15) : 1;
  const sleepPenalty = 1 - Math.min(1, phys.sleepDebt / 16) * 0.35;

  const effectiveStrength = clamp(attrs.strength * fatiguePenalty * hungerPenalty, 0.05, 2);
  const effectiveDexterity = clamp(attrs.dexterity * fatiguePenalty * sleepPenalty, 0.05, 2);

  const safeCarryMassKg = BASE_CARRY_KG + effectiveStrength * CARRY_PER_STRENGTH_KG;

  const tool = ctx.action ? ctx.tool ?? null : null;
  const toolMult = ctx.action ? toolWorkMultiplier(ctx.action, tool) : 1;
  const baseWorkRate = 0.35 + effectiveDexterity * 0.45 + effectiveStrength * 0.35;
  const workRate = clamp(baseWorkRate, 0.1, 2.2) * toolMult * heatPenalty;

  const energyCostMultiplier = 1 / clamp(effectiveStrength * 0.6 + 0.4, 0.4, 1.6);
  const fatigueMultiplier = (1 + Math.max(0, phys.bodyHeat - 0.6) * 1.2) / clamp(effectiveStrength * 0.5 + 0.5, 0.5, 1.5);
  // v0.5 §I: read from the species profile (core/species.ts) rather than hardcoded — 1 for
  // ordinary humans; a future ontological tier or heat-adapted species raises this.
  const heatTolerance = physiologyProfileFor(p.species).heatTolerance;

  const heat = heatBand(p);
  const heatExertionPenalty = heat === 'dangerous' ? 0.9 : heat === 'severe' ? 0.55 : heat === 'hot' ? 0.2 : 0;
  const currentExertionCapacity = clamp(
    1 - phys.fatigue * 0.75 - Math.max(0, 0.35 - phys.energy) * 1.3 - Math.max(0, 0.3 - phys.hydration) * 1.1 - heatExertionPenalty,
    0, 1,
  );

  return { effectiveStrength, effectiveDexterity, safeCarryMassKg, workRate, energyCostMultiplier, fatigueMultiplier, heatTolerance, currentExertionCapacity };
}

/** Convenience: resolve the best tool for `action` at the person's current place, then return
 * capability computed with it. Most call sites want this one-shot form. */
export function capabilityFor(world: World, p: Person, action: ToolAction, atPlaceId?: string | null): { cap: PhysicalCapability; tool: Item | null } {
  const tool = bestToolFor(world, p, action, atPlaceId);
  return { cap: getPhysicalCapability(p, world, { action, tool }), tool };
}

/** Deterministic default attributes by age/gender — a mild, continuous gradient (Constitution
 * v0.4 §2: "do not make every attribute a binary requirement"), not a hard young/old cutoff.
 * No RNG: two people with the same age/gender start identical, exactly like `makePerson`'s
 * other defaults; individual variation is left to explicit `PersonSpec.attributes` overrides
 * (as traits/appearance already work). */
export function defaultAttributesFor(age: number, gender: 'm' | 'f'): Attributes {
  const ageFactor = age < 16 ? 0.55 + (age / 16) * 0.35 : age > 55 ? Math.max(0.55, 1 - (age - 55) * 0.012) : 1;
  const genderFactor = gender === 'm' ? 1.06 : 0.94;
  const dexAgeFactor = age < 14 ? 0.8 + (age / 14) * 0.2 : age > 65 ? Math.max(0.6, 1 - (age - 65) * 0.015) : 1;
  return {
    strength: clamp(0.5 * ageFactor * genderFactor, 0.15, 0.95),
    dexterity: clamp(0.5 * dexAgeFactor, 0.15, 0.95),
  };
}
