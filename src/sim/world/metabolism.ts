import type { CropPlot, CropState, Field, Item, ItemType, Person, Vec3, EntityId, EventId } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { makeItem, RESOURCE_CATEGORY, isFood, SPOIL_RATE_PER_DAY, ITEM_VALUE } from './factory';
import { addPlaceStock, takePlaceStock, retireStack, stockAt as stockAtPlace, stockTotal } from './stock';
import { eatRestoresEnergy, drinkRestoresHydration } from '../core/physiology';
import { effectivePrice } from './pricing';
import { practiceSkill } from '../core/skills';
import { learnPlace } from '../mind/knowledge';
import { remember } from '../mind/memory';

// Re-exported for existing callers/tests that import stock helpers from metabolism (v0.3 moved
// the generalized implementations to sim/world/stock.ts — Priority 1).
export { stockAt, stockItemsAt, worldStock } from './stock';
export { stockTotal, addPlaceStock, takePlaceStock } from './stock';

/**
 * World metabolism (v0.2.4): the smallest complete example of a world that materially changes
 * through time and entity actions.
 *
 *   weather → soil moisture → crop growth → mature wheat → harvest → grain
 *           → mill → flour → bake → bread → eat → hunger down
 *   water source → drink → thirst down
 *
 * Everything here is canonical simulation (owned by `World.fields` / `World` items), deterministic
 * (no RNG in the per-tick model), and player-agnostic — NPCs and the player call the same
 * `harvestPlot` / `plantPlot` / `bake` / `drinkAt` APIs.
 */

// ---- tuning (world-time hours). Legible constants, not scattered magic numbers.
/**
 * Hours from planted to mature at full soil moisture. Dry fields take proportionally longer.
 * v0.4 §14 recalibration: real-world annual crops take roughly 8-12 weeks; Torn Veil uses
 * ~2/3 of that as its gameplay-compression target (Constitution v0.4 §28), landing ordinary
 * wheat at 6 weeks — weeks, not days, so a season of farming is a real commitment rather than
 * a same-week non-event. (Was 5 world-*days* pre-v0.4 — an order of magnitude too fast to make
 * planting/harvesting timing, seed reserves, or a bad soil-moisture spell matter.)
 */
export const MATURE_HOURS = 6 * 7 * 24;
/** A harvested plot rests this long before it becomes `fallow` (replantable). */
export const REGROW_HOURS = 24;
/** Ripe wheat left standing this long lodges / rots and is lost — the plot reverts to `fallow`.
 * Keeps fields cycling (and the plant/harvest goals live) once the granary is full, rather than
 * freezing every plot at `mature` forever. */
export const SPOIL_HOURS = 6 * 24;
/** Soil moisture gained per hour of rain at intensity 1 (storm = intensity 1, rain ~0.5-0.9). */
const RAIN_MOISTURE_PER_HOUR = 0.11;
/** Soil moisture lost per hour under dry sky (scaled: clear fastest, cloudy/fog slower). A
 * multi-day clear spell drops moisture by ~0.5–0.8 and visibly slows crop growth. */
const DRY_MOISTURE_PER_HOUR = 0.035;
/** Grain produced per plot harvested (deterministic — plot index gives the small spread). */
const GRAIN_PER_PLOT_BASE = 5;
/** v0.3 Priority 13: sowing a plot now consumes seed grain, drawn from the field's own farm
 * stock. One grain per plot; a plot cannot be sown if the farm has none. */
export const SEED_PER_PLOT = 1;
/** v0.3: grain kept back at a farm as seed reserve — the logistics need generator only hauls
 * grain *above* this to the mill, so a run of harvests never leaves a farm unable to re-sow.
 * (~4 plots' worth per farm, replenished by every harvest.) */
export const FARM_SEED_RESERVE = 12;
/** Milling: grain in : flour out. Baking: flour in : bread out. Sawing: logs in : planks out. */
export const MILL_RATIO = { in: 3, out: 4 } as const;
export const BAKE_RATIO = { in: 2, out: 5 } as const;
export const SAW_RATIO = { in: 2, out: 3 } as const;
/** Stop sawing once the sawpit is holding this many planks — the first non-food transform cap. */
export const PLANK_CAP = 40;
/** Stock ceilings that make the pipeline demand-driven rather than infinite: a farmer stops
 * harvesting once the village has plenty of grain, a miller stops once there is plenty of
 * flour, a baker stops once there is plenty of bread. Production resumes when stock falls.
 * Sized so ~33 people eating ~3 meals/day are comfortably supplied with a working surplus. */
export const GRAIN_CAP = 500;
export const FLOUR_CAP = 120;
export const BREAD_CAP = 200;
/** v0.8 §A/F: herbs stop being gathered once the herbalist's own stock is comfortably ahead of
 * what crafting (world/crafting.ts's binding component) and ordinary sale could plausibly use —
 * same demand-bounded spirit as the caps above, not "infinite gathering." */
export const HERBS_CAP = 40;
/** How much one meal / one drink restores. */
export const FOOD_HUNGER_RESTORE = 0.55;
export const WATER_THIRST_RESTORE = 0.85;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- field creation
/**
 * Build one `Field` per farm `Place`, reading the farm's already-generated Farmland cells to
 * seed plot state (a `B.Wheat` cell → `mature`, anything else → `fallow`). Call once, during
 * village generation, AFTER `buildFarm` has laid the blocks. Idempotent per world.
 */
