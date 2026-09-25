import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { getRel } from '../src/sim/mind/relationships';

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
  it('a refused suitor remembers it and does not ask again on every decision cycle', () => {
    // Autonomous people: the suitor is keen (0.6 each way of their own feeling), the other is not.
    // Seed 918272's continuation showed one elder proposing to the same person dozens of times an hour.
    const tw = createTestWorld(195);
    const a = addPerson(tw, 'Suitor', 'villager', v(10, 1, 10)), b = addPerson(tw, 'Unmoved', 'villager', v(11, 1, 10));
    a.reproductiveRole = 'fertilizing'; b.reproductiveRole = 'gestational'; a.age = b.age = 30;
    Object.assign(getRel(a, b.id), { affection: 0.8, trust: 0.6, familiarity: 0.8 });
    Object.assign(getRel(b, a.id), { affection: 0, trust: 0.1, familiarity: 0.3 });
    step(tw, 3 * 3600 / tw.world.clock.timeScale);
    const asks = tw.world.events.filter(e => e.type === 'courtship' && e.actor === a.id && e.target === b.id);
    expect(asks).toHaveLength(1);
    expect(asks[0].data.accepted).toBe(false);
    expect(tw.world.events.some(e => e.type === 'marriage')).toBe(false);
    expect(a.mind.courtshipDeclined?.[b.id]).toBe(asks[0].tick);
  }, 120_000);

  it('fails if the listener leaves before the conversation finishes', () => {
    const tw = setup();
    // Explicit unit fixture: the recipient departs while the request is in progress.
    tw.world.primaryBody(tw.b.id)!.pos = v(25, 1, 25);
    step(tw, 100 / tw.world.clock.timeScale);
    expect(tw.world.events.filter(e => e.type === 'courtship')).toHaveLength(0);
    expect(tw.a.mind.plan.some(a => a.type === 'propose' && a.status === 'failed')).toBe(true);
  });
});
