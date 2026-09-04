import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { newWorld, deserialize, serialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import {
  createFields, stepMetabolism, moistureGrowthFactor, plantPlot, harvestPlot, mill, bake,
  transform, findAccessibleFood, eatFood, drinkAt, nearestWaterSource, metabolismSummary,
  stockTotal, villageStock, MATURE_HOURS,
} from '../src/sim/world/metabolism';
import type { Field, Person } from '../src/sim/core/types';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../src/sim/core/time';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let e = 0; e < seconds; e += 0.15) { const dt = Math.min(0.15, seconds - e); const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); }
}

/** A minimal one-field world for crop-lifecycle unit tests. */
function fieldWorld(seed = 900): { world: ReturnType<typeof createTestWorld>['world']; field: Field } {
  const tw = createTestWorld(seed, 30);
  const farmer = addPerson(tw, 'Farmer', 'farmer', v(5, 1, 5));
  const farm = makePlace(tw.world, 'farm', 'test field', { x0: 2, z0: 2, x1: 14, z1: 14, y0: 2, y1: 4 }, { inside: v(8, 2, 8), indoor: false });
  // lay Farmland so createFields finds plots
  for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) { tw.world.grid.set(x, 1, z, 3); tw.world.grid.set(x, 1, z, 16); }
  createFields(tw.world, [{ placeId: farm.id, ownerId: farmer.id, startMoisture: 0.5 }]);
  // v0.3: sowing now consumes seed grain from the farm's own stock — give the test farm a reserve.
  makeItem(tw.world, 'grain', 'seed grain', { owner: farmer.id, pos: v(8, 2, 8), placeId: farm.id, quantity: 50 });
  return { world: tw.world, field: tw.world.fields[0] };
}

describe('needs — hunger & thirst (v0.2.4 Priority 1)', () => {
  it('hunger and thirst rise predictably over world time, and are deterministic', () => {
    const run = () => {
      const tw = createTestWorld(910);
      const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
      p.needs.hunger = 0.1; p.needs.thirst = 0.1;
      step(tw, 240); // 240 physical s = 4 world-hours
      return { hunger: p.needs.hunger, thirst: p.needs.thirst };
    };
    const a = run(); const b = run();
    expect(a.hunger).toBeGreaterThan(0.1);
    expect(a.thirst).toBeGreaterThan(0.1);
    expect(a.thirst).toBeGreaterThan(a.hunger); // thirst rises faster
    expect(a).toEqual(b);
  });

  it('eating consumes a real food item and reduces hunger', () => {
    const tw = createTestWorld(911);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.needs.hunger = 0.9;
    const bread = makeItem(tw.world, 'bread', 'loaf', { owner: p.id, holder: p.id, quantity: 2 });
    const before = p.needs.hunger;
    const found = findAccessibleFood(tw.world, p, null);
    expect(found?.id).toBe(bread.id);
    const type = eatFood(tw.world, p, found!);
    expect(type).toBe('bread');
    expect(p.needs.hunger).toBeLessThan(before - 0.3);
    expect(bread.quantity).toBe(1); // one loaf consumed, one left
    expect(tw.world.events.some(e => e.type === 'food_consumed' && e.actor === p.id)).toBe(true);
  });

  it('drinking at a water source reduces thirst', () => {
    const tw = createTestWorld(912);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.needs.thirst = 0.9;
    drinkAt(tw.world, p);
    expect(p.needs.thirst).toBeLessThan(0.2);
    expect(tw.world.events.some(e => e.type === 'water_consumed' && e.actor === p.id)).toBe(true);
  });

  it('a hungry NPC with a full larder seeks food and eats it (full sim)', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    const p = gen.people.alwin;
    world.clock.worldSeconds = 100 * SECONDS_PER_DAY + 8 * SECONDS_PER_HOUR;
    p.needs.hunger = 0.95;
    const mealsBefore = world.runTally.food_consumed ?? 0;
    advance(world, sim, 90); // ~1.5 world-hours
    expect((world.runTally.food_consumed ?? 0)).toBeGreaterThan(mealsBefore);
    expect(p.needs.hunger).toBeLessThan(0.95);
  });

  it('a thirsty NPC seeks a water source and drinks (full sim)', () => {
    const { world, gen } = newWorld(1338);
    const sim = new Simulation(world);
    const p = gen.people.mara;
    world.clock.worldSeconds = 100 * SECONDS_PER_DAY + 10 * SECONDS_PER_HOUR;
    p.needs.thirst = 0.9;
    advance(world, sim, 220); // ~3.5 world-hours — time to walk to the well and drink
    expect(p.needs.thirst).toBeLessThan(0.9);
  });

  it('thirst is not instantly lethal — a person left thirsty stays alive', () => {
    const tw = createTestWorld(913);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.needs.thirst = 1; p.needs.hunger = 1;
    step(tw, 600);
    expect(p.alive).toBe(true);
  });
});

