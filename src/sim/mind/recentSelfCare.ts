import type { EntityId, WorldEvent } from '../core/types';
import type { World } from '../core/world';

interface RecentCare {
  at: number;
  events: WorldEvent[];
  count: number;
  meals: Set<EntityId>;
  drinks: Set<EntityId>;
}
const cache = new WeakMap<World, RecentCare>();

/** Derived lookup for the existing self-care recollection windows. All minds in a
 * step share one history scan; events appended during that step are still visible
 * to the next mind. Nothing is persisted or added to anyone's knowledge.
 *
 * Preserve the old backwards-scan cutoff, including backdated events. A backdated
 * append forms a new cutoff barrier, so earlier matches cannot cross it. Rebuild
 * on clock movement or history replacement (load/compaction), never cache beliefs. */
export function recentSelfCare(world: World, actor: EntityId): { ate: boolean; drank: boolean } {
  const events = world.events, now = world.now;
  let care = cache.get(world);
  if (!care || care.at !== now || care.events !== events || care.count > events.length) {
    care = { at: now, events, count: events.length, meals: new Set(), drinks: new Set() };
    let mealsOpen = true, drinksOpen = true;
    for (let i = events.length - 1; i >= 0 && (mealsOpen || drinksOpen); i--) {
      const e = events[i], age = now - e.tick;
      if (age >= 45 * 60) mealsOpen = false;
      if (age >= 30 * 60) drinksOpen = false;
      if (e.actor && mealsOpen && e.type === 'meal') care.meals.add(e.actor);
      if (e.actor && drinksOpen && e.type === 'water_consumed') care.drinks.add(e.actor);
    }
    cache.set(world, care);
  } else {
    for (let i = care.count; i < events.length; i++) {
      const e = events[i], age = now - e.tick;
      if (age >= 45 * 60) care.meals.clear();
      else if (e.actor && e.type === 'meal') care.meals.add(e.actor);
      if (age >= 30 * 60) care.drinks.clear();
      else if (e.actor && e.type === 'water_consumed') care.drinks.add(e.actor);
    }
    care.count = events.length;
  }
  return { ate: care.meals.has(actor), drank: care.drinks.has(actor) };
}
