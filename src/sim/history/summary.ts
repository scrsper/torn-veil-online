import { World } from '../core/world';
import type { Anomaly } from '../telemetry/anomaly';
import type { SignificantEntity } from './significance';

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
  };
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
  lines.push('');
  lines.push('Most historically significant entities:');
  for (const e of s.topSignificantEntities.slice(0, 10)) lines.push(`  ${e.score.toFixed(2).padStart(5)}  ${e.name}`);
  lines.push('');
  lines.push('Most significant events:');
  for (const e of s.topSignificantEvents.slice(0, 10)) lines.push(`  [${e.significance.toFixed(2)}] ${e.summary}`);
  return lines.join('\n');
}
