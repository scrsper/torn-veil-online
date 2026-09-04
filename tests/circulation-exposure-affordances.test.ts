import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { createHaulTask, claimHaulTask, loadHaulCargo, depositHaulCargo } from '../src/sim/logistics/haul';
import { settleWholesale, wholesaleBuyerFor } from '../src/sim/world/trade';
import { createConstructionProject } from '../src/sim/world/construction';
import { stepPhysiology, comfortBand } from '../src/sim/core/physiology';
import { defaultPhysiology } from '../src/sim/core/physiology';
import { learnAffordance, knowsAffordance, recognizedUses } from '../src/sim/mind/knowledge';
import { extractFromNode } from '../src/sim/world/resources';
import type { ResourceNode } from '../src/sim/core/types';
import { interruptionSeverityMet } from '../src/sim/mind/commitment';

function haulWorld(seed: number) {
  const tw = createTestWorld(seed, 48);
  const src = makePlace(tw.world, 'farm', 'Source Farm', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
  const dst = makePlace(tw.world, 'mill', 'Dest Mill', { x0: 36, z0: 36, x1: 44, z1: 44, y0: 1, y1: 3 }, { inside: v(40, 1, 40), indoor: true });
  const farmer = addPerson(tw, 'Farmer', 'farmer', v(6, 1, 8), { workId: src.id });
  src.workers.push(farmer.id);
  const miller = addPerson(tw, 'Miller', 'miller', v(40, 1, 40), { workId: dst.id });
  dst.workers.push(miller.id);
  const hauler = addPerson(tw, 'Hauler', 'vagrant', v(6, 1, 8));
  return { tw, src, dst, farmer, miller, hauler };
}

// ==================================================================== v0.7 §A — wholesale trade
describe('wholesale trade (v0.7 §A): the real producer gets paid, not just the requester', () => {
  it('grain delivered to the mill pays the farm owner from the miller\'s wealth', () => {
    const { tw, src, dst, farmer, miller, hauler } = haulWorld(70001);
    addPlaceStock(tw.world, 'grain', 30, src.id, farmer.id, undefined, 'harvested');
    miller.wealth = 100; farmer.wealth = 0;
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 20, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    expect(task.materialSellerId).toBe(farmer.id); // captured from the stock's real owner
    depositHaulCargo(tw.world, task, hauler);
    expect(farmer.wealth).toBeGreaterThan(0); // the farmer, not the hauler, was paid for the grain itself
    expect(miller.wealth).toBeLessThan(100);
    expect(miller.wealth + farmer.wealth).toBe(100); // conserved — no currency invented
  });

  it('a self-delivery (same person on both sides) nets nothing — no pointless self-transfer', () => {
    const { tw, farmer } = haulWorld(70002);
    farmer.wealth = 40;
    const paid = settleWholesale(tw.world, farmer.id, farmer.id, 'grain', 10, 'someplace');
    expect(paid).toBe(0);
    expect(farmer.wealth).toBe(40);
  });

  it('never pays more than the buyer actually has — honest under-payment, never invented currency', () => {
    const { tw, src, dst, farmer, miller, hauler } = haulWorld(70003);
    addPlaceStock(tw.world, 'grain', 30, src.id, farmer.id, undefined, 'harvested');
    farmer.wealth = 0;
    miller.wealth = 2; // far less than the nominal price of 20 grain
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 20, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    depositHaulCargo(tw.world, task, hauler);
    expect(miller.wealth).toBe(0);
    expect(farmer.wealth).toBe(2); // capped at what the buyer had, not the nominal price
  });

  it('construction pays the material\'s real producer (whoever quarried it), not a fixed place role', () => {
    const tw = createTestWorld(70004, 60);
    const quarry = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const site = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 38, z1: 38, y0: 1, y1: 3 }, { inside: v(34, 1, 34), indoor: false });
    const owner = addPerson(tw, 'Owner', 'elder', v(34, 1, 34));
    owner.wealth = 50;
    const quarrier = addPerson(tw, 'Quarrier', 'vagrant', v(6, 1, 6)); // nobody's assigned "quarry worker" role
    quarrier.wealth = 0;
    const hauler = addPerson(tw, 'Hauler', 'vagrant', v(6, 1, 8));
    addPlaceStock(tw.world, 'stone', 10, quarry.id, quarrier.id, undefined, 'quarried');
    const project = createConstructionProject(tw.world, { name: 'test wall', template: 'storage_shed', siteBounds: { x0: 30, z0: 30, x1: 38, z1: 38, y0: 1, y1: 4 }, sitePlaceId: site.id, required: [{ type: 'stone', quantity: 5 }], ownerId: owner.id });
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 5, sourcePlaceId: quarry.id, destPlaceId: site.id, reason: 'x', requesterId: owner.id, projectId: project.id, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    expect(task.materialSellerId).toBe(quarrier.id);
    depositHaulCargo(tw.world, task, hauler);
    expect(quarrier.wealth).toBeGreaterThan(0);
    expect(owner.wealth).toBeLessThan(50);
    expect(wholesaleBuyerFor(tw.world, site.id, project.id)).toBe(owner.id);
  });

  it('bread hauled to a market stall is not wholesale-eligible — retail sale is the only revenue event there', () => {
    const tw = createTestWorld(70005, 40);
    expect(wholesaleBuyerFor(tw.world, makePlace(tw.world, 'stall', 'Stall', { x0: 2, z0: 2, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(4, 1, 4) }).id)).toBeUndefined();
  });
});

