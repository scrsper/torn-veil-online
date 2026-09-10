import type { World } from '../core/world';
import { WorldGeography, PLAYABLE_WORLD, type PlayableWorldSpec } from './geography';
import { generateProceduralWorld } from './settlement';
import { B } from '../physical/blocks';

export function generatePlayableWorld(world: World, spec: PlayableWorldSpec = PLAYABLE_WORLD) {
  const geography = new WorldGeography(world.seed, spec);
  world.geography = geography;
  world.clock.timeScale = spec.timeScale;
  const settlements = generateProceduralWorld(world, geography.sites, geography);
  // Connect regional approaches to local streets through actual canonical navigation.
  world.grid.recording = false;
  for (const s of settlements) {
    const x = s.spec.site.x - 4, z = s.spec.site.z + 120;
    const path = world.nav.findPath(s.places.square.inside, { x: x + .5, y: world.nav.floorY(x, z), z: z + .5 });
    if (!path) continue;
    let previous = s.places.square.inside;
    for (const p of path) {
      const length = Math.ceil(Math.hypot(p.x - previous.x, p.z - previous.z) * 2);
      for (let j = 0; j <= length; j++) {
        const t = length ? j / length : 1, px = Math.floor(previous.x + (p.x - previous.x) * t), pz = Math.floor(previous.z + (p.z - previous.z) * t), y = world.nav.floorY(px, pz) - 1;
        if ([B.Grass, B.Dirt, B.Sand].includes(world.grid.get(px, y, pz))) world.grid.set(px, y, pz, B.Path);
      }
      previous = p;
    }
  }
  world.initNav(); world.grid.recording = true;
  return settlements;
}

/** Canonical relevance follows bodies, not renderer requests. Untouched substrate has no
 * active lifecycle; once indexed, its resource history remains in the shared simulation. */
export function indexWilderness(world: World): void {
  const g = world.geography; if (!g) return;
  for (const body of world.activeBodies()) {
    const rx = Math.floor(body.pos.x / g.spec.regionSize), rz = Math.floor(body.pos.z / g.spec.regionSize);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = rx + dx, z = rz + dz, id = `${x},${z}`;
      if (world.wildernessRegions.has(id)) continue;
      world.wildernessRegions.add(id); world.resourceNodes.push(...structuredClone(g.resources(x, z)));
    }
  }
}
