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
 * utility (mind/agent.ts's haul/build/gather candidates) — a genuinely critical physiological
 * need (thirst, exhaustion) still outbids ANY wage opportunity on its own terms, independent of
 * this factor, exactly as it already did before v0.5 (Constitution v0.5 §19's "critical
 * physiological need still overrides wage opportunity" falls out of the existing need-goal
 * utilities being computed independently, not from this multiplier).
 */
export function laborIncentive(p: Person): number {
  // 0 (wealthy — 80+ silver, comfortably above what a few days of ordinary living costs) .. 1 (destitute)
  const wealthPressure = clamp01(1 - p.wealth / 80);
  const hungerPressure = p.needs.hunger; // 0 (well fed) .. 1 (starving)
  const need = clamp01(wealthPressure * 0.6 + hungerPressure * 0.4);
  return 0.7 + need * 0.6; // 0.7 (comfortable, well fed) .. 1.3 (destitute, starving)
}
