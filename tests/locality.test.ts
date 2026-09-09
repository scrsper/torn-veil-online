import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { DAILY_LOCAL_RANGE, localPlaces, near, placeForPerson } from '../src/sim/world/locality';
import { INVARIANTS } from '../src/headless/worldlab/invariants';
import type { Finding } from '../src/headless/worldlab/types';
import type { Place } from '../src/sim/core/types';

/**
 * LOCALITY. `world.places().find(p => p.type === X)` means "the first place of this type anywhere
 * in the world" — right by accident in a one-village world, and wrong at every call site the
 * moment a second settlement exists. These assert the replacement answers the question it claims
 * to, and that the WorldLab invariant guarding it is not vacuous: it has to actually fail on a
 * commitment that reaches out of somebody's locality, or it proves nothing about the day a second
 * settlement is generated.
 */

const localityCheck = INVARIANTS.find(i => i.id === 'locality-of-commitments')!;
const findings = (world: Parameters<typeof localityCheck.check>[0]): Finding[] =>
  localityCheck.check(world, null, null as never);

describe('resolving a place from somewhere', () => {
  it('answers with a place in the asker\'s own locality, not the first one registered', () => {
    const tw = createTestWorld(1, 600);
    const near1 = makePlace(tw.world, 'mill', 'the near mill', { x0: 10, z0: 10, x1: 14, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 12) });
    const far = makePlace(tw.world, 'mill', 'the far mill', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502) });
    const here = addPerson(tw, 'Local', 'miller', v(12, 1, 12));
    const yonder = addPerson(tw, 'Distant', 'miller', v(502, 1, 502));
    expect(placeForPerson(tw.world, here, 'mill')?.id).toBe(near1.id);
    expect(placeForPerson(tw.world, yonder, 'mill')?.id).toBe(far.id);
  });

  it('lists only the places within an ordinary day of where the question is asked', () => {
    const tw = createTestWorld(1, 600);
    makePlace(tw.world, 'bakery', 'one bakery', { x0: 10, z0: 10, x1: 14, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 12) });
    makePlace(tw.world, 'bakery', 'another bakery', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502) });
    const localIds = localPlaces(tw.world, v(12, 1, 12)).filter(p => p.type === 'bakery').map(p => p.name);
    expect(localIds).toEqual(['one bakery']);
    // ...and the same question asked from nowhere has no answer, rather than a wrong one.
    expect(localPlaces(tw.world, undefined)).toEqual([]);
  });

  it('treats an unknown position as unplaceable rather than as near', () => {
    expect(near(undefined, v(0, 0, 0))).toBe(false);
    expect(near(v(0, 1, 0), v(DAILY_LOCAL_RANGE - 1, 1, 0))).toBe(true);
    expect(near(v(0, 1, 0), v(DAILY_LOCAL_RANGE + 1, 1, 0))).toBe(false);
  });
});

describe('the locality invariant is not vacuous', () => {
  /** A world with two settled places far enough apart that walking between them is a journey. */
  function twoSettlements(): { tw: ReturnType<typeof createTestWorld>; here: Place; yonder: Place } {
    const tw = createTestWorld(1, 600);
    const here = makePlace(tw.world, 'house', 'a house in Ashford', { x0: 20, z0: 20, x1: 24, z1: 24, y0: 1, y1: 4 }, { inside: v(22, 1, 22) });
    const yonder = makePlace(tw.world, 'mill', 'a mill a long way off', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502) });
    return { tw, here, yonder };
  }

  it('says nothing about somebody whose whole life is where they live', () => {
    const { tw, here } = twoSettlements();
    const mill = makePlace(tw.world, 'mill', 'the local mill', { x0: 30, z0: 30, x1: 34, z1: 34, y0: 1, y1: 4 }, { inside: v(32, 1, 32) });
    addPerson(tw, 'Settled', 'miller', v(32, 1, 32), { homeId: here.id, workId: mill.id });
    expect(findings(tw.world)).toEqual([]);
  });

  it('fails when a work post resolved outside the locality the person lives in', () => {
    const { tw, here, yonder } = twoSettlements();
    addPerson(tw, 'Commuter', 'miller', v(22, 1, 22), { homeId: here.id, workId: yonder.id });
    const found = findings(tw.world);
    expect(found.map(f => f.id)).toContain('WL-LOCALITY-DISTANT');
    expect(found[0].message).toContain('their work post');
    expect(found[0].severity).toBe('failure');
  });

  it('fails when a goal resolved somewhere the person cannot physically walk to', () => {
    const { tw, here } = twoSettlements();
    // Off the navigable grid entirely: no walkable cell anywhere near it, so no route exists.
    const unreachable = makePlace(tw.world, 'mill', 'a mill beyond the world', { x0: 700, z0: 700, x1: 704, z1: 704, y0: 1, y1: 4 }, { inside: v(702, 1, 702) });
    const p = addPerson(tw, 'Dreamer', 'villager', v(22, 1, 22), { homeId: here.id });
    p.mind.goal = { type: 'work', utility: 0.5, reasons: [], targetPlace: unreachable.id, createdAt: 0, key: 'work:test' };
    const found = findings(tw.world);
    expect(found.map(f => f.id)).toContain('WL-LOCALITY-UNREACHABLE');
    expect(found.some(f => f.message.includes('their goal (work)'))).toBe(true);
  });

  it('fails when a haul was raised across two settlements', () => {
    const { tw, here, yonder } = twoSettlements();
    const p = addPerson(tw, 'Hauler', 'villager', v(22, 1, 22), { homeId: here.id });
    tw.world.haulTasks.push({
      id: 'haul_test', resource: 'grain', quantity: 4, delivered: 0,
      sourcePlaceId: yonder.id, destPlaceId: here.id, status: 'claimed', claimantId: p.id,
      createdAt: 0, updatedAt: 0, reason: 'a long way for a sack of grain', priority: 0.5,
      requesterId: null, projectId: null, requestId: null,
    } as never);
    const found = findings(tw.world);
    expect(found.some(f => f.id === 'WL-LOCALITY-DISTANT' && f.message.includes('the haul they took on'))).toBe(true);
  });

  it('does not mistake a market stall for an unreachable place', () => {
    // A stall's own `inside` cell is the stall itself and is deliberately not walkable — nobody
    // stands in the counter. The check has to ask about the anchors people actually stand at,
    // which is what `mind/agent.ts`'s own plans resolve to. This caught a false failure against
    // three real Ashford stallholders the first time the invariant ran.
    const { tw, here } = twoSettlements();
    const stall = makePlace(tw.world, 'stall', 'a stall', { x0: 40, z0: 40, x1: 41, z1: 41, y0: 1, y1: 4 }, {
      inside: v(40.5, 1, 40.5), anchors: [{ kind: 'work', pos: v(42, 1, 42) }],
    });
    for (let x = 39; x <= 42; x++) for (let z = 39; z <= 42; z++) tw.world.grid.set(x, 1, z, 1);
    tw.world.grid.set(42, 1, 42, 0);
    tw.world.initNav();
    const p = addPerson(tw, 'Stallholder', 'villager', v(42, 1, 42), { homeId: here.id, workId: stall.id });
    expect(findings(tw.world).filter(f => f.id === 'WL-LOCALITY-UNREACHABLE')).toEqual([]);
  });
});
