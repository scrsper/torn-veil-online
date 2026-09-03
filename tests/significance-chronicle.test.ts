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

  it('consolidates a burst of repeated fighting between the same two people into one entry, not one per blow', () => {
    const tw = createTestWorld(508);
    const a = addPerson(tw, 'Dunstan', 'guard', v(5, 1, 5));
    const b = addPerson(tw, 'Vex', 'bandit', v(6, 1, 5));
    const base = tw.world.now;
    // Alternating direction, like a real back-and-forth fight, all close together in time.
    for (let i = 0; i < 6; i++) {
      const actor = i % 2 === 0 ? a : b; const target = i % 2 === 0 ? b : a;
      tw.world.emit('attack', { actor: actor.id, target: target.id, significance: 0.7, tick: base + i * 30, summary: `${actor.name} attacked ${target.name} (5 dmg)` });
    }
    const entries = buildChronicle(tw.world);
    const fightEntries = entries.filter(e => e.sourceEventIds.length > 1 || e.text.includes('attacked'));
    expect(fightEntries.length).toBe(1);
    expect(fightEntries[0].sourceEventIds.length).toBe(6);
    expect(fightEntries[0].text).toContain('6 times');
  });

  it('does not consolidate distinct kills into one entry, even by the same actor close in time', () => {
    const tw = createTestWorld(509);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5));
    tw.world.emit('kill', { actor: a.id, significance: 1, tick: tw.world.now, summary: 'A killed the first victim' });
    tw.world.emit('kill', { actor: a.id, significance: 1, tick: tw.world.now + 60, summary: 'A killed the second victim' });
    const entries = buildChronicle(tw.world);
    expect(entries.some(e => e.text.includes('first victim'))).toBe(true);
    expect(entries.some(e => e.text.includes('second victim'))).toBe(true);
    expect(entries.length).toBe(2);
  });

  it('does not consolidate two fights separated by longer than the consolidation window', () => {
    const tw = createTestWorld(510);
    const a = addPerson(tw, 'A', 'guard', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'bandit', v(6, 1, 5));
    tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, tick: tw.world.now, summary: 'first bout' });
    tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, tick: tw.world.now + 4000, summary: 'second bout' });
    const entries = buildChronicle(tw.world, { consolidationWindowSeconds: 1800 });
    expect(entries.length).toBe(2);
  });

  it('every chronicle entry — consolidated or not — keeps valid source event references', () => {
    const tw = createTestWorld(511);
    const a = addPerson(tw, 'A', 'guard', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'bandit', v(6, 1, 5));
    for (let i = 0; i < 4; i++) tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, tick: tw.world.now + i * 10, summary: `bout ${i}` });
    tw.world.emit('kill', { actor: a.id, target: b.id, significance: 1, tick: tw.world.now + 1000, summary: 'A killed B' });
    const entries = buildChronicle(tw.world);
    for (const entry of entries) {
      expect(entry.sourceEventIds.length).toBeGreaterThan(0);
      for (const id of entry.sourceEventIds) expect(tw.world.event(id)).toBeDefined();
      expect(entry.sourceEventIds).toContain(entry.eventId);
    }
  });

  it('routine low-value events (a meal) never appear in the Chronicle even amid a lot of activity', () => {
    const tw = createTestWorld(512);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 20; i++) tw.world.emit('meal', { actor: a.id, significance: 0.05, tick: tw.world.now + i * 60, summary: `A ate meal ${i}` });
    tw.world.emit('kill', { actor: a.id, significance: 1, tick: tw.world.now + 2000, summary: 'A killed someone' });
    const entries = buildChronicle(tw.world);
    expect(entries.every(e => !e.text.includes('ate meal'))).toBe(true);
    expect(entries.some(e => e.text.includes('killed someone'))).toBe(true);
  });

  it('chronicle ordering stays deterministic across repeated builds from the same event log', () => {
    const tw = createTestWorld(513);
    const a = addPerson(tw, 'A', 'guard', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'bandit', v(6, 1, 5));
    for (let i = 0; i < 5; i++) tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, tick: tw.world.now + i * 20, summary: `bout ${i}` });
    tw.world.emit('theft', { actor: b.id, target: a.id, significance: 0.6, tick: tw.world.now + 500, summary: 'B stole from A' });
    const first = buildChronicle(tw.world).map(e => e.eventId);
    const second = buildChronicle(tw.world).map(e => e.eventId);
    expect(first).toEqual(second);
  });
});
