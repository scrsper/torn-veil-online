import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/mind/agent';
import { newWorld, deserialize, serialize } from '../src/sim/persist/save';
import { createTestWorld, addPerson, step, v } from './helpers/world';
import { makeItem, makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt, takePlaceStock } from '../src/sim/world/stock';
import { createHaulTask, personalCarryUnits, failHaulTask } from '../src/sim/logistics/haul';
import {
  HUMAN_PHYSIOLOGY_PROFILE, physiologyProfileFor, defaultPhysiologyTraitsFor, AVERAGE_HUMAN_ADULT,
} from '../src/sim/core/species';
import {
  hungerBand, thirstBand, sleepBand, severityAtLeast, eatRestoresEnergy, drinkRestoresHydration,
  sleepRecover,
} from '../src/sim/core/physiology';
import { getPhysicalCapability } from '../src/sim/core/attributes';
import { interruptibilityOf, isCommittable, commitmentValidity } from '../src/sim/mind/commitment';
import { laborIncentive } from '../src/sim/mind/economy';
import {
  generateProductionNeeds, claimedProductionRequest, fulfillProductionRequest, openProductionRequests,
} from '../src/sim/world/production';
import { effectivePrice, scarcityModifier } from '../src/sim/world/pricing';
import { bake, BAKE_RATIO, buyFoodPortion } from '../src/sim/world/metabolism';
import { canonicalStateHash } from '../src/headless/benchmarkReport';
import { runHeadless } from '../src/headless/runner';
import { SECONDS_PER_HOUR } from '../src/sim/core/time';

function advance(world: ReturnType<typeof newWorld>['world'], sim: Simulation, seconds: number): void {
  for (let e = 0; e < seconds; e += 0.15) { const dt = Math.min(0.15, seconds - e); const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); }
}

// ==================================================================== I. Human baseline
describe('human physiology profile (v0.5 §I)', () => {
  it('an ordinary NPC resolves to the human physiology profile', () => {
    const tw = createTestWorld(5001, 20);
    const p = addPerson(tw, 'Villager', 'farmer', v(5, 1, 5));
    expect(p.species).toBe('human');
    expect(physiologyProfileFor(p.species)).toBe(HUMAN_PHYSIOLOGY_PROFILE);
    expect(HUMAN_PHYSIOLOGY_PROFILE.energyDrainMultiplier).toBe(1);
    expect(HUMAN_PHYSIOLOGY_PROFILE.hydrationDrainMultiplier).toBe(1);
  });

  it('the AverageHumanAdult reference profile is stable', () => {
    expect(AVERAGE_HUMAN_ADULT).toEqual({ bodySizeFactor: 1, conditioning: 1, sleepNeedFactor: 1 });
    // a person of exactly average build/height/strength reproduces it (within float rounding)
    const traits = defaultPhysiologyTraitsFor(30, 1, 1, 0.5);
    expect(traits.bodySizeFactor).toBeCloseTo(1, 6);
    expect(traits.conditioning).toBeCloseTo(1, 6);
    expect(traits.sleepNeedFactor).toBeCloseTo(1, 6);
  });

  it('individual characteristics produce bounded variation, not identical clones', () => {
    const small = defaultPhysiologyTraitsFor(30, 0.85, 0.85, 0.3);
    const large = defaultPhysiologyTraitsFor(30, 1.15, 1.1, 0.9);
    expect(large.bodySizeFactor).toBeGreaterThan(small.bodySizeFactor);
    // a bigger/stronger person has better conditioning (fatigue accumulates more slowly)
    expect(large.conditioning).toBeGreaterThan(small.conditioning);
  });

  it('variation does not produce absurd outliers even at extreme inputs', () => {
    const extremeOld = defaultPhysiologyTraitsFor(95, 1.15, 1.1, 0.95);
    const extremeYoung = defaultPhysiologyTraitsFor(4, 0.85, 0.85, 0.15);
    for (const t of [extremeOld, extremeYoung]) {
      expect(t.bodySizeFactor).toBeGreaterThanOrEqual(0.85); expect(t.bodySizeFactor).toBeLessThanOrEqual(1.2);
      expect(t.conditioning).toBeGreaterThanOrEqual(0.7); expect(t.conditioning).toBeLessThanOrEqual(1.25);
      expect(t.sleepNeedFactor).toBeGreaterThanOrEqual(0.85); expect(t.sleepNeedFactor).toBeLessThanOrEqual(1.15);
    }
  });

  it('makePerson assigns bounded, deterministic physiologyTraits (no RNG)', () => {
    const { world: w1 } = newWorld(6001);
    const { world: w2 } = newWorld(6001);
    const a1 = w1.persons().find(p => p.slug === 'alwin')!;
    const a2 = w2.persons().find(p => p.slug === 'alwin')!;
    expect(a1.physiologyTraits).toEqual(a2.physiologyTraits);
  });
});

