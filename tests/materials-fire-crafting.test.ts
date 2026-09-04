import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { createFire, igniteFire, feedFire, extinguishFire, stepFire, fireIntensityAt, fireAt } from '../src/sim/world/fire';
import { cook, tendTavernFire, MEAT_TO_STEW_RATIO } from '../src/sim/world/cooking';
import { craftItem, canCraft, CRAFTING_RECIPES } from '../src/sim/world/crafting';
import { materialOf, materialIdOf } from '../src/sim/core/materials';
import { knowsAffordance, recognizedUses } from '../src/sim/mind/knowledge';
import { bestToolFor, toolWorkMultiplier } from '../src/sim/core/tools';

// ==================================================================== v0.8 §A — materials
describe('material properties (v0.8 §A): only what fire/crafting actually consume', () => {
  it('stone has zero flammability; wood is genuinely flammable', () => {
    expect(materialOf('stone')!.flammability).toBe(0);
    expect(materialOf('log')!.flammability).toBeGreaterThan(0.5);
    expect(materialIdOf('log')).toBe('wood');
    expect(materialIdOf('stone')).toBe('stone');
  });
});

// ==================================================================== v0.8 §C — fire
describe('fire as a real world process (v0.8 §C): fuel, ignition, burning, rain', () => {
  it('dry wood ignites indoors and burns, consuming real fuel stock', () => {
    const tw = createTestWorld(80001, 30);
    const place = makePlace(tw.world, 'house', 'Hut', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: true });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'log', 3, place.id, p.id, undefined, 'x');
    const fire = createFire(tw.world, place.id, v(4, 1, 4), false);
    expect(igniteFire(tw.world, fire, p, 'log', 1)).toBe(true);
    expect(fire.lit).toBe(true);
    expect(stockAt(tw.world, 'log', place.id)).toBe(2); // real fuel physically consumed
    expect(fire.fuelRemaining).toBeGreaterThan(0);
    stepFire(tw.world, 1);
    expect(fireIntensityAt(tw.world, place.id)).toBeGreaterThan(0);
  });

  it('stone does not provide ordinary fuel — igniting with it fails cleanly, nothing consumed', () => {
    const tw = createTestWorld(80002, 30);
    const place = makePlace(tw.world, 'house', 'Hut', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: true });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'stone', 5, place.id, p.id, undefined, 'x');
    const fire = createFire(tw.world, place.id, v(4, 1, 4), false);
    expect(igniteFire(tw.world, fire, p, 'stone', 5)).toBe(false);
    expect(fire.lit).toBe(false);
    expect(stockAt(tw.world, 'stone', place.id)).toBe(5); // untouched
  });

  it('an exposed fire cannot be lit while it is actually raining on it — wet wood is harder to ignite', () => {
    const tw = createTestWorld(80003, 30);
    const place = makePlace(tw.world, 'square', 'Yard', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: false });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'log', 3, place.id, p.id, undefined, 'x');
    tw.world.weather = { kind: 'rain', intensity: 0.7, nextChangeAt: 999999, wind: 0.3 };
    const exposedFire = createFire(tw.world, place.id, v(4, 1, 4), true);
    expect(igniteFire(tw.world, exposedFire, p, 'log', 1)).toBe(false);
    expect(stockAt(tw.world, 'log', place.id)).toBe(3); // nothing consumed on a failed ignition
    // the SAME weather, but a sheltered (non-exposed) fire ignites just fine
    const shelteredFire = createFire(tw.world, place.id, v(4, 1, 4), false);
    expect(igniteFire(tw.world, shelteredFire, p, 'log', 1)).toBe(true);
  });

  it('a storm snuffs an exposed lit fire outright; the same storm does not touch a sheltered one', () => {
    const tw = createTestWorld(80004, 30);
    const place = makePlace(tw.world, 'square', 'Yard', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: false });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'log', 6, place.id, p.id, undefined, 'x');
    const exposedFire = createFire(tw.world, place.id, v(4, 1, 4), true);
    const shelteredFire = createFire(tw.world, place.id, v(4, 1, 4), false);
    expect(igniteFire(tw.world, exposedFire, p, 'log', 1)).toBe(true);
    expect(igniteFire(tw.world, shelteredFire, p, 'log', 1)).toBe(true);
    tw.world.weather = { kind: 'storm', intensity: 1, nextChangeAt: 999999, wind: 1 };
    stepFire(tw.world, 0.1);
    expect(exposedFire.lit).toBe(false);
    expect(shelteredFire.lit).toBe(true);
  });

  it('ordinary rain dampens (drains fuel faster) an exposed fire rather than snuffing it outright', () => {
    const tw = createTestWorld(80005, 30);
    const place = makePlace(tw.world, 'square', 'Yard', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: false });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'log', 2, place.id, p.id, undefined, 'x');
    addPlaceStock(tw.world, 'log', 2, place.id, p.id, undefined, 'x');
    const dryFire = createFire(tw.world, place.id, v(4, 1, 4), true);
    igniteFire(tw.world, dryFire, p, 'log', 1);
    const fuelAtIgnition = dryFire.fuelRemaining;
    tw.world.weather = { kind: 'rain', intensity: 0.6, nextChangeAt: 999999, wind: 0.3 };
    stepFire(tw.world, 0.2);
    const rainedOnDrop = fuelAtIgnition - dryFire.fuelRemaining;
    // reset a fresh comparable fire under clear skies for the same real elapsed time
    const clearFire = createFire(tw.world, place.id, v(4, 1, 4), true);
    tw.world.weather = { kind: 'clear', intensity: 0, nextChangeAt: 999999, wind: 0.3 };
    igniteFire(tw.world, clearFire, p, 'log', 1);
    const fuelAtIgnition2 = clearFire.fuelRemaining;
    stepFire(tw.world, 0.2);
    const clearDrop = fuelAtIgnition2 - clearFire.fuelRemaining;
    expect(rainedOnDrop).toBeGreaterThan(clearDrop);
    expect(dryFire.lit).toBe(true); // rain drains faster, but does not snuff it outright
  });

  it('an unlit fire cools toward zero intensity; feeding an already-lit fire adds real fuel without re-igniting', () => {
    const tw = createTestWorld(80006, 30);
    const place = makePlace(tw.world, 'house', 'Hut', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4), indoor: true });
    const p = addPerson(tw, 'P', 'traveler', v(4, 1, 4));
    addPlaceStock(tw.world, 'log', 3, place.id, p.id, undefined, 'x');
    const fire = createFire(tw.world, place.id, v(4, 1, 4), false);
    igniteFire(tw.world, fire, p, 'log', 1);
    stepFire(tw.world, 0.3);
    const before = fire.fuelRemaining;
    expect(feedFire(tw.world, fire, p, 'log', 1)).toBe(true);
    expect(fire.fuelRemaining).toBeGreaterThan(before);
    expect(stockAt(tw.world, 'log', place.id)).toBe(1);
    extinguishFire(tw.world, fire);
    expect(fire.lit).toBe(false);
    stepFire(tw.world, 2);
    expect(fire.intensity).toBe(0);
  });
});

