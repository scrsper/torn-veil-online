import { expect, it } from 'vitest';
import { addPerson, createTestWorld, step, v } from './helpers/world';
import { makePlace } from '../src/sim/world/factory';
import { plantGrove } from '../src/sim/world/resources';
import { B } from '../src/sim/physical/blocks';
import { near } from '../src/sim/world/locality';

it('moves from an exhausted tree to another available tree instead of replaying the completed plan', () => {
  const tw = createTestWorld(4301, 40), { world } = tw;
  for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) world.grid.set(x, 1, z, B.Grass);
  world.nav.rebuildAll();
  const clearing = makePlace(world, 'wilderness', 'clearing', { x0: 2, z0: 2, x1: 38, z1: 38, y0: 2, y1: 14 }, { inside: v(20, 2, 20) });
  plantGrove(world, { x0: 8, z0: 8, x1: 28, z1: 28 }, clearing.id, clearing.id, 2);
  const [first, second] = world.resourceNodes.filter(n => n.kind === 'tree');
  expect(second).toBeDefined();
  // Small finite stocks are explicit fixtures; goal choice, travel and extraction run normally.
  first.remaining = 1; second.remaining = 20;
  const p = addPerson(tw, 'Woodcutter', 'woodcutter', { ...first.pos }, { workId: clearing.id });
  p.schedule = [{ start: 0, end: 24, activity: 'work', placeId: clearing.id, label: 'fell trees' }];
  step(tw, 40);
  expect(first.state).toBe('depleted');
  expect(world.events.some(e => e.type === 'resource_extracted' && e.actor === p.id && e.data?.nodeId === second.id)).toBe(true);
  expect(p.mind.goal?.data?.nodeId).toBe(second.id);
  expect(world.events.filter(e => e.type === 'goal_completed' && e.actor === p.id && e.data?.goalType === 'chop').length).toBeLessThan(5);
});

it('keeps successive timber choices in the home locality while preferring a reachable local source', () => {
  const tw = createTestWorld(4302, 360), { world } = tw;
  for (let x = 210; x < 305; x++) for (let z = 8; z < 38; z++) world.grid.set(x, 1, z, B.Grass);
  world.nav.rebuildAll();
  const home = makePlace(world, 'house', 'home', { x0: 18, z0: 18, x1: 22, z1: 22, y0: 1, y1: 4 }, { inside: v(20, 1, 20) });
  const clearing = makePlace(world, 'wilderness', 'clearing', { x0: 210, z0: 8, x1: 305, z1: 38, y0: 2, y1: 14 }, { inside: v(250, 2, 20) });
  plantGrove(world, { x0: 220, z0: 12, x1: 240, z1: 32 }, clearing.id, clearing.id, 2);
  const localIds = world.resourceNodes.map(n => n.id);
  plantGrove(world, { x0: 280, z0: 12, x1: 300, z1: 32 }, clearing.id, clearing.id, 2);
  const distant = world.resourceNodes.find(n => !localIds.includes(n.id))!;
  expect(near(home.inside, distant.pos)).toBe(false);
  const p = addPerson(tw, 'Boundary worker', 'woodcutter', { ...distant.pos }, { workId: clearing.id, homeId: home.id });
  p.schedule = [{ start: 0, end: 24, activity: 'work', placeId: clearing.id, label: 'fell trees' }];
  step(tw, .3);
  expect(p.mind.goal?.type).toBe('chop');
  expect(localIds).toContain(p.mind.goal?.data?.nodeId);
  expect(near(home.inside, p.mind.goal?.targetPos)).toBe(true);
});