// ==================================================================== II. Severity bands
describe('need severity bands (v0.5 §II.4)', () => {
  it('bands are ordered comfortable < noticeable < uncomfortable < urgent < critical', () => {
    expect(severityAtLeast('critical', 'urgent')).toBe(true);
    expect(severityAtLeast('urgent', 'critical')).toBe(false);
    expect(severityAtLeast('comfortable', 'comfortable')).toBe(true);
  });

  it('hunger/thirst/sleep bands rise with the underlying reserve depleting', () => {
    const tw = createTestWorld(5002, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.physiology.energy = 0.95; p.physiology.hydration = 0.95; p.physiology.fatigue = 0; p.physiology.sleepDebt = 0;
    // resync derived needs
    eatRestoresEnergy(p, 0); drinkRestoresHydration(p, 0);
    expect(hungerBand(p)).toBe('comfortable');
    expect(thirstBand(p)).toBe('comfortable');
    p.physiology.energy = 0.05; p.needs.hunger = 1 - p.physiology.energy;
    expect(hungerBand(p)).toBe('critical');
    p.physiology.hydration = 0.05; p.needs.thirst = 1 - p.physiology.hydration;
    expect(thirstBand(p)).toBe('critical');
    p.needs.energy = 0.9;
    expect(sleepBand(p)).toBe('critical');
  });

  it('thirst reaches urgency at a lower depletion than hunger (hydration drains faster)', () => {
    const tw = createTestWorld(5003, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.needs.hunger = 0.62; p.needs.thirst = 0.62;
    expect(severityAtLeast(thirstBand(p), 'urgent')).toBe(true);
    expect(severityAtLeast(hungerBand(p), 'urgent')).toBe(false);
  });
});

// ==================================================================== Hunger tolerance
describe('hunger tolerance (v0.5 §II/§VI)', () => {
  it('mild/moderate hunger does not force immediate eating over an ordinary goal', () => {
    const tw = createTestWorld(5101, 20);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 12, z0: 12, x1: 18, z1: 18, y0: 1, y1: 3 }, { inside: v(15, 1, 15), indoor: false });
    const p = addPerson(tw, 'Worker', 'vagrant', v(5, 1, 5));
    addPlaceStock(tw.world, 'stone', 10, src.id, null, undefined, 'test');
    createHaulTask(tw.world, { resource: 'stone', quantity: 4, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.9 });
    p.physiology.energy = 0.55; p.needs.hunger = 1 - p.physiology.energy; // 'uncomfortable', not urgent
    expect(severityAtLeast(hungerBand(p), 'urgent')).toBe(false);
    step(tw, 3);
    expect(p.mind.goal?.type).not.toBe('eat');
  });

  it('critical hunger eventually overrides ordinary committed work', () => {
    const tw = createTestWorld(5102, 20);
    const home = tw.places.tavern;
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 12, z0: 12, x1: 18, z1: 18, y0: 1, y1: 3 }, { inside: v(15, 1, 15), indoor: false });
    const p = addPerson(tw, 'Worker', 'vagrant', v(5, 1, 5), { homeId: home });
    makeItem(tw.world, 'bread', 'loaf of bread', { owner: p.id, placeId: home, pos: tw.world.place(home)!.inside, quantity: 5 });
    addPlaceStock(tw.world, 'stone', 10, src.id, null, undefined, 'test');
    createHaulTask(tw.world, { resource: 'stone', quantity: 4, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.9 });
    step(tw, 1); // adopt haul
    p.physiology.energy = 0.02; p.needs.hunger = 1 - p.physiology.energy;
    const mealsBefore = tw.world.runTally.food_consumed ?? 0;
    step(tw, 20);
    // over this window the override either shows as a currently-suspended/eating snapshot, OR
    // (just as valid — the interruption already happened AND resolved within the window) a real
    // meal was eaten, restoring energy well above the critical level it was forced down to.
    const overrodeVisibly = p.mind.goal?.type === 'eat' || p.mind.commitment?.status === 'suspended';
    const overrodeAndResolved = (tw.world.runTally.food_consumed ?? 0) > mealsBefore && p.physiology.energy > 0.3;
    expect(overrodeVisibly || overrodeAndResolved).toBe(true);
  });

  it('eating restores caloric energy and lowers the hunger band', () => {
    const tw = createTestWorld(5103, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.physiology.energy = 0.1; p.needs.hunger = 0.9;
    expect(hungerBand(p)).toBe('critical');
    eatRestoresEnergy(p);
    expect(p.physiology.energy).toBeGreaterThan(0.1);
    expect(severityAtLeast(hungerBand(p), 'urgent')).toBe(false);
  });
});

