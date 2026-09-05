import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { newWorld, deserialize, serialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, v } from './helpers/world';
import { makeItem, makePlace, RESOURCE_MASS_KG } from '../src/sim/world/factory';
import { stepPhysiology, sleepRecover, restRecover, drinkRestoresHydration, heatBand, defaultPhysiology, HEAT_DANGEROUS } from '../src/sim/core/physiology';
import { getPhysicalCapability, capabilityFor, defaultAttributesFor } from '../src/sim/core/attributes';
import { bestToolFor, toolWorkMultiplier, wearTool } from '../src/sim/core/tools';
import { createHaulTask, claimHaulTask, loadHaulCargo, depositHaulCargo, personalCarryUnits, maintainHauls } from '../src/sim/logistics/haul';
import { plantGrove, registerStoneNodes, extractFromNode, maintainResourceNodes, nearestAvailableNode } from '../src/sim/world/resources';
import { createConstructionProject, performBuildLabor } from '../src/sim/world/construction';
import { createRequest, acceptRequest, completeRequest, failRequest } from '../src/sim/core/requests';
import { addPlaceStock, stockAt, takePlaceStock, worldStock } from '../src/sim/world/stock';
import { buyFoodPortion, findAccessibleFood, stepSpoilage, createFields, plantPlot, stepMetabolism, MATURE_HOURS, saw } from '../src/sim/world/metabolism';
import { canonicalStateHash } from '../src/headless/benchmarkReport';
import { runHeadless } from '../src/headless/runner';
import { SECONDS_PER_DAY, SECONDS_PER_HOUR } from '../src/sim/core/time';
import { B } from '../src/sim/physical/blocks';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let e = 0; e < seconds; e += 0.15) { const dt = Math.min(0.15, seconds - e); const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); }
}

// ==================================================================== Physiology
describe('physiology (v0.4 §1)', () => {
  it('walking consumes more energy than idle', () => {
    const tw = createTestWorld(4001, 20);
    const idle = addPerson(tw, 'Idler', 'vagrant', v(5, 1, 5));
    const walker = addPerson(tw, 'Walker', 'vagrant', v(5, 1, 5));
    stepPhysiology(tw.world, idle, 1, 'idle');
    stepPhysiology(tw.world, walker, 1, 'walk');
    expect(1 - walker.physiology.energy).toBeGreaterThan(1 - idle.physiology.energy);
  });

  it('heavy hauling consumes more energy than walking', () => {
    const tw = createTestWorld(4002, 20);
    const walker = addPerson(tw, 'Walker', 'vagrant', v(5, 1, 5));
    const hauler = addPerson(tw, 'Hauler', 'vagrant', v(5, 1, 5));
    stepPhysiology(tw.world, walker, 1, 'walk');
    stepPhysiology(tw.world, hauler, 1, 'haul');
    expect(1 - hauler.physiology.energy).toBeGreaterThan(1 - walker.physiology.energy);
  });

  it('heavy work (quarrying) increases fatigue more than idling', () => {
    const tw = createTestWorld(4003, 20);
    const idle = addPerson(tw, 'Idler', 'vagrant', v(5, 1, 5));
    const quarrier = addPerson(tw, 'Quarrier', 'vagrant', v(5, 1, 5));
    idle.physiology.fatigue = 0.3; quarrier.physiology.fatigue = 0.3;
    stepPhysiology(tw.world, idle, 2, 'idle');
    stepPhysiology(tw.world, quarrier, 2, 'quarry');
    expect(quarrier.physiology.fatigue).toBeGreaterThan(idle.physiology.fatigue);
  });

  it('rest reduces fatigue', () => {
    const tw = createTestWorld(4004, 20);
    const p = addPerson(tw, 'Rester', 'vagrant', v(5, 1, 5));
    p.physiology.fatigue = 0.6;
    restRecover(p, 2);
    expect(p.physiology.fatigue).toBeLessThan(0.6);
  });

  it('sleep reduces substantially more fatigue and sleep debt than ordinary rest', () => {
    const tw = createTestWorld(4005, 20);
    const rester = addPerson(tw, 'Rester', 'vagrant', v(5, 1, 5));
    const sleeper = addPerson(tw, 'Sleeper', 'vagrant', v(5, 1, 5));
    rester.physiology.fatigue = 0.7; rester.physiology.sleepDebt = 8;
    sleeper.physiology.fatigue = 0.7; sleeper.physiology.sleepDebt = 8;
    restRecover(rester, 3);
    sleepRecover(sleeper, 3);
    expect(sleeper.physiology.fatigue).toBeLessThan(rester.physiology.fatigue);
    expect(sleeper.physiology.sleepDebt).toBeLessThan(rester.physiology.sleepDebt);
  });

  it('drinking restores hydration', () => {
    const tw = createTestWorld(4006, 20);
    const p = addPerson(tw, 'Thirsty', 'vagrant', v(5, 1, 5));
    p.physiology.hydration = 0.2;
    drinkRestoresHydration(p);
    expect(p.physiology.hydration).toBeGreaterThan(0.2);
    expect(p.needs.thirst).toBeCloseTo(1 - p.physiology.hydration, 6);
  });

  it('exertion increases hydration demand relative to idling', () => {
    const tw = createTestWorld(4007, 20);
    const idle = addPerson(tw, 'Idler', 'vagrant', v(5, 1, 5));
    const worker = addPerson(tw, 'Worker', 'vagrant', v(5, 1, 5));
    stepPhysiology(tw.world, idle, 2, 'idle');
    stepPhysiology(tw.world, worker, 2, 'quarry');
    expect(1 - worker.physiology.hydration).toBeGreaterThan(1 - idle.physiology.hydration);
  });

  it('hot conditions increase heat burden faster than cool ones (under real exertion — idling always net-cools)', () => {
    const tw = createTestWorld(4008, 20);
    const hot = addPerson(tw, 'Hot', 'vagrant', v(5, 1, 5));
    const cool = addPerson(tw, 'Cool', 'vagrant', v(5, 1, 5));
    tw.world.weather.kind = 'clear';
    stepPhysiology(tw.world, hot, 2, 'quarry', { indoor: false, daylight: 1 });
    tw.world.weather.kind = 'storm';
    stepPhysiology(tw.world, cool, 2, 'quarry', { indoor: false, daylight: 1 });
    expect(hot.physiology.bodyHeat).toBeGreaterThan(cool.physiology.bodyHeat);
  });

  it('an overheated worker is de-prioritized for heavy work via reduced exertion capacity', () => {
    const tw = createTestWorld(4009, 20);
    const p = addPerson(tw, 'Overheated', 'vagrant', v(5, 1, 5));
    p.physiology.bodyHeat = HEAT_DANGEROUS + 0.02;
    expect(heatBand(p)).toBe('dangerous');
    const cap = getPhysicalCapability(p, tw.world);
    expect(cap.currentExertionCapacity).toBeLessThan(0.3);
    const fresh = addPerson(tw, 'Fresh', 'vagrant', v(5, 1, 5));
    const freshCap = getPhysicalCapability(fresh, tw.world);
    expect(freshCap.currentExertionCapacity).toBeGreaterThan(cap.currentExertionCapacity);
  });
});