export function createFields(world: World, farmPlaceIds: { placeId: EntityId; ownerId: EntityId | null; startMoisture: number }[]): void {
  world.fields = [];
  for (const { placeId, ownerId, startMoisture } of farmPlaceIds) {
    const place = world.place(placeId); if (!place) continue;
    const b = place.bounds;
    const plots: CropPlot[] = [];
    for (let x = b.x0 + 2; x <= b.x1 - 2; x++) for (let z = b.z0 + 2; z <= b.z1 - 2; z++) {
      // `buildFarm` lays Farmland one level below the place-bounds floor; find it by scanning.
      let farmlandY = -1;
      for (let y = b.y0 + 1; y >= b.y0 - 3; y--) { if (world.grid.get(x, y, z) === B.Farmland) { farmlandY = y; break; } }
      if (farmlandY < 0) continue; // path rows / fences / edges are not plots
      const cropY = farmlandY + 1;
      const above = world.grid.get(x, cropY, z);
      const state: CropState = above === B.Wheat ? 'mature' : 'fallow';
      plots.push({ x, y: cropY, z, crop: 'wheat', state, growth: state === 'mature' ? 1 : 0, plantedAt: state === 'mature' ? world.now - MATURE_HOURS * 3600 : 0, maturedAt: state === 'mature' ? world.now : undefined });
      // normalize the block to our canonical projection (Pumpkin/other → cleared)
      world.grid.set(x, cropY, z, cropBlockFor(state));
    }
    world.fields.push({ id: world.nextId('fld'), placeId, ownerId, soilMoisture: clamp01(startMoisture), plots });
  }
}

export function cropBlockFor(state: CropState): number {
  return state === 'mature' ? B.Wheat : state === 'growing' ? B.Sprout : B.Air;
}

/** Re-project every plot's canonical state onto its voxel cell (used after load). */
export function syncFieldBlocks(world: World): void {
  for (const f of world.fields) for (const p of f.plots) world.grid.set(p.x, p.y, p.z, cropBlockFor(p.state));
}

// ---------------------------------------------------------------- per-tick model
/**
 * Advance soil moisture (from current weather) and crop growth (scaled by moisture) by
 * `hours` of world time. Deterministic. Emits only semantic transitions (`crop_matured`),
 * never a per-tick growth event. Call on a coarse cadence (~10 world-minutes) from strategic().
 */
export function stepMetabolism(world: World, hours: number): void {
  if (hours <= 0 || !world.fields.length) return;
  const wk = world.weather.kind;
  const wetting = (wk === 'rain' || wk === 'storm') ? world.weather.intensity * RAIN_MOISTURE_PER_HOUR : 0;
  const drying = wetting > 0 ? 0
    : wk === 'clear' ? DRY_MOISTURE_PER_HOUR
    : wk === 'fog' ? DRY_MOISTURE_PER_HOUR * 0.3
    : DRY_MOISTURE_PER_HOUR * 0.6; // cloudy
  for (const f of world.fields) {
    f.soilMoisture = clamp01(f.soilMoisture + (wetting - drying) * hours);
    const mf = moistureGrowthFactor(f.soilMoisture);
    for (const plot of f.plots) {
      if (plot.state === 'planted' || plot.state === 'growing') {
        plot.growth = clamp01(plot.growth + (hours / MATURE_HOURS) * mf);
        const next: CropState = plot.growth >= 1 ? 'mature' : plot.growth >= 0.15 ? 'growing' : 'planted';
        if (next !== plot.state) {
          plot.state = next;
          world.grid.set(plot.x, plot.y, plot.z, cropBlockFor(next));
          if (next === 'mature') {
            plot.maturedAt = world.now;
            world.emit('crop_matured', {
              placeId: f.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.3,
              data: { fieldId: f.id, crop: plot.crop }, summary: `Wheat ripened in ${world.nameOf(f.placeId)}`,
            });
          }
        }
      } else if (plot.state === 'harvested' && plot.harvestedAt !== undefined && world.now - plot.harvestedAt >= REGROW_HOURS * 3600) {
        plot.state = 'fallow'; plot.growth = 0;
        world.grid.set(plot.x, plot.y, plot.z, cropBlockFor('fallow'));
      } else if (plot.state === 'mature' && plot.maturedAt !== undefined && world.now - plot.maturedAt >= SPOIL_HOURS * 3600) {
        // Over-ripe wheat lodged in the field and was lost — plot reverts to fallow.
        plot.state = 'fallow'; plot.growth = 0; plot.maturedAt = undefined;
        world.grid.set(plot.x, plot.y, plot.z, cropBlockFor('fallow'));
      }
    }
  }
}

/** 0 at bone-dry, ramps to 1 by moisture ~0.45, a mild waterlogging penalty above 0.9. */
export function moistureGrowthFactor(m: number): number {
  if (m <= 0) return 0.05;
  if (m >= 0.9) return 0.85;
  return Math.min(1, 0.1 + m * 2);
}

// ---------------------------------------------------------------- farmer actions
export interface FieldWork { field: Field; plot: CropPlot; }

