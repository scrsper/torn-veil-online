import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';

describe('conflict intent (Constitution §11: hostile must not automatically mean lethal)', () => {
  it('does not kill a hostile attacker\'s victim by default when no lethal intent is given', () => {
    const tw = createTestWorld(200);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(5, 1, 5), { traits: { aggression: 0.9 } });
    bandit.hostile = true;
    const villager = addPerson(tw, 'Villager', 'farmer', v(6, 1, 5));
    const ab = tw.world.primaryBody(bandit.id)!; const vb = tw.world.primaryBody(villager.id)!;
    // Repeatedly hit well past zero health with no explicit intent (legacy call shape).
    for (let i = 0; i < 12; i++) tw.sim.applyHit(bandit, ab, vb, 15);
    expect(vb.dead).toBe(false);
    expect(villager.alive).toBe(true);
    expect(vb.pose).toBe('downed');
    expect(vb.health).toBeGreaterThan(0);
  });

  it('an explicit "kill" intent can end a life; every other intent only downs', () => {
    const tw = createTestWorld(201);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5));
    const targets: Array<[string, boolean]> = [
      ['rob', false], ['subdue', false], ['arrest', false], ['defend', false],
      ['injure', false], ['threaten', false], ['drive_off', false], ['avoid', false],
      ['kill', true],
    ];
    for (const [intent, expectDead] of targets) {
      const b = addPerson(tw, `Target-${intent}`, 'farmer', v(6, 1, 5));
      const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
      tw.sim.applyHit(a, ab, bb, 1000, intent as any);
      expect(bb.dead, `intent ${intent} should ${expectDead ? '' : 'not '}kill`).toBe(expectDead);
    }
  });

  it('a bandit\'s attack goal against an ordinary villager carries robbery intent, not kill', () => {
    const tw = createTestWorld(202, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.9 } });
    bandit.hostile = true;
    const villager = addPerson(tw, 'Villager', 'farmer', v(11, 1, 10), { traits: { courage: 0.2 } });
    // Force perception/threat evaluation deterministically by driving think() directly via stepping.
    for (let i = 0; i < 40 && !bandit.mind.goal; i++) {
      const worldDt = tw.world.clock.advance(0.05); tw.world.physicalTime += 0.05; tw.sim.step(0.05, worldDt);
    }
    if (bandit.mind.goal?.type === 'attack') {
      expect(bandit.mind.goal.data?.intent).toBe('rob');
    }
  });

  it('a guard arresting a known violent criminal uses arrest intent, not automatic death', () => {
    const tw = createTestWorld(203, 30);
    const guard = addPerson(tw, 'Guard', 'guard', v(10, 1, 10), { traits: { courage: 0.9 } });
    const criminal = addPerson(tw, 'Criminal', 'traveler', v(11, 1, 10));
    const gb = tw.world.primaryBody(guard.id)!; const cb = tw.world.primaryBody(criminal.id)!;
    // Seed a known, severe (kill-tier) crime the guard has already identified.
    guard.knowledge['ev:fake'] = {
      key: 'ev:fake', kind: 'event', claim: { eventId: 'fake', type: 'kill', tick: tw.world.now, actor: criminal.id, target: 'someone', placeId: undefined },
      confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [],
    };
    for (let i = 0; i < 60; i++) {
      const worldDt = tw.world.clock.advance(0.05); tw.world.physicalTime += 0.05; tw.sim.step(0.05, worldDt);
      if (guard.mind.plan.some(a => a.type === 'attack')) break;
    }
    const attackAction = guard.mind.plan.find(a => a.type === 'attack');
    if (attackAction) {
      expect(attackAction.data?.intent).toBe('arrest');
      // Even a devastating hit under arrest intent must not kill.
      tw.sim.applyHit(guard, gb, cb, 1000, attackAction.data?.intent as any);
      expect(cb.dead).toBe(false);
    }
  });

  it('two members of the same hostile faction do not treat each other as a threat (no bandit-on-bandit "self-defense")', () => {
    // Regression: the generic self-defense branch checked a bare `t.hostile` instead of
    // `t.hostile !== p.hostile`, so any hostile-flagged actor registered as alarming even to a
    // fellow hostile actor — observed in a real headless run as 963 repeated attacks between
    // two same-faction bandits.
    const tw = createTestWorld(204, 30);
    const a = addPerson(tw, 'Bandit A', 'bandit', v(10, 1, 10), { traits: { courage: 0.7, aggression: 0.6 } });
    const b = addPerson(tw, 'Bandit B', 'bandit', v(11, 1, 10), { traits: { courage: 0.7, aggression: 0.6 } });
    a.hostile = true; b.hostile = true;
    for (let i = 0; i < 200; i++) {
      const worldDt = tw.world.clock.advance(0.05); tw.world.physicalTime += 0.05; tw.sim.step(0.05, worldDt);
    }
    const attacksBetweenThem = tw.world.events.filter(e => e.type === 'attack' && ((e.actor === a.id && e.target === b.id) || (e.actor === b.id && e.target === a.id)));
    expect(attacksBetweenThem.length).toBe(0);
    expect(a.mind.goal?.type).not.toBe('attack');
    expect(b.mind.goal?.type).not.toBe('attack');
  });
});
