import type { EntityId, WorldEvent } from '../core/types';
import { World } from '../core/world';
import { eventHistoricalContributions } from '../core/historicalSignificance';

/**
 * Historical significance (Constitution §19-20, v0.2 Part 7). This is explicitly NOT power
 * tier, NOT cognitive fidelity, and NOT player importance — it is how consequential an
 * entity has actually become within canonical history. A healer, merchant, witness, priest,
 * or ordinary citizen can outscore a combatant; combat is one weighted contributor among
 * several, not the whole metric (Constitution §19: "A Normal-tier philosopher could have
 * enormous historical significance").
 *
 * Materialized incrementally as canonical events are emitted. `World.emit` applies the one
 * contribution algorithm in `core/historicalSignificance.ts`; save/load persists that lifetime
 * materialization even when era compaction retires detail. This keeps hot reads O(entities)
 * rather than repeatedly rescanning an ever-growing event history without a competing score rule.
 */
/** Full score map for every entity that has participated in at least one non-cognition
 * event, as actor or target. Cognition-category events (perceived/knowledge_gained/...) are
 * excluded: they are internal bookkeeping about a single mind, not history other people
 * would recognize. */
export function computeHistoricalSignificance(world: World): Map<EntityId, number> {
  return new Map(world.historicalSignificance);
}

/** Authoritative replay used for reconciliation and equivalence tests, not hourly upkeep. */
export function computeHistoricalSignificanceFull(events: readonly WorldEvent[]): Map<EntityId, number> {
  const scores = new Map<EntityId, number>();
  const add = (id: EntityId | undefined, amount: number) => { if (!id || amount <= 0) return; scores.set(id, (scores.get(id) ?? 0) + amount); };
  for (const e of events) for (const [id, amount] of eventHistoricalContributions(e)) add(id, amount);
  return scores;
}

export interface SignificantEntity { id: EntityId; name: string; score: number; }

export function topSignificantEntities(world: World, n = 15): SignificantEntity[] {
  const scores = computeHistoricalSignificance(world);
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, score]) => ({ id, name: world.nameOf(id), score: Math.round(score * 100) / 100 }));
}
