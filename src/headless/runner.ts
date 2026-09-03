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
  /** Physical-time substep in seconds. Smaller is more precise but slower; 0.15s is coarser
   * than the browser/test default (0.05s) because headless runs value throughput over
   * frame-smooth motion, and nothing here depends on sub-perception-interval precision
   * (perception itself samples at ~5Hz / 0.2s regardless of substep size). */
  stepSeconds?: number;
  /** How often (world seconds) to run the periodic maintenance pass: CLOD rebalancing,
   * institutional-knowledge sync, leadership-vacancy checks. Default 1 simulated hour. */
  maintenanceIntervalSeconds?: number;
  onProgress?: (worldDaysElapsed: number) => void;
}

export interface HeadlessRunResult {
  world: World;
  sim: Simulation;
  telemetry: MemorySink;
  anomalies: Anomaly[];
  significance: SignificantEntity[];
  chronicle: ChronicleEntry[];
  summary: WorldRunSummary;
}

export function runHeadless(opts: HeadlessRunOptions): HeadlessRunResult {
  const world = new World(opts.seed);
  generateVillage(world);
  const sim = new Simulation(world);

  const memSink = new MemorySink();
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
      const significance = computeHistoricalSignificance(world);
      rebalanceCognitiveLOD(world, significance);
      syncFactionInstitutionalKnowledge(world);
      checkLeadershipVacancies(world, significance);
    }
    const day = Math.floor((world.now - worldStart) / SECONDS_PER_DAY);
    if (opts.onProgress && day !== lastReportedDay) { lastReportedDay = day; opts.onProgress(day); }
  }

  const anomalies = detectAnomalies(world);
  const significance = topSignificantEntities(world, 15);
  const chronicle = buildChronicle(world);
  const summary = buildWorldRunSummary(world, { seed: opts.seed, requestedDays: opts.days, worldStart, startingPopulation, anomalies, significance });
  recorder.runEnd({ seed: opts.seed, simulatedWorldSeconds: summary.simulatedWorldSeconds, deaths: summary.deaths.total, anomalies: anomalies.length });

  return { world, sim, telemetry: memSink, anomalies, significance, chronicle, summary };
}
