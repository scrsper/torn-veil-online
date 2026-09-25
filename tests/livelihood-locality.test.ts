import { describe, expect, it } from 'vitest';
import { BridgeSession } from '../src/bridge/session';
import { teach } from '../src/sim/mind/apprenticeship';
import { livelihoodProspects } from '../src/sim/mind/livelihood';
import { DAILY_LOCAL_RANGE } from '../src/sim/world/locality';

/**
 * Seed 918272's continuation: a retired elder, shown milling, took up a "work" goal at a mill in
 * another settlement 6.5-11 km from home (WorldLab WL-LOCALITY-DISTANT). Trade prospects are daily
 * work, so they come from places within daily reach of home, like every other local errand.
 * Disclosed fixture: the teacher is stood beside the learner for the lesson; nothing else is moved.
 */
describe('livelihood prospects stay local', () => {
  it('someone shown a trade looks for that work near home, not in every settlement of the region', () => {
    const s = new BridgeSession(918272, { playable: true }), w = s.world;
    const learner = w.livingPersons().find(p => !p.workId && p.age >= 20 && w.place(p.homeId)?.inside && !p.hostile)!;
    const miller = w.livingPersons().find(p => p.occupation === 'miller')!;
    const lb = w.primaryBody(learner.id)!, mb = w.primaryBody(miller.id)!;
    mb.pos = { ...lb.pos, x: lb.pos.x + 1 };
    expect(teach(w, miller, learner, 'milling')).toBeTruthy();
    const home = w.place(learner.homeId)!.inside;
    const prospects = livelihoodProspects(w, learner);
    const mills = w.places().filter(pl => pl.type === 'mill');
    expect(mills.some(m => Math.hypot(m.inside.x - home.x, m.inside.z - home.z) > DAILY_LOCAL_RANGE)).toBe(true);
    for (const prospect of prospects) expect(Math.hypot(prospect.place.inside.x - home.x, prospect.place.inside.z - home.z)).toBeLessThanOrEqual(DAILY_LOCAL_RANGE);
  }, 120_000);
});
