import { ShadowGenerator, type AbstractMesh, type DirectionalLight, type Scene } from '@babylonjs/core';
import type { ArenaWorld } from './world';

/** A bounded local shadow map for skinned faces, clothing and nearby props.
 * Uses the existing key light; no extra lights, global floor bake, physics or asset mutation.
 */
export class LocalShadows {
  private readonly map: ShadowGenerator;
  private refresh = 0;
  constructor(private scene: Scene, private key: DirectionalLight, high: boolean) {
    this.map = new ShadowGenerator(high ? 2048 : 1024, key);
    this.map.usePercentageCloserFiltering = true;
    this.map.filteringQuality = ShadowGenerator.QUALITY_LOW;
    this.map.bias = .0004; this.map.normalBias = .012;
    key.autoUpdateExtends = false;
    key.orthoLeft = key.orthoBottom = -10; key.orthoRight = key.orthoTop = 10;
    key.shadowMinZ = .1; key.shadowMaxZ = 35;
    scene.onDisposeObservable.addOnce(() => this.map.dispose());
  }
  update(dt: number, world: ArenaWorld): void {
    const h = world.hero.pos, d = this.key.direction;
    this.key.position.set(h.x - d.x * 14, h.y + 1 - d.y * 14, h.z - d.z * 14);
    this.refresh -= dt; if (this.refresh > 0) return; this.refresh = .2;
    const casters: AbstractMesh[] = [];
    const fighters = [...world.fighters].filter(f => f === world.hero || f.alive && Math.hypot(f.pos.x - h.x, f.pos.z - h.z) < 9)
      .sort((a, b) => a === world.hero ? -1 : b === world.hero ? 1 : Math.hypot(a.pos.x - h.x, a.pos.z - h.z) - Math.hypot(b.pos.x - h.x, b.pos.z - h.z)).slice(0, 8);
    for (const f of fighters) for (const m of [...f.inst.meshes, ...f.extra]) if (m.isEnabled() && m.getTotalVertices()) { m.receiveShadows = true; casters.push(m); }
    for (const p of world.props.filter(p => !p.broken && !p.loose && !p.solid && Math.hypot(p.pos.x - h.x, p.pos.z - h.z) < 8).slice(0, 16)) {
      p.mesh.receiveShadows = true; casters.push(p.mesh);
    }
    for (const m of this.scene.meshes) if (m.name === 'env-floor' || m.name === 'gym-floor') m.receiveShadows = true;
    this.map.getShadowMap()!.renderList = casters;
  }
}