/** The most useful plot in a field for a given intent, or null. */
export function firstPlot(field: Field, want: 'plant' | 'harvest'): CropPlot | null {
  return field.plots.find(p => want === 'plant' ? p.state === 'fallow' : p.state === 'mature') ?? null;
}
export function fieldFor(world: World, placeId: EntityId | null | undefined): Field | undefined {
  return world.fields.find(f => f.placeId === placeId);
}

/** Grain available at a farm for sowing (its whole grain stock; the seed reserve is enforced by
 * the logistics generator, not here — a farm can sow down to its last grain if nothing hauled it away). */
export function farmSeedGrain(world: World, field: Field): number { return stockAtPlace(world, 'grain', field.placeId); }

/**
 * Sow a fallow plot. v0.3 Priority 13: consumes `SEED_PER_PLOT` grain from the field's own farm
 * stock. Returns true if sown, false (no state change) if there was no seed grain — the caller
 * then treats seed as a shortage. Fields no longer produce future grain from literally nothing.
 */
export function plantPlot(world: World, field: Field, plot: CropPlot, farmer: Person): boolean {
  if (plot.state !== 'fallow') return false;
  const took = takePlaceStock(world, 'grain', SEED_PER_PLOT, [field.placeId]);
  if (took < SEED_PER_PLOT) {
    world.emit('resource_shortage', {
      actor: farmer.id, placeId: field.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.2,
      data: { need: 'grain', reason: 'seed', have: took }, summary: `${farmer.name} had no seed grain to sow in ${world.nameOf(field.placeId)}`,
    });
    return false;
  }
  plot.state = 'planted'; plot.growth = 0; plot.plantedAt = world.now; plot.maturedAt = undefined; plot.harvestedAt = undefined;
  world.grid.set(plot.x, plot.y, plot.z, cropBlockFor('planted'));
  world.emit('crop_planted', {
    actor: farmer.id, placeId: field.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.15,
    data: { fieldId: field.id, crop: plot.crop, seed: SEED_PER_PLOT }, summary: `${farmer.name} sowed wheat in ${world.nameOf(field.placeId)}`,
  });
  return true;
}

/**
 * Harvest a mature plot: canonical state changes AND real grain is produced. No infinite
 * harvesting — the plot goes `harvested` and cannot be harvested again until it regrows.
 */
export function harvestPlot(world: World, field: Field, plot: CropPlot, farmer: Person): number {
  if (plot.state !== 'mature') return 0;
  const yield_ = GRAIN_PER_PLOT_BASE + ((plot.x + plot.z) % 4); // deterministic small spread
  plot.state = 'harvested'; plot.growth = 0; plot.harvestedAt = world.now; plot.lastYield = yield_;
  world.grid.set(plot.x, plot.y, plot.z, cropBlockFor('harvested'));
  const ev = world.emit('crop_harvested', {
    actor: farmer.id, placeId: field.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.35,
    data: { fieldId: field.id, crop: plot.crop, yield: yield_ }, summary: `${farmer.name} harvested wheat in ${world.nameOf(field.placeId)} (+${yield_} grain)`,
  });
  addPlaceStock(world, 'grain', yield_, field.placeId, field.ownerId ?? farmer.id, ev.id, 'harvested');
  return yield_;
}

// ---------------------------------------------------------------- resource transforms
const retireItem = retireStack;

export interface TransformResult { ok: boolean; produced: number; consumed: number; shortage?: ItemType; eventId?: EventId; }

/**
 * A conservation-respecting resource transformation: consume `inputQty` of `inputType` from
 * `inputPlaces`, produce `outputQty` of `outputType` at `outputPlace`. If the input is not
 * available, nothing is consumed or produced and `shortage` is set. The generic shape is what
 * later `log→plank`, `ore→ingot` reuse.
 */
export function transform(world: World, o: {
  actor: EntityId; inputType: ItemType; inputQty: number; inputPlaces: EntityId[];
  outputType: ItemType; outputQty: number; outputPlace: EntityId; ownerId: EntityId | null; how: string;
}): TransformResult {
  const available = stockTotal(world, o.inputType, o.inputPlaces);
  if (available < o.inputQty) {
    world.emit('resource_shortage', {
      actor: o.actor, placeId: o.outputPlace, significance: 0.2,
      data: { need: o.inputType, have: available, want: o.inputQty, making: o.outputType },
      summary: `${world.nameOf(o.actor)} could not make ${o.outputType}: only ${available} ${o.inputType}`,
    });
    return { ok: false, produced: 0, consumed: 0, shortage: o.inputType };
  }
  const consumed = takePlaceStock(world, o.inputType, o.inputQty, o.inputPlaces);
  const ev = world.emit('resource_transformed', {
    actor: o.actor, placeId: o.outputPlace, significance: 0.15,
    data: { from: o.inputType, fromQty: consumed, to: o.outputType, toQty: o.outputQty, how: o.how },
    summary: `${world.nameOf(o.actor)} turned ${consumed} ${o.inputType} into ${o.outputQty} ${o.outputType} (${o.how})`,
  });
  addPlaceStock(world, o.outputType, o.outputQty, o.outputPlace, o.ownerId, ev.id, o.how);
  return { ok: true, produced: o.outputQty, consumed, shortage: undefined, eventId: ev.id };
}

