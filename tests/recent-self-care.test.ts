import { expect, it } from 'vitest';
import { recentSelfCare } from '../src/sim/mind/recentSelfCare';
import type { EventType, WorldEvent } from '../src/sim/core/types';
import { createTestWorld } from './helpers/world';

it('matches the original history queries across appends, cutoff barriers, clock changes and history replacement', () => {
  const { world } = createTestWorld(71);
  const actors = ['one', 'two', 'never'];
  function verify() {
    function original(type: EventType, actor: string, window: number) {
      for (let i = world.events.length - 1; i >= 0; i--) {
        const e = world.events[i];
        if (world.now - e.tick >= window) break;
        if (e.type === type && e.actor === actor) return true;
      }
      return false;
    }
    for (const actor of actors) expect(recentSelfCare(world, actor)).toEqual({
      ate: original('meal', actor, 2700), drank: original('water_consumed', actor, 1800),
    });
  }
  const before = JSON.stringify(world.events);
  verify();
  expect(JSON.stringify(world.events)).toBe(before);
  // Include events on both exact cutoffs, unrelated actors/types, and out-of-order
  // backdated events. This is also the incremental path between two minds' turns.
  for (const age of [2701, 2700, 2699, 1800, 1799, 0, 2800, 0]) {
    for (const type of ['meal', 'water_consumed', 'goal_completed'] as const) {
      for (const actor of actors.slice(0, 2)) {
        world.emit(type, { actor, tick: world.now - age });
        verify();
      }
    }
  }
  world.clock.advance(301);
  verify();
  // Compaction/load replace the authoritative array; an old derived result must
  // not survive replacement, even when the new history has the same length.
  world.events = world.events.map(e => ({ ...e, type: 'goal_completed' } as WorldEvent));
  verify();
  expect(recentSelfCare(world, 'one')).toEqual({ ate: false, drank: false });
  world.emit('meal', { actor: 'one' });
  verify();
  world.events.length = 0;
  verify();
});

it('reads the existing history once for all minds at one clock instant', () => {
  const { world } = createTestWorld(72);
  for (let i = 0; i < 2000; i++) world.emit('goal_completed', { actor: 'one' });
  world.emit('meal', { actor: 'one' });
  let reads = 0;
  world.events = new Proxy(world.events, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(target, key, receiver);
  } });
  expect(recentSelfCare(world, 'one').ate).toBe(true);
  const firstReads = reads;
  for (let i = 0; i < 127; i++) recentSelfCare(world, `person:${i}`);
  expect(firstReads).toBeGreaterThanOrEqual(2001);
  expect(reads).toBe(firstReads);
  world.emit('water_consumed', { actor: 'two' });
  expect(recentSelfCare(world, 'two').drank).toBe(true);
  expect(reads).toBe(firstReads + 1);
});
