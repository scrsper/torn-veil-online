import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
import type { EntityId } from '../../sim/core/types';
import type { WorldRunSummary } from '../../sim/history/summary';
import type { Anomaly } from '../../sim/telemetry/anomaly';

/**
 * WorldLab (v0.8 §2): a read-only validation harness built on top of the exact canonical
 * World/Simulation/village generation the headless runner and the browser client both use.
 * Nothing in this module tree may mutate `World`/`Simulation` state — every function here
 * either reads state to produce an `Observation`, or reduces a series of `Observation`s (plus
 * the raw `World`) into findings. See docs/WORLDLAB.md for the full design rationale.
 */

/** One read-only snapshot of the world at a point in simulated time. Reuses
 * `buildWorldRunSummary`'s existing aggregation (itself already derived from canonical
 * `world.events`/`world.runTally`/`world.persons()`) rather than re-deriving the same figures a
 * second way — the `summary` field's counts are CUMULATIVE since the run's `worldStart`, exactly
 * like a normal end-of-run summary; `totalCurrency` is the one figure WorldLab computes directly
 * from live state (summary.ts doesn't need it, WorldLab's currency-conservation invariant does).
 */
/**
 * v0.8 §P0-A decomposition (independent audit §4.1): a single `totalCurrency` cannot
 * distinguish "money the village can still spend" from "money that exists but nothing can use" —
 * that conflation is exactly what let a robbery mechanic drain 30-50% of real purchasing power
 * while `wealth + coins` conservation reported a perfect residual. Every field below is a
 * separately meaningful measurement; nothing here collapses back into one opaque number.
 */
export interface EconomySnapshot {
  /** Sum of `Person.wealth` across alive, non-controlled persons — what NPC purchase paths
   * (`buyFoodPortion`/`payWage`/`payRecoveryReward`/`settleWholesale`) can actually spend. */
  spendableWealth: number;
  /** Sum of `coins`-type Item quantities anywhere in the world (held or placed) — a physical
   * prop only the player's own dialogue/inventory UI can spend. */
  coinItems: number;
  /** `spendableWealth + coinItems` — the quantity the old currency-conservation check tracked.
   * Kept for backward comparison, never used alone to judge economic health. */
  totalCurrency: number;
  gini: number;
  medianWealth: number;
  /** % of `spendableWealth` held by the poorest quarter of the (alive, non-controlled)
   * population. */
  poorestQuartileShare: number;
  /** % of `spendableWealth` held by the single wealthiest person. */
  richestShare: number;
  /** Count of alive, non-controlled persons whose wealth is below the price of the cheapest
   * food item currently for sale anywhere in the village (0 if nothing is for sale — everyone
   * "cannot afford" a market that doesn't exist, which is itself worth surfacing). */
  cannotAffordAnyMeal: number;
  /** Cumulative external outflow this run (`restockTavern`'s explicit, tracked supply cost —
   * see `world/metabolism.ts`). A LEGITIMATE, disclosed external-economy cost (ale is bought
   * from an unmodeled outside supplier), not a bug — but still a real drain with no offsetting
   * income source, which is exactly what `liveness.money-supply-solvency` exists to flag. */
  externalSinkAmount: number;
  wagesPaidAmount: number;
  purchasesAmount: number;
  wholesaleAmount: number;
  rewardsPaidAmount: number;
}

/** v0.8 §P0-C: a cheap (no event scanning — just the existing `hungerBand`/`thirstBand`/
 * `sleepBand` functions over live `Person.needs`) per-person severity snapshot taken at every
 * probe, so `tail.ts`'s deprivation-streak checks can find the true worst individual instead of
 * a village-wide "did anyone eat" cumulative counter. Keyed by person id; absent for anyone not
 * alive/non-controlled at that probe (a dead person cannot be "deprived"). */
export type SeveritySnapshot = 'comfortable' | 'noticeable' | 'uncomfortable' | 'urgent' | 'critical';
export interface PersonBands { hunger: SeveritySnapshot; thirst: SeveritySnapshot; sleep: SeveritySnapshot; }

/**
 * v0.8 §P0-H (independent audit §4.6): the old recovery-liveness check only ever asked "is the
 * item already in the requester's hands" — a single endpoint test that cannot distinguish "the
 * request was never even discoverable" from "someone knows exactly where it is but nobody has
 * gone to get it" from "it's on its way back right now." These are the real causal stages the
 * canonical recovery chain (`mind/agent.ts`'s item-location `perceive()` → `pickGossip`/`tell` →
 * `maybeAskForHelp` → `isAuthorizedRecovery` → `takeItem`/`giveItem`) actually passes through, in
 * order — a state machine, not a boolean. `info-discoverable`/`item-locatable` are split because
 * SOMEONE knowing where an item is (a bystander who saw it) is a different, earlier fact than the
 * REQUESTER themselves knowing (the fact their own goal-formation, agent.ts line ~415, needs).
 */
export type RecoveryPhase = 'requested' | 'info-discoverable' | 'item-locatable' | 'recovery-authorized' | 'item-recovered' | 'returned';
export interface RecoveryProgress { personId: EntityId; itemId: EntityId; phase: RecoveryPhase; }

