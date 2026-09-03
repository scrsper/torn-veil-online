import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { computeHistoricalSignificance, topSignificantEntities } from '../src/sim/history/significance';
import { buildChronicle, causalAncestry } from '../src/sim/history/chronicle';

describe('historical significance (Constitution §19-20, v0.2 Part 7)', () => {
  it('is not power or combat — a non-combatant healer can outscore an idle bystander', () => {
    const tw = createTestWorld(500);
    const healer = addPerson(tw, 'Healer', 'herbalist', v(5, 1, 5));
    const patient = addPerson(tw, 'Patient', 'farmer', v(6, 1, 5));
    const bystander = addPerson(tw, 'Bystander', 'farmer', v(7, 1, 5));
    tw.world.emit('heal', { actor: healer.id, target: patient.id, significance: 0.4, summary: 'test heal' });

    const scores = computeHistoricalSignificance(tw.world);
    expect(scores.get(healer.id) ?? 0).toBeGreaterThan(0);
    expect(scores.get(healer.id) ?? 0).toBeGreaterThan(scores.get(bystander.id) ?? 0);
  });

  it('excludes cognition-category events — perceiving something is not itself historically significant', () => {
    const tw = createTestWorld(501);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    tw.world.emit('perceived', { actor: p.id, significance: 1, category: 'cognition', summary: 'test' });
    const scores = computeHistoricalSignificance(tw.world);
    expect(scores.get(p.id) ?? 0).toBe(0);
  });

  it('gives causal centrality weight — an event with many downstream effects boosts its actor beyond its own raw significance', () => {
    const tw = createTestWorld(502);
    const trigger = addPerson(tw, 'Trigger', 'farmer', v(5, 1, 5));
    const quiet = addPerson(tw, 'Quiet', 'farmer', v(6, 1, 5));
    const causeEv = tw.world.emit('rumor', { actor: trigger.id, significance: 0.1, summary: 'a small rumor' });
    tw.world.emit('rumor', { actor: quiet.id, significance: 0.1, summary: 'unrelated' });
    for (let i = 0; i < 5; i++) tw.world.emit('told', { actor: quiet.id, causes: [causeEv.id], significance: 0.1, summary: 'told someone' });
    const scores = computeHistoricalSignificance(tw.world);
    expect(scores.get(trigger.id) ?? 0).toBeGreaterThan(scores.get(quiet.id) ?? 0);
  });

  it('topSignificantEntities returns a stable, ranked, deterministic list', () => {
    const tw = createTestWorld(503);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    tw.world.emit('kill', { actor: a.id, target: b.id, significance: 1, summary: 'k' });
    const top = topSignificantEntities(tw.world, 5);
    expect(top[0].id).toBe(a.id);
    expect(top[0].name).toBe('A');
    expect(top.length).toBeLessThanOrEqual(5);
  });
});

describe('World Chronicle (Constitution §52, v0.2 Part 14)', () => {
  it('selects only real canonical events — every entry traces back to an actual world.event id', () => {
    const tw = createTestWorld(504);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    tw.world.emit('kill', { actor: a.id, significance: 1, summary: 'A big kill' });
    tw.world.emit('meal', { actor: a.id, significance: 0.05, summary: 'A ate lunch' }); // routine, below threshold
    const entries = buildChronicle(tw.world, { minSignificance: 0.5 });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const real = tw.world.event(entry.eventId);
      expect(real).toBeDefined();
      expect(entry.text).toBe(`Day ${entry.day} — ${real!.summary}`);
      expect(entry.causes).toEqual(real!.causes);
    }
    expect(entries.some(e => e.text.includes('A ate lunch'))).toBe(false);
  });

  it('always includes history-category events regardless of the significance threshold', () => {
    const tw = createTestWorld(505);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    tw.world.emit('marriage', { actor: a.id, target: b.id, category: 'history', significance: 0.1, summary: 'A married B' });
    const entries = buildChronicle(tw.world, { minSignificance: 0.9 });
    expect(entries.some(e => e.text.includes('A married B'))).toBe(true);
  });

  it('is sorted chronologically by world tick', () => {
    const tw = createTestWorld(506);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    tw.world.emit('kill', { actor: a.id, significance: 1, summary: 'second', tick: tw.world.now + 100 });
    tw.world.emit('kill', { actor: a.id, significance: 1, summary: 'first', tick: tw.world.now });
    const entries = buildChronicle(tw.world);
    const idx = entries.map(e => e.text);
    expect(idx.indexOf(idx.find(t => t.includes('first'))!)).toBeLessThan(idx.indexOf(idx.find(t => t.includes('second'))!));
  });

  it('causalAncestry walks the full causal chain and terminates on cycles/missing events', () => {
    const tw = createTestWorld(507);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const root = tw.world.emit('rumor', { actor: a.id, significance: 0.1, summary: 'root cause' });
    const mid = tw.world.emit('told', { actor: a.id, causes: [root.id], significance: 0.1, summary: 'mid' });
    const leaf = tw.world.emit('told', { actor: a.id, causes: [mid.id, 'ev_does_not_exist'], significance: 0.1, summary: 'leaf' });
    const chain = causalAncestry(tw.world, leaf.id);
    expect(chain.map(e => e.id)).toContain(root.id);
    expect(chain.map(e => e.id)).toContain(mid.id);
    expect(chain.map(e => e.id)).toContain(leaf.id);
    expect(chain.length).toBe(3); // the dangling 'ev_does_not_exist' reference is simply absent, not an error
  });
});
