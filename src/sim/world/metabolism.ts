import type { CropPlot, CropState, Field, Item, ItemType, Person, Vec3, EntityId, EventId } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { makeItem, RESOURCE_CATEGORY, isFood } from './factory';

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
/** Hours from planted to mature at full soil moisture. Dry fields take proportionally longer. */
export const MATURE_HOURS = 5 * 24;
/** A harvested plot rests this long before it becomes `fallow` (replantable). */
export const REGROW_HOURS = 24;
/** Soil moisture gained per hour of rain at intensity 1 (storm = intensity 1, rain ~0.5-0.9). */
const RAIN_MOISTURE_PER_HOUR = 0.11;
/** Soil moisture lost per hour under dry sky (scaled: clear fastest, cloudy/fog slower). A
 * multi-day clear spell drops moisture by ~0.5–0.8 and visibly slows crop growth. */
const DRY_MOISTURE_PER_HOUR = 0.035;
/** Grain produced per plot harvested (deterministic — plot index gives the small spread). */
const GRAIN_PER_PLOT_BASE = 5;
/** Milling: grain in : flour out. Baking: flour in : bread out. */
export const MILL_RATIO = { in: 3, out: 4 } as const;
export const BAKE_RATIO = { in: 2, out: 5 } as const;
/** Stock ceilings that make the pipeline demand-driven rather than infinite: a farmer stops
 * harvesting once the village has plenty of grain, a miller stops once there is plenty of
 * flour, a baker stops once there is plenty of bread. Production resumes when stock falls.
 * Sized so ~33 people eating ~3 meals/day are comfortably supplied with a working surplus. */
export const GRAIN_CAP = 500;
export const FLOUR_CAP = 120;
export const BREAD_CAP = 200;
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
      plots.push({ x, y: cropY, z, crop: 'wheat', state, growth: state === 'mature' ? 1 : 0, plantedAt: state === 'mature' ? world.now - MATURE_HOURS * 3600 : 0 });
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

export function plantPlot(world: World, field: Field, plot: CropPlot, farmer: Person): void {
  if (plot.state !== 'fallow') return;
  plot.state = 'planted'; plot.growth = 0; plot.plantedAt = world.now; plot.maturedAt = undefined; plot.harvestedAt = undefined;
  world.grid.set(plot.x, plot.y, plot.z, cropBlockFor('planted'));
  world.emit('crop_planted', {
    actor: farmer.id, placeId: field.placeId, pos: { x: plot.x + 0.5, y: plot.y, z: plot.z + 0.5 }, significance: 0.15,
    data: { fieldId: field.id, crop: plot.crop }, summary: `${farmer.name} sowed wheat in ${world.nameOf(field.placeId)}`,
  });
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
  addStock(world, 'grain', yield_, field.placeId, field.ownerId ?? farmer.id, ev.id, 'harvested');
  return yield_;
}

// ---------------------------------------------------------------- resource stock + transforms
/** Items of `type` available for production/consumption at a place: not carried by anyone, and
 * matching `placeId` (or lying at that place's position). */
export function stockAt(world: World, type: ItemType, placeId: EntityId): Item[] {
  return world.items().filter(i => i.type === type && !i.holderId && i.quantity > 0 && i.placeId === placeId);
}
export function stockTotal(world: World, type: ItemType, placeIds: EntityId[]): number {
  let n = 0;
  for (const i of world.items()) if (i.type === type && !i.holderId && i.quantity > 0 && i.placeId && placeIds.includes(i.placeId)) n += i.quantity;
  return n;
}

function addStock(world: World, type: ItemType, qty: number, placeId: EntityId, ownerId: EntityId | null, eventId: EventId | undefined, how: string): Item {
  const place = world.place(placeId);
  const existing = world.items().find(i => i.type === type && !i.holderId && i.placeId === placeId);
  if (existing) { existing.quantity += qty; existing.provenance.push({ tick: world.now, eventId, from: null, to: ownerId, how }); return existing; }
  const it = makeItem(world, type, `${qty} ${type === 'grain' ? 'grain' : type === 'flour' ? 'flour' : type}`, {
    owner: ownerId, pos: place ? { ...place.inside } : undefined, placeId, quantity: qty,
  });
  it.provenance.push({ tick: world.now, eventId, from: null, to: ownerId, how });
  return it;
}

/** Consume up to `qty` units of `type` from the given places (oldest item first). Returns how
 * many were actually consumed. A depleted stack is emptied in place (quantity 0, detached from
 * the world) rather than deleted — the entity stays so its provenance and any event references
 * remain valid (Constitution §51). It is inert once quantity 0. */
function consumeStock(world: World, type: ItemType, qty: number, placeIds: EntityId[]): number {
  let need = qty;
  const items = world.items()
    .filter(i => i.type === type && !i.holderId && i.quantity > 0 && i.placeId && placeIds.includes(i.placeId))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const it of items) {
    if (need <= 0) break;
    const take = Math.min(need, it.quantity);
    it.quantity -= take; need -= take;
    if (it.quantity <= 0) retireItem(it);
  }
  return qty - need;
}

/** Detach a fully-consumed item from the physical world without deleting the entity. */
function retireItem(it: Item): void { it.pos = null; it.placeId = null; it.holderId = null; }

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
  const consumed = consumeStock(world, o.inputType, o.inputQty, o.inputPlaces);
  const ev = world.emit('resource_transformed', {
    actor: o.actor, placeId: o.outputPlace, significance: 0.15,
    data: { from: o.inputType, fromQty: consumed, to: o.outputType, toQty: o.outputQty, how: o.how },
    summary: `${world.nameOf(o.actor)} turned ${consumed} ${o.inputType} into ${o.outputQty} ${o.outputType} (${o.how})`,
  });
  addStock(world, o.outputType, o.outputQty, o.outputPlace, o.ownerId, ev.id, o.how);
  return { ok: true, produced: o.outputQty, consumed, shortage: undefined, eventId: ev.id };
}

