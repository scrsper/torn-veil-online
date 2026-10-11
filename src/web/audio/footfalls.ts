import { B } from '../../sim/physical/blocks';

export type FootSurface = 'grass' | 'stone' | 'wood' | 'dirt' | 'water';
type Point = { x: number; y: number; z: number };
type Foot = 0 | 1;

/** Audible presentation of a baked swing-to-support edge, never a simulation event. */
export class ContactFootfalls {
  private previous: readonly [boolean, boolean] | null = null;
  private position: Point | null = null;
  private elapsed = 1;
  reset(): void { this.previous = null; this.position = null; this.elapsed = 1; }

  update(s: { dt: number; contacts?: readonly [boolean, boolean]; speed: number; active: boolean; position: Point }): readonly Foot[] {
    const moved = this.position ? Math.hypot(s.position.x - this.position.x, s.position.y - this.position.y, s.position.z - this.position.z) : 0;
    this.position = { ...s.position };
    // A reconnect, suspended tab, idle, attack or ambiguous blend cannot manufacture a landing.
    if (!s.active || s.speed < .12 || !s.contacts || s.dt <= 0 || s.dt > .15 || moved > Math.max(.65, s.speed * s.dt * 3)) {
      this.previous = null; this.elapsed = 1; return [];
    }
    this.elapsed += s.dt;
    const previous = this.previous; this.previous = [...s.contacts];
    if (!previous) return [];
    const landed = ([0, 1] as const).filter(side => !previous[side] && s.contacts![side]);
    // Double support and rapid source-clip changes should not sound like two simultaneous stomps.
    if (!landed.length || this.elapsed < .12) return [];
    this.elapsed = 0;
    return [landed[0]];
  }
}

/** Use the projected physical palette before applying a missing-surface fallback. */
export function footSurface(block: number | null, indoor = false): FootSurface {
  switch (block) {
    case B.Water: return 'water';
    case B.Planks: case B.DarkPlanks: case B.Log: case B.Log2: return 'wood';
    case B.Stone: case B.Cobble: case B.Brick: case B.StoneBrick: case B.Mossy: case B.Gravel: return 'stone';
    case B.Dirt: case B.Path: case B.Farmland: case B.Sand: case B.Mud: case B.Snow: return 'dirt';
    case B.Grass: case B.Leaves: case B.Leaves2: case B.Hay: return 'grass';
    default: return indoor ? 'wood' : 'grass';
  }
}

/** Camera-relative stereo and a bounded nearby-only falloff; no unseen world queries. */
export function footfallSpatial(source: Point, listener: Point, forward: Point): { gain: number; pan: number } {
  const dx = source.x - listener.x, dy = source.y - listener.y, dz = source.z - listener.z;
  const distance = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz), facing = Math.hypot(forward.x, forward.z);
  const gain = Math.pow(Math.max(0, 1 - distance / 14), 2);
  const pan = horizontal > .001 && facing > .001 ? (dx * -forward.z + dz * forward.x) / (horizontal * facing) : 0;
  return { gain, pan: Math.max(-.85, Math.min(.85, pan)) };
}
