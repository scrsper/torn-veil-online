import type { Person, ItemType, Item, EventId } from '../core/types';
import type { World } from '../core/world';
import { materialOf, materialIdOf, type MaterialId } from '../core/materials';
import { affordancesOf } from '../core/affordance';
import { learnAffordance } from '../mind/knowledge';
import { practiceSkill } from '../core/skills';
import { makeItem, ITEM_LABEL } from './factory';
import { retireStack } from './stock';

/**
 * Practical crafting (v0.8 §F) — the vertical slice the roadmap names explicitly: stick +
 * suitable stone + plant fiber (binding) → stone axe. The architecture is what matters, not the
 * one recipe: `CraftingRequirement.minHardness` is a FUNCTIONAL filter read off `core/
 * materials.ts`'s real material properties, not a fixed item-type match — "functional
 * requirements → compatible components → known construction method → labor/tool skill → created
 * object," not "inventory has recipe ingredients → spawn item." A future recipe (or a smarter
 * search for "any sufficiently hard material") reuses this same matcher without new plumbing.
 */
export interface CraftingRequirement {
  /** Exact item type required (e.g. the handle must specifically be a `stick`). Omit to match
   * by material/property instead (e.g. "any sufficiently hard stone"). */
  itemType?: ItemType;
  /** Match any item made of this material (`core/materials.ts`) — the "suitable stone" case:
   * several different stone-adjacent item types could someday satisfy this, not just `'stone'`. */
  materialId?: MaterialId;
  /** Functional filter on top of `materialId` — a real property read, not a name check. */
  minHardness?: number;
  quantity: number;
}
export interface CraftingRecipe {
  id: string;
  result: ItemType;
  requires: CraftingRequirement[];
  /** What the crafter would say they're doing — the "known construction method," not a silent
   * inventory-to-item transmutation. */
  knownMethod: string;
}

export const CRAFTING_RECIPES: Record<string, CraftingRecipe> = {
  stone_axe: {
    id: 'stone_axe',
    result: 'stoneaxe',
    requires: [
      { itemType: 'stick', quantity: 1 },
      { materialId: 'stone', minHardness: 0.5, quantity: 1 },
      { materialId: 'plantFiber', quantity: 1 },
    ],
    knownMethod: 'bind a stone head to a stick handle with plant fiber',
  },
};

/** Whether `item` satisfies `req` — a real functional match (material + property), not merely
 * `item.type === req.itemType`, except where the recipe deliberately asks for an exact type
 * (the handle really must be a stick, not "anything wood-adjacent"). */
function matches(item: Item, req: CraftingRequirement): boolean {
  if (item.quantity <= 0 || item.holderId == null) return false;
  if (req.itemType) return item.type === req.itemType;
  if (req.materialId) {
    if (materialIdOf(item.type) !== req.materialId) return false;
    if (req.minHardness === undefined) return true;
    const mat = materialOf(item.type);
    return !!mat && mat.hardness >= req.minHardness;
  }
  return false;
}

export interface CraftResult { ok: boolean; missing?: CraftingRequirement[]; result?: Item; }

/**
 * Attempt to craft `recipeId`, consuming real components from `actor`'s own carried inventory
 * (never a place-stock scan — a craftsman assembles what they're holding). Fails cleanly
 * (nothing consumed) if any requirement can't be matched. On success: consumes exactly the
 * matched items/quantities, creates the result item owned by `actor`, teaches its affordance
 * (v0.7's knowledge layer — the crafter necessarily knows what they just made), and practices
 * the `crafting` skill. Conservation-respecting by construction (only ever removes matched
 * quantities, only ever adds the one result).
 */
export function craftItem(world: World, actor: Person, recipeId: string): CraftResult {
  const recipe = CRAFTING_RECIPES[recipeId];
  if (!recipe) return { ok: false };
  const carried = () => actor.inventory.map(id => world.item(id)).filter((i): i is Item => !!i);

  const consumed: { item: Item; qty: number }[] = [];
  const missing: CraftingRequirement[] = [];
  for (const req of recipe.requires) {
    let need = req.quantity;
    for (const item of carried()) {
      if (need <= 0) break;
      if (consumed.some(c => c.item.id === item.id)) continue; // don't double-spend one stack across requirements
      if (!matches(item, req)) continue;
      const take = Math.min(need, item.quantity);
      consumed.push({ item, qty: take });
      need -= take;
    }
    if (need > 0) missing.push({ ...req, quantity: need });
  }
  if (missing.length) return { ok: false, missing };

  for (const { item, qty } of consumed) {
    item.quantity -= qty;
    if (item.quantity <= 0) { actor.inventory = actor.inventory.filter(id => id !== item.id); retireStack(item); }
  }
  const ev = world.emit('item_crafted', {
    actor: actor.id, significance: 0.2,
    data: { recipeId, result: recipe.result, method: recipe.knownMethod },
    summary: `${actor.name} crafted ${ITEM_LABEL[recipe.result]}: ${recipe.knownMethod}`,
  });
  const result = makeItem(world, recipe.result, ITEM_LABEL[recipe.result], { owner: actor.id, holder: actor.id, quantity: 1 });
  result.provenance.push({ tick: world.now, eventId: ev.id, from: null, to: actor.id, how: 'crafted' });
  // v0.7 §Affordances: the crafter necessarily knows what they just made — self-taught by the
  // act of making it, the same "learning by doing" path as using any other tool for real.
  if (affordancesOf(recipe.result)) learnAffordance(world, actor, recipe.result, { type: 'self' });
  practiceSkill(actor, 'crafting', 1);
  return { ok: true, result };
}

/** Whether `actor`'s current carried inventory could satisfy `recipeId` right now, without
 * actually crafting — the cognition-facing query for "do I have what I'd need." */
export function canCraft(world: World, actor: Person, recipeId: string): boolean {
  const recipe = CRAFTING_RECIPES[recipeId];
  if (!recipe) return false;
  const items = actor.inventory.map(id => world.item(id)).filter((i): i is Item => !!i);
  const usedIds = new Set<string>();
  for (const req of recipe.requires) {
    let need = req.quantity;
    for (const item of items) {
      if (need <= 0) break;
      if (usedIds.has(item.id)) continue;
      if (!matches(item, req)) continue;
      usedIds.add(item.id);
      need -= Math.min(need, item.quantity);
    }
    if (need > 0) return false;
  }
  return true;
}
