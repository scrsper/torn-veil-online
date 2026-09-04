import { describe, expect, it } from 'vitest';
import { createTestWorld, addPerson, step, face, v } from './helpers/world';
import type { RNG } from '../src/sim/core/rng';
import { makeItem } from '../src/sim/world/factory';
import {
  beginConflict, conflictBetween, lastConflictBetween, resolveConflict, disengageConflict,
  maintainConflicts, recordConflictBlow,
} from '../src/sim/social/conflict';
import { beginSurrender, subdue, takeIntoCustody, releaseFromCustody, maintainCustody, isSubdued } from '../src/sim/social/custody';
import { SECONDS_PER_DAY } from '../src/sim/core/time';

class FixedRNG { constructor(private v: number) {} next() { return this.v; } range(a: number, b: number) { return a + (b - a) * this.v; } int(a: number, b: number) { return Math.floor(this.range(a, b + 1)); } pick<T>(arr: readonly T[]): T { return arr[Math.min(arr.length - 1, Math.floor(this.v * arr.length))]; } chance(p: number) { return this.v < p; } shuffle<T>(arr: T[]) { return arr; } fork(): RNG { return this as unknown as RNG; } }

describe('conflict state (Constitution §11, v0.2.3)', () => {
  it('an attack between two people creates one canonical Conflict, not one per blow', () => {
    const tw = createTestWorld(700);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5)); a.hostile = true;
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    for (let i = 0; i < 6; i++) tw.sim.applyHit(a, ab, bb, 8, 'injure');
    expect(tw.world.conflicts.length).toBe(1);
    const c = tw.world.conflicts[0];
    expect(c.status).toBe('active');
    expect(c.participants.sort()).toEqual([a.id, b.id].sort());
    expect(c.attackCount).toBe(6);
  });

  it('a completed robbery resolves the conflict (robbery_completed), it does not grind on', () => {
    const tw = createTestWorld(701, 30);
    const bandit = addPerson(tw, 'Bandit', 'bandit', v(10, 1, 10), { traits: { courage: 0.9, aggression: 0.8 } });
    bandit.hostile = true; bandit.wealth = 0;
    const villager = addPerson(tw, 'Villager', 'farmer', v(11, 1, 10), { traits: { courage: 0.1, aggression: 0.1 } });
    tw.world.rng = new FixedRNG(0.99) as unknown as RNG; // compliant
    makeItem(tw.world, 'coins', 'silver coins', { owner: villager.id, holder: villager.id, quantity: 12 });
    for (let i = 0; i < 200 && !tw.world.events.some(e => e.type === 'theft' && e.actor === bandit.id); i++) step(tw, 0.25);
    const c = lastConflictBetween(tw.world, bandit.id, villager.id);
    expect(c?.status).toBe('resolved');
    expect(c?.outcome).toBe('robbery_completed');
  });

  it('a resolved conflict is NOT restarted by grudge/fear alone (re-engagement gate)', () => {
    const tw = createTestWorld(702, 30);
    const a = addPerson(tw, 'A', 'farmer', v(10, 1, 10), { traits: { courage: 0.8, aggression: 0.7 } });
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { traits: { courage: 0.8, aggression: 0.7 } });
    // A real past fight that resolved, with high leftover grudge/fear both ways.
    const c = beginConflict(tw.world, { initiator: a.id, target: b.id, cause: 'dispute', intent: 'injure' });
    recordConflictBlow(tw.world, c, a.id, 'injure');
    resolveConflict(tw.world, c, 'withdrawal');
    for (const [x, y] of [[a, b], [b, a]] as const) { const r = y.relationships[x.id] = { trust: -0.8, affection: -0.6, fear: 0.8, respect: 0, familiarity: 0.5, grudge: 0.9, tags: [], lastUpdated: 0 }; void r; }
    const before = tw.world.events.filter(e => e.type === 'attack').length;
    step(tw, 60); // a full minute of standing next to someone they hate
    const after = tw.world.events.filter(e => e.type === 'attack').length;
    expect(after).toBe(before); // no new blows
    expect(conflictBetween(tw.world, a.id, b.id)?.status).not.toBe('active');
    expect(a.mind.goal?.type).not.toBe('attack');
  });

  it('a fresh attack DOES restart a conflict', () => {
    const tw = createTestWorld(703);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5)); a.hostile = true;
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    const c = beginConflict(tw.world, { initiator: a.id, target: b.id, cause: 'faction_hostility', intent: 'injure' });
    resolveConflict(tw.world, c, 'withdrawal');
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    tw.sim.applyHit(a, ab, bb, 8, 'injure');
    const c2 = conflictBetween(tw.world, a.id, b.id);
    expect(c2).toBeTruthy();
    expect(c2!.status).toBe('active');
  });

  it('maintainConflicts lapses an untouched active conflict to disengaging, then suspends it', () => {
    const tw = createTestWorld(704);
    const a = addPerson(tw, 'A', 'farmer', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(40, 1, 40)); // far apart, out of contact
    const c = beginConflict(tw.world, { initiator: a.id, target: b.id, cause: 'dispute', intent: 'threaten' });
    recordConflictBlow(tw.world, c, a.id, 'threaten');
    // advance world time well past STALE_ACTIVE + DISENGAGE_GRACE without any interaction
    tw.world.clock.worldSeconds += 90 * 60;
    maintainConflicts(tw.world);
    expect(c.status).toBe('disengaging');
    tw.world.clock.worldSeconds += 30 * 60;
    maintainConflicts(tw.world);
    expect(['suspended', 'resolved']).toContain(c.status);
  });
});

