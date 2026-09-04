import type { ItemType } from '../core/types';

/**
 * Bounded supply/demand-responsive pricing (v0.5 §V) — the first dynamic prices in Torn Veil.
 * Deliberately NOT a market: no order books, no bargaining, no credit. Just an inventory-
 * pressure modifier on the existing flat base price (`ITEM_VALUE`, world/factory.ts):
 *
 *   effective price = base price × scarcity modifier(current stock / a reference stock level)
 *
 * abundant -> somewhat cheaper, normal -> near base price, scarce -> more expensive, extremely
 * scarce -> substantially more expensive, but always bounded (Constitution v0.5 §17: "no
 * exponential runaway... keep prices understandable and deterministic").
 */

/** Reference "comfortable" stock level per resource type, used only to gauge scarcity — NOT any
 * one consumer's own target (keeps this module free of a dependency on world/production.ts or
 * logistics/haul.ts, so pricing stays a small, independently testable mechanism). */
const PRICE_REFERENCE_STOCK: Partial<Record<ItemType, number>> = {
  bread: 40, flour: 60, grain: 250,
};

/** Bounded [0.65, 2.2]. Linear either side of 1.0 at ratio=1 (stock at the reference level) —
 * continuous, deterministic, no exponential term. */
export function scarcityModifier(stock: number, reference: number): number {
  if (reference <= 0) return 1;
  const ratio = Math.max(0, stock / reference);
  if (ratio >= 1.5) return 0.65;
  if (ratio >= 1) return 1 - (ratio - 1) * 0.7; // 1.0 (at reference) .. 0.65 (1.5x reference)
  return 1 + (1 - ratio) * 1.2; // 1.0 (at reference) .. 2.2 (empty)
}

/** The price a buyer actually pays for one unit of `type`, given `stock` currently at the
 * seller's Place. Falls back to the plain base price for any type without a reference level
 * (most items — v0.5 only prices the food chain). Never negative or zero. */
export function effectivePrice(type: ItemType, basePrice: number, stock: number): number {
  const reference = PRICE_REFERENCE_STOCK[type];
  if (reference === undefined) return Math.max(1, Math.round(basePrice));
  return Math.max(1, Math.round(basePrice * scarcityModifier(stock, reference)));
}
