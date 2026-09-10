import { payWage } from '../core/requests';
import { fireIntensityAt } from './fire';
import { economicOperatorFor } from './trade';
import { nearestAvailableNode, extractFromNode } from './resources';
import { localPlaces, near, placeForPerson } from './locality';
import type { CropPlot, CropState, Field, Item, ItemType, Person, Vec3, EntityId, EventId, PlaceType } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { makeItem, RESOURCE_CATEGORY, isFood, isPerishable, SPOIL_RATE_PER_DAY, ITEM_VALUE } from './factory';
import { addPlaceStock, takePlaceStock, retireStack, stockAt as stockAtPlace, stockTotal } from './stock';
import { eatRestoresEnergy, drinkRestoresHydration } from '../core/physiology';
import { purchaseUnits, unitPriceFor, willingnessFor } from './commerce';
import { householdOwns, householdOf, householdMembers } from './household';
import { practiceSkill, skillOf, tradeYield } from '../core/skills';
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
/** v0.8 §P1 (independent audit §3.4/§8 P2-D): the old flat `PLANK_CAP = 40` had no relationship
 * to actual demand — measured directly, one storage-shed project needed 16 planks total, so a
 * flat cap of 40 meant sawing ran to roughly 2.5x real demand every cycle, consuming ~36 of the
 * world's 84 lifetime logs to fill a buffer nothing had asked for (this project's entire
 * standing timber budget is ~2.3 sheds at real demand — see `resources.ts`'s regrow-horizon doc
 * comment; wasting two-thirds of a felled tree on an oversized buffer is the actual problem, not
 * the multi-year regrow time). A small flat floor remains (so sawing can still get ahead of a
 * FRESH project before its deficit is known) but the effective cap now tracks the real,
 * currently-open plank deficit across active construction projects — see `plankCapFor` below. */
export const PLANK_BASE_BUFFER = 10;
/** Processing stock ceilings, alongside request-driven demand. Harvest has no such ceiling:
 * ripe plots must be collected before they rot, and the next crop takes weeks to mature. */
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
      const plot: CropPlot = { x, y: cropY, z, crop: 'wheat', state, growth: state === 'mature' ? 1 : 0, plantedAt: state === 'mature' ? world.now - MATURE_HOURS * 3600 : 0, maturedAt: state === 'mature' ? world.now : undefined };
      plots.push(plot);
      // normalize the block to our canonical projection (Pumpkin/other → cleared)
      projectCrop(world, plot);
    }
    world.fields.push({ id: world.nextId('fld'), placeId, ownerId, soilMoisture: clamp01(startMoisture), plots });
  }
}

/** v0.8 "The Legible World" §C: all four non-fallow crop states now have a distinct voxel
 * projection — `fallow` alone stays `B.Air` (bare, untilled ground; the `B.Farmland` block
 * beneath it is still visible and already reads as "worked soil"). Before this, `planted` and
 * `harvested` were indistinguishable from `fallow` (and from each other) — a freshly-sown plot
 * and a just-harvested one both looked like nothing had ever happened there. */
export function cropBlockFor(state: CropState): number {
  switch (state) {
    case 'mature': return B.Wheat;
    case 'growing': return B.Sprout;
    case 'planted': return B.Seedling;
    case 'harvested': return B.Stubble;
    case 'fallow': return B.Air;
  }
}

/** Crop projection also changes the traversable world. In particular, initialization can
 * clear an old obstruction; retaining its cached navigation cell can strand a farmer. */
function projectCrop(world: World, plot: CropPlot): void {
  world.grid.set(plot.x, plot.y, plot.z, cropBlockFor(plot.state));
  world.nav.rebuildArea(plot.x, plot.z, plot.x, plot.z);
}

/** Re-project every plot's canonical state onto its voxel cell (used after load). */
export function syncFieldBlocks(world: World): void {
  for (const f of world.fields) for (const p of f.plots) projectCrop(world, p);
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
          projectCrop(world, plot);
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
        projectCrop(world, plot);
      } else if (plot.state === 'mature' && plot.maturedAt !== undefined && world.now - plot.maturedAt >= SPOIL_HOURS * 3600) {
        // Over-ripe wheat lodged in the field and was lost — plot reverts to fallow.
        plot.state = 'fallow'; plot.growth = 0; plot.maturedAt = undefined;
        projectCrop(world, plot);
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
  projectCrop(world, plot);
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
  projectCrop(world, plot);
  const ev = world.emit('crop_harvested', {
    actor: farmer.id, placeId: field.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.35,
    data: { fieldId: field.id, crop: plot.crop, yield: yield_ }, summary: `${farmer.name} harvested wheat in ${world.nameOf(field.placeId)} (+${yield_} grain)`,
  });
  addPlaceStock(world, 'grain', yield_, field.placeId, field.ownerId ?? farmer.id, ev.id, 'harvested');
  payWage(world, field.ownerId, farmer, 1);
  return yield_;
}

