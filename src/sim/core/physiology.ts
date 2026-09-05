import type { Body, Person } from './types';
import type { World } from './world';
import { physiologyProfileFor, AVERAGE_HUMAN_ADULT } from './species';

/**
 * Embodied physiology (v0.4 §1). Small and extensible, not a medical simulator: five reserves
 * (energy/calories, hydration, fatigue, sleep debt, body heat), one activity-level table that
 * is the SINGLE source of truth for how hard each kind of exertion is, and one step function.
 * Runs on simulation (world) time, never render FPS or wall-clock (Constitution v0.4 §20).
 *
 * `Needs.hunger/.thirst/.energy` (core/types.ts) are DERIVED from this every step — see
 * `syncNeeds` — so existing goal-utility code (mind/agent.ts's `think()`) keeps working
 * unchanged while the numbers underneath now come from a real physiological model instead of
 * being the model themselves (staged migration, Constitution v0.4 preamble).
 */

/** Every activity the simulation's labour actions can report to physiology. One ordered table
 * drives energy cost, fatigue gain, hydration loss and heat generation — no scattered magic
 * numbers in individual action handlers (Constitution v0.4 §6). Ordering matches the milestone
 * spec exactly: sleep < idle < walk < craft < construct < chop < haul < quarry. */
export type ActivityLevel = 'sleep' | 'idle' | 'walk' | 'craft' | 'construct' | 'chop' | 'haul' | 'quarry';

/** Energy (caloric) cost multiplier relative to idle metabolism. Idle itself already costs
 * baseline calories (a body at rest still burns fuel) — sleep costs less than that. */
export const ACTIVITY_ENERGY_MULT: Record<ActivityLevel, number> = {
  sleep: 0.4, idle: 1.0, walk: 1.7, craft: 2.1, construct: 2.7, chop: 3.3, haul: 3.8, quarry: 4.4,
};
/** Fatigue accumulated per hour of the activity (0 for sleep — sleep is what REDUCES fatigue,
 * via `sleepRecover` below, never accumulates it). */
export const ACTIVITY_FATIGUE_PER_HOUR: Record<ActivityLevel, number> = {
  sleep: 0, idle: 0.01, walk: 0.035, craft: 0.055, construct: 0.08, chop: 0.11, haul: 0.13, quarry: 0.15,
};
/** Hydration lost per hour, relative to idle. Heavy/hot exertion sweats you dry faster. */
export const ACTIVITY_HYDRATION_MULT: Record<ActivityLevel, number> = {
  sleep: 0.3, idle: 1.0, walk: 1.3, craft: 1.3, construct: 1.6, chop: 1.9, haul: 2.1, quarry: 2.3,
};
/** Heat generated per hour by the activity itself (exertion heat), before environment. */
export const ACTIVITY_HEAT_PER_HOUR: Record<ActivityLevel, number> = {
  sleep: 0, idle: 0.015, walk: 0.04, craft: 0.05, construct: 0.075, chop: 0.1, haul: 0.115, quarry: 0.13,
};

// ---- baseline (idle) rates: full reserve 1 -> 0 in roughly this many waking hours at idle.
/** Idle-equivalent hours to drain a full caloric reserve. v0.6 §II: raised from 16 to 21 hours —
 * real evidence (seed 918271, headless) showed village-average hunger sitting at 0.71-0.76
 * under the v0.5 calibration, well into the 'urgent' band for a typical villager most of the
 * day rather than the milestone's intended "comfortable/noticeable common, critical unusual"
 * distribution. The root access causes (see `findAccessibleFood`'s household-sharing fix,
 * `restockTavern`) were fixed directly rather than papered over here, but a person whose
 * schedule keeps them working 6-12 real hours between meals still outpaces a 16-hour drain
 * long before those fixes can help — 21 hours keeps an ordinary day's two meals genuinely
 * sufficient (still far short of "never hungry": a skipped meal is still felt) without
 * loosening any tolerance/interruption threshold itself. See docs/
 * V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md §II for the before/after numbers. */
