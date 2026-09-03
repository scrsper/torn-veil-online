import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, v } from './helpers/world';

/**
 * v0.2.1 Priority 7 (World Engine integrity audit). Discovered via a real 7-day headless
 * benchmark (seed 918271, run after the bystander-misattribution fix in mind/agent.ts's
 * think()): with that bug no longer masking it, three agents stuck on unreachable pathfinding
 * destinations dominated the run — sim.act climbed to 45.7% of total wall time (255s of
 * 557.8s), and their path_failure counts reached 400-565 occurrences in a single 3-hour
 * anomaly window.
 *
 * Root cause: `act()` forced an immediate rethink (`m.thinkBudget = m.thinkInterval`, which
 * satisfies step()'s think-trigger condition on the very next physics substep regardless of
 * thinkInterval's actual value) on EVERY action failure, including a 'goto' whose pathfinding
 * genuinely found no route. Since nothing about the world changes between one failed attempt
 * and the next, this produced a livelock: think() -> same goal -> new 'goto' -> pathTo() fails
 * -> forced rethink next substep -> repeat, forever, at full simulation-step frequency rather
 * than the intended ~thinkInterval cadence.
 */
describe('pathfinding failure does not livelock the think/act loop (v0.2.1 Priority 7)', () => {
  it('a failed goto does not force an immediate rethink; only a genuinely different failure does', () => {
    const tw = createTestWorld(207, 20);
    const p = addPerson(tw, 'Stuck', 'farmer', v(5, 1, 5));
    // A very large interval makes the effect unambiguous: if a goto failure force-triggers
    // think() (the bug), the very next physics substep re-runs full goal selection and
    // replaces this object; if it doesn't (the fix), nothing should touch it for a long time.
    p.mind.thinkInterval = 100;
    p.mind.thinkBudget = 0;
    const pinnedGoal = { type: 'idle' as const, utility: 0.1, reasons: ['pinned for test'], createdAt: tw.world.now, key: 'idle:pinned' };
    p.mind.goal = pinnedGoal;
    // Far outside any generated/walkable area — findPath is guaranteed to fail ("no path found").
    p.mind.plan = [{ type: 'goto', pos: v(9999, 1, 9999), status: 'pending' }];

    step(tw, 1); // 20 substeps at the default 0.05s — far less than the pinned 100s interval

    const failures = tw.world.events.filter(e => e.type === 'path_failure' && e.actor === p.id);
    expect(failures.length).toBe(1); // one genuine attempt, not one per substep
    expect(p.mind.goal).toBe(pinnedGoal); // think() never fired again to replace it
  });

  it('a non-goto action failure still triggers a prompt rethink (responsiveness is preserved)', () => {
    const tw = createTestWorld(208, 20);
    const p = addPerson(tw, 'Talker', 'farmer', v(5, 1, 5));
    p.mind.thinkInterval = 100;
    p.mind.thinkBudget = 0;
    const pinnedGoal = { type: 'idle' as const, utility: 0.1, reasons: ['pinned for test'], createdAt: tw.world.now, key: 'idle:pinned' };
    p.mind.goal = pinnedGoal;
    // A 'talk' action whose target has no body fails immediately (act()'s 'talk' case).
    p.mind.plan = [{ type: 'talk', targetEntity: 'nonexistent-entity', status: 'pending' }];

    step(tw, 1);

    // Unlike the goto case above, this failure is a real state-driven reason to reconsider
    // right away: the forced rethink should have replaced the pinned goal object with a
    // freshly chosen one well before the pinned 100s interval would otherwise have elapsed.
    expect(p.mind.goal).not.toBe(pinnedGoal);
  });
});