// ---------------------------------------------------------------- resource transforms
const retireItem = retireStack;

export interface TransformResult { ok: boolean; produced: number; consumed: number; shortage?: ItemType; eventId?: EventId; }

/** An action at a particular post must use that post's inputs and output bin. Legacy direct
 * callers retain their settlement lookup; an explicit post additionally requires bodily reach. */
export interface TradeBatchContext { placeId: EntityId; causes?: EventId[]; laborSeconds?: number }
function batchPlace(world: World, p: Person, type: PlaceType, context?: TradeBatchContext): EntityId | undefined {
  if (!context) return placeForPerson(world, p, type)?.id;
  const place = world.place(context.placeId);
  return place?.type === type && p.alive && p.bodies.some(id => {
    const b = world.body(id);
    return b?.present && !b.dead && near(b.pos, place.inside, 3)
      && world.grid.lineOfSight({ ...b.pos, y: b.pos.y + 1 }, { ...place.inside, y: place.inside.y + 1 }, 16);
  }) ? place.id : undefined;
}

function batchStockOwner(world: World, placeId: EntityId, type: ItemType, worker: Person): EntityId | null {
  const operator = economicOperatorFor(world, placeId) ?? worker.id;
  return world.itemsAtPlaces([placeId]).some(i => i.type === type && !i.holderId && i.quantity > 0 && i.ownerId === operator) ? operator : null;
}

/**
 * A conservation-respecting resource transformation: consume `inputQty` of `inputType` from
 * `inputPlaces`, produce `outputQty` of `outputType` at `outputPlace`. If the input is not
 * available, nothing is consumed or produced and `shortage` is set. The generic shape is what
 * later `log→plank`, `ore→ingot` reuse.
 */
export function transform(world: World, o: {
  actor: EntityId; inputType: ItemType; inputQty: number; inputPlaces: EntityId[];
  outputType: ItemType; outputQty: number; outputPlace: EntityId; ownerId: EntityId | null; how: string;
  /** Optional strict title boundary for compositional production; legacy callers unchanged. */
  inputOwner?: EntityId | null; causes?: EventId[]; laborSeconds?: number;
}): TransformResult {
  const available = o.inputOwner === undefined ? stockTotal(world, o.inputType, o.inputPlaces)
    : world.itemsAtPlaces(o.inputPlaces).filter(i => i.type === o.inputType && !i.holderId && i.ownerId === o.inputOwner && i.quantity > 0).reduce((n, i) => n + i.quantity, 0);
  if (available < o.inputQty) {
    world.emit('resource_shortage', {
      causes: o.causes,
      actor: o.actor, placeId: o.outputPlace, significance: 0.2,
      data: { need: o.inputType, have: available, want: o.inputQty, making: o.outputType },
      summary: `${world.nameOf(o.actor)} could not make ${o.outputType}: only ${available} ${o.inputType}`,
    });
    return { ok: false, produced: 0, consumed: 0, shortage: o.inputType };
  }
  // Carry the ancestry of the actual debited stacks into the next productive stage.
  // A reader must not invent a machine→delivery→bread link that canon never recorded.
  const causes = new Set(o.causes ?? []); let traced = o.inputQty;
  for (const item of world.itemsAtPlaces(o.inputPlaces).filter(i => i.type === o.inputType && !i.holderId && i.quantity > 0 && (o.inputOwner === undefined || i.ownerId === o.inputOwner)).sort((a, b) => a.id.localeCompare(b.id))) {
    if (traced <= 0) break;
    for (const entry of item.provenance) if (entry.eventId) causes.add(entry.eventId);
    traced -= Math.min(traced, item.quantity);
  }
  const consumed = takePlaceStock(world, o.inputType, o.inputQty, o.inputPlaces, o.inputOwner);
  const ev = world.emit('resource_transformed', {
    causes: [...causes],
    actor: o.actor, placeId: o.outputPlace, significance: 0.15,
    data: { from: o.inputType, fromQty: consumed, to: o.outputType, toQty: o.outputQty, how: o.how, ...(o.laborSeconds === undefined ? {} : { laborSeconds: o.laborSeconds }) },
    summary: `${world.nameOf(o.actor)} turned ${consumed} ${o.inputType} into ${o.outputQty} ${o.outputType} (${o.how})`,
  });
  addPlaceStock(world, o.outputType, o.outputQty, o.outputPlace, o.ownerId, ev.id, o.how);
  return { ok: true, produced: o.outputQty, consumed, shortage: undefined, eventId: ev.id };
}

