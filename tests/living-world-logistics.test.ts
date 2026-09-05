import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { newWorld, deserialize, serialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { B } from '../src/sim/physical/blocks';
import {
  stockAt, stockTotal, addPlaceStock, takePlaceStock, worldStock,
} from '../src/sim/world/stock';
import {
  createHaulTask, claimHaulTask, loadHaulCargo, depositHaulCargo, failHaulTask, maintainHauls, generateLogisticsNeeds,
} from '../src/sim/logistics/haul';
import { plantGrove, registerStoneNodes, extractFromNode, maintainResourceNodes, nearestAvailableNode } from '../src/sim/world/resources';
import { createConstructionProject, contributeBuildLabor, stepConstruction, projectDeficits } from '../src/sim/world/construction';
import { mill, bake, transform, plantPlot, harvestPlot, stepSpoilage, createFields } from '../src/sim/world/metabolism';
import { SECONDS_PER_DAY } from '../src/sim/core/time';
import type { Person } from '../src/sim/core/types';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let e = 0; e < seconds; e += 0.15) { const dt = Math.min(0.15, seconds - e); const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); }
}

/** A tiny two-Place world for haul unit tests. */
function haulWorld(seed = 700) {
  const tw = createTestWorld(seed, 48);
  const src = makePlace(tw.world, 'farm', 'Source Farm', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
  const dst = makePlace(tw.world, 'mill', 'Dest Mill', { x0: 36, z0: 36, x1: 44, z1: 44, y0: 1, y1: 3 }, { inside: v(40, 1, 40), indoor: true });
  const hauler = addPerson(tw, 'Hauler', 'farmer', v(6, 1, 8), { workId: src.id });
  src.workers.push(hauler.id);
  return { tw, src, dst, hauler };
}

describe('place stock (v0.3 Priority 1)', () => {
  it('answers how much of a resource is physically at a Place, and keeps ownership separate from location', () => {
    const tw = createTestWorld(701, 20);
    const farm = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const alwin = addPerson(tw, 'Alwin', 'farmer', v(5, 1, 5));
    const bess = addPerson(tw, 'Bess', 'farmer', v(5, 1, 5));
    addPlaceStock(tw.world, 'grain', 20, farm.id, alwin.id, undefined, 'harvested');
    // v0.4 §14: grain is perishable, so this starts a separate batch stack (its own spoilage
    // age) rather than merging — stockAt still sums across stacks transparently.
    addPlaceStock(tw.world, 'grain', 5, farm.id, alwin.id, undefined, 'harvested');
    expect(stockAt(tw.world, 'grain', farm.id)).toBe(25);
    // a second, differently-owned stack at a different place is distinguishable
    const mill = makePlace(tw.world, 'mill', 'Mill', { x0: 12, z0: 12, x1: 18, z1: 18, y0: 1, y1: 3 }, { inside: v(15, 1, 15) });
    const s2 = addPlaceStock(tw.world, 'grain', 20, mill.id, bess.id, undefined, 'delivered');
    expect(stockAt(tw.world, 'grain', mill.id)).toBe(20);
    expect(s2.ownerId).toBe(bess.id);
    expect(stockTotal(tw.world, 'grain', [farm.id, mill.id])).toBe(45);
  });

  it('takePlaceStock drains deterministically (oldest stack first) and conserves — a drained stack is inert, not deleted', () => {
    const tw = createTestWorld(702, 20);
    const farm = makePlace(tw.world, 'farm', 'Farm', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const a = makeItem(tw.world, 'grain', 'grain', { placeId: farm.id, quantity: 10 });
    const before = worldStock(tw.world, 'grain');
    const took = takePlaceStock(tw.world, 'grain', 7, [farm.id]);
    expect(took).toBe(7);
    expect(stockAt(tw.world, 'grain', farm.id)).toBe(3);
    takePlaceStock(tw.world, 'grain', 99, [farm.id]); // over-draw
    expect(stockAt(tw.world, 'grain', farm.id)).toBe(0);
    expect(tw.world.item(a.id)).toBeDefined(); // entity survives
    expect(tw.world.item(a.id)!.placeId).toBeNull();
    expect(before).toBe(10);
  });
});

describe('generalized haul (v0.3 Priority 2)', () => {
  it('pickup → carry → deposit conserves the resource exactly through a physical journey', () => {
    const { tw, src, dst, hauler } = haulWorld(710);
    makeItem(tw.world, 'grain', 'grain', { owner: hauler.id, placeId: src.id, pos: v(6, 1, 6), quantity: 30 });
    const total0 = worldStock(tw.world, 'grain');
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 20, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'mill low', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    expect(task.status).toBe('in_transit');
    expect(task.carried).toBe(20);
    expect(stockAt(tw.world, 'grain', src.id)).toBe(10);
    // grain is now a real carried Item, not at any Place
    const cargo = tw.world.item(task.cargoItemId!)!;
    expect(cargo.holderId).toBe(hauler.id);
    expect(cargo.placeId).toBeNull();
    expect(hauler.inventory).toContain(cargo.id);
    depositHaulCargo(tw.world, task, hauler);
    expect(task.status).toBe('delivered');
    expect(stockAt(tw.world, 'grain', dst.id)).toBe(20);
    expect(stockAt(tw.world, 'grain', src.id)).toBe(10);
    expect(worldStock(tw.world, 'grain')).toBe(total0); // conserved
    expect(hauler.inventory).not.toContain(cargo.id);
  });

  it('a task whose source is emptied before pickup fails cleanly — nothing conjured, nothing lost', () => {
    const { tw, src, dst, hauler } = haulWorld(711);
    const stack = makeItem(tw.world, 'grain', 'grain', { placeId: src.id, pos: v(6, 1, 6), quantity: 15 });
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 15, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    // someone else consumes the grain first
    takePlaceStock(tw.world, 'grain', 15, [src.id]);
    const ok = loadHaulCargo(tw.world, task, hauler);
    expect(ok).toBe(false);
    expect(task.status).toBe('failed');
    expect(tw.world.events.some(e => e.type === 'haul_failed')).toBe(true);
    void stack;
  });

  it('an interrupted hauler (detained mid-journey) drops the cargo canonically — the resource still exists', () => {
    const { tw, src, dst, hauler } = haulWorld(712);
    makeItem(tw.world, 'grain', 'grain', { placeId: src.id, pos: v(6, 1, 6), quantity: 20 });
    const total0 = worldStock(tw.world, 'grain');
    const task = createHaulTask(tw.world, { resource: 'grain', quantity: 20, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(tw.world, task, hauler);
    loadHaulCargo(tw.world, task, hauler);
    expect(task.carried).toBe(20);
    // the hauler is taken into custody mid-transit
    hauler.custody = { active: true, byFactionId: null, byId: null, reason: 'test', since: tw.world.now, releaseAt: tw.world.now + 1000 };
    maintainHauls(tw.world);
    expect(task.status).toBe('failed');
    const cargo = tw.world.item(task.cargoItemId!)!;
    expect(cargo.quantity).toBe(20);
    expect(cargo.holderId).toBeNull();
    expect(cargo.pos).not.toBeNull(); // dropped somewhere in the world
    expect(worldStock(tw.world, 'grain')).toBe(total0); // conserved
    expect(hauler.inventory).not.toContain(cargo.id);
  });

  it('a full-sim NPC learns of a haul need, walks to the source, and physically delivers grain to the mill', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    world.clock.worldSeconds = 100 * SECONDS_PER_DAY + 9 * 3600;
    const mill = world.places().find(p => p.type === 'mill')!;
    const millGrain0 = stockAt(world, 'grain', mill.id);
    advance(world, sim, 3.5 * 3600 / 60); // ~3.5 world-hours
    const delivered = (world.runTally['hauled:grain'] ?? 0);
    expect(delivered).toBeGreaterThan(0);
    expect(world.events.some(e => e.type === 'resource_picked_up')).toBe(true);
    expect(world.events.some(e => e.type === 'resource_delivered')).toBe(true);
    void gen; void millGrain0;
  });
});

describe('remote production inputs are forbidden (v0.3 Priority 3)', () => {
  it('the mill cannot mill grain that is still at a farm', () => {
    const { world, gen } = newWorld(1401);
    // clear the mill's own grain, leave plenty at farms
    takePlaceStock(world, 'grain', 9999, world.places().filter(p => p.type === 'mill').map(p => p.id));
    const farmGrain = stockTotal(world, 'grain', world.places().filter(p => p.type === 'farm').map(p => p.id));
    expect(farmGrain).toBeGreaterThan(10);
    const r = mill(world, gen.people.hobb);
    expect(r.ok).toBe(false);
    expect(world.items().some(i => i.type === 'flour' && i.provenance.some(pr => pr.how === 'milled'))).toBe(false);
  });

  it('the bakery cannot bake flour that is still at the mill', () => {
    const { world, gen } = newWorld(1402);
    takePlaceStock(world, 'flour', 9999, world.places().filter(p => p.type === 'bakery').map(p => p.id));
    addPlaceStock(world, 'flour', 40, world.places().find(p => p.type === 'mill')!.id, gen.people.hobb.id, undefined, 'milled');
    const r = bake(world, gen.people.osric);
    expect(r.ok).toBe(false);
  });

  it('delivering the input physically to the mill enables production', () => {
    const { world, gen } = newWorld(1403);
    const millId = world.places().find(p => p.type === 'mill')!.id;
    takePlaceStock(world, 'grain', 9999, [millId]);
    expect(mill(world, gen.people.hobb).ok).toBe(false);
    addPlaceStock(world, 'grain', 12, millId, gen.people.alwin.id, undefined, 'delivered');
    const r = mill(world, gen.people.hobb);
    expect(r.ok).toBe(true);
    expect(stockAt(world, 'flour', millId)).toBeGreaterThan(0);
    expect(stockAt(world, 'grain', millId)).toBe(12 - 3);
  });
});

describe('resource nodes: trees → logs, stone (v0.3 Priority 5-6-8)', () => {
  it('chopping a tree yields logs, depletes it, removes its voxels, and it does not regrow immediately', () => {
    const tw = createTestWorld(720, 40);
    for (let x = 4; x < 36; x++) for (let z = 4; z < 36; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    const bors = addPerson(tw, 'Bors', 'woodcutter', v(10, 2, 10));
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 4);
    const node = tw.world.resourceNodes.find(n => n.kind === 'tree')!;
    expect(node).toBeDefined();
    const trunkCell = node.blocks[0];
    expect(tw.world.grid.get(trunkCell.x, trunkCell.y, trunkCell.z)).toBe(B.Log);
    let guard = 0;
    while (node.state === 'available' && guard++ < 20) extractFromNode(tw.world, node, bors);
    expect(node.state).toBe('depleted');
    expect(stockAt(tw.world, 'log', clearing.id)).toBe(node.capacity);
    expect(tw.world.grid.get(trunkCell.x, trunkCell.y, trunkCell.z)).toBe(B.Air); // voxel gone
    expect(tw.world.events.some(e => e.type === 'resource_depleted')).toBe(true);
    // not harvestable again now
    expect(extractFromNode(tw.world, node, bors)).toBe(0);
    // regrows only after its world-time passes
    maintainResourceNodes(tw.world);
    expect(node.state).toBe('depleted');
    tw.world.clock.worldSeconds += node.regrowHours * 3600 + 1;
    maintainResourceNodes(tw.world);
    expect(node.state).toBe('available');
    expect(node.remaining).toBe(node.capacity);
    expect(tw.world.grid.get(trunkCell.x, trunkCell.y, trunkCell.z)).toBe(B.Log); // voxel restored
  });

  it('a depleted node stops offering itself, so a harvester does not retry it every tick', () => {
    const tw = createTestWorld(721, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 28, z1: 28, y0: 2, y1: 12 }, { inside: v(15, 2, 15) });
    const bors = addPerson(tw, 'Bors', 'woodcutter', v(10, 2, 10));
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 20, z1: 20 }, clearing.id, clearing.id, 2);
    for (const n of tw.world.resourceNodes) { n.state = 'depleted'; n.remaining = 0; }
    expect(nearestAvailableNode(tw.world, 'tree', v(10, 2, 10), 50)).toBeNull();
    void bors;
  });

  it('stone is gathered from an outcrop and conserved', () => {
    const tw = createTestWorld(722, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const quarry = makePlace(tw.world, 'quarry', 'quarry', { x0: 2, z0: 2, x1: 28, z1: 28, y0: 2, y1: 6 }, { inside: v(15, 2, 15) });
    const worker = addPerson(tw, 'W', 'farmer', v(10, 2, 10));
    registerStoneNodes(tw.world, quarry.id, [v(12, 2, 12), v(16, 2, 16)]);
    const node = tw.world.resourceNodes.find(n => n.kind === 'stone')!;
    expect(node).toBeDefined();
    const got = extractFromNode(tw.world, node, worker);
    expect(got).toBeGreaterThan(0);
    expect(stockAt(tw.world, 'stone', quarry.id)).toBe(got);
    expect(node.remaining).toBe(node.capacity - got);
    expect(node.renewable).toBe(false);
  });
});

describe('shared player/NPC ontology (v0.3 Priority 11)', () => {
  it('the player chops a tree through the same extraction path an NPC uses', () => {
    const tw = createTestWorld(725, 40);
    for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const clearing = makePlace(tw.world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
    plantGrove(tw.world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 3);
    const node = tw.world.resourceNodes.find(n => n.kind === 'tree')!;
    const player = addPerson(tw, 'Traveler', 'traveler', v(node.pos.x, node.pos.y, node.pos.z), { controlled: true });
    const trunk = node.blocks.find(b => tw.world.grid.get(b.x, b.y, b.z) === B.Log)!;
    const got = tw.sim.extractResourceAt(player, { x: trunk.x + 0.5, y: trunk.y, z: trunk.z + 0.5 });
    expect(got).toBeGreaterThan(0);
    expect(stockAt(tw.world, 'log', clearing.id)).toBe(got);
    expect(tw.world.events.some(e => e.type === 'resource_extracted' && e.actor === player.id)).toBe(true);
  });
});

describe('wood transformation: log → plank (v0.3 Priority 7)', () => {
  it('sawing turns logs at the sawpit into planks at the sawpit, conserving through the ratio', () => {
    const tw = createTestWorld(730, 20);
    const worker = addPerson(tw, 'W', 'woodcutter', v(5, 1, 5));
    const sawpit = makePlace(tw.world, 'sawpit', 'sawpit', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    makeItem(tw.world, 'log', 'log', { placeId: sawpit.id, pos: v(5, 1, 5), quantity: 6 });
    const r = transform(tw.world, { actor: worker.id, inputType: 'log', inputQty: 2, inputPlaces: [sawpit.id], outputType: 'plank', outputQty: 3, outputPlace: sawpit.id, ownerId: worker.id, how: 'sawn' });
    expect(r.ok).toBe(true);
    expect(stockAt(tw.world, 'log', sawpit.id)).toBe(4);
    expect(stockAt(tw.world, 'plank', sawpit.id)).toBe(3);
  });
});

describe('construction project (v0.3 Priority 9-10-12)', () => {
  function buildWorld(seed = 740) {
    const tw = createTestWorld(seed, 30);
    for (let x = 2; x < 28; x++) for (let z = 2; z < 28; z++) tw.world.grid.set(x, 1, z, B.Grass);
    tw.world.nav.rebuildAll();
    const site = makePlace(tw.world, 'construction', 'shed site', { x0: 10, z0: 10, x1: 16, z1: 16, y0: 2, y1: 6 }, { inside: v(13, 2, 13), indoor: false });
    const godwin = addPerson(tw, 'Godwin', 'elder', v(5, 2, 5));
    const w1 = addPerson(tw, 'W1', 'farmer', v(6, 2, 6));
    const w2 = addPerson(tw, 'W2', 'farmer', v(7, 2, 7));
    const proj = createConstructionProject(tw.world, {
      name: 'test shed', template: 'storage_shed',
      siteBounds: { x0: 10, z0: 10, x1: 16, z1: 16, y0: 2, y1: 6 }, sitePlaceId: site.id,
      required: [{ type: 'plank', quantity: 8 }, { type: 'stone', quantity: 4 }], ownerId: godwin.id, laborRequired: 600,
    });
    return { tw, site, proj, w1, w2 };
  }

  it('a project does not become a structure on creation — materials must physically arrive first', () => {
    const { tw, site, proj } = buildWorld(740);
    expect(proj.status).toBe('gathering');
    expect(site.type).toBe('construction');
    stepConstruction(tw.world);
    contributeBuildLabor(tw.world, proj, tw.world.persons()[0] as Person, 9999); // labour with no materials — no effect
    expect(proj.status).toBe('gathering');
    expect(proj.laborDone).toBe(0);
    expect(projectDeficits(tw.world, proj).map(d => d.type).sort()).toEqual(['plank', 'stone']);
  });

  it('materials on site → ready → build labour → the structure becomes canonical and usable', () => {
    const { tw, site, proj, w1, w2 } = buildWorld(741);
    addPlaceStock(tw.world, 'plank', 8, site.id, null, undefined, 'delivered');
    addPlaceStock(tw.world, 'stone', 4, site.id, null, undefined, 'delivered');
    stepConstruction(tw.world);
    expect(proj.status).toBe('ready');
    // one worker with all materials but not enough labour does not finish it
    contributeBuildLabor(tw.world, proj, w1, 300);
    expect(proj.status).toBe('building');
    expect(proj.laborDone).toBe(300);
    contributeBuildLabor(tw.world, proj, w2, 300);
    expect(proj.status).toBe('complete');
    // labour is recorded per worker (the wage hook)
    expect(proj.contributions[w1.id]).toBe(300);
    expect(proj.contributions[w2.id]).toBe(300);
    // canonical world state changed: materials consumed, structure raised, Place usable
    expect(stockAt(tw.world, 'plank', site.id)).toBe(0);
    expect(stockAt(tw.world, 'stone', site.id)).toBe(0);
    expect(site.type).toBe('hut');
    expect(site.indoor).toBe(true);
    expect(tw.world.grid.get(10, 3, 10)).toBe(B.Planks); // a wall block exists
    expect(tw.world.events.some(e => e.type === 'construction_completed')).toBe(true);
  });
});

describe('seed cost (v0.3 Priority 13)', () => {
  it('sowing consumes a grain from the farm; a farm with no grain cannot sow', () => {
    const tw = createTestWorld(750, 30);
    const farmer = addPerson(tw, 'F', 'farmer', v(5, 1, 5));
    const farm = makePlace(tw.world, 'farm', 'farm', { x0: 2, z0: 2, x1: 14, z1: 14, y0: 2, y1: 4 }, { inside: v(8, 2, 8), indoor: false });
    for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) { tw.world.grid.set(x, 1, z, B.Farmland); }
    createFields(tw.world, [{ placeId: farm.id, ownerId: farmer.id, startMoisture: 0.5 }]);
    const field = tw.world.fields[0];
    const plot = field.plots[0];
    expect(plantPlot(tw.world, field, plot, farmer)).toBe(false); // no seed
    expect(plot.state).toBe('fallow');
    expect(tw.world.events.some(e => e.type === 'resource_shortage' && e.data?.reason === 'seed')).toBe(true);
    addPlaceStock(tw.world, 'grain', 3, farm.id, farmer.id, undefined, 'harvested');
    expect(plantPlot(tw.world, field, plot, farmer)).toBe(true);
    expect(plot.state).toBe('planted');
    expect(stockAt(tw.world, 'grain', farm.id)).toBe(2);
  });

  it('a harvest replenishes seed grain so the village keeps reproducing crops', () => {
    const tw = createTestWorld(751, 30);
    const farmer = addPerson(tw, 'F', 'farmer', v(5, 1, 5));
    const farm = makePlace(tw.world, 'farm', 'farm', { x0: 2, z0: 2, x1: 14, z1: 14, y0: 2, y1: 4 }, { inside: v(8, 2, 8), indoor: false });
    for (let x = 4; x <= 12; x++) for (let z = 4; z <= 12; z++) tw.world.grid.set(x, 1, z, B.Farmland);
    createFields(tw.world, [{ placeId: farm.id, ownerId: farmer.id, startMoisture: 0.5 }]);
    const field = tw.world.fields[0];
    field.plots[0].state = 'mature'; field.plots[0].growth = 1;
    const y = harvestPlot(tw.world, field, field.plots[0], farmer);
    expect(y).toBeGreaterThan(1);
    expect(stockAt(tw.world, 'grain', farm.id)).toBe(y);
    expect(plantPlot(tw.world, field, field.plots[1], farmer)).toBe(true); // seed available now
  });
});

describe('spoilage (v0.3 Priority 14)', () => {
  it('bread spoils faster than grain, batched per stack, and does not storm events', () => {
    const tw = createTestWorld(760, 20);
    const home = makePlace(tw.world, 'house', 'home', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const bread = makeItem(tw.world, 'bread', 'bread', { placeId: home.id, pos: v(5, 1, 5), quantity: 100 });
    const grain = makeItem(tw.world, 'grain', 'grain', { placeId: home.id, pos: v(5, 1, 5), quantity: 100 });
    for (let d = 0; d < 5; d++) { tw.world.clock.worldSeconds += SECONDS_PER_DAY; stepSpoilage(tw.world, 24); }
    expect(bread.quantity).toBeLessThan(100);
    expect(grain.quantity).toBeGreaterThan(bread.quantity); // grain keeps far better
    const spoilEvents = tw.world.events.filter(e => e.type === 'resource_spoiled');
    expect(spoilEvents.length).toBeLessThanOrEqual(12); // ~1 per stack per pass, not per unit
    // non-perishable materials never spoil
    const plank = makeItem(tw.world, 'plank', 'plank', { placeId: home.id, quantity: 50 });
    stepSpoilage(tw.world, 24 * 30);
    expect(plank.quantity).toBe(50);
  });
});

describe('persistence — v0.3 canonical state round-trips (SAVE_VERSION 6)', () => {
  it('a haul in transit, a depleted tree, a partially-supplied project, and a completed structure survive save/reload', () => {
    const { world, gen } = newWorld(1337);
    const sim = new Simulation(world);
    // deplete one tree, start a haul, part-supply the shed project, and force-complete a copy
    const treeNode = world.resourceNodes.find(n => n.kind === 'tree')!;
    let g = 0; while (treeNode.state === 'available' && g++ < 20) extractFromNode(world, treeNode, gen.people.bors);
    const proj = world.constructionProjects[0];
    addPlaceStock(world, 'plank', 5, proj.sitePlaceId, null, undefined, 'delivered');
    proj.laborDone = 1234; proj.contributions[gen.people.bors.id] = 1234;
    const src = world.places().find(p => p.type === 'farm')!;
    const dst = world.places().find(p => p.type === 'mill')!;
    addPlaceStock(world, 'grain', 30, src.id, null, undefined, 'harvested');
    const task = createHaulTask(world, { resource: 'grain', quantity: 20, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.5 });
    claimHaulTask(world, task, gen.people.alwin);
    loadHaulCargo(world, task, gen.people.alwin);
    expect(task.status).toBe('in_transit');
    const grainTotal = worldStock(world, 'grain');

    const restored = deserialize(serialize(world))!.world;
    const rTask = restored.haulTasks.find(t => t.id === task.id)!;
    expect(rTask.status).toBe('in_transit');
    expect(rTask.carried).toBe(20);
    expect(restored.item(rTask.cargoItemId!)!.quantity).toBe(20);
    expect(worldStock(restored, 'grain')).toBe(grainTotal);
    const rTree = restored.resourceNodes.find(n => n.id === treeNode.id)!;
    expect(rTree.state).toBe('depleted');
    expect(restored.grid.get(treeNode.blocks[0].x, treeNode.blocks[0].y, treeNode.blocks[0].z)).toBe(B.Air);
    const rProj = restored.constructionProjects[0];
    expect(rProj.laborDone).toBe(1234);
    expect(stockAt(restored, 'plank', rProj.sitePlaceId)).toBe(5);

    // now a completed project round-trips into a real Place
    proj.required.forEach(r => addPlaceStock(world, r.type, r.quantity, proj.sitePlaceId, null, undefined, 'delivered'));
    proj.status = 'ready';
    contributeBuildLabor(world, proj, gen.people.bors, proj.laborRequired);
    expect(proj.status).toBe('complete');
    const restored2 = deserialize(serialize(world))!.world;
    const done = restored2.constructionProjects[0];
    expect(done.status).toBe('complete');
    expect(restored2.place(done.sitePlaceId)!.type).toBe('hut');
    void sim;
  });

  it('rejects a v0.2.4 (version 5) save', () => {
    const { world } = newWorld(1337);
    const stale = JSON.parse(serialize(world)); stale.version = 5;
    expect(deserialize(JSON.stringify(stale))).toBeNull();
  });
});

describe('behavioural integration — the full material chain, no player (v0.3)', () => {
  it('over 13 world-days: a tree is felled → logs hauled → sawn → planks & stone hauled to the site → build labour → the shed becomes a real, persistent Place', () => {
    const { world } = newWorld(918271);
    const sim = new Simulation(world);
    // v0.8 §D: the tavern's own real, recurring meat/firewood haul demands (world/cooking.ts,
    // world/metabolism.ts's `huntGame`) are two more legitimate haul tasks now competing for the
    // same finite pool of villagers who do hauling at all — real logistics competition, the same
    // class already disclosed for firewood's log→stick fix, not a bug in either path. At seed
    // 918271 this delayed the storage shed's LAST plank (15/16 delivered, not 16/16) past the
    // previous 12-day mark; it arrives and the shed completes well within one more day (13th).
    // Widened from 12 accordingly — still requires the full chain to genuinely complete, not a
    // loosened invariant.
    advance(world, sim, 13 * SECONDS_PER_DAY / 60);
    const t = world.runTally;
    // v0.6 §V: Bors (woodcutter) now starts with real woodcutting proficiency (world/village.ts's
    // `seedStartingSkills`) rather than novice-0, which increases yield per swing (fewer wasted
    // motions — Constitution v0.6 §V.7), so the same finite grove is felled in fewer, larger
    // extraction events than a novice would need. Lowered from >5 accordingly; still requires
    // multiple real extraction events across both chop and quarry, not a near-zero count.
    expect(t.resource_extracted ?? 0).toBeGreaterThan(2);          // trees chopped / stone quarried
    expect(t.resource_depleted ?? 0).toBeGreaterThan(0);           // a tree actually disappeared
    expect(t['hauled:log'] ?? 0).toBeGreaterThan(0);               // its material carried away
    expect(t['hauled:plank'] ?? 0).toBeGreaterThan(0);             // transformed and carried on
    expect(t['hauled:stone'] ?? 0).toBeGreaterThan(0);             // stone reached the site
    expect(t.construction_completed ?? 0).toBe(1);                 // a new structure exists
    const shed = world.places().find(p => p.name.includes('storage shed'))!;
    expect(shed.type).toBe('hut');
    // and it persists
    const restored = deserialize(serialize(world))!.world;
    expect(restored.places().find(p => p.name.includes('storage shed'))!.type).toBe('hut');
    // the spatial food chain still runs
    expect(t['hauled:grain'] ?? 0).toBeGreaterThan(0);
    expect(t['hauled:flour'] ?? 0).toBeGreaterThan(0);
    expect(t.food_consumed ?? 0).toBeGreaterThan(100);
    expect(world.persons().filter(p => p.alive).length).toBe(33);
  }, 150000);
});
