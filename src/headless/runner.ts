import { World } from '../sim/core/world';
import { generateVillage } from '../sim/world/village';
import { Simulation } from '../sim/mind/agent';
import { SECONDS_PER_DAY } from '../sim/core/time';
import { TelemetryRecorder, MemorySink } from '../sim/telemetry/recorder';
import type { TelemetrySink } from '../sim/telemetry/types';
import { detectAnomalies, type Anomaly } from '../sim/telemetry/anomaly';
import { computeHistoricalSignificance, topSignificantEntities, type SignificantEntity } from '../sim/history/significance';
import { buildChronicle, type ChronicleEntry } from '../sim/history/chronicle';
import { buildWorldRunSummary, type WorldRunSummary } from '../sim/history/summary';
import { rebalanceCognitiveLOD } from '../sim/core/cognition';
import { syncFactionInstitutionalKnowledge, checkLeadershipVacancies } from '../sim/history/factions';

/**
 * The first-class headless world runner (v0.2 Part 1). Runs the exact same canonical World /
 * Simulation / village generation the browser client uses — there is no second simulation
 * implementation. No Three.js, no DOM, no requestAnimationFrame, no player input: time
 * advances through the same `Simulation.step(physDt, worldDt)` the browser drives every
 * frame, just called in a tight loop instead of from a render callback.
 */
export interface HeadlessRunOptions {
  seed: number;
  /** Requested simulated duration, in world days. */
  days: number;
  /** Additional telemetry sinks (e.g. a FileSink for JSONL output). A MemorySink is always
   * included so the run can produce its summary/anomaly report even with no sinks passed. */
  sinks?: TelemetrySink[];
  /** v0.8 §P0-I: the internal `MemorySink`'s ring-buffer capacity (default 20000, its own
   * default). WorldLab's multi-day scenarios raise this so the rate/clustering-window anomaly
   * checks (up to 24h — see `sim/telemetry/anomaly.ts`) reliably still have that much telemetry
   * on hand at probe time, not just whatever recent slice fits under the browser-session-sized
   * default. */
  telemetryCap?: number;
  /** Physical-time substep in seconds. Smaller is more precise but slower; 0.15s is coarser
   * than the browser/test default (0.05s) because headless runs value throughput over
   * frame-smooth motion, and nothing here depends on sub-perception-interval precision
   * (perception itself samples at ~5Hz / 0.2s regardless of substep size). */
  stepSeconds?: number;
  /** How often (world seconds) to run the periodic maintenance pass: CLOD rebalancing,
   * institutional-knowledge sync, leadership-vacancy checks. Default 1 simulated hour. */
  maintenanceIntervalSeconds?: number;
  onProgress?: (worldDaysElapsed: number) => void;
  /**
   * WorldLab (v0.8 §2-3) hook: called read-only at `probeIntervalSeconds` (world-time) so a
   * caller can observe how the world evolves over time, not just its final state. Called with
   * the exact same live `world`/`sim` this run is using — nothing here duplicates simulation
   * state. Callers must not mutate `world`/`sim` from inside this callback; WorldLab enforces
   * that contract by only ever reading from it (see worldlab/probe.ts). `telemetry` is the SAME
   * `MemorySink` this run already keeps for its own end-of-run summary (v0.8 §P0-I) — a much
   * longer, un-compacted record of what happened than `world.events` at that instant (see
   * `sim/telemetry/anomaly.ts`'s `telemetryToEvents`), so a probe wanting a richer anomaly-
   * detection source doesn't need a second recorder/sink of its own.
   */
  onProbe?: (world: World, sim: Simulation, worldSecondsElapsed: number, telemetry: MemorySink) => void;
  /** World-time seconds between `onProbe` calls. Default 1 simulated hour, matching the existing
   * maintenance cadence. Ignored if `onProbe` is not set. */
  probeIntervalSeconds?: number;
  /**
   * WorldLab scenario setup (v0.8 §7): called once, right after village generation, before any
   * simulated time passes. Exists so a scenario can establish a precondition (e.g. give the
   * player a controlled body, seed a specific desire) through the same `World`/`Simulation` APIs
   * anything else uses — never scripting the outcome being validated, only its precondition.
   */
  onSetup?: (world: World, sim: Simulation) => void;
}

export interface HeadlessRunResult {
  world: World;
  sim: Simulation;
  telemetry: MemorySink;
  anomalies: Anomaly[];
  significance: SignificantEntity[];
  chronicle: ChronicleEntry[];
  summary: WorldRunSummary;
  /** Coarse wall-clock breakdown in milliseconds (v0.2.1 Priority 3), for comparing where time
   * actually goes between runs/versions at identical seed+duration. `sim.*` buckets come from
   * Simulation.step()'s own per-subsystem accumulator (see mind/agent.ts); `villageGen`,
   * `maintenance` (CLOD/faction/leadership upkeep), and the post-run `anomalies`/
   * `significance`/`chronicle`/`summary` buckets are measured here around their existing calls.
   * Purely observational — never read back into the simulation itself. */
  timing: Record<string, number>;
}