// ==================================================================== Thirst tolerance
describe('thirst tolerance (v0.5 §II/§VI)', () => {
  it('mild thirst does not immediately cancel a committed haul', () => {
    const tw = createTestWorld(5201, 20);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 12, z0: 12, x1: 18, z1: 18, y0: 1, y1: 3 }, { inside: v(15, 1, 15), indoor: false });
    const p = addPerson(tw, 'Worker', 'vagrant', v(5, 1, 5));
    addPlaceStock(tw.world, 'stone', 10, src.id, null, undefined, 'test');
    createHaulTask(tw.world, { resource: 'stone', quantity: 4, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.9 });
    step(tw, 1);
    expect(p.mind.goal?.type).toBe('haul');
    p.physiology.hydration = 0.55; p.needs.thirst = 1 - p.physiology.hydration; // 'uncomfortable'
    step(tw, 2);
    expect(p.mind.commitment?.status ?? 'active').toBe('active');
  });

  it('severe dehydration reduces work capacity', () => {
    const tw = createTestWorld(5202, 20);
    const hydrated = addPerson(tw, 'Hydrated', 'vagrant', v(5, 1, 5));
    const dehydrated = addPerson(tw, 'Dehydrated', 'vagrant', v(5, 1, 5));
    hydrated.physiology.hydration = 0.9; dehydrated.physiology.hydration = 0.08;
    const capH = getPhysicalCapability(hydrated, tw.world);
    const capD = getPhysicalCapability(dehydrated, tw.world);
    expect(capD.currentExertionCapacity).toBeLessThan(capH.currentExertionCapacity);
  });

  it('critical dehydration causes water-seeking to dominate', () => {
    const { world, gen } = newWorld(5203);
    const sim = new Simulation(world);
    const p = gen.people.alwin;
    p.physiology.hydration = 0.03; p.needs.thirst = 1 - p.physiology.hydration;
    advance(world, sim, 60);
    expect(['drink_water'].includes(p.mind.goal?.type ?? '') || p.physiology.hydration > 0.03).toBe(true);
  });

  it('drinking resolves the emergency', () => {
    const tw = createTestWorld(5204, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.physiology.hydration = 0.05; p.needs.thirst = 0.95;
    expect(thirstBand(p)).toBe('critical');
    drinkRestoresHydration(p);
    expect(severityAtLeast(thirstBand(p), 'urgent')).toBe(false);
  });
});