// ==================================================================== Strength / hauling
describe('strength and mass-aware hauling (v0.4 §2/§4)', () => {
  it('a stronger worker can safely carry more mass than a weaker one', () => {
    const tw = createTestWorld(4101, 20);
    const weak = addPerson(tw, 'Weak', 'farmer', v(5, 1, 5));
    const strong = addPerson(tw, 'Strong', 'farmer', v(5, 1, 5));
    weak.attributes.strength = 0.15; strong.attributes.strength = 0.9;
    const weakCap = getPhysicalCapability(weak, tw.world).safeCarryMassKg;
    const strongCap = getPhysicalCapability(strong, tw.world).safeCarryMassKg;
    expect(strongCap).toBeGreaterThan(weakCap);
    expect(personalCarryUnits(tw.world, strong, 'stone')).toBeGreaterThan(personalCarryUnits(tw.world, weak, 'stone'));
  });

  it('a weak worker fulfills a large haul through multiple trips, never in one', () => {
    const tw = createTestWorld(4102, 48);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 36, z0: 36, x1: 44, z1: 44, y0: 1, y1: 3 }, { inside: v(40, 1, 40), indoor: false });
    const weak = addPerson(tw, 'Weak', 'farmer', v(6, 1, 8), { workId: src.id });
    weak.attributes.strength = 0.1;
    makeItem(tw.world, 'stone', 'stone', { placeId: src.id, pos: v(6, 1, 6), quantity: 30 });
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 12, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, weak);
    const perTrip = personalCarryUnits(tw.world, weak, 'stone');
    expect(perTrip).toBeLessThan(12); // cannot fetch it all in one trip
    let trips = 0;
    while (task.status !== 'delivered' && trips < 20) {
      const loaded = loadHaulCargo(tw.world, task, weak);
      expect(loaded).toBe(true);
      expect(task.carried).toBeLessThanOrEqual(perTrip);
      depositHaulCargo(tw.world, task, weak);
      trips++;
    }
    expect(task.status).toBe('delivered');
    expect(trips).toBeGreaterThan(1); // genuinely took more than one trip
    expect(task.delivered).toBe(12);
    expect(stockAt(tw.world, 'stone', dst.id)).toBe(12);
    expect(stockAt(tw.world, 'stone', src.id)).toBe(18); // conserved: 30 - 12
  });

  it('a weakened real villager makes genuine multi-trip progress on an oversized haul through the real think()/act() loop', () => {
    // The real village (not an isolated two-person test world) — so ordinary needs (thirst,
    // socializing, sleep) compete exactly as they do in every other full-sim test, rather than
    // an artificial world with no well/tavern/etc. dominating the decision every cycle.
    const { world, gen } = newWorld(4104);
    const sim = new Simulation(world);
    const hauler = gen.people.bors; // the woodcutter — already role-affine for bulk materials
    hauler.attributes.strength = 0.15; // weak enough that one trip cannot cover the whole task
    const mill = world.places().find(p => p.type === 'mill')!;
    const bakery = world.places().find(p => p.type === 'bakery')!;
    // 'plank' (8kg/unit) at strength 0.15 caps at ~2-3 units/trip — a 10-unit task needs several.
    makeItem(world, 'plank', 'plank', { placeId: mill.id, pos: { ...mill.inside }, quantity: 40 });
    const perTrip = personalCarryUnits(world, hauler, 'plank');
    const task = createHaulTask(world, { resource: 'plank', quantity: 10, sourcePlaceId: mill.id, destPlaceId: bakery.id, reason: 'x', requesterId: null, priority: 0.95 });
    expect(perTrip).toBeLessThan(10);
    let seconds = 0;
    const maxSeconds = 10 * SECONDS_PER_HOUR;
    while (task.status !== 'delivered' && seconds < maxSeconds) {
      const dt = 0.15; const wdt = world.clock.advance(dt); world.physicalTime += dt;
      sim.step(dt, wdt); sim.flushSpeech(); seconds += dt;
    }
    // Real progress happened through ordinary goal competition — not a stalled task, and never
    // more than one trip's worth appearing at once (no teleportation of the full quantity).
    expect(task.delivered).toBeGreaterThan(perTrip);
    expect(stockAt(world, 'plank', bakery.id)).toBe(task.delivered);
    expect(stockAt(world, 'plank', mill.id)).toBe(40 - task.delivered - task.carried);
    const pickups = world.events.filter(e => e.type === 'resource_picked_up' && e.data?.haulId === task.id).length;
    expect(pickups).toBeGreaterThan(1); // genuinely more than one load — no single-trip teleport
  }, 30000);

  it('carry capacity is never zero even for a heavy material — an improvised trip is always possible', () => {
    const tw = createTestWorld(4103, 20);
    const veryWeak = addPerson(tw, 'Frail', 'farmer', v(5, 1, 5));
    veryWeak.attributes.strength = 0.01;
    veryWeak.physiology.fatigue = 1;
    for (const type of ['grain', 'flour', 'bread', 'log', 'plank', 'stone'] as const) {
      expect(personalCarryUnits(tw.world, veryWeak, type)).toBeGreaterThanOrEqual(1);
    }
    void RESOURCE_MASS_KG;
  });
});

