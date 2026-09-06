import { describe, expect, it } from 'vitest';
import { runSocialTrace, TRACE_SPECS } from '../src/headless/social/trace';

/**
 * v0.9 "required in-game proof": the milestone explicitly says it may not be considered complete
 * on the strength of unit tests alone. These run the REAL generated village — the same
 * `generateVillage` the browser client boots — seed one triggering event through a canonical
 * `Simulation` method, and then assert on the causal chain the simulation produces on its own.
 *
 * Nothing about the outcome is scripted: participants are chosen structurally (relationship
 * shape and occupation, never by name), and every check is a property of the resulting world
 * state, not of a log string. `npm run social:trace` prints the same traces in full.
 */
describe('v0.9 social causality — end-to-end causal traces on the generated village', () => {
  for (const spec of TRACE_SPECS) {
    it(`${spec.id}: ${spec.title}`, () => {
      // The scenario's own configured window. Shortening it uniformly was tempting for suite
      // runtime, but it is not a free knob: a theft with a single witness genuinely spreads more
      // slowly than a beating in the open, and cutting the window short made the suite assert
      // that the village had failed to react when in fact it had simply not finished reacting.
      const trace = runSocialTrace(spec);
      const failed = trace.checks.filter(c => !c.pass);
      expect(failed.map(c => `${c.name}: ${c.detail}`)).toEqual([]);
      // Three materially different standpoints on the same matter, as the brief requires.
      expect(trace.perspectives.length).toBeGreaterThanOrEqual(3);
      expect(trace.steps.length).toBeGreaterThan(0);
    }, 180_000);
  }
});
