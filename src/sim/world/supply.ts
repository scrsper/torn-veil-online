import type { ItemType, Occupation } from '../core/types';

/**
 * WHO MAKES WHAT, AND OUT OF WHAT — the small table of publicly visible trades (Causal Society).
 *
 * This is not new economic scope: every relationship in it is already implemented somewhere in
 * `world/metabolism.ts` (`mill`, `bake`, `saw`, `cook`, `huntGame`, `gatherHerbs`) and in
 * `logistics/haul.ts`'s `CONSUMER_DEMANDS`. What did not exist was any way for a MIND to reach
 * that structure. Before this, "the bakery has no flour" and "the miller has not been seen for
 * two days" were two unrelated facts in the same knowledge map, because nothing in the
 * simulation said that flour is what a miller makes.
 *
 * It is deliberately expressed over OCCUPATIONS and RESOURCE TYPES rather than over individuals
 * or specific places, because that is the part of it a villager genuinely knows: which trade a
 * neighbour plies is as public as their face, and what a miller does is common knowledge. It
 * never names a person, and holding it does not tell anybody WHERE any particular stock is or
 * WHO is currently short — those remain things a mind has to actually find out.
 *
 * Used in exactly two places: `social/appraisal.ts` (does this shortage touch my livelihood?)
 * and `mind/inference.ts` (whose absence could explain this stoppage?).
 *
 * CONSTITUTION §IX ("capability over labels") — read this before extending it. This table is a
 * DESCRIPTION of mechanics that live elsewhere, not a replacement for them. Nothing here decides
 * what anybody can physically do: `world/metabolism.ts`'s `mill`/`bake`/`saw`, `world/cooking.ts`'s
 * `cook` and `core/attributes.ts`'s capability model remain the sole authorities on that, and a
 * person with the wrong occupation who nonetheless has grain and a mill is not stopped by this
 * file. What it summarises is what a VILLAGER would say if asked where flour comes from.
 *
 * Because it is a description, it can drift out of step with what it describes.
 * `tests/causal-society.test.ts`'s "the trades table describes the mechanics it claims to" drives
 * the real transforms with empty inputs and asserts that the material each one actually reports
 * missing is the material this table says that trade needs.
 */

/** What a trade turns out, when it is working. */
export const TRADE_MAKES: Partial<Record<Occupation, ItemType[]>> = {
  miller: ['flour'],
  baker: ['bread'],
  cook: ['stew'],
  farmer: ['grain', 'wheat'],
  hunter: ['meat'],
  herbalist: ['herbs'],
  woodcutter: ['log', 'plank'],
  innkeeper: ['ale'],
  smith: ['sword', 'dagger', 'axe', 'hammer'],
};

/** What a trade consumes to do that. A trade with no entry lives off what it gathers. */
export const TRADE_NEEDS: Partial<Record<Occupation, ItemType[]>> = {
  miller: ['grain'],
  baker: ['flour'],
  cook: ['meat', 'log'],
  woodcutter: ['log'],
  smith: ['stone'],
};

/** The trades a villager would name if asked where `resource` comes from. */
export function tradesThatMake(resource: ItemType): Occupation[] {
  const out: Occupation[] = [];
  for (const [occ, made] of Object.entries(TRADE_MAKES)) if (made?.includes(resource)) out.push(occ as Occupation);
  return out;
}

/** The trades that cannot work without `resource`. */
export function tradesThatNeed(resource: ItemType): Occupation[] {
  const out: Occupation[] = [];
  for (const [occ, needed] of Object.entries(TRADE_NEEDS)) if (needed?.includes(resource)) out.push(occ as Occupation);
  return out;
}

/** True if this person's own trade cannot be carried out without `resource`. */
export function tradeNeeds(occupation: Occupation, resource: ItemType): boolean {
  return TRADE_NEEDS[occupation]?.includes(resource) ?? false;
}

/** True if this person's own trade is one of the ones that produces `resource`. */
export function tradeMakes(occupation: Occupation, resource: ItemType): boolean {
  return TRADE_MAKES[occupation]?.includes(resource) ?? false;
}
