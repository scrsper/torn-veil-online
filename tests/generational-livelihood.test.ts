import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { addPlaceStock } from '../src/sim/world/stock';
import { generateProductionNeeds } from '../src/sim/world/production';
import { staffOf, tradePostAt, workAuthorization } from '../src/sim/world/labor';
import { teach } from '../src/sim/mind/apprenticeship';
import { practiceSkill, skillOf, TRADE_BASELINE } from '../src/sim/core/skills';
import { lifeStageFor } from '../src/sim/core/species';
import { stepDemographics } from '../src/sim/world/demographics';
import {
  LIVELIHOOD_THRESHOLD, livelihoodProspects, recogniseLivelihood, stepLivelihoods, takeUpLivelihood,
} from '../src/sim/mind/livelihood';
import { currentScheduleEntry } from '../src/sim/mind/schedule';
import { mill } from '../src/sim/world/metabolism';
import type { Person, Place } from '../src/sim/core/types';

/**
 * GENERATIONAL CONTINUITY — that `coming_of_age` has consequences, and that the consequences come
 * from what somebody's life actually contained rather than from a label being written.
 *
 * The negative assertions are the load-bearing ones. A suite that only proved "a grown child gets
 * a job" would be satisfied by `if (age >= 18) p.occupation = 'miller'`, which is precisely the
 * capability-from-label inversion Constitution invariant IX forbids and which Adaptive Society
 * already deleted from this codebase once.
 */

type TW = ReturnType<typeof createTestWorld>;

function withMill(tw: TW): Place {
  const place = makePlace(tw.world, 'mill', 'test mill', { x0: 2, z0: 2, x1: 9, z1: 9, y0: 1, y1: 4 }, { inside: v(5, 1, 5) });
  addPlaceStock(tw.world, 'grain', 200, place.id, null, undefined, 'seeded');
  return place;
}

/** Somebody whose trade this is, on the place's own staff at a settled tradesman's proficiency. */
function miller(tw: TW, name: string, place: Place, age = 45): Person {
  const p = addPerson(tw, name, 'miller', { ...place.inside }, { workId: place.id, homeId: place.id });
  place.workers.push(p.id);
  place.ownerId = place.ownerId ?? p.id;
  p.skills.milling = TRADE_BASELINE;
  p.age = age;
  p.birthTick = tw.world.now - age * 365 * 86400;
  p.lifeStage = lifeStageFor(p.species, p.age);
  p.schedule = [{ start: 0, end: 24, activity: 'work', placeId: place.id, label: 'at the mill' }];
  return p;
}

/** A grown child of the household, with no trade of their own. */
function grownChild(tw: TW, name: string, place: Place, household: Person, age = 19): Person {
  const p = addPerson(tw, name, 'villager', { ...place.inside }, { homeId: place.id });
  p.age = age;
  p.birthTick = tw.world.now - age * 365 * 86400;
  p.lifeStage = lifeStageFor(p.species, p.age);
  p.parentIds = [household.id];
  return p;
}

/** Real, stock-driven demand for flour, standing long enough to count as a stoppage. */
function raiseDemand(tw: TW, standingHours = 20): void {
  generateProductionNeeds(tw.world);
  for (const r of tw.world.requests) if (r.type === 'production') r.createdAt = Math.min(r.createdAt, tw.world.now - standingHours * 3600);
}

describe('coming of age has a consumer', () => {
  it('stops giving a grown person a child\'s day', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Grown', 'child', v(10, 1, 10));
    p.age = 17;
    p.birthTick = tw.world.now - 17 * 365 * 86400;
    p.lifeStage = 'adolescent';
    p.schedule = [{ start: 8, end: 18, activity: 'play', placeId: tw.places.square, label: 'play' }];

    // A day passes and they turn eighteen. Age is derived from the birth tick, so this is the
    // ordinary ageing path, not a written life stage.
    tw.world.clock.advance((365 * 86400) / tw.world.clock.timeScale);
    stepDemographics(tw.world);

    expect(p.lifeStage).toBe('adult');
    expect(tw.world.events.some(e => e.type === 'coming_of_age' && e.actor === p.id)).toBe(true);
    expect(p.occupation).not.toBe('child');
    expect(p.schedule.some(s => s.activity === 'play')).toBe(false);
    expect(p.schedule.some(s => s.activity === 'work')).toBe(true);
    // And nobody has been given a job: a rhythm is not a post.
    expect(p.workId).toBeNull();
  });

  it('does not touch somebody who already holds a trade', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const p = addPerson(tw, 'Working', 'baker', v(10, 1, 10), { workId: place.id });
    p.age = 17;
    p.birthTick = tw.world.now - 17 * 365 * 86400;
    p.lifeStage = 'adolescent';
    tw.world.clock.advance((365 * 86400) / tw.world.clock.timeScale);
    stepDemographics(tw.world);
    expect(p.lifeStage).toBe('adult');
    expect(p.occupation).toBe('baker');
    expect(p.workId).toBe(place.id);
  });
});

