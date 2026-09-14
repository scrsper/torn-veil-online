import type { Body, ResourceNode, Vec3 } from '../core/types';
import type { World } from '../core/world';
import { B } from '../physical/blocks';
import { forageSubstrateExists } from './resources';
import type { Forage, Habitat } from '../ecology/types';

const membership = new WeakMap<World, { source: ResourceNode[]; count: number; nodes: Set<ResourceNode> }>();
function isCanonicalNode(world: World, node: ResourceNode): boolean {
  let cache = membership.get(world);
  if (!cache || cache.source !== world.resourceNodes || cache.count > world.resourceNodes.length) {
    cache = { source: world.resourceNodes, count: 0, nodes: new Set() }; membership.set(world, cache);
  }
  while (cache.count < world.resourceNodes.length) cache.nodes.add(world.resourceNodes[cache.count++]);
  return cache.nodes.has(node);
}

export function habitatAt(world: World, pos: Vec3): Habitat {
  const x = Math.floor(pos.x), z = Math.floor(pos.z), y = world.nav.floorY(x, z);
  if (y < 0) return 'bare';
  const ground = world.grid.get(x, y - 1, z), at = world.grid.get(x, y, z);
  if (at === B.Water || ground === B.Water) return 'water';
  if (![B.Grass, B.Dirt, B.Sand, B.Gravel].includes(ground)) return 'built';
  if (world.geography && world.geography.natural(x, z).forest > 0.55) return 'woodland';
  // Bounded local cover measurement, also works in authored Ashford and test worlds.
  for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
    for (let dy = 0; dy <= 5; dy++) {
      if ([B.Log, B.Log2, B.Leaves, B.Leaves2, B.Bush].includes(world.grid.get(x + dx, y + dy, z + dz))) return 'woodland';
    }
  }
  return ground === B.Grass ? 'grassland' : 'bare';
}

/** Initial world endowment, called by generation or an explicit scenario. Never an animal
 * action. Real terrain determines placement; repeated registration cannot refill depletion. */
export function registerEcologyResources(world: World, bounds: { x0: number; z0: number; x1: number; z1: number }): void {
  const known = new Set(world.resourceNodes.map(n => n.id));
  const add = (n: ResourceNode) => { if (!known.has(n.id)) { known.add(n.id); world.resourceNodes.push(n); } };
  for (let x = Math.max(1, Math.ceil(bounds.x0)); x <= Math.min(world.grid.W - 2, bounds.x1); x++) {
    for (let z = Math.max(1, Math.ceil(bounds.z0)); z <= Math.min(world.grid.D - 2, bounds.z1); z++) {
      const y = world.nav.floorY(x, z);
      if (y < 0 || world.nav.walkCost(x, z) >= 3 || world.grid.get(x, y, z) === B.Water) continue;
      const pos = { x: x + 0.5, y, z: z + 0.5 };
      if (x % 4 === 0 && z % 4 === 0 && world.grid.get(x, y - 1, z) === B.Grass) {
        const habitat = habitatAt(world, pos);
        const moisture = world.geography?.natural(x, z).moisture ?? 0.6;
        const kinds: Forage[] = habitat === 'woodland' ? ['browse', 'mast'] : ['grass'];
        for (const forage of kinds) {
          const capacity = (forage === 'mast' ? 1.6 : 6.4) * (0.5 + moisture);
          add({ id: `forage_${forage}_${x}_${z}`, kind: 'forage', forage, yield: 'biomass', pos: { ...pos }, blocks: [],
            remaining: capacity, capacity, renewable: true, regrowHours: (forage === 'mast' ? 120 : 30) * 24,
            renewedAt: world.now, state: 'available' });
        }
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // Only surface water reachable from this bank, never an abstract well entitlement.
        for (const wy of [y, y - 1]) {
          const wx = x + dx, wz = z + dz;
          if (world.grid.get(wx, wy, wz) !== B.Water) continue;
          add({ id: `water_${wx}_${wy}_${wz}`, kind: 'surface_water', yield: 'water', pos: { ...pos },
            blocks: [{ x: wx, y: wy, z: wz, id: B.Water }], capacity: 1000, remaining: 1000,
            renewable: false, regrowHours: 0, state: 'available' });
        }
      }
    }
  }
}

export function ecologicalResourceAvailable(world: World, node: ResourceNode): boolean {
  if (node.remaining <= 0 || node.state !== 'available') return false;
  if (node.kind === 'forage') return forageSubstrateExists(world, node);
  return node.kind === 'surface_water' && node.blocks.some(b => world.grid.get(b.x, b.y, b.z) === B.Water);
}

/** Physical intake primitive. It cannot reach through walls, mint matter, or refill a source.
 * Future human/creature direct intake can use the same primitive with its own digestion. */
export function consumeEcologicalResource(world: World, body: Body, node: ResourceNode, requested: number, tick = world.now): number {
  if (world.body(body.id) !== body || !isCanonicalNode(world, node)) return 0;
  if (!Number.isFinite(requested) || requested <= 0 || body.dead || !body.present || !ecologicalResourceAvailable(world, node)) return 0;
  if (Math.hypot(body.pos.x - node.pos.x, body.pos.y - node.pos.y, body.pos.z - node.pos.z) > 1.6) return 0;
  if (!world.grid.lineOfSight({ ...body.pos, y: body.pos.y + 0.4 }, { ...node.pos, y: node.pos.y + 0.4 }, 2)) return 0;
  const amount = Math.min(node.remaining, requested);
  node.remaining = Math.max(0, node.remaining - amount);
  if (node.remaining < 1e-9) {
    node.remaining = 0; node.state = 'depleted';
    if (node.depletedAt === undefined) {
      node.depletedAt = tick;
      world.emit('resource_depleted', { actor: body.ownerId, pos: { ...node.pos }, tick, category: 'world', significance: 0.05,
        visibility: 0.15, loudness: 0, data: { nodeId: node.id, kind: node.kind, amount }, summary: `${node.forage ?? 'Surface water'} exhausted at ${Math.floor(node.pos.x)},${Math.floor(node.pos.z)}` });
    }
    if (node.kind === 'surface_water') {
      for (const b of node.blocks) if (world.grid.get(b.x, b.y, b.z) === B.Water) world.grid.set(b.x, b.y, b.z, B.Air);
      world.nav.rebuildArea(Math.floor(node.pos.x) - 2, Math.floor(node.pos.z) - 2, Math.floor(node.pos.x) + 2, Math.floor(node.pos.z) + 2);
    }
  }
  return amount;
}
