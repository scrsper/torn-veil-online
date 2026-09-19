import { describe, expect, it } from 'vitest';
import { introduce } from '../src/sim/mind/people';
import { recognizeEncounter } from '../src/sim/mind/encounter';
import { addPerson, createTestWorld, face, v, wall } from './helpers/world';

describe('bounded encounter recognition', () => {
  it('moves from familiar to recognized from repeated visible cues', () => {
    const tw = createTestWorld(801, 24);
    const observer = addPerson(tw, 'Observer', 'traveler', v(8, 1, 8));
    const target = addPerson(tw, 'Target', 'farmer', v(8, 1, 10));
    face(observer, tw, tw.world.primaryBody(target.id)!.pos);
    const observed = { subjectId: target.id, bodyId: tw.world.primaryBody(target.id)!.id, how: 'saw' as const };
    expect(recognizeEncounter(tw.world, observer, observed)?.level).toBe('unknown');
    expect(recognizeEncounter(tw.world, observer, observed)?.level).toBe('unknown');
    tw.world.clock.worldSeconds += 61;
    expect(recognizeEncounter(tw.world, observer, observed)?.level).toBe('familiar');
    tw.world.clock.worldSeconds += 61;
    expect(recognizeEncounter(tw.world, observer, observed)?.level).toBe('recognized');
    const claim = observer.knowledge[`encounter:${target.id}:${observed.bodyId}`].claim;
    expect(claim).not.toHaveProperty('name');
    expect(claim).not.toHaveProperty('occupation');
    expect(claim).not.toHaveProperty('inventory');
    expect(claim.cues.appearance).toHaveProperty('shirt');
    expect(claim.cues.activity).toBeDefined();
  });

  it('identifies only when an introduced identity agrees with visible cues', () => {
    const tw = createTestWorld(802, 24);
    const observer = addPerson(tw, 'Observer', 'traveler', v(8, 1, 8));
    const target = addPerson(tw, 'Target', 'farmer', v(8, 1, 10));
    face(observer, tw, tw.world.primaryBody(target.id)!.pos);
    expect(introduce(tw.world, target, observer)).toBe(true);
    const body = tw.world.primaryBody(target.id)!;
    expect(recognizeEncounter(tw.world, observer, { subjectId: target.id, bodyId: body.id, how: 'saw' })).toMatchObject({ level: 'identified', identityMatched: true });
    body.pos = v(8, 1, 40);
    expect(recognizeEncounter(tw.world, observer, { subjectId: target.id, bodyId: body.id, how: 'saw' })).toBeNull();
  });

  it('does not recognize through hearing or a blocked line of sight', () => {
    const tw = createTestWorld(803, 24);
    const observer = addPerson(tw, 'Observer', 'traveler', v(8, 1, 8));
    const target = addPerson(tw, 'Target', 'farmer', v(8, 1, 10));
    const body = tw.world.primaryBody(target.id)!;
    expect(recognizeEncounter(tw.world, observer, { subjectId: target.id, bodyId: body.id, how: 'heard' })).toBeNull();
    wall(tw, 8, 9, 9);
    expect(recognizeEncounter(tw.world, observer, { subjectId: target.id, bodyId: body.id, how: 'saw' })).toBeNull();
  });

  it('keeps repeated sightings bounded and anchors encounter memory to a real causal observation', () => {
    const tw = createTestWorld(804, 24), observer = addPerson(tw, 'Observer', 'traveler', v(8, 1, 8));
    const target = addPerson(tw, 'Target', 'farmer', v(8, 1, 10));
    const observed = { subjectId: target.id, bodyId: tw.world.primaryBody(target.id)!.id, how: 'saw' as const };
    for (let i = 0; i < 100; i++) recognizeEncounter(tw.world, observer, observed);
    const key = `encounter:${target.id}:${observed.bodyId}`, k = observer.knowledge[key];
    expect(k.claim.observations).toHaveLength(1); expect(observer.memories.filter(m => m.type === 'encounter')).toHaveLength(1);
    expect(tw.world.event(k.source.viaEvent!)?.data.observation).toBeDefined();
    for (let i = 0; i < 30; i++) { tw.world.clock.worldSeconds += 61; recognizeEncounter(tw.world, observer, observed); }
    expect(observer.knowledge[key].claim.observations.length).toBeLessThanOrEqual(8);
    const body = tw.world.primaryBody(observer.id)!;
    body.pose = 'downed'; expect(recognizeEncounter(tw.world, observer, observed)).toBeNull();
    body.pose = 'sleep'; expect(recognizeEncounter(tw.world, observer, observed)).toBeNull();
  });
});