// v0.8 §P0-E: exported so WorldLab can DERIVE the required meals/person/day figure from the
// same constants physiology actually uses (`ENERGY_DRAIN_PER_HOUR` / `FOOD_HUNGER_RESTORE` in
// world/metabolism.ts), instead of a hardcoded number that silently drifts out of sync with a
// future tuning pass.
export const ENERGY_DRAIN_PER_HOUR = 1 / 21;
/** Idle-equivalent hours to fully dehydrate — matches the pre-v0.4 thirst pace (~11 hours). */
const HYDRATION_DRAIN_PER_HOUR = 1 / 11;
/** One meal (`eatFood`) restores this fraction of the caloric reserve. */
export const FOOD_ENERGY_RESTORE = 0.6;
/** One drink restores this fraction of hydration. */
export const WATER_HYDRATION_RESTORE = 0.85;

// ---- fatigue recovery
const REST_FATIGUE_RECOVERY_PER_HOUR = 0.12;   // sitting/idling recovers some fatigue
const SLEEP_FATIGUE_RECOVERY_PER_HOUR = 0.5;   // sleep recovers substantially more
const SLEEP_DEBT_RECOVERY_PER_HOUR = 1.1;      // an hour asleep pays off ~1.1 hours of debt
const AWAKE_SLEEP_DEBT_PER_HOUR = 1;           // every awake hour adds one hour of debt

// ---- heat model (bounded 0..1, Constitution v0.4 §1 "a bounded model is sufficient")
const HEAT_PASSIVE_COOLING_PER_HOUR = 0.11;
const HEAT_REST_COOLING_PER_HOUR = 0.05;       // extra cooling while idle/sleeping
const HEAT_HYDRATION_COOLING_PER_HOUR = 0.07;  // scaled by current hydration (sweat needs water)
/** Environmental heat gain/loss per hour, by weather kind, applied outdoors at midday strength;
 * scaled by daylight (see `stepPhysiology`) and halved indoors. */
const ENVIRONMENTAL_HEAT_PER_HOUR: Record<'clear' | 'cloudy' | 'rain' | 'storm' | 'fog', number> = {
  clear: 0.09, cloudy: 0.02, fog: 0, rain: -0.05, storm: -0.09,
};

export const HEAT_MILD = 0.4;      // reduced work efficiency (getPhysicalCapability)
export const HEAT_HOT = 0.6;       // increased thirst/fatigue (already folded into the rate tables)
export const HEAT_SEVERE = 0.8;    // heavy work becomes unattractive (think()'s goal utility)
export const HEAT_DANGEROUS = 0.92; // forced rest / cooling behaviour

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function defaultPhysiology(now = 0): Person['physiology'] {
  return { energy: 0.8, hydration: 0.8, fatigue: 0.1, sleepDebt: 0, lastSleepAt: now, bodyHeat: 0.2, wetness: 0 };
}

// ---- wetness / environmental exposure (v0.7)
/** How fast wetness rises per hour, fully exposed (outdoors, no shelter), at rain intensity 1 —
 * a person caught in a storm is soaked through in well under an hour; ordinary rain (intensity
 * ~0.5-0.9) takes proportionally longer. */
const WETNESS_RAIN_GAIN_PER_HOUR = 0.9;
/** Drying rate per hour once out of the rain — indoors dries fastest (fire, shelter, a change of
 * clothes); outdoors-but-dry still air-dries, just slower. */
const WETNESS_DRY_INDOOR_PER_HOUR = 0.35;
const WETNESS_DRY_OUTDOOR_PER_HOUR = 0.12;
/** A soaked person burns a little extra energy staying warm — a real, bounded "temperature
 * burden" (Constitution v0.7: exposure is a physiological cost, not a behavioral command), on
 * top of whatever activity-driven fatigue they're already accumulating. Modest: fully soaked
 * (wetness=1) for a full hour adds less fatigue than one hour of `walk`. */
const WETNESS_FATIGUE_PER_HOUR = 0.02;