export function villageStock(world: World, type: ItemType): number {
  return stockTotal(world, type, world.places().map(p => p.id))
    + world.items().filter(i => i.type === type && i.holderId).reduce((a, b) => a + b.quantity, 0);
}

/**
 * One milling batch. v0.3 Priority 3: the mill consumes ONLY grain that is physically at the
 * mill (delivered there by a haul task) — it no longer reaches across the village for its
 * input. If there is no grain at the mill, `transform` fires a `resource_shortage` and a
 * logistics need to haul grain there is raised on the next upkeep pass. Still demand-driven:
 * nothing runs once the village has plenty of flour.
 */
export function mill(world: World, miller: Person): TransformResult {
  const millId = world.places().find(p => p.type === 'mill')?.id;
  if (!millId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'flour') >= FLOUR_CAP) return { ok: false, produced: 0, consumed: 0 };
  // Quiet no-op when the input simply hasn't been delivered yet — that is not a "shortage",
  // it is normal demand-driven operation, and the logistics generator already raises a haul.
  if (stockAtPlace(world, 'grain', millId) < MILL_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'grain' };
  return transform(world, { actor: miller.id, inputType: 'grain', inputQty: MILL_RATIO.in, inputPlaces: [millId], outputType: 'flour', outputQty: MILL_RATIO.out, outputPlace: millId, ownerId: miller.id, how: 'milled' });
}

/**
 * One baking batch. v0.3 Priority 3: the bakery consumes ONLY flour physically at the bakery
 * (hauled from the mill). It cannot bake from flour still sitting at the mill.
 */
export function bake(world: World, baker: Person): TransformResult {
  const bakeryId = world.places().find(p => p.type === 'bakery')?.id;
  if (!bakeryId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'bread') >= BREAD_CAP) return { ok: false, produced: 0, consumed: 0 };
  if (stockAtPlace(world, 'flour', bakeryId) < BAKE_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'flour' };
  const result = transform(world, { actor: baker.id, inputType: 'flour', inputQty: BAKE_RATIO.in, inputPlaces: [bakeryId], outputType: 'bread', outputQty: BAKE_RATIO.out, outputPlace: bakeryId, ownerId: baker.id, how: 'baked' });
  if (result.ok) practiceSkill(baker, 'baking', 1); // v0.6 §V.9: one real batch = one unit of practice
  return result;
}

/**
 * One sawing batch (v0.3): logs physically at the sawpit → planks at the sawpit. The first
 * non-food production chain, reusing the same conservation-respecting `transform`. Demand-driven
 * via a plain plank cap (no cross-module dependency on construction).
 */
export function saw(world: World, sawyer: Person): TransformResult {
  const sawpitId = world.places().find(p => p.type === 'sawpit')?.id;
  if (!sawpitId) return { ok: false, produced: 0, consumed: 0 };
  if (stockTotal(world, 'plank', [sawpitId]) >= PLANK_CAP) return { ok: false, produced: 0, consumed: 0 };
  if (stockAtPlace(world, 'log', sawpitId) < SAW_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'log' };
  const result = transform(world, { actor: sawyer.id, inputType: 'log', inputQty: SAW_RATIO.in, inputPlaces: [sawpitId], outputType: 'plank', outputQty: SAW_RATIO.out, outputPlace: sawpitId, ownerId: sawyer.id, how: 'sawn' });
  if (result.ok) practiceSkill(sawyer, 'sawing', 1);
  return result;
}

/**
 * v0.6 §II: `ale`/`meat`/`cheese` have no modeled ingredient chain (unlike grain→flour→bread) —
 * they were only ever seeded once at village generation with no restock, which meant every
 * occupation whose schedule eats at the tavern (smith, apprentice, captain, guard) permanently
 * ran out of anything to buy there after the first day or two, and fell back to an increasingly
 * bare household larder. Measured directly (seed 918271, 8 days, pre-fix): 695 failed
 * food-seeking attempts against only 486 successful meals village-wide — a genuine "economic
 * access" cause of elevated hunger (Constitution v0.6 §II), not merely a tolerance-model
 * artifact. This is the same abstraction level the game already uses for these background food
 * types (no inputs consumed, exactly like their original one-time seeding) — the innkeeper
 * keeping the larder stocked while working, not a new production chain.
 */
