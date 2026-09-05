import * as THREE from 'three';
import type { World } from '../../sim/core/world';
import type { WorldEvent } from '../../sim/core/types';

/**
 * Transient extraction effects (spec §14: EVENT, not STATE). A chop/quarry swing landing and a
 * node being worked out are moments, not facts that should remain visible — unlike a
 * construction site's stage (ConstructionRenderer) or a depleted node's cleared voxel blocks
 * (already handled canonically by resources.ts, which clears/restores the node's own blocks).
 * This class owns none of that persistent state; it only listens to the two real events
 * `extractFromNode`/`depleteNode` already emit (`resource_extracted`, `resource_depleted`) and
 * spawns a short-lived wood-chip/stone-chip burst plus a target "reaction" flash at the node's
 * position — pure presentation, nothing here is read back by the simulation or persisted.
 */
interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; }
interface Flash { mesh: THREE.Mesh; life: number; maxLife: number; }

const CHIP_COLORS: Record<'log' | 'stone', number[]> = {
  log: [0xc89050, 0x9a7040, 0x6a4a28],
  stone: [0xb0aca0, 0x8a8880, 0x707070],
};

function chipKindFor(e: WorldEvent): 'log' | 'stone' { return e.data?.kind === 'stone' ? 'stone' : 'log'; }

export class ExtractionEffectsController {
  group = new THREE.Group();
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  constructor(world: World) {
    this.group.name = 'extraction-effects';
    world.onEvent(e => this.onEvent(e));
  }

  private onEvent(e: WorldEvent): void {
    if (e.type === 'resource_extracted') this.spawn(e, 6, 0.5);
    else if (e.type === 'resource_depleted') this.spawn(e, 12, 0.8);
  }

  private spawn(e: WorldEvent, chipCount: number, flashLife: number): void {
    const pos = e.pos; if (!pos) return;
    const kind = chipKindFor(e);
    this.burst(pos, kind, chipCount);
    this.flash(pos, kind === 'stone' ? 0xd8d4c8 : 0xe0c080, flashLife);
  }

  private burst(pos: { x: number; y: number; z: number }, kind: 'log' | 'stone', count: number): void {
    const colors = CHIP_COLORS[kind];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      mesh.position.set(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 0.6 + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * 0.4);
      this.group.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1.5, (Math.random() - 0.5) * 3), life: 0.6 + Math.random() * 0.3 });
    }
  }

  /** The "target visibly reacts" cue (spec §13) — a brief expanding, fading flash at the node's
   * position. Voxel trunk/outcrop geometry is baked into shared chunk meshes (game/voxel/
   * mesher.ts), so a per-node mesh shake isn't cheaply addressable; an overlay reaction that
   * works identically for trees and stone (and later mill/crop nodes) is the general solution. */
  private flash(pos: { x: number; y: number; z: number }, color: number, maxLife: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    mesh.position.set(pos.x, pos.y + 0.8, pos.z);
    this.group.add(mesh);
    this.flashes.push({ mesh, life: maxLife, maxLife });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt; p.vel.y -= 9 * dt; p.mesh.position.addScaledVector(p.vel, dt);
      if (p.life <= 0) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); this.particles.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const t = Math.max(0, f.life / f.maxLife);
      f.mesh.scale.setScalar(1 + (1 - t) * 1.6);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * t;
      if (f.life <= 0) { this.group.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as THREE.Material).dispose(); this.flashes.splice(i, 1); }
    }
  }
}