/**
 * Advance `p.physiology.wetness` by `hours` — the real, accumulating consequence of rain
 * (Constitution v0.7: "rain is not an instruction"). Rises only while genuinely exposed
 * (outdoors, and it is actually raining/storming right now); dries otherwise, indoors always
 * faster than out. Deterministic, bounded 0..1. `syncNeeds` (below) turns this into
 * `needs.comfort`, which is what goal-utility code (mind/agent.ts) actually reads — nothing
 * downstream reacts to `world.weather.kind` directly any more for shelter-seeking.
 */
function stepWetness(world: World, p: Person, hours: number, indoor: boolean): void {
  const phys = p.physiology;
  const wk = world.weather.kind;
  const raining = (wk === 'rain' || wk === 'storm') ? world.weather.intensity : 0;
  if (!indoor && raining > 0) {
    phys.wetness = clamp01(phys.wetness + WETNESS_RAIN_GAIN_PER_HOUR * raining * hours);
  } else {
    const dryRate = indoor ? WETNESS_DRY_INDOOR_PER_HOUR : WETNESS_DRY_OUTDOOR_PER_HOUR;
    phys.wetness = clamp01(phys.wetness - dryRate * hours);
  }
}

/**
 * Advance one person's physiology by `hours` of world time under `activity`. Deterministic —
 * no RNG. `indoor`/`daylight` shape the environmental heat term; both are cheap to compute at
 * the call site (see mind/agent.ts's activity classification).
 */
export function stepPhysiology(world: World, p: Person, hours: number, activity: ActivityLevel, o: { indoor: boolean; daylight: number } = { indoor: false, daylight: 0.7 }): void {
  if (hours <= 0) return;
  stepWetness(world, p, hours, o.indoor);
  const phys = p.physiology;
  const asleep = activity === 'sleep';
  // v0.5 §I: species profile + individual variation scale the human-baseline rates below — see
  // core/species.ts. Both default to the identity (1) for the reference AverageHumanAdult, so
  // this is a pure extension point, not a behavior change, until a second species/individual
  // spread is introduced.
  const profile = physiologyProfileFor(p.species);
  const traits = p.physiologyTraits ?? AVERAGE_HUMAN_ADULT;

  // energy (calories) — larger bodies burn somewhat more baseline fuel for the same activity.
  phys.energy = clamp01(phys.energy - ENERGY_DRAIN_PER_HOUR * ACTIVITY_ENERGY_MULT[activity] * profile.energyDrainMultiplier * traits.bodySizeFactor * hours);

  // hydration — exertion and heat both raise loss
  const heatHydrationFactor = 1 + Math.max(0, phys.bodyHeat - HEAT_MILD) * 1.2;
  phys.hydration = clamp01(phys.hydration - HYDRATION_DRAIN_PER_HOUR * ACTIVITY_HYDRATION_MULT[activity] * heatHydrationFactor * profile.hydrationDrainMultiplier * traits.bodySizeFactor * hours);

  // fatigue — heat makes exertion feel worse (Constitution v0.4 §1 "hot -> increased fatigue");
  // better conditioning (v0.5 §I.2) means the same exertion accumulates fatigue more slowly.
  const heatFatigueFactor = 1 + Math.max(0, phys.bodyHeat - HEAT_HOT) * 1.5;
  const fatigueRateMult = (profile.fatigueMultiplier / traits.conditioning);
  const wetnessFatigue = WETNESS_FATIGUE_PER_HOUR * phys.wetness * hours;
  if (activity === 'idle') phys.fatigue = clamp01(phys.fatigue - REST_FATIGUE_RECOVERY_PER_HOUR * profile.recoveryRateMultiplier * hours + wetnessFatigue);
  else phys.fatigue = clamp01(phys.fatigue + ACTIVITY_FATIGUE_PER_HOUR[activity] * heatFatigueFactor * fatigueRateMult * hours + wetnessFatigue);

  // sleep debt
  const sleepNeedMult = profile.sleepNeedMultiplier * traits.sleepNeedFactor;
  if (asleep) phys.sleepDebt = Math.max(0, phys.sleepDebt - SLEEP_DEBT_RECOVERY_PER_HOUR * profile.recoveryRateMultiplier * hours);
  else phys.sleepDebt = Math.min(16, phys.sleepDebt + AWAKE_SLEEP_DEBT_PER_HOUR * sleepNeedMult * hours);

  // body heat: exertion + environment - passive/rest/hydration-supported cooling
  const envKind = world.weather.kind;
  const envStrength = o.indoor ? 0.4 : 1;
  const environmentalHeat = ENVIRONMENTAL_HEAT_PER_HOUR[envKind] * envStrength * (0.4 + o.daylight * 0.6);
  const restCooling = (activity === 'idle' || asleep) ? HEAT_REST_COOLING_PER_HOUR : 0;
  const hydrationCooling = HEAT_HYDRATION_COOLING_PER_HOUR * phys.hydration;
  const heatDelta = ACTIVITY_HEAT_PER_HOUR[activity] + environmentalHeat - HEAT_PASSIVE_COOLING_PER_HOUR - restCooling - hydrationCooling;
  phys.bodyHeat = clamp01(phys.bodyHeat + heatDelta * hours);

  syncNeeds(p);
}

