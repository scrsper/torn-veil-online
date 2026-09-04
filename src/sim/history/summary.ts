import { World } from '../core/world';
import type { Anomaly } from '../telemetry/anomaly';
import type { SignificantEntity } from './significance';
import { metabolismSummary, type MetabolismSummary } from '../world/metabolism';
import { haulSummary, type HaulSummary } from '../logistics/haul';
import { resourceNodeSummary, type ResourceNodeSummary } from '../world/resources';
import { constructionSummary, type ConstructionSummary } from '../world/construction';
import { stockAt } from '../world/stock';
import { requestSummary, type RequestSummary } from '../core/requests';

/**
 * The structured, machine- and human-readable result of a headless world run (v0.2 Part 5).
 * Every field is derived from canonical `world.events`/`world.persons()` — nothing here is
 * estimated or invented; a field this milestone doesn't yet track honestly reports 0 with a
 * code comment explaining why, rather than a plausible-looking fake number.
 */
export interface WorldRunSummary {
  seed: number;
  requestedDays: number;
  simulatedWorldSeconds: number;
  simulatedWorldDays: number;
  startingPopulation: number;
  endingPopulation: number;
  deaths: { total: number; byCause: Record<string, number> };
  violentIncidents: number;
  robberies: number;
  reportsToGuards: number;
  investigations: number;
  knowledgeTransfers: number;
  relationshipChanges: number;
  itemOwnershipChanges: number;
  /** Not implemented in v0.2 — factions exist and have members, but nothing currently moves
   * a person between factions at runtime. Kept as an explicit 0, not omitted, so a reader of
   * this summary can see the gap rather than assume it was silently forgotten. */
  factionMembershipChanges: number;
  leadershipChanges: number;
  pathFailures: number;
  stuckEntities: number;
  goalChurnIncidents: number;
  anomalyCount: number;
  anomaliesByType: Record<string, number>;
  topSignificantEntities: SignificantEntity[];
  topSignificantEvents: { id: string; summary: string; significance: number }[];
  /** v0.2.4 world metabolism: end-of-run field/crop/moisture state + per-run chain activity. */
  metabolism: MetabolismSummary & {
    cropsPlanted: number; cropsMatured: number; cropsHarvested: number;
    resourceTransforms: number; mealsEaten: number; drinks: number; resourceShortages: number;
    resourceSpoiled: number;
  };
  /** v0.3 Living World I: physical logistics, extraction, and construction. */
  logistics: {
    haul: HaulSummary;
    resourceNodes: ResourceNodeSummary;
    construction: ConstructionSummary;
    /** grain/flour/bread/log/plank/stone physically at each keyed production Place. */
    stockByPlace: Record<string, Record<string, number>>;
  };
  /** v0.4 Embodied Economy: physiology, work-request/wage economy, and the reasons heavy
   * labour stopped competing for a person's attention (Constitution v0.4 §23/§29). */
  embodied: {
    physiology: {
      avgEnergy: number; avgHydration: number; avgFatigue: number; avgSleepDebt: number; avgBodyHeat: number;
    };
    requests: RequestSummary;
    /** Real, conserved currency moved as wages vs. purchases this run (see core/requests.ts's
     * payWage and world/metabolism.ts's buyFoodPortion — both tally directly, so these figures
     * survive event compaction on a long run). */
    wagesPaid: number;
    purchasesSpent: number;
    workStopped: { fatigue: number; thirst: number; heat: number; sleep: number };
    toolsBroken: number;
  };
}

export interface WorldRunSummaryContext {
  seed: number;
  requestedDays: number;
  /** `world.now` at the moment this run began (village generation seeds the clock at roughly
   * calendar day 100, not day 0 — see core/time.ts's WorldClock constructor). Required so
   * `simulatedWorldDays` below reports how much time THIS run simulated, not the world's
   * absolute calendar day count; omitting it would make a "--days 2" run's own summary claim
   * to have simulated ~102 days. */
  worldStart: number;
  startingPopulation: number;
  anomalies: Anomaly[];
  significance: SignificantEntity[];
}

