import { expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import type { Action, Body, Goal, Person } from '../src/sim/core/types';
import { learn } from '../src/sim/mind/knowledge';

function fixture() {
  const tw = createTestWorld(711), p = addPerson(tw, 'Unsettled traveler', 'traveler', v(12, 1, 12));
  // Explicit edge fixture: no home, no known civic place, no nearby food offer.
  p.homeId = null; p.knowledge = {};
  const body = tw.world.primaryBody(p.id)!;
  const plan = (goal: Goal) => (tw.sim as unknown as {
    plan(p: Person, b: Body, g: Goal): Action[];
  }).plan(p, body, goal);
  const goal = (type: Goal['type']): Goal => ({ type, utility: .6, reasons: [], createdAt: tw.world.now, key: type });
  return { tw, p, body, plan, goal };
}

it('a food search without a home or known square remains a local physical plan', () => {
  const { tw, p, body, plan, goal } = fixture();
  // Planner-only wilderness position, outside the fixture settlement's local offers.
  body.pos = v(1000, 1, 1000);
  const knowledgeBefore = structuredClone(p.knowledge), placesBefore = tw.world.places().length;
  const actions = plan({ ...goal('wander'), data: { foodSearch: true } });
  expect(actions.map(a => a.type)).toEqual(['goto', 'wait']);
  expect(Math.abs(actions[0].pos!.x - body.pos.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(actions[0].pos!.z - body.pos.z)).toBeLessThanOrEqual(8);
  expect(actions[0].pos!.y).toBe(body.pos.y);
  expect(p.homeId).toBeNull(); expect(p.knowledge).toEqual(knowledgeBefore);
  expect(tw.world.places()).toHaveLength(placesBefore);
});

it('worship without a known chapel can be planned at the current body position', () => {
  const { body, plan, goal } = fixture();
  const actions = plan(goal('worship'));
  expect(actions.map(a => a.type)).toEqual(['goto', 'pray']);
  expect(actions.every(a => a.placeId === undefined && a.pos === body.pos)).toBe(true);
});

it('a known local square still anchors ordinary wandering', () => {
  const { tw, p, plan, goal } = fixture(), square = tw.world.place(tw.places.square)!;
  learn(tw.world, p, { key: 'place:' + square.id, kind: 'fact', claim: { placeId: square.id }, confidence: 1, source: { type: 'prior' } }, true);
  const state = tw.world.rng.state();
  const expected = { x: square.inside.x + (tw.world.rng.next() - .5) * 16,
    y: square.inside.y, z: square.inside.z + (tw.world.rng.next() - .5) * 16 };
  const after = tw.world.rng.state(); tw.world.rng.setState(state);
  expect(plan(goal('wander'))[0].pos).toEqual(expected);
  expect(tw.world.rng.state()).toBe(after);
});