/** Sleeping: substantially reduces fatigue and pays off sleep debt (Constitution v0.4 §1 "sleep
 * reduces substantially more fatigue than ordinary rest"). Called by the `sleep` action instead
 * of `stepPhysiology`'s ordinary fatigue-gain path, since sleep itself is the recovery. */
export function sleepRecover(p: Person, hours: number): void {
  if (hours <= 0) return;
  const phys = p.physiology;
  const profile = physiologyProfileFor(p.species);
  phys.fatigue = clamp01(phys.fatigue - SLEEP_FATIGUE_RECOVERY_PER_HOUR * profile.recoveryRateMultiplier * hours);
  phys.sleepDebt = Math.max(0, phys.sleepDebt - SLEEP_DEBT_RECOVERY_PER_HOUR * profile.recoveryRateMultiplier * hours);
  syncNeeds(p);
}

/** Ordinary rest (sitting, waiting, idling) — real recovery, just much less than sleep. */
export function restRecover(p: Person, hours: number): void {
  if (hours <= 0) return;
  const profile = physiologyProfileFor(p.species);
  p.physiology.fatigue = clamp01(p.physiology.fatigue - REST_FATIGUE_RECOVERY_PER_HOUR * profile.recoveryRateMultiplier * hours);
  syncNeeds(p);
}

export function eatRestoresEnergy(p: Person, fraction = FOOD_ENERGY_RESTORE): void {
  p.physiology.energy = clamp01(p.physiology.energy + fraction);
  syncNeeds(p);
}
export function drinkRestoresHydration(p: Person, fraction = WATER_HYDRATION_RESTORE): void {
  p.physiology.hydration = clamp01(p.physiology.hydration + fraction);
  syncNeeds(p);
}

/** Recompute the legacy `Needs` fields from the physiology reserves that now ground them
 * (Constitution v0.4 preamble: "existing hunger should become a user-facing expression of
 * underlying energy state"). `needs.energy` (sleep pressure) blends fatigue and sleep debt —
 * a person can be fatigued from one hard day OR sleep-deprived from several short nights, and
 * either alone should push toward sleep. */
export function syncNeeds(p: Person): void {
  const phys = p.physiology;
  p.needs.hunger = clamp01(1 - phys.energy);
  p.needs.thirst = clamp01(1 - phys.hydration);
  p.needs.energy = clamp01(phys.fatigue * 0.55 + Math.min(1, phys.sleepDebt / 9) * 0.55);
  // v0.7: `needs.comfort` (core/types.ts — previously declared but never read or written) is now
  // a real, derived expression of environmental exposure, the same staged-migration pattern
  // hunger/thirst/energy already went through in v0.4 (this doc comment's own preamble).
  p.needs.comfort = phys.wetness;
}

/**
 * The activity level for the physiology-cost step (Simulation.strategic()'s once-per-minute
 * pass) — classified from the person's CURRENT goal, so cost tracks what they are actually
 * doing right now without every action handler needing its own physiology bookkeeping
 * (Constitution v0.4 §6: one centralized cost path). Falls back to body pose (walking/running
 * outside a classified goal, e.g. mid-`goto` for a non-labour goal) and finally 'idle'.
 */
