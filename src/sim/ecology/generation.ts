import type { World } from '../core/world';
import { registerEcologyResources, habitatAt } from '../world/ecologyResources';
import { createAnimal, ecologyRng, enableEcology } from './animals';
import { ecologyQueries, visible } from './sensing';

/** One initial, seeded founder generation. Loading, census, depletion and extinction never
 * call this. Registration bounds only bound generation work; they impose no animal territory. */
export function initializeWildlife(world: World): void {
  if (world.ecology) return;
  enableEcology(world);
  const regions = world.geography ? [0, 1, 2].map(i => {
    const z = Math.floor(world.geography!.spec.size * (i + 1) / 4), x = Math.floor(world.geography!.riverX(z, i));
    return { x0: x - 48, z0: z - 48, x1: x + 48, z1: z + 48 };
  }) : [{ x0: 1, z0: 1, x1: world.grid.W - 2, z1: world.grid.D - 2 }];
  for (const region of regions) registerEcologyResources(world, region);
  const queries = ecologyQueries(world);
  for (const spec of Object.values(world.ecology!.species)) {
    const candidates = world.resourceNodes.filter(n => n.kind === 'forage' && n.forage && spec.diet[n.forage]
      && (spec.habitats[habitatAt(world, n.pos)] ?? 0) >= 0.5
      && queries.resources.query(n.pos, spec.senses.localRadiusM).some(w => w.kind === 'surface_water' && visible(world, n.pos, w.pos, spec.senses.localRadiusM)));
    if (!candidates.length) continue;
    const rng = ecologyRng(world), home = rng.pick(candidates), founders = rng.int(3, spec.role === 'small_herbivore' ? 7 : 4);
    world.ecology!.rngState = rng.state();
    const local = candidates.filter(n => Math.hypot(n.pos.x - home.pos.x, n.pos.z - home.pos.z) <= 8);
    for (let i = 0; i < founders; i++) createAnimal(world, spec.id, { ...local[i % local.length].pos });
  }
}