export const ALE_RESTOCK_TRIGGER = 8;
const ALE_RESTOCK_QTY = 6;
/** v0.7 §B (found via this milestone's own new circulation instrumentation, not anticipated
 * going in): restocking used to be entirely free — real currency flowed IN every time an ale
 * was sold (buyFoodPortion), but never OUT, because nothing was ever spent to replace the stock.
 * Over a long run this makes the tavern a one-way wealth sink rather than a circulating business:
 * measured directly (seed 918271, headless, pre-fix) — the innkeeper pair's share of total
 * village wealth climbed monotonically from 7.9% (8 days) to 36.8% (30 days) to 59.1% (90 days),
 * silently starving every other occupation (including the ones §A's wholesale-trade fix just
 * gave real income to) despite total village wealth staying roughly conserved.
 *
 * TWO earlier attempts at a fix (flat 1/unit, then `ITEM_VALUE.ale - 0.1`) both charged a
 * POSITIVE per-unit margin below ale's flat retail price and were validated only by checking
 * that a 90-day benchmark's wealth-share number looked small. Both are wrong for the same
 * structural reason: `ale` has no scarcity-based pricing (`world/pricing.ts`'s
 * `PRICE_REFERENCE_STOCK` doesn't include it, so `effectivePrice` always returns the flat
 * `ITEM_VALUE.ale`) — restocking runs on its own stock-trigger cadence, entirely decoupled from
 * how often a unit actually sells. ANY positive margin per unit therefore compounds linearly
 * with the number of restock cycles, which itself grows without bound as the run gets longer —
 * "58.1% instead of 59.1%" was never a fix, only a slower version of the same unbounded sink,
 * and tuning the margin further would only be tuning the SPEED of an uncapped accumulation
 * until a chosen benchmark window happened to look flat. That is exactly the "calibrate until
 * the graph looks right" trap this project's own Constitution (`no unexplained wealth
 * creation`, `currency must remain auditable`) rules out.
 *
 * The structurally correct fix sets the supply cost EXACTLY equal to ale's flat retail price
 * (`ITEM_VALUE.ale`), not a margin below it. This is not a tuning choice — it is the same
 * number effectivePrice already always returns for ale, made explicit in both directions. With
 * cost-per-unit-restocked == price-per-unit-sold, by construction:
 *
 *   net wealth the innkeeper accumulates from ale trading
 *   = ITEM_VALUE.ale × (units restocked − units sold)
 *   = ITEM_VALUE.ale × (ale currently sitting unsold in the tavern's own stock)
 *
 * which is bounded by the tavern's own small stock cap (`ALE_RESTOCK_TRIGGER`/`ALE_RESTOCK_QTY`,
 * a handful of units) REGARDLESS OF RUN LENGTH — not merely small at the specific horizons this
 * project happens to have benchmarked. `tests/ale-supply-invariant.test.ts` proves this
 * directly (net wealth change is unchanged whether the restock/sell cycle runs 5 times or 500),
 * not by asserting a specific wealth percentage.
 *
 * What this still abstracts, explicitly: there is no modeled brewer NPC, grain-to-ale
 * production chain, or real upstream supplier entity — `ale` continues to enter the simulation
 * from an unmodeled "outside source," exactly as bread/meat/cheese already do for other trades
 * this game hasn't built ingredient chains for. This function represents that abstraction as a
 * literal pass-through cost of goods (buy at the same flat price it's later sold for) rather
 * than inventing either a fabricated profit margin or a fabricated production chain. Building a
 * real upstream ale economy (a brewer, grain demand, a modeled cellar) remains legitimate
 * FOLLOW-UP work, not something this fix should quietly half-implement. This is an explicit
 * currency EXIT during restocking and an explicit currency ENTRY during sale (Constitution
 * "if currency enters or exits the simulation, that must be explicit") — both tracked
 * (`world.runTally.supply_cost_amount`) for auditability. */
const ALE_SUPPLY_COST_PER_UNIT = ITEM_VALUE.ale;
export function restockTavern(world: World, innkeeper: Person): boolean {
  const tavernId = world.places().find(p => p.type === 'tavern')?.id;
  if (!tavernId) return false;
  if (stockAtPlace(world, 'ale', tavernId) >= ALE_RESTOCK_TRIGGER) return false;
  const cost = Math.round(Math.max(0, Math.min(ALE_RESTOCK_QTY * ALE_SUPPLY_COST_PER_UNIT, innkeeper.wealth)) * 100) / 100;
  innkeeper.wealth -= cost;
  world.runTally.supply_cost_amount = (world.runTally.supply_cost_amount ?? 0) + cost;
  const ev = world.emit('resource_transformed', {
    actor: innkeeper.id, placeId: tavernId, significance: 0.05,
    data: { from: 'larder', fromQty: 0, to: 'ale', toQty: ALE_RESTOCK_QTY, how: 'restocked', cost },
    summary: `${innkeeper.name} brought up fresh ale from the cellar${cost > 0 ? ` (paid ${cost} silver for supplies)` : ''}`,
  });
  addPlaceStock(world, 'ale', ALE_RESTOCK_QTY, tavernId, innkeeper.id, ev.id, 'restocked');
  return true;
}

/**
 * v0.8 §A/F: `herbs` (core/materials.ts's `plantFiber`) had a real `ItemType`/value/category
 * entry since v0.1 but no production path anywhere — pure flavor, never actually obtainable
 * (confirmed by a full-codebase search before writing this). This gives the herbalist a real,
 * bounded gathering loop at her own workplace — the same `restockTavern`-shaped pattern (a
 * background stock top-up while working, gated by a demand cap, no modeled sub-ingredient chain
 * because none is needed for "gather what's growing nearby") — closing a genuine "materials come
 * from somewhere" gap AND giving world/crafting.ts's binding component (stick + suitable stone +
 * herbs → stone axe) a real physical source instead of spawning from nowhere.
 */
const HERB_GATHER_TRIGGER = 16;
const HERB_GATHER_QTY = 4;
export function gatherHerbs(world: World, herbalist: Person): boolean {
  const placeId = herbalist.workId;
  if (!placeId) return false;
  if (stockAtPlace(world, 'herbs', placeId) >= Math.min(HERB_GATHER_TRIGGER, HERBS_CAP)) return false;
  const ev = world.emit('resource_extracted', {
    actor: herbalist.id, placeId, significance: 0.05,
    data: { kind: 'herb', yield: 'herbs', amount: HERB_GATHER_QTY },
    summary: `${herbalist.name} gathered ${HERB_GATHER_QTY} bundles of herbs`,
  });
  addPlaceStock(world, 'herbs', HERB_GATHER_QTY, placeId, herbalist.id, ev.id, 'gathered');
  practiceSkill(herbalist, 'herbalism', 1);
  return true;
}

