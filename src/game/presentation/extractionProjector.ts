import type { Action, Body, Person, ResourceNode, TreeGrowthStage } from '../../sim/core/types';
import type { World } from '../../sim/core/world';
import type { ActivityPresentation, PresentationCue } from './types';

/**
 * ResourceExtractionProjector — the second proof of the framework (spec §13), covering
 * woodcutting and quarrying via the existing canonical `ResourceNode`/`chop`/`gather` machinery
 * (src/sim/world/resources.ts, src/sim/mind/agent.ts). No new tree ontology, no ecology: this
 * reads exactly the state that already exists — `node.state`, `node.growthStage`, and whichever
 * person's mind currently has an ACTIVE `chop`/`gather` action targeting this node — and turns
 * it into actor/target cues. Everything here is derived per call; nothing is stored back onto
 * the node.
 */
export type ExtractionPhase = 'idle' | 'active' | 'depleted' | 'regrowing';

export interface ExtractionPresentation extends ActivityPresentation {
  kind: 'resource_extraction';
  nodeId: string;
  phase: ExtractionPhase;
  growthStage?: TreeGrowthStage;
  workStyle: 'chop' | 'quarry' | null;
}

export interface ActiveExtractionWorker { person: Person; body: Body; action: Action; }

/**
 * The worker (if any) whose ACTIVE plan step is `chop`/`gather` targeting this node. Only the
 * active step counts — a queued/pending step (still walking over, per agent.ts's own
 * distance re-queue) must not make an idle/approaching actor falsely read as "chopping" (spec
 * §18 "idle actor does not falsely show chopping"), and an action targeting a DIFFERENT node
 * must not make that other node react (spec §18 "unrelated target does not react").
 */
export function activeExtractionWorker(world: World, node: ResourceNode): ActiveExtractionWorker | null {
  for (const person of world.persons()) {
    if (!person.alive) continue;
    const action = person.mind.plan.find(a => a.status === 'active' && (a.type === 'chop' || a.type === 'gather') && a.data?.nodeId === node.id);
    if (!action) continue;
    const body = world.primaryBody(person.id);
    if (!body) continue;
    return { person, body, action };
  }
  return null;
}

function phaseFor(node: ResourceNode, worker: ActiveExtractionWorker | null): ExtractionPhase {
  if (node.state === 'available') return worker ? 'active' : 'idle';
  if (node.state === 'depleted' && node.renewable) return 'regrowing';
  return 'depleted';
}

/** Pure, deterministic, non-mutating: reads `node`/`world` state only, never changes extraction
 * outcome (yield, depletion, regrowth all remain `resources.ts`'s to decide). */
export function deriveExtractionPresentation(world: World, node: ResourceNode): ExtractionPresentation {
  const worker = activeExtractionWorker(world, node);
  const phase = phaseFor(node, worker);
  const workStyle: 'chop' | 'quarry' | null = phase === 'active' ? (node.kind === 'tree' ? 'chop' : 'quarry') : null;

  const cues: PresentationCue[] = [];
  if (phase === 'active' && worker) {
    cues.push(
      { type: 'actor_pose', actorId: worker.person.id, targetId: node.id, data: { style: workStyle } },
      { type: 'face_target', actorId: worker.person.id, targetId: node.id, pos: { ...node.pos } },
    );
  } else if (phase === 'depleted' || phase === 'regrowing') {
    cues.push({ type: 'hide_temporary_visual', targetId: node.id });
  }

  return {
    kind: 'resource_extraction', nodeId: node.id, targetId: node.id, placeId: node.placeId,
    actorId: worker?.person.id, phase, workStyle,
    growthStage: node.growthStage,
    progress: node.capacity > 0 ? node.remaining / node.capacity : undefined,
    inputs: [{ kind: node.yield, amount: node.remaining }],
    cues,
  };
}
