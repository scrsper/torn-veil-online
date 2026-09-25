import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';

describe('canonical proposal duration', () => {
  function setup() {
    const tw = createTestWorld(194);
    const a = addPerson(tw, 'Speaker', 'villager', v(10, 1, 10), { controlled: true });
    const b = addPerson(tw, 'Listener', 'villager', v(11, 1, 10), { controlled: true });
    tw.sim.submitIntention(a, { type: 'propose', targetEntity: b.id, duration: 90, status: 'pending' });
    step(tw, .05);
    return { ...tw, a, b };
  }
  it('emits one proposal only after its conversation duration, including a refusal', () => {
    const tw = setup(), seconds = 1 / tw.world.clock.timeScale;
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(0);
    step(tw, 80 * seconds);
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(0);
    step(tw, 11 * seconds);
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(1);
    expect(tw.world.events.filter(e => e.type === 'marriage')).toHaveLength(0);
    step(tw, 180 * seconds);
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(1);
  });
  it('fails if the listener leaves before the conversation finishes', () => {
    const tw = setup();
    // Explicit unit fixture: the recipient departs while the request is in progress.
    tw.world.primaryBody(tw.b.id)!.pos = v(25, 1, 25);
    step(tw, 100 / tw.world.clock.timeScale);
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(0);
    expect(tw.a.mind.plan.some(a => a.type === 'propose' && a.status === 'failed')).toBe(true);
  });
});
