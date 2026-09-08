import { runHeadless } from '../runner';
import { SECONDS_PER_DAY } from '../../sim/core/time';
import { buildChronicle } from '../../sim/history/chronicle';
import { householdConsistencyErrors } from '../../sim/world/household';
import type { World } from '../../sim/core/world';
import { canonicalStateHash } from '../benchmarkReport';

export const EPOCH_YEAR_DAYS = 365;
/** One canonical Simulation.step per calendar day. This is a named WorldLab observation
 * cadence, not a different demographic model: daily physiology, economy, cognition, lifecycle,
 * event emission, and maintenance still run through Simulation. */
export const EPOCH_PHYSICAL_STEP_SECONDS = SECONDS_PER_DAY / 60;

export interface EpochYearTelemetry {
  year: number;
  wallMs: number;
  heapUsedBytes: number;
  livingPopulation: number;
  cumulativePeople: number;
  cumulativeEntities: number;
  births: number;
  deaths: number;
  inheritances: number;
  eventLogSize: number;
  chronicleDetailedEntries: number;
  chronicleEraCount: number;
  ticks: number;
  msPerTick: number;
  msPerTickPerLiving: number;
}

export interface EpochReport {
  seed: number;
  years: number;
  stepSeconds: number;
  totalWallMs: number;
  timing: Record<string, number>;
  initialLivingPopulation: number;
  stateHash: string;
  yearsTelemetry: EpochYearTelemetry[];
  totals: { births: number; deaths: number; inheritances: number; ticks: number };
  trend: {
    firstMsPerTickPerLiving: number;
    lastMsPerTickPerLiving: number;
    normalizedChangePercent: number;
    eventGrowth: number;
    detailedChronicleGrowth: number;
  };
  final: {
    livingPopulation: number;
    cumulativePeople: number;
    cumulativeEntities: number;
    deadPeople: number;
    eventLogSize: number;
    chronicleDetailedEntries: number;
    chronicleEraCount: number;
    bornDuringRunAdults: number;
    bornDuringRunPeople: number;
    bornDuringRunWithParents: number;
    maxLineageDepth: number;
    inheritanceTransfers: number;
    demographicHistoryEvents: number;
  };
  invariantErrors: string[];
  conservation: { currencyUnexplainedDelta: number; invalidItemOwners: number };
}

function tally(world: World, type: string): number {
  return world.runTally[type] ?? 0;
}

function totalCurrency(world: World): number {
  return world.persons().reduce((sum, p) => sum + p.wealth, 0)
    + world.households().reduce((sum, h) => sum + h.wealth, 0)
    + world.items().filter(item => item.type === 'coins').reduce((sum, item) => sum + item.quantity, 0);
}

/** Epoch-scale WorldLab tier. It observes the same World and Simulation as every other runner;
 * the coarser cadence is explicit in the report so raw performance evidence is reproducible. */
