import type { Fire, EntityId, ItemType, Person, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { stockAt, takePlaceStock } from './stock';
import { materialOf } from '../core/materials';

/**
 * Fire as a real world process (v0.8 §C), not a visual status effect: fuel, heat, ignition,
 * burning, and extinguishing are all canonical state (`World.fires`), advanced deterministically
 * on the same coarse upkeep cadence `stepMetabolism`/`stepSpoilage` already run on. Interacts
 * with material (only genuinely flammable fuel can be lit or keep a fire going — `core/
 * materials.ts`), and with wetness/rain/environment (v0.7's exposure model): an exposed fire
 * cannot even be lit while it is actually raining on it, and a storm will snuff one outright —
 * "rain suppresses exposed fire," not a status effect toggled by weather.kind alone.
 */

/** World-seconds of burn time one unit of fuel provides — real physical intuition (a log burns
 * for hours; a stick catches fast and burns out fast, which is exactly why kindling is used to
 * START a fire, not sustain one). Only genuinely flammable materials (`core/materials.ts`) are
 * present here — this table alone is what makes "stone does not provide ordinary fuel" true. */
const FUEL_SECONDS_PER_UNIT: Partial<Record<ItemType, number>> = {
  log: 2 * 3600, plank: 1 * 3600, stick: 20 * 60,
};
/** Below this flammability, a material is not real fuel — `core/materials.ts`'s `stone` is 0
 * (never qualifies); this exists so a future low-flammability material doesn't silently start
 * "working" as fuel just because someone adds a `FUEL_SECONDS_PER_UNIT` entry for it. */
const MIN_FLAMMABILITY_TO_IGNITE = 0.5;
const INTENSITY_RISE_PER_HOUR = 0.6;
const INTENSITY_FALL_PER_HOUR = 0.5;
/** An exposed fire in ordinary rain burns through its fuel this many times faster — genuinely
 * dampened/smoldering, not merely cosmetic. A storm (below) snuffs it outright instead. */
const RAIN_FUEL_DRAIN_MULTIPLIER = 3;

export function createFire(world: World, placeId: EntityId, pos: Vec3, exposed: boolean): Fire {
  const f: Fire = { id: world.nextId('fire'), placeId, pos: { ...pos }, lit: false, fuelRemaining: 0, intensity: 0, exposed, createdAt: world.now };
  world.fires.push(f);
  return f;
}

function isRealFuel(type: ItemType): boolean {
  const perUnit = FUEL_SECONDS_PER_UNIT[type];
  const mat = materialOf(type);
  return !!perUnit && !!mat && mat.flammability >= MIN_FLAMMABILITY_TO_IGNITE;
}

/** Whether it is actually raining ON this fire right now — exposed fires only; a hearth under a
 * roof is never rained on regardless of what the sky is doing. */
function isBeingRainedOn(world: World, fire: Fire): boolean {
  if (!fire.exposed) return false;
  return world.weather.kind === 'rain' || world.weather.kind === 'storm';
}

/**
 * Light an unlit fire with `qty` units of `fuelType`, physically taken from the fire's own
 * Place stock (never conjured). Fails (no state change, no fuel consumed) if the fuel isn't
 * real, none is available, or the fire is exposed and it is currently raining on it — "wet wood
 * is harder to ignite" as a real, deterministic block, not a probability. Already-lit fires
 * route to `feedFire` instead (lighting an already-burning fire is just adding more fuel).
 */
export function igniteFire(world: World, fire: Fire, actor: Person, fuelType: ItemType, qty: number): boolean {
  if (fire.lit) return feedFire(world, fire, actor, fuelType, qty);
  if (!isRealFuel(fuelType)) return false;
  if (isBeingRainedOn(world, fire)) return false;
  const have = stockAt(world, fuelType, fire.placeId);
  const take = Math.min(qty, have);
  if (take <= 0) return false;
  takePlaceStock(world, fuelType, take, [fire.placeId]);
  fire.fuelRemaining += take * (FUEL_SECONDS_PER_UNIT[fuelType] ?? 0);
  fire.lit = true; fire.litAt = world.now; fire.intensity = Math.min(1, fire.intensity + 0.3);
  world.emit('fire_lit', {
    actor: actor.id, placeId: fire.placeId, pos: { ...fire.pos }, significance: 0.1,
    data: { fireId: fire.id, fuelType, qty: take }, summary: `${actor.name} lit a fire with ${take} ${fuelType}`,
  });
  return true;
}

/**
 * Add more fuel to an already-lit fire (tending it). Same material/availability checks as
 * ignition, but does NOT require dry conditions — an established fire keeps burning through
 * ordinary rain (only a storm, or running fully out of fuel, puts it out — see `stepFire`).
 */
export function feedFire(world: World, fire: Fire, actor: Person, fuelType: ItemType, qty: number): boolean {
  if (!fire.lit) return igniteFire(world, fire, actor, fuelType, qty);
  if (!isRealFuel(fuelType)) return false;
  const have = stockAt(world, fuelType, fire.placeId);
  const take = Math.min(qty, have);
  if (take <= 0) return false;
  takePlaceStock(world, fuelType, take, [fire.placeId]);
  fire.fuelRemaining += take * (FUEL_SECONDS_PER_UNIT[fuelType] ?? 0);
  return true;
}

export function extinguishFire(world: World, fire: Fire): void {
  if (!fire.lit) return;
  fire.lit = false; fire.fuelRemaining = 0; fire.intensity = 0; fire.extinguishedAt = world.now;
  world.emit('fire_extinguished', {
    placeId: fire.placeId, pos: { ...fire.pos }, significance: 0.08,
    data: { fireId: fire.id }, summary: `The fire at ${world.nameOf(fire.placeId)} went out`,
  });
}

/**
 * Deterministic per-upkeep advance of every canonical fire (call on the same coarse cadence
 * `stepMetabolism`/`stepSpoilage` already run on — mind/agent.ts's `strategic()`). Consumes
 * fuel in real world-seconds; an exposed fire burns through fuel `RAIN_FUEL_DRAIN_MULTIPLIER`×
 * faster in ordinary rain (dampened/smoldering) and is snuffed outright by a storm — "rain
 * suppresses exposed fire," a real physical consequence, not a status flag flipped by
 * `weather.kind`.
 */
export function stepFire(world: World, hours: number): void {
  if (hours <= 0 || !world.fires.length) return;
  for (const f of world.fires) {
    if (!f.lit) { f.intensity = Math.max(0, f.intensity - INTENSITY_FALL_PER_HOUR * hours); continue; }
    if (f.exposed && world.weather.kind === 'storm') {
      extinguishFire(world, f);
      world.runTally.fire_extinguished_by_storm = (world.runTally.fire_extinguished_by_storm ?? 0) + 1;
      continue;
    }
    const rainDamping = isBeingRainedOn(world, f) ? RAIN_FUEL_DRAIN_MULTIPLIER : 1;
    f.fuelRemaining -= hours * 3600 * rainDamping;
    if (f.fuelRemaining <= 0) { extinguishFire(world, f); continue; }
    f.intensity = Math.min(1, f.intensity + INTENSITY_RISE_PER_HOUR * hours);
  }
}

/** The strongest active fire's intensity at `placeId`, 0 if none lit — read by mind/agent.ts's
 * physiology step (nearby warmth) and world/cooking.ts (a real process needs real heat, not
 * merely `lit === true`). */
export function fireIntensityAt(world: World, placeId: EntityId): number {
  let best = 0;
  for (const f of world.fires) if (f.placeId === placeId && f.lit && f.intensity > best) best = f.intensity;
  return best;
}

export function fireAt(world: World, placeId: EntityId): Fire | undefined {
  return world.fires.find(f => f.placeId === placeId);
}

// ---------------------------------------------------------------- observability
export interface FireSummary { lit: number; total: number; extinguishedTotal: number; extinguishedByStorm: number; }
export function fireSummary(world: World): FireSummary {
  return {
    lit: world.fires.filter(f => f.lit).length,
    total: world.fires.length,
    extinguishedTotal: world.runTally.fire_extinguished ?? 0,
    extinguishedByStorm: world.runTally.fire_extinguished_by_storm ?? 0,
  };
}