export interface Observation {
  /** World-seconds elapsed since this run's `worldStart` (0 at the initial baseline probe). */
  atWorldSeconds: number;
  atWorldDays: number;
  /** sum(person.wealth) + sum(coin item quantities) at this instant — see
   * `invariants.ts`'s `currencyConservation`. Equal to `economy.totalCurrency`; kept as its own
   * top-level field since the pre-existing currency-conservation invariant reads it. */
  totalCurrency: number;
  economy: EconomySnapshot;
  personBands: Record<EntityId, PersonBands>;
  /** v0.8 §P1-C fix: the oldest currently-open (claimed/in_transit) haul task's age, in hours,
   * AT THIS PROBE — cheap to compute from live state and, read across the whole series (`some(o
   * => o.maxOpenHaulTaskAgeHours > bound)`), catches a stall that happened mid-run and resolved
   * before the run ended. `HaulTask`s are pruned ~90 minutes after resolution (`haul.ts`'s
   * `RESOLVED_KEEP_SECONDS`), so an end-of-run-only scan (the pre-v0.8 check) cannot see a stall
   * that already resolved — this can, without needing to track any specific task's identity
   * across probes. */
  maxOpenHaulTaskAgeHours: number;
  /** Same idea for conflicts (`world.conflicts` is append-only and never pruned, but a stall
   * followed by resolution before the run's final probe was still invisible to an end-of-run-
   * only scan of `status === 'active'`). */
  maxActiveConflictAgeHours: number;
  /** v0.8 §P0-H: one entry per currently-tracked (person, item) `recover_item` desire, at this
   * probe's phase — see `RecoveryPhase`. Empty in scenarios with no such desires (cheap: O(alive
   * persons x their own desires), not a world-wide scan). */
  recoveryProgress: RecoveryProgress[];
  alivePopulation: number;
  summary: WorldRunSummary;
  anomalies: Anomaly[];
}

export type Verdict = 'PASS' | 'DEGRADED' | 'FAIL';

/** A concrete piece of evidence attached to a finding — enough for a developer to know where to
 * look next without dumping the entire event log (§6: "the trace should answer: what should the
 * developer investigate next?"). */
export interface TraceStep {
  atWorldDays: number;
  label: string;
}

export interface Trace {
  id: string;
  title: string;
  subjectName: string;
  steps: TraceStep[];
}

/**
 * v0.8 §21 "WorldLab acceptance redesign": four conceptually distinct classes of health check —
 * `integrity` (things that must never be false), `individual` (a minority permanently stranded,
 * invisible in a village-wide average), `throughput` (a system that technically runs but cannot
 * meet recurring demand), `trend` (heading predictably toward exhaustion/collapse even though
 * nothing is wrong RIGHT NOW). Orthogonal to `kind` below, which is about evaluation mechanics
 * (per-probe vs. end-of-series), not meaning. Optional only because the pre-v0.8 checks in
 * `invariants.ts`/`liveness.ts` predate this taxonomy; every check added for v0.8 sets it.
 */
export type FindingClass = 'integrity' | 'individual' | 'throughput' | 'trend';

/** Shared shape for both invariant and liveness findings (§4 keeps the concepts distinct in
 * meaning, not in how they're reported). `kind` is what actually distinguishes them: an invariant
 * violation is failure the instant it's observed; a liveness finding additionally distinguishes
 * NOT YET (still within its bound, not reported) from STUCK (bound exceeded — reported). */
export interface Finding {
  id: string;
  kind: 'invariant' | 'liveness';
  class?: FindingClass;
  severity: 'warning' | 'failure';
  category: string;
  message: string;
  trace?: Trace;
}

/** An invariant should always hold. Checked at every probe (and given the previous probe for
 * anything that needs a delta, e.g. currency conservation) plus once more at run end. Returning
 * an empty array means "held here" — invariants are innocent until a concrete violation is
 * observed, never scored by absence of evidence. */
export interface InvariantCheck {
  id: string;
  category: string;
  description: string;
  check: (world: World, prev: Observation | null, curr: Observation) => Finding[];
}

/** A liveness condition says progress must eventually occur while its precondition holds. It is
 * evaluated once, at run end, over the FULL observation series plus the live world — not per
 * probe — because "eventually" is a statement about a bounded window, not an instant. */
export interface LivenessCheck {
  id: string;
  category: string;
  description: string;
  /** Upper bound (world-hours) the precondition may hold without the postcondition occurring
   * before this is reported STUCK rather than NOT YET. Purely documentation on the object; each
   * check enforces its own bound internally against real state, since what "progress" means
   * differs per check (a delivered haul task vs. a harvested field vs. a paid reward). */
  boundHours: number;
  check: (world: World, series: Observation[]) => Finding[];
}

export interface ScenarioSetupResult { seed: number; }

export interface ScenarioSpec {
  id: string;
  title: string;
  /** Default seed(s) this scenario is validated against when none are passed on the CLI. */
  seeds: number[];
  days: number;
  probeIntervalSeconds: number;
  invariants: InvariantCheck[];
  liveness: LivenessCheck[];
  /** Optional scripted setup applied once after village generation, before simulation begins —
   * e.g. `player-parity` and `recover-item` need a controlled actor and/or a specific desire
   * present to exercise a path that wouldn't reliably arise on its own within a short run. Never
   * scripts the OUTCOME being tested, only the precondition (Constitution §66: prefer generic
   * systems; §7 "avoid scripting the desired outcome into existence" per this milestone's own
   * brief). Runs through the same `Simulation`/`World` APIs anything else would use. */
  setup?: (world: World, sim: Simulation) => void;
}

export interface ScenarioSeedResult {
  scenarioId: string;
  seed: number;
  verdict: Verdict;
  findings: Finding[];
  observations: Observation[];
  wallClockMs: number;
}

export interface ScenarioResult {
  scenarioId: string;
  title: string;
  seedResults: ScenarioSeedResult[];
  verdict: Verdict;
}

export type Tier = 'smoke' | 'check' | 'soak';
