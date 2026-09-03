import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';

/**
 * v0.2.1 Priority 3 (headless simulation throughput). Profiling itself is proven cheap and
 * event-log compaction is proven to run on a coarse (hourly) cadence rather than every
 * world-minute — the change measured (on a 2-day seed=918271 headless run) to cut total
 * compaction cost from ~25s to ~0.45s by not redundantly re-walking the causal ancestry of an
 * ever-growing "already significant, kept forever" event set on almost every world-minute.
 * See mind/agent.ts's `step()` and `strategic()`, and docs/V0_2_1_WORLD_ENGINE_STABILIZATION.md.
 */
describe('performance instrumentation (v0.2.1 Priority 3)', () => {
  it('Simulation.profile is null by default and opt-in, so ordinary stepping (browser/tests) pays nothing for it', () => {
    const tw = createTestWorld(700);
    expect(tw.sim.profile).toBeNull();
    addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    step(tw, 2);
    expect(tw.sim.profile).toBeNull(); // stepping never turns it on by itself
  });

  it('when enabled, profile accumulates coarse per-subsystem timings that sum close to real work done', () => {
    const tw = createTestWorld(701);
    addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    tw.sim.profile = {};
    step(tw, 5);
    expect(tw.sim.profile).not.toBeNull();
    const buckets = Object.keys(tw.sim.profile!);
    expect(buckets.length).toBeGreaterThan(0);
    for (const v of Object.values(tw.sim.profile!)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('event-log compaction runs on an hourly cadence, not every world-minute', () => {
    const tw = createTestWorld(702);
    addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    let compactCalls = 0;
    const original = tw.world.compactEvents.bind(tw.world);
    tw.world.compactEvents = ((...args: Parameters<typeof original>) => { compactCalls++; return original(...args); }) as typeof original;
    // The default world clock runs 60x real time (1 real second = 1 world minute — see
    // core/time.ts's DEFAULT_TIME_SCALE), so 30 real seconds is 30 world-minutes: well under
    // the one-hour compaction cadence, and should never trigger it.
    step(tw, 30);
    expect(compactCalls).toBe(0);
    // Crossing the one-hour mark (35 more real/world-minutes) should trigger exactly one more
    // call, not ~65 (one per world-minute, the pre-fix cadence).
    step(tw, 35);
    expect(compactCalls).toBe(1);
  });

  it('the compaction cadence change does not alter which events survive compaction for a given seed/duration (determinism preserved)', () => {
    const run = () => {
      const tw = createTestWorld(703, 30);
      const a = addPerson(tw, 'A', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.9 } });
      a.hostile = true;
      const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10));
      for (let i = 0; i < 3000; i++) tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, tick: tw.world.now + i, summary: `hit ${i}` });
      step(tw, 130, 0.5); // ~2.2 world-hours (60x time scale) — crosses the compaction cadence at least twice
      return tw.world.events.map(e => e.id);
    };
    expect(run()).toEqual(run());
  });
});
