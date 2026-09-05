import { World } from '../core/world';
import type { Anomaly } from '../telemetry/anomaly';
import type { SignificantEntity } from './significance';
import { metabolismSummary, type MetabolismSummary } from '../world/metabolism';
import { haulSummary, type HaulSummary } from '../logistics/haul';
import { resourceNodeSummary, type ResourceNodeSummary } from '../world/resources';
import { constructionSummary, type ConstructionSummary } from '../world/construction';
import { stockAt } from '../world/stock';
import { requestSummary, type RequestSummary } from '../core/requests';
import { productionSummary, type ProductionSummary } from '../world/production';
import { effectivePrice } from '../world/pricing';
import { fireSummary, type FireSummary } from '../world/fire';
import type { SkillId } from '../core/types';

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
      avgEnergy: number; avgHydration: number; avgFatigue: number; avgSleepDebt: number; avgBodyHeat: number; avgWetness: number;
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
  /** v0.5 Human Physiology / Autonomous Economy: goal-commitment lifecycle counts (lifetime,
   * survives event compaction via world.runTally — see the goal_committed/suspended/resumed/
   * abandoned entries in core/world.ts's TALLIED_TYPES), autonomous bakery production, and a
   * point-in-time snapshot of the bounded scarcity-responsive bread price. */
  commitments: { committed: number; suspended: number; resumed: number; abandoned: number };
  production: ProductionSummary;
  pricing: { breadPriceAtBakery: number | null; breadPriceAtStall: number | null };
  /** v0.7 §A/B: real economic circulation — closing the wage/wealth gap v0.6 disclosed (docs/
   * V0_6_KNOWLEDGE_MEMORY_SKILLS_INTENT.md §3.4). `wholesaleAmount` is the NEW wholesale-trade
   * flow (world/trade.ts) alongside the pre-existing `embodied.wagesPaid`/`purchasesSpent`;
   * `wealthByOccupation` is a bounded per-occupation-category average so a run can be judged for
   * "did fixing circulation actually reach ordinary working villagers" without dumping all 33+
   * individual wealth figures. Currency is only ever tracked, never invented — every silver
   * counted here already moved through `payWage`/`buyFoodPortion`/`settleWholesale`, each of
   * which caps a payer at their own actual wealth. */
  circulation: {
    wholesaleAmount: number;
    /** v0.7 §B (found via this circulation instrumentation, at the 30/90-day horizon this
     * milestone's own DoD requires running — see docs/V0_7_CIRCULATION_EXPOSURE_AFFORDANCES.md
     * §7): `world/metabolism.ts`'s `restockTavern` now charges the innkeeper a real, bounded,
     * EXPLICIT supply cost instead of restocking for free — closing a one-way wealth sink that
     * had concentrated 59% of total village wealth into the innkeeper pair by day 90. Tracked
     * separately from `wholesaleAmount` (a real trade between two parties) since this is
     * currency deliberately LEAVING the simulation, not moving between two people. */
    supplyCostAmount: number;
    wealthByOccupation: Record<string, { avg: number; min: number; max: number; n: number }>;
    villagersBelow3Silver: number;
  };
  /** v0.8 Materials, Fire, Processes & Practical Crafting. */
  materials: {
    fire: FireSummary;
    stewsCooked: number;
    itemsCrafted: number;
    sticksGathered: number;
    herbsAtRiverWoods: number;
  };
  /** v0.6 Knowledge, Memory, Skills & Intentional Action. `*BandMinutes` are TIME-WEIGHTED (world-
   * minutes actually spent at each severity band — mind/agent.ts's `strategic()`), not a single
   * end-of-run snapshot, so they answer "how much of a person's day is spent at this severity"
   * rather than "what was it at the instant the run ended." Divide by total person-minutes
   * simulated (population × simulatedWorldSeconds/60) for a share. */
  cognition: {
    hungerBandMinutes: Record<string, number>;
    thirstBandMinutes: Record<string, number>;
    sleepBandMinutes: Record<string, number>;
    /** v0.7 §Environmental exposure: time-weighted wetness/discomfort band distribution — same
     * "world-minutes actually spent at each band" shape as the other severity bands above. */
    comfortBandMinutes: Record<string, number>;
    avgKnowledgePerPerson: number;
    avgMemoriesPerPerson: number;
    knowledgeGained: number;
    knowledgeForgotten: number;
    memoriesFormed: number;
    intentionsFormed: number;
    /** Village-wide average proficiency per skill (novices, still at 0, included) — a coarse
     * "is anyone actually getting better at anything" signal without a full per-occupation
     * breakdown (available directly from the Inspector's Skills tab for a specific person). */
    avgSkillBySkill: Partial<Record<SkillId, number>>;
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
    commitments: {
      committed: world.runTally.goal_committed ?? 0,
      suspended: world.runTally.goal_suspended ?? 0,
      resumed: world.runTally.goal_resumed ?? 0,
      abandoned: world.runTally.goal_abandoned ?? 0,
    },
    production: productionSummary(world),
    pricing: breadPricingSnapshot(world),
    cognition: cognitionSummary(world),
    circulation: circulationSummary(world),
    materials: materialsSummary(world),
  };
}

