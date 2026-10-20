import type { Scene } from '@babylonjs/core';
import type { InteriorPlan } from '../../sim/world/interiors/layout';
import { getAtlasAsset } from '../../sim/world/atlas';
import { atlasTowerDecorations, type AtlasPlacement } from '../../sim/world/atlas/placement';
import { AtlasWorldRenderer } from './stream';

/** Project Atlas props only over the existing floor's bench solids. The host
 * floor plan, routes, targets and rewards are untouched. */
export class AtlasTowerDressing {
  private placements: AtlasPlacement[] = [];
  private renderer: AtlasWorldRenderer;
  constructor(scene: Scene) {
    this.renderer = new AtlasWorldRenderer(scene, { asset: getAtlasAsset,
      budgets: { models: 16, instances: 32, bytes: 24 * 1024 * 1024, triangles: 240_000,
        instanceTriangles: 320_000, meshInstances: 240, range: 150 } });
    scene.onDisposeObservable.addOnce(() => this.renderer.dispose());
  }
  setPlan(plan: InteriorPlan | null) {
    this.placements = !plan || plan.assetScene ? [] : atlasTowerDecorations({
      id: plan.id, seed: plan.descriptor.seed, floor: plan.descriptor.floor,
      supports: plan.solids.filter(s => s.kind === 'bench').map(s => ({
        id: s.id, position: { x: s.x + s.w / 2, y: s.y + s.h / 2, z: s.z + s.d / 2 },
        half: { x: s.w / 2, y: s.h / 2, z: s.d / 2 },
      })),
      limit: 32,
    });
  }
  /** Avoid double dressing a bench whose position already belongs to Atlas. */
  replaces(x: number, z: number) {
    return this.placements.some(p => Math.hypot(p.position.x - x, p.position.z - z) < .1);
  }
  update(observer: { x: number; y: number; z: number }, dt: number) {
    this.renderer.update(this.placements, observer, { x: 0, y: 0, z: 0 }, dt);
  }
  stats() { return this.renderer.stats(); }
}