// ==================================================================== v0.7 §Exposure — wetness
describe('environmental exposure (v0.7): rain is not an instruction', () => {
  it('an outdoor person gets wetter in the rain; an indoor person stays dry', () => {
    const tw = createTestWorld(70101, 30);
    tw.world.weather = { kind: 'rain', intensity: 0.7, nextChangeAt: 999999, wind: 0.3 };
    const outdoor = addPerson(tw, 'Outdoor', 'traveler', v(5, 1, 5));
    const indoor = addPerson(tw, 'Indoor', 'traveler', v(5, 1, 5));
    outdoor.physiology = defaultPhysiology(); indoor.physiology = defaultPhysiology();
    for (let i = 0; i < 30; i++) {
      stepPhysiology(tw.world, outdoor, 0.05, 'idle', { indoor: false, daylight: 0.7 });
      stepPhysiology(tw.world, indoor, 0.05, 'idle', { indoor: true, daylight: 0.7 });
    }
    expect(outdoor.physiology.wetness).toBeGreaterThan(0.3);
    expect(indoor.physiology.wetness).toBe(0);
    expect(outdoor.needs.comfort).toBe(outdoor.physiology.wetness); // needs.comfort is DERIVED, not independent
  });

  it('brief/moderate exposure barely registers; sustained storm exposure crosses into "soaked"', () => {
    const tw = createTestWorld(70102, 30);
    tw.world.weather = { kind: 'rain', intensity: 0.5, nextChangeAt: 999999, wind: 0.3 };
    const p = addPerson(tw, 'P', 'traveler', v(5, 1, 5));
    p.physiology = defaultPhysiology();
    stepPhysiology(tw.world, p, 5 / 60, 'walk', { indoor: false, daylight: 0.7 }); // 5 minutes
    expect(comfortBand(p)).not.toBe('critical');
    // a full storm-soaked hour should read as clearly uncomfortable or worse
    const q = addPerson(tw, 'Q', 'traveler', v(5, 1, 5));
    q.physiology = defaultPhysiology();
    tw.world.weather.kind = 'storm'; tw.world.weather.intensity = 1;
    stepPhysiology(tw.world, q, 1, 'walk', { indoor: false, daylight: 0.7 });
    expect(['uncomfortable', 'urgent', 'critical']).toContain(comfortBand(q));
  });

  it('drying: wetness decays once sheltered or once the rain stops', () => {
    const tw = createTestWorld(70103, 30);
    tw.world.weather = { kind: 'storm', intensity: 1, nextChangeAt: 999999, wind: 0.3 };
    const p = addPerson(tw, 'P', 'traveler', v(5, 1, 5));
    p.physiology = defaultPhysiology();
    stepPhysiology(tw.world, p, 1, 'idle', { indoor: false, daylight: 0.7 });
    const wetAfterStorm = p.physiology.wetness;
    expect(wetAfterStorm).toBeGreaterThan(0.5);
    tw.world.weather.kind = 'clear'; tw.world.weather.intensity = 0;
    stepPhysiology(tw.world, p, 2, 'idle', { indoor: true, daylight: 0.7 });
    expect(p.physiology.wetness).toBeLessThan(wetAfterStorm);
  });

  it('a committed haul/build goal can never be interrupted by shelter, at any exposure severity — only eat/drink/sleep distress may break a `committed` commitment (mind/commitment.ts)', () => {
    // `shelter`'s own utility formula (mind/agent.ts) now scales with accumulated wetness, but
    // that utility can only ever compete for a FRESH goal choice — a `committed` haul/build goal
    // is structurally immune to it regardless of how high shelter's utility climbs, because
    // `interruptionSeverityMet` only recognizes eat/drink_water/sleep as interrupting need types.
    // This is what actually guarantees "committed destination + rain -> keeps going", independent
    // of the specific utility numbers — verified directly against the real function, at the most
    // extreme comfort severity, so a future retune of the utility formula cannot silently break it.
    expect(interruptionSeverityMet('committed', 'shelter', { hunger: 'comfortable', thirst: 'comfortable', sleep: 'comfortable' })).toBe(false);
  });
});

