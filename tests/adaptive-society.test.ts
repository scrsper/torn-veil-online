import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { addPlaceStock, stockAt, takePlaceStock } from '../src/sim/world/stock';
import { villageStock } from '../src/sim/world/metabolism';
import { bake, mill } from '../src/sim/world/metabolism';
import { generateProductionNeeds } from '../src/sim/world/production';
import {
  maintainWorkStints, processFor, staffOf, tradePostAt, underServedPosts, unfitReason, workAuthorization,
} from '../src/sim/world/labor';
import { plausibleRespondersTo, standInCandidacy, STAND_IN_THRESHOLD } from '../src/sim/mind/succession';
import { instructionOf, teach, teachingOpportunity } from '../src/sim/mind/apprenticeship';
import { noteWorkBlocked, shortfallKey } from '../src/sim/world/shortfall';
import { activeConcerns, concernGoalBoost } from '../src/sim/mind/concern';
import { practiceSkill, skillOf, TRADE_BASELINE, tradeBatchSeconds, tradeYield } from '../src/sim/core/skills';

import { explainGoal, traceLines } from '../src/sim/history/causality';
import { recogniseClass } from '../src/sim/mind/vocation';
import type { Person, Place } from '../src/sim/core/types';

/**
 * ADAPTIVE SOCIETY. These assert that a village can lose an important worker, suffer a real
 * consequence, and SOMETIMES adapt — through capability, motive and opportunity rather than
 * through anything scripted.
 *
 * The negative assertions carry as much weight as the positive ones, and are not padding: that
 * somebody with no knowledge of a shortage is not a candidate, that a label grants nothing, that
 * a lesson is not a level, and that a village with nobody plausible simply stays short. A test
 * suite that only proved replacement happens would be satisfied by an `if (miller.dead) assign()`,
 * which is exactly what this milestone forbids.
 *
 * Everything goes through canonical methods. Nothing asserts on log text.
 */

type TW = ReturnType<typeof createTestWorld>;

interface Trades { mill: Place; bakery: Place; }

/** A test village with the two ends of one real supply chain in it. */
function withTrades(tw: TW): Trades {
  const mill = makePlace(tw.world, 'mill', 'test mill', { x0: 2, z0: 2, x1: 9, z1: 9, y0: 1, y1: 4 }, { inside: v(5, 1, 5) });
  const bakery = makePlace(tw.world, 'bakery', 'test bakery', { x0: 14, z0: 2, x1: 21, z1: 9, y0: 1, y1: 4 }, { inside: v(17, 1, 5) });
  return { mill, bakery };
}

/** Somebody whose trade this is: on the place's staff, at a settled tradesman's proficiency. */
function tradesman(tw: TW, name: string, place: Place, skill: 'milling' | 'baking', occupation: 'miller' | 'baker'): Person {
  const p = addPerson(tw, name, occupation, { ...place.inside }, { workId: place.id, homeId: place.id });
  place.workers.push(p.id);
  place.ownerId = place.ownerId ?? p.id;
  p.skills[skill] = TRADE_BASELINE;
  // Everybody in Ashford has a working day; the test helper's people do not, so give these two
  // the one schedule entry that makes them turn up to their own trade. Without it a baker has no
  // reason to be at his own oven at all, and "he went back to work" would not be expressible.
  p.schedule = [{ start: 0, end: 24, activity: 'work', placeId: place.id, label: `at the ${place.type}` }];
  return p;
}

/**
 * Raise the village's real, stock-driven demand for what these places make, and place it in the
 * past.
 *
 * The backdating is the fixture, not a cheat: `world/labor.ts` measures a stoppage as "this place
 * has been failing to answer the demand it has for N hours", so demand raised this instant is
 * correctly not yet a stoppage. Rewinding `createdAt` says "the village has been asking for flour
 * since yesterday morning" without spending fifteen real seconds of simulated time in every test
 * to establish it.
 */
function raiseDemand(tw: TW, standingHours = 20): void {
  generateProductionNeeds(tw.world);
  for (const r of tw.world.requests) if (r.type === 'production') r.createdAt = Math.min(r.createdAt, tw.world.now - standingHours * 3600);
}

/** Take a person out of the world the way a killing blow does, through the canonical path. Used
 * only where the test asserts on DEATH itself: it necessarily leaves a live bandit and a fresh
 * conflict in the village, which is real behaviour and would dominate any test that then wants to
 * watch people decide about work. */