// ==================================================================== v0.8 §D/E — cooking
describe('cooking (v0.8 §D/E): the first production process gated on real fire/heat', () => {
  it('cooking fails without a genuinely hot fire, even with plenty of meat on hand', () => {
    const tw = createTestWorld(80101, 30);
    const tavernId = tw.places.tavern; // createTestWorld's own single tavern-type Place
    const cookP = addPerson(tw, 'Cook', 'cook', v(5, 1, 5), { workId: tavernId });
    createFire(tw.world, tavernId, v(5, 1, 5), false); // unlit
    addPlaceStock(tw.world, 'meat', 10, tavernId, cookP.id, undefined, 'x');
    const result = cook(tw.world, cookP);
    expect(result.ok).toBe(false);
    expect(stockAt(tw.world, 'meat', tavernId)).toBe(10); // nothing consumed
  });

  it('a real lit, hot fire lets meat become stew — conserved, real transform', () => {
    const tw = createTestWorld(80102, 30);
    const tavernId = tw.places.tavern;
    const cookP = addPerson(tw, 'Cook', 'cook', v(5, 1, 5), { workId: tavernId });
    createFire(tw.world, tavernId, v(5, 1, 5), false);
    addPlaceStock(tw.world, 'log', 2, tavernId, cookP.id, undefined, 'x');
    addPlaceStock(tw.world, 'meat', 10, tavernId, cookP.id, undefined, 'x');
    expect(tendTavernFire(tw.world, cookP)).toBe(true);
    stepFire(tw.world, 0.5); // let intensity ramp up to a real cooking heat
    const result = cook(tw.world, cookP);
    expect(result.ok).toBe(true);
    expect(result.produced).toBe(MEAT_TO_STEW_RATIO.out);
    expect(stockAt(tw.world, 'meat', tavernId)).toBe(10 - MEAT_TO_STEW_RATIO.in);
    expect(stockAt(tw.world, 'stew', tavernId)).toBe(MEAT_TO_STEW_RATIO.out);
  });

  it('tending the fire lights kindling first, then sustains it with logs — real, bounded fuel use', () => {
    const tw = createTestWorld(80103, 30);
    const tavernId = tw.places.tavern;
    const cookP = addPerson(tw, 'Cook', 'cook', v(5, 1, 5), { workId: tavernId });
    createFire(tw.world, tavernId, v(5, 1, 5), false);
    addPlaceStock(tw.world, 'stick', 4, tavernId, cookP.id, undefined, 'x');
    expect(tendTavernFire(tw.world, cookP)).toBe(true);
    expect(fireAt(tw.world, tavernId)!.lit).toBe(true);
    expect(stockAt(tw.world, 'stick', tavernId)).toBe(2); // only the kindling actually used
  });
});

