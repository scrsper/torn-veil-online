import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import { syncFactionInstitutionalKnowledge, checkLeadershipVacancies } from '../src/sim/history/factions';
import { computeHistoricalSignificance } from '../src/sim/history/significance';
import { makeFaction } from '../src/sim/world/factory';

describe('factions as institutions (Constitution §36-37, v0.2 Part 9)', () => {
  it('never promotes a rank-and-file member\'s private knowledge — only the leader\'s own knowledge becomes institutional', () => {
    const tw = createTestWorld(400);
    const leader = addPerson(tw, 'Leader', 'captain', v(5, 1, 5));
    const member = addPerson(tw, 'Member', 'guard', v(6, 1, 5));
    const watch = makeFaction(tw.world, 'Test Watch', 'a test faction', { factionType: 'watch', leaderId: leader.id });
    watch.members = [leader.id, member.id];

    // The MEMBER (not the leader) personally witnesses a crime. Institutional knowledge must
    // not leak from a member's mind just because they belong to the faction.
    member.knowledge['ev:crime1'] = { key: 'ev:crime1', kind: 'event', claim: { type: 'attack', actor: 'someone', target: 'victim' }, confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    let promoted = syncFactionInstitutionalKnowledge(tw.world);
    expect(promoted).toBe(0);
    expect(watch.knowledge['ev:crime1']).toBeUndefined();

    // Now the LEADER learns of a (different) crime directly — this is the real institutional
    // process (a report reaching leadership), and it should be promoted.
    leader.knowledge['ev:crime2'] = { key: 'ev:crime2', kind: 'event', claim: { type: 'theft', actor: 'someone', target: 'victim2' }, confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    promoted = syncFactionInstitutionalKnowledge(tw.world);
    expect(promoted).toBe(1);
    expect(watch.knowledge['ev:crime2']).toBeDefined();
    expect(watch.knowledge['ev:crime1']).toBeUndefined();
  });

  it('does not re-promote low-confidence knowledge over an already-better institutional record, and is idempotent', () => {
    const tw = createTestWorld(401);
    const leader = addPerson(tw, 'Leader', 'captain', v(5, 1, 5));
    const watch = makeFaction(tw.world, 'Test Watch', 'a test faction', { factionType: 'watch', leaderId: leader.id });
    watch.members = [leader.id];
    leader.knowledge['ev:crime'] = { key: 'ev:crime', kind: 'event', claim: { type: 'attack', actor: 'x', target: 'y' }, confidence: 0.9, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    expect(syncFactionInstitutionalKnowledge(tw.world)).toBe(1);
    expect(syncFactionInstitutionalKnowledge(tw.world)).toBe(0); // calling again promotes nothing new
    leader.knowledge['ev:crime'].confidence = 0.4; // a later, worse-confidence version must not regress the record
    expect(syncFactionInstitutionalKnowledge(tw.world)).toBe(0);
    expect(watch.knowledge['ev:crime'].confidence).toBe(0.9);
  });

  it('promotes the most historically significant alive member to leadership after the leader dies', () => {
    const tw = createTestWorld(402);
    const oldLeader = addPerson(tw, 'OldLeader', 'captain', v(5, 1, 5));
    const bystander = addPerson(tw, 'Bystander', 'guard', v(6, 1, 5));
    const hero = addPerson(tw, 'Hero', 'guard', v(7, 1, 5));
    const victim = addPerson(tw, 'Victim', 'farmer', v(8, 1, 5));
    const watch = makeFaction(tw.world, 'Test Watch', 'a test faction', { factionType: 'watch', leaderId: oldLeader.id });
    watch.members = [oldLeader.id, bystander.id, hero.id];

    // Give the "hero" real, deterministic historical significance (an actual kill in the
    // event log), so succession picks them over the bystander for a real reason.
    tw.world.emit('kill', { actor: hero.id, target: victim.id, significance: 1, summary: 'test kill' });
    oldLeader.alive = false;

    const significance = computeHistoricalSignificance(tw.world);
    const changed = checkLeadershipVacancies(tw.world, significance);
    expect(changed).toContain(watch.id);
    expect(watch.leaderId).toBe(hero.id);
    const ev = tw.world.events[tw.world.events.length - 1];
    expect(ev.type).toBe('leadership_changed');
    expect(ev.data.to).toBe(hero.id);
  });

  it('leaves a faction leaderless (not silently keeping a dead leader) when every member has died', () => {
    const tw = createTestWorld(403);
    const leader = addPerson(tw, 'Leader', 'captain', v(5, 1, 5));
    const watch = makeFaction(tw.world, 'Test Watch', 'a test faction', { factionType: 'watch', leaderId: leader.id });
    watch.members = [leader.id];
    leader.alive = false;
    const significance = computeHistoricalSignificance(tw.world);
    checkLeadershipVacancies(tw.world, significance);
    expect(watch.leaderId).toBeNull();
  });

  it('is idempotent for leadership checks — a faction with a living leader is left untouched', () => {
    const tw = createTestWorld(404);
    const leader = addPerson(tw, 'Leader', 'captain', v(5, 1, 5));
    const watch = makeFaction(tw.world, 'Test Watch', 'a test faction', { factionType: 'watch', leaderId: leader.id });
    watch.members = [leader.id];
    const significance = computeHistoricalSignificance(tw.world);
    const changed = checkLeadershipVacancies(tw.world, significance);
    expect(changed).toEqual([]);
    expect(watch.leaderId).toBe(leader.id);
  });
});