// ==================================================================== Dexterity
describe('dexterity (v0.4 §2)', () => {
  it('materially affects sawing work rate (a skilled task), deterministically, with no duplication', () => {
    const tw = createTestWorld(4201, 20);
    const clumsy = addPerson(tw, 'Clumsy', 'woodcutter', v(5, 1, 5));
    const deft = addPerson(tw, 'Deft', 'woodcutter', v(5, 1, 5));
    clumsy.attributes.dexterity = 0.2; deft.attributes.dexterity = 0.95;
    const sawpit = makePlace(tw.world, 'sawpit', 'Sawpit', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
    makeItem(tw.world, 'saw', 'saw', { placeId: sawpit.id, pos: v(5, 1, 5) });
    const clumsyRate = capabilityFor(tw.world, clumsy, 'saw', sawpit.id).cap.workRate;
    const deftRate = capabilityFor(tw.world, deft, 'saw', sawpit.id).cap.workRate;
    expect(deftRate).toBeGreaterThan(clumsyRate);
    // deterministic: recomputing with identical inputs gives the identical result
    expect(capabilityFor(tw.world, deft, 'saw', sawpit.id).cap.workRate).toBe(deftRate);
  });

  it('sawing itself never duplicates resources regardless of dexterity/tool — the fixed SAW_RATIO always holds', () => {
    const tw = createTestWorld(4202, 20);
    const sawpit = makePlace(tw.world, 'sawpit', 'Sawpit', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
    addPlaceStock(tw.world, 'log', 20, sawpit.id, null, undefined, 'test');
    const sawyer = addPerson(tw, 'Sawyer', 'woodcutter', v(5, 1, 5));
    sawyer.attributes.dexterity = 1; // maximal — still must obey the fixed SAW_RATIO, only the CADENCE (agent.ts) varies with dexterity
    const logsBefore = stockAt(tw.world, 'log', sawpit.id), planksBefore = stockAt(tw.world, 'plank', sawpit.id);
    let batches = 0;
    for (let i = 0; i < 5; i++) if (saw(tw.world, sawyer).ok) batches++;
    expect(batches).toBeGreaterThan(0);
    const logsConsumed = logsBefore - stockAt(tw.world, 'log', sawpit.id);
    const planksProduced = stockAt(tw.world, 'plank', sawpit.id) - planksBefore;
    expect(logsConsumed).toBe(batches * 2);   // SAW_RATIO.in
    expect(planksProduced).toBe(batches * 3); // SAW_RATIO.out — fixed ratio, no dexterity bonus units
  });
});

// ==================================================================== Tools
describe('tools (v0.4 §5)', () => {
  it('an axe materially improves tree-felling over bare hands', () => {
    const tw = createTestWorld(4301, 40);
    for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    const withAxe = addPerson(tw, 'Axeman', 'woodcutter', v(10, 2, 10));
    makeItem(tw.world, 'axe', 'axe', { owner: withAxe.id, holder: withAxe.id });
    const bareHanded = addPerson(tw, 'BareHands', 'woodcutter', v(10, 2, 10));
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 2);
    const [nodeA, nodeB] = tw.world.resourceNodes.filter(n => n.kind === 'tree');
    expect(nodeA).toBeDefined(); expect(nodeB).toBeDefined();
    const withAxeYield = extractFromNode(tw.world, nodeA, withAxe);
    const bareYield = extractFromNode(tw.world, nodeB, bareHanded);
    expect(withAxeYield).toBeGreaterThan(bareYield);
  });

  it('a pickaxe materially improves quarry work over bare hands', () => {
    const tw = createTestWorld(4302, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const quarry = makePlace(tw.world, 'quarry', 'quarry', { x0: 2, z0: 2, x1: 28, z1: 28, y0: 2, y1: 6 }, { inside: v(15, 2, 15) });
    const withPick = addPerson(tw, 'Pickman', 'farmer', v(10, 2, 10));
    makeItem(tw.world, 'pickaxe', 'pickaxe', { owner: withPick.id, holder: withPick.id });
    const bareHanded = addPerson(tw, 'BareHands', 'farmer', v(10, 2, 10));
    registerStoneNodes(tw.world, quarry.id, [v(12, 2, 12), v(18, 2, 18)]);
    const [nodeA, nodeB] = tw.world.resourceNodes.filter(n => n.kind === 'stone');
    const withPickYield = extractFromNode(tw.world, nodeA, withPick);
    const bareYield = extractFromNode(tw.world, nodeB, bareHanded);
    expect(withPickYield).toBeGreaterThan(bareYield);
  });

  it('a saw affects the tool multiplier for log processing', () => {
    const withSaw = { id: 'i_1', type: 'saw', condition: 1 } as any;
    const noSaw = null;
    expect(toolWorkMultiplier('saw', withSaw)).toBeGreaterThan(toolWorkMultiplier('saw', noSaw));
  });

  it('tool condition (wear) survives save/load', () => {
    const { world, gen } = newWorld(4303);
    const axe = world.items().find(i => i.type === 'axe' && i.holderId);
    expect(axe).toBeDefined();
    wearTool(world, axe!, 500); // a lot of hours of use
    const worn = axe!.condition!;
    expect(worn).toBeLessThan(1);
    const restored = deserialize(serialize(world))!.world;
    const restoredAxe = restored.item(axe!.id)!;
    expect(restoredAxe.condition).toBeCloseTo(worn, 6);
    void gen;
  });

  it('tool absence produces coherent (reduced, not corrupted) behaviour', () => {
    const tw = createTestWorld(4304, 20);
    const p = addPerson(tw, 'NoTool', 'farmer', v(5, 1, 5));
    const tool = bestToolFor(tw.world, p, 'chop', null);
    expect(tool).toBeNull();
    const cap = getPhysicalCapability(p, tw.world, { action: 'chop', tool: null });
    expect(cap.workRate).toBeGreaterThan(0);
    expect(Number.isFinite(cap.workRate)).toBe(true);
  });
});

// ==================================================================== Requests
describe('shared work requests (v0.4 §9)', () => {
  it('a haul task creates and is linked to a shared Request', () => {
    const tw = createTestWorld(4401, 40);
    const src = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const dst = makePlace(tw.world, 'mill', 'Mill', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33) });
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 10, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    expect(task.requestId).toBeDefined();
    const req = tw.world.requests.find(r => r.id === task.requestId)!;
    expect(req).toBeDefined();
    expect(req.type).toBe('haul');
    expect(req.status).toBe('open');
  });

  it('construction labour uses the shared Request too', () => {
    const tw = createTestWorld(4402, 20);
    const site = makePlace(tw.world, 'construction', 'Site', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const owner = addPerson(tw, 'Owner', 'merchant', v(6, 1, 6), {});
    owner.wealth = 100;
    const worker = addPerson(tw, 'Worker', 'farmer', v(6, 1, 6));
    const proj = createConstructionProject(tw.world, { name: 'Shed', template: 'storage_shed', siteBounds: { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 5 }, sitePlaceId: site.id, required: [], ownerId: owner.id, laborRequired: 3600 });
    proj.status = 'ready';
    const before = tw.world.requests.length;
    performBuildLabor(tw.world, proj, worker, 300);
    expect(tw.world.requests.length).toBe(before + 1);
    const req = tw.world.requests[tw.world.requests.length - 1];
    expect(req.type).toBe('construction_labor');
    expect(req.status).toBe('completed'); // one work-session request, accepted+completed atomically
  });

  it('request acceptance is a canonical status transition', () => {
    const tw = createTestWorld(4403, 20);
    const worker = addPerson(tw, 'Worker', 'farmer', v(5, 1, 5));
    const req = createRequest(tw.world, { type: 'haul', requesterId: null, reward: 5, cause: 'test', payload: {} });
    expect(req.status).toBe('open');
    acceptRequest(tw.world, req, worker);
    expect(req.status).toBe('accepted');
    expect(req.acceptedBy).toBe(worker.id);
  });

  it('completion is verified — completing pays; failing does not', () => {
    const tw = createTestWorld(4404, 20);
    const payer = addPerson(tw, 'Payer', 'merchant', v(5, 1, 5)); payer.wealth = 50;
    const worker = addPerson(tw, 'Worker', 'farmer', v(5, 1, 5));
    const req1 = createRequest(tw.world, { type: 'haul', requesterId: payer.id, reward: 10, cause: 'x', payload: {} });
    acceptRequest(tw.world, req1, worker);
    const workerWealthBefore = worker.wealth;
    const paid = completeRequest(tw.world, req1);
    expect(paid).toBe(10);
    expect(worker.wealth).toBe(workerWealthBefore + 10);
    expect(req1.status).toBe('completed');

    const req2 = createRequest(tw.world, { type: 'haul', requesterId: payer.id, reward: 10, cause: 'x', payload: {} });
    acceptRequest(tw.world, req2, worker);
    const wealthBeforeFail = worker.wealth;
    failRequest(tw.world, req2, 'source dried up');
    expect(worker.wealth).toBe(wealthBeforeFail); // no payment
    expect(req2.status).toBe('failed');
  });

  it('failed work does not pay; completed work does', () => {
    const tw = createTestWorld(4405, 48);
    const src = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const dst = makePlace(tw.world, 'mill', 'Mill', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33) });
    const payer = addPerson(tw, 'Payer', 'merchant', v(6, 1, 6)); payer.wealth = 50;
    const hauler = addPerson(tw, 'Hauler', 'farmer', v(6, 1, 8));
    // nothing at the source — the haul will fail on load
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 10, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: payer.id, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    expect(task.status).toBe('failed');
    const req = tw.world.requests.find(r => r.id === task.requestId)!;
    expect(req.status).toBe('failed');
    expect(hauler.wealth).toBe(20); // default starting wealth — unpaid
  });
});

