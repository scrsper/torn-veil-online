import type { Body, ResourceNode, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { SpatialIndex, watchGeometry } from '../core/spatial';
import { ecologicalResourceAvailable } from '../world/ecologyResources';
import type { SpeciesSpec } from './types';

export interface EcologyQueries {
  resources: SpatialIndex<ResourceNode>; bodies: SpatialIndex<Body>;
}
const caches = new WeakMap<World, { source: ResourceNode[]; count: number; queries: EcologyQueries }>();
/** Disposable broad-phase indexes. No canonical answers are cached: quantities, geometry,
 * visibility and death are checked at use. Appended/moved/restored nodes stay discoverable. */
export function ecologyQueries(world: World): EcologyQueries {
  let cache = caches.get(world);
  if (!cache || cache.source !== world.resourceNodes || cache.count > world.resourceNodes.length) {
    cache = { source: world.resourceNodes, count: 0, queries: { resources: new SpatialIndex<ResourceNode>(16), bodies: new SpatialIndex<Body>(16) } };
    caches.set(world, cache);
  }
  const index = cache.queries.resources;
  while (cache.count < world.resourceNodes.length) {
    const n = world.resourceNodes[cache.count++];
    if (n.kind === 'forage' || n.kind === 'surface_water') watchGeometry(n, 'pos', ['x', 'z'], () => index.point(n, n.pos));
  }
  // Once per quantum, not one world scan per animal. Rebuild avoids retaining dead candidates.
  cache.queries.bodies = new SpatialIndex<Body>(16);
  for (const c of world.creatures()) if (c.wildlife) for (const id of c.bodies) {
    const b = world.body(id); if (b?.present && !b.dead) cache.queries.bodies.point(b, b.pos);
  }
  return cache.queries;
}
export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function visible(world: World, from: Vec3, to: Vec3, radius: number): boolean {
  return distance(from, to) <= radius && world.grid.lineOfSight({ ...from, y: from.y + 0.45 }, { ...to, y: to.y + 0.45 }, radius + 1);
}
export function senseResources(world: World, queries: EcologyQueries, body: Body, spec: SpeciesSpec): ResourceNode[] {
  return queries.resources.query(body.pos, spec.senses.localRadiusM).filter(n =>
    ecologicalResourceAvailable(world, n) && (n.kind === 'surface_water' || (n.forage && spec.diet[n.forage]))
    && visible(world, body.pos, n.pos, spec.senses.localRadiusM));
}
export function localAnimals(world: World, queries: EcologyQueries, body: Body, radius: number): Body[] {
  return queries.bodies.query(body.pos, radius).filter(b => b !== body && b.present && !b.dead && visible(world, body.pos, b.pos, radius));
}
