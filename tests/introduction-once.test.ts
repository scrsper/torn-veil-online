import { expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { introduce } from '../src/sim/mind/people';

/** Regression (candidate-08 review world): memories are bounded and forget low-significance
 * entries, and the "have I introduced myself?" check read only memories, so the same pair was
 * re-introduced every ~150 world seconds for days (27,055 introduction events among 131 people). */
it('a person introduces themself to someone once, even after forgetting the moment', () => {
  const tw = createTestWorld(812), w = tw.world;
  const a = addPerson(tw, 'Talker', 'villager', v(12, 1, 12)), b = addPerson(tw, 'Listener', 'villager', v(13, 1, 12));
  a.traits.sociability = b.traits.sociability = 0.95;
  expect(introduce(w, a, b)).toBe(true);
  for (let minute = 0; minute < 60; minute++) {
    // Forced forgetting: the bounded memory lost the introduction.
    a.memories = a.memories.filter(m => m.type !== 'introduction');
    step(tw, 60, 0.25);
  }
  const repeats = w.events.filter(e => e.type === 'introduction' && e.actor === a.id && e.target === b.id);
  expect(repeats).toHaveLength(1);
  expect(a.relationships[b.id].tags).toContain('introduced');
}, 120_000);
