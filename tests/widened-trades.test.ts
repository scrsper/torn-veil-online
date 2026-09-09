import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt } from '../src/sim/world/stock';
import { createFire } from '../src/sim/world/fire';
import { generateProductionNeeds, productionSpecs, reserveFor } from '../src/sim/world/production';
import { consumerDemands } from '../src/sim/logistics/haul';
import { processFor, tradePostAt, tradeProcesses, underServedPosts, workAuthorization } from '../src/sim/world/labor';
import { standInCandidacy, STAND_IN_THRESHOLD } from '../src/sim/mind/succession';
import { noteWorkBlocked } from '../src/sim/world/shortfall';
import { teach, instructionOf } from '../src/sim/mind/apprenticeship';
import { skillOf, TRADE_BASELINE } from '../src/sim/core/skills';
import { tradeMakes, tradeNeeds } from '../src/sim/world/supply';
import { explainGoal, traceLines } from '../src/sim/history/causality';
import type { Occupation, Person, Place, PlaceType, SkillId } from '../src/sim/core/types';

/**
 * A WIDER TRADE ECONOMY.
 *
 * The generalised labour layer — vacancy derived rather than flagged (`world/labor.ts`), a
 * stand-in who is plausible rather than assigned (`mind/succession.ts`), being shown how
 * (`mind/apprenticeship.ts`), and growing into a trade (`mind/livelihood.ts`) — covered two of the
 * village's twenty occupations: the miller and the baker. Everything else was a label with no
 * mechanism behind it.
 *
 * These assert the same milestone result for each trade newly brought into the table, WITHOUT new
 * machinery: the same `tradePostAt` derivation, the same candidacy, the same stint, the same
 * causal walk. What matters here is that nothing below is trade-specific. Every test is
 * parameterised over `tradeProcesses()`, so a row added to that table without the mechanism
 * working for it fails these tests rather than passing them by omission.
 */

type TW = ReturnType<typeof createTestWorld>;

/** Every place type the labour layer now covers, with a person who plies it and its input. */
const TRADES = tradeProcesses().map(t => ({ ...t }));

function placeFor(tw: TW, type: PlaceType, at: { x: number; z: number }): Place {
  const place = makePlace(tw.world, type, `test ${type}`, { x0: at.x - 3, z0: at.z - 3, x1: at.x + 3, z1: at.z + 3, y0: 1, y1: 4 }, { inside: v(at.x, 1, at.z) });
  // The tavern's stew needs a real hearth. Creating one is world generation's job, not the
  // trade's — `runTradeBatch` lights and feeds it from whatever fuel is in the house.
  if (type === 'tavern') { createFire(tw.world, place.id, v(at.x, 1, at.z), false); addPlaceStock(tw.world, 'stick', 20, place.id, null, undefined, 'seeded'); }
  return place;
}

/** Somebody whose trade this is: on the place's staff, at a settled tradesman's proficiency. */
function tradesman(tw: TW, name: string, place: Place, skill: SkillId): Person {
  const p = addPerson(tw, name, 'villager', { ...place.inside }, { workId: place.id, homeId: place.id });
  place.workers.push(p.id);
  place.ownerId = place.ownerId ?? p.id;
  p.skills[skill] = TRADE_BASELINE;
  p.schedule = [{ start: 0, end: 24, activity: 'work', placeId: place.id, label: `at the ${place.type}` }];
  return p;
}

/** Real, stock-driven demand for what these places make, standing long enough to be a stoppage. */
function raiseDemand(tw: TW, standingHours = 20): void {
  generateProductionNeeds(tw.world);
  for (const r of tw.world.requests) if (r.type === 'production') r.createdAt = Math.min(r.createdAt, tw.world.now - standingHours * 3600);
}

/** The quieter way a village loses a worker: he is laid up past `SERIOUS_WOUND`. */
function laidUp(tw: TW, worker: Person): void {
  const body = tw.world.primaryBody(worker.id)!;
  body.health = body.maxHealth * 0.2;
  body.pos = { x: 1, y: 1, z: 1 };
}

/** One trade, working, with its input on hand and the village asking for its output. */
function workingTrade(seed: number, process: (typeof TRADES)[number]) {
  const tw = createTestWorld(seed, 60);
  const place = placeFor(tw, process.placeType, { x: 20, z: 20 });
  const holder = tradesman(tw, 'Holder', place, process.skill);
  addPlaceStock(tw.world, process.input, 60, place.id, holder.id, undefined, 'seeded');
  raiseDemand(tw);
  return { tw, place, holder };
}

