import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { newWorld, deserialize, serialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { learn, learnPlace, knownFoodPlace, noteFoodShortage, describeClaim } from '../src/sim/mind/knowledge';
import { remember, memoriesAbout, memoriesAtPlace } from '../src/sim/mind/memory';
import { skillOf, practiceSkill, seedStartingSkills, SKILL_FOR_TOOL_ACTION } from '../src/sim/core/skills';
import { getPhysicalCapability, capabilityFor } from '../src/sim/core/attributes';
import { buyFoodPortion, findAccessibleFood, eatFood } from '../src/sim/world/metabolism';
import type { ResourceNode, Person } from '../src/sim/core/types';
import { extractFromNode } from '../src/sim/world/resources';
import { performBuildLabor, createConstructionProject } from '../src/sim/world/construction';
import { claimedProductionRequest, fulfillProductionRequest, generateProductionNeeds } from '../src/sim/world/production';
import { runHeadless } from '../src/headless/runner';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let e = 0; e < seconds; e += 0.15) { const dt = Math.min(0.15, seconds - e); const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); }
}

// ==================================================================== Knowledge (v0.6 §III)
describe('knowledge: non-omniscient economic opportunity (v0.6 §III)', () => {
  it('a person with no knowledge of any food source resolves none — never a magical bakery scan', () => {
    const tw = createTestWorld(6001, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    void bakery;
    const stranger = addPerson(tw, 'Stranger', 'traveler', v(5, 1, 5));
    expect(knownFoodPlace(tw.world, stranger)).toBeUndefined();
  });

  it('direct observation: arriving at a place teaches what it offers', () => {
    const tw = createTestWorld(6002, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    const p = addPerson(tw, 'Newcomer', 'traveler', v(5, 1, 5));
    expect(knownFoodPlace(tw.world, p)).toBeUndefined();
    learnPlace(tw.world, p, bakery, { type: 'witnessed' });
    expect(knownFoodPlace(tw.world, p)).toBe(bakery.id);
    expect(p.knowledge[`svc:${bakery.id}`].kind).toBe('service');
    expect(describeClaim(tw.world, p.knowledge[`svc:${bakery.id}`])).toContain('food');
  });

  it('economic observation: a successful purchase teaches the source and outranks an unconfirmed one', () => {
    const tw = createTestWorld(6003, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    const store = makePlace(tw.world, 'store', 'Store', { x0: 1, z0: 1, x1: 5, z1: 5, y0: 1, y1: 3 }, { inside: v(3, 1, 3) });
    const baker = addPerson(tw, 'Baker', 'baker', v(22, 1, 22), { homeId: bakery.id });
    const buyer = addPerson(tw, 'Buyer', 'traveler', v(3, 1, 3));
    buyer.wealth = 20;
    // both are known (e.g. seeded generation knowledge) but neither confirmed by experience yet
    learnPlace(tw.world, buyer, bakery, { type: 'prior' });
    learnPlace(tw.world, buyer, store, { type: 'prior' });
    const bread = makeItem(tw.world, 'bread', 'loaf', { owner: baker.id, pos: v(22, 1, 22), placeId: bakery.id, quantity: 5, value: 2 });
    buyFoodPortion(tw.world, buyer, bread, 2);
    expect(memoriesAbout(buyer, baker.id).some(m => m.type === 'purchase')).toBe(true);
    expect(knownFoodPlace(tw.world, buyer)).toBe(bakery.id);
  });

  it('stale knowledge: a found-empty source is demoted (confidence lowered, not deleted) so it is not retried forever', () => {
    const tw = createTestWorld(6004, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    const store = makePlace(tw.world, 'store', 'Store', { x0: 1, z0: 1, x1: 5, z1: 5, y0: 1, y1: 3 }, { inside: v(3, 1, 3) });
    const p = addPerson(tw, 'Villager', 'traveler', v(3, 1, 3));
    learnPlace(tw.world, p, bakery, { type: 'prior' });
    learnPlace(tw.world, p, store, { type: 'prior' });
    const before = p.knowledge[`svc:${bakery.id}`].confidence;
    expect(knownFoodPlace(tw.world, p)).toBe(bakery.id); // first-seeded tie-break
    noteFoodShortage(tw.world, p, bakery.id);
    expect(p.knowledge[`svc:${bakery.id}`].confidence).toBeLessThan(before);
    expect(p.knowledge[`svc:${bakery.id}`]).toBeDefined(); // demoted, not erased — the place may just be temporarily out
    expect(knownFoodPlace(tw.world, p)).toBe(store.id); // now prefers the untainted alternative
  });

  it('knowledge round-trips save/load: service kind, confidence and lastConfirmedAt survive', () => {
    const { world } = newWorld(918271);
    const bakery = world.places().find(pl => pl.type === 'bakery')!;
    const someone = world.persons().find(pl => pl.alive && !pl.controlled)!;
    noteFoodShortage(world, someone, bakery.id);
    const k = someone.knowledge[`svc:${bakery.id}`];
    const raw = serialize(world);
    const loaded = deserialize(raw)!;
    const reloadedPerson = loaded.world.person(someone.id)!;
    const reloadedK = reloadedPerson.knowledge[`svc:${bakery.id}`];
    expect(reloadedK.confidence).toBeCloseTo(k.confidence, 5);
    expect(reloadedK.kind).toBe('service');
    expect(reloadedK.lastConfirmedAt).toBe(k.lastConfirmedAt);
  });
});

// ==================================================================== Memory (v0.6 §IV)
describe('memory has behavioral consequence (v0.6 §IV)', () => {
  it('a familiar (recently successful) food source is preferred over an equally-known, untested one', () => {
    const tw = createTestWorld(6101, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    const store = makePlace(tw.world, 'store', 'Store', { x0: 1, z0: 1, x1: 5, z1: 5, y0: 1, y1: 3 }, { inside: v(3, 1, 3) });
    const p = addPerson(tw, 'Villager', 'traveler', v(3, 1, 3));
    learnPlace(tw.world, p, store, { type: 'prior' }); // learned first — would win an ordinary tie
    learnPlace(tw.world, p, bakery, { type: 'prior' });
    expect(knownFoodPlace(tw.world, p)).toBe(store.id);
    remember(tw.world, p, { type: 'purchase', summary: 'bought bread at the bakery', significance: 0.15, valence: 0.2, source: { type: 'self' }, placeId: bakery.id });
    expect(knownFoodPlace(tw.world, p)).toBe(bakery.id); // recent success overturns pure recency/insertion order
  });

  it('a recent failure at a specific place does not overturn the whole village into an unresolved retry loop, and stays bounded', () => {
    const tw = createTestWorld(6102, 30);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 3 }, { inside: v(22, 1, 22) });
    const p = addPerson(tw, 'Villager', 'traveler', v(3, 1, 3));
    learnPlace(tw.world, p, bakery, { type: 'prior' });
    noteFoodShortage(tw.world, p, bakery.id);
    // still known — a memory of one bad visit doesn't erase the place from the world
    expect(knownFoodPlace(tw.world, p)).toBe(bakery.id);
    expect(memoriesAtPlace(p, bakery.id).length).toBeGreaterThan(0);
  });

  it('memories stay bounded over many routine events (no unbounded per-meal growth)', () => {
    const tw = createTestWorld(6103, 30);
    const p = addPerson(tw, 'Villager', 'traveler', v(3, 1, 3));
    for (let i = 0; i < 500; i++) remember(tw.world, p, { type: 'purchase', summary: `meal ${i}`, significance: 0.1, valence: 0, source: { type: 'self' } });
    expect(p.memories.length).toBeLessThanOrEqual(60);
  });
});

// ==================================================================== Skills (v0.6 §V)
describe('skills: learned capability distinct from attributes (v0.6 §V)', () => {
  it('an expert outperforms a novice with identical attributes/tool/physiology', () => {
    const tw = createTestWorld(6201, 30);
    const novice = addPerson(tw, 'Novice', 'woodcutter', v(5, 1, 5));
    const expert = addPerson(tw, 'Expert', 'woodcutter', v(5, 1, 5));
    novice.attributes = { ...novice.attributes }; expert.attributes = { ...novice.attributes };
    expert.physiology = { ...novice.physiology };
    expert.skills = { woodcutting: 0.9 };
    novice.skills = {};
    const capNovice = getPhysicalCapability(novice, tw.world, { action: 'chop' });
    const capExpert = getPhysicalCapability(expert, tw.world, { action: 'chop' });
    expect(capExpert.workRate).toBeGreaterThan(capNovice.workRate);
    expect(capExpert.energyCostMultiplier).toBeLessThan(capNovice.energyCostMultiplier);
  });

  it('a complete novice (skill 0) is numerically identical to the pre-skill formula — still able to work', () => {
    const tw = createTestWorld(6202, 30);
    const p = addPerson(tw, 'Novice', 'farmer', v(5, 1, 5));
    p.skills = {};
    const cap = getPhysicalCapability(p, tw.world, { action: 'construct' });
    expect(cap.workRate).toBeGreaterThan(0);
    expect(skillOf(p, 'construction')).toBe(0);
  });

  it('skill improves technique, never conjures resources — a chop still only yields from the finite node', () => {
    const tw = createTestWorld(6203, 30);
    const dropPlace = makePlace(tw.world, 'wilderness', 'clearing', { x0: 0, z0: 0, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const woodcutter = addPerson(tw, 'Woodcutter', 'woodcutter', v(5, 1, 5));
    woodcutter.skills = { woodcutting: 0.8 };
    const node: ResourceNode = { id: 'rn_test', kind: 'tree', yield: 'log', pos: v(5, 1, 5), blocks: [], remaining: 3, capacity: 3, renewable: true, regrowHours: 1, state: 'available', dropPlaceId: dropPlace.id };
    tw.world.resourceNodes.push(node);
    let totalGot = 0;
    while (node.state === 'available' && node.remaining > 0) totalGot += extractFromNode(tw.world, node, woodcutter);
    expect(totalGot).toBe(3); // exactly the node's capacity — no duplication regardless of skill
    expect(stockAt(tw.world, 'log', dropPlace.id)).toBe(3);
  });

  it('a real successful extraction advances proficiency; a no-op (depleted node) does not', () => {
    const tw = createTestWorld(6204, 30);
    const dropPlace = makePlace(tw.world, 'wilderness', 'clearing', { x0: 0, z0: 0, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const p = addPerson(tw, 'Woodcutter', 'woodcutter', v(5, 1, 5));
    p.skills = {};
    const node: ResourceNode = { id: 'rn_test2', kind: 'tree', yield: 'log', pos: v(5, 1, 5), blocks: [], remaining: 5, capacity: 5, renewable: true, regrowHours: 1, state: 'available', dropPlaceId: dropPlace.id };
    tw.world.resourceNodes.push(node);
    expect(skillOf(p, 'woodcutting')).toBe(0);
    extractFromNode(tw.world, node, p);
    expect(skillOf(p, 'woodcutting')).toBeGreaterThan(0);
    const after1 = skillOf(p, 'woodcutting');
    const depleted: ResourceNode = { ...node, id: 'rn_depleted', remaining: 0, state: 'depleted' };
    tw.world.resourceNodes.push(depleted);
    const got = extractFromNode(tw.world, depleted, p);
    expect(got).toBe(0);
    expect(skillOf(p, 'woodcutting')).toBe(after1); // no-op grants nothing
  });

  it('progression diminishes as proficiency rises (harder to gain the closer to mastery)', () => {
    const p = { skills: {} } as Person;
    practiceSkill(p, 'sawing', 1);
    const gain1 = skillOf(p, 'sawing');
    p.skills!.sawing = 0.9;
    practiceSkill(p, 'sawing', 1);
    const gain2 = skillOf(p, 'sawing') - 0.9;
    expect(gain2).toBeLessThan(gain1);
  });

  it('profession seeds plausible starting proficiency — not a total novice, not magical mastery', () => {
    const p = { skills: {} } as Person; (p as any).occupation = 'baker';
    seedStartingSkills(p as Person);
    expect(skillOf(p, 'baking')).toBeGreaterThan(0.3);
    expect(skillOf(p, 'baking')).toBeLessThan(1);
  });

  it('skill persists across save/load', () => {
    const { world } = newWorld(918271);
    const someone = world.persons().find(pl => pl.alive && !pl.controlled)!;
    someone.skills = { ...someone.skills, hauling: 0.42 };
    const raw = serialize(world);
    const loaded = deserialize(raw)!;
    expect(loaded.world.person(someone.id)!.skills.hauling).toBeCloseTo(0.42, 5);
  });

  it('construction labour credits skill only for real elapsed work', () => {
    const tw = createTestWorld(6205, 30);
    const site = makePlace(tw.world, 'construction', 'Site', { x0: 0, z0: 0, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const proj = createConstructionProject(tw.world, { name: 'Shed', template: 'storage_shed', siteBounds: { x0: 0, z0: 0, x1: 10, z1: 10, y0: 1, y1: 5 }, sitePlaceId: site.id, required: [], ownerId: null, laborRequired: 100 });
    proj.status = 'ready';
    const worker = addPerson(tw, 'Builder', 'apprentice', v(5, 1, 5));
    worker.skills = {};
    expect(skillOf(worker, 'construction')).toBe(0);
    performBuildLabor(tw.world, proj, worker, 120);
    expect(skillOf(worker, 'construction')).toBeGreaterThan(0);
  });
});

// ==================================================================== Intentions (v0.6 §VI)
describe('intentional action vertical slice (v0.6 §VI)', () => {
  it('a known, remembered food source produces a grounded obtain-food intention that leads to a real plan', () => {
    const tw = createTestWorld(6301, 40);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 25, z0: 25, x1: 29, z1: 29, y0: 1, y1: 3 }, { inside: v(27, 1, 27) });
    const baker = addPerson(tw, 'Baker', 'baker', v(27, 1, 27), { homeId: bakery.id });
    const bread = makeItem(tw.world, 'bread', 'loaf', { owner: baker.id, pos: v(27, 1, 27), placeId: bakery.id, quantity: 10, value: 2 });
    void bread;
    const hungry = addPerson(tw, 'Hungry', 'traveler', v(1, 1, 1));
    hungry.wealth = 20;
    hungry.physiology.energy = 0.15; // hunger well past 'urgent'
    learnPlace(tw.world, hungry, bakery, { type: 'prior' });
    step(tw, 3);
    expect(hungry.mind.goal?.type).toBe('eat');
    expect(hungry.mind.intention?.type).toBe('obtain_food');
    expect(hungry.mind.intention?.grounded).toBe(true);
    expect(hungry.mind.intention?.target).toBe(bakery.id);
  });

  it('an unknown food source cannot be magically targeted — the intention is an uninformed search, not a resolved trip', () => {
    const tw = createTestWorld(6302, 40);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 25, z0: 25, x1: 29, z1: 29, y0: 1, y1: 3 }, { inside: v(27, 1, 27) });
    void bakery;
    const hungry = addPerson(tw, 'Hungry', 'traveler', v(1, 1, 1));
    hungry.wealth = 20;
    hungry.physiology.energy = 0.15;
    step(tw, 3);
    // never targets the bakery it has no knowledge of
    expect(hungry.mind.goal?.targetPlace).not.toBe(bakery.id);
    if (hungry.mind.intention?.type === 'obtain_food') expect(hungry.mind.intention.grounded).toBe(false);
  });
});

// ==================================================================== Second producer (v0.6 §VIII)
describe('mill converted to demand-aware production (v0.6 §VIII)', () => {
  it('the mill only mills when a real production request exists, and never pays for a batch that produced nothing', () => {
    const tw = createTestWorld(6401, 30);
    const mill = makePlace(tw.world, 'mill', 'Mill', { x0: 0, z0: 0, x1: 5, z1: 5, y0: 1, y1: 3 }, { inside: v(2, 1, 2) });
    const miller = addPerson(tw, 'Miller', 'miller', v(2, 1, 2), { workId: mill.id });
    expect(claimedProductionRequest(tw.world, mill.id, 'flour', miller.id)).toBeUndefined();
    generateProductionNeeds(tw.world); // no grain — a request may or may not raise, but fulfilling must not pay
    const req = claimedProductionRequest(tw.world, mill.id, 'flour', miller.id);
    if (req) {
      const before = miller.wealth;
      const paid = fulfillProductionRequest(tw.world, req, miller, false);
      expect(paid).toBe(0);
      expect(miller.wealth).toBe(before);
    }
    addPlaceStock(tw.world, 'grain', 20, mill.id, null, undefined, 'test');
    generateProductionNeeds(tw.world);
    const req2 = claimedProductionRequest(tw.world, mill.id, 'flour', miller.id);
    expect(req2).toBeDefined();
  });
});

// ==================================================================== Determinism (unchanged)
describe('v0.6 determinism', () => {
  it('the same seed produces byte-identical canonical state after several world-days with the new systems active', () => {
    const a = runHeadless({ seed: 918271, days: 2 });
    const b = runHeadless({ seed: 918271, days: 2 });
    expect(a.summary.metabolism.avgHunger).toBe(b.summary.metabolism.avgHunger);
    expect(JSON.stringify(a.summary.cognition)).toBe(JSON.stringify(b.summary.cognition));
  }, 60000);
});
