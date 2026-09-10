import type { Person } from '../core/types';
import { World } from '../core/world';

/**
 * A deliberately small resource-pressure signal (Constitution §12/§39) — not a full economy.
 * The point is a real causal loop, not a hardcoded activity: a hostile (bandit) faction
 * whose aggregate wealth is low feels more pressure to rob, and that pressure fades as the
 * faction accumulates wealth (including, causally, from successful robberies — see
 * agent.ts's takeItem/theft path, which already updates ownership; wealth itself moves via
 * the same `wealth` field trade/purchase already use).
 *
 * Returns 0 (comfortable) .. 1 (desperate).
 */
export function banditResourcePressure(world: World, p: Person): number {
  const faction = world.faction(p.factionId);
  const members = faction ? faction.members.map(id => world.person(id)).filter((x): x is Person => !!x && x.alive) : [p];
  if (!members.length) return 0;
  const totalWealth = members.reduce((sum, m) => sum + m.wealth, 0);
  const comfortable = 40 * members.length; // rough per-member "comfortable" liquid wealth baseline
  return Math.max(0, Math.min(1, 1 - totalWealth / comfortable));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * v0.5 §V.19: how strongly this person values PAID work right now, given their own wealth and
 * hunger — a bounded, deterministic weighting (not sophisticated utility theory). A well-fed,
 * wealthy person has little reason to take on an unpleasant low-wage haul; a poor, hungry one
 * has a strong one. Multiplies (does not replace) a labour goal's own capability/urgency-based
 * utility (mind/agent.ts's haul/build/gather candidates). Capability gates, need goals and
 * physiological interruption rules still apply. Witnessed food-price pressure can make a
 * real paid job preferable to a routine duty; the multiplier cannot create a job or a wage.
 */
export function laborIncentive(p: Person, world?: World): number {
  // 0 (wealthy — 80+ silver, comfortably above what a few days of ordinary living costs) .. 1 (destitute)
  const wealthPressure = clamp01(1 - p.wealth / 80);
  const hungerPressure = p.needs.hunger; // 0 (well fed) .. 1 (starving)
  const need = clamp01(wealthPressure * 0.6 + hungerPressure * 0.4);
  // Own witnessed meal quotes let the same incentive express a concrete livelihood need.
  // Two meals of cash is a short planning reserve, not a guaranteed living wage. No remote
  // price or relative's wallet is consulted, and an old quote ceases to be evidence.
  const quotes = world ? Object.values(p.knowledge).filter(k => k.key.startsWith('food-access:')
    && world.now - k.learnedAt < 12 * 3600 && Number(k.claim.price) > 0).map(k => Number(k.claim.price)) : [];
  const mealBudget = quotes.length ? Math.min(...quotes) * 2 : 0;
  const foodPressure = mealBudget ? clamp01(1 - p.wealth / mealBudget) * hungerPressure : 0;
  // Reuse one bounded pressure factor. Near insolvency, earning the next meal can outweigh
  // routine unpaid duties while capability, actual jobs and urgent bodily needs still matter.
  return 0.7 + Math.max(need * 0.6, foodPressure * 1.6);
}
