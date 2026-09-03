import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { TelemetryRecorder, MemorySink } from '../src/sim/telemetry/recorder';
import { detectAnomalies } from '../src/sim/telemetry/anomaly';

describe('telemetry (v0.2 Part 3: automatic, purely observational)', () => {
  it('categorizes canonical events and skips high-frequency, low-value routine types', () => {
    const tw = createTestWorld(600);
    const sink = new MemorySink();
    new TelemetryRecorder(tw.world, [sink]);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    tw.world.emit('attack', { actor: a.id, target: b.id, significance: 0.7, summary: 'A attacked B' });
    tw.world.emit('arrived', { actor: a.id, significance: 0.05, summary: 'A arrived' }); // routine — must be skipped
    tw.world.emit('block_changed', { actor: a.id, significance: 0.08, summary: 'door' }); // routine — must be skipped

    expect(sink.records.some(r => r.type === 'attack' && r.category === 'conflict')).toBe(true);
    expect(sink.records.some(r => r.type === 'arrived')).toBe(false);
    expect(sink.records.some(r => r.type === 'block_changed')).toBe(false);
    expect(sink.countByCategory().conflict).toBeGreaterThanOrEqual(1);
  });

  it('is purely observational — a broken sink must never disrupt the simulation, and never affects world state', () => {
    const tw = createTestWorld(601);
    const brokenSink = { write: () => { throw new Error('sink is broken'); } };
    const goodSink = new MemorySink();
    new TelemetryRecorder(tw.world, [brokenSink, goodSink]);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    expect(() => tw.world.emit('rumor', { actor: a.id, significance: 0.2, summary: 'test' })).not.toThrow();
    expect(goodSink.records.length).toBeGreaterThan(0); // the good sink still received it
  });

  it('runStart/runEnd write run-category records', () => {
    const tw = createTestWorld(602);
    const sink = new MemorySink();
    const recorder = new TelemetryRecorder(tw.world, [sink]);
    recorder.runStart({ seed: 602 });
    recorder.runEnd({ seed: 602 });
    expect(sink.records.filter(r => r.category === 'run').map(r => r.type)).toEqual(['run_start', 'run_end']);
  });
});

describe('anomaly detection (v0.2 Part 4: reports only, never repairs)', () => {
  it('flags an actor with 3+ kills clustered close together in world time', () => {
    const tw = createTestWorld(603);
    const killer = addPerson(tw, 'Killer', 'bandit', v(5, 1, 5));
    for (let i = 0; i < 3; i++) tw.world.emit('kill', { actor: killer.id, significance: 1, summary: `kill ${i}` });
    const anomalies = detectAnomalies(tw.world);
    const found = anomalies.find(a => a.type === 'repeated_lethal_conflict' && a.entity === killer.id);
    expect(found).toBeDefined();
    expect(found!.occurrences).toBeGreaterThanOrEqual(3);
    expect(found!.relatedEvents.length).toBeGreaterThanOrEqual(3);
    expect(found!.firstSeen).toBeLessThanOrEqual(found!.lastSeen);
  });

  it('does not flag a single isolated kill', () => {
    const tw = createTestWorld(604);
    const killer = addPerson(tw, 'Killer', 'bandit', v(5, 1, 5));
    tw.world.emit('kill', { actor: killer.id, significance: 1, summary: 'a single kill' });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'repeated_lethal_conflict')).toBe(false);
  });

  it('flags a village-wide death spike', () => {
    const tw = createTestWorld(605);
    for (let i = 0; i < 4; i++) tw.world.emit('death', { significance: 1, summary: `death ${i}` });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'death_spike')).toBe(true);
  });

  it('flags dangling causal references and invalid entity references — a real integrity regression', () => {
    const tw = createTestWorld(606);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    tw.world.emit('rumor', { actor: a.id, causes: ['ev_missing_123'], significance: 0.1, summary: 'dangling' });
    tw.world.emit('rumor', { actor: 'p_missing_999', significance: 0.1, summary: 'invalid actor' });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'dangling_cause' && a.data.missingCause === 'ev_missing_123')).toBe(true);
    expect(anomalies.some(a => a.type === 'invalid_entity_reference' && a.data.missingId === 'p_missing_999')).toBe(true);
  });

  it('does not flag a causally and referentially clean event log', () => {
    const tw = createTestWorld(607);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    const cause = tw.world.emit('rumor', { actor: a.id, significance: 0.1, summary: 'root' });
    tw.world.emit('told', { actor: a.id, target: b.id, causes: [cause.id], significance: 0.1, summary: 'follow-up' });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'dangling_cause' || a.type === 'invalid_entity_reference')).toBe(false);
  });

  it('flags an agent stuck in repeated path failures', () => {
    const tw = createTestWorld(608);
    const stuck = addPerson(tw, 'Stuck', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 5; i++) tw.world.emit('path_failure', { actor: stuck.id, significance: 0, summary: 'no path' });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'stuck_agent' && a.entity === stuck.id)).toBe(true);
  });

  it('flags an actor churning through goals far beyond ordinary deliberation', () => {
    const tw = createTestWorld(609);
    const churner = addPerson(tw, 'Churner', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 40; i++) tw.world.emit('goal_changed', { actor: churner.id, significance: 0.1, summary: `switch ${i}` });
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'goal_churn' && a.entity === churner.id)).toBe(true);
  });

  it('flags an epistemic leak — knowledge treating an unidentified actor as identified', () => {
    const tw = createTestWorld(610);
    const p = addPerson(tw, 'P', 'farmer', v(5, 1, 5));
    p.knowledge['ev:leak'] = { key: 'ev:leak', kind: 'event', claim: { type: 'attack', actorUnknown: true, actor: 'someone_id' }, confidence: 0.5, learnedAt: tw.world.now, source: { type: 'heard' }, hops: 1, sharedWith: [] };
    const anomalies = detectAnomalies(tw.world);
    expect(anomalies.some(a => a.type === 'epistemic_leak' && a.entity === p.id)).toBe(true);
  });

  it('groups repeated stuck-path failures into one structured finding, not one per occurrence', () => {
    const tw = createTestWorld(611);
    const stuck = addPerson(tw, 'Stuck', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 37; i++) tw.world.emit('path_failure', { actor: stuck.id, significance: 0, tick: tw.world.now + i, summary: 'no path' });
    const anomalies = detectAnomalies(tw.world);
    const stuckFindings = anomalies.filter(a => a.type === 'stuck_agent' && a.entity === stuck.id);
    expect(stuckFindings.length).toBe(1); // one finding, not 37
    expect(stuckFindings[0].occurrences).toBe(37);
    expect(stuckFindings[0].firstSeen).toBeLessThan(stuckFindings[0].lastSeen);
    expect(stuckFindings[0].relatedEvents.length).toBeGreaterThan(0);
  });

  it('groups dangling causal references to the same missing event into one finding', () => {
    const tw = createTestWorld(612);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    for (let i = 0; i < 5; i++) tw.world.emit('rumor', { actor: a.id, causes: ['ev_missing_shared'], significance: 0.1, tick: tw.world.now + i, summary: `rumor ${i}` });
    const anomalies = detectAnomalies(tw.world);
    const findings = anomalies.filter(a => a.type === 'dangling_cause' && a.data.missingCause === 'ev_missing_shared');
    expect(findings.length).toBe(1);
    expect(findings[0].occurrences).toBe(5);
  });
});
