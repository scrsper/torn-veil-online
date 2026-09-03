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