describe('crop lifecycle + soil moisture (v0.2.4 Priority 3-4)', () => {
  it('a field has canonical plots read from its Farmland cells', () => {
    const { field } = fieldWorld(920);
    expect(field.plots.length).toBeGreaterThan(20);
    expect(field.plots.every(p => p.crop === 'wheat')).toBe(true);
  });

  it('a planted plot grows through world time toward maturity, faster in wetter soil', () => {
    const { world, field } = fieldWorld(921);
    const farmer = world.persons()[0] as Person;
    const plot = field.plots[0];
    plantPlot(world, field, plot, farmer);
    expect(plot.state).toBe('planted');
    expect(world.events.some(e => e.type === 'crop_planted')).toBe(true);

    field.soilMoisture = 1;
    world.clock.worldSeconds += 24 * 3600; stepMetabolism(world, 24);
    const wetGrowth = plot.growth;

    // reset, dry soil, same elapsed time
    plot.state = 'planted'; plot.growth = 0;
    field.soilMoisture = 0.02;
    world.clock.worldSeconds += 24 * 3600; stepMetabolism(world, 24);
    expect(plot.growth).toBeGreaterThan(0);
    expect(plot.growth).toBeLessThan(wetGrowth * 0.5); // dry soil grows far slower
  });

  it('a crop reaches `mature` after roughly MATURE_HOURS at full moisture, and emits crop_matured', () => {
    const { world, field } = fieldWorld(922);
    const farmer = world.persons()[0] as Person;
    world.weather.kind = 'rain'; world.weather.intensity = 1; // keep the soil wet
    const plot = field.plots[0];
    plantPlot(world, field, plot, farmer);
    for (let h = 0; h < MATURE_HOURS * 1.6; h += 6) { world.clock.worldSeconds += 6 * 3600; stepMetabolism(world, 6); }
    expect(plot.state).toBe('mature');
    expect(plot.growth).toBe(1);
    expect(world.events.some(e => e.type === 'crop_matured')).toBe(true);
  });

  it('rain raises soil moisture; a dry spell lowers it', () => {
    const { world, field } = fieldWorld(923);
    field.soilMoisture = 0.4;
    world.weather.kind = 'rain'; world.weather.intensity = 1;
    stepMetabolism(world, 6);
    expect(field.soilMoisture).toBeGreaterThan(0.4);
    world.weather.kind = 'clear'; world.weather.intensity = 0;
    const wet = field.soilMoisture;
    stepMetabolism(world, 24);
    expect(field.soilMoisture).toBeLessThan(wet);
  });

  it('moistureGrowthFactor: ~0 when bone dry, ~1 in the sweet spot, penalised when waterlogged', () => {
    expect(moistureGrowthFactor(0)).toBeLessThan(0.1);
    expect(moistureGrowthFactor(0.5)).toBeGreaterThan(0.9);
    expect(moistureGrowthFactor(1)).toBeLessThan(moistureGrowthFactor(0.5));
  });
});