describe('every trade in the table is a real, demand-driven process', () => {
  it('covers more than the mill and the bakery', () => {
    expect(TRADES.length).toBeGreaterThan(2);
    expect(TRADES.map(t => t.placeType)).toEqual(expect.arrayContaining(['mill', 'bakery', 'sawpit', 'tavern']));
  });

  for (const process of TRADES) {
    it(`${process.placeType}: the village can raise real demand for its ${process.output}`, () => {
      const { tw, place } = workingTrade(6100, process);
      const spec = productionSpecs().find(s => s.placeType === process.placeType && s.resource === process.output);
      expect(spec, `${process.placeType} has no production spec — under-servedness cannot be derived without one`).toBeTruthy();
      expect(reserveFor(tw.world, spec!, place).trigger).toBeGreaterThan(0);
      expect(tw.world.requests.some(r => r.type === 'production' && r.payload.placeId === place.id && r.payload.resource === process.output)).toBe(true);
    });

    it(`${process.placeType}: its input arrives through the canonical logistics record`, () => {
      // A trade whose supply is invisible to `CONSUMER_DEMANDS` is one whose stoppages nothing can
      // reason about — this is the claim `tests/causal-society.test.ts`'s drift alarm makes from
      // the other direction, asserted here per process rather than per generated village.
      expect(consumerDemands().some(d => d.destType === process.placeType && d.resource === process.input)).toBe(true);
    });

    it(`${process.placeType}: the trades table agrees about what is made here and out of what`, () => {
      // `world/supply.ts` is what a villager would say if asked where flour comes from, and its
      // own rule for adding a row is that the row must name a canonical process. Asserted from
      // this side too, so a process added to the table without the village's public account of it
      // being updated fails here rather than quietly misleading the inference engine.
      const occupation = summaryOccupation(process.placeType);
      expect(tradeMakes(occupation, process.output)).toBe(true);
      expect(tradeNeeds(occupation, process.input)).toBe(true);
    });
  }
});

/** The occupation this culture names the trade with — the same summary `mind/livelihood.ts` uses
 * when it records that somebody has taken a trade up. */
function summaryOccupation(placeType: PlaceType): Occupation {
  const named: Partial<Record<PlaceType, Occupation>> = {
    mill: 'miller', bakery: 'baker', sawpit: 'woodcutter', tavern: 'cook',
  };
  const occupation = named[placeType];
  if (!occupation) throw new Error(`no trade summary for ${placeType} — mind/livelihood.ts cannot name it`);
  return occupation;
}

describe('losing the holder of any trade is a real production loss', () => {
  for (const process of TRADES) {
    it(`${process.placeType}: derives the stoppage from staffing, demand and output — no vacancy flag`, () => {
      const { tw, place, holder } = workingTrade(6200, process);

      const working = tradePostAt(tw.world, place)!;
      expect(working.ableStaff.map(s => s.id)).toEqual([holder.id]);
      expect(working.underServed).toBe(false);
      expect(workAuthorization(tw.world, holder, place)?.standing).toBe('worker');

      laidUp(tw, holder);
      const stopped = tradePostAt(tw.world, place)!;
      expect(stopped.ableStaff).toHaveLength(0);
      expect(stopped.unfit.map(u => u.reason)).toContain('badly hurt');
      expect(stopped.underServed).toBe(true);
      expect(underServedPosts(tw.world).map(p => p.place.id)).toContain(place.id);
      // The material is still physically there. Nothing about it changed; the labour did.
      expect(stockAt(tw.world, process.input, place.id)).toBe(60);
    });
  }
});