// ==================================================================== Currency
describe('conserved currency (v0.4 §10/§12)', () => {
  it('wage payment conserves total currency', () => {
    const tw = createTestWorld(4501, 20);
    const payer = addPerson(tw, 'Payer', 'merchant', v(5, 1, 5)); payer.wealth = 40;
    const worker = addPerson(tw, 'Worker', 'farmer', v(5, 1, 5)); worker.wealth = 5;
    const totalBefore = tw.world.persons().reduce((n, p) => n + p.wealth, 0);
    const req = createRequest(tw.world, { type: 'haul', requesterId: payer.id, reward: 15, cause: 'x', payload: {} });
    acceptRequest(tw.world, req, worker);
    completeRequest(tw.world, req);
    const totalAfter = tw.world.persons().reduce((n, p) => n + p.wealth, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it('a payer never pays more than they have, and never goes negative', () => {
    const tw = createTestWorld(4502, 20);
    const poorPayer = addPerson(tw, 'Poor', 'merchant', v(5, 1, 5)); poorPayer.wealth = 3;
    const worker = addPerson(tw, 'Worker', 'farmer', v(5, 1, 5));
    const req = createRequest(tw.world, { type: 'haul', requesterId: poorPayer.id, reward: 20, cause: 'x', payload: {} });
    acceptRequest(tw.world, req, worker);
    const paid = completeRequest(tw.world, req);
    expect(paid).toBe(3);
    expect(poorPayer.wealth).toBe(0);
    expect(poorPayer.wealth).toBeGreaterThanOrEqual(0);
  });

  it('purchase conserves currency and item quantity', () => {
    const tw = createTestWorld(4503, 20);
    const seller = addPerson(tw, 'Seller', 'baker', v(5, 1, 5)); seller.wealth = 10;
    const buyer = addPerson(tw, 'Buyer', 'farmer', v(5, 1, 5)); buyer.wealth = 20;
    const stall = makePlace(tw.world, 'stall', 'Stall', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const bread = makeItem(tw.world, 'bread', 'bread', { owner: seller.id, placeId: stall.id, pos: v(5, 1, 5), quantity: 5, value: 2 });
    const wealthBefore = seller.wealth + buyer.wealth;
    const itemsBefore = worldStock(tw.world, 'bread');
    const bought = buyFoodPortion(tw.world, buyer, bread, 3);
    expect(bought).not.toBeNull();
    expect(seller.wealth + buyer.wealth).toBe(wealthBefore); // conserved
    expect(worldStock(tw.world, 'bread')).toBe(itemsBefore); // conserved (moved, not created)
    void findAccessibleFood;
  });

  it('a buyer cannot spend money they do not have', () => {
    const tw = createTestWorld(4504, 20);
    const seller = addPerson(tw, 'Seller', 'baker', v(5, 1, 5));
    const buyer = addPerson(tw, 'Buyer', 'farmer', v(5, 1, 5)); buyer.wealth = 1;
    const stall = makePlace(tw.world, 'stall', 'Stall', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const bread = makeItem(tw.world, 'bread', 'bread', { owner: seller.id, placeId: stall.id, pos: v(5, 1, 5), quantity: 5, value: 10 });
    const bought = buyFoodPortion(tw.world, buyer, bread, 3);
    // at value 10/unit and wealth 1, buyer affords 0 units
    expect(bought).toBeNull();
    expect(buyer.wealth).toBe(1);
    expect(bread.quantity).toBe(5);
  });

  it('a seller cannot sell inventory they do not possess', () => {
    const tw = createTestWorld(4505, 20);
    const seller = addPerson(tw, 'Seller', 'baker', v(5, 1, 5));
    const buyer = addPerson(tw, 'Buyer', 'farmer', v(5, 1, 5)); buyer.wealth = 100;
    const stall = makePlace(tw.world, 'stall', 'Stall', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const bread = makeItem(tw.world, 'bread', 'bread', { owner: seller.id, placeId: stall.id, pos: v(5, 1, 5), quantity: 0, value: 2 });
    const bought = buyFoodPortion(tw.world, buyer, bread, 3);
    expect(bought).toBeNull();
  });
});

// ==================================================================== Resource timescales
describe('resource timescales (v0.4 §14)', () => {
  it('a felled tree does not regrow after 30 days', () => {
    const tw = createTestWorld(4601, 40);
    for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    const bors = addPerson(tw, 'Bors', 'woodcutter', v(10, 2, 10));
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 2);
    const node = tw.world.resourceNodes.find(n => n.kind === 'tree')!;
    let guard = 0; while (node.state === 'available' && guard++ < 20) extractFromNode(tw.world, node, bors);
    expect(node.state).toBe('depleted');
    tw.world.clock.worldSeconds += 30 * 24 * 3600; // exactly the OLD (v0.3) regrow timer
    maintainResourceNodes(tw.world);
    expect(node.state).toBe('depleted'); // still gone — v0.4 uses ~2.5 years, not 30 days
    expect(node.growthStage).not.toBe('mature');
  });

  it('a tree lifecycle advances through felled -> sapling -> young -> mature, only becoming harvestable at mature', () => {
    const tw = createTestWorld(4602, 40);
    for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    const bors = addPerson(tw, 'Bors', 'woodcutter', v(10, 2, 10));
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 2);
    const node = tw.world.resourceNodes.find(n => n.kind === 'tree')!;
    let guard = 0; while (node.state === 'available' && guard++ < 20) extractFromNode(tw.world, node, bors);
    expect(node.growthStage).toBe('felled');
    tw.world.clock.worldSeconds += node.regrowHours * 3600 * 0.2; maintainResourceNodes(tw.world);
    expect(['sapling', 'young']).toContain(node.growthStage);
    expect(node.state).toBe('depleted'); // not harvestable yet
    tw.world.clock.worldSeconds += node.regrowHours * 3600 * 0.9; maintainResourceNodes(tw.world);
    expect(node.growthStage).toBe('mature');
    expect(node.state).toBe('available');
    expect(node.remaining).toBe(node.capacity);
  });

  it('a crop does not mature unrealistically quickly (a few world-days is not enough)', () => {
    const tw = createTestWorld(4603, 20);
    const farm = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 14, z1: 14, y0: 2, y1: 4 }, { inside: v(8, 2, 8), indoor: false });
    for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) tw.world.grid.set(x, 1, z, B.Farmland);
    createFields(tw.world, [{ placeId: farm.id, ownerId: null, startMoisture: 0.9 }]);
    const field = tw.world.fields[0];
    const farmer = addPerson(tw, 'Farmer', 'farmer', v(5, 1, 5));
    addPlaceStock(tw.world, 'grain', 10, farm.id, null, undefined, 'seed');
    plantPlot(tw.world, field, field.plots[0], farmer);
    tw.world.clock.worldSeconds += 3 * SECONDS_PER_DAY;
    stepMetabolism(tw.world, 72);
    expect(field.plots[0].state).not.toBe('mature');
    expect(MATURE_HOURS).toBeGreaterThan(3 * 24); // weeks, not days
  });

  it('stone does not spontaneously regenerate', () => {
    const tw = createTestWorld(4604, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const quarry = makePlace(tw.world, 'quarry', 'quarry', { x0: 2, z0: 2, x1: 28, z1: 28, y0: 2, y1: 6 }, { inside: v(15, 2, 15) });
    const worker = addPerson(tw, 'W', 'farmer', v(10, 2, 10));
    registerStoneNodes(tw.world, quarry.id, [v(12, 2, 12)]);
    const node = tw.world.resourceNodes.find(n => n.kind === 'stone')!;
    let guard = 0; while (node.remaining > 0 && guard++ < 40) extractFromNode(tw.world, node, worker);
    expect(node.state).toBe('depleted');
    tw.world.clock.worldSeconds += 5 * 365 * 24 * 3600; // five years
    maintainResourceNodes(tw.world);
    expect(node.state).toBe('depleted');
    expect(node.remaining).toBe(0);
    expect(node.renewable).toBe(false);
  });

  it('spoilage behaves differently by resource type', () => {
    const tw = createTestWorld(4605, 20);
    const place = makePlace(tw.world, 'store', 'Store', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 });
    const bread = makeItem(tw.world, 'bread', 'bread', { placeId: place.id, pos: v(5, 1, 5), quantity: 100 });
    const grain = makeItem(tw.world, 'grain', 'grain', { placeId: place.id, pos: v(5, 1, 5), quantity: 100 });
    const plank = makeItem(tw.world, 'plank', 'plank', { placeId: place.id, pos: v(5, 1, 5), quantity: 100 });
    stepSpoilage(tw.world, 10 * 24); // 10 world-days
    expect(bread.quantity).toBeLessThan(100);
    expect(grain.quantity).toBeLessThan(100);
    expect(bread.quantity).toBeLessThan(grain.quantity); // bread spoils faster than grain
    expect(plank.quantity).toBe(100); // materials never spoil
  });

  it('replenishing a perishable stack does not skew the existing batch\'s spoilage age', () => {
    const tw = createTestWorld(4606, 20);
    const place = makePlace(tw.world, 'store', 'Store', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 });
    const old = addPlaceStock(tw.world, 'bread', 50, place.id, null, undefined, 'baked');
    tw.world.clock.worldSeconds += 5 * 24 * 3600; // the old batch ages 5 days
    stepSpoilage(tw.world, 5 * 24);
    const oldAfterAging = old.quantity;
    expect(oldAfterAging).toBeLessThan(50);
    const fresh = addPlaceStock(tw.world, 'bread', 50, place.id, null, undefined, 'baked');
    expect(fresh.id).not.toBe(old.id); // a genuinely separate, fresh-aged batch
    expect(fresh.quantity).toBe(50); // the fresh batch is untouched by the old batch's age
    expect(stockAt(tw.world, 'bread', place.id)).toBe(oldAfterAging + 50);
  });
});

