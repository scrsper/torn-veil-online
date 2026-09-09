import { describe, expect, it } from 'vitest';
import { addPerson, createTestWorld, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import {
  ERRAND_RADIUS_METRES, nearestPlaceOfType, nearestPlaceWhere, placesOfType, whereaboutsOf, withinErrandRange,
} from '../src/sim/world/locality';
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
  it('answers with the nearest one, not the first registered', () => {
    const tw = createTestWorld(1, 600);
    const near = makePlace(tw.world, 'mill', 'the near mill', { x0: 10, z0: 10, x1: 14, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 12) });
    const far = makePlace(tw.world, 'mill', 'the far mill', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502) });
    expect(nearestPlaceOfType(tw.world, v(500, 1, 500), 'mill')?.id).toBe(far.id);
    expect(nearestPlaceOfType(tw.world, v(11, 1, 11), 'mill')?.id).toBe(near.id);
    // Registration order decides only when the asker has no position at all.
    expect(nearestPlaceOfType(tw.world, null, 'mill')?.id).toBe(near.id);
  });

  it('resolves a person from their body, then their work, then their home', () => {
    const tw = createTestWorld(1, 600);
    const home = makePlace(tw.world, 'house', 'a house', { x0: 8, z0: 8, x1: 12, z1: 12, y0: 1, y1: 4 }, { inside: v(10, 1, 10) });
    const work = makePlace(tw.world, 'mill', 'a mill', { x0: 400, z0: 400, x1: 404, z1: 404, y0: 1, y1: 4 }, { inside: v(402, 1, 402) });
    const p = addPerson(tw, 'Walker', 'miller', v(200, 1, 200), { workId: work.id, homeId: home.id });
    expect(whereaboutsOf(tw.world, p)).toEqual(tw.world.primaryBody(p.id)!.pos);
    // With no body left, the canonical record of where they work and live still gives an answer.
    tw.world.primaryBody(p.id)!.present = false;
    p.bodies = [];
    expect(whereaboutsOf(tw.world, p)).toEqual(work.inside);
    p.workId = null;
    expect(whereaboutsOf(tw.world, p)).toEqual(home.inside);
  });

  it('lists every place of a kind, deterministically — what a demand pass needs', () => {
    const tw = createTestWorld(1, 600);
    const a = makePlace(tw.world, 'bakery', 'one bakery', { x0: 10, z0: 10, x1: 14, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 12) });
    const b = makePlace(tw.world, 'bakery', 'another bakery', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502) });
    const ids = placesOfType(tw.world, 'bakery').map(p => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(placesOfType(tw.world, 'bakery').map(p => p.id)).toEqual(ids); // stable
  });

  it('answers questions about places identified by something other than their type', () => {
    const tw = createTestWorld(1, 600);
    makePlace(tw.world, 'wilderness', 'the north forest', { x0: 10, z0: 10, x1: 14, z1: 14, y0: 1, y1: 4 }, { inside: v(12, 1, 12), slug: 'forest' });
    const clearing = makePlace(tw.world, 'wilderness', 'the clearing', { x0: 500, z0: 500, x1: 504, z1: 504, y0: 1, y1: 4 }, { inside: v(502, 1, 502), slug: 'clearing' });
    expect(nearestPlaceWhere(tw.world, v(12, 1, 12), p => p.slug === 'clearing')?.id).toBe(clearing.id);
  });

  it('treats an unknown position as unplaceable rather than as a violation', () => {
    expect(withinErrandRange(undefined, v(0, 0, 0))).toBe(true);
    expect(withinErrandRange(v(0, 1, 0), v(ERRAND_RADIUS_METRES - 1, 1, 0))).toBe(true);
    expect(withinErrandRange(v(0, 1, 0), v(ERRAND_RADIUS_METRES + 1, 1, 0))).toBe(false);
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
