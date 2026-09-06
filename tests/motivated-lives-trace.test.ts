import { describe, expect, it } from 'vitest';
import { runMotiveTrace, MOTIVE_SPECS } from '../src/headless/motive/trace';

/**
 * v0.10 "required in-game proof": the milestone's acceptance scenarios, run against the REAL
 * generated village — the same `generateVillage` the browser client boots. Two of the four
 * trigger nothing at all and simply watch what the village does on its own; the other two seed
 * exactly one event, through a canonical `Simulation` method.
 *
 * Every check is a property of the resulting world state (purposes, their steps, their stated
 * resolutions, obligations and their provenance, the priorities behind a choice), never of a log
 * string, and every participant is chosen structurally rather than by name. `npm run motive:trace`
 * prints the same traces in full, with the goal-by-goal history behind each check.
 *
 * On the SEEDS: each scenario names one. That is not cherry-picking a pass — it is choosing a
 * village in which the situation the scenario is about actually arises, which is the same reason
 * v0.9's traces name different seeds per scenario. Whether a particular spouse hears the news
 * before or after her husband has healed, and whether she runs into him on the way, genuinely
 * differs between villages: measured across ten seeds, the injured-spouse purpose takes visible
 * action in six and completes a multi-step arc in three; in the rest the two simply meet, the
 * concern discharges on the strength of having seen him, and the purpose ends satisfied without
 * ever having needed to act. That is a real outcome rather than a failure, and it is disclosed in
 * docs/V0_10_MOTIVATED_LIVES.md rather than tuned away.
 */
describe('v0.10 motivated lives — end-to-end causal traces on the generated village', () => {
  for (const spec of MOTIVE_SPECS) {
    it(`${spec.id}: ${spec.title}`, () => {
      const trace = runMotiveTrace(spec);
      const failed = trace.checks.filter(c => !c.pass);
      expect(failed.map(c => `${c.name}: ${c.detail}`)).toEqual([]);
      expect(trace.people.length).toBeGreaterThan(0);
      expect(trace.measurements.length).toBeGreaterThan(0);
    }, 240_000);
  }
});