function materialsSummary(world: World): WorldRunSummary['materials'] {
  const riverWoods = world.places().find(p => p.slug === 'river_woods');
  return {
    fire: fireSummary(world),
    stewsCooked: world.runTally.stew_cooked ?? 0,
    itemsCrafted: world.runTally.item_crafted ?? 0,
    sticksGathered: world.runTally.stick_gathered ?? 0,
    herbsAtRiverWoods: riverWoods ? stockAt(world, 'herbs', riverWoods.id) : 0,
  };
}

/** `resource_transformed`/`resource_extracted` are tallied as one lifetime COUNT each (see
 * core/world.ts's `TALLIED_TYPES`) — that tally doesn't distinguish per-`how` the way this
 * summary wants for stew/stick counts specifically, so those two are read directly off
 * surviving events instead: a coarse, honestly-labelled approximation on a long run where
 * compaction has dropped most low-significance events of that type (same caveat
 * `topSignificantEvents` already carries elsewhere in this file), not a precise lifetime total. */
function circulationSummary(world: World): WorldRunSummary['circulation'] {
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  const byOcc: Record<string, number[]> = {};
  for (const p of alive) (byOcc[p.occupation] ??= []).push(p.wealth);
  const wealthByOccupation: WorldRunSummary['circulation']['wealthByOccupation'] = {};
  for (const [occ, wealths] of Object.entries(byOcc)) {
    wealthByOccupation[occ] = {
      avg: Math.round((wealths.reduce((a, b) => a + b, 0) / wealths.length) * 100) / 100,
      min: Math.min(...wealths), max: Math.max(...wealths), n: wealths.length,
    };
  }
  return {
    wholesaleAmount: world.runTally.wholesale_amount ?? 0,
    supplyCostAmount: world.runTally.supply_cost_amount ?? 0,
    wealthByOccupation,
    villagersBelow3Silver: alive.filter(p => p.wealth < 3).length,
  };
}

const SEVERITY_BANDS = ['comfortable', 'noticeable', 'uncomfortable', 'urgent', 'critical'] as const;
const SKILL_IDS: SkillId[] = ['woodcutting', 'quarrying', 'hauling', 'sawing', 'construction', 'baking'];
function cognitionSummary(world: World): WorldRunSummary['cognition'] {
  const bandMinutes = (prefix: string) => Object.fromEntries(SEVERITY_BANDS.map(b => [b, world.runTally[`${prefix}_${b}_min`] ?? 0]));
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  const avg = (n: number) => alive.length ? Math.round((n / alive.length) * 100) / 100 : 0;
  const avgSkillBySkill: Partial<Record<SkillId, number>> = {};
  for (const id of SKILL_IDS) avgSkillBySkill[id] = avg(alive.reduce((n, p) => n + (p.skills?.[id] ?? 0), 0));
  return {
    hungerBandMinutes: bandMinutes('hunger_band'),
    thirstBandMinutes: bandMinutes('thirst_band'),
    sleepBandMinutes: bandMinutes('sleep_band'),
    comfortBandMinutes: bandMinutes('comfort_band'),
    avgKnowledgePerPerson: avg(alive.reduce((n, p) => n + Object.keys(p.knowledge).length, 0)),
    avgMemoriesPerPerson: avg(alive.reduce((n, p) => n + p.memories.length, 0)),
    knowledgeGained: world.runTally.knowledge_gained ?? 0,
    knowledgeForgotten: world.runTally.knowledge_forgotten ?? 0,
    memoriesFormed: world.runTally.memory_formed ?? 0,
    intentionsFormed: world.runTally.intention_formed ?? 0,
    avgSkillBySkill,
  };
}

