import { expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import type { Body, Person } from '../src/sim/core/types';
import { getRel } from '../src/sim/mind/relationships';
import { syncNeeds } from '../src/sim/core/physiology';
import { makePlace } from '../src/sim/world/factory';

/** Regression (WorldLab smoke, seed 918271): a villager afraid of someone standing about the house
 * held a flee/report loop for six hours and reached zero hydration, because any perceived threat
 * suppressed the drink proposal. A critical need must be able to override ordinary avoidance. */
function fixture(hydration: number) {
  const tw = createTestWorld(733), p = addPerson(tw, 'Frightened', 'villager', v(12, 1, 12)), q = addPerson(tw, 'Feared', 'villager', v(20, 1, 12));
  const w = tw.world, pb = w.primaryBody(p.id)!, qb = w.primaryBody(q.id)!;
  makePlace(w, 'well', 'Well', { x0: 4, z0: 4, x1: 6, z1: 6, y0: 1, y1: 3 }, { inside: v(5, 1, 5), indoor: false });
  // Disclosed prior state: wary enough that they register as a threat (fear > 0.25), not terror.
  getRel(p, q.id).fear = 0.3;
  p.mind.percepts = [{ entityId: q.id, bodyId: qb.id, how: 'saw', pos: { ...qb.pos }, tick: w.now, distance: 8 }];
  p.physiology.hydration = hydration; syncNeeds(p);
  (tw.sim as unknown as { think(p: Person, b: Body): void }).think(p, pb);
  return p.mind.goal?.type;
}

it('critical thirst sends a frightened person for water past a feared person who is not close', () => {
  expect(fixture(0.02)).toBe('drink_water');
});
it('ordinary thirst still yields to the fear', () => {
  expect(fixture(0.5)).not.toBe('drink_water');
});
