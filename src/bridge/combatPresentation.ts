import type { World } from '../sim/core/world';
import type { WorldEvent } from '../sim/core/types';
import type { CombatActionFacts } from '../sim/physical/combatFacts';

export const COMBAT_REPLAY_LIMIT = 128;
export const COMBAT_REPLAY_SECONDS = 8;
export interface CombatPresentationEvent extends CombatActionFacts { eventId: string }
export interface CombatPresentationStream {
  version: 1;
  /** Global action sequence, including actions not visible to this observer. Gaps between
   * visible entries are normal. Only falling below firstAvailableSeq means retention loss. */
  firstAvailableSeq: number;
  latestSeq: number;
  events: CombatPresentationEvent[];
}
const caches = new WeakMap<World, WorldEvent[]>();
function recent(w: World): WorldEvent[] {
  let list = caches.get(w);
  if (!list) {
    list = w.events.filter(e => e.data.combatFacts).slice(-COMBAT_REPLAY_LIMIT);
    caches.set(w, list);
    const ring = list;
    w.onEvent(e => {
      if (!e.data.combatFacts) return;
      ring.push(e);
      if (ring.length > COMBAT_REPLAY_LIMIT) ring.splice(0, ring.length - COMBAT_REPLAY_LIMIT);
    });
  }
  return list;
}
/** Renderer allowlist over existing causal history. Never sends intent, damage internals,
 * private skill beliefs, names, plans or technique speculation. Ordinary spectators must
 * have actually seen the event; hearing alone cannot reveal a hidden action's geometry. */
export function combatPresentation(w: World, visible: ReadonlySet<string>, observerId?: string): CombatPresentationStream {
  const retained = recent(w).filter(e => w.physicalTime - (e.data.combatFacts as CombatActionFacts).physicalTime <= COMBAT_REPLAY_SECONDS);
  const latestSeq = w.getCounters().combat ?? 0;
  const events: CombatPresentationEvent[] = [];
  for (const e of retained) {
    const f = e.data.combatFacts as CombatActionFacts;
    if (!visible.has(f.actorBodyId) || (f.targetBodyId && !visible.has(f.targetBodyId))) continue;
    if (observerId && e.actor !== observerId && e.target !== observerId
      && !e.perceivedBy.some(p => p.who === observerId && p.how === 'saw')) continue;
    // Copy individual fields so additions to canonical facts do not silently broaden the wire.
    events.push({ eventId: e.id, seq: f.seq, physicalTime: f.physicalTime,
      actorBodyId: f.actorBodyId, targetBodyId: f.targetBodyId,
      actorPosition: { ...f.actorPosition }, targetPosition: f.targetPosition ? { ...f.targetPosition } : null,
      targetVelocity: f.targetVelocity ? { ...f.targetVelocity } : null, actorYaw: f.actorYaw,
      weaponType: f.weaponType, weaponId: f.weaponId, action: f.action, outcome: f.outcome,
      attackSeq: f.attackSeq, hitSeq: f.hitSeq, capability: { strength: f.capability.strength,
        dexterity: f.capability.dexterity, exertion: f.capability.exertion } });
  }
  return { version: 1, firstAvailableSeq: retained.length ? retained[0].data.combatFacts.seq : latestSeq + 1, latestSeq, events };
}