describe('disengagement (Constitution §11, v0.2.3)', () => {
  it('a valid disengagement is not immediately followed by a fresh attack', () => {
    const tw = createTestWorld(740, 30);
    const a = addPerson(tw, 'A', 'bandit', v(10, 1, 10), { traits: { courage: 0.6, aggression: 0.6 } }); a.hostile = true;
    const b = addPerson(tw, 'B', 'farmer', v(11, 1, 10), { traits: { courage: 0.6 } });
    const c = beginConflict(tw.world, { initiator: a.id, target: b.id, cause: 'faction_hostility', intent: 'injure' });
    recordConflictBlow(tw.world, c, a.id, 'injure');
    disengageConflict(tw.world, c, a.id, 'thought better of it');
    const before = tw.world.events.filter(e => e.type === 'attack').length;
    step(tw, 20);
    expect(tw.world.events.filter(e => e.type === 'attack').length).toBe(before);
  });

  it('a pursuer that cannot physically reach its quarry gives up and takes a cooldown', () => {
    const tw = createTestWorld(741, 40);
    // Wall the criminal off so the guard can never path to them.
    for (let z = 0; z < 40; z++) for (let y = 1; y <= 3; y++) tw.world.grid.set(20, y, z, 1);
    tw.world.nav.rebuildAll();
    const g = addPerson(tw, 'Guard', 'guard', v(5, 1, 20), { traits: { courage: 0.9 } });
    const crim = addPerson(tw, 'Crim', 'traveler', v(35, 1, 20));
    const crimeKey = 'ev:c';
    g.knowledge[crimeKey] = { key: crimeKey, kind: 'event', claim: { eventId: 'x', type: 'attack', actor: crim.id, target: 'z', tick: tw.world.now, pos: v(35, 1, 20) }, confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    step(tw, 40);
    // The guard is not still grinding an unreachable target: bounded plan, a pursuit cooldown set.
    expect(g.mind.plan.length).toBeLessThan(20);
    const pf = tw.world.events.filter(e => e.type === 'path_failure' && e.actor === g.id).length;
    expect(pf).toBeLessThan(60); // not a per-substep path_failure storm
  });
});

describe('surrender & subdual (Constitution §11, v0.2.3)', () => {
  it('a surrendered actor is a canonical state, not a death, and stops attacking', () => {
    const tw = createTestWorld(710);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5)); a.hostile = true;
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5), { traits: { courage: 0.05, aggression: 0.05 } });
    const c = beginConflict(tw.world, { initiator: a.id, target: b.id, cause: 'robbery', intent: 'rob' });
    beginSurrender(tw.world, b, a.id, 'overwhelmed', c);
    expect(b.alive).toBe(true);
    expect(b.surrender?.toId).toBe(a.id);
    expect(tw.world.events.some(e => e.type === 'entity_surrendered' && e.actor === b.id)).toBe(true);
    step(tw, 5);
    expect(tw.world.events.some(e => e.type === 'attack' && e.actor === b.id)).toBe(false);
  });

  it('a non-lethal aggressor stops attacking a surrendered target; explicit kill intent still lands', () => {
    const tw = createTestWorld(711);
    const a = addPerson(tw, 'A', 'bandit', v(5, 1, 5));
    const b = addPerson(tw, 'B', 'farmer', v(6, 1, 5));
    const ab = tw.world.primaryBody(a.id)!; const bb = tw.world.primaryBody(b.id)!;
    beginSurrender(tw.world, b, a.id, 'yielded');
    const hpBefore = bb.health;
    expect(tw.sim.applyHit(a, ab, bb, 20, 'subdue')).toBeNull();
    expect(bb.health).toBe(hpBefore);
    // a deliberate execution is still possible (grim, but constitutional)
    tw.sim.applyHit(a, ab, bb, 999, 'kill');
    expect(bb.dead).toBe(true);
  });

  it('subdual imposes a real incapacitation that outlasts the ordinary knock-down window', () => {
    const tw = createTestWorld(712);
    const g = addPerson(tw, 'Guard', 'guard', v(5, 1, 5));
    const x = addPerson(tw, 'X', 'bandit', v(6, 1, 5)); x.hostile = true;
    const xb = tw.world.primaryBody(x.id)!;
    subdue(tw.world, x, g.id);
    expect(isSubdued(tw.world, x)).toBe(true);
    expect(tw.world.events.some(e => e.type === 'entity_subdued' && e.target === x.id)).toBe(true);
    step(tw, 50); // well past the ~45s plain downed-recovery
    expect(isSubdued(tw.world, x)).toBe(true);
    expect(xb.pose).toBe('downed');
    expect(x.mind.goal?.type).not.toBe('attack');
  });
});