export function villageStock(world: World, type: ItemType, pos?: Vec3): number {
  return stockTotal(world, type, (pos ? localPlaces(world, pos) : world.places()).map(p => p.id))
    + world.items().filter(i => i.type === type && i.holderId && (!pos || near(pos, world.positionOf(i.holderId)))).reduce((a, b) => a + b.quantity, 0);
}

/**
 * One milling batch. v0.3 Priority 3: the mill consumes ONLY grain that is physically at the
 * mill (delivered there by a haul task) — it no longer reaches across the village for its
 * input. If there is no grain at the mill, `transform` fires a `resource_shortage` and a
 * logistics need to haul grain there is raised on the next upkeep pass. Still demand-driven:
 * nothing runs once the village has plenty of flour.
 */
export function mill(world: World, miller: Person, context?: TradeBatchContext): TransformResult {
  const millId = batchPlace(world, miller, 'mill', context);
  if (!millId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'flour', world.place(millId)?.inside) >= FLOUR_CAP) return { ok: false, produced: 0, consumed: 0 };
  // Quiet no-op when the input simply hasn't been delivered yet — that is not a "shortage",
  // it is normal demand-driven operation, and the logistics generator already raises a haul.
  if (stockAtPlace(world, 'grain', millId) < MILL_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'grain' };
  // Adaptive Society (v0.5): the grain consumed never changes — three measures go under the
  // stones however clumsily they are handled — but how much usable flour comes back out does. A
  // complete novice gets half; somebody at a settled tradesman's proficiency
  // (`TRADE_BASELINE`) gets all of it, which is why nothing about the working village changed
  // when this was introduced. Never zero: a batch that produced literally nothing would read to
  // the rest of the simulation as a material shortage, which would be a lie about the world.
  const out = tradeYield(MILL_RATIO.out, skillOf(miller, 'milling'));
  const result = transform(world, { actor: miller.id, inputType: 'grain', inputQty: MILL_RATIO.in, inputPlaces: [millId], outputType: 'flour', outputQty: out, outputPlace: millId, ownerId: economicOperatorFor(world, millId) ?? miller.id, how: 'milled', causes: context?.causes, laborSeconds: context?.laborSeconds, inputOwner: context ? batchStockOwner(world, millId, 'grain', miller) : undefined });
  // ...and the work itself is how anybody ever stops being a novice. One real batch, one unit of
  // practice — the same rule baking and sawing have followed since v0.6, applied to the trade
  // that until now had no learned capability behind it at all.
  if (result.ok) practiceSkill(miller, 'milling', 1);
  return result;
}

/**
 * One baking batch. v0.3 Priority 3: the bakery consumes ONLY flour physically at the bakery
 * (hauled from the mill). It cannot bake from flour still sitting at the mill.
 */
export function bake(world: World, baker: Person, context?: TradeBatchContext): TransformResult {
  const bakeryId = batchPlace(world, baker, 'bakery', context);
  if (!bakeryId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'bread', world.place(bakeryId)?.inside) >= BREAD_CAP) return { ok: false, produced: 0, consumed: 0 };
  if (stockAtPlace(world, 'flour', bakeryId) < BAKE_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'flour' };
  // v0.5 Adaptive Society: the same novice yield milling now pays. Osric and Mara are seeded at
  // `TRADE_BASELINE`, so the bakery's real output is untouched; somebody standing in for them is
  // measurably worse at it.
  const out = tradeYield(BAKE_RATIO.out, skillOf(baker, 'baking'));
  const result = transform(world, { actor: baker.id, inputType: 'flour', inputQty: BAKE_RATIO.in, inputPlaces: [bakeryId], outputType: 'bread', outputQty: out, outputPlace: bakeryId, ownerId: economicOperatorFor(world, bakeryId) ?? baker.id, how: 'baked', causes: context?.causes, laborSeconds: context?.laborSeconds, inputOwner: context ? batchStockOwner(world, bakeryId, 'flour', baker) : undefined });
  if (result.ok) practiceSkill(baker, 'baking', 1); // v0.6 §V.9: one real batch = one unit of practice
  return result;
}

