import type { Body, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { INTERACTION_SPEC } from './prediction';
import type { MovementGeometry } from './staticGeometry';

/**
 * Jump and vault, planned from the same static geometry the movement kernel collides with.
 *
 * A vault carries the body over a low obstacle it cannot walk through (a rail, a wall stub,
 * a fallen trunk) onto standable ground just beyond. A jump carries it across a gap with no
 * support onto ground ahead. Both are short, fixed-duration arcs; the plan is accepted only
 * when the landing fits the body's capsule and the path over the obstacle is clear. Anything
 * else is a hop in place, which moves nobody and is left to presentation.
 */
export const TRAVERSAL = Object.freeze({
  vaultMaxHeight: 1.3, vaultReach: [0.9, 1.2, 1.5, 1.8] as readonly number[], vaultSeconds: 0.45,
  jumpReach: [1.6, 2.0, 2.4, 2.8] as readonly number[], jumpMaxDrop: 1.2, jumpMaxRise: 0.5, jumpSeconds: 0.55, jumpApex: 0.55,
});
export type TraversalKind = 'vault' | 'jump';
export interface TraversalPlan { kind: TraversalKind; from: Vec3; to: Vec3; clearance: number; seconds: number; apex: number }
export interface BodyTraversal { kind: TraversalKind; from: Vec3; to: Vec3; start: number; end: number; apex: number }

const forward = (yaw: number, d: number) => ({ x: -Math.sin(yaw) * d, z: -Math.cos(yaw) * d });

/** Pure: same geometry, position and facing always give the same plan. */
export function planTraversal(geometry: MovementGeometry, pos: Vec3, yaw: number): TraversalPlan | null {
  const r = INTERACTION_SPEC.radius, h = INTERACTION_SPEC.height;
  const standAt = (d: number, fromY: number, step: number) => {
    const f = forward(yaw, d), x = pos.x + f.x, z = pos.z + f.z, y = geometry.supportAt(x, z, fromY, step);
    return y !== null && geometry.fits(x, y, z, r, h) ? { x, y, z } : null;
  };
  const clearAt = (to: Vec3, lift: number) => geometry.lineClear({ x: pos.x, y: pos.y + lift, z: pos.z }, { x: to.x, y: to.y + lift, z: to.z })
    && geometry.lineClear({ x: pos.x, y: pos.y + lift + .9, z: pos.z }, { x: to.x, y: to.y + lift + .9, z: to.z });
  const ahead = (d: number, lift: number) => { const f = forward(yaw, d); return geometry.lineClear({ x: pos.x, y: pos.y + lift, z: pos.z }, { x: pos.x + f.x, y: pos.y + lift, z: pos.z + f.z }); };
  // Something solid at knee height within reach: vault over it, or onto it when it is a ledge.
  if (!ahead(.9, .35)) {
    for (const d of TRAVERSAL.vaultReach) {
      const landing = standAt(d, pos.y + .3, .6); if (!landing) continue;
      // The lowest clear arc over the obstacle; the body tucks to about 0.9 m above its feet.
      for (let lift = .3; lift <= TRAVERSAL.vaultMaxHeight + 1e-9; lift += .2) if (clearAt(landing, lift))
        return { kind: 'vault', from: { ...pos }, to: landing, clearance: lift, seconds: TRAVERSAL.vaultSeconds, apex: lift + .15 };
    }
    return null;
  }
  // A gap: open air ahead with no support a stride away, within a step down.
  const f = forward(yaw, 1.0);
  if (geometry.supportAt(pos.x + f.x, pos.z + f.z, pos.y, .35) !== null) return null;
  for (const d of TRAVERSAL.jumpReach) {
    const landing = standAt(d, pos.y, Math.max(TRAVERSAL.jumpMaxDrop, TRAVERSAL.jumpMaxRise));
    if (!landing || landing.y - pos.y > TRAVERSAL.jumpMaxRise || pos.y - landing.y > TRAVERSAL.jumpMaxDrop) continue;
    if (clearAt(landing, .5)) return { kind: 'jump', from: { ...pos }, to: landing, clearance: .5, seconds: TRAVERSAL.jumpSeconds, apex: TRAVERSAL.jumpApex };
  }
  return null;
}

/** Start a planned traversal on a canonical body. Returns the plan, or null for a hop in place. */
export function beginTraversal(w: World, b: Body): TraversalPlan | null {
  if (b.traversal && b.traversal.end > w.physicalTime) return null;
  const geometry = w.grid.movementGeometryAt(b.pos.x, b.pos.z); if (!geometry) return null;
  const plan = planTraversal(geometry, b.pos, b.yaw); if (!plan) return null;
  b.traversal = { kind: plan.kind, from: plan.from, to: plan.to, start: w.physicalTime, end: w.physicalTime + plan.seconds, apex: plan.apex };
  b.path = null;
  return plan;
}
/** Where the arc puts the body at physical time `now`; shared by the host and presentation. */
export function traversalPoint(t: BodyTraversal, now: number): { pos: Vec3; done: boolean } {
  const k = Math.min(1, Math.max(0, (now - t.start) / (t.end - t.start)));
  const base = t.from.y + (t.to.y - t.from.y) * k, arc = 4 * k * (1 - k) * Math.max(0, t.apex - Math.max(0, t.to.y - t.from.y) * .5);
  return { pos: { x: t.from.x + (t.to.x - t.from.x) * k, y: k >= 1 ? t.to.y : base + arc, z: t.from.z + (t.to.z - t.from.z) * k }, done: k >= 1 };
}
/** Advance an active traversal along its arc; the body lands exactly on the planned point. */
export function advanceTraversal(w: World, b: Body, dt: number): boolean {
  const t = b.traversal; if (!t) return false;
  const old = { ...b.pos }, { pos, done } = traversalPoint(t, w.physicalTime);
  b.pos = pos;
  if (dt > 0) b.vel = { x: (b.pos.x - old.x) / dt, y: (b.pos.y - old.y) / dt, z: (b.pos.z - old.z) / dt };
  if (done) { delete b.traversal; b.vel = { x: 0, y: 0, z: 0 }; }
  return true;
}
