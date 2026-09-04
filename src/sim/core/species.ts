/**
 * The species/physiology-profile layer (v0.5 §I). Ordinary NPCs are, until another species is
 * explicitly introduced, biologically HUMAN — but the biological constants that decide "how
 * fast does this body burn calories / need water / need sleep" must come from a profile layer,
 * not be baked directly into every metabolic formula (core/physiology.ts), so a future elf,
 * orc-like species, alien, construct, undead, or ontologically-advanced human is a new profile
 * object here, not a rewrite of the physiology model itself:
 *
 *   SpeciesPhysiologyProfile → individual characteristics → current physiological state
 *     → environment → activity → effective physiology
 *
 * v0.5 implements ONLY the human profile. Nothing below assumes every person is identical
 * (see `IndividualPhysiologyTraits`), and nothing assumes a future being uses human biology —
 * a second profile is additive, never a special case threaded through agent logic.
 */

export interface SpeciesPhysiologyProfile {
  id: string;
  /** Multiplier on the species' baseline caloric (energy) drain rate. 1 = the human baseline
   * calibrated in core/physiology.ts's `ENERGY_DRAIN_PER_HOUR`. */
  energyDrainMultiplier: number;
  /** Multiplier on the species' baseline hydration drain rate. */
  hydrationDrainMultiplier: number;
  /** Multiplier on how quickly fatigue accumulates from exertion. */
  fatigueMultiplier: number;
  /** Multiplier on how quickly sleep debt accrues while awake (and, inversely, how much of it
   * a given need-satisfaction restores). 1 = an ordinary human sleep cycle. */
  sleepNeedMultiplier: number;
  /** 0..1 — how well this species resists heat's work penalty. 1 = an ordinary human; a future
   * high-tier body (or a species evolved for a hot climate) would push this toward 1's ceiling
   * from below, never past it without a dedicated rule change. */
  heatTolerance: number;
  /** Multiplier on sleep/rest recovery rates (how much one hour of rest/sleep actually restores). */
  recoveryRateMultiplier: number;
}

/** The only profile implemented in v0.5. Every multiplier is 1 — the numbers this modifies
 * (ENERGY_DRAIN_PER_HOUR, HYDRATION_DRAIN_PER_HOUR, the ACTIVITY_* tables, sleep/rest recovery
 * rates — all in core/physiology.ts) are already calibrated AS the human baseline, so a human
 * profile is definitionally the identity multiplier on top of them. Future profiles vary these:
 * an alien that drinks less might use `hydrationDrainMultiplier: 0.5`; a species needing far
 * more sleep `sleepNeedMultiplier: 1.6`; a construct needing no calories at all is a different,
 * not-yet-built shape entirely (a maintenance need, not a caloric one) — explicitly out of scope
 * for v0.5 (see the milestone's "future species" section) but not precluded by this shape. */
export const HUMAN_PHYSIOLOGY_PROFILE: SpeciesPhysiologyProfile = {
  id: 'human',
  energyDrainMultiplier: 1,
  hydrationDrainMultiplier: 1,
  fatigueMultiplier: 1,
  sleepNeedMultiplier: 1,
  heatTolerance: 1,
  recoveryRateMultiplier: 1,
};

const SPECIES_PROFILES: Record<string, SpeciesPhysiologyProfile> = {
  human: HUMAN_PHYSIOLOGY_PROFILE,
};

/** Resolve a person's species profile by id, falling back to human for any unrecognized/absent
 * id (defensive default — every Person created by `makePerson` sets `species: 'human'`
 * explicitly, but old/foreign save data should never crash physiology). */
export function physiologyProfileFor(speciesId: string | undefined): SpeciesPhysiologyProfile {
  return SPECIES_PROFILES[speciesId ?? 'human'] ?? HUMAN_PHYSIOLOGY_PROFILE;
}

/**
 * v0.5 §I.2: individual variation layered ON TOP of the species profile — body size, age,
 * conditioning. Deterministic (no RNG), derived once at creation from the same inputs
 * `defaultAttributesFor` (core/attributes.ts) already uses for strength/dexterity, so "a bigger,
 * stronger, better-conditioned person eats somewhat more and tires somewhat more slowly" falls
 * out of the SAME body rather than a second, unrelated dice roll. Bounded so ordinary humans
 * cluster in a recognizable range (Constitution v0.5 §I.2: "avoid huge RPG-style modifiers").
 */
export interface IndividualPhysiologyTraits {
  /** >1 = a larger body burning somewhat more baseline energy/hydration; <1 = a smaller one. */
  bodySizeFactor: number;
  /** >1 = better-conditioned — fatigue accumulates more slowly for the same exertion. */
  conditioning: number;
  /** Individual sleep-need variation around the species average (1 = average). */
  sleepNeedFactor: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** `build`/`height` come from `Appearance` (0.85..1.15 / 0.85..1.1 — already-established body-
 * size scales, see core/types.ts's `Appearance`); `strength` from `Attributes`. Centered so an
 * average-build, average-height, average-strength (0.5) adult yields every factor at exactly
 * 1.0 — i.e. numerically identical to the pre-v0.5 flat constants for the "reference person"
 * (Constitution v0.5 §I.3), with only real individual variation moving anyone away from that. */
export function defaultPhysiologyTraitsFor(age: number, build: number, height: number, strength: number): IndividualPhysiologyTraits {
  const bodySizeFactor = clamp(1 + (build - 1) * 0.4 + (height - 1) * 0.25, 0.85, 1.2);
  const ageConditioning = age < 18 ? 0.9 + (age / 18) * 0.1 : age > 55 ? Math.max(0.75, 1 - (age - 55) * 0.01) : 1;
  const conditioning = clamp(ageConditioning * (0.85 + strength * 0.3), 0.7, 1.25);
  const sleepNeedFactor = clamp(1 + (0.5 - strength) * 0.15, 0.85, 1.15);
  return { bodySizeFactor, conditioning, sleepNeedFactor };
}

/**
 * v0.5 §I.3: a stable, documented reference person for calibration and tests — "AverageHumanAdult".
 * Every individual-variation factor sits at exactly 1.0 (the species-average point), so tuning a
 * formula against this constant means tuning it against the human baseline itself, independent
 * of any one test person's particular age/build/strength roll. The exact fictional identity
 * (age/build/strength) is deliberately unspecified — what matters is the stable reference point,
 * not a backstory — but for concreteness it corresponds to an adult of average build (1.0),
 * average height (1.0), unremarkable age (mid-30s, past growth, well short of age-related
 * decline) and average strength (0.5): a person for whom every v0.5 tolerance/timing claim in
 * docs/V0_5_HUMAN_PHYSIOLOGY_AUTONOMOUS_ECONOMY.md is calibrated to hold exactly.
 */
export const AVERAGE_HUMAN_ADULT: IndividualPhysiologyTraits = { bodySizeFactor: 1, conditioning: 1, sleepNeedFactor: 1 };