describe('somebody plausible takes each trade up, through the mechanism that already existed', () => {
  /** A stopped trade, and a neighbour who has found their own work blocked for want of its output. */
  function stopped(seed: number, process: (typeof TRADES)[number]) {
    const { tw, place, holder } = workingTrade(seed, process);
    laidUp(tw, holder);
    // The neighbour's own trade needs what this place makes, and they have discovered it is gone
    // — the ordinary route to awareness, not a hand-written belief.
    const neighbour = addPerson(tw, 'Neighbour', 'villager', { ...place.inside }, { homeId: place.id });
    const downstream = makePlace(tw.world, 'store', 'their own work', { x0: 30, z0: 30, x1: 34, z1: 34, y0: 1, y1: 4 }, { inside: v(32, 1, 32) });
    neighbour.workId = downstream.id;
    noteWorkBlocked(tw.world, neighbour, downstream.id, process.output, process.output);
    return { tw, place, holder, neighbour };
  }

  for (const process of TRADES) {
    it(`${process.placeType}: makes them a candidate on what they know, not on what they are called`, () => {
      const { tw, place, neighbour } = stopped(6300, process);
      const post = tradePostAt(tw.world, place)!;
      const candidacy = standInCandidacy(tw.world, neighbour, post);
      expect(candidacy, `${process.placeType} produced no candidate`).toBeTruthy();
      expect(candidacy!.score).toBeGreaterThanOrEqual(STAND_IN_THRESHOLD);
      expect(candidacy!.reasons.join(' | ')).toMatch(new RegExp(`${process.output}|short|standing idle`));
      // ...and somebody with no idea anything is short is not a candidate at all.
      const stranger = addPerson(tw, 'Stranger', 'villager', { ...place.inside });
      expect(standInCandidacy(tw.world, stranger, post)).toBeNull();
    });

    it(`${process.placeType}: gets real output out of the stopped place, and the record follows the work`, () => {
      const { tw, place, neighbour } = stopped(6301, process);
      tw.world.primaryBody(neighbour.id)!.pos = { ...place.inside };
      expect(tw.world.workStints).toHaveLength(0);

      const auth = workAuthorization(tw.world, neighbour, place);
      expect(auth?.standing).toBe('stand_in');
      const inputBefore = stockAt(tw.world, process.input, place.id);
      step(tw, 60);

      const made = tw.world.events.filter(e => e.type === 'resource_transformed' && e.actor === neighbour.id && e.data.to === process.output);
      expect(made.length, `${process.placeType} produced nothing under a stand-in`).toBeGreaterThan(0);
      expect(stockAt(tw.world, process.input, place.id)).toBeLessThan(inputBefore);
      const stint = tw.world.workStints.find(s => s.personId === neighbour.id && s.placeId === place.id);
      expect(stint).toBeTruthy();
      expect(stint!.resource).toBe(process.output);
      expect(stint!.skillAtStart).toBe(0);
      // Real work, and only real work, raised the capability.
      expect(skillOf(neighbour, process.skill)).toBeGreaterThan(0);
      expect(tw.world.events.some(e => e.type === 'work_taken_up' && e.actor === neighbour.id)).toBe(true);
    });

    it(`${process.placeType}: the decision walks back to the shortage that caused it`, () => {
      const { tw, place, neighbour } = stopped(6302, process);
      tw.world.primaryBody(neighbour.id)!.pos = { ...place.inside };
      // Caught while they are at it. Once the place is producing again it stops being
      // under-served and they go back to their own work — which is the system working, not a
      // lapse, so the trace has to be of a live decision rather than of the aftermath.
      let goal: NonNullable<Person['mind']['goal']> | null = null;
      for (let i = 0; i < 40 && !goal; i++) {
        step(tw, 2);
        const g = neighbour.mind.goal;
        if (g && g.type === 'work' && g.targetPlace === place.id) goal = g;
      }
      expect(goal, `${process.placeType} never produced a live decision to work it`).toBeTruthy();
      const lines = traceLines(explainGoal(tw.world, neighbour, goal!));
      expect(lines[0]).toMatch(/chose to work/);
      // Each link is a thing this person actually holds — the worry, and the belief under it.
      expect(lines.some(l => /because/.test(l) && new RegExp(`short of ${process.output}`).test(l))).toBe(true);
      expect(lines.some(l => /because/.test(l) && new RegExp(`no ${process.output}`).test(l))).toBe(true);
    });

    it(`${process.placeType}: can be shown, and being shown is not being able`, () => {
      const { tw, place, holder } = workingTrade(6303, process);
      const student = addPerson(tw, 'Student', 'villager', { ...place.inside }, { homeId: place.id });
      const lesson = teach(tw.world, holder, student, process.skill);
      expect(lesson, `${process.placeType} could not be taught`).toBeTruthy();
      expect(instructionOf(student, process.skill)).toBeTruthy();
      expect(skillOf(student, process.skill)).toBe(0);
    });
  }
});

describe('what is deliberately still outside the table', () => {
  it('has no process for a trade with no material flow behind it', () => {
    // The smithy is a real place with a real occupation and a real schedule, and there is no
    // process in this simulation that forges anything: nothing consumes ore or stone as a trade
    // input and nothing produces a weapon. `world/supply.ts`'s own doc records that a `smith` row
    // claiming swords out of stone was written once and removed for exactly this reason. A fake
    // process is worse than an honest gap, so the gap is asserted rather than filled.
    expect(processFor('smithy')).toBeUndefined();
    expect(tradeMakes('smith', 'sword' as never)).toBe(false);
  });

  it('has no process for the gathering trades, which are a different shape of work', () => {
    // A herbalist's herbs and a hunter's game have no material input to be short of and no fixed
    // place a stand-in could take over — see `TRADE_PROCESSES`'s own note.
    expect(processFor('stall')).toBeUndefined();
    expect(processFor('farm')).toBeUndefined();
  });
});