export function villageStock(world: World, type: ItemType): number {
  return stockTotal(world, type, world.places().map(p => p.id))
    + world.items().filter(i => i.type === type && i.holderId).reduce((a, b) => a + b.quantity, 0);
}

/** One milling batch, unless the village already has plenty of flour. Draws grain from the mill
 * and every farm; produces flour at the mill. Returns null-ish when demand is already met. */
export function mill(world: World, miller: Person): TransformResult {
  const millId = world.places().find(p => p.type === 'mill')?.id;
  if (!millId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'flour') >= FLOUR_CAP) return { ok: false, produced: 0, consumed: 0 };
  const sources = [millId, ...world.fields.map(f => f.placeId)];
  return transform(world, { actor: miller.id, inputType: 'grain', inputQty: MILL_RATIO.in, inputPlaces: sources, outputType: 'flour', outputQty: MILL_RATIO.out, outputPlace: millId, ownerId: miller.id, how: 'milled' });
}

/** One baking batch, unless the village already has plenty of bread. Draws flour from the
 * bakery and the mill; produces bread at the bakery. */
export function bake(world: World, baker: Person): TransformResult {
  const bakeryId = world.places().find(p => p.type === 'bakery')?.id;
  const millId = world.places().find(p => p.type === 'mill')?.id;
  if (!bakeryId) return { ok: false, produced: 0, consumed: 0 };
  if (villageStock(world, 'bread') >= BREAD_CAP) return { ok: false, produced: 0, consumed: 0 };
  const sources = [bakeryId, ...(millId ? [millId] : [])];
  return transform(world, { actor: baker.id, inputType: 'flour', inputQty: BAKE_RATIO.in, inputPlaces: sources, outputType: 'bread', outputQty: BAKE_RATIO.out, outputPlace: bakeryId, ownerId: baker.id, how: 'baked' });
}

// ---------------------------------------------------------------- eating & drinking
/**
 * Find a food item this person can legitimately eat: their own inventory first, then unheld
 * food at their current position's place / their home, owned by them, the place, or nobody.
 * Never conjures food from nowhere.
 */
export function findAccessibleFood(world: World, p: Person, atPlaceId: EntityId | null): Item | null {
  const carried = p.inventory.map(id => world.item(id)).find(i => !!i && isFood(i.type) && i.quantity > 0);
  if (carried) return carried;
  const scan = (placeId: EntityId | null | undefined, isHome: boolean): Item | null => {
    if (!placeId) return null;
    const place = world.place(placeId);
    const household = isHome ? new Set(place?.residents ?? []) : new Set<EntityId>();
    const okOwner = (i: Item) => i.ownerId == null || i.ownerId === p.id || i.ownerId === place?.ownerId || household.has(i.ownerId);
    return world.items().find(i => i.placeId === placeId && !i.holderId && isFood(i.type) && i.quantity > 0 && okOwner(i)) ?? null;
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
  const unit = Math.max(1, forSale.value ?? 2);
  const take = Math.max(1, Math.min(n, forSale.quantity, Math.floor(buyer.wealth / unit)));
  if (take <= 0) return null;
  const cost = take * unit;
  buyer.wealth -= cost; seller.wealth += cost;
  forSale.quantity -= take;
  if (forSale.quantity <= 0) { forSale.pos = null; forSale.placeId = null; }
  const carried = buyer.inventory.map(id => world.item(id)).find(i => !!i && i.type === forSale.type && i.holderId === buyer.id);
  const ev = world.emit('trade', {
    actor: seller.id, target: buyer.id, item: forSale.id, pos: world.primaryBody(buyer.id)?.pos, placeId: forSale.placeId ?? undefined,
    significance: 0.1, data: { price: cost, qty: take, food: forSale.type },
    summary: `${seller.name} sold ${take} ${forSale.type} to ${buyer.name} for ${cost} silver`,
  });
  if (carried) { carried.quantity += take; carried.provenance.push({ tick: world.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'bought' }); return carried; }
  const stack = makeItem(world, forSale.type, forSale.name, { owner: buyer.id, holder: buyer.id, quantity: take, value: forSale.value });
  stack.provenance.push({ tick: world.now, eventId: ev.id, from: seller.id, to: buyer.id, how: 'bought' });
  return stack;
}

/** Consume one unit of a food item and reduce hunger. Returns the eaten item type, or null. */
export function eatFood(world: World, p: Person, food: Item): ItemType {
  food.quantity -= 1;
  if (food.quantity <= 0) {
    if (food.holderId === p.id) p.inventory = p.inventory.filter(id => id !== food.id);
    retireItem(food);
  }
  p.needs.hunger = Math.max(0, p.needs.hunger - FOOD_HUNGER_RESTORE);
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
  p.needs.thirst = Math.max(0, p.needs.thirst - WATER_THIRST_RESTORE);
  world.emit('water_consumed', {
    actor: p.id, placeId: sourcePlaceId, pos: world.primaryBody(p.id)?.pos, significance: 0.08,
    data: { thirst: Math.round(p.needs.thirst * 100) / 100 },
    summary: `${p.name} drank${sourcePlaceId ? ' at ' + world.nameOf(sourcePlaceId) : ''}`,
  });
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