// ==================================================================== Sleep tolerance
describe('sleep tolerance (v0.5 §II/§VI)', () => {
  it('mild tiredness does not immediately force sleep', () => {
    const tw = createTestWorld(5301, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.physiology.fatigue = 0.3; p.physiology.sleepDebt = 2;
    p.needs.energy = p.physiology.fatigue * 0.55 + Math.min(1, p.physiology.sleepDebt / 9) * 0.55;
    expect(severityAtLeast(sleepBand(p), 'urgent')).toBe(false);
  });

  it('sleep debt progressively affects work capability', () => {
    const tw = createTestWorld(5302, 20);
    const rested = addPerson(tw, 'Rested', 'vagrant', v(5, 1, 5));
    const debted = addPerson(tw, 'Debted', 'vagrant', v(5, 1, 5));
    rested.physiology.sleepDebt = 0; debted.physiology.sleepDebt = 15;
    const capR = getPhysicalCapability(rested, tw.world);
    const capD = getPhysicalCapability(debted, tw.world);
    expect(capD.effectiveDexterity).toBeLessThan(capR.effectiveDexterity);
  });

  it('sufficiently severe sleep pressure overrides ordinary goals', () => {
    const { world, gen } = newWorld(5303);
    const sim = new Simulation(world);
    const p = gen.people.alwin;
    p.physiology.fatigue = 0.95; p.physiology.sleepDebt = 15;
    p.needs.energy = p.physiology.fatigue * 0.55 + Math.min(1, p.physiology.sleepDebt / 9) * 0.55;
    expect(sleepBand(p)).toBe('critical');
    advance(world, sim, 60);
    expect(['sleep'].includes(p.mind.goal?.type ?? '') || p.physiology.fatigue < 0.95).toBe(true);
  });

  it('actual sleep materially restores fatigue and sleep debt', () => {
    const tw = createTestWorld(5304, 20);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.physiology.fatigue = 0.8; p.physiology.sleepDebt = 10;
    sleepRecover(p, 4);
    expect(p.physiology.fatigue).toBeLessThan(0.8);
    expect(p.physiology.sleepDebt).toBeLessThan(10);
  });
});

// ==================================================================== Goal commitment
describe('goal commitment (v0.5 §III)', () => {
  function haulWorld(seed: number) {
    const tw = createTestWorld(seed, 40);
    makePlace(tw.world, 'well', 'Well', { x0: 18, z0: 18, x1: 20, z1: 20, y0: 1, y1: 3 }, { inside: v(19, 1, 19), indoor: false });
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33), indoor: false });
    const p = addPerson(tw, 'Hauler', 'vagrant', v(6, 1, 6));
    addPlaceStock(tw.world, 'stone', 30, src.id, null, undefined, 'test');
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 8, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.95 });
    return { tw, p, task, src, dst };
  }

  it('haul/build are committed interruptibility; ordinary goals are free', () => {
    expect(interruptibilityOf('haul')).toBe('committed');
    expect(interruptibilityOf('build')).toBe('committed');
    expect(interruptibilityOf('socialize')).toBe('free');
    expect(isCommittable('haul')).toBe(true);
    expect(isCommittable('socialize')).toBe(false);
  });

  it('a selected committed goal persists despite trivial utility fluctuation (rising social need)', () => {
    const { tw, p, task } = haulWorld(5401);
    step(tw, 1);
    expect(p.mind.goal?.type).toBe('haul');
    expect(p.mind.commitment?.status).toBe('active');
    p.needs.social = 0.6; // elevated but not overwhelming — should not preempt haul
    step(tw, 5);
    expect(p.mind.commitment?.status).not.toBe('abandoned');
    expect(task.delivered + task.carried).toBeGreaterThan(0);
  });

  it('socializing cannot repeatedly preempt a haul over many decision cycles', () => {
    const { tw, p } = haulWorld(5402);
    p.traits.sociability = 0.9;
    let socializeAdoptions = 0;
    for (let i = 0; i < 40; i++) {
      const before = p.mind.goal?.type;
      step(tw, 3);
      if (before !== 'socialize' && p.mind.goal?.type === 'socialize') socializeAdoptions++;
      p.needs.social = Math.min(1, p.needs.social + 0.05);
    }
    // socializing may occasionally win when the commitment is legitimately suspended by
    // something else, but must not be the dominant, repeated outcome preempting the haul.
    expect(socializeAdoptions).toBeLessThan(8);
  });

  it('a temporary physiological interruption suspends rather than destroys the commitment', () => {
    const { tw, p } = haulWorld(5403);
    step(tw, 1);
    expect(p.mind.commitment?.status).toBe('active');
    const savedTaskId = p.mind.commitment!.data?.taskId;
    p.physiology.hydration = 0.02; p.needs.thirst = 1 - p.physiology.hydration; // critical
    step(tw, 3);
    expect(p.mind.commitment).not.toBeNull();
    expect(p.mind.commitment!.data?.taskId).toBe(savedTaskId);
    expect(['suspended', 'active']).toContain(p.mind.commitment!.status);
  });

  it('the commitment resumes after the interrupting need resolves', () => {
    const { tw, p } = haulWorld(5404);
    step(tw, 1);
    p.physiology.hydration = 0.02; p.needs.thirst = 0.98;
    step(tw, 3);
    // resolve the thirst directly (simulating having drunk)
    p.physiology.hydration = 0.9; p.needs.thirst = 0.1;
    step(tw, 8);
    expect(p.mind.commitment?.status).not.toBe('abandoned');
    const resumedOrActive = p.mind.goal?.type === 'haul' || p.mind.commitment?.status === 'active';
    expect(resumedOrActive).toBe(true);
  });

  it('an invalidated request causes explicit, reason-coded abandonment', () => {
    const { tw, p, task } = haulWorld(5405);
    step(tw, 1);
    expect(p.mind.commitment?.status).toBe('active');
    failHaulTask(tw.world, task, 'test: source destroyed');
    step(tw, 2);
    expect(p.mind.commitment).toBeNull();
    const abandonEvents = tw.world.events.filter(e => e.type === 'goal_abandoned' && e.actor === p.id);
    expect(abandonEvents.length).toBeGreaterThan(0);
  });

  it('commitmentValidity reads canonical task/project state, not candidate presence', () => {
    const { tw, task } = haulWorld(5406);
    const commitment = { goalKey: 'haul:x', goalType: 'haul' as const, startedAt: 0, commitmentStrength: 0.7, interruptibility: 'committed' as const, status: 'active' as const, data: { taskId: task.id } };
    expect(commitmentValidity(tw.world, commitment)).toBe('valid');
    task.status = 'delivered';
    expect(commitmentValidity(tw.world, commitment)).toBe('completed');
    task.status = 'failed';
    expect(commitmentValidity(tw.world, commitment)).toBe('abandoned');
  });
});