export function activityLevelFor(p: Person, body: Body): ActivityLevel {
  if (body.pose === 'sleep') return 'sleep';
  switch (p.mind.goal?.type) {
    case 'chop': return 'chop';
    case 'gather': return 'quarry';
    case 'haul': return 'haul';
    case 'build': return 'construct';
    case 'work': case 'plant': case 'harvest': return 'craft';
  }
  if (body.pose === 'walk' || body.pose === 'run') return 'walk';
  return 'idle';
}

/** Named severity bands for goal/priority code (Constitution v0.4 §7 "avoid giant nested
 * special-case conditionals" — read these, don't re-derive thresholds inline). */
export function heatBand(p: Person): 'comfortable' | 'mild' | 'hot' | 'severe' | 'dangerous' {
  const h = p.physiology.bodyHeat;
  if (h >= HEAT_DANGEROUS) return 'dangerous';
  if (h >= HEAT_SEVERE) return 'severe';
  if (h >= HEAT_HOT) return 'hot';
  if (h >= HEAT_MILD) return 'mild';
  return 'comfortable';
}

/**
 * Need severity bands (v0.5 §II.4). A human does not respond to every mild sensation of hunger,
 * thirst or tiredness — behavioral pressure should rise through recognizable stages rather than
 * being a single high/low toggle. These are read by goal-utility code (mind/agent.ts) AND by
 * goal-commitment interruption policy (mind/commitment.ts) so both use one shared definition of
 * "how bad is this right now," instead of each re-deriving its own thresholds inline.
 *
 *   comfortable  — little/no behavioral pressure
 *   noticeable   — the agent recognizes the need; ordinary goals continue unaffected
 *   uncomfortable — increasingly influences goal selection
 *   urgent       — strongly prefers solving the need, but can still finish short/high-priority work
 *   critical     — physiology overrides ordinary voluntary goals
 */
export type Severity = 'comfortable' | 'noticeable' | 'uncomfortable' | 'urgent' | 'critical';
const SEVERITY_ORDER: Severity[] = ['comfortable', 'noticeable', 'uncomfortable', 'urgent', 'critical'];
export function severityAtLeast(a: Severity, b: Severity): boolean { return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b); }
function bandFor(value: number, thresholds: [number, number, number, number]): Severity {
  const [noticeable, uncomfortable, urgent, critical] = thresholds;
  if (value >= critical) return 'critical';
  if (value >= urgent) return 'urgent';
  if (value >= uncomfortable) return 'uncomfortable';
  if (value >= noticeable) return 'noticeable';
  return 'comfortable';
}
/** `needs.hunger` (0..1, derived from caloric energy — see `syncNeeds`). A missed meal should
 * read as merely noticeable/uncomfortable, not a crisis — see `FOOD_ENERGY_RESTORE`/
 * `ENERGY_DRAIN_PER_HOUR` for how this rises over real hours of activity. */
export function hungerBand(p: Person): Severity { return bandFor(p.needs.hunger, [0.25, 0.45, 0.65, 0.85]); }
/** `needs.thirst` (0..1, derived from hydration). Thresholds sit slightly lower than hunger's —
 * v0.5 §II.5: "hydration should generally become physiologically urgent faster than calorie
 * depletion," matching `HYDRATION_DRAIN_PER_HOUR` (11h) draining faster than energy's (16h). */
export function thirstBand(p: Person): Severity { return bandFor(p.needs.thirst, [0.2, 0.4, 0.6, 0.8]); }
/** `needs.energy` (0..1, sleep pressure — a blend of fatigue and sleep debt). */
export function sleepBand(p: Person): Severity { return bandFor(p.needs.energy, [0.3, 0.5, 0.7, 0.85]); }
/** `needs.comfort` (0..1, derived from wetness — v0.7 §Environmental exposure). Damp clothes are
 * merely noticeable; genuinely soaked-through is what should compete meaningfully with an
 * uncommitted goal for attention (mind/agent.ts's shelter-seeking utility reads this instead of
 * raw `world.weather.kind`). */
export function comfortBand(p: Person): Severity { return bandFor(p.needs.comfort, [0.25, 0.45, 0.7, 0.9]); }