function breadPricingSnapshot(world: World): WorldRunSummary['pricing'] {
  const bakery = world.places().find(p => p.type === 'bakery');
  const stall = world.places().find(p => p.type === 'stall' && p.name.toLowerCase().includes('bread'));
  return {
    breadPriceAtBakery: bakery ? effectivePrice('bread', 2, stockAt(world, 'bread', bakery.id)) : null,
    breadPriceAtStall: stall ? effectivePrice('bread', 2, stockAt(world, 'bread', stall.id)) : null,
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
      avgWetness: avg(p => p.physiology.wetness),
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
  lines.push(`Embodied economy: avg energy ${em.physiology.avgEnergy.toFixed(2)}, hydration ${em.physiology.avgHydration.toFixed(2)}, fatigue ${em.physiology.avgFatigue.toFixed(2)}, sleep debt ${em.physiology.avgSleepDebt.toFixed(2)}h, body heat ${em.physiology.avgBodyHeat.toFixed(2)}, wetness ${em.physiology.avgWetness.toFixed(2)}`);
  lines.push(`  requests: ${em.requests.completed} completed, ${em.requests.failed} failed, ${em.requests.open + em.requests.accepted} open/in-progress; wages paid ${em.wagesPaid}, purchases spent ${em.purchasesSpent}`);
  lines.push(`  work stopped — fatigue ${em.workStopped.fatigue}, thirst ${em.workStopped.thirst}, heat ${em.workStopped.heat}, sleep ${em.workStopped.sleep}; tools broken ${em.toolsBroken}`);
  const cm = s.commitments;
  lines.push(`Goal commitment: ${cm.committed} committed, ${cm.suspended} suspended, ${cm.resumed} resumed, ${cm.abandoned} abandoned`);
  const pr = s.production;
  lines.push(`Autonomous production: ${pr.completed} completed, ${pr.open + pr.accepted} open/in-progress, ${pr.failed} failed, ${pr.wagesPaid} wages paid`);
  lines.push(`Bread price now: bakery ${s.pricing.breadPriceAtBakery ?? 'n/a'}, stall ${s.pricing.breadPriceAtStall ?? 'n/a'}`);
  const cr = s.circulation;
  lines.push(`Circulation: wholesale trade ${cr.wholesaleAmount} silver, supply costs ${cr.supplyCostAmount} silver (explicit exit); ${cr.villagersBelow3Silver}/${Object.values(cr.wealthByOccupation).reduce((n, v) => n + v.n, 0)} villagers below 3 silver`);
  lines.push(`  wealth by occupation (avg/min/max): ${Object.entries(cr.wealthByOccupation).map(([occ, w]) => `${occ}=${w.avg}/${w.min}/${w.max}`).join(', ')}`);
  const mat = s.materials;
  lines.push(`Materials/Fire/Crafting: fire ${mat.fire.lit}/${mat.fire.total} lit now (${mat.fire.extinguishedTotal} extinguished, ${mat.fire.extinguishedByStorm} by storm); ${mat.stewsCooked} stew batch(es) cooked, ${mat.itemsCrafted} item(s) crafted, ${mat.sticksGathered} stick(s) gathered while felling, ${mat.herbsAtRiverWoods} herbs at the river woods`);
  lines.push('');
  lines.push('Most historically significant entities:');
  for (const e of s.topSignificantEntities.slice(0, 10)) lines.push(`  ${e.score.toFixed(2).padStart(5)}  ${e.name}`);
  lines.push('');
  lines.push('Most significant events:');
  for (const e of s.topSignificantEvents.slice(0, 10)) lines.push(`  [${e.significance.toFixed(2)}] ${e.summary}`);
  return lines.join('\n');
}
