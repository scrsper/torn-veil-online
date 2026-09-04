import type { Person, ItemType } from '../core/types';
import type { World } from '../core/world';
import { transform, villageStock, type TransformResult } from './metabolism';
import { stockAt as stockAtPlace } from './stock';
import { fireAt, fireIntensityAt, igniteFire, feedFire } from './fire';
import { practiceSkill } from '../core/skills';

/**
 * The first real production process to require actual fire/heat (v0.8 §D/E), proving the
 * pattern rather than retrofitting it onto the existing bread economy (Constitution v0.8: "do
 * not force every existing transform to require fire if doing so destabilizes the milestone" —
 * `bake`/`mill` are deliberately untouched). Raw `meat` (already real village stock — Kestrel
 * the hunter sells it) → `stew`, gated on the tavern's own hearth genuinely burning, not merely
 * `lit === true`. Reuses `world/metabolism.ts`'s generalized `transform()` (v0.3's own
 * "conditions" abstraction — Part E asks for "inputs + conditions + energy/work → outputs," and
 * the condition here is simply checked before calling the same conservation-respecting helper
 * every other transform already uses) — the pattern future smelting/fermentation/drying can copy
 * directly: check a real condition, then `transform()`.
 */
export const MEAT_TO_STEW_RATIO = { in: 2, out: 3 } as const;
export const STEW_CAP = 30;
/** A cold or barely-caught hearth doesn't cook anything — real heat, not a boolean "is there a
 * fire" flag. */
const MIN_FIRE_INTENSITY_TO_COOK = 0.3;

export function cook(world: World, cookPerson: Person): TransformResult {
  const tavernId = world.places().find(p => p.type === 'tavern')?.id;
  if (!tavernId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'stew') >= STEW_CAP) return { ok: false, produced: 0, consumed: 0 };
  if (fireIntensityAt(world, tavernId) < MIN_FIRE_INTENSITY_TO_COOK) return { ok: false, produced: 0, consumed: 0 };
  if (stockAtPlace(world, 'meat', tavernId) < MEAT_TO_STEW_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'meat' };
  const result = transform(world, {
    actor: cookPerson.id, inputType: 'meat', inputQty: MEAT_TO_STEW_RATIO.in, inputPlaces: [tavernId],
    outputType: 'stew', outputQty: MEAT_TO_STEW_RATIO.out, outputPlace: tavernId, ownerId: cookPerson.id, how: 'cooked over the hearth',
  });
  if (result.ok) practiceSkill(cookPerson, 'cooking', 1);
  return result;
}

/** Kindling (sticks) catches fastest and is preferred for lighting a cold hearth; once burning,
 * logs/planks sustain it far longer per unit tended (`world/fire.ts`'s own fuel-seconds table).
 * Tried in this order for both lighting and feeding — a cook reaches for what actually works. */
const IGNITE_ORDER: { type: ItemType; qty: number }[] = [{ type: 'stick', qty: 2 }, { type: 'log', qty: 1 }, { type: 'plank', qty: 1 }];
const FEED_ORDER: { type: ItemType; qty: number }[] = [{ type: 'log', qty: 1 }, { type: 'plank', qty: 1 }, { type: 'stick', qty: 2 }];
/** Tend the tavern's own fire below this much remaining fuel (world-seconds) — well before it
 * would actually go out, so cooking rarely stalls on a cold hearth. */
const TEND_BELOW_SECONDS = 3600;

/**
 * The cook keeps the tavern's real hearth burning while working — lighting it from whatever
 * flammable stock is on hand if it's cold, or feeding it before it runs low. Real, bounded,
 * physically consumed fuel (world/fire.ts), never a free "fire is just on" assumption. Returns
 * true if the fire is lit (or was already burning comfortably) after this call.
 */
export function tendTavernFire(world: World, cookPerson: Person): boolean {
  const tavernId = world.places().find(p => p.type === 'tavern')?.id;
  if (!tavernId) return false;
  const fire = fireAt(world, tavernId);
  if (!fire) return false;
  if (!fire.lit) {
    for (const { type, qty } of IGNITE_ORDER) if (igniteFire(world, fire, cookPerson, type, qty)) return true;
    return false;
  }
  if (fire.fuelRemaining < TEND_BELOW_SECONDS) {
    for (const { type, qty } of FEED_ORDER) if (feedFire(world, fire, cookPerson, type, qty)) break;
  }
  return true;
}