/**
 * v0.8 §D (found via this milestone's own 90-day headless benchmark, not anticipated going in):
 * `meat`, like `ale`/`cheese` before v0.6 §II, was only ever seeded once at village generation
 * with no restock — Kestrel's stall never replenished, so the tavern's new haul demand (added
 * to give `cook()` a real input at all) only ever moved the original one-time-seeded stock, and
 * `cook()` — fully correct in isolation and gated on genuine fire — could only ever succeed once
 * in an entire 90-day run regardless of the tavern's own buffer size. Same "no modeled ingredient
 * chain" abstraction already used for ale, but built from the start with the corrected,
 * near-break-even-margin shape v0.7 §B's own follow-up fix required for ale (a naively free
 * restock is a real wealth sink the moment currency flows in from retail sales with nothing
 * flowing out) — not repeating that mistake a second time now that it's understood.
 */
const MEAT_RESTOCK_TRIGGER = 6;
const MEAT_RESTOCK_QTY = 4;
const MEAT_MARGIN_PER_UNIT = 0.5;
const MEAT_SUPPLY_COST_PER_UNIT = ITEM_VALUE.meat - MEAT_MARGIN_PER_UNIT;
export function huntGame(world: World, hunter: Person): boolean {
  const stallId = world.places().find(p => p.slug === 'stall_game')?.id;
  if (!stallId) return false;
  if (stockAtPlace(world, 'meat', stallId) >= MEAT_RESTOCK_TRIGGER) return false;
  const cost = Math.round(Math.max(0, Math.min(MEAT_RESTOCK_QTY * MEAT_SUPPLY_COST_PER_UNIT, hunter.wealth)) * 100) / 100;
  hunter.wealth -= cost;
  world.runTally.supply_cost_amount = (world.runTally.supply_cost_amount ?? 0) + cost;
  const ev = world.emit('resource_transformed', {
    actor: hunter.id, placeId: stallId, significance: 0.05,
    data: { from: 'wilderness', fromQty: 0, to: 'meat', toQty: MEAT_RESTOCK_QTY, how: 'hunted', cost },
    summary: `${hunter.name} brought back fresh game${cost > 0 ? ` (spent ${cost} silver on gear and provisions)` : ''}`,
  });
  addPlaceStock(world, 'meat', MEAT_RESTOCK_QTY, stallId, hunter.id, ev.id, 'hunted');
  return true;
}

// ---------------------------------------------------------------- eating & drinking
/**
 * Find a food item this person can legitimately eat: their own inventory first, then unheld
 * food at their current position's place / their home, owned by them, the place, or nobody —
 * OR, at home only, food a fellow household member is actually carrying (v0.6 §II). Real
 * families eat from what whoever went to market brought back, not only a communal bowl on the
 * table; without this, anyone who cannot personally earn/spend (a child, wealth 0) had no path
 * to food at all once the one-time starting larder ran out, even while a parent was walking
 * around with bought bread in their own pack the whole time. Bounded to household members who
 * are physically AT home right now (never a phantom village-wide pantry). Never conjures food
 * from nowhere — this only widens WHOSE existing stock counts as accessible, exactly like the
 * place-owner/household checks below already do for placed (not carried) food.
 */
export function findAccessibleFood(world: World, p: Person, atPlaceId: EntityId | null): Item | null {
  const carried = p.inventory.map(id => world.item(id)).find(i => !!i && isFood(i.type) && i.quantity > 0);
  if (carried) return carried;
  const scan = (placeId: EntityId | null | undefined, isHome: boolean): Item | null => {
    if (!placeId) return null;
    const place = world.place(placeId);
    const household = isHome ? new Set(place?.residents ?? []) : new Set<EntityId>();
    const okOwner = (i: Item) => i.ownerId == null || i.ownerId === p.id || i.ownerId === place?.ownerId || household.has(i.ownerId);
    const placed = world.items().find(i => i.placeId === placeId && !i.holderId && isFood(i.type) && i.quantity > 0 && okOwner(i));
    if (placed) return placed;
    if (isHome && household.size) {
      for (const residentId of household) {
        if (residentId === p.id) continue;
        const resident = world.person(residentId);
        if (!resident || !resident.alive) continue;
        const residentBody = world.primaryBody(residentId);
        if (!residentBody || world.placeAt(residentBody.pos)?.id !== placeId) continue;
        const held = resident.inventory.map(id => world.item(id)).find(i => !!i && isFood(i.type) && i.quantity > 0);
        if (held) return held;
      }
    }
    return null;
  };
  return scan(atPlaceId, atPlaceId === p.homeId) ?? scan(p.homeId, true);
}

/**
 * Buy up to `n` units of a food item from its owner, paying from `wealth` (the existing
 * economic system — most villagers carry no coin item). The units become a carried stack in
 * the buyer's inventory, so one trip to the baker/market stocks several meals and the village
 * does not funnel every hungry person to one counter every few hours. Conservation of money
 * and of food. Returns the buyer's new carried food stack, or null if unaffordable/unavailable.
 */