export function runEpochWorldLab(options: { seed: number; years: 1 | 5 | 25; stepSeconds?: number }): EpochReport {
  const { seed, years } = options;
  const stepSeconds = options.stepSeconds ?? EPOCH_PHYSICAL_STEP_SECONDS;
  const records: EpochYearTelemetry[] = [];
  const started = performance.now();
  let lastWall = started;
  let lastWorldSeconds = 0;
  let previousTallies: Record<string, number> | null = null;
  let initialLivingPopulation = 0;
  let initialCurrency = 0;
  let initialSupplySink = 0;

  const result = runHeadless({
    seed,
    days: years * EPOCH_YEAR_DAYS,
    stepSeconds,
    maintenanceIntervalSeconds: SECONDS_PER_DAY,
    telemetryCap: 1000,
    probeIntervalSeconds: EPOCH_YEAR_DAYS * SECONDS_PER_DAY,
    onProbe: (world, _sim, elapsed) => {
      if (elapsed <= 0) {
        initialLivingPopulation = world.livingPersons().length;
        initialCurrency = totalCurrency(world);
        initialSupplySink = world.runTally.supply_cost_amount ?? 0;
        previousTallies = { birth: tally(world, 'birth'), death: tally(world, 'death'), inheritance: tally(world, 'inheritance') };
        return;
      }
      const year = Math.min(years, Math.ceil(elapsed / (EPOCH_YEAR_DAYS * SECONDS_PER_DAY)));
      if (records.at(-1)?.year === year) return;
      const now = performance.now();
      const wallMs = now - lastWall;
      const worldDelta = elapsed - lastWorldSeconds;
      const ticks = Math.max(1, Math.round(worldDelta / (stepSeconds * world.clock.timeScale)));
      const livingPopulation = world.livingPersons().length;
      const birthTotal = tally(world, 'birth'); const deathTotal = tally(world, 'death'); const inheritanceTotal = tally(world, 'inheritance');
      const chronicleDetailedEntries = buildChronicle(world).length;
      records.push({
        year, wallMs, heapUsedBytes: process.memoryUsage().heapUsed,
        livingPopulation, cumulativePeople: world.persons().length, cumulativeEntities: world.entities.size,
        births: birthTotal - (previousTallies?.birth ?? birthTotal),
        deaths: deathTotal - (previousTallies?.death ?? deathTotal),
        inheritances: inheritanceTotal - (previousTallies?.inheritance ?? inheritanceTotal),
        eventLogSize: world.events.length, chronicleDetailedEntries, chronicleEraCount: world.chronicleEras.length,
        ticks, msPerTick: wallMs / ticks, msPerTickPerLiving: wallMs / ticks / Math.max(1, livingPopulation),
      });
      previousTallies = { birth: birthTotal, death: deathTotal, inheritance: inheritanceTotal };
      lastWall = now; lastWorldSeconds = elapsed;
    },
  });

  const totalWallMs = performance.now() - started;
  const first = records[0]; const last = records.at(-1)!;
  const invariantErrors = [...result.world.livingIndexErrors(), ...householdConsistencyErrors(result.world)];
  const invalidItemOwners = result.world.items().filter(item => item.ownerId && !result.world.get(item.ownerId)).length;
  if (invalidItemOwners) invariantErrors.push(`${invalidItemOwners} item owner references do not resolve`);
  const runStartTick = result.world.now - years * EPOCH_YEAR_DAYS * SECONDS_PER_DAY;
  const people = result.world.persons();
  const depthMemo = new Map<string, number>();
  const lineageDepth = (id: string, visiting = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (visiting.has(id)) return 0;
    const person = result.world.person(id); if (!person?.parentIds.length) return 1;
    const next = new Set(visiting); next.add(id);
    const depth = 1 + Math.max(0, ...person.parentIds.map(parentId => lineageDepth(parentId, next)));
    depthMemo.set(id, depth); return depth;
  };
  return {
    seed, years, stepSeconds, totalWallMs, timing: result.timing, initialLivingPopulation, stateHash: canonicalStateHash(result.world), yearsTelemetry: records,
    totals: {
      births: records.reduce((n, x) => n + x.births, 0),
      deaths: records.reduce((n, x) => n + x.deaths, 0),
      inheritances: records.reduce((n, x) => n + x.inheritances, 0),
      ticks: records.reduce((n, x) => n + x.ticks, 0),
    },
    trend: {
      firstMsPerTickPerLiving: first?.msPerTickPerLiving ?? 0,
      lastMsPerTickPerLiving: last?.msPerTickPerLiving ?? 0,
      normalizedChangePercent: first ? ((last.msPerTickPerLiving / first.msPerTickPerLiving) - 1) * 100 : 0,
      eventGrowth: last ? last.eventLogSize - first.eventLogSize : 0,
      detailedChronicleGrowth: last ? last.chronicleDetailedEntries - first.chronicleDetailedEntries : 0,
    },
    final: {
      livingPopulation: result.world.livingPersons().length,
      cumulativePeople: result.world.persons().length,
      cumulativeEntities: result.world.entities.size,
      deadPeople: result.world.persons().length - result.world.livingPersons().length,
      eventLogSize: result.world.events.length,
      chronicleDetailedEntries: result.chronicle.length,
      chronicleEraCount: result.world.chronicleEras.length,
      bornDuringRunAdults: people.filter(p => p.birthTick >= runStartTick && (p.lifeStage === 'adult' || p.lifeStage === 'elder')).length,
      bornDuringRunPeople: people.filter(p => p.birthTick >= runStartTick).length,
      bornDuringRunWithParents: people.filter(p => p.birthTick >= runStartTick && p.parentIds.length === 2 && p.parentIds.every(id => !!result.world.person(id))).length,
      maxLineageDepth: Math.max(0, ...people.map(p => lineageDepth(p.id))),
      inheritanceTransfers: result.world.events.filter(e => e.type === 'inheritance' && (Number(e.data.amount ?? 0) > 0 || ((e.data.itemIds as string[] | undefined)?.length ?? 0) > 0)).length,
      demographicHistoryEvents: result.world.events.filter(e => ['birth', 'death', 'inheritance'].includes(e.type)).length,
    },
    invariantErrors,
    conservation: {
      currencyUnexplainedDelta: totalCurrency(result.world) - initialCurrency + ((result.world.runTally.supply_cost_amount ?? 0) - initialSupplySink),
      invalidItemOwners,
    },
  };
}
