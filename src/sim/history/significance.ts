import type { EntityId, WorldEvent } from '../core/types';
import { World } from '../core/world';

/**
 * Historical significance (Constitution §19-20, v0.2 Part 7). This is explicitly NOT power
 * tier, NOT cognitive fidelity, and NOT player importance — it is how consequential an
 * entity has actually become within canonical history. A healer, merchant, witness, priest,
 * or ordinary citizen can outscore a combatant; combat is one weighted contributor among
 * several, not the whole metric (Constitution §19: "A Normal-tier philosopher could have
 * enormous historical significance").
 *
 * Computed on demand from the canonical, causally-linked event log rather than maintained as
 * mutable per-entity state — the event log is already the source of truth, and recomputing
 * is cheap enough at v0.2's scale (bounded by world.events.length) while guaranteeing the
 * score can never drift from what actually happened. Deterministic: the same event log
 * always yields the same scores.
 */
const TYPE_WEIGHT: Partial<Record<WorldEvent['type'], number>> = {
  kill: 1, death: 0.9, birth: 0.6, marriage: 0.6, leadership_changed: 0.9,
  attack: 0.5, theft: 0.4, heal: 0.5, gift: 0.35, returned_item: 0.35,
  investigation: 0.3, confrontation: 0.35, arrest_attempt: 0.4, threat_spotted: 0.3,
  institutional_report: 0.25, rumor: 0.15, dispute: 0.2, debt: 0.15, debt_paid: 0.15,
  trade: 0.1, apology: 0.1, mourning: 0.15,
};
function typeWeight(t: WorldEvent['type']): number { return TYPE_WEIGHT[t] ?? 0.2; }

/** Full score map for every entity that has participated in at least one non-cognition
 * event, as actor or target. Cognition-category events (perceived/knowledge_gained/...) are
 * excluded: they are internal bookkeeping about a single mind, not history other people
 * would recognize. */
export function computeHistoricalSignificance(world: World): Map<EntityId, number> {
  const scores = new Map<EntityId, number>();
  const add = (id: EntityId | undefined, amount: number) => { if (!id || amount <= 0) return; scores.set(id, (scores.get(id) ?? 0) + amount); };
  for (const e of world.events) {
    if (e.category === 'cognition') continue;
    const base = typeWeight(e.type) * Math.max(0.05, e.significance);
    add(e.actor, base);
    add(e.target, base * 0.7);
    // Causal centrality: an event that set off many further recorded events was more
    // historically load-bearing than one that went nowhere (Constitution §51 "Causal
    // History"), independent of its own raw significance number.
    if (e.effects.length > 2 && e.actor) add(e.actor, Math.min(1, e.effects.length * 0.04));
  }
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