export function buildWorldRunSummary(world: World, ctx: WorldRunSummaryContext): WorldRunSummary {
  // Scoped to THIS run's own window — village generation seeds several generations of
  // authored backstory (deaths, ambushes, marriages going back years, see village.ts's `H(...)`
  // calls), all recorded as ordinary WorldEvents with an explicit past `tick`. Without this
  // filter, a fresh "--days 2" run's own summary would report backstory as if it happened
  // during the run (observed: it claimed "4 deaths" — all four were pre-existing backstory,
  // and zero people had actually died in that run). `topSignificantEntities` intentionally
  // stays whole-history (Part 7: significance is about a person's whole recorded history, not
  // just this session) — only the raw per-run counts and the "most significant EVENTS" list
  // below are scoped to events this run itself produced.
  const events = world.events.filter(e => e.tick >= ctx.worldStart);
  const deaths = events.filter(e => e.type === 'death');
  const byCause: Record<string, number> = {};
  for (const d of deaths) {
    const cause = d.causes.map(id => world.event(id)?.type).find(Boolean) ?? 'unknown';
    byCause[cause] = (byCause[cause] ?? 0) + 1;
  }
  const anomaliesByType: Record<string, number> = {};
  for (const a of ctx.anomalies) anomaliesByType[a.type] = (anomaliesByType[a.type] ?? 0) + 1;
  const topEvents = [...events]
    .filter(e => e.category !== 'cognition')
    .sort((a, b) => b.significance - a.significance)
    .slice(0, 12)
    .map(e => ({ id: e.id, summary: e.summary, significance: Math.round(e.significance * 100) / 100 }));

  const elapsedWorldSeconds = world.now - ctx.worldStart;
  return {
    seed: ctx.seed,
    requestedDays: ctx.requestedDays,
    simulatedWorldSeconds: elapsedWorldSeconds,
    simulatedWorldDays: Math.round((elapsedWorldSeconds / 86400) * 100) / 100,
    startingPopulation: ctx.startingPopulation,
    endingPopulation: world.persons().filter(p => p.alive).length,
    deaths: { total: deaths.length, byCause },
    violentIncidents: events.filter(e => e.type === 'attack').length,
    robberies: events.filter(e => e.type === 'theft').length,
    // A "report" is a goal_changed event that adopted the 'report' goal — reuses the
    // existing goal-decision instrumentation rather than adding a new event type.
    reportsToGuards: events.filter(e => e.type === 'goal_changed' && e.data?.to === 'report').length,
    investigations: events.filter(e => e.type === 'investigation').length,
    knowledgeTransfers: events.filter(e => e.type === 'knowledge_gained').length,
    relationshipChanges: events.filter(e => e.type === 'relationship_changed').length,
    itemOwnershipChanges: events.filter(e => ['trade', 'theft', 'gift', 'returned_item', 'pickup', 'recovered'].includes(e.type)).length,
    factionMembershipChanges: 0,
    leadershipChanges: events.filter(e => e.type === 'leadership_changed').length,
    pathFailures: events.filter(e => e.type === 'path_failure').length,
    stuckEntities: new Set(ctx.anomalies.filter(a => a.type === 'stuck_agent').map(a => a.entity)).size,
    goalChurnIncidents: ctx.anomalies.filter(a => a.type === 'goal_churn').length,
    anomalyCount: ctx.anomalies.length,
    anomaliesByType,
    topSignificantEntities: ctx.significance,
    topSignificantEvents: topEvents,
    metabolism: {
      ...metabolismSummary(world),
      // accurate lifetime counts (world.runTally survives event compaction, unlike world.events)
      cropsPlanted: world.runTally.crop_planted ?? 0,
      cropsMatured: world.runTally.crop_matured ?? 0,
      cropsHarvested: world.runTally.crop_harvested ?? 0,
      resourceTransforms: world.runTally.resource_transformed ?? 0,
      mealsEaten: world.runTally.food_consumed ?? 0,
      drinks: world.runTally.water_consumed ?? 0,
      resourceShortages: world.runTally.resource_shortage ?? 0,
      resourceSpoiled: world.runTally.resource_spoiled ?? 0,
    },
    logistics: {
      haul: haulSummary(world),
      resourceNodes: resourceNodeSummary(world),
      construction: constructionSummary(world),
      stockByPlace: stockByProductionPlace(world),
    },
    embodied: embodiedSummary(world),
  };
}

function embodiedSummary(world: World): WorldRunSummary['embodied'] {
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  const avg = (f: (p: (typeof alive)[number]) => number) => alive.length ? Math.round((alive.reduce((a, p) => a + f(p), 0) / alive.length) * 1000) / 1000 : 0;
  return {
    physiology: {
      avgEnergy: avg(p => p.physiology.energy),
      avgHydration: avg(p => p.physiology.hydration),
      avgFatigue: avg(p => p.physiology.fatigue),
      avgSleepDebt: avg(p => p.physiology.sleepDebt),
      avgBodyHeat: avg(p => p.physiology.bodyHeat),
    },
    requests: requestSummary(world),
    wagesPaid: world.runTally.wage_paid_amount ?? 0,
    purchasesSpent: world.runTally.purchase_amount ?? 0,
    workStopped: {
      fatigue: world.runTally.work_stopped_fatigue ?? 0,
      thirst: world.runTally.work_stopped_thirst ?? 0,
      heat: world.runTally.work_stopped_heat ?? 0,
      sleep: world.runTally.work_stopped_sleep ?? 0,
    },
    toolsBroken: world.runTally.tool_broke ?? 0,
  };
}

function stockByProductionPlace(world: World): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const RES = ['grain', 'flour', 'bread', 'log', 'plank', 'stone'] as const;
  for (const pl of world.places()) {
    if (!['farm', 'mill', 'bakery', 'stall', 'sawpit', 'quarry', 'construction', 'hut'].includes(pl.type)) continue;
    const row: Record<string, number> = {};
    for (const r of RES) { const n = stockAt(world, r, pl.id); if (n > 0) row[r] = n; }
    if (Object.keys(row).length) out[pl.name] = row;
  }
  return out;
}