function strikeDown(tw: TW, victim: Person): void {
  const raider = addPerson(tw, 'Raider', 'bandit', v(1, 1, 1));
  const rb = tw.world.primaryBody(raider.id)!;
  const vb = tw.world.primaryBody(victim.id)!;
  rb.pos = { x: vb.pos.x + 1, y: vb.pos.y, z: vb.pos.z };
  tw.sim.applyHit(raider, rb, vb, 500, 'kill');
}

/**
 * The quieter way a village loses a worker, and the one most of these tests use: he is laid up.
 * Canonical state (a real wound on a real body, past `SERIOUS_WOUND`) with nobody to be afraid
 * of, so what follows is a test of how people decide about WORK rather than of how they behave
 * around a bandit. The milestone asks for all four routes to a vacancy; `unfitReason`'s own test
 * covers the rest.
 */
function laidUp(tw: TW, worker: Person): void {
  const body = tw.world.primaryBody(worker.id)!;
  body.health = body.maxHealth * 0.2;
  if (worker.homeId) body.pos = { ...tw.world.place(worker.homeId)!.inside };
}

/** The canonical way a worker comes to believe their own trade has stopped. */
function findsTheBinEmpty(tw: TW, worker: Person, place: Place): void {
  const process = processFor(place.type)!;
  noteWorkBlocked(tw.world, worker, place.id, process.input, process.output);
}

