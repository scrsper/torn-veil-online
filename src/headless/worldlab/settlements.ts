import { settlementSnapshot } from '../../sim/world/settlementContinuity';
import { createHash } from 'node:crypto';
import { runHeadless } from '../runner';
import { generateProceduralWorld, type SettlementResult } from '../../sim/world/settlement';
import { ISOLATED_SITES, type SettlementSite } from '../../sim/world/settlementSpec';
import type { World } from '../../sim/core/world';
import { householdConsistencyErrors } from '../../sim/world/household';
import { SECONDS_PER_DAY } from '../../sim/core/time';
import { stockAt } from '../../sim/world/stock';

/** Canonical entity/event and working simulation state, including maps/sets and RNG positions. Never rounds
 * positions or currency. Timing and wall-clock measurements are intentionally absent. */
export function settlementStateDigest(world: World): string {
  return createHash('sha256').update(JSON.stringify({ entities: [...world.entities], events: world.events,
    fields: world.fields, nodes: world.resourceNodes, requests: world.requests, hauls: world.haulTasks,
    fires: world.fires, projects: world.constructionProjects, counters: world.getCounters(),
    rng: world.rng.state(), weatherRng: world.weatherRng.state(), demographicRng: world.demographicRng.state(),
    clock: world.clock.state(), physicalTime: world.physicalTime, weather: world.weather, tally: world.runTally,
    diffs: [...world.grid.diffs], doors: [...world.grid.doorStates], conflicts: world.conflicts,
    situations: world.situations, stints: world.workStints,
  }, (_, value) => value instanceof Map ? [...value] : value instanceof Set ? [...value] : value)).digest('hex');
}