// ==================================================================== v0.7 §Affordances
describe('affordance foundation (v0.7): identity/composition/affordance are physical; recognized USE is knowledge', () => {
  it('a fresh person with no knowledge recognizes nothing about a real axe next to them — non-omniscience', () => {
    const tw = createTestWorld(70201, 30);
    const p = addPerson(tw, 'Stranger', 'traveler', v(5, 1, 5));
    expect(knowsAffordance(p, 'axe')).toBe(false);
    expect(recognizedUses(p, 'axe')).toEqual([]);
  });

  it('generation-time seeding: a woodcutter starts recognizing an axe\'s uses', () => {
    const tw = createTestWorld(70202, 30);
    const woodcutter = addPerson(tw, 'Bors', 'woodcutter', v(5, 1, 5));
    learnAffordance(tw.world, woodcutter, 'axe', { type: 'prior' });
    expect(knowsAffordance(woodcutter, 'axe')).toBe(true);
    expect(recognizedUses(woodcutter, 'axe')).toContain('fell trees');
  });

  it('learning by doing: actually using an axe to fell a tree teaches its affordance', () => {
    const tw = createTestWorld(70203, 30);
    const p = addPerson(tw, 'Newcomer', 'traveler', v(5, 1, 5));
    expect(knowsAffordance(p, 'axe')).toBe(false);
    const axe = makeItem(tw.world, 'axe', 'an axe', { owner: p.id, holder: p.id });
    p.inventory.push(axe.id);
    const dropPlace = makePlace(tw.world, 'wilderness', 'Grove', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const node: ResourceNode = {
      id: tw.world.nextId('node'), kind: 'tree', pos: v(6, 1, 6), placeId: dropPlace.id, dropPlaceId: dropPlace.id,
      yield: 'log', remaining: 10, capacity: 10, state: 'available', renewable: true, regrowHours: 100, blocks: [],
    };
    tw.world.resourceNodes.push(node);
    extractFromNode(tw.world, node, p);
    expect(knowsAffordance(p, 'axe')).toBe(true);
    expect(recognizedUses(p, 'axe')).toContain('fell trees');
  });

  it('physical capability (tools.ts) is unaffected by affordance knowledge — an unrecognized axe still works mechanically', () => {
    const tw = createTestWorld(70204, 30);
    const p = addPerson(tw, 'Stranger', 'traveler', v(5, 1, 5));
    const axe = makeItem(tw.world, 'axe', 'an axe', { owner: p.id, holder: p.id });
    p.inventory.push(axe.id);
    const dropPlace = makePlace(tw.world, 'wilderness', 'Grove', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const node: ResourceNode = {
      id: tw.world.nextId('node'), kind: 'tree', pos: v(6, 1, 6), placeId: dropPlace.id, dropPlaceId: dropPlace.id,
      yield: 'log', remaining: 10, capacity: 10, state: 'available', renewable: true, regrowHours: 100, blocks: [],
    };
    tw.world.resourceNodes.push(node);
    expect(knowsAffordance(p, 'axe')).toBe(false); // does not recognize it yet
    const got = extractFromNode(tw.world, node, p); // but can still physically use it
    expect(got).toBeGreaterThan(0);
    expect(stockAt(tw.world, 'log', dropPlace.id)).toBe(got);
  });
});