describe('a trade is recognised, never issued', () => {
  it('gives nobody a trade for being born into the household alone', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);   // elder: there is real room at the work
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    raiseDemand(tw);

    // Being the miller's grown child is a reason to be at the mill...
    const prospects = livelihoodProspects(tw.world, child);
    expect(prospects.map(x => x.place.id)).toContain(place.id);
    // ...and it is not, on its own, a trade.
    expect(recogniseLivelihood(tw.world, child)).toBeNull();
    stepLivelihoods(tw.world);
    expect(child.workId).toBeNull();
    expect(child.occupation).toBe('villager');
  });

  it('recognises a trade once there is real instruction and real room at the work', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    raiseDemand(tw);

    // The one thing that changes: they were shown the work, by somebody who can do it, at it.
    const lesson = teach(tw.world, hobb, child, 'milling');
    expect(lesson).toBeTruthy();
    // Instruction is not capability — that invariant must survive this milestone.
    expect(skillOf(child, 'milling')).toBe(0);

    const recognised = recogniseLivelihood(tw.world, child);
    expect(recognised).toBeTruthy();
    expect(recognised!.place.id).toBe(place.id);
    expect(recognised!.score).toBeGreaterThanOrEqual(LIVELIHOOD_THRESHOLD);
    expect(recognised!.teacherId).toBe(hobb.id);
    expect(recognised!.causes.length).toBeGreaterThan(0);
  });

  it('recognises nothing while everyone holding the trade is fit and in their working years', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 40);   // no room: he is at his own stones
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);
    expect(recogniseLivelihood(tw.world, child)).toBeNull();
  });

  it('recognises nothing in an adolescent body, however much they have been shown', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb, 15);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);
    expect(child.lifeStage).toBe('adolescent');
    expect(recogniseLivelihood(tw.world, child)).toBeNull();
  });
});

describe('taking up a trade is a canonical transition with real consequences', () => {
  it('makes the work possible, and the label follows rather than leads', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);

    // Before: standing in the mill authorises nothing — its own miller is fit and at work.
    expect(workAuthorization(tw.world, child, place)).toBeNull();

    stepLivelihoods(tw.world);

    // After: the canonical record of where somebody works has changed, and that — not the
    // occupation string — is what `world/labor.ts` reads.
    expect(child.workId).toBe(place.id);
    expect(place.workers).toContain(child.id);
    expect(staffOf(tw.world, place).map(s => s.id)).toContain(child.id);
    expect(workAuthorization(tw.world, child, place)?.standing).toBe('worker');
    // The label is a summary of that, written last.
    expect(child.occupation).toBe('miller');
    // And a real, once-only canonical event carrying the evidence.
    const events = tw.world.events.filter(e => e.type === 'livelihood_taken_up' && e.actor === child.id);
    expect(events).toHaveLength(1);
    expect(events[0].data.teacherId).toBe(hobb.id);
    expect(events[0].placeId).toBe(place.id);
    // Idempotent: a second daily pass does not re-take a trade already held.
    stepLivelihoods(tw.world);
    expect(tw.world.events.filter(e => e.type === 'livelihood_taken_up' && e.actor === child.id)).toHaveLength(1);
  });

  it('starts them as a novice: the trade is taken up, the proficiency is not', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);
    stepLivelihoods(tw.world);

    expect(skillOf(child, 'milling')).toBe(0);
    // Their own real work is what makes them a miller in fact as well as in name, and it goes
    // into the economy's output through the ordinary conservation-checked transform.
    const before = tw.world.items().filter(i => i.type === 'flour').reduce((n, i) => n + i.quantity, 0);
    const result = mill(tw.world, child);
    expect(result.ok).toBe(true);
    expect(result.produced).toBeGreaterThan(0);
    const after = tw.world.items().filter(i => i.type === 'flour').reduce((n, i) => n + i.quantity, 0);
    expect(after).toBeGreaterThan(before);
    expect(skillOf(child, 'milling')).toBeGreaterThan(0);
    // A novice's batch is genuinely worse than a settled tradesman's — no free mastery.
    const veteran = mill(tw.world, hobb);
    expect(result.produced).toBeLessThan(veteran.produced);
  });

  it('gives them a working day at a real post, derived from the post rather than written', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);
    stepLivelihoods(tw.world);

    const working = child.schedule.filter(s => s.activity === 'work');
    expect(working.length).toBeGreaterThan(0);
    expect(working.every(s => s.placeId === place.id)).toBe(true);
    expect(currentScheduleEntry(child, 9)).toBeTruthy();
  });

  it('leaves the village unchanged when nobody has been shown anything', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    miller(tw, 'Hobb', place, 70);
    const stranger = addPerson(tw, 'Stranger', 'villager', v(30, 1, 30));
    stranger.age = 30;
    stranger.birthTick = tw.world.now - 30 * 365 * 86400;
    stranger.lifeStage = 'adult';
    raiseDemand(tw);
    stepLivelihoods(tw.world);
    expect(stranger.workId).toBeNull();
    expect(stranger.occupation).toBe('villager');
  });

  it('lets demonstrated proficiency stand in for having been shown', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    // Never taught by anybody — but they have genuinely ground grain before.
    for (let i = 0; i < 20; i++) practiceSkill(child, 'milling');
    raiseDemand(tw);
    const recognised = recogniseLivelihood(tw.world, child);
    expect(recognised).toBeTruthy();
    expect(recognised!.teacherId).toBeUndefined();
  });
});

