import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { standInCandidacy } from '../src/sim/mind/succession';
import { tradePostAt } from '../src/sim/world/labor';
import { generateProductionNeeds } from '../src/sim/world/production';
import { noteWorkBlocked } from '../src/sim/world/shortfall';

function fixture() {
  const tw = createTestWorld(918273, 600), w = tw.world;
  const place = (x: number, type: 'house' | 'bakery' | 'mill') => makePlace(w, type, `${type} at ${x}`,
    { x0: x, z0: 10, x1: x + 4, z1: 14, y0: 1, y1: 4 }, { inside: v(x + 2, 1, 12) });
  const home = place(10, 'house'), bakery = place(20, 'bakery'), local = place(40, 'mill'), distant = place(500, 'mill');
  const worker = addPerson(tw, 'Capable neighbor', 'baker', { ...home.inside }, { homeId: home.id, workId: bakery.id });
  worker.skills.milling = .8; worker.wealth = 0;
  generateProductionNeeds(w);
  // Declared fixture: these unstaffed mills have had unsatisfied demand for four
  // days, beyond the canonical transient-stoppage window.
  for (const request of w.requests) if (request.type === 'production') request.createdAt = w.now - 96 * 3600;
  noteWorkBlocked(w, worker, bakery.id, 'flour', 'bread');
  return { tw, w, worker, home, local, distant };
}

describe('ordinary replacement work retains daily locality', () => {
  it('keeps a motivated local candidate but rejects the same shortage response across settlements', () => {
    const { w, worker, local, distant } = fixture();
    const nearby = tradePostAt(w, local)!, remote = tradePostAt(w, distant)!;
    expect(nearby.underServed).toBe(true); expect(remote.underServed).toBe(true);
    expect(standInCandidacy(w, worker, nearby)).not.toBeNull();
    expect(standInCandidacy(w, worker, remote)).toBeNull();
    // Standing near remote work does not silently relocate a settled person's home.
    w.primaryBody(worker.id)!.pos = { ...distant.inside };
    expect(standInCandidacy(w, worker, remote)).toBeNull();
  });

  it('does not commit a failed long-distance work loop when only the remote mill is idle', () => {
    const { tw, w, worker, local, distant } = fixture();
    const miller = addPerson(tw, 'Present miller', 'miller', { ...local.inside }, { homeId: local.id, workId: local.id });
    local.workers.push(miller.id);
    const chosen: string[] = [];
    w.onEvent(e => { if (e.actor === worker.id && e.type === 'goal_changed') chosen.push(e.placeId ?? ''); });
    step(tw, 12);
    expect(tradePostAt(w, distant)!.underServed).toBe(true);
    expect(worker.mind.goal?.targetPlace).not.toBe(distant.id);
    expect(worker.mind.plan.some(a => a.placeId === distant.id)).toBe(false);
    expect(chosen).not.toContain(distant.id);
  });

  it('allows a person without a settled home or work to consider work where they actually are', () => {
    const { w, worker, local, distant } = fixture();
    worker.homeId = null; worker.workId = null;
    w.primaryBody(worker.id)!.pos = { ...distant.inside };
    expect(standInCandidacy(w, worker, tradePostAt(w, distant)!)).not.toBeNull();
    expect(standInCandidacy(w, worker, tradePostAt(w, local)!)).toBeNull();
  });
});
