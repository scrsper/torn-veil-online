import type { World } from '../../sim/core/world';
import type { Simulation } from '../../sim/mind/agent';
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
export interface Observation {
  /** World-seconds elapsed since this run's `worldStart` (0 at the initial baseline probe). */
  atWorldSeconds: number;
  atWorldDays: number;
  /** sum(person.wealth) + sum(coin item quantities) at this instant — see
   * `invariants.ts`'s `currencyConservation`. */
  totalCurrency: number;
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

/** Shared shape for both invariant and liveness findings (§4 keeps the concepts distinct in
 * meaning, not in how they're reported). `kind` is what actually distinguishes them: an invariant
 * violation is failure the instant it's observed; a liveness finding additionally distinguishes
 * NOT YET (still within its bound, not reported) from STUCK (bound exceeded — reported). */
export interface Finding {
  id: string;
  kind: 'invariant' | 'liveness';
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
