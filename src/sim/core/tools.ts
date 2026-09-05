import type { Item, ItemType, Person } from './types';
import type { World } from './world';

/**
 * Tools as functional simulation objects (v0.4 §5), not cosmetic equipment. Each tool supports
 * a small set of physical actions and materially changes how well they can be performed —
 * `bestToolFor` is the one place that decides "does this person have what they need," so a
 * future magical substitute (an enchanted axe, a spell, a supernatural body) only has to
 * satisfy the same lookup (Constitution v0.4 §17: capability-based, not
 * `inventory.includes('axe')`).
 */
export type ToolAction = 'chop' | 'quarry' | 'saw' | 'construct';
export const TOOL_KINDS: ItemType[] = ['axe', 'pickaxe', 'saw', 'hammer', 'stoneaxe'];

interface ToolDef {
  supports: ToolAction[];
  /** Work multiplier at full (1.0) condition, applied on top of the bare-handed baseline. */
  workMultiplier: number;
  massKg: number;
}
const TOOL_DEF: Record<'axe' | 'pickaxe' | 'saw' | 'hammer' | 'stoneaxe', ToolDef> = {
  axe: { supports: ['chop'], workMultiplier: 5, massKg: 2 },
  pickaxe: { supports: ['quarry'], workMultiplier: 6, massKg: 3 },
  saw: { supports: ['saw'], workMultiplier: 4, massKg: 1.5 },
  hammer: { supports: ['construct'], workMultiplier: 1.6, massKg: 1.5 },
  // v0.8 §F: a real, weaker tool — genuinely useful (well above bare-handed), but a smith-forged
  // axe still wins `bestToolFor`'s own score comparison whenever both are available, exactly as
  // a hand-bound stone head should compare to a proper forged one. No special-casing needed —
  // `bestToolFor`'s `workMultiplier * condition` scoring already prefers the better tool.
  stoneaxe: { supports: ['chop'], workMultiplier: 2.4, massKg: 2.2 },
};

/** What a bare-handed (or wrong-tool) worker can still manage, as a fraction of the
 * full-tool rate. Never zero — an improvised action is always physically POSSIBLE, just far
 * less effective (Constitution v0.4 §5 "avoid overly punitive hard gates"): felling a mature
 * tree by hand is unrealistic, but gathering fallen wood/breaking loose rock by hand is not. */
const BAREHANDED_MULTIPLIER: Record<ToolAction, number> = { chop: 0.16, quarry: 0.1, saw: 0.22, construct: 0.55 };

/** Work slowly reduces tool condition (0..1, `Item.condition`, default 1). Deliberately slow —
 * a tool used continuously for the ~40 hours of one construction project loses ~4% condition. */
const WEAR_PER_WORK_HOUR = 0.001;
/** Below this condition a tool's own multiplier starts tapering toward the bare-handed rate
 * (a worn-out axe is still better than nothing, just not much). */
const WORN_THRESHOLD = 0.35;

function toolKind(it: Item): 'axe' | 'pickaxe' | 'saw' | 'hammer' | 'stoneaxe' | null {
  return (TOOL_KINDS as string[]).includes(it.type) ? (it.type as 'axe' | 'pickaxe' | 'saw' | 'hammer' | 'stoneaxe') : null;
}

/**
 * The best tool this person can use for `action` right now: one they are carrying, or one
 * physically present (unheld) at their current place — a shared worksite tool (the sawpit's
 * saw, the quarry's pickaxes) that does not need to be personally owned to be used in place.
 * Extension point for future ownership/borrowing/theft (v0.4 §5): this is the only place that
 * needs to change to require personal possession instead.
 */
export function bestToolFor(world: World, p: Person, action: ToolAction, atPlaceId?: string | null): Item | null {
  let best: Item | null = null; let bestScore = -1;
  const consider = (it: Item) => {
    const kind = toolKind(it); if (!kind) return;
    if (!TOOL_DEF[kind].supports.includes(action)) return;
    const score = TOOL_DEF[kind].workMultiplier * (it.condition ?? 1);
    if (score > bestScore) { bestScore = score; best = it; }
  };
  for (const id of p.inventory) { const it = world.item(id); if (it) consider(it); }
  if (atPlaceId) for (const it of world.items()) if (it.placeId === atPlaceId && !it.holderId) consider(it);
  return best;
}

/** The work multiplier a tool (or its absence) grants for `action`, folding in condition. */
export function toolWorkMultiplier(action: ToolAction, tool: Item | null): number {
  if (!tool) return BAREHANDED_MULTIPLIER[action];
  const kind = toolKind(tool); if (!kind) return BAREHANDED_MULTIPLIER[action];
  const cond = tool.condition ?? 1;
  const conditionFactor = cond >= WORN_THRESHOLD ? 1 : Math.max(0.3, cond / WORN_THRESHOLD);
  return BAREHANDED_MULTIPLIER[action] + (TOOL_DEF[kind].workMultiplier - BAREHANDED_MULTIPLIER[action]) * conditionFactor;
}

/** Wear a tool by `hours` of the work it was just used for. No-op for a null/non-tool item. */
export function wearTool(world: World, tool: Item | null, hours: number): void {
  if (!tool || hours <= 0) return;
  const kind = toolKind(tool); if (!kind) return;
  const before = tool.condition ?? 1;
  tool.condition = Math.max(0, before - WEAR_PER_WORK_HOUR * hours);
  if (before > 0 && tool.condition <= 0) {
    world.emit('tool_broke', { item: tool.id, placeId: tool.placeId ?? undefined, pos: tool.pos ?? undefined, significance: 0.15, data: { type: tool.type }, summary: `${tool.name} broke from wear` });
  }
}

export const TOOL_MASS_KG: Partial<Record<ItemType, number>> = { axe: 2, pickaxe: 3, saw: 1.5, hammer: 1.5, stoneaxe: 2.2 };