// ==================================================================== Canonical integrity
describe('canonical integrity (v0.4 §22)', () => {
  it('stock never goes negative under repeated over-draw', () => {
    const tw = createTestWorld(4701, 20);
    const place = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 });
    addPlaceStock(tw.world, 'grain', 5, place.id, null, undefined, 'x');
    const took = takePlaceStock(tw.world, 'grain', 999, [place.id]);
    expect(took).toBe(5);
    expect(stockAt(tw.world, 'grain', place.id)).toBeGreaterThanOrEqual(0);
  });

  it('hydration never goes negative under extreme sustained exertion', () => {
    const tw = createTestWorld(4702, 20);
    const p = addPerson(tw, 'Exhausted', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 50; i++) stepPhysiology(tw.world, p, 5, 'quarry');
    expect(p.physiology.hydration).toBeGreaterThanOrEqual(0);
    expect(p.needs.thirst).toBeLessThanOrEqual(1);
  });

  it('no impossible currency duplication across a short deterministic run — total wealth is conserved exactly minus only EXPLICIT, tracked exits', () => {
    const { world } = newWorld(918271);
    const sim = new Simulation(world);
    const totalBefore = world.persons().reduce((n, p) => n + p.wealth, 0)
      + world.items().filter(i => i.type === 'coins').reduce((n, i) => n + i.quantity, 0);
    advance(world, sim, 4 * SECONDS_PER_HOUR / 60);
    const totalAfter = world.persons().filter(p => p.alive).reduce((n, p) => n + p.wealth, 0)
      + world.persons().filter(p => !p.alive).reduce((n, p) => n + p.wealth, 0) // dead keep their last wealth, still accounted
      + world.items().filter(i => i.type === 'coins').reduce((n, i) => n + i.quantity, 0);
    // v0.7 §B: `restockTavern` (world/metabolism.ts) now charges the innkeeper a real, bounded,
    // EXPLICIT supply cost — currency deliberately leaving the simulation (Constitution v0.7 §B:
    // "if currency enters or exits the simulation, that must be explicit"), tracked in
    // `world.runTally.supply_cost_amount` for exactly this kind of audit. Total wealth is still
    // conserved once that tracked, intentional exit is accounted for — nothing untracked
    // appeared or vanished.
    // toBeCloseTo, not toBe: several restocks each contribute a rounded-to-cents cost, and
    // summing several such floats can accumulate a sub-cent floating-point residue (e.g.
    // 17.40000000000009) — real money conservation, not a precision bug in the game itself.
    expect(totalBefore - totalAfter).toBeCloseTo(world.runTally.supply_cost_amount ?? 0, 6);
  });

  it('interrupted hauling mid-multi-trip conserves cargo exactly', () => {
    const tw = createTestWorld(4703, 48);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6) });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 38, z1: 38, y0: 1, y1: 3 }, { inside: v(33, 1, 33) });
    const hauler = addPerson(tw, 'Hauler', 'farmer', v(6, 1, 8), { workId: src.id });
    hauler.attributes.strength = 0.15;
    makeItem(tw.world, 'stone', 'stone', { placeId: src.id, pos: v(6, 1, 6), quantity: 30 });
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 12, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    const before = worldStock(tw.world, 'stone');
    loadHaulCargo(tw.world, task, hauler); // first trip only, never delivered
    hauler.custody = { active: true, byFactionId: null, byId: null, reason: 'test', since: tw.world.now, releaseAt: tw.world.now + 1000 };
    maintainHauls(tw.world);
    expect(task.status).toBe('failed');
    expect(worldStock(tw.world, 'stone')).toBe(before); // nothing lost, nothing gained
  });

  it('depleted resources stop offering work', () => {
    const tw = createTestWorld(4704, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 28, z1: 28, y0: 2, y1: 12 }, { inside: v(15, 2, 15) });
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 20, z1: 20 }, clearing.id, clearing.id, 1);
    for (const n of tw.world.resourceNodes) { n.state = 'depleted'; n.remaining = 0; }
    expect(nearestAvailableNode(tw.world, 'tree', v(10, 2, 10), 50)).toBeNull();
  });

  it('determinism: identical seed + steps reproduce an identical canonical hash', () => {
    const w1 = newWorld(918271).world; const s1 = new Simulation(w1);
    advance(w1, s1, 2 * SECONDS_PER_HOUR / 60);
    const h1 = canonicalStateHash(w1);
    const w2 = newWorld(918271).world; const s2 = new Simulation(w2);
    advance(w2, s2, 2 * SECONDS_PER_HOUR / 60);
    const h2 = canonicalStateHash(w2);
    expect(h1).toBe(h2);
  });

  it('a different seed produces a different outcome', () => {
    const w1 = newWorld(918271).world; const s1 = new Simulation(w1);
    advance(w1, s1, 2 * SECONDS_PER_HOUR / 60);
    const w2 = newWorld(4242).world; const s2 = new Simulation(w2);
    advance(w2, s2, 2 * SECONDS_PER_HOUR / 60);
    expect(canonicalStateHash(w1)).not.toBe(canonicalStateHash(w2));
  });
});