export function runHeadless(opts: HeadlessRunOptions): HeadlessRunResult {
  const timing: Record<string, number> = {};
  const mark = () => performance.now();
  const accum = (bucket: string, t0: number) => { timing[bucket] = (timing[bucket] ?? 0) + (performance.now() - t0); };

  let t0 = mark();
  const world = new World(opts.seed);
  generateVillage(world);
  accum('villageGen', t0);
  const sim = new Simulation(world);
  sim.profile = {};
  opts.onSetup?.(world, sim);

  const memSink = new MemorySink(opts.telemetryCap ?? 20000);
  const recorder = new TelemetryRecorder(world, [memSink, ...(opts.sinks ?? [])]);
  recorder.runStart({ seed: opts.seed, requestedDays: opts.days, mode: 'headless' });

  const startingPopulation = world.persons().filter(p => p.alive).length;
  const substep = opts.stepSeconds ?? 0.15;
  const maintenanceInterval = opts.maintenanceIntervalSeconds ?? 3600;
  // `days` is WORLD days (calendar days — what a player or historian would mean by "day"),
  // not physical/real seconds. World time runs at `world.clock.timeScale` times physical
  // time (60x by default, see core/time.ts), so the loop bound and progress reporting below
  // are both driven off `world.now` advancing, never off physical `elapsed`. An earlier
  // version of this loop compared physical elapsed against a world-day target directly,
  // which silently asked for `timeScale`x more simulated content than requested (a `--days
  // 30` run was actually simulating ~1800 world-days) — that bug, combined with the
  // event-compaction bug fixed alongside it in core/world.ts, is why headless runs longer
  // than a few seconds of wall-clock previously never finished. See docs/V0_2_WORLD_ENGINE.md.
  const worldStart = world.now;
  const totalWorldSeconds = opts.days * SECONDS_PER_DAY;

  let sinceMaintenance = 0;
  let sinceProbe = 0;
  const probeInterval = opts.probeIntervalSeconds ?? 3600;
  if (opts.onProbe) opts.onProbe(world, sim, 0, memSink); // t=0 baseline, before any simulated time passes
  let lastReportedDay = -1;
  while (world.now - worldStart < totalWorldSeconds) {
    // Clamp the final physical substep so we land close to the requested world-time target
    // instead of overshooting by up to one full (substep * timeScale) world-seconds.
    const remainingWorld = totalWorldSeconds - (world.now - worldStart);
    const dt = remainingWorld < substep * world.clock.timeScale ? Math.max(remainingWorld / world.clock.timeScale, 0.001) : substep;
    const worldDt = world.clock.advance(dt);
    world.physicalTime += dt;
    sim.step(dt, worldDt);
    sim.flushSpeech();
    sinceMaintenance += worldDt;
    if (sinceMaintenance >= maintenanceInterval) {
      sinceMaintenance = 0;
      const tm = mark();
      const significance = computeHistoricalSignificance(world);
      rebalanceCognitiveLOD(world, significance);
      syncFactionInstitutionalKnowledge(world);
      checkLeadershipVacancies(world, significance);
      accum('maintenance', tm);
    }
    const day = Math.floor((world.now - worldStart) / SECONDS_PER_DAY);
    if (opts.onProgress && day !== lastReportedDay) { lastReportedDay = day; opts.onProgress(day); }
    if (opts.onProbe) { sinceProbe += worldDt; if (sinceProbe >= probeInterval) { sinceProbe = 0; opts.onProbe(world, sim, world.now - worldStart, memSink); } }
  }
  if (opts.onProbe) opts.onProbe(world, sim, world.now - worldStart, memSink); // final observation

  t0 = mark(); const anomalies = detectAnomalies(world); accum('anomalies', t0);
  t0 = mark(); const significance = topSignificantEntities(world, 15); accum('significance', t0);
  t0 = mark(); const chronicle = buildChronicle(world); accum('chronicle', t0);
  const summary = buildWorldRunSummary(world, { seed: opts.seed, requestedDays: opts.days, worldStart, startingPopulation, anomalies, significance });
  recorder.runEnd({ seed: opts.seed, simulatedWorldSeconds: summary.simulatedWorldSeconds, deaths: summary.deaths.total, anomalies: anomalies.length });

  for (const [bucket, ms] of Object.entries(sim.profile ?? {})) timing[`sim.${bucket}`] = ms;
  return { world, sim, telemetry: memSink, anomalies, significance, chronicle, summary, timing };
}