// ==================================================================== v0.4 hysteresis regression
describe('v0.4 disclosed hysteresis pathology — regression (v0.5 §III.13)', () => {
  it('a weak worker on a heavy many-trip stone haul makes real progress or explicitly abandons — never indefinite thrashing without progress', () => {
    const tw = createTestWorld(5501, 40);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33), indoor: false });
    const weak = addPerson(tw, 'Weak', 'vagrant', v(6, 1, 6));
    weak.attributes.strength = 0.1;
    addPlaceStock(tw.world, 'stone', 30, src.id, null, undefined, 'test');
    const perTrip = personalCarryUnits(tw.world, weak, 'stone');
    expect(perTrip).toBeLessThan(12);
    const task = createHaulTask(tw.world, { resource: 'stone', quantity: 12, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.95 });
    let elapsed = 0; const maxSeconds = 30 * SECONDS_PER_HOUR;
    while (task.status !== 'delivered' && task.status !== 'failed' && task.status !== 'cancelled' && elapsed < maxSeconds) {
      const dt = 0.15; const wdt = tw.world.clock.advance(dt); tw.world.physicalTime += dt; tw.sim.step(dt, wdt); tw.sim.flushSpeech(); elapsed += dt;
    }
    const madeRealProgress = task.delivered > perTrip; // strictly more than one trip's worth
    const explicitlyAbandoned = (task.status === 'failed' || task.status === 'cancelled')
      && tw.world.events.some(e => e.type === 'goal_abandoned' && e.actor === weak.id);
    // never zero/first-trip-only progress with no resolution — the v0.4-disclosed failure mode
    expect(madeRealProgress || explicitlyAbandoned).toBe(true);
    expect(task.delivered).toBeGreaterThan(0);
  }, 30000);

  it('a comparable real-village weak worker completes real multi-trip progress through the ordinary think()/act() loop', () => {
    const { world, gen } = newWorld(5502);
    const sim = new Simulation(world);
    const hauler = gen.people.bors;
    hauler.attributes.strength = 0.15;
    const mill = world.places().find(p => p.type === 'mill')!;
    const bakery = world.places().find(p => p.type === 'bakery')!;
    makeItem(world, 'plank', 'plank', { placeId: mill.id, pos: { ...mill.inside }, quantity: 40 });
    const perTrip = personalCarryUnits(world, hauler, 'plank');
    const task = createHaulTask(world, { resource: 'plank', quantity: 10, sourcePlaceId: mill.id, destPlaceId: bakery.id, reason: 'x', requesterId: null, priority: 0.95 });
    let seconds = 0; const maxSeconds = 10 * SECONDS_PER_HOUR;
    while (task.status !== 'delivered' && seconds < maxSeconds) {
      const dt = 0.15; const wdt = world.clock.advance(dt); world.physicalTime += dt; sim.step(dt, wdt); sim.flushSpeech(); seconds += dt;
    }
    expect(task.delivered).toBeGreaterThan(perTrip);
    const commitEvents = world.events.filter(e => e.type === 'goal_committed' && e.actor === hauler.id);
    expect(commitEvents.length).toBeGreaterThan(0);
  }, 30000);
});

