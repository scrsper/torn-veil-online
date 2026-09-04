import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '../sim/core/world';
import type { HeadlessRunResult } from './runner';

/**
 * v0.2.1 Priority 10: a compact, machine-comparable artifact for one headless benchmark run.
 * Deliberately NOT the full summary/telemetry/chronicle (those already exist per-run, see
 * summary.json/chronicle.txt/telemetry.jsonl in the run's own output directory) — this is the
 * small, stable-shaped record meant to be diffed programmatically across commits/runs: "did
 * this change make things faster, slower, or different" without re-parsing megabytes of
 * per-run output. Every field here is derived, never invented — an unavailable field (e.g. no
 * git commit in this environment) is reported as `null`, not guessed.
 */
export interface BenchmarkReport {
  /** Git commit this run was built from, or null if unavailable (e.g. no git in the
   * environment, or the working tree isn't a repo). Never fabricated. */
  commit: string | null;
  /** package.json's `version` field at the time of the run. */
  appVersion: string;
  seed: number;
  requestedDays: number;
  simulatedWorldDays: number;
  runtimeMs: number;
  canonicalEventCount: number;
  chronicleEntryCount: number;
  /** Anomaly findings grouped by type (each finding is itself already a group of occurrences —
   * see telemetry/anomaly.ts's Priority 5 rework — so this is "how many distinct kinds of
   * finding, and how many findings of each kind," not a raw occurrence count). */
  anomalyGroups: { type: string; count: number }[];
  population: { start: number; end: number };
  deaths: number;
  conflicts: number;
  robberies: number;
  /** Faction leadership successions this run. Faction MEMBERSHIP changes are always 0 — no
   * v0.2/v0.2.1 mechanic moves a person between factions at runtime (see history/summary.ts's
   * `factionMembershipChanges` field) — reported explicitly rather than omitted, so a reader
   * can see the gap rather than assume it was forgotten. */
  factionChanges: { leadership: number; membership: number };
  knowledgeTransfers: number;
  pathfindingFailures: number;
  topSignificantEntities: { id: string; name: string; score: number }[];
  /** v0.4 Embodied Economy: the compact economy signal for cross-run diffing — see
   * history/summary.ts's `embodied` for the full breakdown this is drawn from. */
  economy: {
    requestsCompleted: number; requestsFailed: number;
    wagesPaid: number; purchasesSpent: number;
    avgFatigue: number; avgSleepDebt: number;
    workStopped: { fatigue: number; thirst: number; heat: number; sleep: number };
    treesFelled: number; treesMature: number; stoneRemaining: number;
  };
  /** v0.5 Human Physiology / Autonomous Economy: goal-commitment lifecycle, autonomous bakery
   * production, and a point-in-time bread price snapshot — see history/summary.ts. */
  humanPhysiology: {
    commitments: { committed: number; suspended: number; resumed: number; abandoned: number };
    production: { open: number; accepted: number; completed: number; failed: number; wagesPaid: number };
    breadPriceAtBakery: number | null;
    breadPriceAtStall: number | null;
  };
  /** Coarse per-subsystem wall-clock breakdown (ms) — see Simulation.profile / runner.ts's
   * `timing`. Purely diagnostic, never fed back into simulation. */
  timing: Record<string, number>;
  /** A deterministic fingerprint of canonical end-of-run world state (see
   * `canonicalStateHash`) — two runs with the same seed, duration, and code must produce the
   * same hash; a changed hash on an otherwise-identical run is a determinism regression. */
  stateHash: string;
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A cheap, deterministic fingerprint of canonical world state — built only from fields that
 * are part of the canonical simulation (person alive/wealth/faction/knowledge-count, primary
 * body position/health, total event count, and the final event's id/type). Deliberately never
 * touches telemetry, anomaly reports, or profiling data (Constitution: those are observational
 * and must never be conflated with canonical state). Two headless runs at the same seed and
 * duration, on the same code, must produce an identical hash; any difference is a genuine
 * nondeterminism regression worth investigating, not a hash-collision false alarm — this is a
 * detection tripwire, not a cryptographic guarantee.
 */
export function canonicalStateHash(world: World): string {
  const parts: string[] = [];
  for (const p of [...world.persons()].sort((a, b) => a.id.localeCompare(b.id))) {
    const b = world.primaryBody(p.id);
    parts.push([
      p.id, p.alive ? 1 : 0, Math.round(p.wealth), p.factionId ?? '', Object.keys(p.knowledge).length,
      b ? Math.round(b.pos.x) : '', b ? Math.round(b.pos.z) : '', b ? Math.round(b.health) : '',
    ].join(':'));
  }
  parts.push(`events:${world.events.length}`);
  const last = world.events[world.events.length - 1];
  if (last) parts.push(`lastEvent:${last.id}:${last.type}`);
  return fnv1a(parts.join('|'));
}

function gitCommit(): string | null {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function appVersion(): string {
  try { return (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version as string) ?? 'unknown'; } catch { return 'unknown'; }
}

export interface BuildBenchmarkReportOptions {
  seed: number;
  requestedDays: number;
  runtimeMs: number;
}

export function buildBenchmarkReport(result: HeadlessRunResult, opts: BuildBenchmarkReportOptions): BenchmarkReport {
  const { world, summary, chronicle, anomalies, significance, timing } = result;
  const groups = new Map<string, number>();
  for (const a of anomalies) groups.set(a.type, (groups.get(a.type) ?? 0) + 1);
  return {
    commit: gitCommit(),
    appVersion: appVersion(),
    seed: opts.seed,
    requestedDays: opts.requestedDays,
    simulatedWorldDays: summary.simulatedWorldDays,
    runtimeMs: opts.runtimeMs,
    canonicalEventCount: world.events.length,
    chronicleEntryCount: chronicle.length,
    anomalyGroups: [...groups.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    population: { start: summary.startingPopulation, end: summary.endingPopulation },
    deaths: summary.deaths.total,
    conflicts: summary.violentIncidents,
    robberies: summary.robberies,
    factionChanges: { leadership: summary.leadershipChanges, membership: summary.factionMembershipChanges },
    knowledgeTransfers: summary.knowledgeTransfers,
    pathfindingFailures: summary.pathFailures,
    topSignificantEntities: significance.slice(0, 10),
    economy: {
      requestsCompleted: summary.embodied.requests.completed, requestsFailed: summary.embodied.requests.failed,
      wagesPaid: summary.embodied.wagesPaid, purchasesSpent: summary.embodied.purchasesSpent,
      avgFatigue: summary.embodied.physiology.avgFatigue, avgSleepDebt: summary.embodied.physiology.avgSleepDebt,
      workStopped: summary.embodied.workStopped,
      treesFelled: summary.logistics.resourceNodes.depletedEvents,
      treesMature: summary.logistics.resourceNodes.trees.available,
      stoneRemaining: summary.logistics.resourceNodes.stone.remaining,
    },
    humanPhysiology: {
      commitments: summary.commitments,
      production: summary.production,
      breadPriceAtBakery: summary.pricing.breadPriceAtBakery,
      breadPriceAtStall: summary.pricing.breadPriceAtStall,
    },
    timing,
    stateHash: canonicalStateHash(world),
  };
}

/** Where cli.ts writes the report — `.debug/benchmarks/<seed>-<days>d-summary.json`. Exported
 * so tests can predict the path without duplicating the naming scheme. Always forward-slashed
 * (a stable, platform-independent repo-relative identifier — `join` would emit `\` on Windows
 * and break cross-platform comparison of the artifact path). */
export function benchmarkReportPath(seed: number, requestedDays: number): string {
  return `.debug/benchmarks/${seed}-${requestedDays}d-summary.json`;
}