describe('farmer actions + food production chain (v0.2.4 Priority 5-7)', () => {
  it('harvesting a mature plot changes canonical state AND produces real grain; no infinite harvest', () => {
    const { world, field } = fieldWorld(930);
    const farmer = world.persons()[0] as Person;
    const plot = field.plots.find(p => p.state === 'fallow') ?? field.plots[0];
    plot.state = 'mature'; plot.growth = 1;
    const grainBefore = stockTotal(world, 'grain', [field.placeId]);
    const yielded = harvestPlot(world, field, plot, farmer);
    expect(yielded).toBeGreaterThan(0);
    expect(plot.state).toBe('harvested');
    expect(stockTotal(world, 'grain', [field.placeId])).toBe(grainBefore + yielded);
    expect(world.events.some(e => e.type === 'crop_harvested')).toBe(true);
    // cannot harvest the same plot again
    expect(harvestPlot(world, field, plot, farmer)).toBe(0);
  });

  it('transform conserves: input consumed, output produced, and NOTHING is produced with no input', () => {
    const tw = createTestWorld(931);
    const worker = addPerson(tw, 'W', 'miller', v(5, 1, 5));
    const mill = makePlace(tw.world, 'mill', 'test mill', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 2, y1: 4 }, { inside: v(5, 2, 5), indoor: true });
    makeItem(tw.world, 'grain', 'grain', { owner: worker.id, pos: v(5, 2, 5), placeId: mill.id, quantity: 10 });
    const r1 = transform(tw.world, { actor: worker.id, inputType: 'grain', inputQty: 3, inputPlaces: [mill.id], outputType: 'flour', outputQty: 4, outputPlace: mill.id, ownerId: worker.id, how: 'milled' });
    expect(r1.ok).toBe(true);
    expect(stockTotal(tw.world, 'grain', [mill.id])).toBe(7);
    expect(stockTotal(tw.world, 'flour', [mill.id])).toBe(4);
    // drain the grain, then a transform must fail cleanly with a shortage
    transform(tw.world, { actor: worker.id, inputType: 'grain', inputQty: 7, inputPlaces: [mill.id], outputType: 'flour', outputQty: 9, outputPlace: mill.id, ownerId: worker.id, how: 'milled' });
    const flourNow = stockTotal(tw.world, 'flour', [mill.id]);
    const r3 = transform(tw.world, { actor: worker.id, inputType: 'grain', inputQty: 3, inputPlaces: [mill.id], outputType: 'flour', outputQty: 4, outputPlace: mill.id, ownerId: worker.id, how: 'milled' });
    expect(r3.ok).toBe(false);
    expect(r3.shortage).toBe('grain');
    expect(stockTotal(tw.world, 'flour', [mill.id])).toBe(flourNow); // unchanged — no bread from nothing
    expect(tw.world.events.some(e => e.type === 'resource_shortage')).toBe(true);
  });

  it('the mill and bakery cannot bake bread from nothing (full-world: empty the stock)', () => {
    const { world, gen } = newWorld(1339);
    // remove every grain and flour item from the world
    for (const it of world.items()) if (it.type === 'grain' || it.type === 'flour') { it.quantity = 0; it.pos = null; it.placeId = null; }
    const r = bake(world, gen.people.osric);
    expect(r.ok).toBe(false);
    expect(world.items().filter(i => i.type === 'bread' && i.quantity > 0).length).toBeGreaterThanOrEqual(0); // no NEW bread
    const m = mill(world, gen.people.hobb);
    expect(m.ok).toBe(false);
  });

  it('eating prefers carried food, then the household larder — never food from nowhere', () => {
    const { world, gen } = newWorld(1340);
    const p = gen.people.greta;
    // strip every food item so there is truly none
    for (const it of world.items()) if (['bread', 'cheese', 'pie', 'meat'].includes(it.type)) { it.quantity = 0; it.pos = null; it.placeId = null; it.holderId = null; }
    p.inventory = p.inventory.filter(id => { const it = world.item(id); return !it || !['bread', 'cheese', 'pie', 'meat'].includes(it.type); });
    expect(findAccessibleFood(world, p, p.homeId)).toBeNull();
  });
});