// ==================================================================== v0.8 §F — crafting
describe('practical crafting (v0.8 §F): functional requirements, not spawn-from-recipe-id', () => {
  it('a stone axe cannot be crafted with missing components — nothing consumed on failure', () => {
    const tw = createTestWorld(80201, 30);
    const p = addPerson(tw, 'Crafter', 'traveler', v(5, 1, 5));
    makeItem(tw.world, 'stick', 'stick', { owner: p.id, holder: p.id, quantity: 1 });
    // no stone, no herbs
    const result = craftItem(tw.world, p, 'stone_axe');
    expect(result.ok).toBe(false);
    expect(p.inventory.length).toBe(1); // the stick was never touched
  });

  it('stick + suitable stone + herbs (binding) crafts a real stone axe — functional matching, real conservation', () => {
    const tw = createTestWorld(80202, 30);
    const p = addPerson(tw, 'Crafter', 'traveler', v(5, 1, 5));
    const stick = makeItem(tw.world, 'stick', 'stick', { owner: p.id, holder: p.id, quantity: 1 });
    const stone = makeItem(tw.world, 'stone', 'block of stone', { owner: p.id, holder: p.id, quantity: 1 });
    const herbs = makeItem(tw.world, 'herbs', 'bundle of herbs', { owner: p.id, holder: p.id, quantity: 1 });
    expect(canCraft(tw.world, p, 'stone_axe')).toBe(true);
    const result = craftItem(tw.world, p, 'stone_axe');
    expect(result.ok).toBe(true);
    expect(result.result!.type).toBe('stoneaxe');
    expect(result.result!.ownerId).toBe(p.id);
    // components genuinely consumed (retired, not merely decremented to a dangling stack)
    expect(tw.world.item(stick.id)!.quantity).toBe(0);
    expect(tw.world.item(stone.id)!.quantity).toBe(0);
    expect(tw.world.item(herbs.id)!.quantity).toBe(0);
    expect(p.inventory).toContain(result.result!.id);
    expect(p.inventory).not.toContain(stick.id);
  });

  it('the crafter necessarily knows the affordance of what they just made', () => {
    const tw = createTestWorld(80203, 30);
    const p = addPerson(tw, 'Crafter', 'traveler', v(5, 1, 5));
    makeItem(tw.world, 'stick', 'stick', { owner: p.id, holder: p.id, quantity: 1 });
    makeItem(tw.world, 'stone', 'block of stone', { owner: p.id, holder: p.id, quantity: 1 });
    makeItem(tw.world, 'herbs', 'bundle of herbs', { owner: p.id, holder: p.id, quantity: 1 });
    expect(knowsAffordance(p, 'stoneaxe')).toBe(false);
    craftItem(tw.world, p, 'stone_axe');
    expect(knowsAffordance(p, 'stoneaxe')).toBe(true);
    expect(recognizedUses(p, 'stoneaxe')).toContain('fell trees');
  });

  it('a crafted stone axe is a REAL, weaker tool — physically usable, mechanically distinct from a forged one', () => {
    const tw = createTestWorld(80204, 30);
    const p = addPerson(tw, 'Crafter', 'traveler', v(5, 1, 5));
    makeItem(tw.world, 'stick', 'stick', { owner: p.id, holder: p.id, quantity: 1 });
    makeItem(tw.world, 'stone', 'block of stone', { owner: p.id, holder: p.id, quantity: 1 });
    makeItem(tw.world, 'herbs', 'bundle of herbs', { owner: p.id, holder: p.id, quantity: 1 });
    craftItem(tw.world, p, 'stone_axe');
    const stoneAxe = bestToolFor(tw.world, p, 'chop');
    expect(stoneAxe?.type).toBe('stoneaxe');
    const forgedAxe = makeItem(tw.world, 'axe', 'a felling axe', { owner: p.id, holder: p.id });
    // with BOTH tools available, the forged axe wins on real mechanical merit, not by name
    expect(bestToolFor(tw.world, p, 'chop')!.id).toBe(forgedAxe.id);
    expect(toolWorkMultiplier('chop', tw.world.item(bestToolFor(tw.world, p, 'chop')!.id) ?? null)).toBeGreaterThan(0);
  });

  it('a suitable-hardness requirement genuinely reads the material property, not a fixed item-type string', () => {
    const recipe = CRAFTING_RECIPES.stone_axe;
    const stoneReq = recipe.requires.find(r => r.materialId === 'stone')!;
    expect(stoneReq.minHardness).toBeGreaterThan(0);
    expect(materialOf('stone')!.hardness).toBeGreaterThanOrEqual(stoneReq.minHardness!);
  });
});
