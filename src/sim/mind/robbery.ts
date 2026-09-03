import type { World } from '../core/world';
import type { Person, Item } from '../core/types';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/**
 * Generalized robbery decision logic (Constitution §66 "Avoid Bespoke Character Scripting").
 * These are pure, deterministic functions over canonical world state — any hostile actor with
 * a resource motive (not just the two current bandits) can drive a robbery through the same
 * `'rob'` goal/action pipeline in mind/agent.ts by calling these.
 *
 * The pipeline this supports (see agent.ts think()/plan()/act()):
 *   resource motive -> target selection (existing threat detection) -> approach (goto) ->
 *   demand (this module decides compliance) -> [voluntary transfer] or [resistance -> attack
 *   -> subdual] -> take valuables (this module selects what, agent.ts performs the canonical
 *   transfer) -> robbery completed -> disengage (goto away, existing 'fled' event).
 */

/** How long (physical seconds — the same clock a downed body's own `poseUntil` recovery timer
 * uses, not world/calendar time which can run at a very different rate) a bandit avoids
 * re-targeting a victim it just robbed, so a victim recovering from being downed is not
 * immediately re-engaged by the same actor. This is what actually closes the loop: the old code
 * had no notion of "this robbery already happened and is finished" once the target was merely
 * knocked down, so a downed-then-recovered victim looked like a fresh, undamaged threat again.
 * Comfortably longer than the ~45s downed-recovery window so the victim is reliably back on
 * their feet (and has had a moment to flee or call for help) before the same bandit reconsiders
 * them. */
export const ROBBERY_COOLDOWN_SECONDS = 150;

/**
 * Whether a threatened victim complies with a demand instead of resisting. Driven entirely by
 * the victim's own traits/state, not by name or species — any person can be threatened, and any
 * person's own courage/armament/health decides how they respond.
 */
export function resolveRobberyCompliance(world: World, victim: Person, bandit: Person): boolean {
  const body = world.primaryBody(victim.id);
  const healthy = body ? body.health / body.maxHealth : 1;
  const armed = victim.inventory.some(id => { const it = world.item(id); return !!it && it.damage > 0; });
  const dutyBound = victim.occupation === 'guard' || victim.occupation === 'captain';
  const resistWill = clamp(
    victim.traits.courage * 0.55 + victim.traits.aggression * 0.25
    + (armed ? 0.25 : 0) + (healthy - 0.5) * 0.2 + (dutyBound ? 0.55 : 0)
    - bandit.traits.aggression * 0.05,
  );
  return world.rng.next() >= resistWill;
}

export type RobberyTake =
  | { kind: 'coins'; item: Item }
  | { kind: 'wealth'; amount: number }
  | { kind: 'item'; item: Item };

/**
 * What a robbery actually takes, preferring something the victim genuinely carries (Constitution
 * requirement: "robbery should select something the target actually possesses where possible").
 * Falls back to abstract wealth (materialized into a real coin item by the caller, exactly like
 * `sellItem()` already does), then to the most valuable other carried item, then nothing.
 */
export function selectRobberyTake(world: World, victim: Person): RobberyTake | null {
  const coinItem = victim.inventory
    .map(id => world.item(id))
    .find((it): it is Item => !!it && it.type === 'coins' && it.quantity > 0);
  if (coinItem) return { kind: 'coins', item: coinItem };
  if (victim.wealth > 0) {
    const amount = Math.max(1, Math.floor(victim.wealth * (0.3 + world.rng.next() * 0.4)));
    return { kind: 'wealth', amount: Math.min(amount, Math.floor(victim.wealth)) };
  }
  const valuables = victim.inventory
    .map(id => world.item(id))
    .filter((it): it is Item => !!it && it.type !== 'coins')
    .sort((a, b) => b.value - a.value);
  if (valuables.length) return { kind: 'item', item: valuables[0] };
  return null;
}
