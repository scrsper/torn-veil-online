import { beforeAll, describe, expect, it } from 'vitest';
import { StaticGeometry, type StaticTriangle } from '../../src/sim/physical/staticGeometry';
import { planTraversal, traversalPoint, TRAVERSAL } from '../../src/sim/physical/traversal';
import { loadFocusedGeometry } from '../../src/server/focusedGeometryLoader';
import { RealmRuntime } from '../../src/server/realmRuntime';
import { RealmSession } from '../../src/sim/world/realms/session';

/** Synthetic triangles: a floor quad and an upright box with no standable top. */
function quad(x0: number, z0: number, x1: number, z1: number, y: number): StaticTriangle[] {
  return [{ p: [x0, y, z0, x0, y, z1, x1, y, z1], support: true }, { p: [x0, y, z0, x1, y, z1, x1, y, z0], support: true }];
}
function box(x0: number, z0: number, x1: number, z1: number, h: number): StaticTriangle[] {
  const v = (a: number[], b: number[]): StaticTriangle[] => [{ p: [a[0], 0, a[1], b[0], 0, b[1], b[0], h, b[1]], support: false }, { p: [a[0], 0, a[1], b[0], h, b[1], a[0], h, a[1]], support: false }];
  return [...v([x0, z0], [x1, z0]), ...v([x1, z0], [x1, z1]), ...v([x1, z1], [x0, z1]), ...v([x0, z1], [x0, z0]),
    { p: [x0, h, z0, x1, h, z1, x1, h, z0], support: false }, { p: [x0, h, z0, x0, h, z1, x1, h, z1], support: false }];
}
const geometry = (t: StaticTriangle[]) => new StaticGeometry(t, { x0: -6, z0: -6, x1: 6, z1: 6 });
const origin = { x: 0, y: 0, z: 0 };

describe('jump and vault planning', () => {
  it('vaults a low rail onto the ground beyond, clearing it by the lowest arc', () => {
    const g = geometry([...quad(-5, -5, 5, 5, 0), ...box(-2, -1.0, 2, -.8, .9)]);
    const plan = planTraversal(g, origin, 0)!;
    expect(plan.kind).toBe('vault'); expect(plan.to.z).toBeLessThan(-1.0); expect(plan.to.y).toBeCloseTo(0);
    expect(plan.clearance).toBeGreaterThanOrEqual(.9); expect(plan.clearance).toBeLessThanOrEqual(TRAVERSAL.vaultMaxHeight);
    expect(g.fits(plan.to.x, plan.to.y, plan.to.z, .3, 1.75)).toBe(true);
    expect(planTraversal(g, origin, 0)).toEqual(plan);
  });
  it('refuses a wall taller than a vault and an open floor with nothing to traverse', () => {
    expect(planTraversal(geometry([...quad(-5, -5, 5, 5, 0), ...box(-2, -1.0, 2, -.8, 2.4)]), origin, 0)).toBeNull();
    expect(planTraversal(geometry(quad(-5, -5, 5, 5, 0)), origin, 0)).toBeNull();
  });
  it('jumps a gap onto supported ground and refuses one too wide', () => {
    const g = geometry([...quad(-5, -.6, 5, 5, 0), ...quad(-5, -5, 5, -2.2, 0)]);
    const plan = planTraversal(g, origin, 0)!;
    expect(plan.kind).toBe('jump'); expect(plan.to.z).toBeLessThanOrEqual(-2.2 - .2);
    expect(planTraversal(geometry([...quad(-5, -.6, 5, 5, 0), ...quad(-5, -5, 5, -4.5, 0)]), origin, 0)).toBeNull();
  });
  it('follows one arc on host and client and lands exactly on the plan', () => {
    const t = { kind: 'vault' as const, from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: -1.5 }, start: 10, end: 10.45, apex: 1.2 };
    expect(traversalPoint(t, 10.225).pos.y).toBeCloseTo(1.2);
    expect(traversalPoint(t, 11)).toEqual({ pos: t.to, done: true });
  });
});

describe('traversal on the canonical body', () => {
  beforeAll(() => loadFocusedGeometry());
  it('vaults through the journaled host operation, owns the body until it lands, and replays identically', () => {
    const find = (s: RealmSession) => {
      const b = s.grid.focusedTown!.bounds;
      for (let x = b.x0; x < b.x1; x += 3) for (let z = b.z0; z < b.z1; z += 3) {
        const g = s.world.grid.movementGeometryAt(x, z); if (!g) continue;
        const y = g.supportAt(x, z, 1.06, 3); if (y === null || !g.fits(x, y, z, .3, 1.75)) continue;
        for (let k = 0; k < 8; k++) { const p = planTraversal(g, { x, y, z }, k * Math.PI / 4); if (p?.kind === 'vault') return { pos: { x, y, z }, yaw: k * Math.PI / 4, plan: p }; }
      }
      throw Error('no vault in the focused town');
    };
    const runs = [0, 1].map(() => { const s = new RealmSession(918271); s.adoptFocusedWorld(); return new RealmRuntime(s); });
    const spot = find(runs[0].session);
    for (const r of runs) {
      const s = r.session; s.body.pos = { ...spot.pos }; s.body.yaw = spot.yaw;
      expect(r.apply({ type: 'traverse' })).toBe('vault');
      expect(s.body.traversal).toBeTruthy();
      // Movement input cannot steer an in-flight vault.
      s.move({ x: 1, z: 0, sprint: true });
      for (let i = 0; i < 40; i++) s.step(1 / 60);
      expect(s.body.traversal).toBeUndefined();
      expect(s.body.pos.x).toBeCloseTo(spot.plan.to.x, 5); expect(s.body.pos.z).toBeCloseTo(spot.plan.to.z, 5);
    }
    expect(runs[1].session.body.pos).toEqual(runs[0].session.body.pos);
    expect(runs[0].apply({ type: 'traverse' })).not.toBe('unable');
  }, 120000);
});
