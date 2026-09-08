import type { EntityId, WorldEvent } from './types';

const TYPE_WEIGHT: Partial<Record<WorldEvent['type'], number>> = {
  kill: 1, death: 0.9, birth: 0.6, marriage: 0.6, leadership_changed: 0.9,
  inheritance: 0.55, coming_of_age: 0.45, pregnancy_started: 0.25,
  attack: 0.5, theft: 0.4, heal: 0.5, gift: 0.35, returned_item: 0.35,
  investigation: 0.3, confrontation: 0.35, arrest_attempt: 0.4, threat_spotted: 0.3,
  institutional_report: 0.25, rumor: 0.15, dispute: 0.2, debt: 0.15, debt_paid: 0.15,
  trade: 0.1, apology: 0.1, mourning: 0.15,
};

export function historicalTypeWeight(type: WorldEvent['type']): number {
  return TYPE_WEIGHT[type] ?? 0.2;
}

export function eventHistoricalContributions(event: WorldEvent): Array<[EntityId, number]> {
  if (event.category === 'cognition') return [];
  const base = historicalTypeWeight(event.type) * Math.max(0.05, event.significance);
  const out: Array<[EntityId, number]> = [];
  if (event.actor) out.push([event.actor, base]);
  if (event.target) out.push([event.target, base * 0.7]);
  if (event.actor && event.effects.length > 2) out.push([event.actor, Math.min(1, event.effects.length * 0.04)]);
  return out;
}

/** Change in an event actor's causal-centrality contribution when one effect is appended. */
export function effectCentralityDelta(before: number, after: number): number {
  const score = (count: number) => count > 2 ? Math.min(1, count * 0.04) : 0;
  return score(after) - score(before);
}

