import data from './itemCollectionData.json';
import type { ItemType } from '../core/types';

/** Authored physical designs, not world instances or implemented arcane powers.
 * No presentation paths or renderer types belong in canonical content. */
export interface ItemDesign {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly category: string;
  readonly type: string;
  readonly tier: string;
  readonly description: string;
  readonly dimensions_m: Readonly<{ width: number; depth: number; height: number }>;
  readonly practical_traits: readonly string[];
  readonly abilities: readonly Readonly<{ name: string; effect: string; implementation: string; activation?: string }>[];
  readonly prototype_limitations: string;
  readonly mechanicalType: ItemType | null;
  readonly mechanicsStatus: 'existing-type-only' | 'design-only';
  readonly set_id?: string;
  readonly set_name?: string;
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
export const ITEM_DESIGNS: readonly ItemDesign[] = freezeDeep(data.items as ItemDesign[]);
export const ITEM_DESIGN_SETS = freezeDeep(data.sets);
const byId = new Map(ITEM_DESIGNS.map(d => [d.id, d]));
export function itemDesign(id: string): ItemDesign | undefined { return byId.get(id); }