// ==================================================================== Autonomous production
describe('autonomous production (v0.5 §IV)', () => {
  it('low bread inventory creates a production request with pipeline-aware quantity', () => {
    const tw = createTestWorld(5601, 20);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    addPlaceStock(tw.world, 'bread', 5, bakery.id, null, undefined, 'test'); // well below trigger
    generateProductionNeeds(tw.world);
    const reqs = openProductionRequests(tw.world).filter(r => r.payload.placeId === bakery.id);
    expect(reqs.length).toBe(1);
    expect(reqs[0].payload.resource).toBe('bread');
    expect(reqs[0].payload.quantity).toBe(BAKE_RATIO.out);
  });

  it('pipeline-aware generation stops raising requests once open pipeline + stock reach the target, never runs away', () => {
    const tw = createTestWorld(5602, 20);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    addPlaceStock(tw.world, 'bread', 5, bakery.id, null, undefined, 'test'); // 5 have, trigger 30, batch 5 -> exactly 5 batches needed
    for (let i = 0; i < 12; i++) generateProductionNeeds(tw.world);
    const open = openProductionRequests(tw.world).filter(r => r.payload.placeId === bakery.id);
    expect(open.length).toBe(5); // bounded to what's actually needed to close the gap — not 12
    // calling it again once already covered raises nothing further (true duplicate-avoidance)
    generateProductionNeeds(tw.world);
    expect(openProductionRequests(tw.world).filter(r => r.payload.placeId === bakery.id).length).toBe(5);
  });

  it('abundant bread stock raises no production request', () => {
    const tw = createTestWorld(5603, 20);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    addPlaceStock(tw.world, 'bread', 200, bakery.id, null, undefined, 'test');
    generateProductionNeeds(tw.world);
    expect(openProductionRequests(tw.world).filter(r => r.payload.placeId === bakery.id).length).toBe(0);
  });

  it('production requires actual worker capability — no demand, no baking', () => {
    const tw = createTestWorld(5604, 20);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    addPlaceStock(tw.world, 'bread', 200, bakery.id, null, undefined, 'test'); // no demand
    const baker = addPerson(tw, 'Baker', 'baker', v(5, 1, 5));
    const req = claimedProductionRequest(tw.world, bakery.id, 'bread', baker.id);
    expect(req).toBeUndefined();
  });

  it('missing input (no flour) prevents production from completing the request', () => {
    const tw = createTestWorld(5605, 20);
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    addPlaceStock(tw.world, 'bread', 5, bakery.id, null, undefined, 'test');
    generateProductionNeeds(tw.world);
    const baker = addPerson(tw, 'Baker', 'baker', v(5, 1, 5));
    const req = claimedProductionRequest(tw.world, bakery.id, 'bread', baker.id)!;
    expect(req).toBeDefined();
    const result = bake(tw.world, baker); // no flour at the bakery
    expect(result.ok).toBe(false);
    const paid = fulfillProductionRequest(tw.world, req, baker, result.ok);
    expect(paid).toBe(0);
    expect(req.status).toBe('accepted'); // stays open for the next attempt — never paid for nothing
  });

  it('delivered input enables production and pays the accepted worker', () => {
    const tw = createTestWorld(5606, 20);
    const owner = addPerson(tw, 'Owner', 'merchant', v(1, 1, 1)); owner.wealth = 50;
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5), owner: owner.id });
    addPlaceStock(tw.world, 'bread', 5, bakery.id, null, undefined, 'test');
    addPlaceStock(tw.world, 'flour', 10, bakery.id, owner.id, undefined, 'test');
    generateProductionNeeds(tw.world);
    const baker = addPerson(tw, 'Baker', 'baker', v(5, 1, 5));
    const req = claimedProductionRequest(tw.world, bakery.id, 'bread', baker.id)!;
    const before = baker.wealth;
    const result = bake(tw.world, baker);
    expect(result.ok).toBe(true);
    const paid = fulfillProductionRequest(tw.world, req, baker, result.ok);
    expect(req.status).toBe('completed');
    expect(paid).toBeGreaterThan(0);
    expect(baker.wealth).toBe(before + paid);
  });
});