describe('arrest & custody (Constitution §11, v0.2.3)', () => {
  function guardAndCriminal(seed: number) {
    const tw = createTestWorld(seed);
    const g = addPerson(tw, 'Guard', 'guard', v(5, 1, 5));
    g.factionId = 'f_watch';
    const watch = { id: 'f_watch', kind: 'faction' as const, name: 'the Watch', createdAt: 0, tags: [] as string[], members: [g.id], description: '', hostileTo: [] as string[], leaderId: g.id, knowledge: {} as Record<string, { key: string; kind: string; claim: Record<string, unknown>; confidence: number; learnedAt: number; source: { type: string }; hops: number; sharedWith: string[] }> };
    tw.world.add(watch as never);
    const crim = addPerson(tw, 'Crim', 'traveler', v(6, 1, 5));
    // a known, unresolved crime the guard has identified
    const crimeKey = 'ev:seed-crime';
    g.knowledge[crimeKey] = { key: crimeKey, kind: 'event', claim: { eventId: 'x', type: 'attack', actor: crim.id, target: 'someone', tick: tw.world.now }, confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    return { tw, g, crim, crimeKey, watch };
  }

  it('surrender → arrest → custody, with an institutional record', () => {
    const { tw, g, crim, crimeKey, watch } = guardAndCriminal(720);
    const c = beginConflict(tw.world, { initiator: crim.id, target: g.id, cause: 'crime_response', intent: 'arrest' });
    beginSurrender(tw.world, crim, g.id, 'yielded', c);
    takeIntoCustody(tw.world, crim, g, crimeKey, c);
    expect(crim.custody?.active).toBe(true);
    expect(crim.custody?.byFactionId).toBe(watch.id);
    expect(crim.surrender).toBeFalsy(); // custody supersedes surrender
    expect(tw.world.events.some(e => e.type === 'entity_arrested' && e.target === crim.id)).toBe(true);
    expect(tw.world.events.some(e => e.type === 'custody_started' && e.target === crim.id)).toBe(true);
    expect(watch.knowledge[`custody:${crim.id}`]?.claim.state).toBe('in custody');
    expect(c.status).toBe('resolved');
    expect(c.outcome).toBe('arrest');
    expect(g.knowledge[crimeKey].handled).toBe(true); // the justifying crime is now handled
  });

  it('subdual → arrest → custody', () => {
    const { tw, g, crim, crimeKey } = guardAndCriminal(721);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, crimeKey);
    expect(crim.custody?.active).toBe(true);
  });

  it('a detainee does not resume ordinary movement or combat', () => {
    const { tw, g, crim, crimeKey } = guardAndCriminal(722);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, crimeKey);
    step(tw, 120);
    expect(crim.mind.goal?.type).toBe('idle');
    expect(tw.world.events.some(e => e.type === 'attack' && e.actor === crim.id)).toBe(false);
  });

  it('a guard does not re-arrest someone already in custody', () => {
    const { tw, g, crim, crimeKey } = guardAndCriminal(723);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, crimeKey);
    const arrests1 = tw.world.events.filter(e => e.type === 'entity_arrested' && e.target === crim.id).length;
    takeIntoCustody(tw.world, crim, g, crimeKey); // idempotent
    step(tw, 30);
    const arrests2 = tw.world.events.filter(e => e.type === 'entity_arrested' && e.target === crim.id).length;
    expect(arrests2).toBe(arrests1);
  });

  it('release ends custody cleanly and updates the institutional record', () => {
    const { tw, g, crim, crimeKey, watch } = guardAndCriminal(724);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, crimeKey);
    releaseFromCustody(tw.world, crim, 'time served');
    expect(crim.custody?.active).toBe(false);
    expect(tw.world.events.some(e => e.type === 'custody_ended' && e.target === crim.id)).toBe(true);
    expect(watch.knowledge[`custody:${crim.id}`]?.claim.state).toBe('released');
  });

  it('maintainCustody releases a detainee at releaseAt', () => {
    const { tw, g, crim, crimeKey } = guardAndCriminal(725);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, crimeKey);
    expect(crim.custody?.active).toBe(true);
    tw.world.clock.worldSeconds = crim.custody!.releaseAt + 10;
    maintainCustody(tw.world);
    expect(crim.custody?.active).toBe(false);
  });

  it('custody duration scales with crime severity', () => {
    const { tw, g, crim } = guardAndCriminal(726);
    g.knowledge['ev:kill'] = { key: 'ev:kill', kind: 'event', claim: { eventId: 'y', type: 'kill', actor: crim.id, target: 'z', tick: tw.world.now }, confidence: 1, learnedAt: tw.world.now, source: { type: 'witnessed' }, hops: 0, sharedWith: [] };
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, 'ev:kill');
    const held = crim.custody!.releaseAt - crim.custody!.since;
    expect(held).toBeGreaterThanOrEqual(4 * SECONDS_PER_DAY);
  });
});

describe('epistemic locality of conflict outcomes (Constitution invariant III/IV)', () => {
  it('a witness present at an arrest learns of it; someone far away does not', () => {
    const tw = createTestWorld(730, 40);
    const g = addPerson(tw, 'Guard', 'guard', v(10, 1, 10));
    const crim = addPerson(tw, 'Crim', 'traveler', v(11, 1, 10));
    const witness = addPerson(tw, 'Witness', 'farmer', v(13, 1, 10));
    const faraway = addPerson(tw, 'Faraway', 'farmer', v(38, 1, 38));
    face(witness, tw, tw.world.primaryBody(crim.id)!.pos);
    subdue(tw.world, crim, g.id);
    takeIntoCustody(tw.world, crim, g, undefined);
    step(tw, 2);
    const arrestEv = tw.world.events.find(e => e.type === 'entity_arrested')!;
    expect(arrestEv.perceivedBy.some(p => p.who === witness.id) || Object.keys(witness.knowledge).some(k => k.startsWith('ev:') && witness.knowledge[k].claim.eventId === arrestEv.id)).toBe(true);
    expect(Object.values(faraway.knowledge).some(k => k.claim.type === 'entity_arrested')).toBe(false);
  });
});