export function buyFoodPortion(world: World, buyer: Person, forSale: Item, n: number): Item | null {
  const seller = forSale.ownerId ? world.person(forSale.ownerId) : undefined;
  if (!seller || !seller.alive || forSale.holderId || forSale.quantity <= 0) return null;
  // v0.5 §V: the price responds to how scarce this resource currently is AT THIS PLACE — bounded,
  // deterministic (world/pricing.ts), never a flat constant regardless of supply anymore.
  const stockHere = forSale.placeId ? stockAtPlace(world, forSale.type, forSale.placeId) : forSale.quantity;
  const unit = effectivePrice(forSale.type, forSale.value ?? 2, stockHere);
  // v0.4 §12/§22: a buyer can never spend money they don't have — affordability genuinely
  // floors at 0 units, not 1 (the pre-v0.4 `Math.max(1, ...)` here forced a sale, and therefore
  // negative buyer wealth, whenever they couldn't afford even a single unit).
  const affordable = Math.floor(buyer.wealth / unit);
  if (affordable <= 0) return null;
  const take = Math.min(n, forSale.quantity, affordable);
  if (take <= 0) return null;
  const cost = take * unit;
  const boughtAtPlaceId = forSale.placeId ?? undefined;
  buyer.wealth -= cost; seller.wealth += cost;
  world.runTally.purchase_amount = (world.runTally.purchase_amount ?? 0) + cost;
  forSale.quantity -= take;
  if (forSale.quantity <= 0) { forSale.pos = null; forSale.placeId = null; }
  const carried = buyer.inventory.map(id => world.item(id)).find(i => !!i && i.type === forSale.type && i.holderId === buyer.id);
  const ev = world.emit('trade', {
    actor: seller.id, target: buyer.id, item: forSale.id, pos: world.primaryBody(buyer.id)?.pos, placeId: forSale.placeId ?? undefined,
    significance: 0.1, data: { price: cost, qty: take, food: forSale.type },
    summary: `${seller.name} sold ${take} ${forSale.type} to ${buyer.name} for ${cost} silver`,
  });
  // v0.4 §12: a semantic 'purchase_made' record, distinct from the generic 'trade' event, so a
  // headless run can report "currency transferred in purchases" without conflating it with
  // gifts/theft/other 'trade'-shaped events. Conserves currency and item quantity by
  // construction (buyer.wealth/seller.wealth and forSale.quantity above are the only writes).
  world.emit('purchase_made', {
    actor: buyer.id, target: seller.id, item: forSale.id, pos: world.primaryBody(buyer.id)?.pos, placeId: forSale.placeId ?? undefined,
    significance: 0.02, data: { amount: cost, qty: take, item: forSale.type },
    summary: `${buyer.name} bought ${take} ${forSale.type} from ${seller.name} for ${cost} silver`,
  });
  // v0.6 §III.3: economic observation — a successful purchase is first-hand evidence this place
  // sells food, and (§IV.4) a memory of it, so a later hunger decision can prefer a source that
  // has actually worked before (mind/agent.ts's `knownFoodPlace`) over one that hasn't.
  if (isFood(forSale.type) && boughtAtPlaceId) {
    const place = world.place(boughtAtPlaceId);
    if (place) learnPlace(world, buyer, place, { type: 'self' });
    remember(world, buyer, { type: 'purchase', summary: `I bought ${forSale.type} at ${world.nameOf(boughtAtPlaceId)}`, entities: [seller.id], significance: 0.15, valence: 0.2, source: { type: 'self' }, placeId: boughtAtPlaceId });
  }
  if (carried) { carried.quantity += take; carried.provenance.push({ tick: world.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'bought' }); return carried; }
  const stack = makeItem(world, forSale.type, forSale.name, { owner: buyer.id, holder: buyer.id, quantity: take, value: forSale.value });
  stack.provenance.push({ tick: world.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'bought' });
  return stack;
}

/** Consume one unit of a food item and restore caloric energy (v0.4: `needs.hunger` is now
 * derived FROM the physiology reserve this restores — see core/physiology.ts's `syncNeeds` —
 * rather than being decremented directly). Returns the eaten item type, or null. */
export function eatFood(world: World, p: Person, food: Item): ItemType {
  food.quantity -= 1;
  if (food.quantity <= 0) {
    // v0.6 §II: `food` may be a fellow household member's carried stack (see
    // `findAccessibleFood`), not necessarily `p`'s own — clean up whoever actually holds it,
    // not just `p`, so a shared family meal never leaves a stale item id in someone else's
    // inventory pointing at a retired item.
    if (food.holderId) { const holder = world.person(food.holderId); if (holder) holder.inventory = holder.inventory.filter(id => id !== food.id); }
    retireItem(food);
  }
  eatRestoresEnergy(p, FOOD_HUNGER_RESTORE);
  world.emit('food_consumed', {
    actor: p.id, item: food.id, pos: world.primaryBody(p.id)?.pos, significance: 0.1,
    data: { food: food.type, hunger: Math.round(p.needs.hunger * 100) / 100 },
    summary: `${p.name} ate ${RESOURCE_CATEGORY[food.type] === 'food' ? food.type : 'food'}`,
  });
  return food.type;
}