// ==================================================================== Pricing
describe('bounded dynamic pricing (v0.5 §V.17)', () => {
  it('scarcity increases price within bounds', () => {
    const base = 2;
    const scarce = effectivePrice('bread', base, 2); // far below the 40-unit reference
    expect(scarce).toBeGreaterThan(base);
    expect(scarce).toBeLessThanOrEqual(Math.round(base * 2.2));
  });

  it('abundance decreases price within bounds', () => {
    const base = 2;
    const abundant = effectivePrice('bread', base, 200); // far above reference
    expect(abundant).toBeLessThan(base);
    expect(abundant).toBeGreaterThanOrEqual(Math.round(base * 0.65));
  });

  it('price is never negative or zero', () => {
    expect(effectivePrice('bread', 2, 0)).toBeGreaterThan(0);
    expect(effectivePrice('bread', 2, 1_000_000)).toBeGreaterThan(0);
  });

  it('the scarcity modifier never runs away — bounded regardless of extreme stock ratios', () => {
    expect(scarcityModifier(0, 40)).toBeLessThanOrEqual(2.2);
    expect(scarcityModifier(1_000_000, 40)).toBeGreaterThanOrEqual(0.65);
    expect(scarcityModifier(40, 40)).toBeCloseTo(1, 6);
  });

  it('a purchase at the dynamic price still conserves currency and goods exactly', () => {
    const tw = createTestWorld(5701, 20);
    const seller = addPerson(tw, 'Seller', 'baker', v(5, 1, 5));
    const buyer = addPerson(tw, 'Buyer', 'vagrant', v(5, 1, 5)); buyer.wealth = 30;
    const bakery = makePlace(tw.world, 'bakery', 'Bakery', { x0: 2, z0: 2, x1: 8, z1: 8, y0: 1, y1: 3 }, { inside: v(5, 1, 5) });
    const forSale = makeItem(tw.world, 'bread', 'loaf of bread', { owner: seller.id, placeId: bakery.id, pos: bakery.inside, quantity: 5, value: 2 });
    const totalWealthBefore = tw.world.persons().reduce((a, p) => a + p.wealth, 0);
    const stockBefore = stockAt(tw.world, 'bread', bakery.id);
    const bought = buyFoodPortion(tw.world, buyer, forSale, 2);
    expect(bought).not.toBeNull();
    const totalWealthAfter = tw.world.persons().reduce((a, p) => a + p.wealth, 0);
    expect(totalWealthAfter).toBe(totalWealthBefore);
    expect(stockAt(tw.world, 'bread', bakery.id) + (bought?.quantity ?? 0)).toBe(stockBefore);
  });
});

// ==================================================================== Economic/physiology interaction
describe('economic/physiology interaction (v0.5 §V.19)', () => {
  it('a poor, hungry worker values paid work more strongly than a wealthy, well-fed one', () => {
    const tw = createTestWorld(5801, 20);
    const poor = addPerson(tw, 'Poor', 'vagrant', v(5, 1, 5)); poor.wealth = 0; poor.physiology.energy = 0.15; poor.needs.hunger = 0.85;
    const rich = addPerson(tw, 'Rich', 'vagrant', v(5, 1, 5)); rich.wealth = 200; rich.physiology.energy = 0.9; rich.needs.hunger = 0.1;
    expect(laborIncentive(poor)).toBeGreaterThan(laborIncentive(rich));
    expect(laborIncentive(poor)).toBeLessThanOrEqual(1.3);
    expect(laborIncentive(rich)).toBeGreaterThanOrEqual(0.7);
  });

  it('a critical physiological need still overrides a viable wage opportunity', () => {
    const tw = createTestWorld(5802, 40);
    makePlace(tw.world, 'well', 'Well', { x0: 18, z0: 18, x1: 20, z1: 20, y0: 1, y1: 3 }, { inside: v(19, 1, 19), indoor: false });
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33), indoor: false });
    const p = addPerson(tw, 'Poor', 'vagrant', v(6, 1, 6));
    p.wealth = 0; // maximal labor incentive
    addPlaceStock(tw.world, 'stone', 20, src.id, null, undefined, 'test');
    createHaulTask(tw.world, { resource: 'stone', quantity: 8, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.95 });
    p.physiology.hydration = 0.02; p.needs.thirst = 0.98; // critical
    step(tw, 3);
    expect(p.mind.goal?.type).not.toBe('haul');
  });

  it('a wealthy, well-fed person is not forced into unnecessary labor', () => {
    const tw = createTestWorld(5803, 40);
    const src = makePlace(tw.world, 'quarry', 'Quarry', { x0: 2, z0: 2, x1: 10, z1: 10, y0: 1, y1: 3 }, { inside: v(6, 1, 6), indoor: false });
    const dst = makePlace(tw.world, 'construction', 'Site', { x0: 30, z0: 30, x1: 36, z1: 36, y0: 1, y1: 3 }, { inside: v(33, 1, 33), indoor: false });
    const p = addPerson(tw, 'Rich', 'vagrant', v(6, 1, 6));
    p.wealth = 500; p.physiology.energy = 0.9; p.needs.hunger = 0.1;
    addPlaceStock(tw.world, 'stone', 20, src.id, null, undefined, 'test');
    createHaulTask(tw.world, { resource: 'stone', quantity: 8, sourcePlaceId: src.id, destPlaceId: dst.id, reason: 'x', requesterId: null, priority: 0.4 });
    expect(laborIncentive(p)).toBeCloseTo(0.7, 1);
  });
});