export function formatWorldRunSummary(s: WorldRunSummary): string {
  const lines: string[] = [];
  lines.push(`Torn Veil Online — headless world run summary`);
  lines.push(`Seed ${s.seed} · requested ${s.requestedDays} day(s) · simulated ${s.simulatedWorldDays} world-day(s)`);
  lines.push(`Population: ${s.startingPopulation} -> ${s.endingPopulation} (${s.deaths.total} death(s): ${Object.entries(s.deaths.byCause).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'})`);
  lines.push(`Conflict: ${s.violentIncidents} attack(s), ${s.robberies} theft(s)`);
  lines.push(`Social/institutional: ${s.reportsToGuards} report(s) to guards, ${s.investigations} investigation(s), ${s.knowledgeTransfers} knowledge transfer(s), ${s.relationshipChanges} relationship change(s), ${s.itemOwnershipChanges} item-ownership change(s), ${s.leadershipChanges} leadership change(s)`);
  lines.push(`Integrity: ${s.pathFailures} path failure(s), ${s.stuckEntities} stuck entit(y/ies), ${s.goalChurnIncidents} goal-churn incident(s), ${s.anomalyCount} anomal(y/ies) total`);
  if (s.anomalyCount) lines.push(`  by type: ${Object.entries(s.anomaliesByType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  const m = s.metabolism;
  lines.push(`Metabolism: ${m.fields} field(s), soil moisture ${m.avgSoilMoisture.toFixed(2)}, crops fallow=${m.crops.fallow}/planted=${m.crops.planted}/growing=${m.crops.growing}/mature=${m.crops.mature}/harvested=${m.crops.harvested} (avg growth ${m.avgGrowth.toFixed(2)})`);
  lines.push(`  chain: ${m.cropsPlanted} planted, ${m.cropsMatured} matured, ${m.cropsHarvested} harvested → ${m.resourceTransforms} transform(s) → grain ${m.stock.grain} / flour ${m.stock.flour} / bread ${m.stock.bread}`);
  lines.push(`  needs: avg hunger ${m.avgHunger.toFixed(2)}, avg thirst ${m.avgThirst.toFixed(2)}; ${m.mealsEaten} meal(s), ${m.drinks} drink(s), ${m.resourceShortages} shortage(s), ${m.resourceSpoiled} spoiled`);
  const L = s.logistics;
  lines.push(`Logistics: ${L.haul.requested} haul(s) requested, ${L.haul.delivered} delivered, ${L.haul.failed} failed, ${L.haul.open} open now; moved ${Object.entries(L.haul.unitsMovedByResource).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}`);
  lines.push(`  extraction: ${L.resourceNodes.extracted} extract(s), trees ${L.resourceNodes.trees.available}/${L.resourceNodes.trees.total} standing (${L.resourceNodes.depletedEvents} felled, ${L.resourceNodes.regrewEvents} regrown), stone remaining ${L.resourceNodes.stone.remaining}`);
  lines.push(`  construction: ${L.construction.complete}/${L.construction.projects} complete${L.construction.details.map(d => ` · ${d.name}: ${d.status} (${Object.entries(d.delivered).map(([k, v]) => `${v}/${d.required[k]} ${k}`).join(', ')}, labour ${d.laborPct}%, ${d.workers} worker(s))`).join('')}`);
  for (const [place, row] of Object.entries(L.stockByPlace)) lines.push(`  stock @ ${place}: ${Object.entries(row).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  const em = s.embodied;
  lines.push(`Embodied economy: avg energy ${em.physiology.avgEnergy.toFixed(2)}, hydration ${em.physiology.avgHydration.toFixed(2)}, fatigue ${em.physiology.avgFatigue.toFixed(2)}, sleep debt ${em.physiology.avgSleepDebt.toFixed(2)}h, body heat ${em.physiology.avgBodyHeat.toFixed(2)}`);
  lines.push(`  requests: ${em.requests.completed} completed, ${em.requests.failed} failed, ${em.requests.open + em.requests.accepted} open/in-progress; wages paid ${em.wagesPaid.toFixed(2)}, purchases spent ${em.purchasesSpent.toFixed(2)}`);
  lines.push(`  work stopped — fatigue ${em.workStopped.fatigue}, thirst ${em.workStopped.thirst}, heat ${em.workStopped.heat}, sleep ${em.workStopped.sleep}; tools broken ${em.toolsBroken}`);
  lines.push('');
  lines.push('Most historically significant entities:');
  for (const e of s.topSignificantEntities.slice(0, 10)) lines.push(`  ${e.score.toFixed(2).padStart(5)}  ${e.name}`);
  lines.push('');
  lines.push('Most significant events:');
  for (const e of s.topSignificantEvents.slice(0, 10)) lines.push(`  [${e.significance.toFixed(2)}] ${e.summary}`);
  return lines.join('\n');
}
