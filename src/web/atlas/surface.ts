import type { Scene } from '@babylonjs/core';
import { ATLAS_REVISION, getAtlasAsset } from '../../sim/world/atlas';
import { atlasPlanetPlacements, atlasSpherePlacements } from '../../sim/world/atlas/placement';
import { length, normalize, sub, surfaceHeight, type PlanetSpec, type V3 } from '../../sim/world/planet/planet';
import { terrainHeight, type PlanetDescriptor } from '../../sim/world/universe/generation';
import { AtlasWorldRenderer, type AtlasRenderPlacement, type AtlasStreamOptions } from './stream';

/** Query cadence is visual only. World placement/collision share the same pure
 * random-access registry. Absolute positions keep old planets stable while fading. */
export class AtlasSurfaceRenderer {
  private stream: AtlasWorldRenderer;
  private placements: AtlasRenderPlacement[] = [];
  private lastQuery: V3 | null = null;
  private queryAge = 1;
  private context = '';
  private queryCount = 0;
  constructor(scene: Scene, lite = false, shadows?: AtlasStreamOptions['shadows']) { this.stream = new AtlasWorldRenderer(scene, { asset: getAtlasAsset, lite, shadows }); }

  planet(planet: PlanetDescriptor, observer: V3, origin: V3, dt: number, revision: number, catalog: string | undefined) {
    const local = sub(observer, planet.center), dir = normalize(local);
    const enabled = revision === 1 && catalog === ATLAS_REVISION;
    this.update(planet.id, observer, origin, dt, enabled && length(local) - planet.radius - Math.max(0, terrainHeight(planet, dir)) < this.stream.budgets.range,
      () => atlasPlanetPlacements(planet, local, this.stream.budgets.range, revision).map(p => ({
        ...p, position: { x: p.position.x + planet.center.x, y: p.position.y + planet.center.y, z: p.position.z + planet.center.z },
      })));
  }

  sphere(spec: PlanetSpec, observer: V3, origin: V3, dt: number, enabled = true) {
    this.update(`sphere:${spec.seed}:${spec.radius}`, observer, origin, dt,
      enabled && length(observer) - spec.radius - Math.max(0, surfaceHeight(spec, normalize(observer))) < this.stream.budgets.range,
      () => atlasSpherePlacements(spec, observer, this.stream.budgets.range, 1));
  }

  private update(context: string, observer: V3, origin: V3, dt: number, near: boolean, query: () => AtlasRenderPlacement[]) {
    this.queryAge += dt;
    if (!near) { this.placements = []; this.lastQuery = null; }
    else if (context !== this.context || !this.lastQuery || this.queryAge >= .5 || length(sub(observer, this.lastQuery)) >= 10) {
      this.placements = query(); this.lastQuery = { x: observer.x, y: observer.y, z: observer.z };
      this.queryAge = 0; this.queryCount++;
    }
    this.context = context; this.stream.update(this.placements, observer, origin, dt);
  }

  stats() { return { context: this.context, queriedPlacements: this.placements.length, queries: this.queryCount, ...this.stream.stats() }; }
  dispose() { this.stream.dispose(); this.placements = []; }
}