describe('the derivation reads facts, not names', () => {
  it('reads two people with the same history the same way whatever they are called', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const a = grownChild(tw, 'Called Villager', place, hobb);
    const b = grownChild(tw, 'Called Vagrant', place, hobb);
    b.occupation = 'vagrant';
    for (const p of [a, b]) { p.householdId = 'hh_test'; for (let i = 0; i < 20; i++) practiceSkill(p, 'milling'); }
    hobb.householdId = 'hh_test';
    raiseDemand(tw);
    const ra = recogniseLivelihood(tw.world, a);
    const rb = recogniseLivelihood(tw.world, b);
    expect(ra).toBeTruthy();
    expect(rb).toBeTruthy();
    expect(ra!.score).toBeCloseTo(rb!.score, 6);
  });

  it('does not read a trade off an occupation string alone', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    miller(tw, 'Hobb', place, 70);
    // Called a miller, has never been near a mill, holds no post.
    const pretender = addPerson(tw, 'Pretender', 'miller', v(30, 1, 30));
    pretender.age = 30;
    pretender.birthTick = tw.world.now - 30 * 365 * 86400;
    pretender.lifeStage = 'adult';
    raiseDemand(tw);
    expect(recogniseLivelihood(tw.world, pretender)).toBeNull();
    expect(workAuthorization(tw.world, pretender, place)).toBeNull();
  });
});

describe('the whole chain, unattended', () => {
  it('carries a grown child from being shown the work to producing real flour', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    raiseDemand(tw);

    // 1. Being at the work is a reason the world gives them, not one anybody writes.
    const before = livelihoodProspects(tw.world, child);
    expect(before.some(x => x.place.id === place.id)).toBe(true);
    expect(before.every(x => !x.recognised)).toBe(true);

    // 2. Being at it beside somebody who knows it is how they are shown it.
    teach(tw.world, hobb, child, 'milling');

    // 3. Which is what makes the trade recognisable.
    stepLivelihoods(tw.world);
    expect(child.workId).toBe(place.id);

    // 4. And the post is real: they run the place's own process, on the world's own
    //    authorization path, and flour that did not exist before exists afterwards.
    const post = tradePostAt(tw.world, place)!;
    expect(post.staff.map(s => s.id)).toContain(child.id);
    const flourBefore = tw.world.items().filter(i => i.type === 'flour').reduce((n, i) => n + i.quantity, 0);
    step(tw, 5);
    const auth = workAuthorization(tw.world, child, place);
    expect(auth).toBeTruthy();
    expect(mill(tw.world, child).ok).toBe(true);
    expect(tw.world.items().filter(i => i.type === 'flour').reduce((n, i) => n + i.quantity, 0)).toBeGreaterThan(flourBefore);

    // 5. The causal chain is walkable from the event the world recorded.
    const taken = tw.world.events.find(e => e.type === 'livelihood_taken_up' && e.actor === child.id)!;
    expect(taken.causes.length).toBeGreaterThan(0);
    expect(taken.causes.every(id => !!tw.world.event(id))).toBe(true);
    const lesson = tw.world.event(taken.causes[0])!;
    expect(lesson.type).toBe('work_taught');
    expect(lesson.actor).toBe(hobb.id);
  });
});

describe('taking up a trade never invents one', () => {
  it('refuses to hand somebody a post that has no process behind it', () => {
    const tw = createTestWorld();
    const p = addPerson(tw, 'Idle', 'villager', v(10, 1, 10));
    p.age = 25;
    p.lifeStage = 'adult';
    // The test world has a square, a tavern, a chapel and a guardhouse — no trade process among
    // them — so there is nothing here for anybody's life to add up to.
    expect(livelihoodProspects(tw.world, p)).toEqual([]);
    stepLivelihoods(tw.world);
    expect(p.workId).toBeNull();
  });

  it('is a no-op for the player: a livelihood is played into, not stepped into', () => {
    const tw = createTestWorld();
    const place = withMill(tw);
    const hobb = miller(tw, 'Hobb', place, 70);
    const child = grownChild(tw, 'Heir', place, hobb);
    hobb.householdId = 'hh_test'; child.householdId = 'hh_test';
    child.controlled = true;
    teach(tw.world, hobb, child, 'milling');
    raiseDemand(tw);
    stepLivelihoods(tw.world);
    expect(child.workId).toBeNull();
    // ...and the derivation itself is silent about them, rather than merely being ignored.
    expect(livelihoodProspects(tw.world, child)).toEqual([]);
    void takeUpLivelihood;
  });
});