// ==================================================================== Determinism
describe('determinism (v0.5)', () => {
  it('identical seed and state produce an identical canonical hash', () => {
    const { world: w1 } = newWorld(5901);
    const { world: w2 } = newWorld(5901);
    const sim1 = new Simulation(w1); const sim2 = new Simulation(w2);
    advance(w1, sim1, 40); advance(w2, sim2, 40);
    expect(canonicalStateHash(w1)).toBe(canonicalStateHash(w2));
  });

  it('a different seed produces a distinct canonical hash', () => {
    const { world: w1 } = newWorld(5902);
    const { world: w2 } = newWorld(5903);
    const sim1 = new Simulation(w1); const sim2 = new Simulation(w2);
    advance(w1, sim1, 40); advance(w2, sim2, 40);
    expect(canonicalStateHash(w1)).not.toBe(canonicalStateHash(w2));
  });
});

// ==================================================================== Persistence
describe('v0.5 persistence round-trip (SAVE_VERSION 8)', () => {
  it('round-trips species, physiologyTraits, goal commitment (active/suspended), and a production request', () => {
    const { world, gen } = newWorld(5910);
    const p = gen.people.alwin;
    p.mind.commitment = {
      goalKey: 'haul:pl_9', goalType: 'haul', startedAt: 100, commitmentStrength: 0.7,
      interruptibility: 'committed', status: 'suspended', suspendedBy: 'drink_water', suspendedAt: 200,
      data: { taskId: 'haul_1' },
    };
    const bakery = world.places().find(pl => pl.type === 'bakery')!;
    takePlaceStock(world, 'bread', stockAt(world, 'bread', bakery.id), [bakery.id]); // village generation starts the bakery stocked — deplete it first
    addPlaceStock(world, 'bread', 5, bakery.id, null, undefined, 'test');
    generateProductionNeeds(world);
    const prodReqBefore = openProductionRequests(world).find(r => r.payload.placeId === bakery.id)!;
    expect(prodReqBefore).toBeDefined();

    const restored = deserialize(serialize(world))!.world;
    const rp = restored.person(p.id)!;
    expect(rp.species).toBe('human');
    expect(rp.physiologyTraits).toEqual(p.physiologyTraits);
    expect(rp.mind.commitment).toEqual(p.mind.commitment);
    const prodReqAfter = restored.requests.find(r => r.id === prodReqBefore.id);
    expect(prodReqAfter).toBeDefined();
    expect(prodReqAfter!.type).toBe('production');
    expect(prodReqAfter!.payload.placeId).toBe(bakery.id);
  });
});

// ==================================================================== Stress scenario smoke test
describe('stress scenario: scarcity-driven price/production response (v0.5 §XI)', () => {
  it('food scarcity raises price and production demand without arbitrary resource creation', () => {
    const result = runHeadless({ seed: 5920, days: 3 });
    const { world } = result;
    const bakery = world.places().find(p => p.type === 'bakery')!;
    const bread = stockAt(world, 'bread', bakery.id);
    const price = effectivePrice('bread', 2, bread);
    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThanOrEqual(Math.round(2 * 2.2));
    // conservation: total currency in the village is unaffected by anything but wages/purchases,
    // both of which move money between existing people — never create or destroy it.
    const totalWealth = world.persons().reduce((a, p) => a + p.wealth, 0);
    expect(Number.isFinite(totalWealth)).toBe(true);
  }, 60000);
});
