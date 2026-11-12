import { Vector3 } from '@babylonjs/core';
import { CreatureFactory } from '../actors/creatureFactory';
import { placeholderVisual, type BodyVisual } from '../actors/actorManager';
import type { WildlifeBody, WildlifeFrame } from '../net/messages';
import type { RenderContext } from '../render/engine';
import type { Atmosphere } from '../world/atmosphere';

/** The ordinary wildlife rigs, driven only by the host's observed body projection.
 * Animation/smoothing never advance ecology, pick targets, or resolve contact. */
export class RealmWildlifeView {
  private readonly factory = new CreatureFactory();
  private readonly bodies = new Map<string, { visual: BodyVisual; fallback: boolean; state: WildlifeBody }>();
  private pending = true;
  private disposed = false;
  private originKey = '';

  constructor(private readonly ctx: RenderContext, private readonly atmosphere: Atmosphere) {
    void this.factory.load(ctx.scene).finally(() => { this.pending = false; });
    ctx.scene.onDisposeObservable.addOnce(() => this.dispose());
  }

  update(dt: number, frame: WildlifeFrame, origin: { x: number; z: number }, age = 0): void {
    if (this.disposed) return;
    const originKey = `${origin.x}:${origin.z}`, rebased = this.originKey !== originKey;
    this.originKey = originKey;
    const seen = new Set<string>(), k = 1 - Math.exp(-14 * dt), sampleAge = Math.min(.075, Math.max(0, age));
    for (const state of frame.bodies) {
      if (!state.present) continue;
      seen.add(state.bodyId);
      let row = this.bodies.get(state.bodyId), created = false;
      if (row?.fallback && this.factory.has(state.speciesId)) {
        this.remove(state.bodyId, row); row = undefined;
      }
      if (!row) {
        const rig = this.factory.create(this.ctx.scene, this.atmosphere, state);
        const visual = rig ?? placeholderVisual(this.ctx, this.atmosphere, { kind: 'wildlife', wildlife: state });
        visual.root.metadata = { bodyId: state.bodyId, species: state.speciesId, source: rig ? 'project-generated-creature-rig' : 'temporary-wildlife-placeholder' };
        row = { visual, fallback: !rig, state }; this.bodies.set(state.bodyId, row); created = true;
      }
      row.state = state;
      const root = row.visual.root, target = new Vector3(state.pos.x + state.vel.x * sampleAge - origin.x, state.pos.y, state.pos.z + state.vel.z * sampleAge - origin.z);
      if (created || rebased || Vector3.DistanceSquared(root.position, target) > 64) root.position.copyFrom(target);
      else root.position.copyFrom(Vector3.Lerp(root.position, target, k));
      root.rotation.y = created ? state.yaw : root.rotation.y + Math.atan2(Math.sin(state.yaw - root.rotation.y), Math.cos(state.yaw - root.rotation.y)) * k;
      row.visual.update(dt, { bodyId: state.bodyId, own: false, kind: 'wildlife', wildlife: state,
        speed: Math.hypot(state.vel.x, state.vel.z), velocity: state.vel, yaw: state.yaw, crouch: 0, age: sampleAge });
    }
    for (const [id, row] of this.bodies) if (!seen.has(id)) this.remove(id, row);
  }

  inspect() {
    return { pending: this.pending, bodies: [...this.bodies].map(([bodyId, row]) => ({ bodyId,
      species: row.state.speciesId, fallback: row.fallback, defense: row.state.defense,
      condition: row.state.condition, dead: row.state.dead, position: { x: row.visual.root.position.x, y: row.visual.root.position.y, z: row.visual.root.position.z } })) };
  }

  private remove(id: string, row: { visual: BodyVisual; fallback: boolean }): void {
    if (row.fallback) for (const mesh of row.visual.root.getChildMeshes()) this.atmosphere.removeCaster(mesh);
    row.visual.dispose(); this.bodies.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [id, row] of this.bodies) this.remove(id, row);
  }
}