/** v0.8 §P1: real, currently-open plank deficit across active construction projects, plus a
 * small base buffer (`PLANK_BASE_BUFFER`) so sawing can still get ahead of a freshly-created
 * project before its manifest is known. Reads `world.constructionProjects` directly rather than
 * importing `construction.ts`'s own `projectDeficits` helper, to keep this a one-way, minimal
 * dependency (metabolism -> canonical project state only, not construction's haul-raising logic). */
/** Exported so `world/production.ts` can make the sawpit's plank reserve the size of what the
 * village has actually asked for, rather than a fixed larder — see `ProductionSpec.reserve`. */
export function plankCapFor(world: World, pos?: Vec3): number {
  let deficit = 0;
  for (const proj of world.constructionProjects) {
    if (proj.status === 'complete' || proj.status === 'cancelled' || (pos && !near(pos, world.place(proj.sitePlaceId)?.inside))) continue;
    for (const req of proj.required) {
      if (req.type !== 'plank') continue;
      deficit += Math.max(0, req.quantity - stockAtPlace(world, 'plank', proj.sitePlaceId));
    }
  }
  return PLANK_BASE_BUFFER + deficit;
}

/**
 * One sawing batch (v0.3): logs physically at the sawpit → planks at the sawpit. The first
 * non-food production chain, reusing the same conservation-respecting `transform`. Demand-driven
 * via a real plank cap tracking open construction demand (see `plankCapFor`), not a flat number.
 */
export function saw(world: World, sawyer: Person, context?: TradeBatchContext): TransformResult {
  const sawpitId = batchPlace(world, sawyer, 'sawpit', context);
  if (!sawpitId) return { ok: false, produced: 0, consumed: 0 };
  if (stockTotal(world, 'plank', [sawpitId]) >= plankCapFor(world, world.place(sawpitId)?.inside)) return { ok: false, produced: 0, consumed: 0 };
  if (stockAtPlace(world, 'log', sawpitId) < SAW_RATIO.in) return { ok: false, produced: 0, consumed: 0, shortage: 'log' };
  const result = transform(world, { actor: sawyer.id, inputType: 'log', inputQty: SAW_RATIO.in, inputPlaces: [sawpitId], outputType: 'plank', outputQty: SAW_RATIO.out, outputPlace: sawpitId, ownerId: economicOperatorFor(world, sawpitId) ?? sawyer.id, how: 'sawn', causes: context?.causes, laborSeconds: context?.laborSeconds, inputOwner: context ? batchStockOwner(world, sawpitId, 'log', sawyer) : undefined });
  if (result.ok) practiceSkill(sawyer, 'sawing', 1);
  return result;
}

/** Brewing uses local grain, the tavern hearth and a real work batch. The existing name
 * remains the public entry point; no goods or currency cross an unmodelled world boundary. */
