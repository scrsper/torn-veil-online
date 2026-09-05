import type { ItemType } from './types';

/**
 * Generalized material properties (v0.8 §A) — centralized, not per-item-type special-casing.
 * Deliberately minimal: only properties this milestone's own fire/crafting systems actually
 * consume (Constitution v0.8: "only implement properties that actual v0.8 systems consume, do
 * not create dozens of unused scientific fields"). `core/tools.ts`'s existing mechanical model
 * (work multipliers, wear) is untouched — this is the semantic layer underneath it, the same
 * relationship `core/affordance.ts` (v0.7) has to `core/tools.ts`.
 */
export type MaterialId = 'wood' | 'stone' | 'plantFiber' | 'organic';

export interface MaterialDef {
  /** 0 = will not sustain ordinary fire (stone), 1 = catches and burns readily (dry kindling).
   * Read by world/fire.ts to decide what can serve as fuel and how fast it ignites/burns. */
  flammability: number;
  /** 0..1, structural rigidity/resistance to being worked — read by world/crafting.ts to filter
   * "suitable stone" (a functional requirement, not a fixed item-type match) for a tool head. */
  hardness: number;
  /** 0..1, how readily this material absorbs and holds ambient moisture — read by world/fire.ts
   * so a soaked (v0.7 `Physiology.wetness`-adjacent) or rain-exposed stock of this material is
   * harder to ignite than a sheltered one, without needing a separate wetness value per item. */
  porosity: number;
}

export const MATERIAL_DEF: Record<MaterialId, MaterialDef> = {
  wood: { flammability: 0.85, hardness: 0.3, porosity: 0.6 },
  stone: { flammability: 0, hardness: 0.9, porosity: 0.05 },
  plantFiber: { flammability: 0.95, hardness: 0.05, porosity: 0.7 },
  organic: { flammability: 0.15, hardness: 0.05, porosity: 0.5 },
};

/** What real, physical composition each item is — "materials come from somewhere," and a wood
 * wall burns differently than a stone one because it genuinely IS wood (Constitution v0.8 §B).
 * Tools with a wooden handle (axe/pickaxe/saw/hammer/stoneaxe) are tagged `wood` — their
 * dominant combustible part; a smith-forged sword/dagger has no defined material here (not yet
 * modeled — metal is an explicit v0.8/v0.9 placeholder, not silently assumed flammable OR
 * fireproof). Absent from this table = no defined material fact yet, not "immune to fire." */
export const ITEM_MATERIAL: Partial<Record<ItemType, MaterialId>> = {
  log: 'wood', plank: 'wood', stick: 'wood', axe: 'wood', pickaxe: 'wood', saw: 'wood', hammer: 'wood', stoneaxe: 'wood',
  stone: 'stone',
  herbs: 'plantFiber', flowers: 'plantFiber',
  bread: 'organic', pie: 'organic', meat: 'organic', cheese: 'organic', stew: 'organic', grain: 'organic', flour: 'organic', wheat: 'organic', ale: 'organic',
};

export function materialIdOf(type: ItemType): MaterialId | undefined {
  return ITEM_MATERIAL[type];
}
export function materialOf(type: ItemType): MaterialDef | undefined {
  const id = ITEM_MATERIAL[type];
  return id ? MATERIAL_DEF[id] : undefined;
}
