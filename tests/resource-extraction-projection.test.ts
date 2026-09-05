import { describe, it, expect } from 'vitest';
import { createTestWorld, addPerson, v } from './helpers/world';
import type { ResourceNode, Action } from '../src/sim/core/types';
import { deriveExtractionPresentation, activeExtractionWorker } from '../src/game/presentation/extractionProjector';

function makeTreeNode(placeId: string, id = 'node_1'): ResourceNode {
  return {
    id, kind: 'tree', yield: 'log', pos: v(10, 1, 10), blocks: [],
    remaining: 6, capacity: 6, renewable: true, regrowHours: 24, state: 'available',
    dropPlaceId: placeId, placeId, growthStage: 'mature',
  };
}
function makeStoneNode(placeId: string, id = 'node_2'): ResourceNode {
  return {
    id, kind: 'stone', yield: 'stone', pos: v(20, 1, 20), blocks: [],
    remaining: 24, capacity: 24, renewable: false, regrowHours: 0, state: 'available',
    dropPlaceId: placeId, placeId,
  };
}

describe('ResourceExtractionProjector — deriveExtractionPresentation', () => {
  it('an actively chopping worker derives an active phase with actor/target cues', () => {
    const tw = createTestWorld();
    const node = makeTreeNode(tw.places.square);
    tw.world.resourceNodes.push(node);
    const woodcutter = addPerson(tw, 'Woodcutter', 'woodcutter', v(10, 1, 9));
    const action: Action = { type: 'chop', status: 'active', pos: { ...node.pos }, data: { nodeId: node.id } };
    woodcutter.mind.plan = [action];

    const worker = activeExtractionWorker(tw.world, node);
    expect(worker?.person.id).toBe(woodcutter.id);

    const p = deriveExtractionPresentation(tw.world, node);
    expect(p.phase).toBe('active');
    expect(p.workStyle).toBe('chop');
    expect(p.actorId).toBe(woodcutter.id);
    expect(p.cues.some(c => c.type === 'actor_pose' && c.actorId === woodcutter.id && c.data?.style === 'chop')).toBe(true);
    expect(p.cues.some(c => c.type === 'face_target' && c.targetId === node.id)).toBe(true);
  });

  it('quarrying a stone node derives the quarry work style', () => {
    const tw = createTestWorld();
    const node = makeStoneNode(tw.places.square);
    tw.world.resourceNodes.push(node);
    const quarrier = addPerson(tw, 'Quarrier', 'woodcutter', v(20, 1, 19));
    quarrier.mind.plan = [{ type: 'gather', status: 'active', pos: { ...node.pos }, data: { nodeId: node.id } }];

    const p = deriveExtractionPresentation(tw.world, node);
    expect(p.phase).toBe('active');
    expect(p.workStyle).toBe('quarry');
  });

  it('an idle actor (only a PENDING chop step) does not falsely show chopping', () => {
    const tw = createTestWorld();
    const node = makeTreeNode(tw.places.square);
    tw.world.resourceNodes.push(node);
    const walker = addPerson(tw, 'Walker', 'woodcutter', v(2, 1, 2));
    // Still walking toward the node — agent.ts's real chop/gather handler leaves the goto
    // active and the chop step 'pending' until the actor is actually in range.
    walker.mind.plan = [
      { type: 'goto', status: 'active', pos: { ...node.pos } },
      { type: 'chop', status: 'pending', pos: { ...node.pos }, data: { nodeId: node.id } },
    ];

    const p = deriveExtractionPresentation(tw.world, node);
    expect(p.phase).toBe('idle');
    expect(p.actorId).toBeUndefined();
    expect(p.cues).toEqual([]);
  });

  it('an unrelated target does not react to a worker chopping a different node', () => {
    const tw = createTestWorld();
    const targetNode = makeTreeNode(tw.places.square, 'node_target');
    const unrelatedNode = makeTreeNode(tw.places.square, 'node_unrelated');
    unrelatedNode.pos = v(30, 1, 30);
    tw.world.resourceNodes.push(targetNode, unrelatedNode);
    const woodcutter = addPerson(tw, 'Woodcutter', 'woodcutter', v(10, 1, 9));
    woodcutter.mind.plan = [{ type: 'chop', status: 'active', pos: { ...targetNode.pos }, data: { nodeId: targetNode.id } }];

    const active = deriveExtractionPresentation(tw.world, targetNode);
    const unrelated = deriveExtractionPresentation(tw.world, unrelatedNode);
    expect(active.phase).toBe('active');
    expect(unrelated.phase).toBe('idle');
    expect(unrelated.actorId).toBeUndefined();
    expect(unrelated.cues).toEqual([]);
  });

  it('a depleted non-renewable node presentation follows canonical state', () => {
    const tw = createTestWorld();
    const node = makeStoneNode(tw.places.square);
    node.state = 'depleted'; node.remaining = 0;
    tw.world.resourceNodes.push(node);
    const p = deriveExtractionPresentation(tw.world, node);
    expect(p.phase).toBe('depleted');
    expect(p.workStyle).toBeNull();
  });

  it('a felled renewable tree reports its regrowing growth stage', () => {
    const tw = createTestWorld();
    const node = makeTreeNode(tw.places.square);
    node.state = 'depleted'; node.remaining = 0; node.growthStage = 'sapling';
    tw.world.resourceNodes.push(node);
    const p = deriveExtractionPresentation(tw.world, node);
    expect(p.phase).toBe('regrowing');
    expect(p.growthStage).toBe('sapling');
  });

  it('does not mutate the node, the worker, or the extraction outcome', () => {
    const tw = createTestWorld();
    const node = makeTreeNode(tw.places.square);
    tw.world.resourceNodes.push(node);
    const woodcutter = addPerson(tw, 'Woodcutter', 'woodcutter', v(10, 1, 9));
    woodcutter.mind.plan = [{ type: 'chop', status: 'active', pos: { ...node.pos }, data: { nodeId: node.id } }];
    const nodeBefore = JSON.parse(JSON.stringify(node));
    const remainingBefore = node.remaining;
    deriveExtractionPresentation(tw.world, node);
    expect(JSON.parse(JSON.stringify(node))).toEqual(nodeBefore);
    expect(node.remaining).toBe(remainingBefore);
  });
});
