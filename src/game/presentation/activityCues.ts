import type { Person } from '../../sim/core/types';
import type { World } from '../../sim/core/world';

/**
 * Actor integration (spec §15) — the lookup a renderer uses to turn a Body's generic 'work'
 * pose into a semantically distinct motion. `Body.pose` stays coarse canonical state ('stand',
 * 'walk', 'work', ...); this resolves the finer-grained STYLE from the actor's currently active
 * `Action` (mind/agent.ts's `Mind.plan`), which is also canonical and read-only here — nothing
 * in this file mutates a person, a body, or an action.
 *
 * Deliberately a thin table, not a general animation engine: only construction (`build`) and
 * resource extraction (`chop`/`gather`) have distinct motions in this milestone. Every other
 * 'work'-posed action (haul load/unload, plant, harvest, ...) returns null and the renderer
 * falls back to its existing generic work animation — unchanged behaviour for those. Extend this
 * table (add a branch, not a redesign) when a future adapter needs its own style — see
 * docs/SEMANTIC_ACTIVITY_PROJECTION.md "Future adapters" (mill/bake/craft/repair/cook).
 */
export type WorkStyle = 'chop' | 'quarry' | 'hammer';

export function workStyleFor(world: World, person: Person): WorkStyle | null {
  const action = person.mind.plan.find(a => a.status === 'active');
  if (!action) return null;
  if (action.type === 'build') return 'hammer';
  if (action.type === 'chop' || action.type === 'gather') {
    const node = world.resourceNodes.find(n => n.id === action.data?.nodeId);
    return (node?.kind ?? (action.type === 'chop' ? 'tree' : 'stone')) === 'stone' ? 'quarry' : 'chop';
  }
  return null;
}
