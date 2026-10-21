import { RNG } from '../core/rng';
import { angleDelta } from './movement';
import type { NpcSpec } from './layout';
import type { Circle } from './collision';

/** Townsfolk motion: seeded, fixed-tick idle/wander. Each figure keeps its own stream, picks
 * waypoints around its anchor (vendors and guards stay close, strollers range the plaza and
 * streets), walks there with collision, pauses, and repeats. No triggers, no LLM; the same
 * seed and tick count always give the same positions. */
export const NPC_TICK = 1 / 10, NPC_RADIUS = .32;
export interface NpcWorld { blocked(x: number, z: number, r: number): boolean; move(x: number, z: number, dx: number, dz: number, r: number): [number, number] }
export interface NpcState { id: string; x: number; z: number; yaw: number; moving: boolean; wait: number; tx: number; tz: number; stuck: number }
const SPEED: Record<NpcSpec['role'], number> = { vendor: .7, guard: .9, patron: 1, stroller: 1.15 };
const PAUSE: Record<NpcSpec['role'], [number, number]> = { vendor: [3, 9], guard: [5, 14], patron: [4, 12], stroller: [2, 7] };
export class TownFolk {
  readonly states: NpcState[]; tick = 0;
  private rngs: RNG[];
  constructor(readonly specs: readonly NpcSpec[], readonly world: NpcWorld, seed: number) {
    this.rngs = specs.map((_s, i) => new RNG(seed).fork(1000 + i));
    this.states = specs.map((s, i) => ({ id: s.id, x: s.x, z: s.z, yaw: s.facing, moving: false, wait: this.rngs[i].range(0, 3), tx: s.x, tz: s.z, stuck: 0 }));
  }
  /** Advance one fixed tick. */
  step(): void {
    const dt = NPC_TICK; this.tick++;
    this.states.forEach((n, i) => {
      const spec = this.specs[i], rng = this.rngs[i];
      if (!n.moving) {
        n.wait -= dt;
        // Idle: vendors and guards turn back to face their post now and then.
        if (spec.role !== 'stroller') n.yaw += angleDelta(n.yaw, spec.facing) * .05;
        if (n.wait > 0) return;
        for (let t = 0; t < 8; t++) {
          const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * spec.radius, x = spec.x + Math.sin(a) * r, z = spec.z + Math.cos(a) * r;
          if (!this.world.blocked(x, z, NPC_RADIUS + .1)) { n.tx = x; n.tz = z; n.moving = true; n.stuck = 0; break; }
        }
        if (!n.moving) n.wait = 1;
        return;
      }
      const dx = n.tx - n.x, dz = n.tz - n.z, d = Math.hypot(dx, dz);
      if (d < .2) { n.moving = false; const [a, b] = PAUSE[spec.role]; n.wait = rng.range(a, b); return; }
      const step = Math.min(d, SPEED[spec.role] * dt), [nx, nz] = this.world.move(n.x, n.z, dx / d * step, dz / d * step, NPC_RADIUS);
      n.stuck = Math.hypot(nx - n.x, nz - n.z) < step * .3 ? n.stuck + 1 : 0;
      n.yaw += angleDelta(n.yaw, Math.atan2(dx, dz)) * .35; n.x = nx; n.z = nz;
      if (n.stuck > 15) { n.moving = false; n.wait = rng.range(1, 3); }
    });
  }
  /** Run until `ticks` ticks have elapsed in total. */
  advanceTo(ticks: number): void { while (this.tick < ticks) this.step(); }
  bodies(): Circle[] { return this.states.map(n => ({ x: n.x, z: n.z, r: NPC_RADIUS })); }
}