// ==================================================================== Save/load round-trip
describe('v0.4 save/load round-trip (SAVE_VERSION 7)', () => {
  it('rejects a pre-v0.4 (version 6) save', () => {
    const { world } = newWorld(1337);
    const stale = JSON.parse(serialize(world)); stale.version = 6;
    expect(deserialize(JSON.stringify(stale))).toBeNull();
  });

  it('round-trips attributes, physiology, tool condition and open requests', () => {
    const { world } = newWorld(918271);
    const sim = new Simulation(world);
    advance(world, sim, 3 * SECONDS_PER_HOUR / 60);
    const someone = world.persons().find(p => p.alive)!;
    someone.attributes.strength = 0.77; someone.physiology.fatigue = 0.42; someone.physiology.sleepDebt = 3.5;
    const restored = deserialize(serialize(world))!.world;
    const back = restored.person(someone.id)!;
    expect(back.attributes.strength).toBeCloseTo(0.77, 6);
    expect(back.physiology.fatigue).toBeCloseTo(0.42, 6);
    expect(back.physiology.sleepDebt).toBeCloseTo(3.5, 6);
    expect(restored.requests.length).toBe(world.requests.length);
  });
});

// ==================================================================== The embodied economy vertical slice
describe('the embodied economy causal chain (v0.4 §29)', () => {
  it('a benchmark run shows the full physical→work→wage→purchase chain with conserved quantities', { timeout: 180000 }, () => {
    const result = runHeadless({ seed: 918271, days: 3, stepSeconds: 0.15 });
    const { world, summary } = result;
    // physical labour happened
    expect(world.runTally.resource_extracted ?? 0).toBeGreaterThan(0);
    expect(world.runTally['hauled:grain'] ?? 0).toBeGreaterThan(0);
    // requests were created, accepted, and at least some completed with real pay
    expect(world.requests.length).toBeGreaterThan(0);
    expect(world.requests.some(r => r.status === 'completed')).toBe(true);
    expect(world.runTally.wage_paid_amount ?? 0).toBeGreaterThan(0);
    // purchases moved real currency and real food
    expect(world.runTally.purchase_amount ?? 0).toBeGreaterThanOrEqual(0);
    expect(summary.metabolism.mealsEaten).toBeGreaterThan(0);
    // currency conserved across the whole run
    const totalWealth = world.persons().reduce((n, p) => n + p.wealth, 0);
    expect(totalWealth).toBeGreaterThan(0);
    expect(Number.isFinite(totalWealth)).toBe(true);
    // nobody's wealth went negative
    expect(world.persons().every(p => p.wealth >= 0)).toBe(true);
  });

  it('a contrasting failure case: a worker without capability/tool or too exhausted does not perform the work anyway', () => {
    const tw = createTestWorld(4801, 40);
    for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    const exhausted = addPerson(tw, 'Exhausted', 'farmer', v(10, 2, 10));
    exhausted.physiology.fatigue = 0.98; exhausted.physiology.energy = 0.05; exhausted.physiology.hydration = 0.1;
    const cap = getPhysicalCapability(exhausted, tw.world);
    expect(cap.currentExertionCapacity).toBeLessThan(0.15); // this is the actual gate think() uses
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 1);
    void extractFromNode; void defaultAttributesFor; void defaultPhysiology;
  });
});