export const ALE_RESTOCK_TRIGGER = 8;
export const BREW_RATIO = { in: 3, out: 6 } as const;
export function restockTavern(world: World, brewer: Person): boolean {
  const pos = world.positionOf(brewer.id), tavern = pos ? world.placeAt(pos) : undefined;
  if (!tavern || tavern.type !== 'tavern' || stockAtPlace(world, 'ale', tavern.id) >= ALE_RESTOCK_TRIGGER) return false;
  if (fireIntensityAt(world, tavern.id) < 0.3) return false;
  const result = transform(world, { actor: brewer.id, inputType: 'grain', inputQty: BREW_RATIO.in, inputPlaces: [tavern.id],
    outputType: 'ale', outputQty: BREW_RATIO.out, outputPlace: tavern.id,
    ownerId: economicOperatorFor(world, tavern.id) ?? brewer.id, how: 'brewed over the hearth' });
  if (result.ok) { practiceSkill(brewer, 'cooking', 1); payWage(world, economicOperatorFor(world, tavern.id), brewer, 3); }
  return result.ok;
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

/** Kept for callers of the former restock API. Hunting now requires standing at a real,
 * finite hunting ground. Its output stays there until somebody carries it to market. */
export function huntGame(world: World, hunter: Person): boolean {
  const pos = world.positionOf(hunter.id); if (!pos) return false;
  const node = nearestAvailableNode(world, 'game', pos, 3);
  return !!node && extractFromNode(world, node, hunter) > 0;
}

// ---------------------------------------------------------------- eating & drinking
/**
 * Find a food item this person can legitimately eat: their own inventory first, then unheld
 * food at their current position's place, owned by them or nobody —
 * OR, at home only, food a fellow household member is actually carrying (v0.6 §II). Real
 * families eat from what whoever went to market brought back, not only a communal bowl on the
 * table; without this, anyone who cannot personally earn/spend (a child, wealth 0) had no path
 * to food at all once the one-time starting larder ran out, even while a parent was walking
 * around with bought bread in their own pack the whole time. Bounded to household members who
 * are physically AT home right now (never a phantom village-wide pantry). Never conjures food
 * from nowhere. At home, placed household property is shared too. Vendor property and
 * employer-owned freight remain inaccessible without an actual purchase or transfer.
 */
export function findAccessibleFood(world: World, p: Person, atPlaceId: EntityId | null): Item | null {
  const carried = p.inventory.map(id => world.item(id)).find(i => !!i && i.holderId === p.id && i.ownerId === p.id && !i.haulTaskId && isFood(i.type) && i.quantity > 0);
  if (carried) return carried;
  const scan = (placeId: EntityId | null | undefined, isHome: boolean): Item | null => {
    if (!placeId) return null;
    const place = world.place(placeId);
    const pos = world.positionOf(p.id);
    if (!place || !pos || (world.placeAt(pos)?.id !== placeId && world.distance2d(pos, place.inside) > 3)) return null;
    const h = isHome ? householdOf(world, p) : undefined;
    const household = h ? householdMembers(world, h) : [];
    const okOwner = (i: Item) => i.ownerId == null || i.ownerId === p.id || (isHome && householdOwns(world, p, i));
    const placed = world.itemsAtPlaces([placeId]).find(i => !i.holderId && !i.haulTaskId && isFood(i.type) && i.quantity > 0 && okOwner(i));
    if (placed) return placed;
    if (isHome && household.length) {
      for (const resident of household) {
        if (resident.id === p.id) continue;
        const residentBody = world.primaryBody(resident.id);
        if (!residentBody || world.placeAt(residentBody.pos)?.id !== placeId) continue;
        const held = resident.inventory.map(id => world.item(id)).find(i => !!i && i.ownerId === resident.id && !i.haulTaskId && isFood(i.type) && i.quantity > 0);
        if (held) return held;
      }
    }
    return null;
  };
  return scan(atPlaceId, atPlaceId === p.homeId) ?? scan(p.homeId, true);
}

export type FoodFailure = 'unaffordable' | 'unavailable';

/** A visit to a counter compares the actual offers there. The first stack in entity order
 * must not mask a cheaper meal. No off-site stock query or remote purchase. */
export function buyFoodHere(world: World, buyer: Person, want: number, sourcePlaceId?: EntityId): { food: Item | null; reason?: FoodFailure; price?: number } {
  const pos = world.positionOf(buyer.id), here = sourcePlaceId ? world.place(sourcePlaceId) : pos ? world.placeAt(pos) : undefined;
  if (!here || !pos || (world.placeAt(pos)?.id !== here.id && world.distance2d(pos, here.inside) > 3)) return { food: null, reason: 'unavailable' };
  const offers = world.itemsAtPlaces([here.id]).flatMap(item => {
    const seller = world.person(item.ownerId);
    if (!seller?.alive || seller.id === buyer.id || item.holderId || !isFood(item.type) || item.quantity <= 0) return [];
    const willing = willingnessFor(world, seller, item, buyer);
    return willing.available >= 1 ? [{ item, price: unitPriceFor(world, seller, item, buyer) }] : [];
  }).sort((a,b) => a.price - b.price || a.item.id.localeCompare(b.item.id));
  const offer = offers[0];
  if (!offer) return { food: null, reason: 'unavailable' };
  if (buyer.wealth < offer.price) return { food: null, reason: 'unaffordable', price: offer.price };
  return { food: buyFoodPortion(world, buyer, offer.item, want), price: offer.price };
}

/**
 * Buy up to `n` units of a food item from its owner. This is the hungry-NPC path: find food for
 * sale, pay for it, walk away with a few meals' worth so the village does not funnel everyone to
 * one counter every few hours.
 *
 * v0.10.1: the transaction itself moved to `world/commerce.ts`'s `purchaseUnits`, which the
 * player's Trade menu also goes through — so "who may sell what, at what price, and does
 * ownership move exactly once" has one implementation and one place to audit, instead of an NPC
 * answer here and a player answer in the dialogue code. What stays here is what is specifically
 * about food and about eating: the seller lookup, and the economic knowledge/memory a successful
 * food purchase leaves behind.
 *
 * Returns the buyer's new carried food stack, or null if unaffordable, unavailable, or refused.
 */
export function buyFoodPortion(world: World, buyer: Person, forSale: Item, n: number): Item | null {
  const seller = forSale.ownerId ? world.person(forSale.ownerId) : undefined;
  if (!seller || !seller.alive || forSale.holderId || forSale.quantity <= 0) return null;
  const boughtAtPlaceId = forSale.placeId ?? undefined;
  const result = purchaseUnits(world, buyer, seller, forSale, n);
  if (!result.stack) return null;
  // v0.6 §III.3: economic observation — a successful purchase is first-hand evidence this place
  // sells food, and (§IV.4) a memory of it, so a later hunger decision can prefer a source that
  // has actually worked before (mind/agent.ts's `knownFoodPlace`) over one that hasn't.
  if (isFood(forSale.type) && boughtAtPlaceId) {
    const place = world.place(boughtAtPlaceId);
    if (place) learnPlace(world, buyer, place, { type: 'self' });
    // A completed purchase supersedes this buyer's earlier failed quote/empty-shelf report.
    delete buyer.knowledge[`food-access:${boughtAtPlaceId}`];
    remember(world, buyer, { type: 'purchase', summary: `I bought ${forSale.type} at ${world.nameOf(boughtAtPlaceId)}`, entities: [seller.id], significance: 0.15, valence: 0.2, source: { type: 'self' }, placeId: boughtAtPlaceId });
  }
  return result.stack;
}

/**
 * v0.10 §I: take `n` units off a stack this person may access, into their own hands, so they can
 * physically carry it somewhere. This is the same physical act `buyFoodPortion` performs once
 * payment has cleared — split the source stack, merge into a carried one of the same type —
 * with no price attached, because this is someone picking up their own household's bread to
 * bring to an injured relative, not a purchase.
 *
 * The caller must check physical access and ownership at execution time, using the same
 * household rule as `findAccessibleFood` for a family errand. This helper only splits and
 * carries authorized stock; it does not itself grant access. Returns the carried stack, or
 * null if there was nothing to take.
 */
export function takePortionInHand(world: World, taker: Person, stack: Item, n: number, how: string): Item | null {
  if (stack.holderId === taker.id) return stack;
  if (stack.quantity <= 0 || n <= 0) return null;
  const take = Math.min(n, stack.quantity);
  const spoilShare = (stack.spoilAccum ?? 0) * take / stack.quantity;
  stack.spoilAccum = (stack.spoilAccum ?? 0) - spoilShare;
  stack.quantity -= take;
  if (stack.quantity <= 0) retireStack(world, stack);
  const ev = world.emit('pickup', {
    actor: taker.id, item: stack.id, pos: world.primaryBody(taker.id)?.pos, placeId: stack.placeId ?? undefined,
    significance: 0.08, visibility: 8, data: { qty: take, how },
    summary: `${taker.name} took ${take} ${stack.type} ${how}`,
  });
  const carried = taker.inventory.map(id => world.item(id)).find(i => !!i && i.type === stack.type && i.holderId === taker.id && i.ownerId === taker.id && !i.haulTaskId
    && (!isPerishable(i.type) || i.createdAt === stack.createdAt));
  if (carried) { carried.quantity += take; carried.spoilAccum = (carried.spoilAccum ?? 0) + spoilShare; carried.provenance.push({ tick: world.now, eventId: ev.id, from: stack.ownerId, to: taker.id, how }); return carried; }
  const fresh = makeItem(world, stack.type, stack.name, { owner: taker.id, holder: taker.id, quantity: take, value: stack.value });
  fresh.createdAt = stack.createdAt; fresh.spoilAccum = spoilShare;
  fresh.provenance.push({ tick: world.now, eventId: ev.id, from: stack.ownerId, to: taker.id, how });
  return fresh;
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
    // inventory pointing at a retired item. v0.10.1: `retireStack` now resolves the holder itself.
    retireItem(world, food);
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
  let best: { pos: Vec3; placeId?: EntityId } | null = null; let bd = 256;
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
    if (it.quantity <= 0) retireItem(world, it);
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
  const alive = world.livingPersons().filter(p => !p.controlled);
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