export function runSettlementWorldLab(options: { seed: number; years?: number; days?: number; mode?: 'detailed' | 'epoch' | 'mixed'; stepSeconds?: number; sites?: readonly SettlementSite[]; detailedDays?: number; onProgress?: (day: number) => void }) {
  const started = performance.now(), days = options.days ?? (options.years === undefined ? 7 : options.years * 365), years = days / 365;
  const mode = options.mode ?? 'detailed';
  const stepSeconds = options.stepSeconds ?? (mode === 'detailed' ? 0.15 : 1440);
  const detailedDays = mode === 'mixed' ? options.detailedDays ?? 7 : mode === 'detailed' ? days : 0;
  if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new Error('Expected positive finite duration and step');
  if (mode === 'detailed' && stepSeconds > 0.15) throw new Error('Detailed benchmark requires physical steps <= 0.15 seconds');
  const trajectories: { day: number; settlements: ReturnType<typeof settlementSnapshot>[] }[] = [];
  const errors = new Set<string>();
  let settlements: SettlementResult[] = [];
  let initialCurrency = 0;
  let initialPopulation = 0;
  const histories: Record<string, Record<string, number>> = {};
  const samples: { day: number; population: number; wallMs: number; heapBytes: number }[] = [];
  const earlyEconomies: Record<string, { population: number; hungry: number; grain: number; flour: number; bread: number; history: Record<string, number> }> = {};
  const currency = (w: World) => w.persons().reduce((n, p) => n + p.wealth, 0) + w.households().reduce((n, h) => n + h.wealth, 0) + w.items().filter(i => i.type === 'coins').reduce((n, i) => n + i.quantity, 0);
  const result = runHeadless({ seed: options.seed, days,
    // Existing epoch cadence is explicit; a finer cadence can be supplied for embodied checks.
    stepSeconds,
    stepSecondsAt: mode === 'mixed' ? elapsed => elapsed < detailedDays * SECONDS_PER_DAY ? Math.min(5, (detailedDays * SECONDS_PER_DAY - elapsed) / 60) : stepSeconds : undefined,
    onProgress: options.onProgress,
    generate: w => { settlements = generateProceduralWorld(w, options.sites ?? ISOLATED_SITES); },
    maintenanceIntervalSeconds: SECONDS_PER_DAY, telemetryCap: 1000, probeIntervalSeconds: SECONDS_PER_DAY,
    onSetup: world => {
      initialCurrency = currency(world); initialPopulation = world.livingPersons().length;
      const siteOf = (id: string | undefined | null): string | undefined => {
        const e = world.get(id); if (!e) return;
        if (e.kind === 'person') return siteOf(world.person(id)!.homeId);
        if (e.kind === 'body') return siteOf(world.body(id)!.ownerId);
        if (e.kind === 'item') return siteOf(world.item(id)!.placeId ?? world.item(id)!.holderId);
        if (e.kind === 'place') return world.get<import('../../sim/core/types').Settlement>(world.place(e.id)?.settlementId)?.siteId;
        return undefined;
      };
      world.onEvent(e => {
        const ids = [e.actor, e.target, e.placeId, e.item];
        const sites = new Set(ids.map(siteOf).filter(Boolean));
        if (sites.size > 1) errors.add(`Cross-site ${e.type}: ${ids.join(',')}`);
        const site = siteOf(e.actor) ?? siteOf(e.target) ?? siteOf(e.placeId);
        if (site) { const counts = histories[site] ??= {}; counts[e.type] = (counts[e.type] ?? 0) + 1; }
      });
    },
    onProbe: (w, _sim, elapsed) => {
      for (const e of [...householdConsistencyErrors(w), ...w.livingIndexErrors()]) errors.add(e);
      const placeSite = (id: string | null | undefined) => w.get<import('../../sim/core/types').Settlement>(w.place(id)?.settlementId)?.siteId;
      const homeSite = (id: string | null | undefined) => placeSite(w.person(id)?.homeId);
      for (const p of w.persons()) {
        const site = homeSite(p.id);
        for (const id of Object.keys(p.relationships)) if (homeSite(id) && homeSite(id) !== site) errors.add(`Cross-site relationship ${p.id}:${id}`);
        for (const id of [p.workId, ...p.schedule.map(s => s.placeId), p.mind.goal?.targetPlace]) if (id && placeSite(id) !== site) errors.add(`Cross-site destination ${p.id}:${id}`);
        const home = w.place(p.homeId);
        for (const id of p.bodies) { const b = w.body(id); if (b?.present && home && Math.hypot(b.pos.x - home.inside.x, b.pos.z - home.inside.z) > 1000) errors.add(`Person left local area ${p.id}`); }
      }
      for (const task of w.haulTasks) if (placeSite(task.sourcePlaceId) !== placeSite(task.destPlaceId)) errors.add(`Cross-site haul ${task.id}`);
      for (const item of w.items()) {
        if (item.ownerId && !w.get(item.ownerId)) errors.add(`Invalid owner ${item.id}`);
        const owner = homeSite(item.ownerId), at = item.placeId ? placeSite(item.placeId) : homeSite(item.holderId);
        if (owner && at && owner !== at) errors.add(`Cross-site ownership ${item.id}`);
      }
      if (Math.abs(currency(w) - initialCurrency + (w.runTally.supply_cost_amount ?? 0)) > 0.01) errors.add('Currency conservation');
      const day = Math.floor(elapsed / SECONDS_PER_DAY);
      if (trajectories.at(-1)?.day !== day) trajectories.push({ day, settlements: w.settlements().map(s => settlementSnapshot(w, s)) });
      if (day === detailedDays && !Object.keys(earlyEconomies).length) for (const s of settlements) {
        const people = w.livingPersons().filter(p => homeSite(p.id) === s.spec.site.id);
        const stock = (type: 'grain' | 'flour' | 'bread') => Object.values(s.places).reduce((sum, pl) => sum + stockAt(w, type, pl.id), 0);
        earlyEconomies[s.spec.site.id] = { population: people.length, hungry: people.filter(p => p.needs.hunger > 0.7).length,
          grain: stock('grain'), flour: stock('flour'), bread: stock('bread'), history: { ...histories[s.spec.site.id] } };
      }
      if (day % 365 === 0 && samples.at(-1)?.day !== day) samples.push({ day, population: w.livingPersons().length, wallMs: performance.now() - started, heapBytes: process.memoryUsage().heapUsed });
    },
  });
  const wallMs = performance.now() - started;
  return { seed: options.seed, mode, days, years, detailedDays, detailedStepSeconds: mode === 'mixed' ? 5 : stepSeconds, stepSeconds,
    initialPopulation, finalPopulation: result.world.livingPersons().length, wallMs, msPerDayPerInitialPerson: wallMs / (years * 365 * initialPopulation),
    timing: result.timing, hash: settlementStateDigest(result.world), errors: [...errors], histories, earlyEconomies, samples, trajectories, navigation: { searches: result.world.nav.searches, cacheHits: result.world.nav.cacheHits }, spatial: result.world.spatialStats(),
    settlements: settlements.map(s => ({ spec: s.spec, finalPopulation: result.world.livingPersons().filter(p => result.world.place(p.homeId)?.slug?.startsWith(`${s.spec.site.id}:`)).length })),
  };
}