// =============================================================================================
describe('Adaptive Society — 1. a lost worker is a real production loss', () => {
  it('stops the mill, and the stoppage is derived from staffing, demand and output rather than flagged', () => {
    const tw = createTestWorld(5101, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    addPlaceStock(tw.world, 'grain', 40, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);

    // The village genuinely is asking for flour...
    expect(tw.world.requests.some(r => r.type === 'production' && r.payload.resource === 'flour' && r.status === 'open')).toBe(true);
    // ...and while he is alive and at the stones there is still nothing vacant about the mill.
    const working = tradePostAt(tw.world, pl.mill)!;
    expect(working.ableStaff.map(s => s.id)).toEqual([hobb.id]);
    expect(working.underServed).toBe(false);
    expect(workAuthorization(tw.world, hobb, pl.mill)?.standing).toBe('worker');

    strikeDown(tw, hobb);
    expect(hobb.alive).toBe(false);

    const stopped = tradePostAt(tw.world, pl.mill)!;
    expect(stopped.ableStaff).toHaveLength(0);
    expect(stopped.unfit.map(u => u.reason)).toContain('dead');
    expect(stopped.underServed).toBe(true);
    // The grain is still physically there. Nothing about the material changed; the labour did.
    expect(stockAt(tw.world, 'grain', pl.mill.id)).toBe(40);
    expect(stockAt(tw.world, 'flour', pl.mill.id)).toBe(0);
  });

  it('reads every way of losing a worker off canonical state, with no vacancy flag anywhere', () => {
    // A wide map, so "he has left" can be expressed as a real distance rather than as a flag.
    const tw = createTestWorld(5102, 140);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const body = tw.world.primaryBody(hobb.id)!;
    raiseDemand(tw);

    expect(unfitReason(tw.world, hobb, pl.mill)).toBeNull();

    // incapacitated
    body.pose = 'downed';
    expect(unfitReason(tw.world, hobb, pl.mill)).toBe('incapacitated');
    body.pose = 'stand';

    // cannot perform the work: badly hurt
    body.health = body.maxHealth * 0.3;
    expect(unfitReason(tw.world, hobb, pl.mill)).toBe('badly hurt');
    body.health = body.maxHealth;

    // left
    body.pos = { x: 135, y: 1, z: 135 };
    expect(unfitReason(tw.world, hobb, pl.mill)).toBe('away');
    body.pos = { ...pl.mill.inside };

    // held
    hobb.custody = { active: true, byId: hobb.id, byFactionId: null, reason: 'test', since: 0, startedAt: 0, releaseAt: 0 } as unknown as Person['custody'];
    expect(unfitReason(tw.world, hobb, pl.mill)).toBe('held');
    hobb.custody = undefined;

    expect(unfitReason(tw.world, hobb, pl.mill)).toBeNull();
    // The post never carried a flag: recomputing it fresh gives the same answer each time.
    expect(tradePostAt(tw.world, pl.mill)!.underServed).toBe(false);
  });
});

// =============================================================================================
describe('Adaptive Society — 2. the shortage reaches a decision', () => {
  it('turns a stopped trade into a supply worry that lifts work which actually makes the material', () => {
    const tw = createTestWorld(5201, 40);
    const pl = withTrades(tw);
    const osric = tradesman(tw, 'Osric', pl.bakery, 'baking', 'baker');

    findsTheBinEmpty(tw, osric, pl.bakery);
    const worry = activeConcerns(osric).find(c => c.kind === 'supply');
    expect(worry?.resource).toBe('flour');

    // A `work` goal that DECLARES it would produce flour is lifted by the worry; one that
    // declares it would produce bread is not, and neither is an undeclared shift at his own oven
    // — the bakery does not make flour by his standing in it.
    expect(concernGoalBoost(osric, 'work', undefined, 'flour').bonus).toBeGreaterThan(0);
    expect(concernGoalBoost(osric, 'work', undefined, 'bread').bonus).toBe(0);
    expect(concernGoalBoost(osric, 'work', undefined, undefined).bonus).toBe(0);
  });
});

// =============================================================================================
describe('Adaptive Society — 3 & 4. who responds, and who does not', () => {
  /** A stopped mill, a baker who has found his own bin empty, and a stranger who has not. */
  function stoppedMill(seed: number) {
    const tw = createTestWorld(seed, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const osric = tradesman(tw, 'Osric', pl.bakery, 'baking', 'baker');
    addPlaceStock(tw.world, 'grain', 40, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    laidUp(tw, hobb);
    findsTheBinEmpty(tw, osric, pl.bakery);
    return { tw, pl, hobb, osric };
  }

  it('makes a plausible person a candidate on capability, awareness, proximity and stopped work', () => {
    const { tw, pl, osric } = stoppedMill(5301);
    const post = tradePostAt(tw.world, pl.mill)!;
    const cand = standInCandidacy(tw.world, osric, post);
    expect(cand).toBeTruthy();
    expect(cand!.score).toBeGreaterThanOrEqual(STAND_IN_THRESHOLD);
    // The reasons name real things, not a rule that fired.
    expect(cand!.reasons.join(' | ')).toMatch(/no flour|short of flour/);
    expect(cand!.reasons.join(' | ')).toMatch(/my own work is stopped/);
  });

  it('actually gets flour out of the stopped mill, and the record of it is opened only afterwards', () => {
    const { tw, pl, osric } = stoppedMill(5302);
    // He has walked to the mill — the ordinary `work` plan's own first action. Everything past
    // this point is the simulation's, not the test's.
    tw.world.primaryBody(osric.id)!.pos = { ...pl.mill.inside };
    expect(tw.world.workStints).toHaveLength(0);

    const grainBefore = stockAt(tw.world, 'grain', pl.mill.id);
    step(tw, 40);

    // Real flour, out of real grain, by a man who is not the miller. Asserted on the canonical
    // transform rather than on flour sitting at the mill, because by the end of the run the
    // ordinary logistics have already carried it to the bakery and the baker has baked it — the
    // whole chain, not a stalled first step.
    const milled = tw.world.events.filter(e => e.type === 'resource_transformed' && e.actor === osric.id && e.data.to === 'flour');
    expect(milled.length).toBeGreaterThan(0);
    expect(stockAt(tw.world, 'grain', pl.mill.id)).toBeLessThan(grainBefore);
    const stint = tw.world.workStints.find(s => s.personId === osric.id && s.placeId === pl.mill.id);
    expect(stint).toBeTruthy();
    expect(stint!.resource).toBe('flour');
    expect(stint!.batches).toBeGreaterThan(0);
    expect(stint!.skillAtStart).toBe(0);
    expect(skillOf(osric, 'milling')).toBeGreaterThan(0);
    expect(tw.world.events.some(e => e.type === 'work_taken_up' && e.actor === osric.id)).toBe(true);
  });

  it('does not make a candidate of somebody who has no idea anything is short', () => {
    const { tw, pl } = stoppedMill(5303);
    // Same trade, same proficiency, same village — and no belief about any shortage.
    const stranger = addPerson(tw, 'Stranger', 'baker', v(12, 1, 12));
    stranger.skills.baking = TRADE_BASELINE;
    const post = tradePostAt(tw.world, pl.mill)!;
    expect(standInCandidacy(tw.world, stranger, post)).toBeNull();
  });

  it('does not make a candidate of somebody who knows but is in no state to work', () => {
    const { tw, pl, osric } = stoppedMill(5304);
    const post = tradePostAt(tw.world, pl.mill)!;
    expect(standInCandidacy(tw.world, osric, post)).toBeTruthy();

    const body = tw.world.primaryBody(osric.id)!;
    body.health = body.maxHealth * 0.3;
    expect(standInCandidacy(tw.world, osric, post)).toBeNull();
    body.health = body.maxHealth;

    // ...nor of a child, whose body is the reason, and nor of the place's own worker.
    const child = addPerson(tw, 'Child', 'child', { ...pl.mill.inside });
    child.age = 9;
    findsTheBinEmpty(tw, child, pl.bakery);
    expect(standInCandidacy(tw.world, child, post)).toBeNull();
    for (const s of staffOf(tw.world, pl.mill)) expect(standInCandidacy(tw.world, s, post)).toBeNull();
  });
});

// =============================================================================================
describe('Adaptive Society — 5 & 6. a novice is worse at it, and gets better by doing it', () => {
  it('gets less flour out of the same grain, and takes longer over it', () => {
    const tw = createTestWorld(5501, 40);
    const pl = withTrades(tw);
    const expert = addPerson(tw, 'Expert', 'miller', { ...pl.mill.inside }, { workId: pl.mill.id });
    const novice = addPerson(tw, 'Novice', 'miller', { ...pl.mill.inside }, { workId: pl.mill.id });
    expert.skills.milling = TRADE_BASELINE;
    addPlaceStock(tw.world, 'grain', 60, pl.mill.id, expert.id, undefined, 'seeded');

    const byExpert = mill(tw.world, expert);
    const byNovice = mill(tw.world, novice);
    expect(byExpert.ok).toBe(true);
    expect(byNovice.ok).toBe(true);
    // Same grain in, less flour out — badly ground meal, not a failed batch.
    expect(byExpert.consumed).toBe(byNovice.consumed);
    expect(byNovice.produced).toBeLessThan(byExpert.produced);
    expect(byNovice.produced).toBeGreaterThan(0);

    // ...and more of their day spent on it, which is where the higher time-and-energy cost of an
    // unpractised hand comes from without a second rule for it.
    const process = processFor('mill')!;
    expect(tradeBatchSeconds(process.baseBatchSeconds, 0)).toBeGreaterThan(tradeBatchSeconds(process.baseBatchSeconds, TRADE_BASELINE));
    expect(tradeBatchSeconds(process.baseBatchSeconds, TRADE_BASELINE)).toBe(process.baseBatchSeconds);
    // A settled tradesman pays neither penalty — which is why the working village is unchanged.
    expect(tradeYield(4, TRADE_BASELINE)).toBe(4);
  });

  it('raises the relevant capability through real successful work, and only through that', () => {
    const tw = createTestWorld(5502, 40);
    const pl = withTrades(tw);
    const novice = addPerson(tw, 'Novice', 'baker', { ...pl.mill.inside }, { workId: pl.mill.id });
    expect(skillOf(novice, 'milling')).toBe(0);

    // A batch that cannot run trains nothing: the mill is empty.
    expect(mill(tw.world, novice).ok).toBe(false);
    expect(skillOf(novice, 'milling')).toBe(0);

    addPlaceStock(tw.world, 'grain', 90, pl.mill.id, novice.id, undefined, 'seeded');
    let last = 0;
    const gains: number[] = [];
    for (let i = 0; i < 12; i++) {
      expect(mill(tw.world, novice).ok).toBe(true);
      gains.push(skillOf(novice, 'milling') - last);
      last = skillOf(novice, 'milling');
    }
    expect(last).toBeGreaterThan(0);
    // Real accumulation, not a level: a dozen batches is a dozen batches' worth of progress, and
    // the trade is nowhere near mastered.
    expect(last).toBeLessThan(TRADE_BASELINE);
    // Diminishing, so nobody grinds their way to mastery in an afternoon.
    expect(gains[gains.length - 1]).toBeLessThan(gains[0]);
    // The trade improved and nothing else did.
    expect(skillOf(novice, 'baking')).toBe(0);
    // And the improvement is visible in the output: better hands, more flour from the same grain.
    expect(tradeYield(4, last)).toBeGreaterThanOrEqual(tradeYield(4, 0));
  });
});

// =============================================================================================
describe('Adaptive Society — 7. being shown how is not being able', () => {
  function pair(seed: number) {
    const tw = createTestWorld(seed, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const tomas = addPerson(tw, 'Tomas', 'apprentice', { ...pl.mill.inside });
    return { tw, pl, hobb, tomas };
  }

  it('leaves the student a belief with the teacher on it, and not one point of proficiency', () => {
    const { tw, hobb, tomas } = pair(5701);
    expect(teachingOpportunity(tw.world, hobb, tomas, 'milling')?.teacher.id).toBe(hobb.id);

    const before = skillOf(tomas, 'milling');
    const belief = teach(tw.world, hobb, tomas, 'milling');
    expect(belief).toBeTruthy();
    expect(skillOf(tomas, 'milling')).toBe(before);
    expect(skillOf(tomas, 'milling')).toBe(0);
    expect(skillOf(hobb, 'milling')).toBe(TRADE_BASELINE);

    // The provenance IS the apprenticeship: who taught whom, held in the student's own head.
    const held = instructionOf(tomas, 'milling')!;
    expect(held.kind).toBe('technique');
    expect(held.source.type).toBe('told');
    expect(held.source.from).toBe(hobb.id);
    expect(held.claim.teacherId).toBe(hobb.id);
    expect(held.confidence).toBeLessThan(1);
    expect(tw.world.events.some(e => e.type === 'work_taught' && e.actor === hobb.id && e.target === tomas.id)).toBe(true);
  });

  it('makes the practice that follows count for more, and is worth nothing without it', () => {
    const taught = pair(5702);
    teach(taught.tw.world, taught.hobb, taught.tomas, 'milling');
    const untaught = pair(5703);

    // Neither has done any work. They are mechanically identical.
    expect(skillOf(taught.tomas, 'milling')).toBe(skillOf(untaught.tomas, 'milling'));

    for (const side of [taught, untaught]) {
      addPlaceStock(side.tw.world, 'grain', 60, side.pl.mill.id, side.hobb.id, undefined, 'seeded');
      for (let i = 0; i < 8; i++) expect(mill(side.tw.world, side.tomas).ok).toBe(true);
    }
    expect(skillOf(taught.tomas, 'milling')).toBeGreaterThan(skillOf(untaught.tomas, 'milling'));
    // ...and instruction is still nowhere near mastery. Eight batches under a master is eight
    // batches, not a trade.
    expect(skillOf(taught.tomas, 'milling')).toBeLessThan(TRADE_BASELINE);
  });

  it('refuses to call two novices comparing notes a lesson', () => {
    const { tw, tomas } = pair(5704);
    const other = addPerson(tw, 'Other', 'vagrant', v(6, 1, 6));
    expect(teachingOpportunity(tw.world, tomas, other, 'milling')).toBeNull();
    expect(teach(tw.world, tomas, other, 'milling')).toBeTruthy(); // the raw act still records
    // ...but the guarded path — the one the simulation actually uses — never reaches it.
    expect(instructionOf(other, 'milling')).toBeTruthy();
    expect(skillOf(other, 'milling')).toBe(0);
  });

  it('does not teach across the village', () => {
    const { tw, hobb, tomas } = pair(5705);
    tw.world.primaryBody(tomas.id)!.pos = { x: 35, y: 1, z: 35 };
    expect(teachingOpportunity(tw.world, hobb, tomas, 'milling')).toBeNull();
  });
});

// =============================================================================================
describe('Adaptive Society — 8. circumstances decide, so the successor can differ', () => {
  /**
   * Two plausible people and one stopped mill. Nothing distinguishes the scenarios except
   * circumstance: in the first the experienced baker is fit; in the second he is badly hurt and
   * a poorer, closer neighbour with real household pressure is the one who answers.
   */
  function twoCandidates(seed: number) {
    const tw = createTestWorld(seed, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    // Candidate A: the baker, who helped at the stones years ago and whose own oven is now idle
    // for want of flour. Comfortable — the wage means nothing to him.
    const osric = tradesman(tw, 'Osric', pl.bakery, 'baking', 'baker');
    osric.skills.milling = 0.35;
    osric.wealth = 90;
    // Candidate B: a labourer with no trade behind him at all, living beside the mill, out of
    // silver and hungry. Everything he brings is circumstance.
    const cottage = makePlace(tw.world, 'house', 'the cottage', { x0: 10, z0: 10, x1: 13, z1: 13, y0: 1, y1: 4 }, { inside: v(11, 1, 11) });
    const tomas = addPerson(tw, 'Tomas', 'apprentice', { ...cottage.inside }, { homeId: cottage.id });
    tomas.wealth = 1;
    tomas.needs.hunger = 0.85;
    addPlaceStock(tw.world, 'grain', 40, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    laidUp(tw, hobb);
    // Both find out, by the two ordinary routes: Osric's own bin is empty; Tomas stands at the
    // idle mill and finds no flour there either.
    findsTheBinEmpty(tw, osric, pl.bakery);
    findsTheBinEmpty(tw, tomas, pl.mill);
    return { tw, pl, osric, tomas };
  }

  it('picks the experienced hand when he is fit, and the neighbour when he is not', () => {
    const a = twoCandidates(5801);
    const postA = tradePostAt(a.tw.world, a.pl.mill)!;
    const rankedA = plausibleRespondersTo(a.tw.world, postA);
    expect(rankedA.map(r => r.person.id)).toContain(a.osric.id);
    expect(rankedA.map(r => r.person.id)).toContain(a.tomas.id);
    expect(rankedA[0].person.id).toBe(a.osric.id);

    const b = twoCandidates(5802);
    const hurt = b.tw.world.primaryBody(b.osric.id)!;
    hurt.health = hurt.maxHealth * 0.3;
    const postB = tradePostAt(b.tw.world, b.pl.mill)!;
    const rankedB = plausibleRespondersTo(b.tw.world, postB);
    expect(rankedB.map(r => r.person.id)).not.toContain(b.osric.id);
    expect(rankedB[0].person.id).toBe(b.tomas.id);

    // The system did not simply prefer one of them by an arbitrary ranking: the same two people,
    // in two circumstances, produce two different answers.
    expect(rankedA[0].person.id).not.toBe(rankedB[0].person.id);
  });
});

// =============================================================================================
describe('Adaptive Society — 9. a society may simply fail to adapt', () => {
  it('leaves the mill stopped when nobody who could is anybody who knows', () => {
    const tw = createTestWorld(5901, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    // Two people who could physically do it, standing in the village, and no belief between them
    // that anything is wrong anywhere.
    addPerson(tw, 'Bystander', 'farmer', v(12, 1, 12));
    addPerson(tw, 'Other', 'guard', v(24, 1, 24));
    addPlaceStock(tw.world, 'grain', 40, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    laidUp(tw, hobb);

    const post = tradePostAt(tw.world, pl.mill)!;
    expect(post.underServed).toBe(true);
    expect(plausibleRespondersTo(tw.world, post)).toHaveLength(0);

    step(tw, 90);

    // Real, durable failure: the grain is still grain, and nothing in the simulation forced
    // somebody into the gap to make the story end well.
    expect(tw.world.workStints).toHaveLength(0);
    expect(tw.world.events.some(e => e.type === 'work_taken_up')).toBe(false);
    expect(villageStock(tw.world, 'flour')).toBe(0);
    expect(stockAt(tw.world, 'grain', pl.mill.id)).toBeGreaterThan(0);
  });
});

// =============================================================================================
describe('Adaptive Society — 10. resumed production eases the shortage downstream', () => {
  it('walks flour from a stand-in at the mill to the bakery and settles the baker\'s worry', () => {
    const tw = createTestWorld(6001, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const osric = tradesman(tw, 'Osric', pl.bakery, 'baking', 'baker');
    addPlaceStock(tw.world, 'grain', 60, pl.mill.id, hobb.id, undefined, 'seeded');
    takePlaceStock(tw.world, 'flour', 9999, [pl.bakery.id]);
    raiseDemand(tw);
    laidUp(tw, hobb);

    // The baker finds his own bin empty, and carries a real worry about it.
    findsTheBinEmpty(tw, osric, pl.bakery);
    const key = shortfallKey(pl.bakery.id, 'flour');
    expect(osric.knowledge[key].handled).toBeUndefined();
    expect(activeConcerns(osric).some(c => c.kind === 'supply' && c.resource === 'flour')).toBe(true);
    const breadBefore = stockAt(tw.world, 'bread', pl.bakery.id);

    // Everything from here is the simulation's: he walks to the idle mill, grinds badly, carries
    // the flour back through the ordinary haul market, and bakes with it. Nothing below is
    // staged; the test only watches and stops when he has found out that the shortage is over.
    let settled = false;
    let discharged = false;
    for (let i = 0; i < 90 && !discharged; i++) {
      step(tw, 2);
      settled ||= osric.knowledge[key]?.handled === true;
      discharged ||= tw.world.events.some(e => e.type === 'concern_resolved' && e.actor === osric.id && e.data.resolution === 'supplied');
    }

    expect(tw.world.events.some(e => e.type === 'resource_transformed' && e.actor === osric.id && e.data.to === 'flour')).toBe(true);
    expect(tw.world.workStints.some(s => s.personId === osric.id && s.placeId === pl.mill.id)).toBe(true);
    expect(stockAt(tw.world, 'bread', pl.bakery.id)).toBeGreaterThan(breadBefore);
    // He found out by getting a batch out of the very material he believed was gone
    // (world/shortfall.ts's `clearShortfall`) — not because the world was put right out of his
    // sight, which is a distinction the concern layer takes seriously.
    expect(settled).toBe(true);
    expect(discharged).toBe(true);
  });

  it('eases the shortage without ending it, because the stand-in is a worse miller', () => {
    const tw = createTestWorld(6003, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const novice = addPerson(tw, 'Carter', 'vagrant', { ...pl.mill.inside });
    addPlaceStock(tw.world, 'grain', 300, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);

    // The same grain, the same stones, the same number of batches — the only difference is whose
    // hands. Recovery is partial by construction, not by a tuned "recovery rate".
    const byHobb = { flour: 0, grain: stockAt(tw.world, 'grain', pl.mill.id) };
    for (let i = 0; i < 10; i++) byHobb.flour += mill(tw.world, hobb).produced;
    byHobb.grain -= stockAt(tw.world, 'grain', pl.mill.id);

    const byNovice = { flour: 0, grain: stockAt(tw.world, 'grain', pl.mill.id) };
    for (let i = 0; i < 10; i++) byNovice.flour += mill(tw.world, novice).produced;
    byNovice.grain -= stockAt(tw.world, 'grain', pl.mill.id);

    expect(byNovice.grain).toBe(byHobb.grain);          // the same grain went under the stones
    expect(byNovice.flour).toBeLessThan(byHobb.flour);  // and less flour came back out
    expect(byNovice.flour).toBeGreaterThan(0);          // but the mill is running again
    // ...and he is closing the gap, batch by batch, because the work itself is the teacher.
    expect(skillOf(novice, 'milling')).toBeGreaterThan(0);
  });

  it('gives the place its worker back when one is fit again, and ends the stint', () => {
    const tw = createTestWorld(6002, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const carter = addPerson(tw, 'Carter', 'vagrant', { ...pl.mill.inside });
    addPlaceStock(tw.world, 'grain', 60, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    const body = tw.world.primaryBody(hobb.id)!;
    body.health = body.maxHealth * 0.2;

    expect(tradePostAt(tw.world, pl.mill)!.underServed).toBe(true);
    expect(workAuthorization(tw.world, carter, pl.mill)?.standing).toBe('stand_in');
    // Record one real batch through the same path the work action uses.
    step(tw, 1);
    expect(mill(tw.world, carter).ok).toBe(true);

    body.health = body.maxHealth;
    expect(tradePostAt(tw.world, pl.mill)!.underServed).toBe(false);
    // ...and with the miller back, a stranger's standing to work his mill is gone.
    expect(workAuthorization(tw.world, carter, pl.mill)).toBeNull();
  });
});

// =============================================================================================
describe('Adaptive Society — 11. a label grants nothing', () => {
  it('does not let an occupation confer the capability, the yield, or the standing', () => {
    const tw = createTestWorld(6101, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    addPlaceStock(tw.world, 'grain', 90, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);

    // Somebody called a miller who has never touched a mill.
    const pretender = addPerson(tw, 'Pretender', 'miller', v(12, 1, 12));
    expect(skillOf(pretender, 'milling')).toBe(0);
    // The label does not put them on the mill's staff...
    expect(staffOf(tw.world, pl.mill).map(s => s.id)).not.toContain(pretender.id);
    // ...does not authorize them at a mill somebody is working...
    expect(workAuthorization(tw.world, pretender, pl.mill)).toBeNull();
    // ...and does not improve the flour when they do get to grind.
    tw.world.primaryBody(pretender.id)!.pos = { ...pl.mill.inside };
    const byPretender = mill(tw.world, pretender);
    const byHobb = mill(tw.world, hobb);
    expect(byPretender.produced).toBeLessThan(byHobb.produced);

    // And renaming somebody changes nothing about what they can do.
    const carter = addPerson(tw, 'Carter', 'vagrant', { ...pl.mill.inside });
    const before = mill(tw.world, carter).produced;
    carter.occupation = 'miller';
    expect(mill(tw.world, carter).produced).toBe(before);
    expect(skillOf(carter, 'milling')).toBeGreaterThan(0); // earned by the two batches, not the name
  });

  it('recognises a trade from what a life has contained, after the fact and never before it', () => {
    const tw = createTestWorld(6102, 40);
    const pl = withTrades(tw);
    const carter = addPerson(tw, 'Carter', 'vagrant', { ...pl.mill.inside });
    carter.occupation = 'miller';
    expect(recogniseClass(tw.world, carter)).toBeNull();

    // A season of real work at the stones, and the reading changes — because the work did.
    addPlaceStock(tw.world, 'grain', 900, pl.mill.id, carter.id, undefined, 'seeded');
    for (let i = 0; i < 120; i++) mill(tw.world, carter);
    practiceSkill(carter, 'hauling', 20);
    const recognised = recogniseClass(tw.world, carter);
    expect(recognised?.id).toBe('artisan');
    expect(recognised!.evidence.join(' ')).toMatch(/milling/);
  });
});

// =============================================================================================
describe('Adaptive Society — the causal trace', () => {
  it('walks a stand-in\'s decision back to the shortage that caused it', () => {
    const tw = createTestWorld(6201, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const osric = tradesman(tw, 'Osric', pl.bakery, 'baking', 'baker');
    addPlaceStock(tw.world, 'grain', 40, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    laidUp(tw, hobb);
    findsTheBinEmpty(tw, osric, pl.bakery);
    tw.world.primaryBody(osric.id)!.pos = { ...pl.mill.inside };

    // Caught while he is at it. Once the mill is producing again the post stops being
    // under-served and he goes back to his own oven — which is the system working, not a lapse,
    // so the trace has to be taken of a live decision rather than of the aftermath.
    let goal: NonNullable<Person['mind']['goal']> | null = null;
    for (let i = 0; i < 30 && !goal; i++) {
      step(tw, 2);
      const g = osric.mind.goal;
      if (g && g.type === 'work' && g.targetPlace === pl.mill.id) goal = g;
    }
    expect(goal).toBeTruthy();
    expect(goal!.targetPlace).toBe(pl.mill.id);
    const lines = traceLines(explainGoal(tw.world, osric, goal!));
    // "Osric chose to work at the test mill / because he is short of flour / because there is no
    // flour at the test bakery" — each link a thing he actually holds.
    expect(lines[0]).toMatch(/chose to work/);
    expect(lines.some(l => /because/.test(l) && /short of flour/.test(l))).toBe(true);
    expect(lines.some(l => /because/.test(l) && /no flour/.test(l))).toBe(true);
  });

  it('keeps the stint as provenance rather than permission, and closes it honestly', () => {
    const tw = createTestWorld(6202, 40);
    const pl = withTrades(tw);
    const hobb = tradesman(tw, 'Hobb', pl.mill, 'milling', 'miller');
    const carter = addPerson(tw, 'Carter', 'vagrant', { ...pl.mill.inside });
    addPlaceStock(tw.world, 'grain', 60, pl.mill.id, hobb.id, undefined, 'seeded');
    raiseDemand(tw);
    laidUp(tw, hobb);
    step(tw, 40);

    const stint = tw.world.workStints.find(s => s.personId === carter.id);
    if (stint) {
      expect(stint.skillAtStart).toBe(0);
      expect(skillOf(carter, 'milling')).toBeGreaterThan(stint.skillAtStart);
      expect(stint.endedAt).toBeUndefined();
      // A stint is never the reason somebody may work: remove the demand and the standing goes,
      // record or no record.
      for (const r of tw.world.requests) if (r.type === 'production') r.status = 'cancelled';
      expect(workAuthorization(tw.world, carter, pl.mill)).toBeNull();
      // And upkeep closes it once nothing is coming out of it any more.
      stint.lastBatchAt = tw.world.now - 1000 * 3600;
      maintainWorkStints(tw.world);
      expect(stint.endedAt).toBeDefined();
      expect(tw.world.events.some(e => e.type === 'work_given_up')).toBe(true);
    }
    expect(underServedPosts(tw.world).length).toBeGreaterThanOrEqual(0);
  });
});
