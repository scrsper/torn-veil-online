import type { Body, Person } from '../core/types';
import type { World } from '../core/world';

/** The existing temporary knockdown recovery applies to every physical body,
 * including a controller-owned body whose movement is handled by the input adapter.
 * Surrender/custody and injuries retain their ordinary independent state. */
export function recoverDownedBody(w: World, b: Body): boolean {
  if (b.dead || b.pose !== 'downed' || b.poseUntil >= w.physicalTime || b.subduedUntil >= w.physicalTime) return false;
  const owner = w.get(b.ownerId) as Person | undefined;
  if (owner?.kind === 'person' && (!owner.alive || owner.surrender || owner.custody?.active)) return false;
  b.pose = 'stand'; b.health = Math.max(b.health, b.maxHealth * .3); return true;
}