/** Canonical water sources: the `well`-type Places (the village well, and a river-bank draw
 * near the mill). Cheap — a scan over ~2 Places, no per-tile grid probing. */
export function nearestWaterSource(world: World, pos: Vec3): { pos: Vec3; placeId?: EntityId } | null {
  let best: { pos: Vec3; placeId?: EntityId } | null = null; let bd = Infinity;
  for (const pl of world.ofKind<import('../core/types').Place>('place')) {
    if (pl.type !== 'well') continue;
    const d = Math.hypot(pl.inside.x - pos.x, pl.inside.z - pos.z);
    if (d < bd) { bd = d; best = { pos: { ...pl.inside }, placeId: pl.id }; }
  }
  return best;
}

export function drinkAt(world: World, p: Person, sourcePlaceId?: EntityId): void {
  drinkRestoresHydration(p, WATER_THIRST_RESTORE);
  world.emit('water_consumed', {
    actor: p.id, placeId: sourcePlaceId, pos: world.primaryBody(p.id)?.pos, significance: 0.08,
    data: { thirst: Math.round(p.needs.thirst * 100) / 100 },
    summary: `${p.name} drank${sourcePlaceId ? ' at ' + world.nameOf(sourcePlaceId) : ''}`,
  });
}

// ---------------------------------------------------------------- spoilage (v0.3 Priority 14, recalibrated v0.4 §14)
/**
 * Advance stock spoilage by `hours` of world time. Stack-level batched: each perishable stack
 * accumulates fractional loss between passes and drops whole units when the accumulator crosses
 * 1 — no per-item-per-minute work, no event storm (at most one `resource_spoiled` per stack per
 * pass). Deterministic. Call on the coarse upkeep cadence.
 *
 * v0.4 §14: each perishable DELIVERY is now its own stack (see world/stock.ts's
 * `addPlaceStock`), so a stack's own age is real and a fresh delivery merged conceptually into
 * "the pile" no longer inherits — nor imposes — another batch's accumulated spoilage risk. The
 * known v0.3 limitation (replenishing a stack silently reset/skewed its effective spoilage
 * pressure because the same accumulator then scaled against a larger post-merge quantity) is
 * fixed by this batch separation, not by changing the math below (which was already correct
 * per-stack — the bug was upstream, in what got merged into what).
 */
export function stepSpoilage(world: World, hours: number): void {
  if (hours <= 0) return;
  const days = hours / 24;
  for (const it of world.items()) {
    const rate = SPOIL_RATE_PER_DAY[it.type];
    if (!rate || it.quantity <= 0) continue;
    it.spoilAccum = (it.spoilAccum ?? 0) + it.quantity * rate * days;
    if (it.spoilAccum < 1) continue;
    const lost = Math.min(it.quantity, Math.floor(it.spoilAccum));
    it.spoilAccum -= lost;
    it.quantity -= lost;
    if (lost > 0) {
      world.emit('resource_spoiled', {
        placeId: it.placeId ?? undefined, item: it.id, pos: it.pos ?? undefined, significance: 0.1,
        data: { resource: it.type, lost, remaining: it.quantity },
        summary: `${lost} ${it.type} spoiled${it.placeId ? ' at ' + world.nameOf(it.placeId) : it.holderId ? ` in ${world.nameOf(it.holderId)}'s pack` : ''}`,
      });
    }
    if (it.quantity <= 0) retireItem(it);
  }
}

// ---------------------------------------------------------------- observability
export interface MetabolismSummary {
  fields: number;
  avgSoilMoisture: number;
  crops: Record<CropState, number>;
  avgGrowth: number;
  stock: { grain: number; flour: number; bread: number };
  avgHunger: number; avgThirst: number;
}
export function metabolismSummary(world: World): MetabolismSummary {
  const crops: Record<CropState, number> = { fallow: 0, planted: 0, growing: 0, mature: 0, harvested: 0 };
  let growthSum = 0, growthN = 0, moistSum = 0;
  for (const f of world.fields) {
    moistSum += f.soilMoisture;
    for (const p of f.plots) { crops[p.state]++; if (p.state === 'planted' || p.state === 'growing') { growthSum += p.growth; growthN++; } }
  }
  const anywhere = world.places().map(p => p.id);
  const alive = world.persons().filter(p => p.alive && !p.controlled);
  return {
    fields: world.fields.length,
    avgSoilMoisture: world.fields.length ? Math.round((moistSum / world.fields.length) * 1000) / 1000 : 0,
    crops,
    avgGrowth: growthN ? Math.round((growthSum / growthN) * 1000) / 1000 : 0,
    stock: {
      grain: stockTotal(world, 'grain', anywhere),
      flour: stockTotal(world, 'flour', anywhere),
      bread: stockTotal(world, 'bread', anywhere) + world.items().filter(i => i.type === 'bread' && i.holderId).reduce((a, b) => a + b.quantity, 0),
    },
    avgHunger: alive.length ? Math.round((alive.reduce((a, p) => a + p.needs.hunger, 0) / alive.length) * 1000) / 1000 : 0,
    avgThirst: alive.length ? Math.round((alive.reduce((a, p) => a + p.needs.thirst, 0) / alive.length) * 1000) / 1000 : 0,
  };
}