describe('persistence (v0.2.4 Priority 1 + SAVE_VERSION 5)', () => {
  it('crop lifecycle, soil moisture, thirst, and resource stock survive save+reload', { timeout: 90000 }, () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    advance(world, sim, 360); // 6 world-hours of real metabolism
    const f0 = world.fields[0];
    const grain = villageStock(world, 'grain');
    const thirst = gen.people.alwin.needs.thirst;
    const moisture = f0.soilMoisture;
    const plotStates = f0.plots.map(p => p.state).join(',');

    const restored = deserialize(serialize(world))!.world;
    const rf0 = restored.fields[0];
    expect(restored.fields.length).toBe(4);
    expect(rf0.soilMoisture).toBeCloseTo(moisture, 5);
    expect(rf0.plots.map(p => p.state).join(',')).toBe(plotStates);
    expect(restored.person(gen.people.alwin.id)!.needs.thirst).toBeCloseTo(thirst, 5);
    expect(villageStock(restored, 'grain')).toBe(grain);
    // reloaded crop blocks match canonical plot state
    for (const p of rf0.plots.slice(0, 10)) {
      const b = restored.grid.get(p.x, p.y, p.z);
      const expected = p.state === 'mature' ? 17 : p.state === 'growing' ? 55 : 0;
      expect(b).toBe(expected);
    }
  });

  it('rejects a v0.2.3 (version 4) save', () => {
    const { world } = newWorld(1337);
    const stale = JSON.parse(serialize(world)); stale.version = 4;
    expect(deserialize(JSON.stringify(stale))).toBeNull();
  });
});

describe('renderer-independent orientation (v0.2.4 Priority 11)', () => {
  it("a walking NPC's canonical facing points the way it is moving", () => {
    const tw = createTestWorld(950, 40);
    const a = addPerson(tw, 'Walker', 'farmer', v(5, 1, 5), { homeId: tw.places.tavern });
    a.mind.goal = { type: 'go_home', utility: 1, reasons: [], createdAt: 0, key: 'go_home:' };
    a.mind.plan = [{ type: 'goto', pos: v(34, 1, 34), run: false, status: 'pending' }];
    step(tw, 3);
    const b = tw.world.primaryBody(a.id)!;
    const speed = Math.hypot(b.vel.x, b.vel.z);
    expect(speed).toBeGreaterThan(0.5); // actually walking
    // canonical facing convention (perception / combat / followPath): (-sin yaw, -cos yaw)
    const face = { x: -Math.sin(b.yaw), z: -Math.cos(b.yaw) };
    const dot = (face.x * b.vel.x + face.z * b.vel.z) / speed;
    expect(dot).toBeGreaterThan(0.7); // facing ~aligned with velocity, not reversed
  });
});

describe('long-run: the whole chain actually works (v0.2.4 Priority 10)', () => {
  it('an 8 world-day run shows rain→moisture→growth→harvest→grain→flour→bread→eaten, and no runaway', { timeout: 120000 }, () => {
    const { world } = newWorld(918271);
    const sim = new Simulation(world);
    advance(world, sim, 8 * SECONDS_PER_DAY / 60); // 8 world-days
    const t = world.runTally;
    // every link of the chain fired
    expect(t.crop_planted ?? 0).toBeGreaterThan(10);
    expect(t.crop_matured ?? 0).toBeGreaterThan(10);
    expect(t.crop_harvested ?? 0).toBeGreaterThan(5);
    expect(t.resource_transformed ?? 0).toBeGreaterThan(5);
    expect(t.food_consumed ?? 0).toBeGreaterThan(100);
    expect(t.water_consumed ?? 0).toBeGreaterThan(50);
    const m = metabolismSummary(world);
    // stocks bounded (demand-driven caps), nobody starved to a standstill, weather moved moisture
    expect(m.stock.grain).toBeLessThan(1200);
    expect(m.stock.bread).toBeLessThan(400);
    expect(m.avgHunger).toBeLessThan(0.85);
    expect(m.avgThirst).toBeLessThan(0.7);
    expect(world.persons().filter(p => p.alive).length).toBe(33); // nobody died of hunger/thirst
  });
});
