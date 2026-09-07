import type { Body, Person } from '../core/types';
import type { Simulation } from '../mind/agent';

/**
 * How far a light melee swing reaches, and how long between swings. The same numbers the
 * in-browser player already swings at (`game/player/interaction.ts`), lifted here because an
 * external presentation client must not be allowed to invent its own.
 */
export const MELEE_REACH = 3.2;
export const MELEE_COOLDOWN = 0.55;

/** How far off directly-ahead a body may be and still be struck by an untargeted swing. */
const SWING_ARC = 0.35;

export type MeleeResult = 'accepted' | 'cooldown' | 'out_of_reach' | 'no_target' | 'incapacitated';

/**
 * External control is intent, never a damage number (Constitution VI, and AGENTS.md's corollary:
 * "an NPC and the player should always go through the same code path for the same action"). A
 * client may say *whom* it is swinging at — it cannot say whether the swing lands, how hard, or
 * whether the target dies. All of that is `Simulation.attack` → `Simulation.applyHit`, the exact
 * path an NPC's own `attack` action takes, including its lethality rules: an ordinary blow downs
 * a person rather than killing them, a subdued/surrendered/in-custody person is out of the fight
 * and cannot be hit further, and every witness learns about it through the normal event.
 *
 * `targetBodyId` is a hint, not an instruction — reach, facing and eligibility are re-checked
 * here against canonical state, so a client that names a body across the village gets nothing.
 */
export function meleeStrike(sim: Simulation, actor: Person, body: Body, targetBodyId: string | null): MeleeResult {
  const w = sim.world;
  if (body.ownerId !== actor.id || !body.present || body.dead || !actor.alive) return 'incapacitated';
  if (actor.surrender || actor.custody?.active || body.pose === 'downed' || body.subduedUntil > w.physicalTime) return 'incapacitated';
  if (w.physicalTime - body.lastAttackAt < MELEE_COOLDOWN) return 'cooldown';

  const reachable = (b: Body): number | null => {
    if (b.id === body.id || !b.present || b.dead || b.shape !== 'humanoid') return null;
    const holder = w.get(b.ownerId);
    if (!holder || (holder.kind !== 'person' && holder.kind !== 'creature')) return null;
    const d = Math.hypot(b.pos.x - body.pos.x, b.pos.z - body.pos.z);
    return d <= MELEE_REACH ? d : null;
  };

  let target: Body | null = null;
  let miss: MeleeResult = 'no_target';
  if (targetBodyId) {
    // A deliberately selected target turns the body toward it, the way clicking someone in the
    // elevated camera already does in the browser client — the swing still has to reach.
    const named = w.bodies().find(b => b.id === targetBodyId);
    if (named && reachable(named) !== null) target = named;
    else miss = named ? 'out_of_reach' : 'no_target';
  } else {
    let best = Infinity;
    const fx = -Math.sin(body.yaw), fz = -Math.cos(body.yaw);
    for (const b of w.bodies()) {
      const d = reachable(b);
      if (d === null || d >= best) continue;
      const len = d || 1;
      if (((b.pos.x - body.pos.x) / len) * fx + ((b.pos.z - body.pos.z) / len) * fz < SWING_ARC) continue;
      best = d; target = b;
    }
  }

  if (!target) {
    // A swing at nothing is still a swing: it costs the same recovery and it is just as visible
    // as one that lands. Matches the browser client, which poses and starts its cooldown before
    // it ever looks at what the cursor was over.
    body.pose = 'attack'; body.poseUntil = w.physicalTime + 0.45; body.lastAttackAt = w.physicalTime; body.attackTarget = null;
    return miss;
  }
  body.yaw = Math.atan2(-(target.pos.x - body.pos.x), -(target.pos.z - body.pos.z));
  sim.attack(actor, body, target);
  return 'accepted';
}
